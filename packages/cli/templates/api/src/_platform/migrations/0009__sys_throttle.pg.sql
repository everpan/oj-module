-- 限速/登录节流状态落库 pg 方言覆盖（sqlite 版见 0009__sys_throttle.sql；oj-wiki 先例同型）。
-- 差异：无（TEXT 主键三方言同语法）。
CREATE TABLE IF NOT EXISTS sys_rate_window (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sys_login_throttle (
  pair_key TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
