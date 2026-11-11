import { respond } from "#/_platform/_shared/respond";
import { exchangeObo } from "#/_platform/_shared/service/domain/bot";
// POST /api/auth/obo —— 机器人以 svc token 代表员工换 10-min 受托 token（线路 B）。
// 守卫已验签（Bearer svc token，roles:["bot"]）；本端点不挂 admin 门禁——svc 身份不是 users 行，
// assertSystemAdmin/currentAccess 会因查无此行拒权，判权依据就是 Bearer 本身（双查 svc 名 + bot 角色）。
// 冻结码契约见 _shared/service/domain/bot.ts：40310/40311/40312/40313（信封 code，HTTP 落 500）。

async function post() {
	await respond(async () => {
		const b = (http.body || {}) as Record<string, unknown>;
		const claims = ((http.user && http.user.claims) || {}) as Record<string, unknown>;
		const roles = ((http.user && http.user.roles) || []) as string[];
		return exchangeObo({
			provider: String(b.provider ?? ""),
			external_sub: String(b.external_sub ?? ""),
			svc: claims.svc,
			jti: claims.jti,
			roles,
			tenant: claims.tenant,
		});
	});
}
post.schema = {
	body: {
		type: "object",
		required: ["provider", "external_sub"],
		properties: {
			provider: { type: "string", minLength: 1 },
			external_sub: { type: "string", minLength: 1 },
		},
	},
};
post.response = {
	type: "object",
	required: ["access_token", "expires_in"],
	properties: {
		access_token: { type: "string" }, // 受托 token，10 分钟；401 才重换签、限一次、勿预缓存
		expires_in: { type: "number" },
	},
};

export default { post };
