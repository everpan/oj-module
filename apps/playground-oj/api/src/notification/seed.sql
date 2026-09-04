-- notification 模块种子（P4-2）。按分号朴素切分（S006）。
INSERT OR IGNORE INTO notifications (id, avatar, date, is_read, message, title) VALUES (1, '', '2026-09-01 09:12', 0, 'system 模块已接入 D9 注入，角色/菜单端点收敛到 /system', '模块更新');
INSERT OR IGNORE INTO notifications (id, avatar, date, is_read, message, title) VALUES (2, '', '2026-09-02 14:30', 0, 'demo 待办已接真实数据层，支持 keyword 过滤', '数据层');
INSERT OR IGNORE INTO notifications (id, avatar, date, is_read, message, title) VALUES (3, '', '2026-09-03 18:45', 1, 'home 饼图/折线接入五分类与时间序列聚合', '首页图表');
INSERT OR IGNORE INTO notifications (id, avatar, date, is_read, message, title) VALUES (4, '', '2026-09-04 08:00', 0, 'avatar 上传走 multipart→base64，回写 users.avatar_base64', '上传');
