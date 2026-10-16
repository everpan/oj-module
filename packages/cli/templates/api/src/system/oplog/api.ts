import { respond } from "../../_platform/_shared/respond";
// GET /api/system/oplog?action=&username=&module=&limit= —— 操作日志查询（AC1-29；D13 admin 可查）。
import { assertSystemAdmin } from "../../_platform/_shared/service/access";
import { searchOplog } from "../../_platform/_shared/service/oplog";

export default {
	async get() {
		await respond(async () => {
			await assertSystemAdmin();
			return searchOplog(http.query as Record<string, unknown>);
		});
	},
};
