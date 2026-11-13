DROP INDEX IF EXISTS idx_usage_week;

ALTER TABLE usage_events RENAME TO usage_events_old;

CREATE TABLE usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    brand_id INTEGER NOT NULL,
    feature TEXT NOT NULL,
    plan TEXT NOT NULL,
    units INTEGER NOT NULL DEFAULT 1,
    period_start TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (brand_id) REFERENCES brands(id)
);

INSERT INTO usage_events
(id, run_id, brand_id, feature, plan, units, period_start, metadata_json, created_at)
SELECT
    id,
    'legacy-demo',
    brand_id,
    feature,
    plan,
    units,
    period_start,
    metadata_json,
    created_at
FROM usage_events_old;

DROP TABLE usage_events_old;
DROP TABLE IF EXISTS subscription_state;

CREATE INDEX IF NOT EXISTS idx_usage_run_week ON usage_events(run_id, brand_id, period_start, feature);
CREATE INDEX IF NOT EXISTS idx_usage_global_week ON usage_events(brand_id, period_start);
