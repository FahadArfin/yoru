CREATE TABLE reader_markers (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL,
 chapter_id TEXT NOT NULL,
 bookmark INTEGER,
 bookmark_at INTEGER NOT NULL DEFAULT 0,
 is_read INTEGER,
 read_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,media_id,chapter_id)
);
