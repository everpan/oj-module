-- 禁用标记：is_forbidden=1 即拒（判权出口顺带校验，设计文档 D10/D14）；登录链 B1 复用同一列
-- A3 实现期发现 A1 遗漏该列（设计文档全篇引用而迁移未落），补此迁移并回填 §9 反常识
ALTER TABLE users ADD COLUMN is_forbidden INTEGER NOT NULL DEFAULT 0;
