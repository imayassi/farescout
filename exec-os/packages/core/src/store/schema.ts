/** SQLite schema. Migrations are applied in order; each is idempotent-ish via user_version. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS evidence (
    evidence_id   TEXT PRIMARY KEY,
    provider_id   TEXT NOT NULL,
    source_type   TEXT NOT NULL,
    occurred_at   TEXT NOT NULL,
    retrieved_at  TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    thread_id     TEXT,
    content_hash  TEXT NOT NULL,
    payload       TEXT NOT NULL,          -- full Evidence JSON (text subject to retention)
    analyzed_at   TEXT                    -- null until included in an analysis batch
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_occurred ON evidence(occurred_at);
  CREATE INDEX IF NOT EXISTS idx_evidence_provider ON evidence(provider_id, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence(content_hash);
  CREATE INDEX IF NOT EXISTS idx_evidence_analyzed ON evidence(analyzed_at);

  CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(
    evidence_id UNINDEXED, title, text, participants, tokenize='porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL, payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS objects (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,                 -- action | decision | escalation | risk | recommendation | data_request | signal | metric
    theme_id TEXT,
    status TEXT,
    owner TEXT,
    epistemic TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_observed TEXT NOT NULL,
    due_at TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    fingerprint TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type, status);
  CREATE INDEX IF NOT EXISTS idx_objects_theme ON objects(theme_id);
  CREATE INDEX IF NOT EXISTS idx_objects_updated ON objects(updated_at);
  CREATE INDEX IF NOT EXISTS idx_objects_fp ON objects(fingerprint);

  CREATE TABLE IF NOT EXISTS object_evidence (
    object_id TEXT NOT NULL, evidence_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'supports',
    excerpt TEXT, PRIMARY KEY (object_id, evidence_id)
  );
  CREATE INDEX IF NOT EXISTS idx_oe_evidence ON object_evidence(evidence_id);

  CREATE TABLE IF NOT EXISTS theme_evidence (
    theme_id TEXT NOT NULL, evidence_id TEXT NOT NULL, PRIMARY KEY (theme_id, evidence_id)
  );

  CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY, horizon TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
    generated_at TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_summaries ON summaries(horizon, generated_at);

  CREATE TABLE IF NOT EXISTS journal (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
    event TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_journal_at ON journal(at);
  CREATE INDEX IF NOT EXISTS idx_journal_obj ON journal(object_type, object_id);

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
    kind TEXT NOT NULL, payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suppressions (
    fingerprint TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, reason TEXT
  );

  CREATE TABLE IF NOT EXISTS aliases (
    alias_id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL, at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    provider_id TEXT PRIMARY KEY, payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_registry (
    provider_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stakeholders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stakeholders_name ON stakeholders(name);

  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `,
  `
  CREATE TABLE IF NOT EXISTS bucket_skills (
    id TEXT PRIMARY KEY, theme_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
    generated_at TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bucket_skills_theme ON bucket_skills(theme_id, version);

  CREATE TABLE IF NOT EXISTS excluded_evidence (
    evidence_id TEXT PRIMARY KEY, content_hash TEXT, at TEXT NOT NULL, reason TEXT
  );
  `,
];
