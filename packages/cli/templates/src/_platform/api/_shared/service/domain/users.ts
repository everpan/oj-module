// 账号管理应用服务（管理域 /api/system/users，AC1-7~10 + B6 建号加固）。
// 红线：admin 不碰 superadmin/admin 成员资格（AC1-8，service 按 actor 角色自查）；
// 禁止操作自己（AC1-10 注）；最后 superadmin 兜底（服务端二次防线）；
// 角色唯一权威源 sys_user_role + 写时失效（AC1-7/D10）；禁用/重置口令级联删 refresh（§3.1）。
// bcrypt 经注入（Node 侧全局不可 stub，同 session.ts 约定）。
import { invalidateUser } from "../infra/access";
import { recordOp } from "../infra/audit";

export interface UserDeps {
	bcryptHash: (pw: string) => Promise<string>
}

export interface UserRow {
	id: number
	username: string
	display_name: string | null
	email: string | null
	is_forbidden: boolean
	must_change: boolean
	roles: string[]
}

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

/**
 * 外来号命名空间抢占红线（B6）：本地建号拒收 ldap:/sso:/wecom: 前缀用户名。
 *
 * 导出给「改名」两侧共用：只在建号处拦是不够的——自助改名或管理端改名若能把任意一个
 * 本地账号改成一个尚未建档的外部号（如 `wecom:boss`），该外部成员首次登录时
 * `ensureWecomUser` 按用户名查到的是**别人那一行**，于是签发别人的 uid。
 */
export const RESERVED_USERNAME_PREFIX = /^(?:ldap|sso|wecom):/i;

async function rolesOf(uid: number): Promise<string[]> {
	const rows = await db.table("sys_user_role").select(["role_name"]).where({ field: "user_id", op: "eq", value: uid }).all() as Array<{ role_name: string }>;
	return rows.map(r => r.role_name);
}

async function usernameOf(uid: number): Promise<string> {
	const rows = await db.table("users").select(["username"]).where({ field: "id", op: "eq", value: uid }).all() as Array<{ username: string }>;
	return rows[0] ? String(rows[0].username) : `#${uid}`;
}

function assertNotSelf(actorId: number, targetUid: number): void {
	if (Number(actorId) === Number(targetUid))
		fail(400, "cannot operate on yourself");
}

/** AC1-8：成员资格（superadmin/admin 分配）仅 superadmin 可动。 */
async function assertMembershipAllowed(actorId: number, nextRoles: string[]): Promise<void> {
	if (!nextRoles.includes("superadmin") && !nextRoles.includes("admin"))
		return;
	const actorRoles = await rolesOf(Number(actorId));
	if (!actorRoles.includes("superadmin"))
		fail(403, "membership management requires superadmin");
}

export async function listUsers(): Promise<UserRow[]> {
	const rows = await db.table("users").select(["id", "username", "display_name", "email", "is_forbidden", "must_change"]).orderBy([{ field: "username" }]).all() as Array<Record<string, unknown>>;
	const roleRows = await db.table("sys_user_role").select(["user_id", "role_name"]).all() as Array<{ user_id: number, role_name: string }>;
	const roleMap = new Map<number, string[]>();
	for (const r of roleRows)
		(roleMap.get(Number(r.user_id)) ?? roleMap.set(Number(r.user_id), []).get(Number(r.user_id)))!.push(r.role_name);
	return rows.map(r => ({
		id: Number(r.id),
		username: String(r.username),
		display_name: r.display_name == null ? null : String(r.display_name),
		email: r.email == null ? null : String(r.email),
		is_forbidden: Number(r.is_forbidden) === 1,
		must_change: Number(r.must_change) === 1,
		roles: roleMap.get(Number(r.id)) ?? [],
	}));
}

/** B6：建号——拒外来号前缀、口令 ≥6、默认 must_change=1。返回新用户 id。 */
export async function createUser(input: { username: string, password: string, displayName?: string, email?: string }, deps: UserDeps): Promise<number> {
	const username = String(input.username ?? "").trim();
	if (!username)
		fail(400, "username required");
	if (RESERVED_USERNAME_PREFIX.test(username))
		fail(400, "username prefix reserved for external identity sources");
	if (!input.password || String(input.password).length < 6)
		fail(400, "password too short (min 6)");
	const exists = await db.table("users").select(["id"]).where({ field: "username", op: "eq", value: username }).all();
	if (exists.length)
		fail(400, "username exists");
	const hash = await deps.bcryptHash(String(input.password));
	const rows = await db.table("users").insert({ username, password_hash: hash, display_name: input.displayName ?? null, email: input.email ?? null, must_change: 1 }).returning(["id"]).run() as Array<{ id: number }>;
	const uid = Number(rows[0].id);
	await recordOp({ action: "user.create", module: "framework", target: username });
	return uid;
}

