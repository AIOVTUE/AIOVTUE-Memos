INSERT OR IGNORE INTO settings (key, value) VALUES ('mail_from', '');

UPDATE settings
SET value = COALESCE(
  (SELECT value FROM settings AS s WHERE s.key = 'mail_from_resend' AND s.value != ''),
  (SELECT value FROM settings AS s WHERE s.key = 'mail_from_cf' AND s.value != ''),
  value
)
WHERE key = 'mail_from' AND value = '';
