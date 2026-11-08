-- 0006__avatar_mediumtext（mysql 方言）：users.avatar_base64 TEXT → MEDIUMTEXT。
--
-- 背景（2026-11-08 实锤）：企微头像按 data URL 落库（base64 后通常 60-200KB），超过
-- TEXT 的 65535 字节上限，写入报 1406 (22001) Data too long，头像永远为空；
-- 个人中心上传 >48KB 的图同样会踩。MEDIUMTEXT 上限 16MB，覆盖 10MB 上传闸。
-- 保留原 NOT NULL 与表达式默认值（mysql ≥8.0.13 允许 TEXT 系表达式默认，基线已按此写）。
ALTER TABLE users MODIFY avatar_base64 MEDIUMTEXT NOT NULL DEFAULT ('');
