// GET /api/system/menu-list —— 菜单列表（AC-D9 apiPrefix=/system）。
// 真实化（P3-1）：全量读 system.menus 映射为 MenuItemType，包装成列表信封。
function toMenuItem(r: Record<string, any>): Record<string, any> {
	return {
		id: Number(r.id),
		parentId: String(r.parent_id),
		menuType: Number(r.menu_type),
		name: String(r.name),
		path: String(r.path),
		component: String(r.component),
		order: Number(r.sort),
		icon: String(r.icon),
		currentActiveMenu: String(r.current_active_menu),
		iframeLink: String(r.iframe_link),
		keepAlive: Number(r.keep_alive),
		externalLink: String(r.external_link),
		hideInMenu: Number(r.hide_in_menu),
		ignoreAccess: Number(r.ignore_access),
		permission: String(r.permission),
		status: Number(r.status),
		createTime: Number(r.create_time),
		updateTime: Number(r.update_time),
	};
}

const MENU_COLS = `id, parent_id, name, path, component, icon, sort, menu_type,
  permission, status, current_active_menu, iframe_link, keep_alive,
  external_link, hide_in_menu, ignore_access, create_time, update_time`;

export default {
	async get() {
		try {
			const rows = await db.query(`SELECT ${MENU_COLS} FROM menus ORDER BY sort ASC`, []);
			const list = rows.map(toMenuItem);
			json.ok({ list, total: list.length, current: 1 });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
