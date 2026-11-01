// 组织架构共享读面（方案 A3 / §5.2）：给**别的模块**消费的只读面。
// 与管理端 /api/system/departments 分家——那边是管理语义（出 origin / sync_visible / deleted /
// 负责人，要管理员），这边是消费语义（只给「看与算」需要的最小集）。
//
// 两级门禁（D5；方案 §3 与 §12-D1 已推翻「登录即可」）：
//   · scope=self（默认）：只看「我在哪」——我所在部门 + 它们的祖先链（自身路径），
//     以及这些部门里的直属成员；
//   · scope=all：看全量，挂权限点 platform.org.read.all（superadmin / admin 天然通过其一切）。
//
// 读面一律**不出** origin（归属权=管理语义）、is_leader（负责人关系）、external_status（在职状态）。
// 这比方案「self 档不出」更严一点，换来的是**返回字段与 scope 无关**：消费模块不用按档位分支解析。
//
// self 档为什么不含兄弟部门：组织架构含层级 + 人名，比通讯录敏感得多；且同步会把「从未登录本站、
// 无从同意」的全员灌进本地。默认给最小集，真要看全的模块去申请权限点——这是需求方要付的代价。
//
// ⚡ includeSub 在 self 档只对「我所在部门」生效：祖先部门（也在可见范围内）一展开就是整棵子树，
// 等于绕过了自身路径的限制。宁可 400 也不静默截断——截断会给出「看似正确其实少人」的结果。
import type { PageResult } from "../infra/query";
import type { Department } from "./org";
import { assertPermission, assertTenantSelf } from "../infra/access";
import { pageArgs } from "../infra/query";
import { rateLimit } from "../infra/rate";
import { listDepartments, memberCounts } from "./org";

/** 全量读的权限点（D5）：self 档不需要，scope=all 必须持有 */
export const PERM_ORG_READ_ALL = "platform.org.read.all";

export type OrgScope = "self" | "all";

export interface OrgReader {
	uid: number
	scope: OrgScope
	/** self 档可见部门（我所在部门 + 祖先链）；all 档为 null = 不限制 */
	visible: Set<number> | null
	/** self 档可展开子树的部门（只含我所在部门）；all 档为 null */
	expandable: Set<number> | null
}

export interface DeptItem {
	id: number
	parentId: number | null
	name: string | null
	nameEn: string | null
	orderNo: number
	memberCount: number
}

export interface MemberItem {
	userId: number
	username: string
	displayName: string | null
	deptId: number
	/** 部门路径（根在前），部门名缺失时退 `#id` */
	deptPath: string[]
	isMain: boolean
}

export interface UserDepartments {
	userId: number
	username: string
	displayName: string | null
	position: string | null
	mainDeptId: number | null
	mainDeptPath: string[]
	departments: Array<{ deptId: number, deptPath: string[] }>
}

export interface PickerResult {
	departments: DeptItem[]
	users: MemberItem[]
}

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

export function parseScope(raw: unknown): OrgScope {
	const s = String(raw ?? "").trim();
	if (s === "" || s === "self")
		return "self";
	if (s === "all")
		return "all";
	fail(400, "scope must be 'self' or 'all'");
}

/**
 * 解析调用者视角。self 档要现算可见集：我所在部门 → 沿 parent 链一路向上。
 *
 * 上溯**有界**（环在外部源调整期会短暂出现），且命中已收录节点即停——否则 A→B→A 会转满一圈。
 */
