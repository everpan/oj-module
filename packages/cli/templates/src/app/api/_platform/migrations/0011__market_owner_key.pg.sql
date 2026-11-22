-- 0011__market_owner_key（pg 方言）：同 sqlite 版，仅自增列方言差异（BIGSERIAL）。
CREATE TABLE market_owner_key (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  key_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_market_owner_key_id ON market_owner_key(key_id);
CREATE INDEX idx_market_owner_key_user ON market_owner_key(user_id);
