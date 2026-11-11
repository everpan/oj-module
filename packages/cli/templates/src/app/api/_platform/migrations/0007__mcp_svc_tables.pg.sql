-- 0007__mcp_svc_tables（pg 方言覆盖）：自增用 BIGSERIAL，时间列 BIGINT。
-- 与 sqlite 基础件 / schema.yaml 列名逐列一致（templates-migration-schema-parity 守 m-1/m-4）。
CREATE TABLE IF NOT EXISTS oj_svc_token (
  tenant_id TEXT NOT NULL,
  jti TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS oj_bot_binding (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_used_at BIGINT NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, provider, external_sub)
);
CREATE TABLE IF NOT EXISTS oj_obo_audit (
  tenant_id TEXT NOT NULL,
  id BIGSERIAL PRIMARY KEY,
  svc TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ts BIGINT NOT NULL
);
