import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { MenuItemType } from "#src/layout/layout-menu/types";

/**
 * 方案路由注册菜单归组（2026-10-21 设计；0.2.17 起）：
 *
 * - flat main 归组已取消：category==="main" 不再按模块建父菜单，模块根路由本身即
 *   第一级菜单（entry.ts 单根约定），其子项直出（visible 由 category/hideInMenu 决定）。
 * - admin 真重写：路由 PATH 已由 rewriteAdminPaths（access.ts）在注入前改写为
 *   /system/<模块 root path>/*，故此处收到的 admin 菜单项 key 已是 /system/...；
 *   本函数只做"视觉层归组"——递归收集 category==="admin" 项，按 module 建子组，
 *   挂入 /system children 末尾，组标题存裸 i18n key `<module>:menu.main`（渲染层翻译）。
 *
 * 纯函数、单一职责（SRP）：只把已生成的菜单做"视觉层归组"，不动路由树、不触碰翻译。
 * 跨列表操作（admin 项可能在 wholeMenus、`/system` 在 bottomMenus），故一次调用吃两段菜单。
 *
 * 依赖倒置（DIP）：告警通道 onWarn 由调用方注入，缺省为模块级 warnOnce，便于单测断言。
 * 无副作用、不 mutate 入参（未变动项复用原引用，返回新数组）。
 */
export interface GroupSolutionMenusOptions {
	/** 宿主系统设置菜单 key，默认 "/system" */
	systemKey?: string
	/** 告警回调；缺省走模块级 warnOnce（同消息只打一次） */
	onWarn?: (msg: string) => void
}

const ADMIN_PREFIX = "solgroup:admin:";

/** 模块级 warnOnce：同会话同一消息只告警一次（防 host 反复触发轰炸） */
const warnedOnce = new Set<string>();
function defaultWarn(msg: string): void {
	if (warnedOnce.has(msg))
		return;
	warnedOnce.add(msg);
	console.warn(msg);
}

/** 取某 item 的有效归组元数据（handle 优先，行回退） */
function effective(item: MenuItemType, row: SolutionRouteRow | undefined): { module: string | undefined, category: MenuItemType["category"] } {
	const module = item.module ?? row?.module;
	const category = item.category ?? row?.category;
	return { module, category };
}

/**
 * 递归摘除 category==="admin" 的菜单项（handle 优先、行回退兜底），按 module 分桶收集；
 * 收集时压平 admin 项自身的层级——直接取 admin 项的 children，使"管理"中间级消失、
 * 子项直挂 `<module>:menu.main` 子组下，无 children 时退回 admin 项本身。
 * 其余项原样保留（children 递归同样处理），非突变；无变动的子树复用原引用。
 *
 * 返回新数组（有项被摘除/被重写父级时）或原数组引用（整段无 admin 时），便于调用方
 * 判断是否需重建 /system children（避免无 admin 项时给 /system 强加空 children）。
 */
function stripAdmin(
	list: MenuItemType[],
	byPath: Map<string, SolutionRouteRow>,
	buckets: Map<string, { items: MenuItemType[], module: string, minOrder: number }>,
): MenuItemType[] {
	let changed = false;
	const out: MenuItemType[] = [];
	for (const it of list) {
		const { module, category } = effective(it, byPath.get(it.key));
		if (category === "admin" && module) {
			const subItems = (it.children && it.children.length > 0) ? it.children : [it];
			const bucket = buckets.get(module) ?? { items: [], module, minOrder: Infinity };
			for (const s of subItems)
				bucket.items.push(s);
			bucket.minOrder = Math.min(bucket.minOrder, it.order ?? 0);
			buckets.set(module, bucket);
			changed = true; // 从原位置摘除
			continue;
		}
		if (it.children && it.children.length > 0) {
			const newChildren = stripAdmin(it.children, byPath, buckets);
			if (newChildren !== it.children) {
				changed = true;
				out.push({ ...it, children: newChildren });
			}
			else {
				out.push(it);
			}
		}
		else {
			out.push(it);
		}
	}
	return changed ? out : list;
}

function makeAdminGroup(module: string, items: MenuItemType[]): MenuItemType {
	const paired = items
		.map(item => ({ item, order: item.order ?? 0 }))
		.sort((a, b) => a.order - b.order);
	return {
		key: `${ADMIN_PREFIX}${module}`,
		label: `${module}:menu.main`,
		children: paired.map(p => p.item),
	};
}

/**
 * 归组入口。
 *
 * @param top 主区菜单项（order >= 0）
 * @param bottom 底部固定区菜单项（order < 0，含 /system）
 * @param rows 宿主方案路由行（可选）：缺省或空时归组完全依赖 handle 元数据（dev 形态）；
 *   提供时仅作 category 的向后兼容回退（0.2.15 已装站点），不参与新 bundle 的归组真源。
 * @param opts 选项（systemKey / onWarn）
 */
export function groupSolutionMenus(
	top: MenuItemType[],
	bottom: MenuItemType[],
	rows?: SolutionRouteRow[],
	opts: GroupSolutionMenusOptions = {},
): { top: MenuItemType[], bottom: MenuItemType[] } {
	const systemKey = opts.systemKey ?? "/system";
	const onWarn = opts.onWarn ?? defaultWarn;

	// 回退用行索引：只认 admin 且 enabled（hidden/禁用此前已在上游 hideInMenu 滤除）
	const byPath = new Map<string, SolutionRouteRow>();
	for (const r of rows ?? []) {
		if (r.category === "admin" && r.enabled !== false)
			byPath.set(r.path, r);
	}

	// 递归摘除 admin 项并按模块分桶（组标题用 <module>:menu.main，组内压平 admin 中间级）
	const buckets = new Map<string, { items: MenuItemType[], module: string, minOrder: number }>();
	const newTop = stripAdmin(top, byPath, buckets);
	const newBottom = stripAdmin(bottom, byPath, buckets);

	const adminGroups = [...buckets.entries()]
		.map(([module, b]) => ({
			minOrder: b.minOrder,
			group: makeAdminGroup(module, b.items),
		}))
		.sort((a, b) => a.minOrder - b.minOrder);

	let resultBottom = newBottom;
	const sysIdx = newBottom.findIndex(it => it.key === systemKey);
	if (adminGroups.length > 0) {
		if (sysIdx !== -1) {
			// 仅当有 admin 组要挂入时才改写 /system（避免无 admin 项时强加空 children）
			const system = newBottom[sysIdx]!;
			resultBottom = newBottom.slice();
			resultBottom[sysIdx] = {
				...system,
				children: [...(system.children ?? []), ...adminGroups.map(g => g.group)],
			};
		}
		else {
			// 宿主缺 /system：admin 项已从原位置摘除且无处挂载，仅告警一次（避免菜单丢失静默）
			onWarn(
				`[solution-menu-grouping] system menu "${systemKey}" not found; admin items dropped from menu.`,
			);
		}
	}

	return { top: newTop, bottom: resultBottom };
}
