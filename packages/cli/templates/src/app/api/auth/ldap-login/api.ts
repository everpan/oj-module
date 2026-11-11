// POST /api/auth/ldap-login —— LDAP 目录登录（D1/AC1-12；匿名端点，E6：anonymous_paths 写 /auth/ldap-login）。
// 编排：B5 限速守卫（与 auth/login 同维度）→ ldapLogin 九步 → respond 统一异常出口（§9.3-1）。
import { respond } from "#/_platform/_shared/respond";
import { createLdapLogin, runtimeLdapGateway } from "../_shared/ldap-login";
import { clientIp, guardLoginThrottle, noteLoginFailed, noteLoginSucceeded } from "../_shared/login-throttle";
import { createSession } from "../_shared/session";

// 模块级禁止 createSession()/runtimeLdapGateway()：oj build introspect 的空沙箱无 jwt/axis（§9.4）。

const handler = {
	async post() {
		const body = http.body || {};
		const username = String(body.username ?? "");
		const tenant = String(body.tenant ?? "default");
		const ip = await clientIp();
		await respond(async () => {
			try {
				await guardLoginThrottle(ip, username);
				db.asTenant(tenant);
				const r = await createLdapLogin(createSession(), runtimeLdapGateway(), tenant)(username, String(body.password ?? ""));
				await noteLoginSucceeded(ip, username);
				return r;
			}
			catch (e) {
				if ((e as Error & { status?: number }).status === 401)
					await noteLoginFailed(ip, username);
				throw e; // respond 收口：err.status/extra → json.fail 信封
			}
		});
	},
};

// 入参与本地登录同形（username/password）；出参同 TokenBundle
handler.post.schema = {
	body: {
		type: "object",
		required: ["username", "password"],
		properties: {
			username: { type: "string", minLength: 1 },
			password: { type: "string", minLength: 1 },
			tenant: { type: "string" },
		},
	},
};
handler.post.response = {
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

export default handler;
