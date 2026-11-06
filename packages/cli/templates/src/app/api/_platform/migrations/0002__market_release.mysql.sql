-- 0002__market_release（mysql 方言）：列语义同 0002__market_release.sql 头注释。
-- 差异（沿用 _platform 基线的既有惯例）：键列/短文本收窄为 VARCHAR；秒级 epoch 取 BIGINT；
-- 索引写在 CREATE TABLE 内（mysql 无 CREATE INDEX IF NOT EXISTS）。
CREATE TABLE IF NOT EXISTS market_release (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  product VARCHAR(255) NOT NULL,
  version VARCHAR(255) NOT NULL,
  key_id VARCHAR(255),
  sha256 VARCHAR(64),
  size BIGINT,
  published_at BIGINT NOT NULL,
  published_at_source VARCHAR(16) NOT NULL,
  yanked BIGINT NOT NULL DEFAULT 0,
  first_seen_at BIGINT NOT NULL,
  UNIQUE KEY uk_market_release_version (product, version),
  KEY idx_market_release_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
