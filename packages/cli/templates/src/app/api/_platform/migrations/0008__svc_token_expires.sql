-- 服务凭据到期时间（P4 到期看板 / 批量轮换导出，K6 缓解）。
-- 签发时 expires_at = created_at + ttl_secs（长期令牌 = created_at + 90d）；历史行无该列，回填为 90d。
-- 与 schema.yaml 列名一致（templates-migration-schema-parity 守 m-1/m-4）。
ALTER TABLE oj_svc_token ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE oj_svc_token SET expires_at = created_at + 7776000 WHERE expires_at = 0;
