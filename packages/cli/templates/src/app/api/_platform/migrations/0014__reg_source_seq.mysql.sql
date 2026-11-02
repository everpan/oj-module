-- reg_source_seq mysql 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：INTEGER → BIGINT；TEXT 主键须给长度（前缀键无法承载长 URL），按 1024 收窄；
-- updated_at 用 BIGINT（秒级 epoch）。
CREATE TABLE IF NOT EXISTS reg_source_seq (
  source_url VARCHAR(1024) NOT NULL,
  max_seq BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (source_url)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
