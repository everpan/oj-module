/** CSV 单元格转义（RFC4180 简版）：含逗号/引号/换行时双引号包裹，引号翻倍。 */
function cell(v: string | number): string {
	const s = String(v ?? "");
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

/** 表头 + 行 → CSV 文本（CRLF 行尾，与后端 json.stream 导出一致）。 */
export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
	return `${[header, ...rows].map(r => Array.from(r, cell).join(",")).join("\r\n")}\r\n`;
}

/**
 * 浏览器本地生成并触发下载。
 *
 * 后端 /system/bot-binding/export、/system/obo-audit/export 是 json.stream 的 text/csv 裸流，
 * 而生成的 __client 按 {code,msg,data} 信封 .json() 解析（契约未标 raw），走它会解析失败。
 * 管理端因此用列表查询（已带认证/前缀）取数、前端拼 CSV；后端 stream 端点留给运维脚本 / curl。
 * 不写 UTF-8 BOM，保证导出文件能被同一导入端点直接回导（表头逐字匹配）。
 */
export function downloadCsv(fileName: string, csv: string): void {
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
