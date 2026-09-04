// POST/PUT/DELETE /api/system/menu-item —— 菜单增改删（AC-D9 apiPrefix=/system）。
// 真实化（P3-1）：menus 表 CRUD；字段全参数绑定，camel→snake。DELETE 名 del。
// order 为 SQL 保留字，落库用 sort 列（MenuItemType.order 映射 sort）。
const MENU_INSERT_COLS = `parent_id, name, path, component, icon, sort, menu_type,
  permission, status, current_active_menu, iframe_link, keep_alive,
  external_link, hide_in_menu, ignore_access, create_time, update_time`;
const MENU_UPDATE_COLS = `parent_id = ?, name = ?, path = ?, component = ?, icon = ?, sort = ?,
  menu_type = ?, permission = ?, status = ?, current_active_menu = ?, iframe_link = ?,
  keep_alive = ?, external_link = ?, hide_in_menu = ?, ignore_access = ?, update_time = ?`;

function insertParams(b: Record<string, any>, now: number): unknown[] {
	return [
		Number(b.parentId ?? 0),
		String(b.name),
		String(b.path),
		String(b.component),
		String(b.icon),
		Number(b.order ?? 0),
		Number(b.menuType ?? 0),
		String(b.permission ?? ""),
		Number(b.status ?? 1),
		String(b.currentActiveMenu ?? ""),
		String(b.iframeLink ?? ""),
		Number(b.keepAlive ?? 0),
		String(b.externalLink ?? ""),
		Number(b.hideInMenu ?? 0),
		Number(b.ignoreAccess ?? 0),
		now,
		now,
	];
}

export default {
	async post() {
		const b = http.body ?? {};
		const now = Date.now();
		try {
			const ins = await db.query(
				`INSERT INTO menus (${MENU_INSERT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
				insertParams(b, now),
			);
			json.ok(String(ins[0].id));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},

	async put() {
		const b = http.body ?? {};
		const now = Date.now();
		try {
			const up = [
				Number(b.parentId ?? 0),
				String(b.name),
				String(b.path),
				String(b.component),
				String(b.icon),
				Number(b.order ?? 0),
				Number(b.menuType ?? 0),
				String(b.permission ?? ""),
				Number(b.status ?? 1),
				String(b.currentActiveMenu ?? ""),
				String(b.iframeLink ?? ""),
				Number(b.keepAlive ?? 0),
				String(b.externalLink ?? ""),
				Number(b.hideInMenu ?? 0),
				Number(b.ignoreAccess ?? 0),
				now,
				Number(b.id),
			];
			await db.exec(`UPDATE menus SET ${MENU_UPDATE_COLS} WHERE id = ?`, up);
			json.ok(String(b.id));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},

	async del() {
		const id = Number(http.body);
		try {
			await db.exec("DELETE FROM role_menu WHERE menu_id = ?", [id]);
			await db.exec("DELETE FROM menus WHERE id = ?", [id]);
			json.ok(String(id));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
