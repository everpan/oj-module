import { respond } from "../../../_platform/_shared/respond";
// PUT /api/system/roles/bindings?name=xxx —— 整集替换角色绑定。
// AC1-18 声明角色绑定可调整；AC1-19 builtin 硬拒（service 层）；AC1-30 摘绑定 = 紧急吊销出口
// （service 内写后按持有者失效判权缓存）。
import { assertSystemAdmin } from "../../../_platform/_shared/service/access";
import { updateBindings } from "../../../_platform/_shared/service/roles";

async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const name = String((http.query as Record<string, unknown>).name ?? "");
		const codes = Array.isArray(http.body?.permissions) ? http.body.permissions.map(String) : [];
		return updateBindings(name, codes);
	});
}
put.schema = {
	query: {
		type: "object",
		required: ["name"],
		properties: { name: { type: "string", minLength: 1 } },
	},
	body: {
		type: "object",
		required: ["permissions"],
		properties: { permissions: { type: "array", items: { type: "string" } } },
	},
};

export default { put };
