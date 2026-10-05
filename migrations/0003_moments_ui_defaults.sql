-- 对齐博客动态页默认封面与标题
INSERT INTO settings (key, value) VALUES ('cover', '/hero/hero-1.mp4')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('site_title', '动态')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('nickname', 'AIOVTUE-雪')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('avatar', '/img/toux.mp4')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
