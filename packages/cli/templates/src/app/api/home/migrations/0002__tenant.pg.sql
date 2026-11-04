-- 0002__tenant（postgres 方言）：首页图表两表租户化。TEXT 在 pg 合法，与基础件同语法。
ALTER TABLE home_pie ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE home_line ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

