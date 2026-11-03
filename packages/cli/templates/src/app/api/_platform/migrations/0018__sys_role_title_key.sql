-- 0018__sys_role_title_key（sqlite 方言）：角色显示名双列（R2，计划 docs/plans/20261103-0948-role-title-translate）。
-- title = 安装期解析文本（站点默认语言）；title_key = 原始 i18n key（UI 实时翻译锚，
-- 对齐 sys_permission.title_key 先例）。可空：内置角色与 custom 角色无 key。
-- 回填口径：builtin=0 且 title 命中裸 key 形状。sqlite 无 REGEXP → GLOB '[a-z]*:*'
-- （首字符小写字母 + 含冒号的近似）；真实数据里含冒号的 title 只可能是裸 key
-- （内置中文/管理员文本不含冒号），pg/mysql 两侧用完整正则同义钉死。
ALTER TABLE sys_role ADD COLUMN title_key TEXT;
UPDATE sys_role SET title_key = title WHERE builtin = 0 AND title GLOB '[a-z]*:*';
