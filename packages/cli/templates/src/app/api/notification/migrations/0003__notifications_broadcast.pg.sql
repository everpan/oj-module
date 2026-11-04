-- 0003（postgres 方言）：广播表 + 已读回执表。口径同基础件。
-- 方言差异：AUTOINCREMENT → BIGSERIAL（SERIAL 系允许 seed 显式写 id）；其余 DDL 与基础件同语法。
CREATE TABLE IF NOT EXISTS notifications_broadcast (
  id BIGSERIAL PRIMARY KEY,
  avatar TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  link TEXT,
  category TEXT NOT NULL DEFAULT 'notice',
  create_time TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications_broadcast_read (
  id BIGSERIAL PRIMARY KEY,
  broadcast_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  read_time TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_broadcast_read ON notifications_broadcast_read (user_id, broadcast_id);

