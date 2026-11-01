// 组织架构领域服务（0016：CRUD 基线 + 外部源适配器的落点）。
//
// 定位（方案 §14）：**CRUD 是基线，企微 / LDAP 只是适配器**。所以本文件分成两半：
//   · 上半（createDepartment / updateDepartment / deleteDepartment / moveDepartment / …）
//     是**管理端 CRUD**，带归属权校验；
//   · 下半（upsertDepartment / upsertMember / markSeen / reconcileHidden）
//     是**适配器专用**写路径，不做归属权校验（适配器就是该 origin 的拥有者）。
//
// 归属权（D13）：`origin` 不只是来源标签，它标识「谁拥有这一行」。
//   local = 本站管理员全权；wecom / ldap / sso = 对应适配器管辖。
//   任何同步与回收动作都只作用于自己 origin 的行——这是「适配器可插拔」与「CRUD 保底」
//   能共存的根本机制（否则本地建的部门会在第一轮同步后集体消失）。
//
// 构造器纪律：oj 的 SQL 构造器**没有 upsert**（sql-builder-guide §2 能力矩阵无 ON CONFLICT
// DO UPDATE），故写入统一「先 select → 有则 update / 无则 insert → 撞唯一约束再 update 回查」
// （照 store.ts::saveProfile 的先例）。另一条：三方言 affected-rows 不一致，
// 「删/改了几行」**不可**用来判成败（SKILL.md），只能靠唯一约束与事务保证幂等。
import { recordOp } from "../infra/audit";

/** 本站自建的来源标识：管理员全权、适配器不碰 */
export const ORIGIN_LOCAL = "local";

export interface OrgDeps {
	now: () => number
}

export interface Department {
	id: number
	origin: string
	originId: string
	parentId: number | null
	name: string | null
	nameEn: string | null
	orderNo: number
	syncVisible: boolean
	deleted: boolean
	updateTime: number
}

export interface DeptNode extends Omit<Department, "syncVisible" | "deleted" | "updateTime"> {
	name: string | null
	memberCount: number
	children: DeptNode[]
}

export interface DeptMember {
	userId: number
	deptId: number
	orderNo: number
	isLeader: boolean
	isMain: boolean
	username: string
	displayName: string | null
}

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

/** 来源 → 人话（错误提示要能直接给用户看） */
export function originLabel(origin: string): string {
	switch (origin) {
		case "wecom": return "企业微信";
		case "ldap": return "LDAP";
		case "sso": return "SSO";
		case "local": return "本站";
		default: return origin;
	}
}

/** D13：结构字段（名称/层级/删除）只归 origin='local' 的行；其余必须先「转为本地维护」（D14） */
function assertLocal(dept: Department, action: string): void {
	if (dept.origin === ORIGIN_LOCAL)
		return;
	fail(400, `该部门由${originLabel(dept.origin)}同步维护，不能${action}；如需本站自行维护，请先执行「转为本地维护」`);
}

type DeptRow = Record<string, unknown>;

function toDepartment(r: DeptRow): Department {
	return {
		id: Number(r.id),
		origin: String(r.origin),
		originId: String(r.origin_id),
		parentId: r.parent_id == null ? null : Number(r.parent_id),
		name: r.name == null ? null : String(r.name),
		nameEn: r.name_en == null ? null : String(r.name_en),
		orderNo: Number(r.order_no ?? 0),
		syncVisible: Number(r.sync_visible ?? 1) === 1,
		deleted: Number(r.deleted ?? 0) === 1,
		updateTime: Number(r.update_time ?? 0),
	};
}

/**
 * 部门列表（一次取全量，供内存建树用）。
 *
 * 为什么不分页：构造器**没有递归 CTE**，而部门树的典型量级（数百个节点）一次取回在内存里
 * 组装远快于逐层查询；`includeSub` 这类查询也走内存闭包（方案 §3 C10）。
 * 真到了需要虚拟树/分页的量级，再按 parent_id 分层取（届时应先压测，别提前优化）。
 */
