-- demo 模块建表（P3-2）。todos 待办表，S007 要求序号连续且唯一，单文件 0001。
-- done 用 INTEGER(0/1) 承载布尔，handler 映射为 boolean。
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  create_time INTEGER NOT NULL DEFAULT 0,
  update_time INTEGER NOT NULL DEFAULT 0
);
