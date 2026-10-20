-- Diligências Magalhães — camada operacional D1
-- Este schema não substitui o XLSX oficial; ele serve como índice rápido/cache operacional.

CREATE TABLE IF NOT EXISTS process_index (
  processo TEXT PRIMARY KEY,
  row_id INTEGER,
  cliente TEXT,
  adverso TEXT,
  comarca TEXT,
  vara TEXT,
  responsavel TEXT,
  status TEXT,
  prioridade TEXT,
  proxima_acao TEXT,
  proxima_data TEXT,
  atualizado_em TEXT,
  risk_score INTEGER DEFAULT 0,
  source_version INTEGER DEFAULT 1,
  source_updated_at TEXT,
  indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_process_owner ON process_index(responsavel);
CREATE INDEX IF NOT EXISTS idx_process_client ON process_index(cliente);
CREATE INDEX IF NOT EXISTS idx_process_status ON process_index(status);
CREATE INDEX IF NOT EXISTS idx_process_next_date ON process_index(proxima_data);
CREATE INDEX IF NOT EXISTS idx_process_risk ON process_index(risk_score DESC);

CREATE TABLE IF NOT EXISTS datajud_state (
  processo TEXT PRIMARY KEY,
  latest_movement_at TEXT,
  latest_movement_name TEXT,
  insight_level TEXT,
  insight_label TEXT,
  suggested_status TEXT,
  suggested_action TEXT,
  payload_json TEXT,
  checked_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  processo TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  description TEXT,
  suggested_action TEXT,
  fingerprint TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_process ON inbox(processo);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
