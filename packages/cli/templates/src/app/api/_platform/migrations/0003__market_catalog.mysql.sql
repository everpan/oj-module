-- 0003__market_catalog（mysql 方言）：列语义同 0003__market_catalog.sql 头注释。
-- 差异（沿用 0002 既有惯例）：短文本收窄 VARCHAR；签名 value ≤ 255  base64 够用。
ALTER TABLE market_release ADD COLUMN sig_alg VARCHAR(16);
ALTER TABLE market_release ADD COLUMN sig_value VARCHAR(255);
ALTER TABLE market_release ADD COLUMN sig_public_key VARCHAR(64);
ALTER TABLE market_release ADD COLUMN manifest TEXT;
