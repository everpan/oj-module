-- 企微组织架构同步 mysql 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：TEXT 主键须给长度（按业务长度收窄为 VARCHAR）；INTEGER → BIGINT（秒级 epoch / 毫秒标记）；
-- 索引写在 CREATE TABLE 内（MySQL 无 CREATE INDEX IF NOT EXISTS）。
ALTER TABLE wecom_app_profile ADD COLUMN auth_mode BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS wecom_sync_job (
  tenant_id VARCHAR(64) NOT NULL,
  corp_id VARCHAR(64) NOT NULL,
  agent_id VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'idle',
  phase VARCHAR(16) NOT NULL DEFAULT 'departments',
  cursor_text TEXT,
  stats_text TEXT,
  err_code VARCHAR(32),
  err_detail VARCHAR(512),
  started_at BIGINT NOT NULL DEFAULT 0,
  finished_at BIGINT NOT NULL DEFAULT 0,
  update_time BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wecom_sync_lock (
  tenant_id VARCHAR(64) NOT NULL,
  agent_id VARCHAR(32) NOT NULL,
  owner VARCHAR(64) NOT NULL,
  taken_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
