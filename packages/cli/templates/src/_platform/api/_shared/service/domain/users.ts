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

/** 用户所属的一个部门。带 id 是为了前端能按部门（含子部门）筛选——部门名会重名。 */
export interface UserDeptRef {
	id: number
	/** 部门名（软删/未命名部门为 null，展示口径交给调用方） */
	name: string | null
	isMain: boolean
}

export interface UserRow {
	id: number
	username: string
	display_name: string | null
	email: string | null
	position: string | null
	/** 所属部门（主部门在前） */
	departments: UserDeptRef[]
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

/**
 * AC1-8（已修订）：成员资格提权守卫——按**被授予的角色**分层，不再一刀切。
 *
 *   · `superadmin` —— 仍严格只许 superadmin 授。它是**平台级**角色：握着它就能进
 *     /system/wecom 那类跨租户页面（listApps 列出**所有企业**的档案），一旦租户内可授
 *     即为跨租户越权，故这条不因下面的修订而放宽。
 *   · `admin` —— 允许本租户内握有 `admin` 或 `superadmin` 的人任命。
 *     判定与写入两侧都被租户作用域约束：`rolesOf()` 读 sys_user_role 走请求租户注入，
 *     下面的写入同样带 tenant_id，所以租户管理员只能影响**自己租户**，不会越到别家。
 *     动机：企业租户是隐式具象化的，平台 superadmin 因租户隔离查不到企业租户的用户
 *     （实测 404），若 admin 任命也只许 superadmin，企业租户就永远配不出管理员。
 *   · 其余角色（editor/viewer 等）—— 不校验，保持原行为。
 */
async function assertMembershipAllowed(actorId: number, nextRoles: string[]): Promise<void> {
	if (!nextRoles.includes("superadmin") && !nextRoles.includes("admin"))
		return;
	const actorRoles = await rolesOf(Number(actorId));
	const isSuper = actorRoles.includes("superadmin");
	// 提权到平台级：只许 superadmin
	if (nextRoles.includes("superadmin") && !isSuper)
		fail(403, "granting superadmin requires superadmin");
	// 任命本租户管理员：本租户的 admin 或 superadmin 均可
	if (nextRoles.includes("admin") && !isSuper && !actorRoles.includes("admin"))
		fail(403, "membership management requires admin or superadmin");
}

export async function listUsers(): Promise<UserRow[]> {
	const rows = await db.table("users").select(["id", "username", "display_name", "email", "position", "is_forbidden", "must_change"]).orderBy([{ field: "username" }]).all() as Array<Record<string, unknown>>;
	const roleRows = await db.table("sys_user_role").select(["user_id", "role_name"]).all() as Array<{ user_id: number, role_name: string }>;
	const roleMap = new Map<number, string[]>();
	for (const r of roleRows)
		(roleMap.get(Number(r.user_id)) ?? roleMap.set(Number(r.user_id), []).get(Number(r.user_id)))!.push(r.role_name);
	const depts = await departmentsByUser();
	return rows.map(r => ({
		id: Number(r.id),
		username: String(r.username),
		display_name: r.display_name == null ? null : String(r.display_name),
		email: r.email == null ? null : String(r.email),
		position: r.position == null ? null : String(r.position),
		departments: depts.get(Number(r.id)) ?? [],
		is_forbidden: Number(r.is_forbidden) === 1,
		must_change: Number(r.must_change) === 1,
		roles: roleMap.get(Number(r.id)) ?? [],
	}));
}

/** uid → 所属部门（主部门排前）。两次查询而非 join：构造器 join 带值条件有已知缺口。 */
async function departmentsByUser(): Promise<Map<number, UserDeptRef[]>> {
	const memberRows = await db.table("sys_dept_member").select(["user_id", "dept_id", "is_main"]).all() as Array<{ user_id: number, dept_id: number, is_main: number }>;
	if (!memberRows.length)
		return new Map();
	const deptRows = await db.table("sys_department").select(["id", "name"]).where({ field: "deleted", op: "eq", value: 0 }).all() as Array<{ id: number, name: string | null }>;
	const nameOf = new Map(deptRows.map(d => [Number(d.id), d.name == null ? null : String(d.name)]));
	const out = new Map<number, UserDeptRef[]>();
	// 主部门先落：is_main=1 的行先排一遍，其余后追加
	const ordered = [...memberRows].sort((a, b) => Number(b.is_main ?? 0) - Number(a.is_main ?? 0));
	for (const m of ordered) {
		const uid = Number(m.user_id);
		const id = Number(m.dept_id);
		(out.get(uid) ?? out.set(uid, []).get(uid)!).push({ id, name: nameOf.get(id) ?? null, isMain: Number(m.is_main ?? 0) === 1 });
	}
	return out;
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
	// activated=1：管理员建号是「明确要这个人」的动作，立刻进通讯录目录。
	// 与同步建档相反——同步会把全企业名册灌进来，那批号必须等真人登录才算 activated（见 contacts.ts 门禁）。
	const rows = await db.table("users").insert({ username, password_hash: hash, display_name: input.displayName ?? null, email: input.email ?? null, must_change: 1, activated: 1 }).returning(["id"]).run() as Array<{ id: number }>;
	const uid = Number(rows[0].id);
	await recordOp({ action: "user.create", module: "framework", target: username });
	return uid;
}

/**
 * 外部源（企微 / LDAP）同步建档：按用户名 find-or-create，返回 uid。
 *
 * 与 `createUser` 的三处刻意差异：
 *   1. **activated=0**：同步灌进来的是「目录档」，要等真人登录过才算活人（§9.1，否则
 *      contacts 会被一次同步放大成整份企业名册）；
 *   2. 不写审计：按部门批量建号，逐条审计会把 sys_oplog 打爆（同步入口自己记一条总量）；
 *   3. 归属权（D13）：已存在行的 `source` 与本次来源不同（管理员已「转为本地维护」）→
 *      只回 id，**一个字段都不改**，改名/改职务都归本地管。
 *
 * 口令哈希仍用 `!<source>` 占位（与 `!wecom` / `!ldap` 同义：任何口令都验不过）。
 */
export async function upsertSourceUser(input: { username: string, displayName?: string | null, source: string, corpId?: string | null }): Promise<number> {
	const username = String(input.username ?? "").trim();
	if (!username)
		fail(400, "username required");
	const rows = await db.table("users").select(["id", "source"]).where({ field: "username", op: "eq", value: username }).all() as Array<{ id: number, source: string | null }>;
	if (rows.length) {
		const row = rows[0]!;
		const name = input.displayName?.trim();
		// 同步只改自己拥有的行：名字变了（改名/补上真名）就更新，其余字段（职务/状态）由调用方另写
		if (name && String(row.source ?? "") === input.source)
			await db.table("users").update({ display_name: name }).where({ field: "id", op: "eq", value: Number(row.id) }).run();
		return Number(row.id);
	}
	try {
		const inserted = await db.table("users").insert({
			username,
			display_name: input.displayName?.trim() || username,
			password_hash: `!${input.source}`,
			avatar_base64: "",
			source: input.source,
			corp_id: input.corpId ?? null,
			must_change: 0,
			is_forbidden: 0,
			activated: 0,
		}).returning(["id"]).run() as Array<{ id: number }>;
		return Number(inserted[0]!.id);
	}
	catch (e) {
		// 并发（两片撞同一人 / 两个部门同时处理）唯一约束兜底：回查复用，同 saveProfile 先例
		if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e)))
			throw e;
		const again = await db.table("users").select(["id"]).where({ field: "username", op: "eq", value: username }).all() as Array<{ id: number }>;
		if (!again.length)
			throw e;
		return Number(again[0]!.id);
	}
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
	// 提权类变更（牵涉 admin / superadmin）单列严重级：任命管理员＝把该租户的最高权限交出去，
	// 不该和「勾了个 editor」落在同一噪声水平上。收回也算——撤销提权同样是安全事件。
	const touchesPrivilege = (r: string) => r === "admin" || r === "superadmin";
	const elevated = next.some(touchesPrivilege) || [...beforeSet].some(touchesPrivilege);
	await recordOp({
		action: "user.roles.update",
		module: "framework",
		target: await usernameOf(Number(targetUid)),
		detail: {
			added: next.filter(r => !beforeSet.has(r)),
			removed: [...beforeSet].filter(r => !next.includes(r)),
			// —— 租户维度 ——
			// 每个租户都有自己的管理员，且**用户名撞车**（都叫 admin）：只记 username 分不清
			// 「哪个租户的 admin 任命了谁」。sys_oplog.tenant_id 虽由请求租户注入，但那是隐式列，
			// 显式落一份 + 双方 uid，审计才能直接按租户筛、也能定位到具体两个账号。
			tenant: http.tenantId ?? "",
			actorUid: Number(actorId),
			targetUid: Number(targetUid),
			// 便于直接筛出「任命/撤销管理员」这类高价值条目，不必去解析 added/removed
			elevated,
		},
		// 4=warning（与「重设租户管理员口令」同级）：提权变更按安全事件留痕；
		// 普通角色变更（editor/viewer）保持默认 6=info，避免审计被噪声淹没。
		level: elevated ? 4 : 6,
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

/**
 * 改资料（基线 CRUD 的用户侧）。
 *
 * 只放行与来源无关的展示字段（displayName / email / position）——用户名即外部身份的主键
 * （`wecom:<userid>` 这类），改名会让下一次登录认错人（B6 命名空间抢占，见
 * RESERVED_USERNAME_PREFIX）。`is_forbidden` 走 setForbidden、口令走 changePasswordByAdmin，
 * 都不在这里——它们是带副作用的动作（级联删 refresh），混进通用 PATCH 会让「改个邮箱」也强退。
 */
export async function updateUserProfile(actorId: number, targetUid: number, patch: { displayName?: string | null, email?: string | null, position?: string | null }): Promise<void> {
	const rows = await db.table("users").select(["id"]).where({ field: "id", op: "eq", value: targetUid }).all();
	if (!rows.length)
		fail(404, "user not found");
	const cols: Record<string, unknown> = {};
	if (patch.displayName !== undefined)
		cols.display_name = patch.displayName == null ? null : String(patch.displayName).trim() || null;
	if (patch.email !== undefined)
		cols.email = patch.email == null ? null : String(patch.email).trim() || null;
	if (patch.position !== undefined)
		cols.position = patch.position == null ? null : String(patch.position).trim() || null;
	if (!Object.keys(cols).length)
		return;
	await db.table("users").update(cols).where({ field: "id", op: "eq", value: targetUid }).run();
	await recordOp({ action: "user.profile.update", module: "framework", target: await usernameOf(Number(targetUid)), detail: { fields: Object.keys(cols), actor: Number(actorId) } });
}

/**
 * 删用户（基线 CRUD）。
 *
 * 级联清单是手工维护的——这些表都是逻辑外键（无 FK 约束），漏清任何一张都会留下
 * 指向已删用户的悬空行：`sys_dept_member`（部门成员）/ `sys_user_role`（角色）
 * / `sys_refresh_token`（会话）。删完立即失效判权缓存，否则被删者手上的 token
 * 还能用满一个 TTL。
 */
export async function deleteUser(actorId: number, targetUid: number): Promise<void> {
	assertNotSelf(actorId, targetUid);
	const rows = await db.table("users").select(["id", "username"]).where({ field: "id", op: "eq", value: targetUid }).all() as Array<{ id: number, username: string }>;
	if (!rows.length)
		fail(404, "user not found");
	const roles = await rolesOf(Number(targetUid));
	if (roles.includes("superadmin")) {
		const supers = await db.table("sys_user_role").select([{ fn: "count", as: "c" }]).where({ field: "role_name", op: "eq", value: "superadmin" }).all() as Array<{ c: number }>;
		if (Number(supers[0]?.c ?? 0) <= 1)
			fail(400, "cannot delete the last superadmin");
	}
	await db.tx(async (t) => {
		await t.table("sys_dept_member").where({ field: "user_id", op: "eq", value: targetUid }).delete().run();
		await t.table("sys_user_role").where({ field: "user_id", op: "eq", value: targetUid }).delete().run();
		await t.table("sys_refresh_token").where({ field: "user_id", op: "eq", value: targetUid }).delete().run();
		await t.table("users").where({ field: "id", op: "eq", value: targetUid }).delete().run();
	});
	invalidateUser(Number(targetUid));
	await recordOp({ action: "user.delete", module: "framework", target: String(rows[0]!.username) });
}
