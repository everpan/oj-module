-- demo 模块种子（P3-2）：示例待办，幂等 INSERT OR IGNORE，按分号朴素切分（S006）。
INSERT OR IGNORE INTO todos (id, title, done, create_time, update_time) VALUES (1, '学习 uni-dev 契约机制', 1, 0, 0);
INSERT OR IGNORE INTO todos (id, title, done, create_time, update_time) VALUES (2, '完成 playground-oj system 模块', 0, 0, 0);
INSERT OR IGNORE INTO todos (id, title, done, create_time, update_time) VALUES (3, '编写 P3 教学文档', 0, 0, 0);
INSERT OR IGNORE INTO todos (id, title, done, create_time, update_time) VALUES (4, '联调 demo 真实数据层', 0, 0, 0);