export async function listDepartments(opts: { includeDeleted?: boolean, includeHidden?: boolean } = {}): Promise<Department[]> {
	let q = db.table("sys_department").select(["id", "origin", "origin_id", "parent_id", "name", "name_en", "order_no", "sync_visible", "deleted", "update_time"]);
	if (!opts.includeDeleted)
		q = q.where({ field: "deleted", op: "eq", value: 0 });
	if (!opts.includeHidden)
		q = q.where({ field: "sync_visible", op: "eq", value: 1 });
	// order_no「值大靠前」，同值按 id 稳定排序（避免同层顺序在刷新间跳动）
	const rows = await q.orderBy([{ field: "order_no", dir: "desc" }, { field: "id", dir: "asc" }]).all() as DeptRow[];
	return rows.map(toDepartment);
}

export async function findDepartment(id: number): Promise<Department> {
	const rows = await db.table("sys_department").select(["id", "origin", "origin_id", "parent_id", "name", "name_en", "order_no", "sync_visible", "deleted", "update_time"]).where({ field: "id", op: "eq", value: id }).all() as DeptRow[];
	if (!rows[0])
		fail(404, "department not found");
	return toDepartment(rows[0]!);
}

/**
 * 组装部门树（含成员计数）。
 *
 * 两个必须处理的脏数据（都是可见范围裁剪的必然产物，不是 bug）：
 *   · **孤儿**：parent_id 指向一个不存在/已删的行 → 提升到根；
 *   · **环**：A→B→A（外部源结构调整期间可能短暂出现）→ 断环并提升到根，绝不死循环。
 */
export async function buildTree(): Promise<{ roots: DeptNode[], orphans: number, cycles: number }> {
	const depts = await listDepartments();
	const alive = new Set(depts.map(d => d.id));
	const counts = await memberCounts();
	const nodes = new Map<number, DeptNode>();
	for (const d of depts) {
		nodes.set(d.id, {
			id: d.id,
			origin: d.origin,
			originId: d.originId,
			parentId: d.parentId,
			name: d.name,
			nameEn: d.nameEn,
			orderNo: d.orderNo,
			memberCount: counts.get(d.id) ?? 0,
			children: [],
		});
	}
	let orphans = 0;
	let cycles = 0;
	const roots: DeptNode[] = [];
	for (const d of depts) {
		const node = nodes.get(d.id)!;
		const parentId = d.parentId;
		if (parentId == null || !alive.has(parentId) || parentId === d.id) {
			if (parentId != null && alive.has(parentId))
				cycles++;
			else if (parentId != null)
				orphans++;
			roots.push(node);
			continue;
		}
		// 沿链上溯判环：任一祖先回到自己即断环
		let hop: number | null = parentId;
		let cyclic = false;
		for (let i = 0; i < nodes.size + 1 && hop != null; i++) {
			if (hop === d.id) {
				cyclic = true;
				break;
			}
			const p = nodes.get(hop);
			hop = p ? p.parentId : null;
		}
		if (cyclic) {
			cycles++;
			roots.push(node);
			continue;
		}
		nodes.get(parentId)!.children.push(node);
	}
	return { roots, orphans, cycles };
}

/** 每部门的成员数（一次聚合，避免 N+1 查询） */
export async function memberCounts(): Promise<Map<number, number>> {
	const rows = await db.table("sys_dept_member").select([{ fn: "count", as: "c" }, "dept_id"]).groupBy(["dept_id"]).all() as Array<{ c: number, dept_id: number }>;
	return new Map(rows.map(r => [Number(r.dept_id), Number(r.c)]));
}

