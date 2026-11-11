import { respond } from "#/_platform/_shared/respond";
import {
	issueSvcToken,
	listSvcTokens,
	revokeSvcToken,
	SVC_SCOPES,
} from "#/_platform/_shared/service/domain/bot";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
// /api/system/service-token —— 机器人服务凭据（svc token）签发 / 列表 / 吊销。
// 明文 token 只在 POST 响应出现一次（不落库不回显）；吊销 = 删登记行
// （行即核销真相源——serve SvcGate 与 obo 换签都以「行存在」为准，fail-closed）。
// 安全敏感：签发/吊销一律 assertSuperAdmin（D11，与 MCP 管理页同权）。

const svcTokenItemSchema = {
	type: "object",
	required: ["jti", "name", "scopes", "created_by", "created_at"],
	properties: {
		jti: { type: "string" },
		name: { type: "string" },
		scopes: { type: "array", items: { type: "string" } },
		created_by: { type: "string" },
		created_at: { type: "number" },
	},
} as const;

async function get() {
	await respond(async () => {
		await assertSuperAdmin();
		return listSvcTokens();
	});
}
get.response = { type: "array", items: svcTokenItemSchema };

async function post() {
	await respond(async () => {
		await assertSuperAdmin();
		const b = (http.body || {}) as Record<string, unknown>;
		const name = String(b.name ?? "").trim();
		const scopes: string[] = Array.isArray(b.scopes) ? b.scopes.map(String) : ["read"];
		return issueSvcToken(name, scopes, String(http.user?.id ?? ""), String((http.user?.claims as any)?.tenant ?? "default"));
	});
}
post.schema = {
	body: {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string", minLength: 1 },
			// 档位白名单（read/write/destructive）；destructive 永不建议给机器人。
			scopes: { type: "array", items: { type: "string", enum: [...SVC_SCOPES] } },
		},
	},
};
post.response = {
	type: "object",
	required: ["token", "jti"],
	properties: {
		token: { type: "string" }, // 明文仅此一次，立即转存密管/vars
		jti: { type: "string" },
	},
};

// DELETE /api/system/service-token?jti= —— 吊销（删登记行，最长 30s 全网失效）。
async function del() {
	await respond(async () => {
		await assertSuperAdmin();
		const q = http.query as Record<string, unknown>;
		return revokeSvcToken(String(q.jti ?? ""));
	});
}
del.schema = {
	query: {
		type: "object",
		required: ["jti"],
		properties: { jti: { type: "string", minLength: 1 } },
	},
};
del.response = {
	type: "object",
	required: ["revoked"],
	properties: { revoked: { type: "number" } },
};

export default { get, post, del };