export async function resolveReader(uid: number, scope: OrgScope): Promise<OrgReader> {
	if (scope === "all")
		return { uid, scope, visible: null, expandable: null };
	const links = await db.table("sys_dept_member").select(["dept_id"]).where({ field: "user_id", op: "eq", value: uid }).all() as Array<Record<string, unknown>>;
	const own = [...new Set(links.map(r => Number(r.dept_id)))];
	// 没有部门 = 只见自己（visible 空集）：不是「无限制」，别让空集被当成 all
	if (!own.length)
		return { uid, scope, visible: new Set(), expandable: new Set() };
	const depts = await listDepartments();
	const parentOf = new Map<number, number>();
	for (const d of depts) {
		if (d.parentId != null)
			parentOf.set(d.id, d.parentId);
	}
	const visible = new Set<number>();
	for (const start of own) {
		let hop: number | null = start;
		for (let i = 0; i <= depts.length && hop != null; i++) {
			if (visible.has(hop))
				break;
			visible.add(hop);
			hop = parentOf.get(hop) ?? null;
		}
	}
	return { uid, scope, visible, expandable: new Set(own) };
}

/**
 * 读面入口（7 个端点共用，避免守卫在 7 个 handler 里各抄一遍而慢慢长歪）：
 * 登录态 → 租户自洽 → 限速 → scope 解析 → all 档验权限点 → 算可见集。
 *
 * 顺序有讲究：**先 assertTenantSelf 再 rateLimit**——伪造 X-TENANT-ID 的人不该消耗
 * （也不该污染）正常用户的限速窗口。
 */
export async function resolveReadFace(scopeRaw: unknown): Promise<OrgReader> {
	const uid = http.user?.id;
	if (uid == null)
		fail(401, "unauthorized");
	await assertTenantSelf();
	await rateLimit(`org:${Number(uid)}`, 60, 60_000);
	const scope = parseScope(scopeRaw);
	if (scope === "all")
		await assertPermission(PERM_ORG_READ_ALL);
	return resolveReader(Number(uid), scope);
}

function assertVisible(reader: OrgReader, deptId: number): void {
	if (reader.visible && !reader.visible.has(deptId))
		fail(403, "该部门不在可见范围内（scope=self 只能看自己所在部门及其上级）");
}

function assertExpandable(reader: OrgReader, deptId: number): void {
	if (reader.expandable && !reader.expandable.has(deptId))
		fail(400, "scope=self 只能展开自己所在部门的下级部门");
}

// ---- 部门索引（读面口径：只含未软删 + 同步可见的行；self 档再按 visible 收窄）----

interface DeptIndex {
	depts: Department[]
	byId: Map<number, Department>
	children: Map<number, number[]>
	counts: Map<number, number>
}

/**
 * 一次取全量在内存里过滤/建树（同 org.ts::listDepartments 的取舍）：部门量级是数百个节点，
 * 而构造器没有递归 CTE，`in (全部 id)` 也不如内存过滤稳。真到虚拟树量级再分层取。
 */
async function loadIndex(reader: OrgReader): Promise<DeptIndex> {
	const all = await listDepartments();
	// 先落到局部常量：闭包里直接读 `reader.visible` 会丢掉非空窄化（TS 不跨闭包保持）
	const visible = reader.visible;
	const depts = visible ? all.filter(d => visible.has(d.id)) : all;
	const byId = new Map(depts.map(d => [d.id, d]));
	const children = new Map<number, number[]>();
	for (const d of depts) {
		// 父不在索引里（被 self 档裁掉 / 父本身已删）→ 当根处理，父链到此为止
		if (d.parentId == null || !byId.has(d.parentId))
			continue;
		(children.get(d.parentId) ?? children.set(d.parentId, []).get(d.parentId)!).push(d.id);
	}
	return { depts, byId, children, counts: await memberCounts() };
}

function toItem(d: Department, counts: Map<number, number>): DeptItem {
	return {
		id: d.id,
		parentId: d.parentId,
		name: d.name,
		nameEn: d.nameEn,
		orderNo: d.orderNo,
		memberCount: counts.get(d.id) ?? 0,
	};
}

