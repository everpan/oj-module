/**
 * 子命令参数解析（纯函数，可测）。
 *
 * 约定：位置参数取第一个不以 `--` 开头的参数；`--xxx` 一律是开关/选项。
 * 缺陷背景：`ojm init --yes` 曾把 argv[3]（即 `--yes`）当目标目录。
 */

export function parseInitArgs(argv: string[]): { dest: string, yes: boolean } {
	const yes = argv.includes("--yes");
	const dest = argv.find(a => !a.startsWith("--")) ?? "";
	return { dest, yes };
}

/**
 * `ojm api [dir] [--check] [--docs] [--exempt <path>]`：位置参数为项目目录
 * （缺省 cwd），与 parseInitArgs 同一约定（docs/prd/202609032019-ojm-api-cwd.md）。
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
 * `ojm vendor [tag] [--force]`：下载/更新 oj vendor。
 * tag 缺省用钉定版本（vendor.ts RELEASE_TAG）；形如 `v0.1.11` 或 `0.1.11`
 * （自动补 v 前缀）。非法 tag 形状即报错（防误把目录当版本）。
 */
export function parseVendorArgs(argv: string[]): { force: boolean, tag?: string } {
	const tag = argv.find(a => !a.startsWith("--") && a !== "--");
	if (tag !== undefined && !/^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(tag)) {
		throw new Error(`[ojm] 非法版本号：${tag}（形如 v0.1.11 或 0.1.11）`);
	}
	return {
		force: argv.includes("--force"),
		tag: tag === undefined ? undefined : (tag.startsWith("v") ? tag : `v${tag}`),
	};
}
