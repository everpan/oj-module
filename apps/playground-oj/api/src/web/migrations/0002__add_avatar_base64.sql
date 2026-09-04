-- web 模块演进（P4-3）：users 加 avatar_base64 列，承载头像上传回写（multipart→base64）。
-- 改列/加列走 migrations（声明源 schema.yaml 仅 web 演进时更新）；S007 序号连续 0001→0002。
ALTER TABLE users ADD COLUMN avatar_base64 TEXT NOT NULL DEFAULT '';
