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
	description: "分页查询机器人换签（OBO）审计日志：每次 /api/auth/obo 调用无论成败都会留一行。仅 superadmin 可读。可按服务凭据名子串与成功/失败过滤。审计属安全敏感数据（D11），如需全量请走 /system/obo-audit/export。",
	query: {
		type: "object",
		properties: {
			svc: { type: "string", description: "按服务凭据名做包含匹配（子串），留空为不过滤。" },
			ok: { type: "string", description: "仅 \"1\"（成功）或 \"0\"（失败）生效，其他值忽略（不报错）。" },
			pageSize: { type: "number", minimum: 1, description: "每页条数，默认 50。" },
			current: { type: "number", minimum: 1, description: "页码，从 1 开始，默认 1。" },
		},
	},
};
get.response = {
	type: "object",
	required: ["list", "total", "pageSize", "current"],
	properties: {
		list: { type: "array", items: auditItemSchema, description: "当前页审计行（按 id 倒序，最新在前）。" },
		total: { type: "number", description: "满足过滤条件的总行数。" },
		pageSize: { type: "number", description: "实际使用的每页条数。" },
		current: { type: "number", description: "实际使用的页码。" },
	},
};

export default { get };
