import type { OrgDeps } from "#/_platform/_shared/service/domain/org";
import { respond } from "#/_platform/_shared/respond";
import { moveDepartment } from "#/_platform/_shared/service/domain/org";
// PUT /api/system/departments/move?id= —— 改父级（拖拽排序的数据出口）。
// parentId=null 即移到根下；自挂与「挂到自己的子孙」由领域层判环后 400。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

const orgDeps: OrgDeps = { now: () => Math.floor(Date.now() / 1000) };

async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		const b = http.body || {};
		const raw = (b as { parentId?: number | null }).parentId;
		await moveDepartment(Number(q.id), raw == null ? null : Number(raw), orgDeps);
		return { ok: true };
	});
}
put.schema = {
	query: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "number" } },
	},
	body: {
		type: "object",
		required: ["parentId"],
		// 显式 null = 提到根；不给这个键按 schema 视为未提供
		properties: { parentId: { type: ["number", "null"] } },
	},
};
put.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

export default { put };
