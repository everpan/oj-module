// 判权应用出口（D10）：DB 权威源 + 短 TTL 缓存 + 写时失效 = 撤销即强退。
// 领域决策在 guard.ts（decideAccess 纯函数，AC1-1~6 矩阵）；本层只做 IO：加载/缓存/失效/抛错。
// 错误约定：拒权抛 Error & { status: 403 }（应用 handler 层映射 json.fail，与 oj-wiki 先例一致）。
// 反常识注记：oj 每请求重建模块实例，本缓存恒不命中（每请求直查 DB）——正确性无损
// （撤销即强退反而成为平凡真），缓存/写时失效仅在同请求多断言时有意义；保留以兼容调用面。
import { decideAccess } from "./guard";

/** 短 TTL 仅兜底（进程崩溃/漏失效），正常撤销走写时 invalidateUser（设计文档 D10）。 */
const TTL_MS = 10_000;

interface AccessSnapshot {
	roles: string[]
	bindings: Record<string, string[]>
	forbidden: boolean
	/** 首登/重置口令后的强制改密悬挂（D12/AC1-27）：悬挂期判权出口全拒（改密端点不经过本层） */
	mustChange: boolean
	at: number
}

const cache = new Map<number, AccessSnapshot>();

async function loadSnapshot(userId: number): Promise<AccessSnapshot> {
	const userRows = await db.query("select is_forbidden, must_change from users where id = ?", [userId]);
	const roleRows = await db.query("select role_name from sys_user_role where user_id = ?", [userId]);
	const roles = roleRows.map((r: { role_name: string }) => r.role_name);
	// 只捞该用户角色的绑定（参数化 IN，三方言纪律）；deprecated 不过滤（判权职责，§5）
	const bindRows = roles.length
		? await db.query(
			`select role_name, permission_code from sys_role_permission where role_name in (${roles.map(() => "?").join(",")})`,
			roles,
		)
		: [];
	const bindings: Record<string, string[]> = {};
	for (const r of bindRows as { role_name: string, permission_code: string }[])
		(bindings[r.role_name] ??= []).push(r.permission_code);
	return {
		roles,
		bindings,
		forbidden: Number((userRows[0] || {}).is_forbidden) === 1,
		mustChange: Number((userRows[0] || {}).must_change) === 1,
		at: Date.now(),
	};
}

async function snapshot(userId: number): Promise<AccessSnapshot> {
	const hit = cache.get(userId);
	if (hit && Date.now() - hit.at < TTL_MS)
		return hit;
	const snap = await loadSnapshot(userId);
	cache.set(userId, snap);
	return snap;
}

/** 写路径（角色分配/绑定调整/紧急吊销/禁用）同步调用：撤销下一次请求即生效。 */
export function invalidateUser(userId: number): void {
	cache.delete(userId);
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
	const snap = await snapshot(uid);
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
