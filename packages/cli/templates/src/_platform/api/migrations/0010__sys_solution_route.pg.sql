-- 方案注册路由表重构 pg 方言覆盖（sqlite 版见 0010__sys_solution_route.sql）。
-- 差异：无（ADD COLUMN / DROP TABLE / 双引号保留字 / CREATE INDEX IF NOT EXISTS pg 原生支持）。
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
