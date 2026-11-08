-- 0006__avatar_mediumtext（sqlite 方言）：users.avatar_base64 要放得下 base64 data URL。
--
-- 背景（2026-11-08 实锤）：企微头像下载后按 data URL 落库，超过 MySQL TEXT 的 64KB 上限，
-- 写入报 1406 (22001) Data too long，头像永远是空；个人中心上传 >48KB 的图同样会踩。
-- SQLite 的 TEXT 本身没有长度上限，这里保持空操作（留一条 0 行 UPDATE，迁移账本可审计）。
UPDATE users SET avatar_base64 = avatar_base64 WHERE 0;