/** 建部门（基线 CRUD）。origin 恒为 local——外部源的部门一律走 upsertDepartment。 */
export async function createDepartment(input: { name: string, parentId?: number | null, nameEn?: string | null, orderNo?: number }, deps: OrgDeps): Promise<number> {
	const name = String(input.name ?? "").trim();
	if (!name)
		fail(400, "department name required");
	const parentId = input.parentId == null ? null : Number(input.parentId);
	if (parentId != null)
		await findDepartment(parentId); // 父不存在直接 404，别建出孤儿
	const rows = await db.table("sys_department").insert({
		origin: ORIGIN_LOCAL,
		origin_id: localOriginId(),
		parent_id: parentId,
		name,
		name_en: input.nameEn ?? null,
		order_no: Number(input.orderNo ?? 0),
		sync_visible: 1,
		deleted: 0,
		update_time: deps.now(),
	}).returning(["id"]).run() as Array<{ id: number }>;
	const id = Number(rows[0]!.id);
	await recordOp({ action: "org.department.create", module: "framework", target: name, detail: { id, parentId } });
	return id;
}

/**
 * 本地部门没有外部主键，但唯一约束是 (tenant_id, origin, origin_id)，
 * 所以给它一个生成出来的稳定串（不复用自增 id：那要「先插后改」，且跨库导出会错乱）。
 */
function localOriginId(): string {
	// 用 getRandomValues 而不是 randomHex：前者在 oj 运行时与 Node 两侧都有
	// （global.d.ts 声明 + Node 原生 `crypto`），后端 BDD 夹具没有 oj 的 crypto 增补，
	// 用 randomHex 会让这条路径在测试里直接 TypeError。
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	let hex = "";
	for (const b of bytes)
		hex += b.toString(16).padStart(2, "0");
	return `l${hex}`;
}

/** 改部门（基线 CRUD）。按 D13 只放行 origin='local'。 */
export async function updateDepartment(id: number, patch: { name?: string, nameEn?: string | null, orderNo?: number }, deps: OrgDeps): Promise<void> {
	const dept = await findDepartment(id);
	assertLocal(dept, "修改");
	const cols: Record<string, unknown> = { update_time: deps.now() };
	if (patch.name !== undefined) {
		const name = String(patch.name).trim();
		if (!name)
			fail(400, "department name required");
		cols.name = name;
	}
	if (patch.nameEn !== undefined)
		cols.name_en = patch.nameEn;
	if (patch.orderNo !== undefined)
		cols.order_no = Number(patch.orderNo);
	await db.table("sys_department").update(cols).where({ field: "id", op: "eq", value: id }).run();
	await recordOp({ action: "org.department.update", module: "framework", target: String(cols.name ?? dept.name ?? `#${id}`), detail: { id } });
}

/**
 * 删部门（基线 CRUD）。按 D13 只放行 origin='local'。
 *
 * 有子部门时**拒绝**而不是级联删：级联删是不可逆的破坏性动作，而「先移走或先删子部门」
 * 的代价很低。真要批量删，由调用方自己按树自底向上删。
 */
export async function deleteDepartment(id: number): Promise<void> {
	const dept = await findDepartment(id);
	assertLocal(dept, "删除");
	const children = await db.table("sys_department").select(["id"]).where({ field: "parent_id", op: "eq", value: id }).where({ field: "deleted", op: "eq", value: 0 }).all();
	if (children.length)
		fail(400, "该部门下还有子部门，请先移除或删除子部门");
	await db.tx(async (t) => {
		// 逻辑外键无 FK 约束，关联必须手动清（否则留下指向已删部门的悬空行）
		await t.table("sys_dept_member").where({ field: "dept_id", op: "eq", value: id }).delete().run();
		await t.table("sys_department").where({ field: "id", op: "eq", value: id }).delete().run();
	});
	await recordOp({ action: "org.department.delete", module: "framework", target: String(dept.name ?? `#${id}`), detail: { id } });
}

