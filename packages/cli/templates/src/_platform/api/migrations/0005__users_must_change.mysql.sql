-- users 增 must_change 的 mysql 方言覆盖（oj-wiki 0006 先例逐字同型）。
-- 差异：整型列取 BIGINT（与 users id 同宽度口径）。
ALTER TABLE users ADD COLUMN must_change BIGINT NOT NULL DEFAULT 0;
