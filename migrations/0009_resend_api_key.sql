-- Resend API key stored encrypted in settings (AES-GCM via ADMIN_TOKEN_SECRET / ADMIN_PASSWORD)
INSERT OR IGNORE INTO settings (key, value) VALUES ('resend_api_key', '');
