-- refresh token 存储 mysql 方言覆盖（sqlite 版见 0008__sys_refresh_token.sql；oj-wiki 先例同型）。
-- 差异：整型列取 BIGINT；CREATE INDEX 无 IF NOT EXISTS（迁移账本一次应用语义兜底）。
CREATE TABLE IF NOT EXISTS sys_refresh_token (
  token_hash VARCHAR(255) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_sys_refresh_token_user ON sys_refresh_token (user_id);
