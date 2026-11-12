import { respond } from "../../_shared/respond";
// GET /api/_platform/contacts/detail?id= —— 单条详情（含 email/avatar，设计 §4B）。
import { contactDetail } from "../../_shared/service/domain/contacts";
import { assertTenantSelf } from "../../_shared/service/infra/access";
import { rateLimit } from "../../_shared/service/infra/rate";

const handler = {
	async get() {
		await respond(async () => {
			const uid = http.user?.id;
			if (!uid) {
				json.fail(401, "unauthorized");
				return;
			}
			// 详情跨人可读，故与目录同一条租户自洽约束（伪造头 → 403，不靠「查无此行」静默 404）
			await assertTenantSelf();
			await rateLimit(`contacts:${uid}`, 60, 60_000);
			return contactDetail(Number((http.query as Record<string, unknown>).id));
		});
	},
};

// 入参：id 必填（详情按 id 取单条）
handler.get.schema = {
	description: "查单个人员详情（登录即可）。比目录多出 email 与 avatar_base64；这两项只在详情端点下发（安全评审 P2）。",
	query: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "number" } },
	},
};

// 出参：详情比目录多 email/avatar（安全评审 P2：仅详情端点给）
handler.get.response = {
	type: "object",
	required: ["id", "username", "display_name", "email", "avatar_base64"],
	properties: {
		id: { type: "number" },
		username: { type: "string" },
		display_name: { type: ["string", "null"] },
		email: { type: ["string", "null"] },
		avatar_base64: { type: ["string", "null"] },
	},
};

export default handler;
