-- MCP 机器人凭据三表（mcp-bot-guide.md / api-manual §14，oj v0.1.130）。
-- 列名即契约：oj serve 的 SvcGate（dispatch.rs）静态 SQL 直查 oj_svc_token.jti——改列必须
-- 三处同步（本文件 / schema.yaml / 消费端 system、auth handler）。
-- 三表都是共享表（tenant:false，见 schema.yaml 与 config.yaml tenant.shared_allow）：
-- svc 凭据是部署级、绑定是平台↔本系统用户的全局映射、审计按站点归口，都不该按租户割裂。
CREATE TABLE IF NOT EXISTS oj_svc_token (
  jti TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oj_bot_binding (
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_used_at INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, external_sub)
);
CREATE TABLE IF NOT EXISTS oj_obo_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  svc TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);
