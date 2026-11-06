/**
 * 用户列表关键词搜索（纯函数，BDD 用例见 cli __tests__/users-roles-display.test.ts）。
 *
 * 口径（20261106-1811 计划文档）：users 表无 nickname 列，「昵称与 display」按
 * username（账号）+ display_name（显示名/昵称）匹配，大小写不敏感；空白关键字 = 全可见。
 * 名单一页全量，过滤在前端做（与部门筛选同口径）。
 */
export interface UserKeywordRow {
	username: string
	display_name: string | null
}

export function matchUserKeyword(row: UserKeywordRow, keyword: string): boolean {
	const kw = keyword.trim().toLowerCase();
	if (!kw)
		return true;
	const tail = row.display_name ?? "";
	return row.username.toLowerCase().includes(kw) || tail.toLowerCase().includes(kw);
}
