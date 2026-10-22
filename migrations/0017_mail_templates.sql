-- 可自定义的评论 / 回复邮件模板（主题 + 正文）
INSERT OR IGNORE INTO settings (key, value) VALUES (
  'mail_tpl_comment_subject',
  '【{{site_title}}】{{event}}：{{author}}'
);
INSERT OR IGNORE INTO settings (key, value) VALUES (
  'mail_tpl_comment_body',
  '{{nickname}}，你好：

动态收到{{event}}。
动态：{{post}}
评论者：{{author}}
内容：{{content}}

查看：{{link}}'
);
INSERT OR IGNORE INTO settings (key, value) VALUES (
  'mail_tpl_reply_subject',
  '【{{site_title}}】{{author}} 回复了你'
);
INSERT OR IGNORE INTO settings (key, value) VALUES (
  'mail_tpl_reply_body',
  '{{parent_author}}：

{{author}} 回复了你的评论。
动态：{{post}}
回复：{{content}}

查看：{{link}}'
);
