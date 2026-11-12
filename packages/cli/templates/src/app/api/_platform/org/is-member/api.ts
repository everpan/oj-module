import { respond } from "../../_shared/respond";
// GET /api/_platform/org/is-member?uid=&dept= —— 某人是否在某部门（**含子部门**）下。
// 第二个「算」型端点：按部门做访问控制/路由时，调用方不该自己去拉树递归。
// scope=self 下只能问自己（问别人 → 403）。
import { isMemberOf, resolveReadFace } from "../../_shared/service/domain/org-read";

async function get() {
	await respond(async () => {
		const q = http.query as Record<string, unknown>;
		const reader = await resolveReadFace(q.scope);
		const uid = q.uid == null || String(q.uid).trim() === "" ? reader.uid : Number(q.uid);
		return { isMember: await isMemberOf(reader, uid, Number(q.dept)) };
	});
}
get.schema = {
	description: "判断某人是否在指定部门下（含子部门）。按部门做访问控制/路由时用它，不要自己拉树递归。scope=self 只能问自己，问别人返回 403。",
	query: {
		type: "object",
		required: ["dept"],
		properties: {
			scope: { type: "string", enum: ["self", "all"], description: "读取范围：self=仅本人可见范围；all=全租户。" },
			// 不给 uid 即问自己
			uid: { type: "number", description: "要判断的 user_id；不传即问自己。" },
			dept: { type: "number", description: "部门 id（含其子部门一起判断）。" },
		},
	},
};
get.response = {
	type: "object",
	required: ["isMember"],
	properties: { isMember: { type: "boolean" } },
};

export default { get };
