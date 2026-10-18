-- market_history 表上收 _platform（P4 裁决：市场操作历史为平台级审计面，归属平台核心，
-- 不再由 oj-market 方案包自带迁移创建）。install/enable/disable/uninstall/upgrade/rollback
-- 六类动作留痕；前端历史抽屉与版本历史对比只读消费。
-- 结构只进 migrations（S006）；与 schema.yaml 列集一致。
CREATE TABLE IF NOT EXISTS market_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solution TEXT NOT NULL,
  version TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  operator TEXT,
  message TEXT,
  created_at INTEGER NOT NULL
);
