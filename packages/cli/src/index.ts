import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseApiArgs, parseInitArgs, parseVendorArgs } from "./args";
import { buildBackend, buildModules } from "./build";
import { devServer } from "./dev";
import { mergeManifests, printInfo } from "./info";
import { initProject } from "./init";
import { previewServer } from "./preview";
import { usageText } from "./usage";
import { vendorCommand } from "./vendor";

const [command] = process.argv.slice(2);

function usage(): never {
	console.log(usageText());
	process.exit(command ? 1 : 0);
}

async function main() {
	const projectRoot = process.cwd();

	switch (command) {
		case "build":
			// 设计 §5：后端 oj build（零 DB 副作用）→ 前端全站合并（仅 build 清场合并）
			await buildBackend(projectRoot);
			await buildModules(projectRoot, { mergeSite: true });
			break;
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
				throw new Error(`[ram-api] 项目目录不存在：${dir}`);
			const apiRoot = dir ? path.resolve(dir) : projectRoot;
			if (docs) {
				const { runApiDocs } = await import("./contract/run");
				const out = await runApiDocs(apiRoot);
				console.log(`[ram-api] 文档站已生成：${path.relative(projectRoot, out)}（浏览器直接打开即可）`);
				break;
			}
			if (check) {
				const { checkApi } = await import("./contract/check");
				// --exempt <path>：相对路径按项目根解析；缺省回退 api/.ram-api-exempt.json
				const { violations, hints } = await checkApi({ cwd: apiRoot, exempt: exempt ? path.resolve(projectRoot, exempt) : undefined });
				for (const v of violations)
					console[v.level === "error" ? "error" : "warn"](`${v.level === "error" ? "✗" : "⚠"} ${v.message}`);
				for (const h of hints)
					console.log(h);
				if (violations.length === 0)
					console.log("[ram-api] --check 通过：生成物同步、route 双向对账、routes.js 均无 drift。");
				const errors = violations.filter(v => v.level === "error").length;
				console.log(`[ram-api] --check 结果：${errors} error / ${violations.length - errors} warn`);
				if (errors > 0)
					process.exit(1);
				break;
			}
			const { runApi } = await import("./contract/run");
			const result = await runApi({ cwd: apiRoot });
			console.log(`[ram-api] 契约 ${result.contracts} 份；写入 ${result.written.length} 个文件，跳过（未变）${result.skipped.length} 个；stub 新建 ${result.stubs.created} / 更新 ${result.stubs.updated} / 跳过 ${result.stubs.skipped}`);
			for (const p of result.written)
				console.log(`  + ${path.relative(apiRoot, p)}`);
			break;
		}
		case "merge":
			await mergeManifests(process.argv[3] ?? "", process.argv.slice(4));
			break;
		default:
			usage();
	}
}

main().catch((error: unknown) => {
	// Error 的 message 已是人话（含修复指引）；堆栈默认是噪音，RAM_DEBUG=1 才输出
	console.error(`[ram] ${error instanceof Error ? (process.env.RAM_DEBUG ? error.stack : error.message) : String(error)}`);
	process.exit(1);
});
