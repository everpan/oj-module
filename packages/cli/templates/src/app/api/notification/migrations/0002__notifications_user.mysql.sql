-- 0002（mysql 方言）：按人真实通知表演进。
-- 方言差异：TEXT 不能带字面默认值 → category 收窄 VARCHAR(255)；MySQL 不支持 CREATE INDEX IF NOT EXISTS，直接建索引。
ALTER TABLE notifications ADD COLUMN user_id INTEGER;
ALTER TABLE notifications ADD COLUMN link TEXT;
ALTER TABLE notifications ADD COLUMN category VARCHAR(255) NOT NULL DEFAULT 'notice';
CREATE INDEX idx_notifications_user ON notifications (user_id, is_read);
UPDATE notifications SET user_id = 1, category = 'notice' WHERE user_id IS NULL;

