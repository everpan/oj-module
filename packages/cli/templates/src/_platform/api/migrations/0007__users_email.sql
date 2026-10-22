-- 通讯录字段：email（设计 §4B 检索/详情引用而 A1 未落，A7 实现期补——is_forbidden 同先例，回填 §9）
-- 可空：本地账号无邮箱（LDAP/SSO JIT 建号回填）
ALTER TABLE users ADD COLUMN email TEXT;
