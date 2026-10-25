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
import { trialCommand } from "./trial";
import { verifyMarket } from "./verify";
import { walkthroughCommand } from "./walkthrough";
import { markYanked } from "./yank-ledger";

interface Flags {
	id?: string
	key?: string
	fixture?: string
	real?: string
	url?: string
	user?: string
	pass?: string
	newPass?: string
	registryId?: string
	rebuildIndex?: boolean
	check?: boolean
	/** yank：操作人（审计留痕；缺省 "local-cli"） */
	by?: string
	/** yank：下线原因（审计留痕；可选） */
	reason?: string
}

const VALUE_FLAGS = new Set(["--id", "--key", "--fixture", "--real", "--url", "--user", "--pass", "--new-pass", "--registry-id", "--by", "--reason"]);

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
			else if (arg === "--registry-id")
				flags.registryId = value;
			else if (arg === "--by")
				flags.by = value;
			else if (arg === "--reason")
				flags.reason = value;
		}
	}
	return flags;
}

export async function marketCommand(sub: string, argv: string[]): Promise<void> {
	const flags = parseFlags(argv);
	switch (sub) {
		case "yank": {
			// 位置参数：<name>@<version>（非 -- 开头的首个 token）
			const target = argv.find(a => !a.startsWith("--"));
			if (target === undefined || !target.includes("@"))
				throw new Error("[ojm] 用法：ojm market yank <name>@<version> [--by <操作人>] [--reason <原因>]");
			const at = target.indexOf("@");
			const name = target.slice(0, at);
			const version = target.slice(at + 1);
			const by = flags.by ?? "local-cli";
			const r = markYanked(process.cwd(), name, version, { by, reason: flags.reason });
			if (r.created)
				console.log(`[ojm] 已下线 ${name}@${version}（操作人 ${by}${flags.reason !== undefined ? `，原因：${flags.reason}` : ""}）——重建索引以生效`);
			else
				console.log(`[ojm] ${name}@${version} 此前已下线，幂等跳过`);
			// 重建索引让 yanked 标记进 bundles.yaml（REG-CS4：latest 跳过 + 安装侧精确版本拒装）
			await buildIndex({ id: flags.id, key: flags.key, check: flags.check });
			return;
		}
		case "publish": {
			await publishPackage({
				fixture: flags.fixture,
				real: flags.real,
				id: flags.id,
				key: flags.key,
				check: flags.check,
				registryId: flags.registryId,
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
		case "trial": {
			await trialCommand(argv);
			return;
		}
		case "walkthrough": {
			await walkthroughCommand(argv);
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
			throw new Error(`[ojm] 未知子命令：ojm market ${sub}\n可用：setup / publish / yank / build-index`);
	}
}
