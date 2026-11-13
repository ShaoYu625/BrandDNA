CREATE TABLE IF NOT EXISTS app_objects (
    key TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0 AND size <= 5242880),
    etag TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_object_chunks (
    object_key TEXT NOT NULL REFERENCES app_objects(key) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    body BLOB NOT NULL CHECK (length(body) <= 131072),
    PRIMARY KEY (object_key, chunk_index)
);
CREATE TABLE IF NOT EXISTS app_storage_usage (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    bytes_used INTEGER NOT NULL CHECK (bytes_used >= 0 AND bytes_used <= 52428800)
);
INSERT OR IGNORE INTO app_storage_usage (id, bytes_used) VALUES (1, 0);
