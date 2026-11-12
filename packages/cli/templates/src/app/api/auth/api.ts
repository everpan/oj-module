import { respond } from "#/_platform/_shared/respond";
// oj 嵌套 handler 组：组名 = 路径段（login → POST /api/auth/login，路由不变）。
// 阶段 B 登录链（D14/AC1-12/13/27）：领域逻辑全在 _shared/session.ts（createSession 注入 deps），
// handler 只编排：取参 → 调 service → json 信封；B5 限速收敛在 _shared/login-throttle.ts（与 ldap-login 共用）。
// refresh 存 DB（sys_refresh_token，§3.1），logout = 吊销当前串。
import { clientIp, guardLoginThrottle, noteLoginFailed, noteLoginSucceeded } from "./_shared/login-throttle";
import { createSession } from "./_shared/session";

// 模块级禁止 createSession()：oj build 的 introspect 在无 jwt 的空沙箱里评估模块（§9.4），
// runtimeDeps() 读 g.jwt 会直接炸构建——session 在 handler 内按需构造（无状态，纯闭包）。

/** 会话票据（TokenBundle）：登录 / 刷新 / 改密三处同形（D14 + AC1-27） */
const tokenBundle = {
	type: "object",
	required: ["access_token", "refresh_token", "expires_in", "restricted", "user"],
	properties: {
		access_token: { type: "string" },
		refresh_token: { type: "string" },
		expires_in: { type: "number" },
		restricted: { type: "boolean" },
		user: {
			type: "object",
			required: ["id", "username", "display_name", "avatar_base64", "must_change", "roles"],
			properties: {
				id: { type: "number" },
				username: { type: "string" },
				display_name: { type: ["string", "null"] },
				avatar_base64: { type: ["string", "null"] },
				must_change: { type: "boolean" },
				roles: { type: "array", items: { type: "string" } },
			},
		},
	},
};

const login = {
	// POST /api/auth/login —— 本地登录（D14：先验口令后查禁用，三种失败统一 401）。
	// B5/AC1-26：(IP, username) 连败阈值 → 429 + 指数 backoff；粗粒度 per-IP 窗口防撞库扫描。
	async post() {
		const body = http.body || {};
		const username = String(body.username ?? "");
		const tenant = String(body.tenant ?? "default");
		const ip = await clientIp();
		await respond(async () => {
			try {
				await guardLoginThrottle(ip, username);
				db.asTenant(tenant);
				const r = await createSession().localLogin(username, String(body.password ?? ""), tenant);
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
		const body = http.body || {};
		const token = String(body.refresh_token ?? "");
		const tenant = String(body.tenant ?? "default");
		db.asTenant(tenant);
		await db.table("sys_refresh_token").where({ field: "token_hash", op: "eq", value: crypto.sha256Hex(token) }).delete().run();
		json.ok(null);
	},
};

const refresh = {
	// POST /api/auth/refresh —— 轮换（旧串立即失效；reuse 检测在 service 内全族吊销+审计）。
	async post() {
		const body = http.body || {};
		const token = String(body.refresh_token ?? "");
		const tenant = String(body.tenant ?? "default");
		await respond(async () => {
			db.asTenant(tenant);
			return createSession().refresh(token);
		});
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
		const tenant = String((http.user?.claims as any)?.tenant ?? "default");
		await respond(async () => createSession().changePassword(Number(uid), String(body.old_password ?? ""), String(body.new_password ?? ""), tenant));
	},
};
// must_change 悬挂期唯一可用写端（AC1-27）；契约供 login/system 模板的改密 UI 使用
password.put.schema = {
	description: "自助改密：改本人密码，必须提供旧口令。must_change（首次登录/管理员重置后）悬挂期这是唯一可用的写端点。",
	body: {
		type: "object",
		required: ["old_password", "new_password"],
		properties: {
			old_password: { type: "string", minLength: 1, description: "当前口令。" },
			new_password: { type: "string", minLength: 6, description: "新口令，至少 6 位。" },
		},
	},
};

// 入参：本地账号口令（两种失败统一 401，不泄露账号状态——D14）
login.post.schema = {
	description: "本地账号口令登录（匿名端点）。账号不存在、口令错、账号停用统一返回 401（不泄露账号状态）；同一 IP+账号连续失败会触发 429 与指数退避。成功后返回 TokenBundle（access + refresh + 用户信息）。",
	body: {
		type: "object",
		required: ["username", "password"],
		properties: {
			username: { type: "string", minLength: 1, description: "登录账号名。" },
			password: { type: "string", minLength: 1, description: "登录口令（明文传输仅在 HTTPS 下）。" },
			tenant: { type: "string", description: "租户标识，缺省 default。" },
		},
	},
};
login.post.response = tokenBundle;

// 登出：吊销给定 refresh 串（无业务返回体）
logout.post.schema = {
	description: "吊销传入的 refresh token。注意 access token 在到期前仍然有效——这是既定的无状态 JWT 语义。",
	body: {
		type: "object",
		required: ["refresh_token"],
		properties: { refresh_token: { type: "string", minLength: 1 }, tenant: { type: "string" } },
	},
};
logout.post.response = { type: "null" };

// 刷新：旧串轮换（reuse 检测在 service 内）
refresh.post.schema = {
	description: "用 refresh token 换新会话（轮换：旧串立即失效）。服务层检测到旧串被复用会吊销整族并记审计。",
	body: {
		type: "object",
		required: ["refresh_token"],
		properties: { refresh_token: { type: "string", minLength: 1 }, tenant: { type: "string" } },
	},
};
refresh.post.response = tokenBundle;

password.put.response = tokenBundle;

export default { login, logout, refresh, password };
