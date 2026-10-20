-- notification 模块种子（按人真实通知）。user_id=1（admin），link/category 幂等可空/默认。
-- avatar 给真实 URL：铃铛按 avatar 渲染头像，空串会破图（空串仅作为运行时兜底，不作为种子值）。
-- 按分号朴素切分（S006）：语句内不得含分号字面量。
INSERT OR IGNORE INTO notifications (id, user_id, avatar, date, is_read, message, title, link, category) VALUES (1, 1, 'https://avatar.vercel.sh/seed-welcome.svg?text=W', '2026-09-01 09:12', 0, '脚手架已就绪，用 admin / 123456 登录开始', '欢迎', NULL, 'notice');
INSERT OR IGNORE INTO notifications (id, user_id, avatar, date, is_read, message, title, link, category) VALUES (2, 1, 'https://avatar.vercel.sh/seed-bell.svg?text=B', '2026-09-02 14:30', 0, '通知铃支持单条已读、全部已读与清空；广播经 push-broadcast 入 b: 命名空间', '通知铃', NULL, 'notice');
INSERT OR IGNORE INTO notifications (id, user_id, avatar, date, is_read, message, title, link, category) VALUES (3, 1, 'https://avatar.vercel.sh/seed-contract.svg?text=C', '2026-09-03 18:45', 1, '契约改动后重跑 ojm api 生成前端 client 与文档', '契约', NULL, 'notice');
INSERT OR IGNORE INTO notifications (id, user_id, avatar, date, is_read, message, title, link, category) VALUES (4, 1, 'https://avatar.vercel.sh/seed-dev.svg?text=D', '2026-09-04 08:00', 0, '编辑 api/src 下的 api.ts 保存即热更；handler 组支持四层嵌套（oj v0.1.64）', '开发提示', NULL, 'notice');
