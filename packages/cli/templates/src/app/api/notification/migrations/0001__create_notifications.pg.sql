-- 0001（postgres 方言）：通知表建表。口径同基础件。
-- 方言差异：AUTOINCREMENT → BIGSERIAL（SERIAL 系允许 seed 显式写 id）；TEXT 在 pg 合法且可带默认值。
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  avatar TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT ''
);

