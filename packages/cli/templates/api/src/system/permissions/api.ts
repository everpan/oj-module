import { respond } from "../../_platform/_shared/respond";
// GET /api/system/permissions —— 权限点全量（C2 绑定编辑器数据源，deprecated 标灰）。
import { assertSystemAdmin } from "../../_platform/_shared/service/access";
import { listPermissions } from "../../_platform/_shared/service/roles";

async function get() {
	await respond(async () => {
		await assertSystemAdmin();
		return listPermissions();
	});
}
get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["code", "module", "title_key", "deprecated"],
		properties: {
			code: { type: "string" },
			module: { type: "string" },
			title_key: { type: ["string", "null"] },
			deprecated: { type: "boolean" },
		},
	},
};

export default { get };
