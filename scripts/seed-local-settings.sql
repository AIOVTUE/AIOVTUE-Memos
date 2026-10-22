-- 仅本地：把设置页字段写成模版占位数据（不含管理员账号）。
-- npx wrangler d1 execute aiovtue-memos --local --file=./scripts/seed-local-settings.sql
-- 禁止 --remote

INSERT INTO settings (key, value) VALUES ('nickname', 'AIOVTUE-雪')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('site_title', '动态')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('site_description', '记录生活的点滴')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('avatar', '/img/toux.webp')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('cover', '/hero/hero-1.mp4')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;

INSERT INTO settings (key, value) VALUES ('admin_email', 'you@example.com')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('mail_from', 'onboarding@resend.dev')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('mail_from_name', '动态通知')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('site_url', 'https://aiovtue-memos.xxx.workers.dev')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('notify_enabled', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('resend_api_key', '')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;

INSERT INTO settings (key, value) VALUES ('cors_origins', 'https://your-blog.example.com,http://127.0.0.1:1313')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('page_likes_enabled', '0')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;

INSERT INTO settings (key, value) VALUES ('webdav_url', 'https://dav.example.com/dav')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('webdav_username', 'your-webdav-user')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('webdav_password', '')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('webdav_folder', 'AIOVTUE-memos')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('webdav_interval', 'daily')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('webdav_enabled', '0')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('webdav_last_backup_at', '')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('webdav_last_error', '')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;

INSERT INTO settings (key, value) VALUES (
  'mail_tpl_comment_subject',
  '【{{site_title}}】{{event}}：{{author}}'
) ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES (
  'mail_tpl_comment_body',
  '{{nickname}}，你好：

动态收到{{event}}。
动态：{{post}}
评论者：{{author}}
内容：{{content}}

查看：{{link}}'
) ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES (
  'mail_tpl_reply_subject',
  '【{{site_title}}】{{author}} 回复了你'
) ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES (
  'mail_tpl_reply_body',
  '{{parent_author}}：

{{author}} 回复了你的评论。
动态：{{post}}
回复：{{content}}

查看：{{link}}'
) ON CONFLICT(key) DO UPDATE SET value = excluded.value;
