-- users 增 is_forbidden 的 mysql 方言覆盖（oj-wiki 0005 先例逐字同型）。
-- 差异：整型列取 BIGINT（与 users id 同宽度口径）。
ALTER TABLE users ADD COLUMN is_forbidden BIGINT NOT NULL DEFAULT 0;
