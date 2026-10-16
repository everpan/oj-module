-- 限速/登录节流状态落库（反常识修正：oj 运行时每请求重建模块实例，进程内 Map 不跨请求存活——
-- B5 连败阈值与接口滑动窗口在真实运行时恒失效；状态持久化后重启保留、多实例天然同源，
-- 原先「多实例换 Redis」的已知上限就此消除）。
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
