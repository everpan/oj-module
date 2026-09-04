-- system 模块初始建表（P2-3）。schema.yaml 为声明源（dev 启动自动收敛），
-- 此处给出显式版本化迁移，便于 oj migrate / oj build --check 走完整链路。
-- 注：S007 要求序号 1..=n 连续且唯一，故三张表并入单文件 0001（不裂成三个 0001）。
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  remark TEXT NOT NULL DEFAULT '',
  create_time INTEGER NOT NULL DEFAULT 0,
  update_time INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  component TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'menu',
  permission TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  create_time INTEGER NOT NULL DEFAULT 0,
  update_time INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL DEFAULT '',
  menu_id INTEGER NOT NULL DEFAULT 0,
  UNIQUE(role, menu_id)
);
