import { respond } from "#/_platform/_shared/respond";
import { setForbidden } from "#/_platform/_shared/service/domain/users";
// PUT /api/system/users/forbidden?uid= —— 禁用/解禁（禁用即删 refresh，撤销即强退）。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		return setForbidden(Number(http.user?.id), Number(q.uid), Boolean(http.body?.forbidden));
	});
}
put.schema = {
	description: "禁用或解禁用户。禁用会级联删除其 refresh token（等于立即强退）。仅系统管理员，且不能操作自己。",
	query: {
		type: "object",
		required: ["uid"],
		properties: { uid: { type: "number" } },
	},
	body: {
		type: "object",
		required: ["forbidden"],
		properties: { forbidden: { type: "boolean" } },
	},
};

// 出参无业务载荷（service 返回 void → data 为 null）
put.response = { type: "null" };

export default { put };
