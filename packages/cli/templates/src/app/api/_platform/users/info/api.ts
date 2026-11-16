import { respond } from "../../_shared/respond";
import { MAX_BATCH_IDS, usersInfoByIds } from "../../_shared/service/domain/user-info";
import { assertTenantSelf } from "../../_shared/service/infra/access";
import { rateLimit } from "../../_shared/service/infra/rate";

// GET /api/_platform/users/info?ids=1,2,3 —— 批量按 id 取完整用户信息（登录即可）。
// 服务层一次 IN 批量查询 + 批量角色，无 N+1；租户注入 + 租户自洽 + 接口级限速。
// 缺失/跨租户 id 不返回（不占位）。第三方模块请走 runtime 的 fetchUserInfosByIDs。
const handler = {
	async get() {
		await respond(async () => {
			const uid = http.user?.id;
			if (!uid) {
				json.fail(401, "unauthorized");
				return;
			}
			await assertTenantSelf();
			await rateLimit(`users-info:${uid}`, 60, 60_000);
			const q = http.query as Record<string, unknown>;
			// ids 支持逗号分隔（?ids=1,2,3）与重复键（?ids=1&ids=2）；逐段归一交给服务层。
			const raw = q.ids;
			const parts = (Array.isArray(raw) ? raw : [raw])
				.flatMap(v => String(v ?? "").split(","))
				.map(s => s.trim())
				.filter(Boolean);
			return usersInfoByIds(parts);
		});
	},
};

handler.get.schema = {
	description: `批量按 id 取用户完整展示信息（登录即可，租户隔离）：id / username / displayName / avatar / email / phoneNumber / description / roles / mustChange。一次 IN 批量查询、无 N+1；ids 逗号分隔（或重复传），单次上限 ${MAX_BATCH_IDS}。缺失/跨租户 id 不返回。每用户 60 次/分钟限速。解决方案模块请用 runtime 的 fetchUserInfosByIDs。`,
	query: {
		type: "object",
		required: ["ids"],
		properties: {
			ids: { type: "string", description: `用户 id 列表，逗号分隔，最多 ${MAX_BATCH_IDS} 个（如 ids=1,2,3）。` },
		},
	},
};

handler.get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["id", "username", "displayName", "avatar", "email", "phoneNumber", "description", "roles", "mustChange"],
		properties: {
			id: { type: "number" },
			username: { type: "string" },
			displayName: { type: "string" },
			avatar: { type: "string" },
			email: { type: "string" },
			phoneNumber: { type: "string" },
			description: { type: "string" },
			roles: { type: "array", items: { type: "string" } },
			mustChange: { type: "boolean" },
		},
	},
};

export default handler;
