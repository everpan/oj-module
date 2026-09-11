// GET /api/web/user-info —— 前端登录链用户信息端点（Bearer 守卫保护）。
// 真实化（P2-2）：按 http.user.id 查 users 表，snake_case → camelCase 映射。
// 响应走 oj 统一信封 json.ok/json.fail（全站唯一红线 {code,msg,data}）。
export default {
	async get() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		try {
			const rows = await db.query(
				"SELECT id, username, roles, avatar_base64 FROM users WHERE id = ?",
				[Number(uid)],
			);
			const row = rows[0];
			if (!row) {
				json.fail(404, "user not found");
				return;
			}
			let roles: string[] = [];
			try {
				const parsed = JSON.parse(String(row.roles ?? "[]"));
				if (Array.isArray(parsed))
					roles = parsed as string[];
			}
			catch {
				roles = [];
			}
			json.ok({
				id: String(row.id),
				avatar: String(row.avatar_base64 ?? ""),
				username: String(row.username),
				email: "",
				phoneNumber: "",
				description: "",
				roles,
				permissions: [],
			});
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
