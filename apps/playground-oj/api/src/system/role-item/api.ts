// POST/PUT/DELETE /api/system/role-item —— 角色增改删（AC-D9 apiPrefix=/system）。
// 真实化（P3-1）：roles 表 CRUD；绑定菜单落到 role_menu（role 列存角色 CODE，
// 与 seed 及 get-async-routes 的 JOIN 口径一致）。DELETE 方法名 del（oj 约定）。
async function bindMenus(roleCode: string, menus: unknown): Promise<void> {
	await db.exec("DELETE FROM role_menu WHERE role = ?", [roleCode]);
	if (Array.isArray(menus)) {
		for (const mid of menus) {
			await db.exec(
				"INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES (?, ?)",
				[roleCode, Number(mid)],
			);
		}
	}
}

export default {
	async post() {
		const b = http.body ?? {};
		const now = Date.now();
		try {
			const ins = await db.query(
				`INSERT INTO roles (name, code, status, remark, create_time, update_time)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
				[String(b.name), String(b.code), Number(b.status), String(b.remark ?? ""), now, now],
			);
			const id = Number(ins[0].id);
			await bindMenus(String(b.code), b.menus);
			json.ok({
				id,
				name: String(b.name),
				code: String(b.code),
				status: Number(b.status),
				remark: String(b.remark ?? ""),
				menus: Array.isArray(b.menus) ? b.menus.map((m: unknown) => Number(m)) : [],
			});
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},

	async put() {
		const b = http.body ?? {};
		const id = Number(b.id);
		const now = Date.now();
		try {
			await db.exec(
				"UPDATE roles SET name = ?, code = ?, status = ?, remark = ?, update_time = ? WHERE id = ?",
				[String(b.name), String(b.code), Number(b.status), String(b.remark ?? ""), now, id],
			);
			await bindMenus(String(b.code), b.menus);
			json.ok({
				id,
				name: String(b.name),
				code: String(b.code),
				status: Number(b.status),
				remark: String(b.remark ?? ""),
				menus: Array.isArray(b.menus) ? b.menus.map((m: unknown) => Number(m)) : [],
			});
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},

	async del() {
		const id = Number(http.body);
		try {
			const rows = await db.query("SELECT code FROM roles WHERE id = ?", [id]);
			if (rows.length) {
				await db.exec("DELETE FROM role_menu WHERE role = ?", [String(rows[0].code)]);
				await db.exec("DELETE FROM roles WHERE id = ?", [id]);
			}
			json.ok(id);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
