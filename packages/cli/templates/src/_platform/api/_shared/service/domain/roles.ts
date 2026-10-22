// 角色管理应用服务（管理域 /api/system/roles，AC1-15~20/28/30）。
// 规则锚：custom 机器名强制（AC1-17）、builtin 角色绑定/删除硬拒（AC1-19）、占用禁删（AC1-20）、
// 绑定调整 = 紧急吊销出口（AC1-30，写后按持有者失效判权缓存）、写审计 await recordOp（AC1-28 关键路径）。
// 判权本身不经过这里——调用 handler 先过 assertSystemAdmin（H2，管理类端点）。
import { invalidateUser } from "../infra/access";
import { recordOp } from "../infra/audit";

export interface RoleRow {
	name: string
	module: string
	title: string | null
	description: string | null
	builtin: boolean
	deprecated: boolean
	/** 持有者人数（占用禁删判据） */
	holders: number
	/** 已绑定权限点（含 deprecated——判权不过滤，标灰是 UI 职责） */
	permissions: string[]
}

export interface PermissionRow {
	code: string
	module: string
	title_key: string | null
	deprecated: boolean
}

function fail(status: number, message: string, extra?: Record<string, unknown>): never {
	throw Object.assign(new Error(message), { status }, extra);
}

/** custom 角色机器名：custom.<slug>，slug 小写字母数字连字符（AC1-17 命名空间强制）。 */
const CUSTOM_NAME = /^custom\.[a-z0-9][a-z0-9-]*$/;
/** 框架保留名（solutions 命名空间 <name>.* 天然被 custom. 前缀排除） */
const RESERVED = new Set(["superadmin", "admin", "editor", "viewer"]);

async function assertNotBuiltin(roleName: string): Promise<void> {
	const rows = await db.table("sys_role").select(["builtin"]).where({ field: "name", op: "eq", value: roleName }).all();
	if (!rows[0])
		fail(404, `role not found: ${roleName}`);
	if (Number((rows[0] as { builtin: unknown }).builtin) === 1)
		fail(403, "builtin role is managed by framework");
}

async function assertCodesExist(codes: string[]): Promise<void> {
	if (!codes.length)
		return;
	const rows = await db.table("sys_permission").select(["code"]).where({ field: "code", op: "in", value: codes }).all();
	const known = new Set(rows.map(r => (r as { code: string }).code));
	const unknown = codes.filter(c => !known.has(c));
	if (unknown.length)
		fail(400, `unknown permission codes: ${unknown.join(", ")}`);
}

/** 绑定/删除写后按持有者逐人失效判权缓存（D10 撤销即强退的 service 级出口）。 */
async function invalidateHolders(roleName: string): Promise<void> {
	const rows = await db.table("sys_user_role").select(["user_id"]).where({ field: "role_name", op: "eq", value: roleName }).all();
	for (const r of rows as Array<{ user_id: number }>)
		invalidateUser(Number(r.user_id));
}

export async function listRoles(): Promise<RoleRow[]> {
	const roles = await db.table("sys_role").select(["name", "module", "title", "description", "builtin", "deprecated"]).orderBy([{ field: "name" }]).all() as Array<Record<string, unknown>>;
	const holders = await db.table("sys_user_role").select(["role_name", { fn: "count", as: "c" }]).groupBy(["role_name"]).all() as Array<{ role_name: string, c: number }>;
	const binds = await db.table("sys_role_permission").select(["role_name", "permission_code"]).orderBy([{ field: "permission_code" }]).all() as Array<{ role_name: string, permission_code: string }>;
	const holderMap = new Map(holders.map(h => [h.role_name, Number(h.c)]));
	const bindMap = new Map<string, string[]>();
	for (const b of binds)
		(bindMap.get(b.role_name) ?? bindMap.set(b.role_name, []).get(b.role_name))!.push(b.permission_code);
	return roles.map(r => ({
		name: String(r.name),
		module: String(r.module),
		title: r.title == null ? null : String(r.title),
		description: r.description == null ? null : String(r.description),
		builtin: Number(r.builtin) === 1,
		deprecated: Number(r.deprecated) === 1,
		holders: holderMap.get(String(r.name)) ?? 0,
		permissions: bindMap.get(String(r.name)) ?? [],
	}));
}

export async function listPermissions(): Promise<PermissionRow[]> {
	const rows = await db.table("sys_permission").select(["code", "module", "title_key", "deprecated"]).orderBy([{ field: "code" }]).all() as Array<Record<string, unknown>>;
	return rows.map(r => ({
		code: String(r.code),
		module: String(r.module),
		title_key: r.title_key == null ? null : String(r.title_key),
		deprecated: Number(r.deprecated) === 1,
	}));
}

export async function createRole(input: { name: string, title: string, permissions?: string[] }): Promise<{ name: string, module: string }> {
	const name = String(input.name ?? "").trim();
	if (!CUSTOM_NAME.test(name) || RESERVED.has(name))
		fail(400, `role name must be custom.<slug> (reserved/framework/solution namespaces rejected): ${name}`);
	const permissions = [...new Set((input.permissions ?? []).map(String))];
	await assertCodesExist(permissions);
	await db.tx(async (t) => {
		await t.table("sys_role").insert({ name, module: "custom", title: String(input.title ?? ""), builtin: 0, deprecated: 0 }).run();
		for (const code of permissions)
			await t.table("sys_role_permission").insert({ role_name: name, permission_code: code }).run();
	});
	await recordOp({ action: "role.create", module: "framework", target: name, detail: { title: String(input.title ?? ""), permissions } });
	return { name, module: "custom" };
}

export async function updateBindings(roleName: string, codes: string[]): Promise<void> {
	await assertNotBuiltin(roleName);
	const next = [...new Set(codes.map(String))];
	await assertCodesExist(next);
	const before = (await db.table("sys_role_permission").select(["permission_code"]).where({ field: "role_name", op: "eq", value: roleName }).all()) as Array<{ permission_code: string }>;
	const beforeSet = new Set(before.map(b => b.permission_code));
	await db.tx(async (t) => {
		await t.table("sys_role_permission").where({ field: "role_name", op: "eq", value: roleName }).delete().run();
		for (const code of next)
			await t.table("sys_role_permission").insert({ role_name: roleName, permission_code: code }).run();
	});
	await invalidateHolders(roleName);
	const added = next.filter(c => !beforeSet.has(c));
	const removed = [...beforeSet].filter(c => !next.includes(c));
	await recordOp({ action: "role.bindings.update", module: "framework", target: roleName, detail: { added, removed } });
}

export async function deleteRole(roleName: string): Promise<void> {
	await assertNotBuiltin(roleName);
	const holders = await db.table("sys_user_role").select([{ fn: "count", as: "c" }]).where({ field: "role_name", op: "eq", value: roleName }).all();
	const n = Number((holders[0] as { c: unknown }).c);
	if (n > 0)
		fail(409, `role has ${n} holder(s)`, { holders: n });
	await db.tx(async (t) => {
		await t.table("sys_role_permission").where({ field: "role_name", op: "eq", value: roleName }).delete().run();
		await t.table("sys_role").where({ field: "name", op: "eq", value: roleName }).delete().run();
	});
	await invalidateHolders(roleName);
	await recordOp({ action: "role.delete", module: "framework", target: roleName });
}
