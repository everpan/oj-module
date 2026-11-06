-- 0003__market_catalog（postgres 方言）：列语义同 0003__market_catalog.sql 头注释。
-- 差异（沿用 0002 既有惯例）：TEXT 全保留。
ALTER TABLE market_release ADD COLUMN sig_alg TEXT;
ALTER TABLE market_release ADD COLUMN sig_value TEXT;
ALTER TABLE market_release ADD COLUMN sig_public_key TEXT;
ALTER TABLE market_release ADD COLUMN manifest TEXT;
