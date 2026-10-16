import { respond } from "../_platform/_shared/respond";
// oj 嵌套 handler 组：组名 = 路径段（login → POST /api/auth/login，路由不变）。
// 阶段 B 登录链（D14/AC1-12/13/27）：领域逻辑全在 _shared/session.ts（createSession 注入 deps），
// handler 只编排：取参 → 调 service → json 信封；B5 限速收敛在 _shared/login-throttle.ts（与 ldap-login 共用）。
// refresh 存 DB（sys_refresh_token，§3.1），logout = 吊销当前串。
import { clientIp, guardLoginThrottle, noteLoginFailed, noteLoginSucceeded } from "./_shared/login-throttle";
import { createSession } from "./_shared/session";

// 模块级禁止 createSession()：oj build 的 introspect 在无 jwt 的空沙箱里评估模块（§9.4），
// runtimeDeps() 读 g.jwt 会直接炸构建——session 在 handler 内按需构造（无状态，纯闭包）。

const login = {
	// POST /api/auth/login —— 本地登录（D14：先验口令后查禁用，三种失败统一 401）。
	// B5/AC1-26：(IP, username) 连败阈值 → 429 + 指数 backoff；粗粒度 per-IP 窗口防撞库扫描。
	async post() {
		const body = http.body || {};
		const username = String(body.username ?? "");
		const ip = await clientIp();
		await respond(async () => {
			try {
				await guardLoginThrottle(ip, username);
				const r = await createSession().localLogin(username, String(body.password ?? ""));
				await noteLoginSucceeded(ip, username);
				return r;
			}
			catch (e) {
				if ((e as Error & { status?: number }).status === 401)
					await noteLoginFailed(ip, username);
				throw e; // respond 收口：err.status/extra → json.fail 信封（oj 未捕获异常恒 500）
			}
		});
	},
};

const logout = {
	// POST /api/auth/logout —— 吊销当前 refresh 串（access 到期前仍有效，语义同旧版）。
	async post() {
		const token = String((http.body || {}).refresh_token ?? "");
		await db.exec("delete from sys_refresh_token where token_hash = ?", [crypto.sha256Hex(token)]);
		json.ok(null);
	},
};

const refresh = {
	// POST /api/auth/refresh —— 轮换（旧串立即失效；reuse 检测在 service 内全族吊销+审计）。
	async post() {
		const token = String((http.body || {}).refresh_token ?? "");
		await respond(async () => createSession().refresh(token));
	},
};

const password = {
	// PUT /api/auth/password —— 自助改密（AC1-27：本人+旧口令；悬挂期唯一可用写端）。
	async put() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		const body = http.body || {};
		await respond(async () => createSession().changePassword(Number(uid), String(body.old_password ?? ""), String(body.new_password ?? "")));
	},
};

export default { login, logout, refresh, password };
