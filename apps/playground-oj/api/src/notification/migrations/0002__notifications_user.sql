-- notification 模块表演进（升级为按人真实通知）：可空 ADD COLUMN + 索引 + 既有行归主。
-- 三方言可移植：sqlite/mysql/pg 均支持 ALTER TABLE ADD COLUMN（含 DEFAULT）。
ALTER TABLE notifications ADD COLUMN user_id INTEGER;
ALTER TABLE notifications ADD COLUMN link TEXT;
-- 类别：notice=通知/广播，pm=私信，mention=@我（占位）。NOT NULL + DEFAULT 保证既有行与新增行合规。
ALTER TABLE notifications ADD COLUMN category TEXT NOT NULL DEFAULT 'notice';
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);
-- 既有演示行（user_id 为 NULL）归主到用户 1：不丢数据、不再全员可见。
UPDATE notifications SET user_id = 1, category = 'notice' WHERE user_id IS NULL;
