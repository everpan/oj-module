// PUT /api/system/users/forbidden?uid= —— 禁用/解禁（禁用即删 refresh，撤销即强退）。
import { assertSystemAdmin } from "../../../../_platform/_shared/service/access";
import { setForbidden } from "../../../../_platform/_shared/service/users";

export default {
	async put() {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		json.ok(await setForbidden(Number(http.user?.id), Number(q.uid), Boolean(http.body?.forbidden)));
	},
};
