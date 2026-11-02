-- users 表补 avatar_base64：personal-center 头像上传回写（multipart→base64 data URL）。
ALTER TABLE users ADD COLUMN avatar_base64 TEXT NOT NULL DEFAULT '';
