INSERT INTO settings (key, value)
SELECT 'mail_from', COALESCE(
  (SELECT value FROM settings WHERE key = 'mail_from_resend' AND value != ''),
  (SELECT value FROM settings WHERE key = 'mail_from_cf' AND value != ''),
  ''
)
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'mail_from' AND value != '');
