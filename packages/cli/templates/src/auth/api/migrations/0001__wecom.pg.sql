-- 企微代开发三表 pg 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：INTEGER → BIGINT（秒级 epoch）；TEXT 在 pg 合法，主键/密文列保留 TEXT。
CREATE TABLE IF NOT EXISTS wecom_app_profile (
  suite_id TEXT NOT NULL,
  corp_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  auth_corp_id TEXT NOT NULL,
  env TEXT NOT NULL DEFAULT 'prod',
  corp_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  permanent_code_enc TEXT NOT NULL,
  installed_at BIGINT NOT NULL,
  update_time BIGINT NOT NULL,
  PRIMARY KEY (suite_id, corp_id, agent_id)
);

CREATE TABLE IF NOT EXISTS wecom_suite_ticket (
  suite_id TEXT NOT NULL PRIMARY KEY,
  suite_ticket TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  update_time BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS wecom_login_ticket (
  ticket_hash TEXT NOT NULL PRIMARY KEY,
  uid BIGINT NOT NULL,
  owner_tenant TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wecom_login_ticket_expires ON wecom_login_ticket (expires_at);
