-- 应用来源（0003）pg 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：TEXT 在 pg 合法且可带 DEFAULT，与通用文件同形。
ALTER TABLE wecom_app_profile ADD COLUMN credential_kind TEXT NOT NULL DEFAULT 'suite';
