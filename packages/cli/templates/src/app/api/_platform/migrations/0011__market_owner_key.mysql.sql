-- 0011__market_owner_key（mysql 方言）：无部分唯一索引需求，普通唯一键即可。
CREATE TABLE market_owner_key (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  key_id VARCHAR(128) NOT NULL,
  public_key TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY ux_market_owner_key_id (key_id),
  KEY idx_market_owner_key_user (user_id)
);
