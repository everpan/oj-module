-- 企微代开发三表 mysql 方言覆盖（方言覆盖必胜，通用兜底；oj-bin docs/migration.md §3.1）。
-- 差异：TEXT 主键须给长度（按业务长度收窄为 VARCHAR）；INTEGER → BIGINT（秒级 epoch）；
-- 复合主键里 VARCHAR 合计长度须可进 InnoDB 索引；索引写在 CREATE TABLE 内（MySQL 无 CREATE INDEX IF NOT EXISTS）。
CREATE TABLE IF NOT EXISTS wecom_app_profile (
  suite_id VARCHAR(64) NOT NULL,
  corp_id VARCHAR(64) NOT NULL,
  agent_id VARCHAR(32) NOT NULL,
  auth_corp_id VARCHAR(64) NOT NULL,
  env VARCHAR(32) NOT NULL DEFAULT 'prod',
  corp_name VARCHAR(255),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  permanent_code_enc TEXT NOT NULL,
  installed_at BIGINT NOT NULL,
  update_time BIGINT NOT NULL,
  PRIMARY KEY (suite_id, corp_id, agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wecom_suite_ticket (
  suite_id VARCHAR(64) NOT NULL,
  suite_ticket TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  update_time BIGINT NOT NULL,
  PRIMARY KEY (suite_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wecom_login_ticket (
  ticket_hash CHAR(64) NOT NULL,
  uid BIGINT NOT NULL,
  owner_tenant VARCHAR(128) NOT NULL,
  expires_at BIGINT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (ticket_hash),
  KEY idx_wecom_login_ticket_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
