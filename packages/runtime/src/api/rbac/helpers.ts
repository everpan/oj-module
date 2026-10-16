// RBAC UI 纯函数（C1/C2 页面逻辑；可复用给解决方案模块）。
// 语义锚：AC1-8（成员资格 superadmin 独占）、AC1-19（builtin 无绑定编辑/删除）、AC1-20（占用禁删）。

/** 展示名：title 缺省回落机器名。 */
export function roleLabel(role: { name: string, title?: string | null }): string {
	return role.title || role.name;
}

/** AC1-19：builtin 角色（superadmin/admin/editor/viewer）无绑定编辑入口。 */
export function canEditRoleBindings(role: { builtin: boolean }): boolean {
	return !role.builtin;
}

/** AC1-19/20：删除入口——非 builtin 且当前无持有者（服务端 409 仍是权威判据）。 */
export function canDeleteRole(role: { builtin: boolean, holders: number }): boolean {
	return !role.builtin && role.holders === 0;
}

/** AC1-8：actor 能否把 roleName 分配给用户。 */
export function canAssignRole(actorRoles: string[], roleName: string): boolean {
	if (actorRoles.includes("superadmin"))
		return true;
	if (actorRoles.includes("admin"))
		return roleName !== "superadmin" && roleName !== "admin";
	return false;
}

/** 绑定编辑 diff（审计明细同款语义，AC1-28）。 */
export function bindingDiff(before: string[], after: string[]): { added: string[], removed: string[] } {
	const b = new Set(before);
	const a = new Set(after);
	return {
		added: after.filter(x => !b.has(x)),
		removed: before.filter(x => !a.has(x)),
	};
}

/** 按 module 分组（角色下拉/权限勾选的分组展示）。 */
export function groupByModule<T extends { module: string }>(items: T[]): Array<{ module: string, items: T[] }> {
	const map = new Map<string, T[]>();
	for (const item of items)
		(map.get(item.module) ?? map.set(item.module, []).get(item.module))!.push(item);
	return [...map.entries()].map(([module, items]) => ({ module, items }));
}
