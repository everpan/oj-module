-- 0001__baseline（sqlite 方言）：_platform 全部表结构基线
--
-- 为什么是一条基线：本产品正式发版前，0001–0018 共 45 个迁移文件只是演进过程的中间态。
-- 压平后一个模块只有一条迁移（迁移账本按 [module, version] 记账，序列不允许空洞，
-- 故必须仍从 0001 开始）。**升级既有开发库不受支持**：老库账本已记 0001–0018，
-- 新基线会被视为「已应用」而跳过 —— 删掉本地 sqlite 重启即按本文件重建（见 devkit manual）。
--
-- 压平口径：与「顺序执行 0001–0018 后的最终结构」逐列、逐索引等价；
-- 同时补齐了此前只有 sqlite 版、没有 mysql/pg 版的 7 条迁移（0002/0003/0005/0006/0007/0011/0013）。
-- 与 schema.yaml 的一致性由 templates-migration-schema-parity.test.ts 双向守着。

-- ── users（租户表 A 组：tenant_id 是真实列，唯一性收敛到租户内）─────────────────
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  corp_id TEXT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_base64 TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  display_name TEXT,
  must_change INTEGER NOT NULL DEFAULT 0,
  is_forbidden INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  phone_number TEXT,
  description TEXT,
  activated INTEGER NOT NULL DEFAULT 0,
  position TEXT,
  external_status INTEGER,
  employee_no TEXT,
  UNIQUE (tenant_id, username)
);
-- 工号租户内唯一。可空是必需的：存量本地账号与部分外部账号没有工号，
-- 唯一性只在有值时成立 → 部分索引（sqlite/pg 同语法；mysql 靠 NULL 可重复等效）。
CREATE UNIQUE INDEX IF NOT EXISTS uk_users_employee_no
  ON users (tenant_id, employee_no) WHERE employee_no IS NOT NULL;

-- ── sys_setting（共享表 B 组：登录方式发现是未登录端点，此刻无租户上下文）────────
CREATE TABLE IF NOT EXISTS sys_setting (
  key TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  "group" TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'string',
  value TEXT,
  default_value TEXT,
  label_key TEXT,
  options TEXT,
  secret INTEGER NOT NULL DEFAULT 0,
  update_time INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  group_label_key TEXT
);

-- ── sys_oplog（租户表 A 组）──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_oplog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  create_time INTEGER NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT 'framework',
  version TEXT,
  target TEXT,
  detail TEXT,
  level INTEGER NOT NULL DEFAULT 6,
  tenant_id TEXT NOT NULL DEFAULT 'default'
);
CREATE INDEX IF NOT EXISTS idx_sys_oplog_time ON sys_oplog (create_time, id);

-- ── sys_solution_route（共享表 B 组：站点级路由注册，path 唯一）────────────────
CREATE TABLE IF NOT EXISTS sys_solution_route (
  path TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  category TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  title_key TEXT,
  required_permission TEXT,
  deprecated INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sys_solution_route_module ON sys_solution_route (module);

-- ── RBAC 目录（共享表 B 组：角色/权限码是框架目录，分配关系在 A 组 sys_user_role）──
CREATE TABLE IF NOT EXISTS sys_role (
  name TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  title TEXT,
  description TEXT,
  builtin INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  -- title = 安装期解析文本；title_key = 原始 i18n key（UI 实时翻译锚，与 sys_permission.title_key 同形）
  title_key TEXT
);

CREATE TABLE IF NOT EXISTS sys_permission (
  code TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  title_key TEXT,
  deprecated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sys_role_permission (
  role_name TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  PRIMARY KEY (role_name, permission_code)
);

CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id INTEGER NOT NULL,
  role_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  PRIMARY KEY (user_id, role_name)
);

-- ── sys_refresh_token（租户表 A 组）──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_refresh_token (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default'
);
CREATE INDEX IF NOT EXISTS idx_sys_refresh_token_user ON sys_refresh_token (user_id);

-- ── 限速/登录节流（共享表 B 组：登录前就要用，无租户上下文）─────────────────────
CREATE TABLE IF NOT EXISTS sys_rate_window (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sys_login_throttle (
  pair_key TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

-- ── 市场操作留痕（共享表 B 组：安装/升级/回滚是站点级动作）──────────────────────
CREATE TABLE IF NOT EXISTS market_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solution TEXT NOT NULL,
  version TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  operator TEXT,
  message TEXT,
  created_at INTEGER NOT NULL
);

-- ── 索引新鲜度水位（共享表 B 组：受害者是站点，记录点就在站点）────────────────────
CREATE TABLE IF NOT EXISTS reg_source_seq (
  source_url TEXT NOT NULL PRIMARY KEY,
  max_seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ── 组织架构（租户表 A 组：tenant_id 前缀索引，不进 shared_allow）────────────────
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
CREATE INDEX IF NOT EXISTS idx_sys_department_parent
  ON sys_department (tenant_id, parent_id, deleted, order_no);

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
