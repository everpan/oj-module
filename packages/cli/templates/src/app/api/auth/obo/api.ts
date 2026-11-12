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
	description: "机器人以服务凭据（svc token，Bearer）代表某个员工换取 10 分钟受托 token（OBO，线路 B）。调用方必须是 svc 身份（roles 含 bot），不能用人 token。provider 固定传 wecom，external_sub 传企微 userid。失败返回信封 code 40310（未绑定）/40311（已吊销）/40312（非机器人凭据）/40313（凭据停用），HTTP 均为 500——请按 code 分支，不要按状态码判断。",
	body: {
		type: "object",
		required: ["provider", "external_sub"],
		properties: {
			provider: { type: "string", minLength: 1, description: "身份提供方标识；企微场景固定为 \"wecom\"。" },
			external_sub: { type: "string", minLength: 1, description: "提供方侧的用户唯一标识；企微场景为该员工 userid（对应 X-WeCom-User-Id）。" },
		},
	},
};
post.response = {
	type: "object",
	required: ["access_token", "expires_in"],
	properties: {
		// 受托 token，10 分钟；401 才重换签、限一次、勿预缓存
		access_token: { type: "string", description: "受托 token，有效期 10 分钟。仅用于调用 /api/mcp，不要长期缓存；收到 401 再重换，且每次重试只换一次。" },
		expires_in: { type: "number", description: "剩余有效秒数（约 600）。" },
	},
};

export default { post };
