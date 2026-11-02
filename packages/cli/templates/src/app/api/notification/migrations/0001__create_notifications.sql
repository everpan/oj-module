-- notification 模块建表（P4-2）。notifications 通知表，is_read 用 INTEGER(0/1)。
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  avatar TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT ''
);
