-- market_history pg 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：AUTOINCREMENT → BIGSERIAL；TEXT 在 pg 合法，保留 TEXT。
CREATE TABLE IF NOT EXISTS market_history (
  id BIGSERIAL PRIMARY KEY,
  solution TEXT NOT NULL,
  version TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  operator TEXT,
  message TEXT,
  created_at BIGINT NOT NULL
);
