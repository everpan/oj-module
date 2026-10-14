// oj v0.1.64 嵌套 handler 组：组名 = 路径段（login → POST /auth/login，路由不变）。
// DDD 判据：同聚合（会话生命周期）多动词收进单文件；
// 未来 register/reset/oauth 属新聚合、各自开目录。共享签发逻辑仍在 _shared/session.ts。
import { issueTokens, nowSecs, sessionKey } from "./_shared/session";

const login = {
	// POST /api/auth/login —— 登录（devkit 手册 §8：auth 端点是业务路由）。
	// 用户不存在与密码错同报 invalid credentials（不泄露用户存在性）。
	async post() {
		const body = http.body || {};
		const rows = await db.query(
			"select id, password_hash, roles from users where username = ?",
			[String(body.username ?? "")],
		);
		const row = rows[0];
		if (!row || !(await bcrypt.verify(String(body.password ?? ""), row.password_hash || ""))) {
			json.fail(401, "invalid credentials");
			return;
		}
		// roles 列按 JSON 数组串解析，失败回落空。
		let roles: string[] = [];
		try {
			roles = JSON.parse(row.roles || "[]");
		}
		catch {
			roles = [];
		}
		json.ok(await issueTokens(String(row.id), roles));
	},
};

const logout = {
	// POST /api/auth/logout —— 注销（删 refresh session；access 到期前仍有效）。
	async post() {
		const token = String((http.body || {}).refresh_token ?? "");
		await kv.del(sessionKey(token));
		json.ok(null);
	},
};

const refresh = {
	// POST /api/auth/refresh —— 刷新（轮换：旧 refresh 立即失效，一次一用）。
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

export default { login, logout, refresh };
