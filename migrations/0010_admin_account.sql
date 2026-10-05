-- Admin account stored in settings (password hashed; token secret for HMAC / wrapping)
INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_username', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password_hash', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_token_secret', '');
