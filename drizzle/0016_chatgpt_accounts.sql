ALTER TABLE users ADD COLUMN chatgpt_id TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX users_chatgpt_id_unique ON users(chatgpt_id);
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password';
--> statement-breakpoint
CREATE TABLE chatgpt_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  session_hash TEXT,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
