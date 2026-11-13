PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    location TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    input_kind TEXT NOT NULL,
    title TEXT,
    url TEXT,
    original_filename TEXT,
    raw_path TEXT,
    mime_type TEXT,
    status TEXT NOT NULL DEFAULT 'stored',
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (brand_id) REFERENCES brands(id)
);

CREATE TABLE IF NOT EXISTS extraction_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    brand_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    extracted_text TEXT,
    artifact_path TEXT,
    error TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES raw_sources(id),
    FOREIGN KEY (brand_id) REFERENCES brands(id)
);

CREATE TABLE IF NOT EXISTS analysis_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    brand_id INTEGER NOT NULL,
    analysis_type TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES raw_sources(id),
    FOREIGN KEY (brand_id) REFERENCES brands(id)
);

CREATE TABLE IF NOT EXISTS brand_dna_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    manual_overrides_json TEXT,
    source_result_ids_json TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (brand_id) REFERENCES brands(id)
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (brand_id) REFERENCES brands(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL,
    job_id INTEGER,
    artifact_type TEXT NOT NULL,
    title TEXT,
    payload_json TEXT,
    file_path TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (brand_id) REFERENCES brands(id),
    FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS subscription_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    account_key TEXT NOT NULL,
    plan TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_key TEXT NOT NULL,
    brand_id INTEGER NOT NULL,
    feature TEXT NOT NULL,
    plan TEXT NOT NULL,
    units INTEGER NOT NULL DEFAULT 1,
    period_start TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (brand_id) REFERENCES brands(id)
);

CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER,
    job_id INTEGER,
    source_id INTEGER,
    request_id TEXT,
    level TEXT NOT NULL,
    event_type TEXT NOT NULL,
    stage TEXT,
    message TEXT NOT NULL,
    details_json TEXT,
    duration_ms INTEGER,
    error TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_sources_brand ON raw_sources(brand_id, id);
CREATE INDEX IF NOT EXISTS idx_extraction_source ON extraction_results(source_id, id);
CREATE INDEX IF NOT EXISTS idx_analysis_source ON analysis_results(source_id, id);
CREATE INDEX IF NOT EXISTS idx_jobs_brand ON jobs(brand_id, id);
CREATE INDEX IF NOT EXISTS idx_artifacts_brand ON artifacts(brand_id, id);
CREATE INDEX IF NOT EXISTS idx_usage_week ON usage_events(account_key, brand_id, period_start, feature);
CREATE INDEX IF NOT EXISTS idx_system_logs_job ON system_logs(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_source ON system_logs(source_id, created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level, created_at);

INSERT OR IGNORE INTO brands
(id, handle, name, category, location, description, created_at, updated_at)
VALUES
(1, 'zao_shih', '沒事早事坐', '台式早午餐', '台北市', '示範用餐飲品牌，用於 BrandDNA 分析、內容生成與風險檢查流程。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO subscription_state
(id, account_key, plan, updated_at)
VALUES
(1, 'demo', 'AIR', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
