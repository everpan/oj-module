// R5：manifest.yaml `routes` 由 entry.ts 路由 handle 自动派生（单一真源）。
//
// 背景：0.2.15 时期 manifest.routes 由作者手工书写，且 runtime 分组还依赖
// `sys_solution_route` 表行（dev 下该表空 → 不分组，见上游 wiki parity 方案 R1–R6）。
// 0.2.16 起：category/order/title 的真源是 entry.ts 路由 handle，manifest.routes
// 改为 build 期从 handle 派生，杜绝「entry.ts 改了 handle 但 manifest.yaml 没同步」的漂移。
//
// 派生口径（仅取顶层一级菜单路由；children 是动态段/子页，不进 manifest routes）：
//   - handle.category ∈ {main,admin,hidden} 才纳入（无 category 的路由不进菜单，跳过）
//   - path      ← route.path
//   - category  ← handle.category
//   - order     ← handle.order（缺省不写，交 C2-17 契约校验报「必填整数」）
//   - title_key ← handle.title（main/admin 必填且须匹配 <name>:menu.*，契约校验）
//
// 兼容：entry.ts 未声明任何 category 路由时（迁移前的旧方案），调用方保留 manifest
// 既有 routes，不强制覆盖——避免未迁移方案构建即坏。

/** entry.ts 路由树节点（派生只读字段，宽松结构，避免 import runtime 类型形成环） */
export interface RouteDefinitionLike {
	path?: string
	handle?: {
		category?: "main" | "admin" | "hidden"
		order?: number
		title?: string
		[key: string]: unknown
	}
	children?: RouteDefinitionLike[]
	[key: string]: unknown
}

/** 派生出的 manifest route 契约项（字段口径见 C2-17） */
export interface DerivedRoute {
	path: string
	category: "main" | "admin" | "hidden"
	order?: number
	title_key?: string
}

/** 模块定义（只需 name + routes 子集，宽松结构） */
export interface ModuleDefinitionLike {
	name: string
	routes?: RouteDefinitionLike[]
	[key: string]: unknown
}

/**
 * 从 entry.ts 模块定义派生 manifest routes（仅顶层一级菜单路由）。
 * 不抛异常：handle 缺字段时照常产出，交由 C2-17 契约校验报出具体违规项。
 */
export function deriveManifestRoutes(definition: ModuleDefinitionLike): DerivedRoute[] {
	const routes = Array.isArray(definition.routes) ? definition.routes : [];
	const out: DerivedRoute[] = [];
	for (const r of routes) {
		if (r === null || typeof r !== "object")
			continue;
		const handle = (typeof r.handle === "object" && r.handle !== null) ? r.handle : undefined;
		const category = handle?.category;
		if (category !== "main" && category !== "admin" && category !== "hidden")
			continue;
		if (typeof r.path !== "string" || r.path.length === 0)
			continue;
		const route: DerivedRoute = { path: r.path, category };
		if (typeof handle?.order === "number")
			route.order = handle.order;
		if (typeof handle?.title === "string")
			route.title_key = handle.title;
		out.push(route);
	}
	return out;
}

/**
 * 归并既有 manifest routes 与 entry.ts 派生 routes，返回最终采用项 + 警告。
 *
 * 规则（单一真源 = entry.ts）：
 *   - derived 为空（entry.ts 未声明任何 category 路由）→ 沿用 existing，不覆盖（向后兼容）
 *   - derived 非空 → 以 derived 为准；若 existing 非空且与 derived 在某 path 上漂移
 *     （category/order/title_key 任一不一致）→ 追加警告（不阻断，R5 选择项「自动生成」而非「双写+校验」）
 */
export function reconcileManifestRoutes(
	existing: unknown[],
	derived: DerivedRoute[],
): { routes: DerivedRoute[], warnings: string[] } {
	const warnings: string[] = [];
	if (derived.length === 0) {
		// 未迁移方案：保留 manifest 既有 routes，等作者后续在 entry.ts 登记 category
		return { routes: normalizeExisting(existing), warnings };
	}
	const existingByPath = new Map<string, DerivedRoute>();
	for (const r of normalizeExisting(existing)) {
		existingByPath.set(r.path, r);
	}
	const drift: DerivedRoute[] = [];
	for (const d of derived) {
		const e = existingByPath.get(d.path);
		if (e === undefined)
			continue;
		if (e.category !== d.category || e.order !== d.order || e.title_key !== d.title_key) {
			drift.push(d);
		}
	}
	if (existing.length > 0 && drift.length > 0) {
		warnings.push(
			`[ojm] manifest.yaml 既有 routes 与 entry.ts 派生结果不一致，已采用 entry.ts 为准（R5 单一真源，避免手工双写漂移）：\n${
				drift.map(d => `- ${d.path}（派生 category=${d.category} order=${d.order ?? "?"} title_key=${d.title_key ?? "?"})`).join("\n")}`,
		);
	}
	return { routes: derived, warnings };
}

function normalizeExisting(existing: unknown[]): DerivedRoute[] {
	const out: DerivedRoute[] = [];
	for (const r of existing) {
		if (r === null || typeof r !== "object")
			continue;
		const o = r as Record<string, unknown>;
		if (typeof o.path !== "string")
			continue;
		const cat = o.category;
		if (cat !== "main" && cat !== "admin" && cat !== "hidden")
			continue;
		const route: DerivedRoute = { path: o.path, category: cat };
		if (typeof o.order === "number")
			route.order = o.order;
		if (typeof o.title_key === "string")
			route.title_key = o.title_key;
		out.push(route);
	}
	return out;
}
