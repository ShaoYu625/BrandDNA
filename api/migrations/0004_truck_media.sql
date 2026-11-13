-- Bounded image storage for demo accounts without an activated R2 subscription.
CREATE TABLE IF NOT EXISTS truck_media (
    id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size > 0 AND size <= 5242880),
    chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS truck_media_chunks (
    media_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    body BLOB NOT NULL CHECK (length(body) <= 131072),
    PRIMARY KEY (media_id, chunk_index),
    FOREIGN KEY (media_id) REFERENCES truck_media(id) ON DELETE CASCADE
);
