-- 方案注册路由表重构（P1-8，D10 注册唯一出口的落点）：0004 版以 (name, version, path) 为主键、
-- 无 module/required_permission/deprecated 列，与「站点级路由注册（path 唯一 + 声明消失标
-- deprecated，镜像 AC2-3/4）」的语义不兼容；旧表从未被运行时读写（仅存在性断言），DROP 重建零数据损失。
-- 同时为 sys_setting 补 deprecated 列：设置定义行声明消失同样保留标 deprecated（P1-8 register 语义）。
ALTER TABLE sys_setting ADD COLUMN deprecated INTEGER NOT NULL DEFAULT 0;

DROP TABLE IF EXISTS sys_solution_route;
CREATE TABLE sys_solution_route (
  path TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  category TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  title_key TEXT,
  required_permission TEXT,
  deprecated INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sys_solution_route_module ON sys_solution_route (module);
