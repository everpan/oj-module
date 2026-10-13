-- notification 模块种子（按人真实通知）。user_id=1 为主，link/category 幂等可空/默认。
-- 按分号朴素切分（S006）：语句内不得含分号字面量。
INSERT OR IGNORE INTO notifications (id, user_id, avatar, date, is_read, message, title, link, category) VALUES (1, 1, '', '2026-09-01 09:12', 0, 'system 模块已接入 D9 注入，角色/菜单端点收敛到 /system', '模块更新', NULL, 'notice');
INSERT OR IGNORE INTO notifications (id, user_id, avatar, date, is_read, message, title, link, category) VALUES (2, 1, '', '2026-09-02 14:30', 0, 'demo 待办已接真实数据层，支持 keyword 过滤', '数据层', NULL, 'notice');
INSERT OR IGNORE INTO notifications (id, user_id, avatar, date, is_read, message, title, link, category) VALUES (3, 1, '', '2026-09-03 18:45', 1, 'home 饼图/折线接入五分类与时间序列聚合', '首页图表', NULL, 'notice');
INSERT OR IGNORE INTO notifications (id, user_id, avatar, date, is_read, message, title, link, category) VALUES (4, 1, '', '2026-09-04 08:00', 0, 'avatar 上传走 multipart→base64，回写 users.avatar_base64', '上传', NULL, 'notice');
