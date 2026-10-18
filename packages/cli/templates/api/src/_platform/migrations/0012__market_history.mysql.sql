-- market_history mysql 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：AUTOINCREMENT → BIGINT AUTO_INCREMENT；TEXT 列按业务长度收窄为 VARCHAR；
-- created_at 用 BIGINT（秒级 epoch）。
CREATE TABLE IF NOT EXISTS market_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  solution VARCHAR(255) NOT NULL,
  version VARCHAR(255) NOT NULL,
  action VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  operator VARCHAR(255),
  message TEXT,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
