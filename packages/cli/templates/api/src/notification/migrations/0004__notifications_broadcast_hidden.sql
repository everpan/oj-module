-- 广播隐藏标记表（按人）：清空/单条删除广播项时落标记——广播本体是共享行，
-- 任何人不得物理删除（会影响其他收件人），只能「对我隐藏」。
-- 清空 = 按人项物理删 + 广播逐条落 hidden 标记；列表查询过滤 hidden 命中项。
-- 三方言可移植：建表 + 索引均为标准 DDL。
CREATE TABLE IF NOT EXISTS notifications_broadcast_hidden (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  create_time TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_broadcast_hidden ON notifications_broadcast_hidden (user_id, broadcast_id);
