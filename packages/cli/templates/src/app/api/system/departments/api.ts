import type { OrgDeps } from "#/_platform/_shared/service/domain/org";
import { respond } from "#/_platform/_shared/respond";
// 管理域端点组 /api/system/departments —— 组织架构 CRUD 基线（方案 A2）。
// handler 只编排：assertSystemAdmin 守卫 → org 领域服务 → json 信封；归属权红线在 org.ts（D13）。
//
// 列表**返回平表而不是树**：oj 的响应契约不支持递归 schema（contract IR 无 $ref），
// 树由前端按 parentId 组装。管理员要看全量（含 sync_visible=0 与软删壳），故两个开关全开。
import {
	createDepartment,
	deleteDepartment,
	listDepartments,
	memberCounts,

	updateDepartment,
} from "#/_platform/_shared/service/domain/org";
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

/** 秒级 epoch（与 sys_oplog / wecom store 同一口径） */
const orgDeps: OrgDeps = { now: () => Math.floor(Date.now() / 1000) };

// GET /api/system/departments —— 部门平表（含成员计数），管理页树的数据源。
async function get() {
	await respond(async () => {
		await assertSystemAdmin();
		const [depts, counts] = await Promise.all([
			listDepartments({ includeDeleted: true, includeHidden: true }),
			memberCounts(),
		]);
		return depts.map(d => ({ ...d, memberCount: counts.get(d.id) ?? 0 }));
	});
}
get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["id", "origin", "originId", "parentId", "name", "orderNo", "syncVisible", "deleted", "memberCount"],
		properties: {
			id: { type: "number" },
			// 归属权标识：local = 本站可 CRUD；其余 = 对应适配器管辖（D13）
			origin: { type: "string" },
			originId: { type: "string" },
			parentId: { type: ["number", "null"] },
			name: { type: ["string", "null"] },
			nameEn: { type: ["string", "null"] },
			orderNo: { type: "number" },
			syncVisible: { type: "boolean" },
			deleted: { type: "boolean" },
			memberCount: { type: "number" },
		},
	},
};

// POST /api/system/departments —— 建部门（origin 恒 local）。
async function post() {
	await respond(async () => {
		await assertSystemAdmin();
		const b = (http.body || {}) as { name?: string, parentId?: number | null, nameEn?: string | null, orderNo?: number };
		return { id: await createDepartment({
			name: String(b.name ?? ""),
			parentId: b.parentId ?? null,
			nameEn: b.nameEn ?? null,
			orderNo: b.orderNo,
		}, orgDeps) };
	});
}
post.schema = {
	body: {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string", minLength: 1 },
			// 不给 parentId 即建在根下
			parentId: { type: ["number", "null"] },
			nameEn: { type: ["string", "null"] },
			orderNo: { type: "number" },
		},
	},
};
post.response = {
	type: "object",
	required: ["id"],
	properties: { id: { type: "number" } },
};

// PUT /api/system/departments?id= —— 改名/排序。部门归属 origin='local' 才放行（D13）。
async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		const b = (http.body || {}) as { name?: string, nameEn?: string | null, orderNo?: number };
		await updateDepartment(Number(q.id), {
			name: b.name,
			nameEn: b.nameEn,
			orderNo: b.orderNo,
		}, orgDeps);
		return { ok: true };
	});
}
put.schema = {
	query: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "number" } },
	},
	body: {
		type: "object",
		properties: {
			name: { type: "string", minLength: 1 },
			nameEn: { type: ["string", "null"] },
			orderNo: { type: "number" },
		},
	},
};
put.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

// DELETE /api/system/departments?id= —— 删部门（有子部门即拒；关联成员行一并清）。
async function del() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		await deleteDepartment(Number(q.id));
		return { ok: true };
	});
}
del.schema = {
	query: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "number" } },
	},
};
del.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

export default { get, post, put, del };
