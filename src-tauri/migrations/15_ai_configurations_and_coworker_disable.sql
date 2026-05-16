-- Pro v2 desktop — multi-config BYOK + coworker disable-on-lapse
-- Pure additive. ai_configurations table holds non-secret config rows;
-- API keys remain in OS keychain (CredentialStore trait per platform).
-- Each row's keychain account name = `ai_config:<id>` under the existing
-- "Clauge AI" service.

CREATE TABLE IF NOT EXISTS ai_configurations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT NOT NULL,
    provider        TEXT NOT NULL,
    base_url        TEXT,
    default_model   TEXT,
    is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at    TEXT
);

-- At most one row is the default at any time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_config_default
    ON ai_configurations(is_default) WHERE is_default = 1;

-- Coworkers gating: when sub lapses, stamp disabled_at on coworkers
-- beyond first 3 (by created_at). NULL = active; non-NULL = grayed out
-- in UI, blocked at MCP layer.
ALTER TABLE workspace_coworkers ADD COLUMN disabled_at TEXT;
