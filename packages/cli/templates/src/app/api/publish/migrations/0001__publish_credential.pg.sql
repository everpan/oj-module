-- 0001__publish_credential（postgres 方言）：列语义同 0001__publish_credential.sql 头注释。
-- 差异（沿用 _platform 基线的既有惯例）：TEXT 全保留，秒级 epoch 取 BIGINT。
CREATE TABLE IF NOT EXISTS publish_credential (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  uid BIGINT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  product TEXT NOT NULL,
  key_id TEXT NOT NULL,
  owner_tenant TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  used_at BIGINT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  created_ip TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_publish_credential_token ON publish_credential (token_hash);
CREATE INDEX IF NOT EXISTS idx_publish_credential_owner
  ON publish_credential (owner_tenant, uid, created_at);
CREATE INDEX IF NOT EXISTS idx_publish_credential_key ON publish_credential (key_id);
