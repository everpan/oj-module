import { respond } from "../../_shared/respond";
// GET /api/_platform/org/departments —— 部门平铺分页（共享读面）。
// 与 /org/tree 的差别在**分页与过滤**：大企业别一次拉全树，按 parent / keyword 分片取。
// parent=0 表示只要根层；不给 parent 即跨层全查（仍受 scope 收窄）。
import { pageDepartments, resolveReadFace } from "../../_shared/service/domain/org-read";

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

async function get() {
	await respond(async () => {
		const q = http.query as Record<string, unknown>;
		const reader = await resolveReadFace(q.scope);
		return pageDepartments(reader, { parent: q.parent, keyword: q.keyword, page: q.page, size: q.size });
	});
}
get.schema = {
	description: "部门平铺分页（共享读面）。大企业别一次拉全树，按 parent / keyword 分片取；parent=0 只要根层，不传 parent 跨层全查（仍受 scope 收窄）。",
	query: {
		type: "object",
		properties: {
			scope: { type: "string", enum: ["self", "all"], description: "读取范围：self=仅本人可见范围；all=全租户。" },
			parent: { type: "number", description: "父部门 id；0=只要根层；不传=跨层全查。" },
			keyword: { type: "string", description: "部门名关键词（子串匹配）。" },
			page: { type: "number", minimum: 1, description: "页码，从 1 起。" },
			size: { type: "number", minimum: 1, maximum: 200, description: "每页条数，1~200。" },
		},
	},
};
get.response = {
	type: "object",
	required: ["list", "total", "page", "size", "truncated"],
	properties: {
		list: { type: "array", items: DEPT_ITEM },
		total: { type: "number" },
		page: { type: "number" },
		size: { type: "number" },
		truncated: { type: "boolean" },
	},
};

export default { get };
