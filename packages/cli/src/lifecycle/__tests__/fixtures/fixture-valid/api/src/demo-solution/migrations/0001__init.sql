-- 0001__init：建 note 表（与 schema.yaml 列集一致；oj migrate 按 seq 升序执行）
CREATE TABLE IF NOT EXISTS note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  create_time INTEGER NOT NULL
);
