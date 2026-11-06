-- 0002__market_release（postgres 方言）：列语义同 0002__market_release.sql 头注释。
-- 差异（沿用 _platform 基线的既有惯例）：TEXT 全保留，秒级 epoch 取 BIGINT。
CREATE TABLE IF NOT EXISTS market_release (
  id BIGSERIAL PRIMARY KEY,
  product TEXT NOT NULL,
  version TEXT NOT NULL,
  key_id TEXT,
  sha256 TEXT,
  size BIGINT,
  published_at BIGINT NOT NULL,
  published_at_source TEXT NOT NULL,
  yanked INTEGER NOT NULL DEFAULT 0,
  first_seen_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_market_release_version ON market_release (product, version);
CREATE INDEX IF NOT EXISTS idx_market_release_published ON market_release (published_at);
