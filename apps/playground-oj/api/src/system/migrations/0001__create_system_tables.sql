-- system 模块初始建表（P2-3 起草，P3-1 扩列以对齐 MenuItemType 全字段）。
-- schema.yaml 为声明源（dev 启动自动收敛），此处给出显式版本化迁移，
-- 便于 oj migrate / oj build --check 走完整链路。
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

-- menus：扩展为 MenuItemType 全字段。
-- order 为 SQL 保留字，沿用 sort 列承载 menuType 顺序（handler 映射 order=sort）。
-- type -> menu_type（0 菜单 / 1 目录 / 2 iframe / 3 外链按钮）。
CREATE TABLE IF NOT EXISTS menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  component TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  menu_type INTEGER NOT NULL DEFAULT 0,
  permission TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  current_active_menu TEXT NOT NULL DEFAULT '',
  iframe_link TEXT NOT NULL DEFAULT '',
  keep_alive INTEGER NOT NULL DEFAULT 0,
  external_link TEXT NOT NULL DEFAULT '',
  hide_in_menu INTEGER NOT NULL DEFAULT 0,
  ignore_access INTEGER NOT NULL DEFAULT 0,
  create_time INTEGER NOT NULL DEFAULT 0,
  update_time INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL DEFAULT '',
  menu_id INTEGER NOT NULL DEFAULT 0,
  UNIQUE(role, menu_id)
);