/** 移动部门（改父级 + 排序）。按 D13 只放行 origin='local'。 */
export async function moveDepartment(id: number, parentId: number | null, deps: OrgDeps): Promise<void> {
	const dept = await findDepartment(id);
	assertLocal(dept, "移动");
	const target = parentId == null ? null : Number(parentId);
	if (target != null) {
		if (target === id)
			fail(400, "cannot move a department into itself");
		// 环检测：**沿 target 向上**走父链，撞到 id 即成环。
		//
		// 方向别搞反：把 id 挂到 target 下形成的环是 `id → target → … → id`，
		// 也就是「id 是 target 的祖先」。所以要从 target 往上找 id，不是从 target
		// 往下找（往下找只会漏判——实测把父部门挂到自己的孙部门下被放行，树直接成环）。
		const all = await listDepartments({ includeDeleted: true, includeHidden: true });
		const parentOf = new Map<number, number>();
		for (const d of all) {
			if (d.parentId != null)
				parentOf.set(d.id, d.parentId);
		}
		let hop: number | null = target;
		for (let i = 0; i <= all.length && hop != null; i++) {
			if (hop === id)
				fail(400, "cannot move a department into its own descendant");
			hop = parentOf.get(hop) ?? null;
		}
	}
	await db.table("sys_department").update({ parent_id: target, update_time: deps.now() }).where({ field: "id", op: "eq", value: id }).run();
	await recordOp({ action: "org.department.move", module: "framework", target: String(dept.name ?? `#${id}`), detail: { id, parentId: target } });
}

/**
 * D14 保底出口：把一行脱离适配器管辖（origin → local），此后 CRUD 全开、同步不再改写它。
 *
 * 反向操作（转回外部源）**不提供**：转回去后下一次同步会立刻按源口径改写，语义不可控。
 */
export async function detachToLocal(id: number, deps: OrgDeps): Promise<void> {
	const dept = await findDepartment(id);
	if (dept.origin === ORIGIN_LOCAL)
		return;
	await db.table("sys_department").update({ origin: ORIGIN_LOCAL, update_time: deps.now() }).where({ field: "id", op: "eq", value: id }).run();
	await recordOp({ action: "org.department.detach", module: "framework", target: String(dept.name ?? `#${id}`), detail: { id, from: dept.origin } });
}

/**
 * 部门成员（含 users 的展示字段）。
 * 分两次查而不是 join：构造器的 `join ... ON` 带值条件有已知缺口，而 in 查询足够快。
 */
export async function listMembers(deptId: number): Promise<DeptMember[]> {
	const links = await db.table("sys_dept_member").select(["user_id", "dept_id", "order_no", "is_leader", "is_main"]).where({ field: "dept_id", op: "eq", value: deptId }).orderBy([{ field: "order_no", dir: "desc" }, { field: "user_id", dir: "asc" }]).all() as Array<Record<string, unknown>>;
	if (!links.length)
		return [];
	const ids = links.map(r => Number(r.user_id));
	const users = await db.table("users").select(["id", "username", "display_name"]).where({ field: "id", op: "in", value: ids }).all() as Array<{ id: number, username: string, display_name: string | null }>;
	const byId = new Map(users.map(u => [Number(u.id), u]));
	return links.map((r) => {
		const u = byId.get(Number(r.user_id));
		return {
			userId: Number(r.user_id),
			deptId: Number(r.dept_id),
			orderNo: Number(r.order_no ?? 0),
			isLeader: Number(r.is_leader ?? 0) === 1,
			isMain: Number(r.is_main ?? 0) === 1,
			username: u ? String(u.username) : "",
			displayName: u ? u.display_name : null,
		};
	});
}

