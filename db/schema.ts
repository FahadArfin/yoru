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

export const readerSources = sqliteTable(
  'reader_sources',
  {
    id: text().primaryKey().notNull(),
    integration: text().notNull(),
    upstream_source_id: text(),
    provider_key: text().notNull(),
    language: text().notNull(),
    classification: text().notNull(),
    capabilities: text().notNull(),
    bridge_instance: text(),
    updated_at: text().notNull(),
  },
  (t) => [uniqueIndex('reader_sources_upstream').on(t.integration, t.upstream_source_id)],
);
export const externalMedia = sqliteTable(
  'external_media',
  {
    id: text().primaryKey().notNull(),
    source_id: text()
      .notNull()
      .references(() => readerSources.id),
    upstream_key: text().notNull(),
    language: text().notNull(),
    classification: text().notNull(),
    metadata: text().notNull(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [uniqueIndex('external_media_canonical').on(t.source_id, t.upstream_key, t.language)],
);
export const externalEditions = sqliteTable(
  'external_editions',
  {
    id: text().primaryKey().notNull(),
    media_id: text()
      .notNull()
      .references(() => externalMedia.id),
    upstream_key: text().notNull(),
    metadata: text().notNull(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [uniqueIndex('external_editions_canonical').on(t.media_id, t.upstream_key)],
);
export const readerLocalBindings = sqliteTable(
  'reader_local_bindings',
  {
    reference_id: text().primaryKey().notNull(),
    source_id: text()
      .notNull()
      .references(() => readerSources.id),
    media_id: text().references(() => externalMedia.id),
    edition_id: text().references(() => externalEditions.id),
    kind: text().notNull(),
    bridge_instance: text().notNull(),
    local_id: text().notNull(),
    verified_at: text().notNull(),
  },
  (t) => [
    uniqueIndex('reader_bindings_local').on(t.bridge_instance, t.kind, t.local_id),
    check(
      'reader_binding_owner',
      sql`(${t.kind}='media' AND ${t.media_id} IS NOT NULL AND ${t.media_id}=${t.reference_id} AND ${t.edition_id} IS NULL) OR (${t.kind}='edition' AND ${t.edition_id} IS NOT NULL AND ${t.edition_id}=${t.reference_id} AND ${t.media_id} IS NULL)`,
    ),
  ],
);
export const readerEquivalences = sqliteTable(
  'reader_equivalences',
  {
    left_id: text().notNull(),
    right_id: text().notNull(),
    evidence: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.left_id, t.right_id] }),
    check('reader_equivalence_order', sql`${t.left_id}<${t.right_id}`),
  ],
);

export const users = sqliteTable('users', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().unique(),
  password_hash: text(),
  discord_id: text().unique(),
  chatgpt_id: text().unique(),
  avatar: text().notNull().default(''),
  created_at: text().notNull(),
});
export const forumTopics = sqliteTable(
  'forum_topics',
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    collection: text().notNull().default('yoru'),
    board: text().notNull(),
    kind: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    spoiler: integer().notNull().default(0),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [index('forum_topics_board').on(t.collection, t.board, t.created_at)],
);
export const forumReplies = sqliteTable(
  'forum_replies',
  {
    id: text().primaryKey(),
    topic_id: text()
      .notNull()
      .references(() => forumTopics.id, { onDelete: 'cascade' }),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    spoiler: integer().notNull().default(0),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [index('forum_replies_topic').on(t.topic_id, t.created_at)],
);
export const sessions = sqliteTable(
  'sessions',
  {
    token_hash: text().primaryKey(),
    auth_provider: text().notNull().default('password'),
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
export const chatgptStates = sqliteTable('chatgpt_states', {
  state_hash: text().primaryKey().notNull(),
  user_id: text(),
  session_hash: text(),
  return_path: text().notNull(),
  expires_at: integer().notNull(),
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
export const resumeProgress = sqliteTable(
  'resume_progress',
  {
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    media_id: text().notNull(),
    payload: text().notNull(),
    updated_at: integer().notNull(),
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
    edition_id: text(),
    parent_id: text().references((): any => comments.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    spoiler: integer().notNull().default(0),
    created_at: text().notNull(),
  },
  (t) => [
    index('comments_media_unit').on(t.media_id, t.unit, t.created_at),
    index('comments_media_edition').on(t.media_id, t.edition_id, t.created_at),
  ],
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
    destination: text().notNull().default('yoru'),
    reader_source_id: text(),
    reader_edition_id: text(),
    reader_provenance: text(),
    version: integer().notNull().default(1),
    state_updated_at: text().notNull(),
    created_at: text().notNull(),
    closed_at: text(),
  },
  (t) => [
    index('rooms_host_open').on(t.host_id, t.closed_at),
    index('rooms_destination_open').on(t.destination, t.closed_at),
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
export const chatChannels = sqliteTable(
  'chat_channels',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    name_key: text().notNull().unique(),
    description: text().notNull().default(''),
    creator_id: text().references(() => users.id, { onDelete: 'set null' }),
    created_at: text().notNull(),
  },
  (t) => [index('chat_channels_creator_time').on(t.creator_id, t.created_at)],
);
export const messages = sqliteTable(
  'messages',
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    room_id: text().references(() => rooms.id, { onDelete: 'cascade' }),
    channel_id: text().references(() => chatChannels.id),
    body: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [
    index('messages_room_time').on(t.room_id, t.created_at),
    index('messages_channel_room').on(t.channel_id, t.room_id),
    index('messages_user_time').on(t.user_id, t.created_at),
  ],
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
export const visitorPresence = sqliteTable(
  'visitor_presence',
  {
    visitor_hash: text().primaryKey(),
    user_id: text().references(() => users.id, { onDelete: 'cascade' }),
    session_hash: text().references(() => sessions.token_hash, { onDelete: 'cascade' }),
    activity: text().notNull(),
    last_seen: integer().notNull(),
  },
  (t) => [index('visitor_presence_seen').on(t.last_seen)],
);
export const previews = sqliteTable(
  'favorite_previews',
  {
    token_hash: text().primaryKey(),
    auth_provider: text().notNull().default('password'),
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
    category: text().notNull().default('ANIME'),
  },
  (t) => [
    primaryKey({ columns: [t.media_id, t.visitor_hash] }),
    index('watch_views_expiry').on(t.last_seen),
    index('watch_views_category_expiry').on(t.category, t.last_seen),
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

export const readerCatalogPreferences = sqliteTable(
  'reader_catalog_preferences',
  {
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    destination: text().notNull(),
    enabled: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.provider, t.destination] })],
);

export const readerSettings = sqliteTable('reader_settings', {
  user_id: text()
    .primaryKey()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  modes: text().notNull().default('{"yoru":"all","ara-ara":"all"}'),
  revision: integer().notNull().default(0),
});

export const readingAccountSnapshots = sqliteTable(
  'reading_account_snapshots',
  {
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    media_id: text().notNull(),
    record_kind: text().notNull(),
    destination: text().notNull(),
    metadata: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.user_id, t.media_id, t.record_kind] }),
    check('reading_account_kind', sql`${t.record_kind} IN ('library','resume')`),
    check('reading_account_destination', sql`${t.destination} IN ('yoru','ara-ara')`),
  ],
);

export const readerGuestContexts = sqliteTable(
  'reader_guest_contexts',
  {
    guest_hash: text().notNull(),
    destination: text().notNull(),
    selection: text().notNull(),
    revision: integer().notNull(),
    expires_at: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.guest_hash, t.destination] }),
    index('reader_guest_contexts_expiry').on(t.expires_at),
  ],
);

