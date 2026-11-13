-- Isolated demo workspace: legacy BrandDNA tables remain unchanged.
CREATE TABLE IF NOT EXISTS truck_workspace (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at TEXT NOT NULL
);
