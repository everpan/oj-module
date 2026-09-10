// POST /api/auth/refresh —— 刷新端点（devkit 手册 §8）。
// 校验 KV refresh session 并**轮换**：旧 refresh 立即失效，签发新 access + 新 refresh。
export default {
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
