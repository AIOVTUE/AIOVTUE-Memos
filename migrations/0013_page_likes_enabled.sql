INSERT OR IGNORE INTO settings (key, value) VALUES ('page_likes_enabled', '0');

UPDATE settings
SET value = '1'
WHERE key = 'page_likes_enabled'
  AND EXISTS (
    SELECT 1 FROM settings AS s
    WHERE s.key = 'page_like_password_hash' AND TRIM(s.value) != ''
  );
