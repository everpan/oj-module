/**
 * 角色语言名解析（纯函数）：角色页（roles/index.tsx R2 先例）与成员资格页
 * （users/roles.tsx）共用的显示名口径，BDD 用例见 cli __tests__/users-roles-display.test.ts。
 *
 * 回退链（与角色页表格列渲染逐字一致）：
 *   title_key（solution 角色，跨模块 namespace）→ t 译文，缺译文回退 title；
 *   内置角色（builtin）→ `system:rolesPage.roleTitle.<name>` locale 键，缺键回退 title → name；
 *   custom 角色 → 原样 title，title 空回退 name。
 */
export interface RoleLabelRow {
	name: string
	title: string | null
	title_key: string | null
	builtin: boolean
}

/** i18next t 的最小消费面（TFunction 兼容此签名） */
type Translate = (key: string, options?: { defaultValue?: string }) => string;

export function roleLabel(row: RoleLabelRow, t: Translate): string {
	if (row.title_key)
		return t(row.title_key, { defaultValue: row.title ?? "" });
	return row.builtin
		? t(`system:rolesPage.roleTitle.${row.name}`, { defaultValue: row.title ?? row.name })
		: (row.title ?? row.name);
}
