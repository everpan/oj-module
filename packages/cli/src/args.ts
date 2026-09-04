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
 * `ram api [dir] [--check] [--docs] [--exempt <path>]`：位置参数为项目目录
 * （缺省 cwd），与 parseInitArgs 同一约定（docs/prd/202609032019-ram-api-cwd.md）。
 * 注意：`--exempt` 的「值」不得以 `--` 开头，否则会被误判为 dir——故逐项扫描，
 * 消费掉 `--exempt` 紧随的值，避免被 dir 解析吞噬（P6 同款坑）。
 */
export function parseApiArgs(argv: string[]): { dir: string, check: boolean, docs: boolean, exempt?: string } {
	const flags = new Set<string>();
	const positionals: string[] = [];
	let exempt: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--exempt") {
			exempt = argv[i + 1];
			i++; // 跳过紧随的值，不被当 dir
			continue;
		}
		if (a.startsWith("--")) {
			flags.add(a);
			continue;
		}
		positionals.push(a);
	}
	const dir = positionals[0] ?? "";
	return { dir, check: flags.has("--check"), docs: flags.has("--docs"), exempt };
}

/**
 * `ram vendor [--force]`：检查并按需更新 oj vendor
 * （docs/prd/202609040905-vendor-download-design.md V1/V2）。
 */
export function parseVendorArgs(argv: string[]): { force: boolean } {
	return { force: argv.includes("--force") };
}
