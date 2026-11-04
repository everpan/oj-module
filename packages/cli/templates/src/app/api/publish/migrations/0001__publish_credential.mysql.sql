-- 0001__publish_credential（mysql 方言）：列语义同 0001__publish_credential.sql 头注释。
-- 差异（沿用 _platform 基线的既有惯例）：键列/短文本收窄为 VARCHAR；秒级 epoch 取 BIGINT；
-- 索引写在 CREATE TABLE 内（mysql 无 CREATE INDEX IF NOT EXISTS）。
CREATE TABLE IF NOT EXISTS publish_credential (
  token_hash VARCHAR(255) PRIMARY KEY,
  token_hint VARCHAR(64) NOT NULL,
  uid BIGINT NOT NULL,
  username VARCHAR(255) NOT NULL,
  display_name TEXT,
  product VARCHAR(255) NOT NULL,
  key_id VARCHAR(255) NOT NULL,
  owner_tenant VARCHAR(255) NOT NULL,
  expires_at BIGINT NOT NULL,
  used BIGINT NOT NULL DEFAULT 0,
  used_at BIGINT,
  revoked BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  created_ip VARCHAR(64),
  KEY idx_publish_credential_owner (owner_tenant, uid, created_at),
  KEY idx_publish_credential_key (key_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