export const readerContinuations = sqliteTable(
  'reader_continuations',
  {
    id: text().primaryKey().notNull(),
    owner_hash: text().notNull(),
    destination: text().notNull(),
    selection_fingerprint: text().notNull(),
    payload: text().notNull(),
    expires_at: integer().notNull(),
  },
  (t) => [index('reader_continuations_expiry').on(t.expires_at)],
);
export const readerInventoryCache = sqliteTable('reader_inventory_cache', {
  source_id: text().primaryKey().notNull(),
  payload: text().notNull(),
  observed_at: integer().notNull(),
});
export const readerFeedCache = sqliteTable('reader_feed_cache', {
  media_id: text().primaryKey().notNull(),
  payload: text().notNull(),
  observed_at: integer().notNull(),
});

export const chapterOpens = sqliteTable(
  'chapter_opens',
  {
    media_id: text().notNull(),
    chapter_id: text().notNull(),
    visitor_hash: text().notNull(),
    opened_at: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.media_id, t.chapter_id, t.visitor_hash] })],
);
export const chapterRatings = sqliteTable(
  'chapter_ratings',
  {
    media_id: text().notNull(),
    chapter_id: text().notNull(),
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.media_id, t.chapter_id, t.user_id] }),
    check('chapter_rating_range', sql`${t.rating} BETWEEN 1 AND 5`),
  ],
);

export const readerMarkers = sqliteTable(
  'reader_markers',
  {
    user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    media_id: text().notNull(),
    chapter_id: text().notNull(),
    bookmark: integer(),
    bookmark_at: integer().notNull().default(0),
    is_read: integer(),
    read_at: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.media_id, t.chapter_id] })],
);
