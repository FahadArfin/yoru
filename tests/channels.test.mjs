import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  channelSchema,
  channelList,
  channelMessages,
  createChannel,
  postChannelMessage,
} from '../server/channels.js';

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(`PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,avatar TEXT);
    INSERT INTO users VALUES('member','Reader','');
    CREATE TABLE messages(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),room_id TEXT,body TEXT,created_at TEXT);`);
  sql.exec(channelSchema);
  sql.exec('ALTER TABLE messages ADD COLUMN channel_id TEXT REFERENCES chat_channels(id)');
  return {
    get: (q, ...v) => sql.prepare(q).get(...v),
    all: (q, ...v) => sql.prepare(q).all(...v),
    run: (q, ...v) => sql.prepare(q).run(...v),
  };
}
test('channel history pages without gaps at equal timestamps and never includes room messages', async (t) => {
  const db = fixture(t),
    timestamp = new Date().toISOString();
  for (let i = 0; i < 105; i++)
    db.run(
      'INSERT INTO messages VALUES(?,?,NULL,?,?,NULL)',
      `message-${i}`,
      'member',
      `Message ${i}`,
      timestamp,
    );
  db.run(
    'INSERT INTO messages VALUES(?,?,?,?,?,NULL)',
    'private',
    'member',
    'private-room',
    'Secret',
    timestamp,
  );
  const newest = await channelMessages(db, 'general');
  assert.equal(newest.items.length, 50);
  assert.equal(newest.hasMore, true);
  const previous = await channelMessages(db, 'general', { before: newest.items[0].id });
  const oldest = await channelMessages(db, 'general', { before: previous.items[0].id });
  assert.equal(oldest.items.length, 5);
  assert.equal(oldest.hasMore, false);
  assert.equal(
    new Set([...oldest.items, ...previous.items, ...newest.items].map((x) => x.id)).size,
    105,
  );
  assert.ok(!newest.items.some((x) => x.body === 'Secret'));
  const caughtUp = await channelMessages(db, 'general', { after: 'message-0' });
  assert.equal(caughtUp.hasMore, true);
  assert.equal(caughtUp.items.at(-1).id, 'message-50');
  await assert.rejects(() => channelMessages(db, 'general', { after: 'private' }), { status: 400 });
});
test('channel and message limits are atomic and names are unique', async (t) => {
  const db = fixture(t);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => createChannel(db, { name: `Channel ${i}` }, 'member')),
  );
  await assert.rejects(() => createChannel(db, { name: 'One too many' }, 'member'), {
    status: 429,
  });
  await assert.rejects(() => createChannel(db, { name: 'CHANNEL 0' }, 'member'), { status: 409 });
  await assert.rejects(
    () => createChannel(db, { name: 'Private place', visibility: 'private' }, 'member'),
    { status: 400 },
  );
  assert.equal((await channelList(db, { q: 'channel 1' })).items.length, 1);
  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      postChannelMessage(db, 'general', { body: `Message ${i}` }, 'member'),
    ),
  );
  await assert.rejects(() => postChannelMessage(db, 'general', { body: 'Too fast' }, 'member'), {
    status: 429,
  });
  assert.equal((await channelMessages(db, 'general')).items.length, 30);
});
test('channel browser uses bounded alphabetical pages', async (t) => {
  const db = fixture(t);
  for (let i = 0; i < 65; i++)
    db.run(
      'INSERT INTO chat_channels VALUES(?,?,?,?,?,?)',
      `id-${i}`,
      `Channel ${i}`,
      `channel ${String(i).padStart(2, '0')}`,
      '',
      'member',
      new Date().toISOString(),
    );
  const first = await channelList(db),
    second = await channelList(db, { after: first.nextCursor });
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 16);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map((x) => x.id)).size, 66);
});
