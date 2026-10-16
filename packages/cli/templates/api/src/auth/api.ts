// oj 嵌套 handler 组：组名 = 路径段（login → POST /api/auth/login，路由不变）。
// 阶段 B 登录链（D14/AC1-12/13/27）：领域逻辑全在 _shared/session.ts（createSession 注入 deps），
// handler 只编排：取参 → 调 service → json 信封；B5 限速在 login handler 挂 rate.ts。
// refresh 存 DB（sys_refresh_token，§3.1），logout = 吊销当前串。
import { auditOp } from "../../_platform/_shared/service/audit";
import { rateLimit } from "../../_platform/_shared/service/rate";
import { createSession } from "./_shared/session";

const session = createSession();

async function clientIp(): Promise<string> {
	return String((http.headers || {})["x-forwarded-for"] ?? http.headers?.["x-real-ip"] ?? "unknown");
}

const login = {
	// POST /api/auth/login —— 本地登录（D14：先验口令后查禁用，三种失败统一 401）。
	async post() {
		const body = http.body || {};
		const username = String(body.username ?? "");
		const ip = await clientIp();
		try {
			// B5 双维度限速（IP + username），限额/backoff 随登录失败次数升级
			await rateLimit(`login:ip:${ip}`, 20, 60_000);
			await rateLimit(`login:u:${username}`, 5, 60_000);
			json.ok(await session.localLogin(username, String(body.password ?? "")));
		}
		catch (e) {
			const err = e as Error & { status?: number };
			if (err.status === 401)
				auditOp({ action: "auth.login.fail", module: "framework", target: username, level: 4 });
			throw e;
		}
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
		json.ok(await session.refresh(token));
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
		json.ok(await session.changePassword(Number(uid), String(body.old_password ?? ""), String(body.new_password ?? "")));
	},
};

export default { login, logout, refresh, password };
