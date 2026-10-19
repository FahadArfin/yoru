import { createHash, randomBytes } from 'node:crypto';
import { apiError } from './validation.js';
import { getCatalogPreferences } from './catalog-preferences.js';
import {
  normalizeGuestSelection,
  selectionProjection,
  validDestination,
} from '../shared/catalog-selection.js';

export const READER_GUEST_COOKIE = 'yoru_reader_guest';
export const READER_CONTEXT_SECONDS = 1800;
export function nodeReaderSignal(request, response) {
  const controller = new AbortController();
  const cleanup = () => {
    request.off('aborted', abort);
    response.off('close', closed);
    response.off('finish', cleanup);
  };
  const abort = () => {
    controller.abort();
    cleanup();
  };
  const closed = () => {
    if (!response.writableFinished) abort();
    else cleanup();
  };
  request.once('aborted', abort);
  response.once('close', closed);
  response.once('finish', cleanup);
  if (request.aborted) abort();
  return controller.signal;
}
export const readerContextSchema = `CREATE TABLE IF NOT EXISTS reader_guest_contexts (
 guest_hash TEXT NOT NULL, destination TEXT NOT NULL, selection TEXT NOT NULL,
 revision INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(guest_hash,destination)
);
CREATE INDEX IF NOT EXISTS reader_guest_contexts_expiry ON reader_guest_contexts(expires_at);`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const readerGuestId = (value) =>
  /^[a-f0-9]{64}$/.test(value || '') ? value : randomBytes(32).toString('hex');
export const readerContextResponse = (context) => ({
  destination: context.destination,
  revision: context.revision,
  selectionFingerprint: context.selectionFingerprint,
});
function destination(input) {
  const result = input?.destination ?? 'yoru';
  if (!validDestination(result)) throw apiError(400, 'Invalid reader destination.');
  return result;
}
function context(input, options, selection, revision) {
  const target = destination(input),
    projection = selectionProjection(selection);
  return {
    destination: target,
    integrationMode: projection.modes[target],
    userId: options.userId || null,
    sessionHash: options.sessionHash || null,
    guestId: options.userId ? null : options.guestId || null,
    overrides: projection.overrides,
    selection: projection,
    revision,
    selectionFingerprint: hash(JSON.stringify({ destination: target, ...projection })),
    language: typeof input?.language === 'string' ? input.language.slice(0, 64) : null,
    signal: options.signal,
    extensionsEnabled: options.extensionsEnabled === true || options.extensionsEnabled === '1',
  };
}
export async function resolveReaderContext(input = {}, options) {
  const target = destination(input);
  if (options.userId) {
    // Keep the identity guard and the entire settings read in one transaction/batch.
    const db = options.sessionHash
      ? {
          ...options.db,
          atomic: (statements) =>
            options.db.atomic(statements, {
              userId: options.userId,
              sessionHash: options.sessionHash,
            }),
        }
      : options.db;
    const saved = await getCatalogPreferences({ db, userId: options.userId });
    return context(input, options, saved, saved.revision);
  }
  const row =
    options.guestId &&
    (await options.db.get(
      'SELECT selection,revision FROM reader_guest_contexts WHERE guest_hash=? AND destination=? AND expires_at>?',
      hash(options.guestId),
      target,
      (options.now || Date.now)(),
    ));
  return context(input, options, row ? JSON.parse(row.selection) : {}, row?.revision ?? 0);
}
export async function saveReaderContext(input, options) {
  const target = destination(input);
  if (options.userId) return resolveReaderContext(input, options);
  const selection = normalizeGuestSelection(input?.selection);
  if (
    !Number.isSafeInteger(input?.expectedRevision) ||
    input.expectedRevision < 0 ||
    !options.guestId
  )
    throw apiError(400, 'Invalid reader context revision.');
  const now = (options.now || Date.now)();
  const [rows] = await options.db.atomic([
    {
      sql: `INSERT INTO reader_guest_contexts(guest_hash,destination,selection,revision,expires_at)
      SELECT ?,?,?,1,? WHERE ?=0 OR EXISTS(SELECT 1 FROM reader_guest_contexts WHERE guest_hash=? AND destination=?)
      ON CONFLICT(guest_hash,destination) DO UPDATE SET selection=excluded.selection,
      revision=reader_guest_contexts.revision+1,expires_at=excluded.expires_at
      WHERE (CASE WHEN reader_guest_contexts.expires_at<=? THEN 0 ELSE reader_guest_contexts.revision END)=?
      RETURNING revision`,
      values: [
        hash(options.guestId),
        target,
        JSON.stringify(selection),
        now + READER_CONTEXT_SECONDS * 1000,
        input.expectedRevision,
        hash(options.guestId),
        target,
        now,
        input.expectedRevision,
      ],
    },
  ]);
  if (!rows.length) throw apiError(409, 'Reader preferences changed. Reload and try again.');
  return context(input, options, selection, rows[0].revision);
}
