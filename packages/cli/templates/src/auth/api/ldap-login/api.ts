// POST /api/auth/ldap-login —— LDAP 目录登录（D1/AC1-12；匿名端点，E6：anonymous_paths 写 /auth/ldap-login）。
// 编排：B5 限速守卫（与 auth/login 同维度）→ ldapLogin 九步 → respond 统一异常出口（§9.3-1）。
import { respond } from "../../../_platform/api/_shared/respond";
import { createLdapLogin, runtimeLdapGateway } from "../_shared/ldap-login";
import { clientIp, guardLoginThrottle, noteLoginFailed, noteLoginSucceeded } from "../_shared/login-throttle";
import { createSession } from "../_shared/session";

// 模块级禁止 createSession()/runtimeLdapGateway()：oj build introspect 的空沙箱无 jwt/axis（§9.4）。

export default {
	async post() {
		const body = http.body || {};
		const username = String(body.username ?? "");
		const ip = await clientIp();
		await respond(async () => {
			try {
				await guardLoginThrottle(ip, username);
				const r = await createLdapLogin(createSession(), runtimeLdapGateway())(username, String(body.password ?? ""));
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
