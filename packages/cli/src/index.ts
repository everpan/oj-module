import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseApiArgs, parseBuildArgs, parseInitArgs, parseLifecycleArgs, parseVendorArgs } from "./args";
import { buildBackend, buildModules } from "./build";
import { buildBundle } from "./bundle";
import { devServer } from "./dev";
import { mergeManifests, printInfo } from "./info";
import { initProject } from "./init";
import { previewServer } from "./preview";
import { usageText } from "./usage";
import { vendorCommand } from "./vendor";
import { readCliVersion } from "./versions";

/** ojm → oj 透传子命令（其余参数原样转发，见 src/oj-cmd.ts） */
const OJ_PASSTHROUGH = new Set(["test", "exec", "openapi", "migrate", "schema"]);

const [command] = process.argv.slice(2);

function usage(): never {
	console.log(usageText());
	process.exit(command ? 1 : 0);
}

async function main() {
	const projectRoot = process.cwd();

	// 顶层 --version / -V：打印 cli 包版本（与 `ojm info` 的 cli 版本同源）
	if (command === "--version" || command === "-V") {
		console.log(readCliVersion());
		return;
	}

	switch (command) {
		case "build": {
			const { bundle, out } = parseBuildArgs(process.argv.slice(3));
			if (bundle) {
				// 方案包构建（P1-11）：契约校验 fail-fast → 确定性 tgz + sha256（消费方：市场安装器）
				await buildBundle(projectRoot, { out });
				break;
			}
			// 设计 §5：后端 oj build（零 DB 副作用）→ 前端全站合并（仅 build 清场合并）
			await buildBackend(projectRoot);
			await buildModules(projectRoot, { mergeSite: true });
			break;
		}
		case "init": {
			const { dest, yes } = parseInitArgs(process.argv.slice(3));
			await initProject(dest ? path.resolve(dest) : projectRoot, { yes });
			break;
		}
		case "preview": {
			const previewPortArg = Number(process.argv[3]);
			const previewPort = Number.isFinite(previewPortArg) && previewPortArg > 0 ? previewPortArg : undefined;
			await previewServer(projectRoot, { port: previewPort, ojStatic: process.argv.includes("--oj-static") });
			break;
		}
		case "dev": {
			const portArg = Number(process.argv[3]);
			const port = Number.isFinite(portArg) && portArg > 0 ? portArg : 5174;
			await devServer(projectRoot, { port });
			break;
		}
		case "info":
			await printInfo(projectRoot);
			break;
		case "vendor": {
			const { force, tag } = parseVendorArgs(process.argv.slice(3));
			await vendorCommand(projectRoot, { force, tag });
			break;
		}
		case "api": {
			const { dir, check, docs, exempt } = parseApiArgs(process.argv.slice(3));
			// S5：显式目录必须先存在——否则静默在错的目录下生成/对账
			if (dir && !fs.existsSync(path.resolve(dir)))
				throw new Error(`[ojm-api] 项目目录不存在：${dir}`);
			const apiRoot = dir ? path.resolve(dir) : projectRoot;
			if (docs) {
				const { runApiDocs } = await import("./contract/run");
				const out = await runApiDocs(apiRoot);
				console.log(`[ojm-api] 文档站已生成：${path.relative(projectRoot, out)}（浏览器直接打开即可）`);
				break;
			}
			if (check) {
				const { checkApi } = await import("./contract/check");
				// --exempt <path>：相对路径按项目根解析；缺省回退 api/.ojm-api-exempt.json
				// （旧名 api/.ram-api-exempt.json 仍被读取，R4）
				const { violations, hints } = await checkApi({ cwd: apiRoot, exempt: exempt ? path.resolve(projectRoot, exempt) : undefined });
				for (const v of violations)
					console[v.level === "error" ? "error" : "warn"](`${v.level === "error" ? "✗" : "⚠"} ${v.message}`);
				for (const h of hints)
					console.log(h);
				if (violations.length === 0)
					console.log("[ojm-api] --check 通过：生成物同步、route 双向对账、routes.js 均无 drift。");
				const errors = violations.filter(v => v.level === "error").length;
				console.log(`[ojm-api] --check 结果：${errors} error / ${violations.length - errors} warn`);
				if (errors > 0)
					process.exit(1);
				break;
			}
			const { runApi } = await import("./contract/run");
			const result = await runApi({ cwd: apiRoot });
			console.log(`[ojm-api] 契约 ${result.contracts} 份；写入 ${result.written.length} 个文件，跳过（未变）${result.skipped.length} 个；stub 新建 ${result.stubs.created} / 更新 ${result.stubs.updated} / 跳过 ${result.stubs.skipped}`);
			for (const p of result.written)
				console.log(`  + ${path.relative(apiRoot, p)}`);
			break;
		}
		case "merge":
			await mergeManifests(process.argv[3] ?? "", process.argv.slice(4));
			break;
		case "keygen": {
			// 签名密钥对生成（P2-4，作者工具链）：缺省 ~/.ojm/keys/<id>，工程树内落盘需 --yes
			const { parseKeygenArgs } = await import("./keygen");
			const { keygenCommand } = await import("./keygen");
			const { id, out, yes } = parseKeygenArgs(process.argv.slice(3));
			keygenCommand({ id, out, yes });
			break;
		}
		case "sign": {
			// detached 侧车签名（P2-4，G4 载体）：ojm sign <tgz> [--id <publisher.id>] [--key <pem>] [--check]
			const { parseSignArgs } = await import("./sign");
			const { signCommand } = await import("./sign");
			const { positionals, id, key, check } = parseSignArgs(process.argv.slice(3));
			signCommand(positionals[0] ?? "", { id, key, check });
			break;
		}
		case "install": {
			// 方案包安装瘦客户端（P1-13，D6）：file 上传 / CDN 市场源 → 轮询任务至终态
			const { positionals, url, user, pass, locale, name, version } = parseLifecycleArgs(process.argv.slice(3));
			const { installCommand } = await import("./install");
			await installCommand(positionals[0] ?? "", { url, user, pass, locale, name, version });
			break;
		}
		case "enable":
		case "disable": {
			// 生命周期开关瘦客户端（P1-13，D8）：站点侧 setEnabled 四处同写
			const { positionals, url, user, pass } = parseLifecycleArgs(process.argv.slice(3));
			const { setEnabledCommand } = await import("./enable");
			await setEnabledCommand(positionals[0] ?? "", command === "enable", { url, user, pass });
			break;
		}
		case "uninstall": {
			// 卸载瘦客户端（P1-15a，缺口 B）：站点侧 runUninstall 四处同删 + 权限级联
			const { positionals, url, user, pass } = parseLifecycleArgs(process.argv.slice(3));
			const { uninstallCommand } = await import("./uninstall");
			await uninstallCommand(positionals[0] ?? "", { url, user, pass });
			break;
		}
		case "trust": {
			// 信任库运维瘦客户端（P2-2，C2-38/39）：ls / add <key_id> <pubkey_hex> / revoke <key_id> / confirm --task
			const { positionals, url, user, pass, task } = parseLifecycleArgs(process.argv.slice(3));
			const { trustCommand } = await import("./trust");
			await trustCommand(positionals[0] ?? "", positionals.slice(1), { url, user, pass, task });
			break;
		}
		case "publish": {
			// 索引发布（P3-5/6/7，作者工具链）：重算 bundles/manifests 索引 + detached .sig 签名写回
			const { parsePublishArgs } = await import("./publish");
			const { publishCommand } = await import("./publish");
			const { positionals, id, key, check } = parsePublishArgs(process.argv.slice(3));
			publishCommand(positionals[0] ?? "", { id, key, check });
			break;
		}
		default: {
			if (command && OJ_PASSTHROUGH.has(command)) {
				const { runOjSubcommand } = await import("./oj-cmd");
				runOjSubcommand(projectRoot, command, process.argv.slice(3));
				break;
			}
			usage();
		}
	}
}

main().catch((error: unknown) => {
	// Error 的 message 已是人话（含修复指引）；堆栈默认是噪音，OJM_DEBUG=1 才输出
	// （旧名 RAM_DEBUG 一并读，兼容既有排障习惯）
	console.error(`[ojm] ${error instanceof Error ? ((process.env.OJM_DEBUG ?? process.env.RAM_DEBUG) ? error.stack : error.message) : String(error)}`);
	process.exit(1);
});
