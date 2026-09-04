// GET /api/system/menu-by-role-id —— 按角色 id 查绑定的菜单 id 列表（AC-D9 apiPrefix=/system）。
// 真实化（P3-1）：role_menu.role 存角色 CODE，故先由角色 id 取 code 再查 menu_id。
export default {
	async get() {
		const id = Number(http.query.id);
		try {
			const roles = await db.query("SELECT code FROM roles WHERE id = ?", [id]);
			if (!roles.length) {
				json.ok([]);
				return;
			}
			const code = String(roles[0].code);
			const rows = await db.query("SELECT menu_id FROM role_menu WHERE role = ?", [code]);
			json.ok(rows.map(r => Number(r.menu_id)));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
