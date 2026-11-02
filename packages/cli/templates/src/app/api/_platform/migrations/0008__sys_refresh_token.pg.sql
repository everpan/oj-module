-- refresh token 存储 pg 方言覆盖（sqlite 版见 0008__sys_refresh_token.sql；oj-wiki 先例同型）。
-- 差异：无（TEXT 主键与 CREATE INDEX IF NOT EXISTS pg 原生支持，与 sqlite 同语法）。
CREATE TABLE IF NOT EXISTS sys_refresh_token (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sys_refresh_token_user ON sys_refresh_token (user_id);
