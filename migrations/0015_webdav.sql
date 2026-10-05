-- WebDAV backup defaults (values live in settings KV-style table)
INSERT OR IGNORE INTO settings (key, value) VALUES ('webdav_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('webdav_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('webdav_username', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('webdav_folder', 'hugo-memos');
INSERT OR IGNORE INTO settings (key, value) VALUES ('webdav_interval', 'daily');
