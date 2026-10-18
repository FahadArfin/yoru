import { createHash, randomBytes } from 'node:crypto';
import { apiError } from './validation.js';

export const PRESENCE_COOKIE = 'yoru_presence';
export const PRESENCE_WINDOW = 75000;
export const presenceSchema = `CREATE TABLE IF NOT EXISTS visitor_presence (
  visitor_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT REFERENCES sessions(token_hash) ON DELETE CASCADE,
  activity TEXT NOT NULL, last_seen INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS visitor_presence_seen ON visitor_presence(last_seen);`;

// Only the most recent visible tab contributes an activity for each member/browser.
const currentVisitors = `WITH active AS (
  SELECT p.*, u.name, u.avatar,
    ROW_NUMBER() OVER (PARTITION BY COALESCE('user:' || p.user_id, 'guest:' || p.visitor_hash)
      ORDER BY p.last_seen DESC, p.visitor_hash) AS position
  FROM visitor_presence p LEFT JOIN users u ON u.id=p.user_id
  WHERE p.last_seen>? AND (p.user_id IS NULL OR EXISTS(
    SELECT 1 FROM sessions s WHERE s.token_hash=p.session_hash AND s.user_id=p.user_id AND s.expires_at>?
  ))
)`;

export async function visitorSnapshot(db, now = Date.now()) {
  const summary = await db.get(
    `${currentVisitors} SELECT COUNT(*) AS count,
    COALESCE(SUM(user_id IS NOT NULL),0) AS registered,
    COALESCE(SUM(user_id IS NULL),0) AS guests,
    COALESCE(SUM(activity='watching'),0) AS watching,
    COALESCE(SUM(activity='reading'),0) AS reading,
    COALESCE(SUM(activity='browsing'),0) AS browsing
    FROM active WHERE position=1`,
    now - PRESENCE_WINDOW,
    now,
  );
  const users = await db.all(
    `${currentVisitors} SELECT user_id AS id,name,avatar
    FROM active WHERE position=1 AND user_id IS NOT NULL ORDER BY name,user_id LIMIT 80`,
    now - PRESENCE_WINDOW,
    now,
  );
  return { ...summary, users };
}

export async function touchVisitor(db, input, cookie, user, sessionHash, now = Date.now()) {
  if (!['watching', 'reading', 'browsing'].includes(input?.activity))
    throw apiError(400, 'Choose a valid presence activity.');
  const visitor = /^[A-Za-z0-9_-]{43}$/.test(cookie || '')
    ? cookie
    : randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(visitor).digest('hex');
  // Account identity always comes from the verified server session.
  await db.run(
    `INSERT INTO visitor_presence(visitor_hash,user_id,session_hash,activity,last_seen)
    SELECT ?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?)
    ON CONFLICT(visitor_hash) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash,
      activity=excluded.activity,last_seen=excluded.last_seen`,
    hash,
    user?.id || null,
    user ? sessionHash : null,
    input.activity,
    now,
    user?.id || null,
    sessionHash || '',
    user?.id || '',
    now,
  );
  await db.run('DELETE FROM visitor_presence WHERE last_seen<=?', now - PRESENCE_WINDOW);
  return { visitor, online: await visitorSnapshot(db, now) };
}
