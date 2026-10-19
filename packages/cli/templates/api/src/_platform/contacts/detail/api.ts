import { respond } from "../../_shared/respond";
// GET /api/_platform/contacts/detail?id= —— 单条详情（含 email/avatar，设计 §4B）。
import { contactDetail } from "../../_shared/service/domain/contacts";
import { rateLimit } from "../../_shared/service/infra/rate";

export default {
	async get() {
		await respond(async () => {
			const uid = http.user?.id;
			if (!uid) {
				json.fail(401, "unauthorized");
				return;
			}
			await rateLimit(`contacts:${uid}`, 60, 60_000);
			return contactDetail(Number((http.query as Record<string, unknown>).id));
		});
	},
};
