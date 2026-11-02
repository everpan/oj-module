-- 企微代开发 connector 的三张表（阶段 P1）。结构只进 migrations（S006），列集与 schema.yaml 一致。
--
-- 定性（三处必须一致：本文件头 / schema.yaml `tenant: false` / config.yaml `tenant.shared_allow`）：
--   三张表全部**共享表**——它们在「还没有租户上下文」的时刻被读写：
--     · wecom_app_profile 本身就是 corp → 租户的映射权威（查它的时候必然不知道租户）；
--     · wecom_suite_ticket 是套件级凭证，按 suite_id 全局唯一；
--     · wecom_login_ticket 跨「匿名 302 回跳」与「已认证换取」两段，票据本身携带租户。
--   共享 = 不受 sql_guard 约束，故只放映射/凭证/一次性票据，不放任何租户业务数据。
--
-- 凭证保密（§7.5）：permanent_code 即代开发应用的 secret（具备全 corp 数据权限），
-- 只以 AES-GCM 密文落库（crypto.aesGcmEncrypt，密钥取部署常量 wecom_enc_key），列名带 _enc 后缀。
CREATE TABLE IF NOT EXISTS wecom_app_profile (
  suite_id TEXT NOT NULL,
  corp_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  auth_corp_id TEXT NOT NULL,
  env TEXT NOT NULL DEFAULT 'prod',
  corp_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  permanent_code_enc TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  update_time INTEGER NOT NULL,
  PRIMARY KEY (suite_id, corp_id, agent_id)
);

CREATE TABLE IF NOT EXISTS wecom_suite_ticket (
  suite_id TEXT NOT NULL PRIMARY KEY,
  suite_ticket TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  update_time INTEGER NOT NULL
);

-- 一次性登录票据：302 的 URL 里只能放票，不能放 access/refresh token（会被浏览器历史、
-- Referer、反代日志留存）。只存 SHA-256，明文仅存在于 302 Location 与 SPA 内存。
-- 列名用 owner_tenant 而不是 tenant_id：本表是共享表，出现 tenant_id 列会被
-- 「tenant:false 却声明隔离列」的定性红线判为自相矛盾，而它的语义是「票据绑定的租户」。
CREATE TABLE IF NOT EXISTS wecom_login_ticket (
  ticket_hash TEXT NOT NULL PRIMARY KEY,
  uid INTEGER NOT NULL,
  owner_tenant TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 过期票清理按 expires_at 扫（签发时顺手删）；无索引会全表扫
CREATE INDEX IF NOT EXISTS idx_wecom_login_ticket_expires ON wecom_login_ticket (expires_at);
