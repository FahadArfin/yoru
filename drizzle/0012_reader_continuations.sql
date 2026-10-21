CREATE TABLE reader_continuations (id TEXT PRIMARY KEY NOT NULL, owner_hash TEXT NOT NULL, destination TEXT NOT NULL, selection_fingerprint TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX reader_continuations_expiry ON reader_continuations(expires_at);
--> statement-breakpoint
CREATE TABLE reader_inventory_cache (source_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, observed_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE reader_feed_cache (media_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, observed_at INTEGER NOT NULL);
