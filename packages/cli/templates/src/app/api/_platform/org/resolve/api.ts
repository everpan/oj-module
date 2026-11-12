import { respond } from "../../_shared/respond";
// POST /api/_platform/org/resolve —— 把「部门（含子部门）」展开成 user_id 列表。
//
// ⚡ 这是共享读面**真正的价值**：需求方要的是「算」不是「看」。缺了它，每个消费模块都会自己
// 把树拉下来递归，共享名存实亡（方案 §5.2）。典型用法：通知/审批按「某部门及其下级」定收件人。
//
// 结果去重升序，可直接当收件人集合用；显式传的 userIds 原样并入（再去重）。
import { resolveReadFace, resolveUserIds } from "../../_shared/service/domain/org-read";

async function post() {
	await respond(async () => {
		const q = http.query as Record<string, unknown>;
		const reader = await resolveReadFace(q.scope);
		const b = (http.body || {}) as { deptIds?: unknown, userIds?: unknown, includeSub?: boolean };
		return { userIds: await resolveUserIds(reader, { deptIds: b.deptIds, userIds: b.userIds, includeSub: b.includeSub }) };
	});
}
post.schema = {
	description: "把部门（含子部门）展开成 user_id 列表，供通知/审批按「某部门及其下级」定收件人。结果去重升序；显式传入的 userIds 原样并入。这是共享读面里唯一「算」型端点——需要收件人集合时用它，不要自己拉树递归。",
	query: {
		type: "object",
		properties: { scope: { type: "string", enum: ["self", "all"] } },
	},
	body: {
		type: "object",
		properties: {
			deptIds: { type: "array", items: { type: "number" }, description: "要展开的部门 id 数组；includeSub=true 时含其子部门。" },
			userIds: { type: "array", items: { type: "number" }, description: "额外并入的 user_id 数组（去重后一起返回）。" },
			includeSub: { type: "boolean", description: "是否把子部门成员一并展开，默认 false。" },
		},
	},
};
post.response = {
	type: "object",
	required: ["userIds"],
	properties: { userIds: { type: "array", items: { type: "number" } } },
};

export default { post };
