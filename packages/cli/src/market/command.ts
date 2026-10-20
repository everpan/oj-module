/**
 * `ojm market <sub>` 参数面（T3–T5 的命令入口）。
 *
 * 只做参数解析 + 调库函数：所有真逻辑都在同目录的 publish / build-index / setup 里，
 * 这里不掺业务，便于测试直接打函数而不走 argv。
 */

import process from "node:process";

import { buildIndex } from "./build-index";
import { publishPackage } from "./publish";
import { setupMarketUrl } from "./setup";
import { verifyMarket } from "./verify";

interface Flags {
	id?: string
	key?: string
	fixture?: string
	real?: string
	url?: string
	user?: string
	pass?: string
	newPass?: string
	rebuildIndex?: boolean
	check?: boolean
}

const VALUE_FLAGS = new Set(["--id", "--key", "--fixture", "--real", "--url", "--user", "--pass", "--new-pass"]);

function parseFlags(argv: string[]): Flags {
	const flags: Flags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--rebuild-index") {
			flags.rebuildIndex = true;
			continue;
		}
		if (arg === "--check") {
			flags.check = true;
			continue;
		}
		if (VALUE_FLAGS.has(arg)) {
			const value = argv[i + 1] ?? "";
			i++;
			if (arg === "--id")
				flags.id = value;
			else if (arg === "--key")
				flags.key = value;
			else if (arg === "--fixture")
				flags.fixture = value;
			else if (arg === "--real")
				flags.real = value;
			else if (arg === "--url")
				flags.url = value;
			else if (arg === "--user")
				flags.user = value;
			else if (arg === "--pass")
				flags.pass = value;
			else if (arg === "--new-pass")
				flags.newPass = value;
		}
	}
	return flags;
}

export async function marketCommand(sub: string, argv: string[]): Promise<void> {
	const flags = parseFlags(argv);
	switch (sub) {
		case "publish": {
			await publishPackage({
				fixture: flags.fixture,
				real: flags.real,
				id: flags.id,
				key: flags.key,
				check: flags.check,
			});
			if (flags.rebuildIndex === true)
				await buildIndex({ id: flags.id, key: flags.key, check: flags.check });
			return;
		}
		case "verify": {
			const result = verifyMarket({ file: flags.fixture === undefined ? undefined : flags.fixture, rebuildCheck: flags.rebuildIndex });
			for (const check of result.checks)
				console.log(`${check.ok ? "✓" : "✗"} ${check.item}：${check.detail}`);
			if (result.drift !== undefined && result.drift.length > 0) {
				for (const line of result.drift)
					console.log(`✗ 索引漂移：${line}`);
			}
			console.log(result.conclusion);
			if (!result.passed)
				process.exitCode = 1;
			return;
		}
		case "build-index": {
			await buildIndex({ id: flags.id, key: flags.key, check: flags.check });
			return;
		}
		case "setup": {
			const result = await setupMarketUrl({ url: flags.url, user: flags.user, pass: flags.pass, newPass: flags.newPass });
			console.log(`[ojm] 站点 ${result.siteUrl} 的市场地址已指向 ${result.cdnBaseUrl}`);
			return;
		}
		default:
			throw new Error(`[ojm] 未知子命令：ojm market ${sub}\n可用：setup / publish / build-index`);
	}
}

/** `ojm market` 无子命令时的提示（与 usage.ts 同源风格） */
export function marketUsage(): string {
	return [
		"ojm market setup   [--url <站点地址>] [--user <u> --pass <p>] [--new-pass <p>]   把市场地址指向本地 cdn/",
		"ojm market publish [--fixture <name>@<version>] [--real <方案工程>] [--id <key>] [--rebuild-index]",
		"ojm market build-index           [--id <key>] [--check]                        扫描 cdn/ 重建索引",
		"ojm market verify [--file <tgz>] [--rebuild-index]                             离线验包（不起站点、不装）",
	].join("\n");
}

/** 进程入口：从 argv 取子命令（index.ts 负责 dispatch 到此处） */
export async function runMarket(argv: string[]): Promise<void> {
	const sub = argv[0] ?? "";
	if (sub === "" || sub === "--help" || sub === "-h") {
		console.log(marketUsage());
		return;
	}
	await marketCommand(sub, argv.slice(1));
	void process;
}
