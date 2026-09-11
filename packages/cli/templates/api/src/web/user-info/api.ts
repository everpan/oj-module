// GET /api/web/user-info —— 前端登录链用户信息端点（Bearer 守卫保护）。
// 按 http.user.id 查 users 表，snake_case → camelCase 映射；
// 响应一律走 json.ok/json.fail 信封（oj 红线）；前端 runtime 适配层（D10）
// 负责把 {code:0,data} 转成前端 {code:200,result}。
// avatar 读 avatar_base64（personal-center 头像上传回写，_platform 0002 迁移）。
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
