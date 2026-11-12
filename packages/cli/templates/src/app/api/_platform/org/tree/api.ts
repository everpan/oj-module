import { respond } from "../../_shared/respond";
// GET /api/_platform/org/tree —— 部门树（共享读面，方案 A3 / §5.2）。
//
// **返回平表而不是嵌套树**：oj 的契约 IR 不支持递归 schema（无 $ref），嵌套深度写不进契约；
// 树由前端按 parentId 组装（与管理端 /api/system/departments 同口径）。
//
// 本端点只出「活着且同步可见」的部门（软删与失去可见范围的行不出）——那是管理端的事。
import { readTree, resolveReadFace } from "../../_shared/service/domain/org-read";

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
		const reader = await resolveReadFace((http.query as Record<string, unknown>).scope);
		return readTree(reader);
	});
}
get.schema = {
	description: "部门树（以平表返回，前端按 parentId 组装；契约 IR 不支持递归 schema）。只含存活且同步可见的部门——软删行与失去可见范围的行不出，那是管理端 /api/system/departments 的事。",
	query: {
		type: "object",
		properties: { scope: { type: "string", enum: ["self", "all"] } },
	},
};
get.response = { type: "array", items: DEPT_ITEM };

export default { get };
