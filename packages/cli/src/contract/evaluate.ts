import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build as esbuild } from "esbuild";

/**
 * AC-D13：契约求值——复用 build.ts 的 `readModuleDefinition` 同款链路
 * （esbuild bundle → 工程内临时目录 → 真 import()），但 stub 策略不同：
 *
 * - `@oj-module/runtime/contract` 保持 external，Node 侧命中**真实现**
 *   （contract 子路径零浏览器依赖，其 zod 与浏览器侧 runtime re-export 同源钉版，
 *   版本一致性由 pnpm catalog + 版本矩阵门禁保证）；
 * - `@oj-module/runtime` 若被契约误 import，替换为空壳 stub 并告警
 *   ——runtime 入口是浏览器代码（React/import.meta.env/localStorage），
 *   Node 下求值即崩；
 * - 其余共享依赖全部 external，由 Node 在 import() 时真实解析。
 */

/** runtime 误 import 的空壳 stub（任何具名导出都给占位函数，防 esbuild 报 missing export） */
const RUNTIME_GUARD_STUB = `
const warn = (name) => {
	console.warn("[ojm-api] 契约文件不应 import @oj-module/runtime（浏览器代码），已用空壳替代：" + name);
};
const _fn = (...a) => { warn("value"); return a[a.length - 1]; };
export const defineModule = _fn;
export const z = new Proxy({}, { get: () => { warn("z"); return _fn; } });
export default new Proxy({}, { get: () => _fn });
`;

export async function evaluateContract(
	contractFile: string,
	projectRoot: string,
): Promise<Record<string, unknown>> {
	if (!fs.existsSync(contractFile)) {
		throw new Error(`[ojm-api] 契约文件不存在：${contractFile}——请检查路径（默认发现：api/src/*/contract.ts 或 web/src/*/client/contract.ts）。`);
	}

	// 必须落在工程目录内（而非 os.tmpdir）：bundle 外部化的依赖在 import() 时
	// 需要从工程 node_modules 解析（同 build.ts readModuleDefinition 的理由）
	const outDir = fs.mkdtempSync(path.join(projectRoot, ".ojm-tmp-"));
	try {
		await esbuild({
			entryPoints: [contractFile],
			entryNames: "entry",
			bundle: true,
			format: "esm",
			platform: "node",
			packages: "external",
			plugins: [{
				name: "ojm-contract-runtime-guard",
				setup(build) {
					build.onResolve({ filter: /^@oj-module\/runtime$/ }, () => ({
						path: "ojm-runtime-guard-stub",
						namespace: "ojm-stub",
					}));
					build.onLoad({ filter: /.*/, namespace: "ojm-stub" }, () => ({
						contents: RUNTIME_GUARD_STUB,
						loader: "js",
					}));
				},
			}],
			outdir: outDir,
			loader: { ".ts": "ts", ".tsx": "tsx", ".json": "json" },
			logLevel: "silent",
		});
		const bundled = path.join(outDir, "entry.js");
		try {
			const mod = await import(pathToFileURL(bundled).href) as Record<string, unknown>;
			return mod;
		}
		catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			// 最常见的外部工程缺依赖：给出可操作修复，而不是裸 ERR_MODULE_NOT_FOUND
			if (msg.includes("@oj-module/runtime/contract")) {
				throw new Error(
					"[ojm-api] 契约求值需要工程 node_modules 里能解析 @oj-module/runtime/contract，但当前工程未安装它。\n"
					+ "修复：把 \"@oj-module/runtime\" 加进工程 devDependencies（版本与宿主对齐）后重跑 pnpm install；"
					+ "新工程由 ojm init 自动声明。",
				);
			}
			throw e;
		}
	}
	finally {
		fs.rmSync(outDir, { recursive: true, force: true });
	}
}
