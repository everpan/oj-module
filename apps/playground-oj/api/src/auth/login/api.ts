// POST /api/auth/login —— 登录端点（业务路由，devkit 手册 §8）。
// db 查 users 表 → bcrypt.verify 校验密码 → jwt.sign 签发 access token；
// refresh 为不透明随机串 + KV session（键存 sha256 摘要，不落明文）。
// 响应信封载荷：{ access_token, refresh_token, expires_in(秒), user:{id, roles} }。
export default {
	async post() {
		const body = (http.body ?? {}) as { username?: unknown, password?: unknown };
		const username = String(body.username ?? "").trim();
		const password = String(body.password ?? "");
		if (!username || !password) {
			json.fail(400, "username and password are required");
			return;
		}

		const rows = await db.query(
			"SELECT id, username, password_hash, roles FROM users WHERE username = ?",
			[username],
		);
		const row = rows[0];
		// 统一报 invalid credentials，不区分用户不存在/密码错（手册 §8）
		if (!row || !(await bcrypt.verify(password, String(row.password_hash)))) {
			json.fail(401, "invalid credentials");
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

		const uid = String(row.id);
		const refresh = crypto.randomHex();
		const sessionKey = `AUTH-SESSION:${crypto.sha256Hex(refresh)}`;
		await kv.set(sessionKey, JSON.stringify({ uid, roles }));
		await kv.expire(sessionKey, jwt.refreshDuration);

		json.ok({
			access_token: jwt.sign({ sub: uid, roles }),
			refresh_token: refresh,
			expires_in: jwt.accessDuration,
			user: { id: uid, roles },
		});
	},
};
