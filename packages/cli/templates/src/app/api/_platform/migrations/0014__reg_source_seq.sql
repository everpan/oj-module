-- reg_source_seq（REG-CS2 索引新鲜度）：站点按源记住「见过的最大 seq」，回退即拒（防回放/降级）。
-- 受害者是站点，记录点就在站点（D1）；CLI/API 同一判定，不另设状态文件。
-- 结构只进 migrations（S006）；与 schema.yaml 列集一致。
CREATE TABLE IF NOT EXISTS reg_source_seq (
  source_url TEXT NOT NULL PRIMARY KEY,
  max_seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
