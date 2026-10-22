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
			const rows = await db.table("users").select(["id", "username", "display_name", "avatar_base64", "email", "phone_number", "description", "must_change"]).where({ field: "id", op: "eq", value: Number(uid) }).all();
			const row = rows[0];
			if (!row) {
				json.fail(404, "user not found");
				return;
			}
			const roleRows = await db.table("sys_user_role").select(["role_name"]).where({ field: "user_id", op: "eq", value: Number(uid) }).all() as Array<{ role_name: string }>;
			json.ok({
				id: String(row.id),
				avatar: String(row.avatar_base64 ?? ""),
				username: String(row.username),
				displayName: row.display_name == null ? "" : String(row.display_name),
				email: String(row.email ?? ""),
				phoneNumber: row.phone_number == null ? "" : String(row.phone_number),
				description: row.description == null ? "" : String(row.description),
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
