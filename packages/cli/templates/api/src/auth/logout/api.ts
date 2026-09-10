import { sessionKey } from "../_shared/session";

// POST /api/auth/logout —— 注销（删 refresh session；access 到期前仍有效）。
export default {
	async post() {
		const token = String((http.body || {}).refresh_token ?? "");
		await kv.del(sessionKey(token));
		json.ok(null);
	},
};