/** 部门路径（根在前）。上溯有界：环不会死循环，只会走出一条带重复的短路径。 */
function pathOf(idx: DeptIndex, deptId: number): string[] {
	const names: string[] = [];
	let hop: number | null = deptId;
	for (let i = 0; i <= idx.depts.length && hop != null; i++) {
		const d = idx.byId.get(hop);
		if (!d)
			break;
		names.unshift(d.name ?? `#${d.id}`);
		hop = d.parentId;
	}
	return names;
}

/** 含自身的子树（BFS + seen，环安全） */
function subtreeOf(idx: DeptIndex, rootId: number): number[] {
	const out: number[] = [];
	const seen = new Set<number>([rootId]);
	const stack: number[] = [rootId];
	while (stack.length) {
		const id = stack.pop()!;
		out.push(id);
		for (const c of idx.children.get(id) ?? []) {
			if (seen.has(c))
				continue;
			seen.add(c);
			stack.push(c);
		}
	}
	return out;
}

/** 关键词红线（同通讯录口径：≥2 才给查，防拿单字把整份名册拖走） */
function keywordOf(raw: unknown): string | null {
	const kw = String(raw ?? "").trim();
	if (!kw)
		return null;
	if (kw.length < 2)
		fail(400, "keyword too short (min 2)");
	if (kw.length > 64)
		fail(400, "keyword too long (max 64)");
	return kw.toLowerCase();
}

// ---- 端点一：树 ----

/**
 * GET /org/tree —— 部门平表（前端按 parentId 组装成树）。
 *
 * 为什么不出嵌套 children：oj 的契约 IR 不支持递归 schema（无 $ref），嵌套深度写不进契约；
 * 与管理端 /api/system/departments 同一口径——树是**前端**的事，后端只给平表。
 */
export async function readTree(reader: OrgReader): Promise<DeptItem[]> {
	const idx = await loadIndex(reader);
	return idx.depts.map(d => toItem(d, idx.counts));
}

// ---- 端点二：部门分页 ----

/** GET /org/departments —— 平铺分页（大企业避免一次拉全树）。parent=0 表示只取根层。 */
export async function pageDepartments(reader: OrgReader, opts: {
	parent?: unknown
	keyword?: unknown
	page?: unknown
	size?: unknown
} = {}): Promise<PageResult<DeptItem>> {
	const idx = await loadIndex(reader);
	const kw = keywordOf(opts.keyword);
	let rows = idx.depts;
	if (opts.parent != null && String(opts.parent).trim() !== "") {
		const parent = Number(opts.parent);
		rows = rows.filter(d => (parent === 0 ? d.parentId == null : d.parentId === parent));
	}
	if (kw)
		rows = rows.filter(d => `${d.name ?? ""}\n${d.nameEn ?? ""}`.toLowerCase().includes(kw));
	const { page, size, offset } = pageArgs(opts);
	const list = rows.slice(offset, offset + size).map(d => toItem(d, idx.counts));
	return { list, total: rows.length, page, size, truncated: offset + list.length < rows.length };
}

// ---- 端点三：成员分页 ----

/**
 * 收集成员（分页与选人组件共用）。
 *
 * 两条过滤纪律：
 *   · 停用账号不出现（与通讯录同口径：is_forbidden=1 的人不该被当成收件人）；
 *   · 一人多部门时**只出一条**（主部门优先，其次 dept_id 小的）——否则 includeSub 会把同一个人
 *     按所属部门数重复吐出来，消费模块还得自己去重。
 */
