-- 0004（mysql 方言）：广播隐藏标记表。口径同基础件。
-- 方言差异：AUTOINCREMENT → BIGINT AUTO_INCREMENT；CREATE INDEX IF NOT EXISTS 不被 MySQL 支持，索引写进建表语句。
CREATE TABLE IF NOT EXISTS notifications_broadcast_hidden (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  broadcast_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  create_time VARCHAR(64) NOT NULL DEFAULT '',
  KEY idx_broadcast_hidden (user_id, broadcast_id)
);

