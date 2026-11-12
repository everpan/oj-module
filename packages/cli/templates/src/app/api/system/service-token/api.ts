import { respond } from "#/_platform/_shared/respond";
import {
	issueSvcToken,
	listSvcTokens,
	revokeSvcToken,
	SVC_SCOPES,
} from "#/_platform/_shared/service/domain/bot";
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";
// /api/system/service-token —— 机器人服务凭据（svc token）签发 / 列表 / 吊销。
// 明文 token 只在 POST 响应出现一次（不落库不回显）；吊销 = 删登记行
// （行即核销真相源——serve SvcGate 与 obo 换签都以「行存在」为准，fail-closed）。
// 签发/列表/吊销下放给每租户 admin（assertSystemAdmin，Q-I 自助形态，方案 §4.1）；
// 目标租户取自调用者签名 claim（sql_guard 自动注入，跨租户提权红线：绝不自报）。

const svcTokenItemSchema = {
	type: "object",
	required: ["jti", "name", "scopes", "created_by", "created_at", "expires_at", "status", "grace_until"],
	properties: {
		jti: { type: "string", description: "凭据唯一 id（登记行主键，吊销与轮换都按它定位）。" },
		name: { type: "string", description: "凭据名称；本租户内同名重复签发会轮换旧凭据。" },
		scopes: { type: "array", items: { type: "string" }, description: "档位：read / write / destructive。" },
		created_by: { type: "string", description: "签发人用户 id。" },
		created_at: { type: "number", description: "签发时间（epoch 秒）。" },
		// 到期时间戳（秒）；前端到期看板 / 批量轮换导出（K6 缓解）直接读此列。
		expires_at: { type: "number", description: "到期时间（epoch 秒）。到期后该凭据不可用，需重新签发。" },
		// v0.1.132 SvcGate/rotate 契约：active/superseded（缺省 active）；grace_until 为 epoch 秒。
		status: { type: "string", description: "active=当前有效；superseded=已被同名重签发替换（仅宽限期内仍可用）。" },
		grace_until: { type: "number", description: "superseded 行的宽限截止（epoch 秒）；0 表示不在宽限期。过期即失效。" },
	},
} as const;

async function get() {
	await respond(async () => {
		await assertSystemAdmin();
		return listSvcTokens();
	});
}
get.schema = {
	description: "列出本租户全部服务凭据（svc token）：jti、名称、档位、签发人与时间、到期时间、状态（active/superseded）与宽限截止。明文 token 永不回显（只在签发响应出现一次）。用于盘点到期待轮换的凭据。",
};
get.response = { type: "array", items: svcTokenItemSchema };

async function post() {
	await respond(async () => {
		await assertSystemAdmin();
		const b = (http.body || {}) as Record<string, unknown>;
		const name = String(b.name ?? "").trim();
		const scopes: string[] = Array.isArray(b.scopes) ? b.scopes.map(String) : ["read"];
		// Q-B 有效期契约（方案 §4.1）：ttl_days 仅整数 0..90；非整数/越界由 schema 拒；
		// 透传给 issueSvcToken 翻译为 ttl_secs（0/缺省=长期 90d，>0=min(days,90) 天）。
		const ttlDays = typeof b.ttl_days === "number" && Number.isInteger(b.ttl_days) ? b.ttl_days : undefined;
		return issueSvcToken(name, scopes, String(http.user?.id ?? ""), String((http.user?.claims as any)?.tenant ?? "default"), ttlDays);
	});
}
post.schema = {
	description: "签发一张本租户服务凭据（svc token），供机器人/agent 直连 {base}/mcp。同名重复签发＝轮换：旧行自动置 superseded 并保留 24h 宽限（在途旧 bearer 仍可用），保证每 (租户, name) 至多一行 active。返回的 token 明文仅此一次，请立即转存；泄漏时用 DELETE 吊销。",
	body: {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string", minLength: 1, description: "凭据名称（本租户内的语义键；同名重签发会轮换旧凭据）。" },
			// 档位白名单（read/write/destructive）；destructive 永不建议给机器人。
			scopes: { type: "array", items: { type: "string", enum: [...SVC_SCOPES] }, description: "档位白名单：read=GET；write=POST/PUT/PATCH（含按 POST 发查询的路由）；destructive=DELETE。机器人代员工执行 tools/call 需 write。" },
			// Q-B：0=长期固定（系统上限 90d，到期轮换 SOP）；>0=有效期天数（≤90）。
			ttl_days: { type: "integer", minimum: 0, maximum: 90, description: "有效期天数：0 或省略=长期固定（系统上限 90 天，到期需轮换）；1..90=对应天数。超过 90 被拒（400）。" },
		},
	},
};
post.response = {
	type: "object",
	required: ["token", "jti"],
	properties: {
		token: { type: "string", description: "凭据明文（Bearer 值），仅此一次返回，立即转存。" }, // 明文仅此一次，立即转存密管/vars
		jti: { type: "string", description: "凭据 id，后续吊销/对账用。" },
	},
};

// DELETE /api/system/service-token?jti= —— 吊销（删登记行，最长 30s 全网失效）。
async function del() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		return revokeSvcToken(String(q.jti ?? ""));
	});
}
del.schema = {
	description: "吊销一张服务凭据（按 jti 删除登记行）。网关 SvcGate 最长 30 秒内全网失效（fail-closed）；已签出的受托 token 不受影响（无状态，最长 10 分钟自然过期）。",
	query: {
		type: "object",
		required: ["jti"],
		properties: { jti: { type: "string", minLength: 1, description: "要吊销的凭据 jti（来自列表或签发响应）。" } },
	},
};
del.response = {
	type: "object",
	required: ["revoked"],
	properties: { revoked: { type: "number", description: "实际删除的登记行数（1=已吊销；0 行会按 404 返回）。" } },
};

export default { get, post, del };