/** 加人进部门（基线 CRUD）。部门的 origin 不限制加人——「谁在这个部门」本站始终可调。 */
export async function addMember(deptId: number, userId: number, opts: { isLeader?: boolean, isMain?: boolean, orderNo?: number } = {}, deps: OrgDeps): Promise<void> {
	await findDepartment(deptId);
	const exists = await db.table("sys_dept_member").select(["id"]).where({ and: [
		{ field: "user_id", op: "eq", value: userId },
		{ field: "dept_id", op: "eq", value: deptId },
	] }).all();
	if (exists.length)
		fail(400, "user already in this department");
	try {
		await db.table("sys_dept_member").insert({
			user_id: userId,
			dept_id: deptId,
			order_no: Number(opts.orderNo ?? 0),
			is_leader: opts.isLeader ? 1 : 0,
			is_main: opts.isMain ? 1 : 0,
			update_time: deps.now(),
		}).run();
	}
	catch (e) {
		// 并发插入者先落 → 视为已存在（同 saveProfile / ensureWecomUser 的先例）
		if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e)))
			throw e;
	}
	if (opts.isMain)
		await setMainDepartment(userId, deptId, deps);
	await recordOp({ action: "org.member.add", module: "framework", target: `#${userId}`, detail: { deptId } });
}

/** 改成员属性（基线 CRUD）：只改已存在的关联行，不存在即 404（与 upsertMember 的「无则建」相反） */
export async function updateMember(deptId: number, userId: number, patch: { isLeader?: boolean, isMain?: boolean, orderNo?: number }, deps: OrgDeps): Promise<void> {
	const scope = { and: [
		{ field: "user_id", op: "eq", value: userId },
		{ field: "dept_id", op: "eq", value: deptId },
	] };
	const rows = await db.table("sys_dept_member").select(["id"]).where(scope).all();
	if (!rows.length)
		fail(404, "user is not in this department");
	const cols: Record<string, unknown> = { update_time: deps.now() };
	if (patch.isLeader !== undefined)
		cols.is_leader = patch.isLeader ? 1 : 0;
	if (patch.orderNo !== undefined)
		cols.order_no = Number(patch.orderNo);
	await db.table("sys_dept_member").update(cols).where(scope).run();
	if (patch.isMain)
		await setMainDepartment(userId, deptId, deps);
	await recordOp({ action: "org.member.update", module: "framework", target: `#${userId}`, detail: { deptId, ...patch } });
}

/** 移出部门（基线 CRUD） */
export async function removeMember(deptId: number, userId: number, deps: OrgDeps): Promise<void> {
	await db.table("sys_dept_member").where({ and: [
		{ field: "user_id", op: "eq", value: userId },
		{ field: "dept_id", op: "eq", value: deptId },
	] }).delete().run();
	await recordOp({ action: "org.member.remove", module: "framework", target: `#${userId}`, detail: { deptId, updateTime: deps.now() } });
}

/** 设主部门：同一用户在全租户内至多一行 is_main=1（企微 main_department 缺失时由调用方兜底） */
export async function setMainDepartment(userId: number, deptId: number, deps: OrgDeps): Promise<void> {
	await db.tx(async (t) => {
		await t.table("sys_dept_member").update({ is_main: 0, update_time: deps.now() }).where({ field: "user_id", op: "eq", value: userId }).run();
		await t.table("sys_dept_member").update({ is_main: 1, update_time: deps.now() }).where({ and: [
			{ field: "user_id", op: "eq", value: userId },
			{ field: "dept_id", op: "eq", value: deptId },
		] }).run();
	});
}

// ---------------------------------------------------------------------------
// 适配器专用写路径（企微 / LDAP / …）：不做归属权校验——适配器就是该 origin 的拥有者
// ---------------------------------------------------------------------------

/**
 * 按 (origin, origin_id) 幂等写入部门，返回本地 id。
 *
 * 只更新**结构字段**（name / parent / order）。刻意**不改** sync_visible、deleted、origin：
 * 前两者由 reconcile 与删除事件维护，后者只有「转为本地维护」(D14) 能改。
 */
