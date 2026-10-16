// PUT /api/system/roles/bindings?name=xxx —— 整集替换角色绑定。
// AC1-18 声明角色绑定可调整；AC1-19 builtin 硬拒（service 层）；AC1-30 摘绑定 = 紧急吊销出口
// （service 内写后按持有者失效判权缓存）。
import { assertSystemAdmin } from "../../../../_platform/_shared/service/access";
import { updateBindings } from "../../../../_platform/_shared/service/roles";

export default {
	async put() {
		await assertSystemAdmin();
		const name = String((http.query as Record<string, unknown>).name ?? "");
		const codes = Array.isArray(http.body?.permissions) ? http.body.permissions.map(String) : [];
		json.ok(await updateBindings(name, codes));
	},
};
