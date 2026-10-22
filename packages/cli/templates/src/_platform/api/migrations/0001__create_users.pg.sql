-- users 表 pg 方言覆盖（方言覆盖文件必胜，oj-bin docs/migration.md §3.1；约定同 oj-wiki 先例）。
-- 差异：AUTOINCREMENT → BIGSERIAL（GENERATED ALWAYS 系显式插值受限，SERIAL 系允许 seed 显式 id）；
-- username TEXT UNIQUE 在 pg 合法，保留 TEXT。
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]'
);
