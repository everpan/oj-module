import { respond } from "#/_platform/_shared/respond";
import { importBindings } from "#/_platform/_shared/service/domain/bot";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
// POST /api/system/bot-binding/import —— CSV 批量导入。
// 用 JSON 包装 {csv}（而非裸 text/csv）：模板全面启用 schema_validation，且生成的 __client
// 走 JSON 体，前端读文件→全文→{csv} 即达。CSV 首行表头 provider,external_sub,user_id。
// 行数上限沿管线 max_upload（请求体闸），不另设。

async function post() {
	await respond(async () => {
		await assertSuperAdmin();
		const b = (http.body || {}) as Record<string, unknown>;
		return importBindings(String(b.csv ?? ""), String(http.user?.id ?? ""));
	});
}
post.schema = {
	body: {
		type: "object",
		required: ["csv"],
		properties: { csv: { type: "string" } },
	},
};
post.response = {
	type: "object",
	required: ["imported", "skipped", "total"],
	properties: {
		imported: { type: "number" },
		skipped: { type: "array", items: { type: "string" } },
		total: { type: "number" },
	},
};

export default { post };
