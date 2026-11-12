import { failWith } from "#/_platform/_shared/respond";
import { BINDING_COLS, bindingExportRows } from "#/_platform/_shared/service/domain/bot";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
// GET /api/system/bot-binding/export —— CSV 导出（与 import 同列序，roundtrip 兼容）。
// json.stream 绕过信封，故不声明 .response（api-manual §14）。守卫/取数在开流前完成，
// 失败经 failWith 落成正常 json.fail 信封；一旦开流就不再走信封错误通道。

async function get(): Promise<void> {
	let rows: Array<{ provider: string, external_sub: string, user_id: string }> = [];
	try {
		await assertSuperAdmin();
		rows = await bindingExportRows();
	}
	catch (e) {
		failWith(e);
		return;
	}
	const s = json.stream({ contentType: "text/csv", fileName: "bot-binding.csv", disposition: "attachment" });
	s.write(`${BINDING_COLS.join(",")}\n`);
	for (const r of rows)
		s.write(`${r.provider},${r.external_sub},${r.user_id}\n`);
	s.end();
}

// 仅声明工具说明：json.stream 绕过信封，不能声明 .response（api-manual §14）。
get.schema = {
	description: "以 CSV 附件导出本租户全部员工绑定（provider,external_sub,user_id），列序与 /system/bot-binding/import 完全一致，可直接 roundtrip 回导。仅 superadmin 可调用。审计/备份导出属敏感操作，请妥善保管产物。",
};

export default { get };
