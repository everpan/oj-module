-- 应用来源（0003）mysql 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：MySQL 的 TEXT 不能带 DEFAULT，故收窄为 VARCHAR(16)。
ALTER TABLE wecom_app_profile ADD COLUMN credential_kind VARCHAR(16) NOT NULL DEFAULT 'suite';
