import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const databasePath =
  process.env.YORU_DB_PATH || resolve(process.env.DATA_DIR || 'data', 'yoru.sqlite');
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
export const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT,
    discord_id TEXT UNIQUE, avatar TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_user_expiry ON sessions(user_id, expires_at);
  CREATE TABLE IF NOT EXISTS mal_connections (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mal_user_id TEXT NOT NULL, username TEXT NOT NULL, tokens_cipher TEXT NOT NULL,
    connection_version TEXT NOT NULL, connected_at TEXT NOT NULL, last_synced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS mal_oauth_states (
    state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL, verifier_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS library (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'planned', progress REAL NOT NULL DEFAULT 0, score REAL,
    updated_at TEXT NOT NULL, PRIMARY KEY(user_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
    title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, spoiler INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL, unit INTEGER NOT NULL DEFAULT 0, parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL, spoiler INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reviews_media_updated ON reviews(media_id, updated_at);
  CREATE INDEX IF NOT EXISTS comments_media_unit ON comments(media_id, unit, created_at);
  CREATE TABLE IF NOT EXISTS comment_votes (
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value INTEGER NOT NULL CHECK(value IN (-1,1)), PRIMARY KEY(comment_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
    media_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('watch','read')),
    visibility TEXT NOT NULL CHECK(visibility IN ('public','private')), invite_hash TEXT,
    capacity INTEGER NOT NULL, unit INTEGER NOT NULL DEFAULT 1, paused INTEGER NOT NULL DEFAULT 1,
    position REAL NOT NULL DEFAULT 0, source_url TEXT NOT NULL DEFAULT '', source_kind TEXT NOT NULL DEFAULT 'external',
    version INTEGER NOT NULL DEFAULT 1, state_updated_at TEXT NOT NULL, created_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY(room_id,user_id)
  );
  CREATE INDEX IF NOT EXISTS rooms_host_open ON rooms(host_id, closed_at);
  CREATE INDEX IF NOT EXISTS room_members_expiry ON room_members(last_seen);
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_room_time ON messages(room_id, created_at);
  CREATE TABLE IF NOT EXISTS watch_views (
    media_id TEXT NOT NULL, visitor_hash TEXT NOT NULL, last_seen INTEGER NOT NULL,
    PRIMARY KEY(media_id, visitor_hash)
  );
  CREATE INDEX IF NOT EXISTS watch_views_expiry ON watch_views(last_seen);
`);
if (
  !db
    .prepare('PRAGMA table_info(library)')
    .all()
    .some((column) => column.name === 'score')
)
  db.exec('ALTER TABLE library ADD COLUMN score REAL');

export const get = (sql, ...values) => db.prepare(sql).get(...values);
export const all = (sql, ...values) => db.prepare(sql).all(...values);
export const run = (sql, ...values) => db.prepare(sql).run(...values);
export function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = callback();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export const now = () => new Date().toISOString();
