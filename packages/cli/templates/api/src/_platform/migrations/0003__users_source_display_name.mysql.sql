-- users 扩展列 mysql 方言覆盖（oj-wiki 0005/0006 先例同型）。
-- 差异：TEXT 默认值写表达式 DEFAULT ('local')；DROP COLUMN mysql 8 原生支持，与基线同语法。
ALTER TABLE users ADD COLUMN source TEXT NOT NULL DEFAULT ('local');
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users DROP COLUMN roles;
