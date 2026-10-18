-- home 模块建表（P4-1）。home_pie 五分类聚合源；home_line 日窗口时间序列。
-- S007 要求序号连续且唯一，两表并入单文件 0001。day 用 epoch-day 整数便于窗口算术。
CREATE TABLE IF NOT EXISTS home_pie (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT '',
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS home_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day INTEGER NOT NULL DEFAULT 0,
  value INTEGER NOT NULL DEFAULT 0
);
