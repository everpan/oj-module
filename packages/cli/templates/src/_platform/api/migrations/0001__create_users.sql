-- users 表结构（归属 _platform；结构只进 migrations，seed.sql 只放数据，S006 纪律）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]'
)
