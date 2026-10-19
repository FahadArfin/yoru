import { createHash, randomUUID } from 'node:crypto';
import { apiError } from './validation.js';

export const continuationSchema = `CREATE TABLE IF NOT EXISTS reader_continuations (
 id TEXT PRIMARY KEY NOT NULL, owner_hash TEXT NOT NULL, destination TEXT NOT NULL,
 selection_fingerprint TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reader_continuations_expiry ON reader_continuations(expires_at);
CREATE TABLE IF NOT EXISTS reader_inventory_cache (
 source_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, observed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reader_feed_cache (
 media_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, observed_at INTEGER NOT NULL
);`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const owner = (context) =>
  hash(context.userId ? `account:${context.userId}` : `guest:${context.guestId || ''}`);
export const restartRequired = () =>
  Object.assign(apiError(409, 'This reading page expired or preferences changed. Start again.'), {
    restartRequired: true,
  });

export function createContinuationStore(db, { now = Date.now, uuid = randomUUID } = {}) {
  function token(cursor) {
    if (
      typeof cursor !== 'string' ||
      Buffer.byteLength(cursor) > 2048 ||
      !/^[a-f0-9]{32}$/.test(cursor)
    )
      throw restartRequired();
    return cursor;
  }
  async function read(cursor) {
    const row = await db.get(
      'SELECT * FROM reader_continuations WHERE id=? AND expires_at>?',
      token(cursor),
      now(),
    );
    if (!row) throw restartRequired();
    return row;
  }
  async function write(context, state, expiresAt = now() + 1800000) {
    const payload = JSON.stringify(state);
    if (typeof payload !== 'string' || Buffer.byteLength(payload) > 1048576)
      throw apiError(413, 'Reading continuation is too large. Start again.');
    const id = token(uuid().replaceAll('-', ''));
    await db.run(
      'INSERT INTO reader_continuations(id,owner_hash,destination,selection_fingerprint,payload,expires_at) VALUES(?,?,?,?,?,?)',
      id,
      owner(context),
      context.destination,
      context.selectionFingerprint,
      payload,
      expiresAt,
    );
    return id;
  }
  return {
    async start(context, state) {
      await db.run('DELETE FROM reader_continuations WHERE expires_at<=?', now());
      return write(context, state);
    },
    async resume(cursor, context) {
      const row = await read(cursor);
      if (
        row.owner_hash !== owner(context) ||
        row.destination !== context.destination ||
        row.selection_fingerprint !== context.selectionFingerprint
      )
        throw restartRequired();
      return JSON.parse(row.payload);
    },
    async advance(cursor, state) {
      const row = await read(cursor);
      const payload = JSON.stringify(state);
      if (typeof payload !== 'string' || Buffer.byteLength(payload) > 1048576)
        throw apiError(413, 'Reading continuation is too large. Start again.');
      const id = token(uuid().replaceAll('-', ''));
      // Rotate with a compare-and-swap: one session retains one <=1 MiB state.
      // Concurrent/replayed old tokens restart instead of skipping another page.
      const [rows] = await db.atomic([
        {
          sql: 'UPDATE reader_continuations SET id=?,payload=? WHERE id=? AND expires_at>? RETURNING id',
          values: [id, payload, cursor, now()],
        },
      ]);
      if (!rows.length) throw restartRequired();
      return id;
    },
    prune: () => db.run('DELETE FROM reader_continuations WHERE expires_at<=?', now()),
  };
}
