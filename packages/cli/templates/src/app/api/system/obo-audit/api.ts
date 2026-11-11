import { respond } from "#/_platform/_shared/respond";
import { searchOboAudit } from "#/_platform/_shared/service/domain/bot";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
// GET /api/system/obo-audit —— 换签审计分页查询。审计行由 auth/obo 端点写入（每次换签成败均记）。
// 只读取数（CSV 导出见 ./export）；审计导出属安全敏感（D11），assertSuperAdmin。

const auditItemSchema = {
	type: "object",
	required: ["id", "svc", "provider", "external_sub", "user_id", "ok", "reason", "ts"],
	properties: {
		id: { type: "number" },
		svc: { type: "string" },
		provider: { type: "string" },
		external_sub: { type: "string" },
		user_id: { type: "string" },
		ok: { type: "number" },
		reason: { type: "string" },
		ts: { type: "number" },
	},
} as const;

async function get() {
	await respond(async () => {
		await assertSuperAdmin();
		const q = http.query as Record<string, unknown>;
		return searchOboAudit({
			svc: String(q.svc ?? ""),
			ok: String(q.ok ?? ""),
			pageSize: Number(q.pageSize ?? 50) || 50,
			current: Number(q.current ?? 1) || 1,
		});
	});
}
get.schema = {
	query: {
		type: "object",
		properties: {
			svc: { type: "string" }, // 包含匹配（子串）
			ok: { type: "string" }, // "0"/"1" 生效，其余忽略
			pageSize: { type: "number", minimum: 1 },
			current: { type: "number", minimum: 1 },
		},
	},
};
get.response = {
	type: "object",
	required: ["list", "total", "pageSize", "current"],
	properties: {
		list: { type: "array", items: auditItemSchema },
		total: { type: "number" },
		pageSize: { type: "number" },
		current: { type: "number" },
	},
};

export default { get };
