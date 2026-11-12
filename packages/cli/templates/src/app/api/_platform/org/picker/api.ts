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
	description: "选人组件数据源：一次返回匹配的部门与人员（混合），免去前端两次请求。keyword 必填且至少 2 字符（枚举面红线，与通讯录同口径）。",
	query: {
		type: "object",
		required: ["keyword"],
		properties: {
			scope: { type: "string", enum: ["self", "all"], description: "读取范围：self=仅本人可见范围；all=全租户。" },
			keyword: { type: "string", minLength: 2, description: "搜索关键词，最少 2 字符。" },
			limit: { type: "number", minimum: 1, maximum: 50, description: "每类结果条数上限，1~50。" },
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
