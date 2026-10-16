import { respond } from "../../../_platform/_shared/respond";
// PUT /api/system/users/roles?uid= —— 整集替换用户角色（AC1-7；sys_user_role 权威源 + 写时失效）。
import { assertSystemAdmin } from "../../../_platform/_shared/service/access";
import { updateUserRoles } from "../../../_platform/_shared/service/users";

async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		const roles = Array.isArray(http.body?.roles) ? http.body.roles.map(String) : [];
		return updateUserRoles(Number(http.user?.id), Number(q.uid), roles);
	});
}
put.schema = {
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

export default { put };
