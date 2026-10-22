// 登录限速编排（B5/AC1-26）：auth/login 与 auth/ldap-login 共用的 (IP, username) 双维度守卫 + 失败记账。
// 状态全在 DB（sys_login_throttle/sys_rate_window，迁移 0009）——oj 每请求重建模块，进程内方案恒失效（§9.3-3）。
import { auditOp } from "#/_platform/_shared/service/infra/audit";
import { loginBlocked, loginFailed, loginSucceeded, rateLimit } from "#/_platform/_shared/service/infra/rate";

/** 客户端 IP：优先 X-Forwarded-For（反代后），回落 X-Real-IP。 */
export async function clientIp(): Promise<string> {
	return String((http.headers || {})["x-forwarded-for"] ?? http.headers?.["x-real-ip"] ?? "unknown");
}

/** 登录前守卫：per-IP 粗窗口防撞库 + (IP, username) 连败阻断（429 指数 backoff 在 rate.ts）。 */
export async function guardLoginThrottle(ip: string, username: string): Promise<void> {
	await rateLimit(`login:ip:${ip}`, 30, 60_000);
	await loginBlocked(`${ip}|${username}`);
}

/** 401 记账：连败 +1（达阈值审计节流事件）+ 失败审计。 */
export async function noteLoginFailed(ip: string, username: string): Promise<void> {
	const pairKey = `${ip}|${username}`;
	const fails = await loginFailed(pairKey);
	if (fails === 6)
		auditOp({ action: "auth.login.throttle", module: "framework", target: pairKey, level: 4 });
	auditOp({ action: "auth.login.fail", module: "framework", target: username, level: 4 });
}

/** 登录成功清零连败。 */
export async function noteLoginSucceeded(ip: string, username: string): Promise<void> {
	await loginSucceeded(`${ip}|${username}`);
}
