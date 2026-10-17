import { respond } from "../_shared/respond";
// 平台方案路由读端点 /api/_platform/solutions/routes（P1-14，R21 前端归并数据源）。
// 登录即可、只读、无权限点（contacts/api.ts 同纪律）；读操作不记审计。
// 只下发未 deprecated 行全列：path/module/category/order/title_key/required_permission/enabled
// （required_permission 仅供深检对比，前端不做权限级菜单过滤，R22 语义保持）；
// enabled=0（禁用）行保留下发——菜单层过滤在前端，路由摘除归装载层（D12 三处同写）。
// 行序稳定：module → order → path（前端归并与快照对账的确定性基线）。

/** 线格式行（与 packages/runtime/src/api/rbac/types.ts 的 SolutionRouteRow 对齐） */
interface SolutionRouteRow {
	path: string
	module: string
	category: "main" | "admin" | "hidden"
	order: number
	title_key: string | null
	required_permission: string | null
	enabled: boolean
}

export default {
	// GET /api/_platform/solutions/routes —— 前端归并数据源（登录即可）。
	routes: {
		async get() {
			// 登录门在 respond 外（contacts 同款：respond 收口业务体，json 恰一次出口）
			if (!http.user?.id) {
				json.fail(401, "unauthorized");
				return;
			}
			await respond(async () => {
				const rows = await db.query(
					`select path, module, category, "order", title_key, required_permission, enabled
					from sys_solution_route where deprecated = 0 order by module, "order", path`,
				) as Array<Record<string, unknown>>;
				return rows.map<SolutionRouteRow>(r => ({
					path: String(r.path),
					module: String(r.module),
					category: r.category === "admin" || r.category === "hidden" ? r.category : "main",
					order: Number(r.order),
					title_key: r.title_key == null ? null : String(r.title_key),
					required_permission: r.required_permission == null ? null : String(r.required_permission),
					enabled: Number(r.enabled) === 1,
				}));
			});
		},
	},
};
