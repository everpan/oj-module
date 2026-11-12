import type { AuditRow } from "#/_platform/_shared/service/domain/bot";
import { failWith } from "#/_platform/_shared/respond";
import { auditExportRows } from "#/_platform/_shared/service/domain/bot";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
// GET /api/system/obo-audit/export —— 换签审计 CSV 导出（全量，按 id 倒序）。
// json.stream 绕过信封，故不声明 .response（api-manual §14）。守卫/取数在开流前完成。

async function get(): Promise<void> {
	let rows: AuditRow[] = [];
	try {
		await assertSuperAdmin();
		rows = await auditExportRows();
	}
	catch (e) {
		failWith(e);
		return;
	}
	const s = json.stream({ contentType: "text/csv", fileName: "obo-audit.csv", disposition: "attachment" });
	s.write("id,svc,provider,external_sub,user_id,ok,reason,ts\n");
	for (const r of rows)
		s.write(`${r.id},${r.svc},${r.provider},${r.external_sub},${r.user_id},${r.ok},"${r.reason.replace(/"/g, "\"\"")}",${r.ts}\n`);
	s.end();
}

// 仅声明工具说明：json.stream 绕过信封，不能声明 .response（api-manual §14）。
get.schema = {
	description: "以 CSV 附件全量导出机器人换签审计日志（id,svc,provider,external_sub,user_id,ok,reason,ts，按 id 倒序，不分页）。仅 superadmin 可调用。审计数据含员工标识，属安全敏感物料，请勿外传。",
};

export default { get };
