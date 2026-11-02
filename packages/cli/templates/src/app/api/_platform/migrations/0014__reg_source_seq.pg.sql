-- reg_source_seq pg 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：INTEGER → BIGINT（seq 单调长期累加）；TEXT 在 pg 合法，保留 TEXT。
CREATE TABLE IF NOT EXISTS reg_source_seq (
  source_url TEXT NOT NULL PRIMARY KEY,
  max_seq BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
