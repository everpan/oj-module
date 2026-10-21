import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { MenuItemType } from "#src/layout/layout-menu/types";

/**
 * 方案路由注册菜单归组（2026-10-21，docs/plans/2026-10-21-1028-solution-menu-grouping.md）。
 *
 * 纯函数、单一职责（SRP）：只把已生成的菜单做"视觉层归组"，不动路由树、不触碰
 * i18n/翻译（组标题存裸 i18n key，交由渲染层 translateMenus 翻译）。跨列表操作
 * （admin 项在 wholeMenus、`/system` 在 bottomMenus），故一次调用吃两段菜单。
 *
 * 依赖倒置（DIP）：告警通道 onWarn 由调用方注入，缺省为模块级 warnOnce，便于单测
 * 断言与生产环境接管。无副作用、不 mutate 入参（未变动项复用原引用，返回新数组）。
 */
export interface GroupSolutionMenusOptions {
	/** 宿主系统设置菜单 key，默认 "/system" */
	systemKey?: string
	/** 告警回调；缺省走模块级 warnOnce（同消息只打一次） */
	onWarn?: (msg: string) => void
}

const MAIN_PREFIX = "solgroup:main:";
const ADMIN_PREFIX = "solgroup:admin:";

/** 模块级 warnOnce：同会话同一消息只告警一次（防 host 反复触发轰炸） */
const warnedOnce = new Set<string>();
function defaultWarn(msg: string): void {
	if (warnedOnce.has(msg))
		return;
	warnedOnce.add(msg);
	console.warn(msg);
}

interface KeyedItem {
	item: MenuItemType
	row: SolutionRouteRow
}

/**
 * 处理单段菜单（顶层扫描，不递归 children）：
 * - main 路由：模块可见项 ≥2 则延迟建组（组插到该模块首个被摘项原序位）；否则原样直出；
 * - admin 路由：可挂载 `/system` 时摘除（交由调用方挂入 bottom 的 /system children），
 *   否则原样直出（回落顶层平铺，保持原序）；
 * - 无对应行项：原样直出。
 */
function processList(
	list: MenuItemType[],
	byPath: Map<string, SolutionRouteRow>,
	groupedModules: Set<string>,
	mountPossible: boolean,
): { out: MenuItemType[], adminItems: KeyedItem[] } {
	const out: MenuItemType[] = [];
	const groupsByModule = new Map<string, { items: MenuItemType[], rows: SolutionRouteRow[], firstIdx: number }>();
	const adminItems: KeyedItem[] = [];

	list.forEach((it, idx) => {
		const row = byPath.get(it.key);
		if (!row) {
			out.push(it);
			return;
		}
		if (row.category === "admin") {
			// 无论能否挂载都收集，供回落告警；可挂载时摘除（交由 /system children），否则留原序直出
			adminItems.push({ item: it, row });
			if (mountPossible)
				return;
			out.push(it);
			return;
		}
		// main
		if (groupedModules.has(row.module)) {
			let g = groupsByModule.get(row.module);
			if (!g) {
				g = { items: [], rows: [], firstIdx: idx };
				groupsByModule.set(row.module, g);
			}
			g.items.push(it);
			g.rows.push(row);
			return;
		}
		out.push(it);
	});

	// 建组并插入到该模块首个被摘项的原序位（保持升序序轴）
	const inserts = [...groupsByModule.values()]
		.map(g => ({
			index: g.firstIdx,
			group: makeGroup(MAIN_PREFIX, g.rows[0].module, g.items, g.rows),
		}))
		.sort((a, b) => b.index - a.index);
	for (const ins of inserts) {
		out.splice(ins.index, 0, ins.group);
	}

	return { out, adminItems };
}

function makeGroup(prefix: string, module: string, items: MenuItemType[], rows: SolutionRouteRow[]): MenuItemType {
	const paired = items.map((item, i) => ({ item, order: rows[i].order }))
		.sort((a, b) => a.order - b.order);
	return {
		key: `${prefix}${module}`,
		label: `${module}:menu.group`,
		children: paired.map(p => p.item),
	};
}

/**
 * 归组入口。
 *
 * - 空表（未安装/端点失败）或无命中行 → 返回新数组（内容相等），开发形态不变；
 * - 不 mutate 入参对象，未变动项复用原 menuItem 引用（仅重组数组与合成父项）。
 */
export function groupSolutionMenus(
	top: MenuItemType[],
	bottom: MenuItemType[],
	rows: SolutionRouteRow[],
	opts: GroupSolutionMenusOptions = {},
): { top: MenuItemType[], bottom: MenuItemType[] } {
	const systemKey = opts.systemKey ?? "/system";
	const onWarn = opts.onWarn ?? defaultWarn;

	if (rows.length === 0) {
		return { top: [...top], bottom: [...bottom] };
	}

	// 行索引：只认 main/admin 且 enabled（hidden/禁用此前已被上游经 hideInMenu 滤除，这里再兜底）
	const byPath = new Map<string, SolutionRouteRow>();
	for (const r of rows) {
		if ((r.category === "main" || r.category === "admin") && r.enabled !== false) {
			byPath.set(r.path, r);
		}
	}
	if (byPath.size === 0) {
		return { top: [...top], bottom: [...bottom] };
	}

	// 可见 main 计数（匹配存活菜单项，非行计数）
	const mainCount = new Map<string, number>();
	for (const list of [top, bottom]) {
		for (const it of list) {
			const row = byPath.get(it.key);
			if (row?.category === "main") {
				mainCount.set(row.module, (mainCount.get(row.module) ?? 0) + 1);
			}
		}
	}
	const groupedModules = new Set(
		[...mainCount].filter(([, n]) => n >= 2).map(([module]) => module),
	);

	const mountPossible = bottom.some(it => it.key === systemKey);

	const topRes = processList(top, byPath, groupedModules, mountPossible);
	const bottomRes = processList(bottom, byPath, groupedModules, mountPossible);

	// 合成 admin 组（按 module 分桶、组内按 order 升序），挂入 bottom 的 /system children 末尾
	const adminGroupsMap = new Map<string, KeyedItem[]>();
	for (const a of [...topRes.adminItems, ...bottomRes.adminItems]) {
		const arr = adminGroupsMap.get(a.row.module) ?? [];
		arr.push(a);
		adminGroupsMap.set(a.row.module, arr);
	}
	const adminGroups = [...adminGroupsMap.entries()]
		.map(([module, items]) => ({
			minOrder: Math.min(...items.map(i => i.row.order)),
			group: makeGroup(ADMIN_PREFIX, module, items.map(i => i.item), items.map(i => i.row)),
		}))
		.sort((a, b) => a.minOrder - b.minOrder);

	let newBottom = bottomRes.out;
	const sysIdx = newBottom.findIndex(it => it.key === systemKey);
	if (mountPossible && sysIdx !== -1) {
		const system = newBottom[sysIdx];
		newBottom = newBottom.slice();
		newBottom[sysIdx] = {
			...system,
			children: [...(system.children ?? []), ...adminGroups.map(g => g.group)],
		};
	}
	else if (adminGroups.length > 0) {
		// 宿主缺 /system：admin 项已按原序留在来源列表（processList 回落直出），仅告警一次
		onWarn(
			`[solution-menu-grouping] system menu "${systemKey}" not found; admin items keep top-level (grouping degraded).`,
		);
	}

	return { top: topRes.out, bottom: newBottom };
}
