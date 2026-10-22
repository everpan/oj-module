-- refresh token 存储（设计 §3.1：不透明随机串，DB 存 SHA-256 哈希——A1 六表未含，B1 实现期补）。
-- 轮换作旧（revoked 标记）；reuse 检测 = 已吊销串二次出现 → 按 user_id 全族吊销 + 审计；
-- is_forbidden=1 或重置口令 → 级联删该用户全部记录（§3.1 吊销联动）。
CREATE TABLE IF NOT EXISTS sys_refresh_token (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sys_refresh_token_user ON sys_refresh_token (user_id);
