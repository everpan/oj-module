// 账号管理应用服务（管理域 /api/system/users，AC1-7~10 + B6 建号加固）。
// 红线：admin 不碰 superadmin/admin 成员资格（AC1-8，service 按 actor 角色自查）；
// 禁止操作自己（AC1-10 注）；最后 superadmin 兜底（服务端二次防线）；
// 角色唯一权威源 sys_user_role + 写时失效（AC1-7/D10）；禁用/重置口令级联删 refresh（§3.1）。
// bcrypt 经注入（Node 侧全局不可 stub，同 session.ts 约定）。
import { invalidateUser } from "./access";
import { recordOp } from "./audit";

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

/** 外来号命名空间抢占红线（B6）：本地建号拒收 ldap:/sso: 前缀用户名。 */
const RESERVED_PREFIX = /^(?:ldap|sso):/i;

async function rolesOf(uid: number): Promise<string[]> {
	const rows = await db.query("select role_name from sys_user_role where user_id = ?", [uid]) as Array<{ role_name: string }>;
	return rows.map(r => r.role_name);
}

async function usernameOf(uid: number): Promise<string> {
	const rows = await db.query("select username from users where id = ?", [uid]) as Array<{ username: string }>;
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
	const rows = await db.query(
		"select id, username, display_name, email, is_forbidden, must_change from users order by username",
	) as Array<Record<string, unknown>>;
	const roleRows = await db.query("select user_id, role_name from sys_user_role") as Array<{ user_id: number, role_name: string }>;
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
	if (RESERVED_PREFIX.test(username))
		fail(400, "username prefix reserved for external identity sources");
	if (!input.password || String(input.password).length < 6)
		fail(400, "password too short (min 6)");
	const exists = await db.query("select id from users where username = ?", [username]);
	if (exists.length)
		fail(400, "username exists");
	const hash = await deps.bcryptHash(String(input.password));
	const rows = await db.query(
		"insert into users (username, password_hash, display_name, email, must_change) values (?, ?, ?, ?, 1) returning id",
		[username, hash, input.displayName ?? null, input.email ?? null],
	) as Array<{ id: number }>;
	const uid = Number(rows[0].id);
	await recordOp({ action: "user.create", module: "framework", target: username });
	return uid;
}

/** AC1-7：整集替换角色（sys_user_role 权威源），写后失效持有者判权缓存。 */
export async function updateUserRoles(actorId: number, targetUid: number, roles: string[]): Promise<void> {
	assertNotSelf(actorId, targetUid);
	const target = await db.query("select id from users where id = ?", [targetUid]);
	if (!target.length)
		fail(404, "user not found");
	const next = [...new Set(roles.map(String))];
	if (next.length) {
		const marks = next.map(() => "?").join(",");
		const known = await db.query(`select name from sys_role where name in (${marks})`, next);
		const knownSet = new Set(known.map((r: { name: string }) => r.name));
		const unknown = next.filter(r => !knownSet.has(r));
		if (unknown.length)
			fail(400, `unknown roles: ${unknown.join(", ")}`);
	}
	await assertMembershipAllowed(actorId, next);
	const before = await rolesOf(Number(targetUid));
	const beforeSet = new Set(before);
	// AC1-10 兜底：撤掉最后一个 superadmin 拒绝（现实可达路径已被「禁止操作自己」拦截）
	if (beforeSet.has("superadmin") && !next.includes("superadmin")) {
		const supers = await db.query("select count(*) c from sys_user_role where role_name = 'superadmin'") as Array<{ c: number }>;
		if (Number(supers[0].c) <= 1)
			fail(400, "cannot revoke the last superadmin");
	}
	await db.tx(async (t) => {
		await t.exec("delete from sys_user_role where user_id = ?", [targetUid]);
		for (const role of next)
			await t.exec("insert into sys_user_role (user_id, role_name) values (?, ?)", [targetUid, role]);
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
	const rows = await db.query("select id from users where id = ?", [targetUid]);
	if (!rows.length)
		fail(404, "user not found");
	const hash = await deps.bcryptHash(String(newPassword));
	await db.tx(async (t) => {
		await t.exec("update users set password_hash = ?, must_change = 1 where id = ?", [hash, targetUid]);
		await t.exec("delete from sys_refresh_token where user_id = ?", [targetUid]);
	});
	invalidateUser(Number(targetUid));
	await recordOp({ action: "user.password.reset", module: "framework", target: await usernameOf(Number(targetUid)) });
}

/** B7：禁用/解禁——禁用级联删 refresh + 写时失效。 */
export async function setForbidden(actorId: number, targetUid: number, forbidden: boolean): Promise<void> {
	assertNotSelf(actorId, targetUid);
	const rows = await db.query("select id from users where id = ?", [targetUid]);
	if (!rows.length)
		fail(404, "user not found");
	await db.tx(async (t) => {
		await t.exec("update users set is_forbidden = ? where id = ?", [forbidden ? 1 : 0, targetUid]);
		if (forbidden)
			await t.exec("delete from sys_refresh_token where user_id = ?", [targetUid]);
	});
	invalidateUser(Number(targetUid));
	await recordOp({ action: "user.forbidden.update", module: "framework", target: await usernameOf(Number(targetUid)), detail: { forbidden } });
}
