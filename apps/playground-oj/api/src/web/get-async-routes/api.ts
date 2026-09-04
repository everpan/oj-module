// GET /api/web/get-async-routes —— 后端动态路由（Bearer 守卫保护）。
// 真实化（P2-2，F2 API 级权限差异演示）：按 http.user.roles 过滤 menus+role_menu，
// 拼成路由树返回。admin 见全量菜单，common 仅见首页/关于——两账号返回树不同。
//
// 注意：menus/role_menu 表归属 system 模块（P2-3 建表+seed）。此处为跨模块读，
// 默认 ownership_guard=warn 仅告警；生产可于 web/manifest.yaml 声明 deps:[system]
// 并切 ownership_guard=deny 收紧。表不存在时优雅回落空数组。
interface RouteNode {
	path: string
	handle: { title: string, icon?: string }
	children?: RouteNode[]
}

export default {
	async get() {
		const roles = http.user?.roles ?? [];
		if (roles.length === 0) {
			json.ok([]);
			return;
		}
		try {
			const placeholders = roles.map(() => "?").join(",");
			const rows = await db.query(
				`SELECT m.id, m.parent_id, m.name, m.path, m.icon, m.sort, m.menu_type
         FROM menus m
         JOIN role_menu rm ON rm.menu_id = m.id
         WHERE rm.role IN (${placeholders}) AND m.status = 1
         ORDER BY m.sort ASC`,
				roles,
			);

			const nodes = new Map<number, RouteNode>();
			for (const r of rows) {
				const id = Number(r.id);
				nodes.set(id, {
					path: String(r.path || `/${r.name}`),
					handle: {
						title: String(r.name),
						...(r.icon ? { icon: String(r.icon) } : {}),
					},
				});
			}

			const tree: RouteNode[] = [];
			for (const r of rows) {
				const node = nodes.get(Number(r.id))!;
				const pid = Number(r.parent_id);
				if (pid && nodes.has(pid)) {
					const parent = nodes.get(pid)!;
					parent.children = parent.children ?? [];
					parent.children.push(node);
				}
				else {
					tree.push(node);
				}
			}
			json.ok(tree);
		}
		catch {
			json.ok([]);
		}
	},
};
