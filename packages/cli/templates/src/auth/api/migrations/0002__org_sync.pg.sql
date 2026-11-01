-- 企微组织架构同步 pg 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：INTEGER → BIGINT（秒级 epoch / 毫秒标记）；TEXT 在 pg 合法，键列保留 TEXT。
ALTER TABLE wecom_app_profile ADD COLUMN auth_mode BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS wecom_sync_job (
  tenant_id TEXT NOT NULL,
  corp_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  phase TEXT NOT NULL DEFAULT 'departments',
  cursor_text TEXT,
  stats_text TEXT,
  err_code TEXT,
  err_detail TEXT,
  started_at BIGINT NOT NULL DEFAULT 0,
  finished_at BIGINT NOT NULL DEFAULT 0,
  update_time BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
);

CREATE TABLE IF NOT EXISTS wecom_sync_lock (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  taken_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
);