export async function upsertDepartment(input: {
	origin: string
	originId: string
	parentId: number | null
	name: string | null
	orderNo?: number
}, deps: OrgDeps): Promise<number> {
	const scope = { and: [
		{ field: "origin", op: "eq", value: input.origin },
		{ field: "origin_id", op: "eq", value: input.originId },
	] };
	const cols = {
		parent_id: input.parentId,
		name: input.name,
		order_no: Number(input.orderNo ?? 0),
		update_time: deps.now(),
	};
	const rows = await db.table("sys_department").select(["id"]).where(scope).all() as Array<{ id: number }>;
	if (rows.length) {
		await db.table("sys_department").update(cols).where(scope).run();
		return Number(rows[0]!.id);
	}
	try {
		const inserted = await db.table("sys_department").insert({
			origin: input.origin,
			origin_id: input.originId,
			sync_visible: 1,
			deleted: 0,
			...cols,
		}).returning(["id"]).run() as Array<{ id: number }>;
		return Number(inserted[0]!.id);
	}
	catch (e) {
		// 并发插入者先落：转为更新并回查（同 saveProfile 的先例）
		if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e)))
			throw e;
		await db.table("sys_department").update(cols).where(scope).run();
		const again = await db.table("sys_department").select(["id"]).where(scope).all() as Array<{ id: number }>;
		return Number(again[0]!.id);
	}
}

/** 按 (user_id, dept_id) 幂等写入成员关联 */
export async function upsertMember(input: {
	userId: number
	deptId: number
	orderNo?: number
	isLeader?: boolean
	isMain?: boolean
}, deps: OrgDeps): Promise<void> {
	const scope = { and: [
		{ field: "user_id", op: "eq", value: input.userId },
		{ field: "dept_id", op: "eq", value: input.deptId },
	] };
	const cols = {
		order_no: Number(input.orderNo ?? 0),
		is_leader: input.isLeader ? 1 : 0,
		is_main: input.isMain ? 1 : 0,
		update_time: deps.now(),
	};
	const rows = await db.table("sys_dept_member").select(["id"]).where(scope).all();
	if (rows.length) {
		await db.table("sys_dept_member").update(cols).where(scope).run();
		return;
	}
	try {
		await db.table("sys_dept_member").insert({ user_id: input.userId, dept_id: input.deptId, ...cols }).run();
	}
	catch (e) {
		if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e)))
			throw e;
		await db.table("sys_dept_member").update(cols).where(scope).run();
	}
}

/**
 * 标记「本轮同步命中」（墓碑回收的正面证据）。
 * 只作用于**指定 origin**——漏了这个条件，本地建的部门会被第一轮同步集体判死（D13）。
 */
export async function markSeen(origin: string, deptIds: number[], jobId: number, deps: OrgDeps): Promise<void> {
	if (!deptIds.length)
		return;
	await db.table("sys_department").update({ seen_job_id: jobId, update_time: deps.now() }).where({ and: [
		{ field: "origin", op: "eq", value: origin },
		{ field: "id", op: "in", value: deptIds },
	] }).run();
}

/**
 * 墓碑回收：把「上一轮见过、这一轮没见」的部门置为不可见。
 *
 * 两条硬纪律：
 *   1. **只作用于指定 origin**（D13）；
 *   2. **只在调用方确认本轮完整（无 skip）后调用**——否则「上游抖了一下」会被误判成
 *      「这些部门被删了」，表现是组织架构大面积消失（D9）。调用方负责判断。
 * 另：`deleted` 只由外部源的删除事件置（D9），这里不动它。
 */
export async function reconcileHidden(origin: string, jobId: number, deps: OrgDeps): Promise<number> {
	return Number(await db.table("sys_department").update({ sync_visible: 0, update_time: deps.now() }).where({ and: [
		{ field: "origin", op: "eq", value: origin },
		{ field: "sync_visible", op: "eq", value: 1 },
		{ field: "seen_job_id", op: "lt", value: jobId },
	] }).run());
}

/** 外部源侧的部门删除事件：置 deleted（软删，保留壳以防成员关联悬挂） */
export async function markDeleted(origin: string, originId: string, deps: OrgDeps): Promise<void> {
	await db.table("sys_department").update({ deleted: 1, sync_visible: 0, update_time: deps.now() }).where({ and: [
		{ field: "origin", op: "eq", value: origin },
		{ field: "origin_id", op: "eq", value: originId },
	] }).run();
}
