// GET /api/system/permissions —— 权限点全量（C2 绑定编辑器数据源，deprecated 标灰）。
import { assertSystemAdmin } from "../../../_platform/_shared/service/access";
import { listPermissions } from "../../../_platform/_shared/service/roles";

export default {
	async get() {
		await assertSystemAdmin();
		json.ok(await listPermissions());
	},
};
