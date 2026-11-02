import { respond } from "../../_shared/respond";
// GET /api/_platform/org/members —— 部门成员 + 部门路径（共享读面）。
// 不给 dept 即查可见范围内的全部成员（配 keyword 用）。
// ⚡ includeSub 在 scope=self 下只对「我所在部门」生效：对上级部门一展开就是整棵子树，
// 那等于绕过自身路径的限制，所以宁可 400 也不静默截断（见 org-read.ts 头注）。
import { pageMembers, resolveReadFace } from "../../_shared/service/domain/org-read";

const MEMBER_ITEM = {
	type: "object",
	required: ["userId", "username", "deptId", "deptPath", "isMain"],
	properties: {
		userId: { type: "number" },
		username: { type: "string" },
		displayName: { type: ["string", "null"] },
		deptId: { type: "number" },
		// 根在前的部门名路径（部门名缺失时退 `#id`）
		deptPath: { type: "array", items: { type: "string" } },
		isMain: { type: "boolean" },
	},
} as const;

async function get() {
	await respond(async () => {
		const q = http.query as Record<string, unknown>;
		const reader = await resolveReadFace(q.scope);
		return pageMembers(reader, { dept: q.dept, includeSub: q.includeSub, keyword: q.keyword, page: q.page, size: q.size });
	});
}
get.schema = {
	query: {
		type: "object",
		properties: {
			scope: { type: "string", enum: ["self", "all"] },
			dept: { type: "number" },
			// 查询串是字符串：`true` / `1` 视为展开子部门
			includeSub: { type: "string" },
			keyword: { type: "string" },
			page: { type: "number", minimum: 1 },
			size: { type: "number", minimum: 1, maximum: 200 },
		},
	},
};
get.response = {
	type: "object",
	required: ["list", "total", "page", "size", "truncated"],
	properties: {
		list: { type: "array", items: MEMBER_ITEM },
		total: { type: "number" },
		page: { type: "number" },
		size: { type: "number" },
		truncated: { type: "boolean" },
	},
};

export default { get };
