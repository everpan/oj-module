-- notifications 模块建表：DDL 只进 migrations（S006）。is_read 用 INTEGER(0/1)。
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  avatar TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT ''
);
