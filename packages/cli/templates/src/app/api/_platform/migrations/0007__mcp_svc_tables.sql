-- MCP 机器人凭据三表（mcp-bot-guide.md / api-manual §14，oj v0.1.130）。
-- 列名即契约：oj serve 的 SvcGate（dispatch.rs）静态 SQL 直查 oj_svc_token.jti——改列必须
-- 三处同步（本文件 / schema.yaml / 消费端 system、auth handler）。
-- 三表自 v0.1.130 起为**租户表**（tenant_id 首列，sql_guard 自动按当前租户注入），
-- svc 凭据按租户隔离、绑定/审计随租户归属，不再挂 shared_allow（详见 schema.yaml）。
CREATE TABLE IF NOT EXISTS oj_svc_token (
  tenant_id TEXT NOT NULL,
  jti TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oj_bot_binding (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_used_at INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, provider, external_sub)
);
CREATE TABLE IF NOT EXISTS oj_obo_audit (
  tenant_id TEXT NOT NULL,
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  svc TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);
