-- 0008__svc_token_expires（mysql 方言覆盖）：时间列用 BIGINT（与 0001 基线 created_at 一致）。
-- 列名与 schema.yaml / 基础迁移逐列一致（templates-migration-schema-parity 守 m-1/m-4）。
ALTER TABLE oj_svc_token ADD COLUMN expires_at BIGINT NOT NULL DEFAULT 0;
UPDATE oj_svc_token SET expires_at = created_at + 7776000 WHERE expires_at = 0;
