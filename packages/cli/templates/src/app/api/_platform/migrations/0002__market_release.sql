-- 0002__market_release（sqlite 方言）：发布历史表。
--
-- 定性：**共享表**（schema.yaml `tenant: false` + config.yaml `tenant.shared_allow` 双声明）。
-- 理由：发布历史描述的是「这个 CDN 上出现过哪些包、谁发的」，CDN 本身就是站点级的；
-- 按租户隔离会把同一份市场索引割裂成互不可见的碎片。
--
-- 数据来源是**签名索引**（market/api.ts syncReleases）：站点每次读发布历史时把索引里出现过的
-- product@version 补进来。为什么不在 CLI 发版时上报：`ojm market publish` 是纯本地操作
-- （可离线、无登录态），签名索引本身就是发版事实，再开一条上报链路只会多一套授权面与漂移源。
--
-- 语义：
--   · 一行 = 一个 product@version（唯一键），history 是 append-only：published_at 首次写定后不改
--   · published_at 优先取分发包的 Last-Modified（真正的落 CDN 时刻），取不到回落索引 issued_at，
--     由 published_at_source 标明来源（file / index）
--   · yanked 跟随索引（0 在架 / 1 已下线）——下线是当前状态，不是历史事实的改写
CREATE TABLE IF NOT EXISTS market_release (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  version TEXT NOT NULL,
  key_id TEXT,
  sha256 TEXT,
  size INTEGER,
  published_at INTEGER NOT NULL,
  published_at_source TEXT NOT NULL,
  yanked INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL
);

-- 同步幂等：同一 product@version 只落一行（并发同步撞键由插入侧吞掉）
CREATE UNIQUE INDEX IF NOT EXISTS uk_market_release_version ON market_release (product, version);

-- 发布历史页主查询：按发布时间倒序分页
CREATE INDEX IF NOT EXISTS idx_market_release_published ON market_release (published_at);
