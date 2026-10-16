// GET /api/web/user-info —— 前端登录链用户信息端点（Bearer 守卫保护）。
// B4：roles 出自 sys_user_role 权威源（users.roles JSON 列已被 0003 移除，D10）——
// 体验层角色走本资料接口，不进 JWT claims；avatar 读 avatar_base64，email 读 0007 迁移列。
// 响应一律走 json.ok/json.fail 信封（oj 红线）。
export default {
	async get() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		try {
			const rows = await db.query(
				"SELECT id, username, display_name, avatar_base64, email, must_change FROM users WHERE id = ?",
				[Number(uid)],
			);
			const row = rows[0];
			if (!row) {
				json.fail(404, "user not found");
				return;
			}
			const roleRows = await db.query("SELECT role_name FROM sys_user_role WHERE user_id = ?", [Number(uid)]) as Array<{ role_name: string }>;
			json.ok({
				id: String(row.id),
				avatar: String(row.avatar_base64 ?? ""),
				username: String(row.username),
				displayName: row.display_name == null ? "" : String(row.display_name),
				email: String(row.email ?? ""),
				roles: roleRows.map(r => r.role_name),
				mustChange: Number(row.must_change) === 1,
				permissions: [],
			});
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
