-- users 表 mysql 方言覆盖（方言覆盖文件必胜，通用文件兜底，oj-bin docs/migration.md §3.1；约定同 oj-wiki 先例）。
-- 差异：AUTOINCREMENT → BIGINT AUTO_INCREMENT；username TEXT 改 VARCHAR(255)（mysql TEXT 不能带 UNIQUE）；
-- roles TEXT 默认值写表达式 DEFAULT ('[]')（mysql ≥8.0.13 对 TEXT/BLOB 只允许表达式默认值）。
CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT ('[]')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
