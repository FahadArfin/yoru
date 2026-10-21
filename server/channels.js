import { randomUUID } from 'node:crypto';
import { apiError, text } from './validation.js';

export const channelSchema = `
CREATE TABLE IF NOT EXISTS chat_channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '', creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_channels_creator_time ON chat_channels(creator_id,created_at);
`;
const shape = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  visibility: 'public',
  createdAt: row.created_at,
});
const scope = (id) => (id === 'general' ? null : id);
const messageShape = (row) => ({
  id: row.id,
  sequence: row.sequence,
  body: row.body,
  createdAt: row.created_at,
  author: { id: row.user_id, name: row.name, avatar: row.avatar },
});

export async function channelDetails(db, id) {
  if (id === 'general')
    return {
      id: 'general',
      name: 'General',
      description: 'Talk about what you are watching and reading.',
      visibility: 'public',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  const row =
    typeof id === 'string' &&
    id.length <= 64 &&
    (await db.get('SELECT * FROM chat_channels WHERE id=?', id));
  if (!row) throw apiError(404, 'Channel not found. Browse the public channels to find another.');
  return shape(row);
}

export async function channelList(db, query = {}) {
  const search = text(query.q || '', { name: 'Search', max: 80 }).toLowerCase();
  const after = text(query.after || '', { name: 'Channel cursor', max: 80 });
  const rows = await db.all(
    `WITH available AS (SELECT * FROM chat_channels UNION ALL SELECT 'general','General','general','Talk about what you are watching and reading.',NULL,'2026-01-01T00:00:00.000Z')
    SELECT * FROM available WHERE name_key>? AND
    (instr(name_key,?)>0 OR instr(lower(description),?)>0)
    ORDER BY name_key LIMIT 51`,
    after,
    search,
    search,
  );
  const page = rows.slice(0, 50);
  return { items: page.map(shape), nextCursor: rows.length > 50 ? page.at(-1).name_key : null };
}

export async function createChannel(db, input, userId) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw apiError(400, 'Enter a channel name and description.');
  if (input.visibility !== undefined && input.visibility !== 'public')
    throw apiError(400, 'Community channels are always public.');
  const name = text(input.name, { name: 'Channel name', min: 3, max: 60 }).replace(/\s+/g, ' ');
  if (name.length < 3) throw apiError(400, 'Channel name must contain at least 3 characters.');
  const nameKey = name.normalize('NFKC').toLowerCase();
  if (nameKey === 'general')
    throw apiError(409, 'General already exists. Choose it in the channel browser.');
  if (nameKey.length > 80) throw apiError(400, 'Choose a shorter channel name.');
  const description = text(input.description || '', { name: 'Description', max: 240 });
  const timestamp = new Date().toISOString(),
    id = randomUUID();
  await db.run(
    `INSERT OR IGNORE INTO chat_channels(id,name,name_key,description,creator_id,created_at)
    SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM chat_channels WHERE creator_id=? AND created_at>?)<10`,
    id,
    name,
    nameKey,
    description,
    userId,
    timestamp,
    userId,
    new Date(Date.now() - 86400000).toISOString(),
  );
  const row = await db.get('SELECT * FROM chat_channels WHERE id=?', id);
  if (row) return { channel: shape(row) };
  if (await db.get('SELECT id FROM chat_channels WHERE name_key=?', nameKey))
    throw apiError(
      409,
      'A channel with that name already exists. Choose it in the channel browser or use another name.',
    );
  throw apiError(429, 'You can create up to 10 channels a day. Try again later.');
}

export async function channelMessages(db, id, query = {}) {
  const channel = await channelDetails(db, id);
  if (query.before && query.after) throw apiError(400, 'Choose one message cursor.');
  const cursor = query.before || query.after;
  let sequence = null;
  if (cursor) {
    if (typeof cursor !== 'string' || cursor.length > 64)
      throw apiError(400, 'Invalid message cursor.');
    const row = await db.get(
      'SELECT rowid AS sequence FROM messages WHERE id=? AND room_id IS NULL AND channel_id IS ?',
      cursor,
      scope(id),
    );
    if (!row) throw apiError(400, 'That message does not belong to this channel.');
    sequence = row.sequence;
  }
  const forward = !!query.after;
  const rows = await db.all(
    `SELECT m.*,m.rowid AS sequence,u.name,u.avatar FROM messages m JOIN users u ON u.id=m.user_id
    WHERE m.room_id IS NULL AND m.channel_id IS ? ${sequence === null ? '' : `AND m.rowid ${forward ? '>' : '<'} ?`}
    ORDER BY m.rowid ${forward ? 'ASC' : 'DESC'} LIMIT 51`,
    scope(id),
    ...(sequence === null ? [] : [sequence]),
  );
  const page = rows.slice(0, 50);
  if (!forward) page.reverse();
  return { channel, items: page.map(messageShape), hasMore: rows.length > 50 };
}

export async function postChannelMessage(db, id, input, userId) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw apiError(400, 'Enter a message.');
  await channelDetails(db, id);
  const body = text(input.body, { name: 'Message', min: 1, max: 2000 });
  const messageId = randomUUID(),
    timestamp = new Date().toISOString();
  await db.run(
    `INSERT INTO messages(id,user_id,room_id,channel_id,body,created_at)
    SELECT ?,?,NULL,?,?,? WHERE
    (SELECT COUNT(*) FROM messages WHERE user_id=? AND created_at>?)<30`,
    messageId,
    userId,
    scope(id),
    body,
    timestamp,
    userId,
    new Date(Date.now() - 60000).toISOString(),
  );
  const row = await db.get(
    'SELECT m.*,m.rowid AS sequence,u.name,u.avatar FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?',
    messageId,
  );
  if (!row) throw apiError(429, 'You are sending messages quickly. Please wait a moment.');
  return { message: messageShape(row) };
}
