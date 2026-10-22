INSERT INTO settings (key, value) VALUES ('nickname', 'AIOVTUE-雪')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value) VALUES ('avatar', '/img/toux.mp4')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
