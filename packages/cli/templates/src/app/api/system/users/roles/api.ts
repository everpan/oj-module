import { respond } from "#/_platform/_shared/respond";
import { updateUserRoles } from "#/_platform/_shared/service/domain/users";
// PUT /api/system/users/roles?uid= —— 整集替换用户角色（AC1-7；sys_user_role 权威源 + 写时失效）。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		const roles = Array.isArray(http.body?.roles) ? http.body.roles.map(String) : [];
		return updateUserRoles(Number(http.user?.id), Number(q.uid), roles);
	});
}
put.schema = {
	description: "整集替换用户角色（sys_user_role 权威源，写时失效判权缓存）。roles 传空数组即清空该用户全部角色。仅系统管理员。",
	query: {
		type: "object",
		required: ["uid"],
		properties: { uid: { type: "number" } },
	},
	body: {
		type: "object",
		required: ["roles"],
		properties: { roles: { type: "array", items: { type: "string" } } },
	},
};

// 出参无业务载荷（service 返回 void → data 为 null）
put.response = { type: "null" };

export default { put };
