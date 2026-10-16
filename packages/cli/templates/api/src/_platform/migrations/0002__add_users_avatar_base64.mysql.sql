-- users 补 avatar_base64 的 mysql 方言覆盖（oj-wiki 0002 先例逐字同型）。
-- 差异：TEXT 列默认值必须写成表达式 DEFAULT ('')。
ALTER TABLE users ADD COLUMN avatar_base64 TEXT NOT NULL DEFAULT ('');