async function collectMembers(idx: DeptIndex, deptIds: number[] | null): Promise<MemberItem[]> {
	if (deptIds && deptIds.length === 0)
		return [];
	const links = await db.table("sys_dept_member")
		.select(["user_id", "dept_id", "is_main"])
		.whereIf(deptIds, { field: "dept_id", op: "in", value: deptIds })
		.all() as Array<{ user_id: number, dept_id: number, is_main: number }>;
	if (!links.length)
		return [];
	const ids = [...new Set(links.map(l => Number(l.user_id)))];
	const users = await db.table("users").select(["id", "username", "display_name"]).where({ field: "id", op: "in", value: ids }).where({ field: "is_forbidden", op: "eq", value: 0 }).all() as Array<{ id: number, username: string, display_name: string | null }>;
	const byId = new Map(users.map(u => [Number(u.id), u]));
	const ordered = [...links].sort((a, b) =>
		Number(b.is_main ?? 0) - Number(a.is_main ?? 0) || Number(a.dept_id) - Number(b.dept_id));
	const out: MemberItem[] = [];
	const seen = new Set<number>();
	for (const l of ordered) {
		const deptId = Number(l.dept_id);
		const userId = Number(l.user_id);
		// 部门不在索引里（软删 / 失去可见范围 / 被 self 档裁掉）→ 整条不出，不暴露半个路径
		if (!idx.byId.has(deptId) || seen.has(userId))
			continue;
		const u = byId.get(userId);
		if (!u)
			continue;
		seen.add(userId);
		out.push({
			userId,
			username: String(u.username),
			displayName: u.display_name,
			deptId,
			deptPath: pathOf(idx, deptId),
			isMain: Number(l.is_main ?? 0) === 1,
		});
	}
	return out;
}

/**
 * GET /org/members —— 部门成员（含部门路径）。
 *
 * `includeSub` 在 self 档只对「我所在部门」生效（见头注）：对祖先部门请求展开会 400，
 * 而不是静默截断成「只看得见的部分」。
 */
export async function pageMembers(reader: OrgReader, opts: {
	dept?: unknown
	includeSub?: unknown
	keyword?: unknown
	page?: unknown
	size?: unknown
} = {}): Promise<PageResult<MemberItem>> {
	const idx = await loadIndex(reader);
	let deptIds: number[] | null = null;
	if (opts.dept != null && String(opts.dept).trim() !== "") {
		const deptId = Number(opts.dept);
		assertVisible(reader, deptId);
		if (opts.includeSub === true || String(opts.includeSub) === "true" || String(opts.includeSub) === "1") {
			assertExpandable(reader, deptId);
			deptIds = subtreeOf(idx, deptId);
		}
		else {
			deptIds = [deptId];
		}
	}
	let rows = await collectMembers(idx, deptIds);
	const kw = keywordOf(opts.keyword);
	if (kw)
		rows = rows.filter(m => `${m.username}\n${m.displayName ?? ""}`.toLowerCase().includes(kw));
	const { page, size, offset } = pageArgs(opts);
	const list = rows.slice(offset, offset + size);
	return { list, total: rows.length, page, size, truncated: offset + list.length < rows.length };
}

// ---- 端点四：某人的部门 ----

/** GET /org/user —— 部门路径 / 主部门 / 职务。self 档只能查自己。 */
export async function readUserDepartments(reader: OrgReader, targetUid: number): Promise<UserDepartments> {
	if (reader.scope === "self" && Number(targetUid) !== Number(reader.uid))
		fail(403, "scope=self 只能查自己的部门信息");
	const idx = await loadIndex(reader);
	const rows = await db.table("users").select(["id", "username", "display_name", "position"]).where({ field: "id", op: "eq", value: targetUid }).all() as Array<Record<string, unknown>>;
	const u = rows[0];
	if (!u)
		fail(404, "user not found");
	const links = await db.table("sys_dept_member").select(["dept_id", "is_main"]).where({ field: "user_id", op: "eq", value: targetUid }).all() as Array<{ dept_id: number, is_main: number }>;
	const depts = links
		.filter(l => idx.byId.has(Number(l.dept_id)))
		.sort((a, b) => Number(b.is_main ?? 0) - Number(a.is_main ?? 0) || Number(a.dept_id) - Number(b.dept_id))
		.map(l => ({ deptId: Number(l.dept_id), deptPath: pathOf(idx, Number(l.dept_id)) }));
	const mainRow = links.find(l => Number(l.is_main ?? 0) === 1 && idx.byId.has(Number(l.dept_id)));
	return {
		userId: Number(u.id),
		username: String(u.username),
		displayName: u.display_name == null ? null : String(u.display_name),
		position: u.position == null ? null : String(u.position),
		mainDeptId: mainRow ? Number(mainRow.dept_id) : null,
		mainDeptPath: mainRow ? pathOf(idx, Number(mainRow.dept_id)) : [],
		departments: depts,
	};
}

