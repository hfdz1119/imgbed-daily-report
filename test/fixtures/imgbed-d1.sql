-- Local test fixture only. Never run this file against an ImgBed production database.
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  metadata TEXT NOT NULL,
  file_size TEXT,
  timestamp INTEGER,
  channel TEXT,
  channel_name TEXT
);

INSERT OR REPLACE INTO files (id, metadata, file_size, timestamp, channel, channel_name) VALUES
  ('sample-tg.jpg', '{"FileSizeBytes":1048576}', '1.00', 1787284800000, 'TelegramNew', 'TG-A'),
  ('sample-s3.png', '{"FileSizeBytes":2097152}', '2.00', 1787288400000, 'S3', 'MinIO'),
  ('sample-legacy.webp', '{}', '0.50', 1787292000000, 'Telegram', NULL),
  ('upload_session_sample', '{}', NULL, NULL, NULL, NULL);
