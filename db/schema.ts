import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';

export const catalogPages = sqliteTable('catalog_pages', {
  query_key: text().primaryKey(),
  payload: text().notNull(),
  fetched_at: integer().notNull(),
});
export const catalogMedia = sqliteTable('catalog_media', {
  id: text().primaryKey(),
  payload: text().notNull(),
  fetched_at: integer().notNull(),
});

export const users = sqliteTable('users', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().unique(),
  password_hash: text(),
  discord_id: text().unique(),
  avatar: text().notNull().default(''),
  created_at: text().notNull(),
});
export const sessions = sqliteTable(
  'sessions',
  {
    token_hash: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires_at: integer().notNull(),
    created_at: integer().notNull(),
  },
  (t) => [index('sessions_user_expiry').on(t.user_id, t.expires_at)],
);
export const oauthStates = sqliteTable('oauth_states', {
  state_hash: text().primaryKey(),
  expires_at: integer().notNull(),
  user_id: text(),
  session_hash: text(),
});
export const malConnections = sqliteTable('mal_connections', {
  user_id: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mal_user_id: text().notNull(),
  username: text().notNull(),
  tokens_cipher: text().notNull(),
  connection_version: text().notNull(),
  connected_at: text().notNull(),
  last_synced_at: text(),
  sync_claim: text(),
  sync_expires_at: integer(),
});
export const malStates = sqliteTable('mal_oauth_states', {
  state_hash: text().primaryKey(),
  user_id: text()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  session_hash: text().notNull(),
  verifier_cipher: text().notNull(),
  expires_at: integer().notNull(),
  claim: text(),
});
export const library = sqliteTable(
  'library',
  {
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    media_id: text().notNull(),
    favorite: integer().notNull().default(0),
    status: text().notNull().default('planned'),
    progress: real().notNull().default(0),
    score: real(),
    updated_at: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.media_id] })],
);
export const reviews = sqliteTable(
  'reviews',
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    media_id: text().notNull(),
    rating: integer().notNull(),
    title: text().notNull().default(''),
    body: text().notNull(),
    spoiler: integer().notNull().default(0),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [
    uniqueIndex('reviews_user_media').on(t.user_id, t.media_id),
    index('reviews_media_updated').on(t.media_id, t.updated_at),
    check('rating_range', sql`${t.rating} BETWEEN 1 AND 10`),
  ],
);
export const comments = sqliteTable(
  'comments',
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    media_id: text().notNull(),
    unit: integer().notNull().default(0),
    parent_id: text().references((): any => comments.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    spoiler: integer().notNull().default(0),
    created_at: text().notNull(),
  },
  (t) => [index('comments_media_unit').on(t.media_id, t.unit, t.created_at)],
);
export const votes = sqliteTable(
  'comment_votes',
  {
    comment_id: text()
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.comment_id, t.user_id] }),
    check('vote_range', sql`${t.value} IN (-1,1)`),
  ],
);
export const rooms = sqliteTable(
  'rooms',
  {
    id: text().primaryKey(),
    host_id: text()
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    media_id: text().notNull(),
    type: text().notNull(),
    visibility: text().notNull(),
    invite_hash: text(),
    capacity: integer().notNull(),
    unit: integer().notNull().default(1),
    paused: integer().notNull().default(1),
    position: real().notNull().default(0),
    source_url: text().notNull().default(''),
    source_kind: text().notNull().default('external'),
    version: integer().notNull().default(1),
    state_updated_at: text().notNull(),
    created_at: text().notNull(),
    closed_at: text(),
  },
  (t) => [
    index('rooms_host_open').on(t.host_id, t.closed_at),
    check('room_type', sql`${t.type} IN ('watch','read')`),
    check('room_visibility', sql`${t.visibility} IN ('public','private')`),
  ],
);
export const members = sqliteTable(
  'room_members',
  {
    room_id: text()
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joined_at: text().notNull(),
    last_seen: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.room_id, t.user_id] }),
    index('room_members_expiry').on(t.last_seen),
  ],
);
export const messages = sqliteTable(
  'messages',
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    room_id: text().references(() => rooms.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [index('messages_room_time').on(t.room_id, t.created_at)],
);
export const events = sqliteTable(
  'event_log',
  {
    sequence: integer().primaryKey({ autoIncrement: true }),
    event: text().notNull(),
    payload: text().notNull(),
    room_id: text(),
    user_id: text(),
    created_at: integer().notNull(),
  },
  (t) => [index('events_expiry').on(t.created_at)],
);
export const presence = sqliteTable(
  'presence_leases',
  {
    connection_id: text().primaryKey(),
    session_hash: text()
      .notNull()
      .references(() => sessions.token_hash, { onDelete: 'cascade' }),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    room_id: text(),
    expires_at: integer().notNull(),
  },
  (t) => [
    index('presence_expiry').on(t.expires_at),
    index('presence_user_room').on(t.user_id, t.room_id),
  ],
);
export const previews = sqliteTable(
  'favorite_previews',
  {
    token_hash: text().primaryKey(),
    session_hash: text()
      .notNull()
      .references(() => sessions.token_hash, { onDelete: 'cascade' }),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: text().notNull(),
    items: text().notNull(),
    expires_at: integer().notNull(),
    claim: text(),
  },
  (t) => [index('favorites_expiry').on(t.expires_at)],
);
export const importedMedia = sqliteTable('imported_media', {
  media_id: text().primaryKey(),
  metadata: text().notNull(),
});
export const watchViews = sqliteTable(
  'watch_views',
  {
    media_id: text().notNull(),
    visitor_hash: text().notNull(),
    last_seen: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.media_id, t.visitor_hash] }),
    index('watch_views_expiry').on(t.last_seen),
  ],
);
export const limits = sqliteTable(
  'rate_limits',
  {
    key: text().primaryKey(),
    count: integer().notNull(),
    expires_at: integer().notNull(),
  },
  (t) => [index('rate_limits_expiry').on(t.expires_at)],
);