// ---- 端点五：选人组件 ----

/** GET /org/picker —— 人 + 部门混合（选人组件一次拿全）。keyword 必填且 ≥2（同上防遍历）。 */
export async function readPicker(reader: OrgReader, opts: { keyword?: unknown, limit?: unknown } = {}): Promise<PickerResult> {
	const kw = keywordOf(opts.keyword);
	if (!kw)
		fail(400, "keyword required");
	const rawLimit = Number.parseInt(String(opts.limit ?? ""), 10);
	const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(50, rawLimit) : 20;
	const idx = await loadIndex(reader);
	const departments = idx.depts
		.filter(d => `${d.name ?? ""}\n${d.nameEn ?? ""}`.toLowerCase().includes(kw))
		.slice(0, limit)
		.map(d => toItem(d, idx.counts));
	const users = (await collectMembers(idx, null))
		.filter(m => `${m.username}\n${m.displayName ?? ""}`.toLowerCase().includes(kw))
		.slice(0, limit);
	return { departments, users };
}

// ---- 端点六 / 七：「算」而不是「看」（共享读面真正的价值）----

/**
 * POST /org/resolve —— 把「部门（含子部门）」展开成 user_id 列表。
 *
 * 这是共享面真正的价值：缺了它，每个消费模块都会自己把树拉下来递归，共享名存实亡。
 * 结果去重升序，方便调用方直接当收件人集合用。
 */
export async function resolveUserIds(reader: OrgReader, input: {
	deptIds?: unknown
	userIds?: unknown
	includeSub?: boolean
}): Promise<number[]> {
	const idx = await loadIndex(reader);
	const out = new Set<number>();
	for (const raw of Array.isArray(input.userIds) ? input.userIds : []) {
		const uid = Number(raw);
		if (Number.isFinite(uid) && uid > 0)
			out.add(uid);
	}
	const deptIds = (Array.isArray(input.deptIds) ? input.deptIds : []).map(Number).filter(n => Number.isFinite(n) && n > 0);
	if (deptIds.length) {
		const scope = new Set<number>();
		for (const deptId of deptIds) {
			assertVisible(reader, deptId);
			if (input.includeSub) {
				assertExpandable(reader, deptId);
				for (const id of subtreeOf(idx, deptId))
					scope.add(id);
			}
			else {
				scope.add(deptId);
			}
		}
		const list = [...scope];
		if (list.length) {
			const links = await db.table("sys_dept_member").select(["user_id"]).where({ field: "dept_id", op: "in", value: list }).all() as Array<{ user_id: number }>;
			for (const l of links)
				out.add(Number(l.user_id));
		}
	}
	return [...out].sort((a, b) => a - b);
}

/** GET /org/is-member —— 某人是否在某部门（含子部门）下。self 档只能问自己。 */
export async function isMemberOf(reader: OrgReader, targetUid: number, deptId: number): Promise<boolean> {
	if (reader.scope === "self" && Number(targetUid) !== Number(reader.uid))
		fail(403, "scope=self 只能查自己是否属于某部门");
	assertVisible(reader, deptId);
	const idx = await loadIndex(reader);
	const scope = new Set(subtreeOf(idx, deptId));
	const links = await db.table("sys_dept_member").select(["dept_id"]).where({ field: "user_id", op: "eq", value: targetUid }).all() as Array<{ dept_id: number }>;
	return links.some(l => scope.has(Number(l.dept_id)));
}
