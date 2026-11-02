-- 0002__tenant（mysql 方言）：首页图表两表租户化。TEXT 不能带字面默认值 → VARCHAR(255)。
ALTER TABLE home_pie ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
ALTER TABLE home_line ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
