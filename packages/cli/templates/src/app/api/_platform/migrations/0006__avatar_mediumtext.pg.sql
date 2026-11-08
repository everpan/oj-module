-- 0006__avatar_mediumtext（pg 方言）：TEXT 无长度上限，保持等价。
--
-- 显式 ALTER 只为在迁移账本留下同版本的审计记录，列类型不变。
ALTER TABLE users ALTER COLUMN avatar_base64 TYPE TEXT;
