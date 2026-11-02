/**
 * 角色展示页的可见范围（纯函数，便于用例直接钉住，不必起 React）。
 *
 * superadmin 是平台级角色（跨租户），不属于「站点可分配的角色目录」；列在角色页只会让人
 * 误以为能改它的绑定，故展示层隐去。
 *
 * **只在这一层过滤**：后端 listRoles() 必须原样返回 superadmin——成员资格页
 * （users/roles.tsx）还要拿它作为可授予项（仅 superadmin 可勾选，见那里的 disabled 逻辑）。
 */
export const HIDDEN_ROLE = "superadmin";

export function visibleRoles<T extends { name: string }>(roles: readonly T[]): T[] {
	return roles.filter(r => r.name !== HIDDEN_ROLE);
}
