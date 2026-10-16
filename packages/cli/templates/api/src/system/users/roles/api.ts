import { respond } from "../../../_platform/_shared/respond";
// PUT /api/system/users/roles?uid= —— 整集替换用户角色（AC1-7；sys_user_role 权威源 + 写时失效）。
import { assertSystemAdmin } from "../../../_platform/_shared/service/access";
import { updateUserRoles } from "../../../_platform/_shared/service/users";

export default {
	async put() {
		await respond(async () => {
			await assertSystemAdmin();
			const q = http.query as Record<string, unknown>;
			const roles = Array.isArray(http.body?.roles) ? http.body.roles.map(String) : [];
			return updateUserRoles(Number(http.user?.id), Number(q.uid), roles);
		});
	},
};
