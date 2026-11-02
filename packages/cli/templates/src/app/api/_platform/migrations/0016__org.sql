-- 0016__org（sqlite 方言）：组织架构领域（CRUD 基线 + 外部源适配器的落点）
--
-- 两张表都是**租户表**（tenant: true）：组织架构天然按租户隔离（企微部署下 tenant_id = corp_id），
-- 只在有租户上下文时被读写，与 users / sys_oplog 同组（0015 A 组口径）。
-- 故**不**进 config.yaml 的 tenant.shared_allow——那里只放全局映射/凭证。
--
-- 定位（方案 §14：CRUD 是基线，企微 / LDAP 只是适配器）：
--   · 表里不出现任何 wecom_* / ldap_* 字段，来源只由 origin 表达；
--   · origin 是**归属权**标识（D13）：local = 本站管理员全权可 CRUD；
--     wecom / ldap / sso = 该适配器管辖，同步与回收只作用于自己 origin 的行。
--
-- 列的来源语义：
--   origin_id     外部源主键（企微部门 id / LDAP entryUUID）；origin='local' 时由应用层生成稳定串
--   parent_id     本地父部门 id（不是外部 id）——本地部门与同步部门可混挂，且不随外部调整而变
--   name          未获权限时为 NULL（企微代开发未授权「部门名」即如此），展示层用 origin_id 兜底
--   sync_visible  同步可见性，**仅由同步轮次维护**（失去可见范围 → 0），本地部门恒 1
--   deleted       软删除。**只由外部源的删除事件置 1**（D9）：本地删除走真删，见 §14.4-②
--   seen_job_id   最近一次完整全量命中的 job，用于墓碑回收（回收前必先校验本轮完整且无 skip）
CREATE TABLE IF NOT EXISTS sys_department (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'local',
  origin_id TEXT NOT NULL,
  parent_id INTEGER,
  name TEXT,
  name_en TEXT,
  order_no INTEGER NOT NULL DEFAULT 0,
  sync_visible INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  seen_job_id INTEGER,
  update_time INTEGER NOT NULL,
  UNIQUE (tenant_id, origin, origin_id)
);
CREATE INDEX IF NOT EXISTS idx_sys_department_parent ON sys_department (tenant_id, parent_id, deleted, order_no);

-- 成员 ↔ 部门（多对多）：企微一个人可在多个部门，order / is_leader 与 department[] 逐位对应。
-- 全本地 id 关联（user_id + dept_id），**与来源完全无关**，接任何适配器都不用改这张表。
CREATE TABLE IF NOT EXISTS sys_dept_member (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  dept_id INTEGER NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 0,
  is_leader INTEGER NOT NULL DEFAULT 0,
  is_main INTEGER NOT NULL DEFAULT 0,
  update_time INTEGER NOT NULL,
  UNIQUE (tenant_id, user_id, dept_id)
);
CREATE INDEX IF NOT EXISTS idx_sys_dept_member_dept ON sys_dept_member (tenant_id, dept_id, order_no);
CREATE INDEX IF NOT EXISTS idx_sys_dept_member_user ON sys_dept_member (tenant_id, user_id, is_main);

-- users 扩列（三列都是与源无关的通用字段）
--   activated        是否登录过本站。同步会为「从未登录」的全员建档，若不加这道闸门，
--                    contacts 目录（60 次/分、keyword≥2）可被用来遍历拖走整份企业名册（§9.1）
--   position         职务（本地 / LDAP / 企微都能填）
--   external_status  外部源侧的状态快照（企微 1/2/4/5）。**绝不自动改写 is_forbidden**——
--                    那会和本站管理员的手动启停互相覆盖（§4.3）
ALTER TABLE users ADD COLUMN activated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN position TEXT;
ALTER TABLE users ADD COLUMN external_status INTEGER;
-- 存量账号一律视为已激活：保持 contacts 的既有行为不变（它此前本就返回全部 users）
UPDATE users SET activated = 1;
