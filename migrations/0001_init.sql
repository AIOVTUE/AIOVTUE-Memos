-- 站点设置（头像、昵称、封面等）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('nickname', 'AIOVTUE-雪'),
  ('avatar', '/img/toux.mp4'),
  ('cover', '/hero/hero-1.mp4'),
  ('site_title', '动态'),
  ('site_description', '记录生活的点滴'),
  ('bio', '');

-- 动态
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

-- 评论
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL DEFAULT '',
  author_url TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);

-- 点赞（client_id 标识访客，无需登录）
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(post_id, client_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);
