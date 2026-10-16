// 管理域端点 /api/system/roles（设计文档 D207：/api/system/* = 管理域，assertSystemAdmin 判权）。
// handler 层只编排：守卫 → service → json 信封；name 走 query（wiki 先例：静态段 + http.query）。
import { assertSystemAdmin } from "../../../_platform/_shared/service/access";
import { createRole, deleteRole, listRoles } from "../../../_platform/_shared/service/roles";

async function guard(): Promise<void> {
	await assertSystemAdmin();
}

export default {
	// GET /api/system/roles —— 角色列表（含持有计数与绑定，C2 页面数据源）。
	async get() {
		await guard();
		json.ok(await listRoles());
	},
	// POST /api/system/roles —— 建角色（AC1-16：custom.<slug> 机器名 + 勾选绑定）。
	async post() {
		await guard();
		json.ok(await createRole(http.body || {}));
	},
	// DELETE /api/system/roles?name=xxx —— 删角色（AC1-20 占用禁删，409 带 holders）。
	async del() {
		await guard();
		json.ok(await deleteRole(String((http.query as Record<string, unknown>).name ?? "")));
	},
};
