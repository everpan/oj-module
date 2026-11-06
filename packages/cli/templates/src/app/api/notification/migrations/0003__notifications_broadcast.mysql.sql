-- 0003（mysql 方言）：广播表 + 已读回执表。口径同基础件。
-- 方言差异：AUTOINCREMENT → BIGINT AUTO_INCREMENT；CREATE INDEX IF NOT EXISTS 不被 MySQL 支持，索引写进建表语句。
CREATE TABLE IF NOT EXISTS notifications_broadcast (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  avatar VARCHAR(255) NOT NULL DEFAULT '',
  `date` VARCHAR(64) NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT (''),
  title VARCHAR(255) NOT NULL DEFAULT '',
  link TEXT,
  category VARCHAR(255) NOT NULL DEFAULT 'notice',
  create_time VARCHAR(64) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications_broadcast_read (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  broadcast_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  read_time VARCHAR(64) NOT NULL DEFAULT '',
  KEY idx_broadcast_read (user_id, broadcast_id)
);

