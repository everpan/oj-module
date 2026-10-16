import { respond } from "../../_platform/_shared/respond";
// /api/system/settings —— 系统设置（PRD §4.3）：GET 按组列出（secret 掩码），PUT 写值（写审计）。
import { assertSystemAdmin } from "../../_platform/_shared/service/access";
import { listSettings, updateSetting } from "../../_platform/_shared/service/settings";

export default {
	async get() {
		await respond(async () => {
			await assertSystemAdmin();
			return listSettings();
		});
	},
	async put() {
		await respond(async () => {
			await assertSystemAdmin();
			const body = http.body || {};
			return updateSetting(Number(http.user?.id), String(body.key ?? ""), String(body.value ?? ""));
		});
	},
};
