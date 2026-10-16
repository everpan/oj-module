// GET /api/_platform/contacts/detail?id= —— 单条详情（含 email/avatar，设计 §4B）。
import { contactDetail } from "../../../_shared/service/contacts";
import { rateLimit } from "../../../_shared/service/rate";

export default {
	async get() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		await rateLimit(`contacts:${uid}`, 60, 60_000);
		json.ok(await contactDetail(Number((http.query as Record<string, unknown>).id)));
	},
};
