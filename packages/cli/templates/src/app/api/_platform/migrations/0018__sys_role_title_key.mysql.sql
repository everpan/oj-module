-- 0018__sys_role_title_key（mysql 方言）：列语义同 0018__sys_role_title_key.sql 头注释（R2 回填）。
ALTER TABLE sys_role ADD COLUMN title_key TEXT NULL;
UPDATE sys_role SET title_key = title WHERE builtin = 0 AND title REGEXP '^[a-z][A-Za-z0-9_-]*:';
