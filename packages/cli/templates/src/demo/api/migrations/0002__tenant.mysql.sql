-- 0002__tenant（mysql 方言）：demo.todos 租户化。TEXT 不能带字面默认值 → VARCHAR(255)。
ALTER TABLE todos ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
