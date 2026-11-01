import { respond } from "../../_shared/respond";
// GET /api/_platform/org/picker?keyword= —— 人 + 部门混合（选人组件一次拿全）。
// ⚡ keyword 必填且 ≥2：选人组件是**枚举面**（拿单字能把整份名册拖走），与通讯录同一条红线。
import { readPicker, resolveReadFace } from "../../_shared/service/domain/org-read";

const DEPT_ITEM = {
	type: "object",
	required: ["id", "parentId", "name", "orderNo", "memberCount"],
	properties: {
		id: { type: "number" },
		parentId: { type: ["number", "null"] },
		name: { type: ["string", "null"] },
		nameEn: { type: ["string", "null"] },
		orderNo: { type: "number" },
		memberCount: { type: "number" },
	},
} as const;

const USER_ITEM = {
	type: "object",
	required: ["userId", "username", "deptId", "deptPath", "isMain"],
	properties: {
		userId: { type: "number" },
		username: { type: "string" },
		displayName: { type: ["string", "null"] },
		deptId: { type: "number" },
		deptPath: { type: "array", items: { type: "string" } },
		isMain: { type: "boolean" },
	},
} as const;

async function get() {
	await respond(async () => {
		const q = http.query as Record<string, unknown>;
		const reader = await resolveReadFace(q.scope);
		return readPicker(reader, { keyword: q.keyword, limit: q.limit });
	});
}
get.schema = {
	query: {
		type: "object",
		required: ["keyword"],
		properties: {
			scope: { type: "string", enum: ["self", "all"] },
			keyword: { type: "string", minLength: 2 },
			limit: { type: "number", minimum: 1, maximum: 50 },
		},
	},
};
get.response = {
	type: "object",
	required: ["departments", "users"],
	properties: {
		departments: { type: "array", items: DEPT_ITEM },
		users: { type: "array", items: USER_ITEM },
	},
};

export default { get };
