// POST /api/auth/logout —— 登出端点（devkit 手册 §8）。
// 删除 KV refresh session；access token 到期前仍有效（无状态 JWT，不做黑名单）。
export default {
	async post() {
		const body = (http.body ?? {}) as { refresh_token?: unknown };
		const refresh = String(body.refresh_token ?? "");
		if (refresh)
			await kv.del(`AUTH-SESSION:${crypto.sha256Hex(refresh)}`);
		json.ok(null);
	},
};
