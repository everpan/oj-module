-- L1 测试账号（仅 `oj test` 经 fixtures 灌入，不进 release 产物）。
--
-- 为什么不能用 seed 的 admin 跑 L1 登录：
--   ① seed 的 admin 是 must_change=1 首登改密态（D12 生产语义），且初始口令 123456
--      只是开发便利——用户在 dev 库改过口令后（产品主动引导），admin 口令即漂移，
--      L1 若绑 admin/123456 会随机 401（本地实测踩过：dev 库口令被改成 12345678）。
--   ② 判权类端点（currentAccess/assertPermission）对 must_change=1 恒 403。
-- 故 additive 建一个专用账号：INSERT OR IGNORE 幂等，反复重放终态一致，
-- 不碰 admin 既有行（用户的口令/状态不受 `oj test` 影响）。
-- 按分号朴素切分（S006）：语句内不得含分号字面量。
INSERT OR IGNORE INTO users (username, password_hash, avatar_base64, source, display_name, must_change, is_forbidden) VALUES ('l1tester', '$2b$10$/0DuEHsBLYp6.5ZLJCFafOOvksLbruMvs9aMhUqRSpbdY52D9RaXS', '', 'local', 'L1 测试账号', 0, 0);
-- 绑 superadmin：L1 若打判权类端点可直通（账号生命周期 B6 建号默认 must_change=1，这里显式 0）
INSERT OR IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'l1tester';
