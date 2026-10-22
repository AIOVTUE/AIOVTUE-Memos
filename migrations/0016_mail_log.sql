CREATE TABLE IF NOT EXISTS mail_log (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_log_sent_at ON mail_log(sent_at DESC);
