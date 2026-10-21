CREATE TABLE chat_channels (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '', creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN channel_id TEXT REFERENCES chat_channels(id);
--> statement-breakpoint
CREATE INDEX chat_channels_creator_time ON chat_channels(creator_id,created_at);
--> statement-breakpoint
CREATE INDEX messages_channel_room ON messages(channel_id,room_id);
--> statement-breakpoint
CREATE INDEX messages_user_time ON messages(user_id,created_at);
