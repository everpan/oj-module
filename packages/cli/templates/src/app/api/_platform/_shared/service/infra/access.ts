// 判权应用出口（D10）：DB 权威源 + 短 TTL 缓存 + 写时失效 = 撤销即强退。
// 领域决策在 guard.ts（decideAccess 纯函数，AC1-1~6 矩阵）；本层只做 IO：加载/缓存/失效/抛错。
// 错误约定：拒权抛 Error & { status: 403 }（应用 handler 层映射 json.fail，与 oj-wiki 先例一致）。
// 反常识注记：oj 每请求重建模块实例，本缓存恒不命中（每请求直查 DB）——正确性无损
// （撤销即强退反而成为平凡真），缓存/写时失效仅在同请求多断言时有意义；保留以兼容调用面。
import { decideAccess } from "./guard";

/** 短 TTL 仅兜底（进程崩溃/漏失效），正常撤销走写时 invalidateUser（设计文档 D10）。 */
const TTL_MS = 10_000;

interface AccessSnapshot {
	/**
	 * token 的 sub 在本租户里是否存在。
	 *
	 * 这是「伪造 X-TENANT-ID」的唯一服务端拦截点（R6 `require_signed_claim` 落地前的兜底）：
	 * token 只带 sub、不带租户，而 `users` 已租户化（构造器自动注入 `tenant_id = 当前头值`），
	 * 于是「A 企业的人带 B 企业的头」表现为**查无此行**。若这里放行，只要求登录态的端点
	 * （通知已读、个人资料等）就会带着伪造的租户头去读写别家数据。
	 */
	exists: boolean
	roles: string[]
	bindings: Record<string, string[]>
	forbidden: boolean
	/** 首登/重置口令后的强制改密悬挂（D12/AC1-27）：悬挂期判权出口全拒（改密端点不经过本层） */
	mustChange: boolean
	at: number
}

/**
 * `uid → 快照` 的键必须带上租户（2026-10 多租户）。
 *
 * 反例：只按 uid 缓存时，「A 企业的张三」判权后在同一进程里走了「B 企业的张三」的请求——
 * 后者的 `users` 行按 B 租户查不到（`tenant.enable` 下构造器自动注入谓词），本应 403，
 * 但缓存里还留着 A 租户那张 `exists: true` 的快照，于是放行。进程不跨请求复用时看不到，
 * 一旦复用（或在本工程的测试宿主里）就是静默的跨租户放行。
 */
const cache = new Map<string, AccessSnapshot>();

/** 当前请求的租户（`X-TENANT-ID` 落到 http.tenantId，与 oj 同源）；无上下文时按空串 */
function requestTenant(): string {
	const t = (http as unknown as { tenantId?: unknown }).tenantId;
	return typeof t === "string" ? t.trim() : "";
}

async function loadSnapshot(userId: number): Promise<AccessSnapshot> {
	const userRows = await db.table("users").select(["is_forbidden", "must_change"]).where({ field: "id", op: "eq", value: userId }).all();
	const roleRows = await db.table("sys_user_role").select(["role_name"]).where({ field: "user_id", op: "eq", value: userId }).all();
	const roles = roleRows.map(r => (r as { role_name: string }).role_name);
	// 只捞该用户角色的绑定（参数化 IN，三方言纪律）；deprecated 不过滤（判权职责，§5）
	const bindRows = roles.length
		? await db.table("sys_role_permission").select(["role_name", "permission_code"]).where({ field: "role_name", op: "in", value: roles }).all()
		: [];
	const bindings: Record<string, string[]> = {};
	for (const r of bindRows as { role_name: string, permission_code: string }[])
		(bindings[r.role_name] ??= []).push(r.permission_code);
	return {
		exists: userRows.length > 0,
		roles,
		bindings,
		forbidden: Number((userRows[0] || {}).is_forbidden) === 1,
		mustChange: Number((userRows[0] || {}).must_change) === 1,
		at: Date.now(),
	};
}

async function snapshot(userId: number): Promise<AccessSnapshot> {
	const key = `${requestTenant()}|${userId}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS)
		return hit;
	const snap = await loadSnapshot(userId);
	cache.set(key, snap);
	return snap;
}

/** 写路径（角色分配/绑定调整/紧急吊销/禁用）同步调用：撤销下一次请求即生效。 */
export function invalidateUser(userId: number): void {
	// 同一 uid 在各租户下的快照都要失效（见 cache 注释）：漏掉 B 租户那张，
	// 撤销在另一个租户里就还可能晚一个 TTL 才生效。
	for (const key of cache.keys()) {
		if (key.endsWith(`|${userId}`))
			cache.delete(key);
	}
}

export function invalidateAllUsers(): void {
	cache.clear();
}

function deny(): never {
	throw Object.assign(new Error("forbidden"), { status: 403 });
}

/** 当前请求的访问快照；未认证/禁用/改密悬挂即拒（403 不泄露账号存在性）。导出供各 handler 作「登录态即放行」判据（如操作日志写端）。 */
export async function currentAccess(): Promise<AccessSnapshot> {
	const uid = http.user?.id;
	if (uid == null)
		deny();
	const snap = await snapshot(Number(uid));
	// 伪造租户头：token 的 sub 在**当前租户**里查无此人（见 AccessSnapshot.exists 注释）。
	// 与 403 forbidden 同一句话，不给探测者区分「人不存在」与「没权限」的材料。
	if (!snap.exists)
		deny();
	if (snap.forbidden)
		deny();
	if (snap.mustChange)
		throw Object.assign(new Error("password change required"), { status: 403, code: "must_change" });
	return snap;
}

/** 四级链判权（AC1-1~6）。code 首段由 guard.moduleOf 在 JS 侧切（防三方言字符串函数分叉）。 */
export async function assertPermission(code: string): Promise<void> {
	const { roles, bindings } = await currentAccess();
	if (!decideAccess({ roles, bindings }, code))
		deny();
}

/**
 * 租户自洽（§5.3 第四层）：token 的 sub 是否存在于**当前租户**。
 * 唯一现实成因是伪造 `X-TENANT-ID`——`users` 已租户化，构造器按头值注入，越权即「查无此行」。
 *
 * 为什么单独一个出口：那些「登录即可、不挂权限点」的端点（人员目录、通知、我的资料）
 * 不走 `currentAccess()`（它还会判 must_change/forbidden），但它们同样读租户数据——
 * 少了这一步，伪造头的人能读到别家企业的广播通知与人员目录。
 */
export async function isSelfTenant(): Promise<boolean> {
	const uid = http.user?.id;
	if (uid == null)
		return false;
	return (await snapshot(Number(uid))).exists;
}

/** `isSelfTenant` 的断言形态（respond 风格端点用；json.fail 风格的端点直接判 `isSelfTenant()`） */
export async function assertTenantSelf(): Promise<void> {
	if (!(await isSelfTenant()))
		deny();
}

/** 系统管理员及以上（superadmin 或 admin）。 */
export async function assertSystemAdmin(): Promise<void> {
	const { roles } = await currentAccess();
	if (!roles.includes("superadmin") && !roles.includes("admin"))
		deny();
}

/** 仅超级管理员：成员资格管理/卸载/市场安全设置/审计导出等安全敏感项（D11，这些项不落权限点表）。 */
export async function assertSuperAdmin(): Promise<void> {
	const { roles } = await currentAccess();
	if (!roles.includes("superadmin"))
		deny();
}
