-- L1 测试账号（仅 `oj test` 经 fixtures 灌入，不进 release 产物）。
--
-- 为什么不能用 seed 的开发账号（admin/superadmin 等）跑 L1 登录：
--   ① seed 账号初始口令 123456 只是开发便利——用户在 dev 库改过口令后，口令即漂移，
--      L1 若绑 seed 账号会随机 401（本地实测踩过：dev 库口令被改成 12345678）。
--   ② 不用 must_change 解释：seed 账号现均为 0（2026-10-22 口径）；真正的原因是 ①。
-- 故 additive 建一个专用账号：INSERT OR IGNORE 幂等，反复重放终态一致，
-- 不碰 admin 既有行（用户的口令/状态不受 `oj test` 影响）。
-- 按分号朴素切分（S006）：语句内不得含分号字面量。
INSERT OR IGNORE INTO users (username, password_hash, avatar_base64, source, display_name, must_change, is_forbidden) VALUES ('l1tester', '$2b$10$/0DuEHsBLYp6.5ZLJCFafOOvksLbruMvs9aMhUqRSpbdY52D9RaXS', '', 'local', 'L1 测试账号', 0, 0);
-- 绑 superadmin：L1 若打判权类端点可直通（账号生命周期 B6 建号默认 must_change=1，这里显式 0）
INSERT OR IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'l1tester';
