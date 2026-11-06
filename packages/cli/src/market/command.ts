/**
 * `ojm market <sub>` 参数面（A6：远端发布形态）的命令入口。
 *
 * 只做参数解析 + 调库函数：所有真逻辑都在同目录的 remote-push / publish / setup 里，
 * 这里不掺业务，便于测试直接打函数而不走 argv。
 *
 * 发布缺省 = 远端签名推送（--site-url / OJM_SITE_URL）；yank = 远端签名下线（同名发现面）。
 * 索引面（build-index）随 DB 目录化退役——目录真源 = 站点 market_release 表。
 */

import process from "node:process";

import { remotePublish, remoteYank } from "./remote-push";
import { setupMarketUrl } from "./setup";
import { trialCommand } from "./trial";
import { verifyMarket } from "./verify";
import { walkthroughCommand } from "./walkthrough";

interface Flags {
	id?: string
	key?: string
	fixture?: string
	real?: string
	siteUrl?: string
	user?: string
	pass?: string
	newPass?: string
	registryId?: string
	check?: boolean
	/** yank：恢复（unyank）；缺省 = 下线 */
	restore?: boolean
	/** yank：操作人（审计留痕；缺省由站点记 key_id） */
	by?: string
	/** yank：下线原因（审计留痕；可选） */
	reason?: string
}

const VALUE_FLAGS = new Set(["--id", "--key", "--fixture", "--real", "--site-url", "--user", "--pass", "--new-pass", "--registry-id", "--by", "--reason"]);

function parseFlags(argv: string[]): Flags {
	const flags: Flags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--restore") {
			flags.restore = true;
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
			else if (arg === "--site-url")
				flags.siteUrl = value;
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
				throw new Error("[ojm] 用法：ojm market yank <name>@<version> --site-url <url> --id <签名身份> [--key <pem>] [--reason <原因>] [--by <操作人>] [--restore]");
			const at = target.indexOf("@");
			const name = target.slice(0, at);
			const version = target.slice(at + 1);
			// 签名下线：DB 目录行级（清单即摘除、详情保留 yanked 标记）；不动已装方案。
			// --id 语义 = 签名身份（须为该行发布者，服务端 403 仲裁）——索引重建约束随索引退役消失
			const r = await remoteYank({
				siteUrl: flags.siteUrl,
				name,
				version,
				restore: flags.restore === true,
				reason: flags.reason,
				by: flags.by,
				id: flags.id,
				key: flags.key,
			});
			console.log(flags.restore === true
				? (r.idempotent ? `[ojm] ${name}@${version} 此前已恢复，幂等跳过` : `[ojm] 已恢复 ${name}@${version}（重新在架）`)
				: (r.idempotent ? `[ojm] ${name}@${version} 此前已下线，幂等跳过` : `[ojm] 已下线 ${name}@${version}——清单已摘除，新装/升级被阻断（已装方案不受影响）`));
			return;
		}
		case "publish": {
			// 缺省远端签名推送（v4 §五：本地-only 落盘模式退役——DB 模式下本地落盘 = 市场不可见）；
			// 本地落盘仅内部通道保留（walkthrough/trial 隔离站点双写用 publishPackage）
			await remotePublish({
				siteUrl: flags.siteUrl,
				fixture: flags.fixture,
				real: flags.real,
				id: flags.id,
				key: flags.key,
				check: flags.check,
				registryId: flags.registryId,
			});
			return;
		}
		case "verify": {
			const result = verifyMarket({ file: flags.fixture === undefined ? undefined : flags.fixture });
			for (const check of result.checks)
				console.log(`${check.ok ? "✓" : "✗"} ${check.item}：${check.detail}`);
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
		case "setup": {
			const result = await setupMarketUrl({ siteUrl: flags.siteUrl, user: flags.user, pass: flags.pass, newPass: flags.newPass });
			console.log(`[ojm] 站点 ${result.siteUrl} 的市场地址已指向 ${result.cdnBaseUrl}`);
			return;
		}
		default:
			throw new Error(`[ojm] 未知子命令：ojm market ${sub}\n可用：setup / publish / yank / verify / trial / walkthrough`);
	}
}
