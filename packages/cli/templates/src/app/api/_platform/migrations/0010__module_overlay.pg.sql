-- 0010__module_overlay（pg 方言）：同 sqlite 版，仅自增列方言差异（BIGSERIAL）。
CREATE TABLE sys_module_overlay (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'solution',
  face_ref TEXT NULL,
  seq BIGINT NOT NULL DEFAULT 0,
  actor TEXT NOT NULL DEFAULT '',
  changed_at BIGINT NOT NULL DEFAULT 0,
  old_state TEXT NULL
);
CREATE UNIQUE INDEX ux_overlay_name_version ON sys_module_overlay(name, version);
CREATE UNIQUE INDEX ux_overlay_one_enabled ON sys_module_overlay(name) WHERE enabled = 1;
