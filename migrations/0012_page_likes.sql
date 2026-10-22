CREATE TABLE IF NOT EXISTS page_likes (
  path TEXT PRIMARY KEY,
  like_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS page_like_clients (
  path TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (path, client_id)
);

CREATE INDEX IF NOT EXISTS idx_page_likes_updated_at ON page_likes(updated_at DESC);

INSERT OR IGNORE INTO settings (key, value) VALUES ('page_like_password_hash', '');
