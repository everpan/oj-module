-- 0010__module_overlay（mysql 方言）：mysql 无部分唯一索引，用生成列模拟——
-- _one_enabled 在 enabled=1 时取 name、否则 NULL；mysql 唯一索引中 NULL 互不相同，
-- 恰保证每个 name 至多一行 enabled（等价 sqlite/pg 的 WHERE enabled=1 部分索引）。
CREATE TABLE sys_module_overlay (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL,
  version VARCHAR(32) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 0,
  source VARCHAR(16) NOT NULL DEFAULT 'solution',
  face_ref TEXT NULL,
  seq BIGINT NOT NULL DEFAULT 0,
  actor VARCHAR(64) NOT NULL DEFAULT '',
  changed_at BIGINT NOT NULL DEFAULT 0,
  old_state TEXT NULL,
  _one_enabled VARCHAR(64) GENERATED ALWAYS AS (IF(enabled = 1, name, NULL)) STORED,
  UNIQUE KEY ux_overlay_name_version (name, version),
  UNIQUE KEY ux_overlay_one_enabled (_one_enabled)
);
