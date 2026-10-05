UPDATE settings SET value = '/img/toux.webp' WHERE key = 'avatar' AND (value = '/img/toux.mp4' OR value = '');
INSERT INTO settings (key, value)
SELECT 'avatar', '/img/toux.webp'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'avatar');
