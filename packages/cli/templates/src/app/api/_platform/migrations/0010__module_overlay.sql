-- 0010__module_overlay（sqlite 方言）：模块启停状态唯一真源（overlay 化改造，主文档 §4.3）。
--
-- 定性：**新建表**。每行 = (模块名, 版本, 启用态) + 审计。铁律（主文档 §4.7）：
--   · 同一模块任何时刻最多一行启用——部分唯一索引 ux_overlay_one_enabled 硬强制
--     （不靠应用层自觉；升级/降级 = 同一事务内置新停旧，原子换版）；
--   · 指纹/entry/chunks 永不进本表（SRI 信任根只在构建侧基线文件）；
--   · seq 单调递增（应用层 max+1），sidecar 离线缓存携带物化时 seq，
--     断网构建对不上号即 fail-stale 拒写；
--   · 行在目录不在 = 方案文件缺失告警；目录在行不在（builtin 常态）= 按基线默认启用。
--
-- 方言差异照 0002 惯例：mysql 用生成列模拟部分唯一索引（IF(enabled=1,name,NULL)，
-- NULL 在 mysql 唯一索引中互不相同，恰保证每 name 至多一行 enabled），见 .mysql.sql。
CREATE TABLE sys_module_overlay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'solution',
  face_ref TEXT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  actor TEXT NOT NULL DEFAULT '',
  changed_at INTEGER NOT NULL DEFAULT 0,
  old_state TEXT NULL
);
CREATE UNIQUE INDEX ux_overlay_name_version ON sys_module_overlay(name, version);
CREATE UNIQUE INDEX ux_overlay_one_enabled ON sys_module_overlay(name) WHERE enabled = 1;
