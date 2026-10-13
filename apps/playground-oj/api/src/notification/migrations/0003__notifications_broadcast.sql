-- 广播/公告表（全局一行，避免按人 fan-out 造成的信息爆炸）+ 已读回执表（按人记录读状态）。
-- 铃列表 = 广播(LEFT JOIN 回执算 is_read) UNION 按人(WHERE user_id = ?)。
-- 三方言可移植：建表 + 索引均为标准 DDL。
CREATE TABLE IF NOT EXISTS notifications_broadcast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  avatar TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  link TEXT,
  category TEXT NOT NULL DEFAULT 'notice',
  create_time TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications_broadcast_read (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  read_time TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_broadcast_read ON notifications_broadcast_read (user_id, broadcast_id);
