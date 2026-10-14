// oj v0.1.64 嵌套 handler 组：组名 = 路径段（login → POST /auth/login，路由不变）。
// DDD 判据：同聚合（会话生命周期）多动词收进单文件；
// 未来 register/reset/oauth 属新聚合、各自开目录。
const login = {
	// POST /api/auth/login —— 登录端点（devkit 手册 §8）。
	// db 查 users 表 → bcrypt.verify 校验密码 → jwt.sign 签发 access token；
	// refresh 为不透明随机串 + KV session（键存 sha256 摘要，不落明文）。
	// 响应信封载荷：{ access_token, refresh_token, expires_in(秒), user:{id, roles} }。
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

const logout = {
	// POST /api/auth/logout —— 登出端点（devkit 手册 §8）。
	// 删除 KV refresh session；access token 到期前仍有效（无状态 JWT，不做黑名单）。
	async post() {
		const body = (http.body ?? {}) as { refresh_token?: unknown };
		const refresh = String(body.refresh_token ?? "");
		if (refresh)
			await kv.del(`AUTH-SESSION:${crypto.sha256Hex(refresh)}`);
		json.ok(null);
	},
};

const refresh = {
	// POST /api/auth/refresh —— 刷新端点（devkit 手册 §8）。
	// 校验 KV refresh session 并**轮换**：旧 refresh 立即失效，签发新 access + 新 refresh。
	async post() {
		const body = (http.body ?? {}) as { refresh_token?: unknown };
		const refresh = String(body.refresh_token ?? "");
		if (!refresh) {
			json.fail(400, "refresh_token is required");
			return;
		}

		const key = `AUTH-SESSION:${crypto.sha256Hex(refresh)}`;
		const raw = await kv.get(key);
		if (!raw) {
			json.fail(401, "invalid refresh token");
			return;
		}
		// 轮换：先删旧 session，无论后续成败旧 token 都不再可用
		await kv.del(key);

		let session: { uid?: unknown, roles?: unknown };
		try {
			session = JSON.parse(raw);
		}
		catch {
			json.fail(401, "invalid refresh token");
			return;
		}
		const uid = String(session.uid ?? "");
		const roles = Array.isArray(session.roles) ? session.roles.map(String) : [];
		if (!uid) {
			json.fail(401, "invalid refresh token");
			return;
		}

		const rotated = crypto.randomHex();
		const newKey = `AUTH-SESSION:${crypto.sha256Hex(rotated)}`;
		await kv.set(newKey, JSON.stringify({ uid, roles }));
		await kv.expire(newKey, jwt.refreshDuration);

		json.ok({
			access_token: jwt.sign({ sub: uid, roles }),
			refresh_token: rotated,
			expires_in: jwt.accessDuration,
			user: { id: uid, roles },
		});
	},
};

export default { login, logout, refresh };
