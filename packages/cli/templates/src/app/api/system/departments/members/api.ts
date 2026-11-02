import type { OrgDeps } from "#/_platform/_shared/service/domain/org";
import { respond } from "#/_platform/_shared/respond";
import {
	addMember,
	listMembers,

	removeMember,
	updateMember,
} from "#/_platform/_shared/service/domain/org";
// /api/system/departments/members?id= —— 部门成员的增删查改（方案 A2）。
//
// 加人**不看部门的 origin**：「谁在这个部门」本站始终可调，即便部门本身由企微同步而来；
// 受 D13 限制的只有部门的**结构字段**（名称/层级/删除），两者不是一回事。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

const orgDeps: OrgDeps = { now: () => Math.floor(Date.now() / 1000) };

const MEMBER_ITEM = {
	type: "object",
	required: ["userId", "deptId", "orderNo", "isLeader", "isMain", "username"],
	properties: {
		userId: { type: "number" },
		deptId: { type: "number" },
		orderNo: { type: "number" },
		isLeader: { type: "boolean" },
		isMain: { type: "boolean" },
		username: { type: "string" },
		displayName: { type: ["string", "null"] },
	},
} as const;

// GET /api/system/departments/members?id= —— 成员列表（含 users 展示字段）
async function get() {
	await respond(async () => {
		await assertSystemAdmin();
		return listMembers(Number((http.query as Record<string, unknown>).id));
	});
}
get.schema = {
	query: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "number" } },
	},
};
get.response = { type: "array", items: MEMBER_ITEM };

// POST /api/system/departments/members?id= —— 加人
async function post() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		const b = (http.body || {}) as { userId?: number, isLeader?: boolean, isMain?: boolean, orderNo?: number };
		await addMember(Number(q.id), Number(b.userId), {
			isLeader: b.isLeader,
			isMain: b.isMain,
			orderNo: b.orderNo,
		}, orgDeps);
		return { ok: true };
	});
}
post.schema = {
	query: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "number" } },
	},
	body: {
		type: "object",
		required: ["userId"],
		properties: {
			userId: { type: "number" },
			isLeader: { type: "boolean" },
			isMain: { type: "boolean" },
			orderNo: { type: "number" },
		},
	},
};
post.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

// PUT /api/system/departments/members?id=&userId= —— 改成员属性（负责人/主部门/排序）
async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		const b = (http.body || {}) as { isLeader?: boolean, isMain?: boolean, orderNo?: number };
		await updateMember(Number(q.id), Number(q.userId), {
			isLeader: b.isLeader,
			isMain: b.isMain,
			orderNo: b.orderNo,
		}, orgDeps);
		return { ok: true };
	});
}
put.schema = {
	query: {
		type: "object",
		required: ["id", "userId"],
		properties: { id: { type: "number" }, userId: { type: "number" } },
	},
	body: {
		type: "object",
		properties: {
			isLeader: { type: "boolean" },
			isMain: { type: "boolean" },
			orderNo: { type: "number" },
		},
	},
};
put.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

// DELETE /api/system/departments/members?id=&userId= —— 移出部门
async function del() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		await removeMember(Number(q.id), Number(q.userId), orgDeps);
		return { ok: true };
	});
}
del.schema = {
	query: {
		type: "object",
		required: ["id", "userId"],
		properties: { id: { type: "number" }, userId: { type: "number" } },
	},
};
del.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

export default { get, post, put, del };
