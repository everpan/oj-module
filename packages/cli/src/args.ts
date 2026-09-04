/**
 * 子命令参数解析（纯函数，可测）。
 *
 * 约定：位置参数取第一个不以 `--` 开头的参数；`--xxx` 一律是开关/选项。
 * 缺陷背景：`ram init --yes` 曾把 argv[3]（即 `--yes`）当目标目录。
 */

export function parseInitArgs(argv: string[]): { dest: string, yes: boolean } {
	const yes = argv.includes("--yes");
	const dest = argv.find(a => !a.startsWith("--")) ?? "";
	return { dest, yes };
}

/**
 * `ram api [dir] [--check] [--docs]`：位置参数为项目目录（缺省 cwd），
 * 与 parseInitArgs 同一约定（docs/prd/202609032019-ram-api-cwd.md）。
 */
export function parseApiArgs(argv: string[]): { dir: string, check: boolean, docs: boolean } {
	const check = argv.includes("--check");
	const docs = argv.includes("--docs");
	const dir = argv.find(a => !a.startsWith("--")) ?? "";
	return { dir, check, docs };
}

/**
 * `ram vendor [--force]`：检查并按需更新 oj vendor
 * （docs/prd/202609040905-vendor-download-design.md V1/V2）。
 */
export function parseVendorArgs(argv: string[]): { force: boolean } {
	return { force: argv.includes("--force") };
}
