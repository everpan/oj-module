-- 0004（postgres 方言）：广播隐藏标记表。口径同基础件。
-- 方言差异：AUTOINCREMENT → BIGSERIAL（SERIAL 系允许 seed 显式写 id）；其余 DDL 与基础件同语法。
CREATE TABLE IF NOT EXISTS notifications_broadcast_hidden (
  id BIGSERIAL PRIMARY KEY,
  broadcast_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  create_time TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_broadcast_hidden ON notifications_broadcast_hidden (user_id, broadcast_id);

