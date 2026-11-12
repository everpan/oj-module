// 平台共享服务域 /api/_platform/contacts（D207：登录即可，不挂权限点，H12）。
// 读操作不记审计（设计 §4B）；接口级限速（设计 line 199）经 rate.ts（B5 复用同源）。
// 单条详情走子组 /api/_platform/contacts/detail?id=（detail/api.ts，含 email/avatar）。
import { respond } from "../_shared/respond";
import { searchContacts } from "../_shared/service/domain/contacts";
import { assertTenantSelf } from "../_shared/service/infra/access";
import { rateLimit } from "../_shared/service/infra/rate";

const handler = {
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

// 入参：keyword 必填（服务层红线 2~64 字符），limit 可选（钳 200）
handler.get.schema = {
	description: "人员目录搜索（登录即可，无权限点）。keyword 必填且至少 2 字符（防枚举整份名册）；只返回 id/username/display_name，不含邮箱与头像——要详情请用 /_platform/contacts/detail。每用户 60 次/分钟限速。",
	query: {
		type: "object",
		required: ["keyword"],
		properties: {
			keyword: { type: "string", minLength: 2, description: "搜索关键词，最少 2 字符，按姓名/账号子串匹配。" },
			limit: { type: "number", description: "返回条数上限，服务端钳到 200。" },
		},
	},
};

// 出参：目录红线只出 id/username/display_name（不含 email/avatar/roles）
handler.get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["id", "username", "display_name"],
		properties: {
			id: { type: "number" },
			username: { type: "string" },
			display_name: { type: ["string", "null"] },
		},
	},
};

export default handler;
