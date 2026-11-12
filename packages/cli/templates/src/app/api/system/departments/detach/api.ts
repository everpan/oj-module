import type { OrgDeps } from "#/_platform/_shared/service/domain/org";
import { respond } from "#/_platform/_shared/respond";
import { detachToLocal } from "#/_platform/_shared/service/domain/org";
// POST /api/system/departments/detach?id= —— 「转为本地维护」（D14 保底出口）。
//
// 把一行脱离适配器管辖（origin → local）：此后改名/移动/删除全开，且后续同步轮次
// 不再改写它。这是「外部源只给了残缺数据（如企微未授权部门名）」时唯一的出路。
// 反向操作不提供：转回去后下一次同步立刻按源口径改写，语义不可控。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

const orgDeps: OrgDeps = { now: () => Math.floor(Date.now() / 1000) };

async function post() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		await detachToLocal(Number(q.id), orgDeps);
		return { ok: true };
	});
}
post.schema = {
	description: "把部门转为本地维护（origin → local）：此后可自由改名/移动/删除，且后续同步轮次不再改写它。这是外部源只给残缺数据（如未授权部门名）时的唯一出路；反向操作不提供（转回去下一次同步立刻被覆盖）。仅系统管理员。",
	query: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "number" } },
	},
};
post.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

export default { post };
