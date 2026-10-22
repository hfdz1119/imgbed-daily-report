-- Local test fixture only. Never run this file against an ImgBed production database.
-- `files` schema mirrors CloudFlare-ImgBed v2.7.6 database/init.sql:
-- https://github.com/MarSeventh/CloudFlare-ImgBed/blob/v2.7.6/database/init.sql
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    value TEXT,
    metadata TEXT NOT NULL,
    file_name TEXT,
    file_type TEXT,
    file_size TEXT,
    upload_ip TEXT,
    upload_address TEXT,
    list_type TEXT,
    timestamp INTEGER,
    label TEXT,
    directory TEXT,
    channel TEXT,
    channel_name TEXT,
    tg_file_id TEXT,
    tg_chat_id TEXT,
    tg_bot_token TEXT,
    is_chunked BOOLEAN DEFAULT FALSE,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_files_timestamp ON files(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_files_directory ON files(directory);
CREATE INDEX IF NOT EXISTS idx_files_channel ON files(channel);
CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type);
CREATE INDEX IF NOT EXISTS idx_files_upload_ip ON files(upload_ip);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_tags ON files(tags);

INSERT INTO files (id, metadata, file_size, timestamp, channel, channel_name) VALUES
  ('sample-tg.jpg', '{"FileSizeBytes":1048576}', '1.00', 1787284800000, 'TelegramNew', 'TG-A'),
  ('sample-s3.png', '{"FileSizeBytes":2097152}', '2.00', 1787288400000, 'S3', 'MinIO'),
  ('sample-legacy.webp', '{}', '0.50', 1787292000000, 'Telegram', NULL),
  ('upload_session_sample', '{}', NULL, NULL, NULL, NULL);
