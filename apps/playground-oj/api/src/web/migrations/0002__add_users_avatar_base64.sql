-- users 表补 avatar_base64：personal-center 头像上传回写（multipart→base64 data URL）。
-- 该列此前缺失，upload 端点 UPDATE 必报 no such column（2026-09-11 模板同步时发现）。
ALTER TABLE users ADD COLUMN avatar_base64 TEXT NOT NULL DEFAULT '';
