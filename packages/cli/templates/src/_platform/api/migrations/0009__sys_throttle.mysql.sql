-- 限速/登录节流状态落库 mysql 方言覆盖（sqlite 版见 0009__sys_throttle.sql；oj-wiki 先例同型）。
-- 差异：整型列取 BIGINT；rate_key 避开 MySQL 保留字 key。
CREATE TABLE IF NOT EXISTS sys_rate_window (
  rate_key VARCHAR(255) PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_login_throttle (
  pair_key VARCHAR(255) PRIMARY KEY,
  fail_count BIGINT NOT NULL,
  blocked_until BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
