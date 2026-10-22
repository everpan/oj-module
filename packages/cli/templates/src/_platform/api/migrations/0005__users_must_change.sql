-- 账号生命周期：must_change 首登强制改密（D12 seed 超管 / 建号默认 1，设计文档 §4A）
ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0;
