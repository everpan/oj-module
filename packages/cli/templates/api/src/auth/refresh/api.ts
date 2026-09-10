import { issueTokens, nowSecs, sessionKey } from "../_shared/session";

// POST /api/auth/refresh —— 刷新（轮换：旧 refresh 立即失效，一次一用）。
export default {
	async post() {
		const token = String((http.body || {}).refresh_token ?? "");
		const key = sessionKey(token);
		const raw = await kv.get(key);
		const sess = raw ? JSON.parse(raw) : null;
		if (!sess || !(sess.exp > nowSecs())) {
			json.fail(401, "invalid or expired refresh token");
			return;
		}
		// session 只存 uid——roles 重查库取最新。
		const rows = await db.query("select roles from users where id = ?", [sess.uid]);
		let roles: string[] = [];
		try {
			roles = JSON.parse((rows[0] || {}).roles || "[]");
		}
		catch {
			roles = [];
		}
		await kv.del(key);
		json.ok(await issueTokens(String(sess.uid), roles));
	},
};
