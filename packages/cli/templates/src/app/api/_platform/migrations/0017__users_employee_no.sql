-- 0017__users_employee_no（sqlite 方言）：工号列 + 租户内唯一
--
-- 为什么单开一列而不是复用 display_name / 外部 origin_id：用户 CSV 导入导出要与源系统
-- 9 列表头完全互通，「工号」必须是独立可查字段。
-- 可空是必需的：存量本地账号没有工号，外部同步号也可能不带；唯一性只在有值时有意义，
-- 故用部分索引（sqlite/pg 都支持 WHERE），mysql 侧靠「NULL 可重复」的唯一键等效。
ALTER TABLE users ADD COLUMN employee_no TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uk_users_employee_no ON users (tenant_id, employee_no) WHERE employee_no IS NOT NULL;