/** AC1-7：整集替换角色（sys_user_role 权威源），写后失效持有者判权缓存。 */
export async function updateUserRoles(actorId: number, targetUid: number, roles: string[]): Promise<void> {
	assertNotSelf(actorId, targetUid);
	const target = await db.table("users").select(["id"]).where({ field: "id", op: "eq", value: targetUid }).all();
	if (!target.length)
		fail(404, "user not found");
	const next = [...new Set(roles.map(String))];
	if (next.length) {
		const known = await db.table("sys_role").select(["name"]).where({ field: "name", op: "in", value: next }).all();
		const knownSet = new Set(known.map(r => (r as { name: string }).name));
		const unknown = next.filter(r => !knownSet.has(r));
		if (unknown.length)
			fail(400, `unknown roles: ${unknown.join(", ")}`);
	}
	await assertMembershipAllowed(actorId, next);
	const before = await rolesOf(Number(targetUid));
	const beforeSet = new Set(before);
	// AC1-10 兜底：撤掉最后一个 superadmin 拒绝（现实可达路径已被「禁止操作自己」拦截）
	if (beforeSet.has("superadmin") && !next.includes("superadmin")) {
		const supers = await db.table("sys_user_role").select([{ fn: "count", as: "c" }]).where({ field: "role_name", op: "eq", value: "superadmin" }).all() as Array<{ c: number }>;
		if (Number(supers[0].c) <= 1)
			fail(400, "cannot revoke the last superadmin");
	}
	await db.tx(async (t) => {
		await t.table("sys_user_role").where({ field: "user_id", op: "eq", value: targetUid }).delete().run();
		for (const role of next)
			await t.table("sys_user_role").insert({ user_id: targetUid, role_name: role }).run();
	});
	invalidateUser(Number(targetUid));
	await recordOp({
		action: "user.roles.update",
		module: "framework",
		target: await usernameOf(Number(targetUid)),
		detail: { added: next.filter(r => !beforeSet.has(r)), removed: [...beforeSet].filter(r => !next.includes(r)) },
	});
}

/** B7：管理员重置口令——must_change=1 + 级联删 refresh + 写时失效。 */
export async function changePasswordByAdmin(actorId: number, targetUid: number, newPassword: string, deps: UserDeps): Promise<void> {
	assertNotSelf(actorId, targetUid);
	if (!newPassword || String(newPassword).length < 6)
		fail(400, "password too short (min 6)");
	const rows = await db.table("users").select(["id"]).where({ field: "id", op: "eq", value: targetUid }).all();
	if (!rows.length)
		fail(404, "user not found");
	const hash = await deps.bcryptHash(String(newPassword));
	await db.tx(async (t) => {
		await t.table("users").update({ password_hash: hash, must_change: 1 }).where({ field: "id", op: "eq", value: targetUid }).run();
		await t.table("sys_refresh_token").where({ field: "user_id", op: "eq", value: targetUid }).delete().run();
	});
	invalidateUser(Number(targetUid));
	await recordOp({ action: "user.password.reset", module: "framework", target: await usernameOf(Number(targetUid)) });
}

/** B7：禁用/解禁——禁用级联删 refresh + 写时失效。 */
export async function setForbidden(actorId: number, targetUid: number, forbidden: boolean): Promise<void> {
	assertNotSelf(actorId, targetUid);
	const rows = await db.table("users").select(["id"]).where({ field: "id", op: "eq", value: targetUid }).all();
	if (!rows.length)
		fail(404, "user not found");
	await db.tx(async (t) => {
		await t.table("users").update({ is_forbidden: forbidden ? 1 : 0 }).where({ field: "id", op: "eq", value: targetUid }).run();
		if (forbidden)
			await t.table("sys_refresh_token").where({ field: "user_id", op: "eq", value: targetUid }).delete().run();
	});
	invalidateUser(Number(targetUid));
	await recordOp({ action: "user.forbidden.update", module: "framework", target: await usernameOf(Number(targetUid)), detail: { forbidden } });
}
