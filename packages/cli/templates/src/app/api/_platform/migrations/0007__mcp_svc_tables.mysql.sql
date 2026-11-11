-- 0007__mcp_svc_tables（mysql 方言覆盖）：TEXT 不可作 PK，键列用 VARCHAR(191)；
-- reason 不带 DEFAULT（TEXT 列禁字面量 DEFAULT）；自增用 BIGINT AUTO_INCREMENT。
-- 与 sqlite 基础件 / schema.yaml 列名逐列一致（templates-migration-schema-parity 守 m-1/m-4）。
CREATE TABLE IF NOT EXISTS oj_svc_token (
  jti VARCHAR(191) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  scopes TEXT NOT NULL,
  created_by VARCHAR(191) NOT NULL,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS oj_bot_binding (
  provider VARCHAR(191) NOT NULL,
  external_sub VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  last_used_at BIGINT NOT NULL DEFAULT 0,
  created_by VARCHAR(191) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (provider, external_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS oj_obo_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  svc VARCHAR(191) NOT NULL,
  provider VARCHAR(191) NOT NULL,
  external_sub VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ts BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
