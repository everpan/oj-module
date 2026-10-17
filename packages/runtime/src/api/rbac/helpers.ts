// RBAC UI 纯函数（C1/C2 页面逻辑；可复用给解决方案模块）。
// 语义锚：AC1-8（成员资格 superadmin 独占）、AC1-19（builtin 无绑定编辑/删除）、AC1-20（占用禁删）、
// R20/R24（设置三层嵌套：框架组在前按 group 聚合、方案组按 module 分组在后）。
import type { RbacSettingItem } from "./types";

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

/**
 * 框架自有设置模块（seed.sql 现行集合；新增框架设置模块须同步）。
 * 方案设置经安装预检强制 `moduleOf(key)===name`（R24），落库 module 列即方案名——
 * 据此把 sys_setting 行二分为框架区（维持按 group 聚合的现状渲染）与方案区（按模块三层嵌套）。
 */
const FRAMEWORK_SETTING_MODULES = new Set(["framework", "market", "ldap", "sso"]);

/** 设置卡片（系统设置页三层嵌套渲染单元，R20）：框架卡 module=null，方案卡带所属方案名。 */
export interface RbacSettingCard {
	/** 方案模块名；框架卡为 null（标题走 system:setting.group.*，与 C4 现状一致） */
	module: string | null
	/** settings 组 id（sys_setting.group 列） */
	group: string
	/** 卡片标题 i18n key：方案卡 = `<module>:settings.group.<group>`（C2-22 组标题契约）；框架卡 null */
	label_key: string | null
	items: RbacSettingItem[]
}

/**
 * 设置行按模块三层嵌套分组（R20/R24，纯函数）：框架卡在前（按 group 列聚合、保持服务端
 * `order by group, key` 次序），方案卡在后（module 名升序、组内按 group 列聚合）。
 * 不按 key 首段切组——框架 seed 存在无点号键（ldap_base_dn），首段不是其模块名；
 * module 列是落库的所有权真源。空行降级返回空数组。
 */
export function groupSettingsByModule(rows: RbacSettingItem[]): RbacSettingCard[] {
	const framework = new Map<string, RbacSettingItem[]>();
	const solutions = new Map<string, Map<string, RbacSettingItem[]>>();
	for (const item of rows) {
		if (FRAMEWORK_SETTING_MODULES.has(item.module)) {
			(framework.get(item.group) ?? framework.set(item.group, []).get(item.group))!.push(item);
		}
		else {
			const groups = solutions.get(item.module) ?? solutions.set(item.module, new Map()).get(item.module)!;
			(groups.get(item.group) ?? groups.set(item.group, []).get(item.group))!.push(item);
		}
	}
	const cards: RbacSettingCard[] = [];
	for (const [group, items] of framework) {
		cards.push({ module: null, group, label_key: null, items });
	}
	for (const module of [...solutions.keys()].sort()) {
		for (const [group, items] of solutions.get(module)!) {
			cards.push({ module, group, label_key: `${module}:settings.group.${group}`, items });
		}
	}
	return cards;
}
