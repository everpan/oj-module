// 平台共享服务域 /api/_platform/contacts（D207：登录即可，不挂权限点，H12）。
// 读操作不记审计（设计 §4B）；接口级限速（设计 line 199）经 rate.ts（B5 复用同源）。
// 单条详情走子组 /api/_platform/contacts/detail?id=（detail/api.ts，含 email/avatar）。
import { respond } from "../_shared/respond";
import { searchContacts } from "../_shared/service/domain/contacts";
import { assertTenantSelf } from "../_shared/service/infra/access";
import { rateLimit } from "../_shared/service/infra/rate";

export default {
	// GET /api/_platform/contacts?keyword=&limit= —— 人员目录（AC1-22~24）。
	async get() {
		await respond(async () => {
			const uid = http.user?.id;
			if (!uid) {
				json.fail(401, "unauthorized");
				return;
			}
			// 目录是租户数据：伪造 X-TENANT-ID 时必须 403，否则能列出别家企业的人
			await assertTenantSelf();
			await rateLimit(`contacts:${uid}`, 60, 60_000);
			const q = http.query as Record<string, unknown>;
			return searchContacts(q.keyword, { limit: q.limit });
		});
	},
};
