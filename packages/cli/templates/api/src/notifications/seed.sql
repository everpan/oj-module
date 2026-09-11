-- notifications 模块种子：每次启动重放，必须幂等（INSERT OR IGNORE / 注释里别写分号）。
INSERT OR IGNORE INTO notifications (id, avatar, date, is_read, message, title) VALUES (1, '', '2026-09-01 09:12', 0, '脚手架已就绪，用 admin / 123456 登录开始', '欢迎');
INSERT OR IGNORE INTO notifications (id, avatar, date, is_read, message, title) VALUES (2, '', '2026-09-02 14:30', 0, '编辑 api/src 下的 api.ts 保存即热更，新增模块目录需重启 ram dev', '开发提示');
INSERT OR IGNORE INTO notifications (id, avatar, date, is_read, message, title) VALUES (3, '', '2026-09-03 18:45', 1, '契约改动后重跑 ram api 生成前端 client 与文档', '契约');
