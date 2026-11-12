import { respond } from "../../_shared/respond";
// GET /api/_platform/org/user?uid= —— 某人的部门路径 / 主部门 / 职务（共享读面）。
// 不给 uid 即查自己；scope=self 下问别人 → 403（不是 404：不泄露账号存在性）。
import { readUserDepartments, resolveReadFace } from "../../_shared/service/domain/org-read";

async function get() {
	await respond(async () => {
		const q = http.query as Record<string, unknown>;
		const reader = await resolveReadFace(q.scope);
		return readUserDepartments(reader, q.uid == null || String(q.uid).trim() === "" ? reader.uid : Number(q.uid));
	});
}
get.schema = {
	description: "查某人的部门路径 / 主部门 / 职务。不传 uid 即查自己；scope=self 下问别人返回 403（不是 404——不泄露账号存在性）。",
	query: {
		type: "object",
		properties: {
			scope: { type: "string", enum: ["self", "all"], description: "读取范围：self=仅本人可见范围；all=全租户。" },
			uid: { type: "number", description: "要查的 user_id；不传即查自己。" },
		},
	},
};
get.response = {
	type: "object",
	required: ["userId", "username", "position", "mainDeptId", "mainDeptPath", "departments"],
	properties: {
		userId: { type: "number" },
		username: { type: "string" },
		displayName: { type: ["string", "null"] },
		position: { type: ["string", "null"] },
		mainDeptId: { type: ["number", "null"] },
		mainDeptPath: { type: "array", items: { type: "string" } },
		departments: {
			type: "array",
			items: {
				type: "object",
				required: ["deptId", "deptPath"],
				properties: {
					deptId: { type: "number" },
					deptPath: { type: "array", items: { type: "string" } },
				},
			},
		},
	},
};

export default { get };
