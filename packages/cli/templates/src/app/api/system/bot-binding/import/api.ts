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
	description: "用 CSV 全文批量导入员工绑定（provider + external_sub → 本系统 user_id），按 provider+external_sub upsert。CSV 首行必须是表头 provider,external_sub,user_id。仅 superadmin 可调用。整体行数受上传体积上限约束（不另设行数限制）。返回成功条数、被跳过行（格式错误或缺列）与总行数。",
	body: {
		type: "object",
		required: ["csv"],
		properties: {
			csv: { type: "string", description: "完整 CSV 文本，首行为表头 provider,external_sub,user_id，后续每行一条绑定；请勿传文件二进制。" },
		},
	},
};
post.response = {
	type: "object",
	required: ["imported", "skipped", "total"],
	properties: {
		imported: { type: "number", description: "成功写入（新增或覆盖）的绑定条数。" },
		skipped: { type: "array", items: { type: "string" }, description: "被跳过行的行号/原因摘要，供人工核对。" },
		total: { type: "number", description: "解析到的数据行总数（不含表头）。" },
	},
};

export default { post };
