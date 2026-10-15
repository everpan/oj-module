import type { OjSchemaDiag } from "./emit-oj-schema";
import type { IrEndpoint } from "./ir";
import type { OpenApiDoc } from "./openapi-ir";
import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { stringify as stringifyYaml } from "yaml";
import { emitClient } from "./emit-client";
import { applyStubWrites, planStubWrites } from "./emit-stub";
import { implementedRouteKeys } from "./handler-scan";
import { irFromOpenapi } from "./openapi-ir";

/**
 * AC-D7：`ojm api` 编排——发现 openapi.json → IR → 逐模块发射 __client → 写盘；
 * 并为未实现的 handler 生成 stub（人碰过的文件永不写）。
 *
 * 单一事实源即 `openapi.json`（oj v0.1.73 `oj openapi` 产物，OpenAPI 3.1）：
 * 项目级单文件，含全部模块。翻译层退役后不再消费旧 `contract.ts`。
 *
 * 幂等：内容无变化不写盘（读旧比对），RunResult 报告 written/skipped。
 */

export interface RunResult {
	contracts: number
	written: string[]
	skipped: string[]
	stubs: { created: number, updated: number, skipped: number }
}

/** 发现 openapi.json（oj v0.1.73 `oj openapi` 产物）。候选位置：显式传入 > `<cwd>/openapi.json` > `<cwd>/api/openapi.json` */
const OPENAPI_CANDIDATES = ["openapi.json", "api/openapi.json"];

function findOpenapiJson(cwd: string, explicit?: string): string | undefined {
	if (explicit)
		return join(cwd, explicit);
	for (const rel of OPENAPI_CANDIDATES) {
		const p = join(cwd, rel);
		if (existsSync(p))
			return p;
	}
	return undefined;
}

/** 内容无变化不写盘；返回是否写入 */
function writeIfChanged(path: string, content: string, result: RunResult): void {
	if (existsSync(path) && readFileSync(path, "utf8") === content) {
		result.skipped.push(path);
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	result.written.push(path);
}

/** IR 按模块（apiPrefix 去首斜杠）分组，供逐模块 emitClient 落 __client */
function groupIrByModule(ir: IrEndpoint[]): Map<string, IrEndpoint[]> {
	const byModule = new Map<string, IrEndpoint[]>();
	for (const ep of ir) {
		const module = ep.apiPrefix.replace(/^\//, "");
		const list = byModule.get(module);
		if (list)
			list.push(ep);
		else
			byModule.set(module, [ep]);
	}
	return byModule;
}

/** 暴露给 check.ts 复用（同源 openapi.json 发现逻辑，DRY） */
export { findOpenapiJson, groupIrByModule };

/**
 * openapi.json → irFromOpenapi → 逐模块 emitClient → 写 `web/src/<模块>/__client/`；
 * 并为未实现的 handler 生成 stub（oj 目录镜像树，指纹幂等）。
 * raw 信号 openapi.json 不携带，由 opts.rawPaths（handler-scan 补充）标记；未提供则按非 raw。
 */
async function runFromOpenapi(openapiPath: string, cwd: string, result: RunResult, rawPaths?: Set<string>): Promise<void> {
	const doc = JSON.parse(readFileSync(openapiPath, "utf8")) as OpenApiDoc;
	const ir = irFromOpenapi(doc, { rawPaths });
	const byModule = groupIrByModule(ir);
	result.contracts += byModule.size;
	for (const [module, eps] of byModule) {
		const client = emitClient(eps, { target: "module", module });
		const clientDir = join(cwd, "web/src", module, "__client");
		writeIfChanged(join(clientDir, "api.ts"), client["api.ts"], result);
		writeIfChanged(join(clientDir, "api.schemas.ts"), client["api.schemas.ts"], result);
	}
	// stub：oj 目录镜像树（人碰过的文件永不写——plan 阶段已按指纹判好）。
	// 已实现键全量扫一遍传入：嵌套组（模块根单文件）实现的端点不再生成镜像 stub。
	const apiSrcDir = join(cwd, "api/src");
	if (existsSync(apiSrcDir)) {
		const diag: OjSchemaDiag = { warnings: [] };
		const writes = await planStubWrites(ir, { apiSrcDir, diag, implemented: implementedRouteKeys(apiSrcDir) });
		const counts = applyStubWrites(writes);
		result.stubs.created += counts.created;
		result.stubs.updated += counts.updated;
		result.stubs.skipped += counts.skipped;
		for (const w of diag.warnings)
			console.warn(`[ojm-api] ⚠️ ${w}`);
	}
}

/** ojm api 主入口：消费 openapi.json（oj v0.1.73 `oj openapi` 产物）生成 __client + stub */
export async function runApi(opts: { cwd: string, openapi?: string, rawPaths?: Set<string> }): Promise<RunResult> {
	const result: RunResult = { contracts: 0, written: [], skipped: [], stubs: { created: 0, updated: 0, skipped: 0 } };
	const openapiPath = findOpenapiJson(opts.cwd, opts.openapi);
	if (!openapiPath) {
		throw new Error(`[ojm-api] ${opts.cwd} 下未发现 openapi.json——请先运行 oj v0.1.73 的 \`oj openapi -c config -d api/src -b /api -o openapi.json\` 生成（OpenAPI 3.1，含全部模块）。\`ojm api\` 的单一事实源即 openapi.json，不再消费旧 contract.ts。`);
	}
	await runFromOpenapi(openapiPath, opts.cwd, result, opts.rawPaths);
	return result;
}

/**
 * R5：`ojm api --docs`——聚合 openapi.json 的 paths → redoc 渲染静态站。
 * uni-dev 形态（存在 api/src）落 `api/docs/index.html`，纯前端落 `docs/api/index.html`。
 * redoc CLI 缺失时人话报错。
 */
export async function runApiDocs(cwd: string, opts: { redocBin?: string, fetchJs?: (url: string) => Promise<string> } = {}): Promise<string> {
	const openapiPath = findOpenapiJson(cwd);
	if (!openapiPath) {
		throw new Error(`[ojm-api] ${cwd} 下未发现 openapi.json——请先运行 \`oj openapi\` 生成（\`ojm api --docs\` 聚合其 paths 渲染文档）。`);
	}
	const doc = JSON.parse(readFileSync(openapiPath, "utf8")) as { paths?: Record<string, Record<string, unknown>> };
	const paths = doc.paths ?? {};
	const isUniDev = existsSync(join(cwd, "api/src"));

	const outDir = isUniDev ? join(cwd, "api/docs") : join(cwd, "docs/api");
	mkdirSync(outDir, { recursive: true });
	const specPath = join(outDir, "openapi.yaml");
	writeFileSync(specPath, stringifyYaml({ openapi: "3.1.0", info: { title: "API 文档", version: "0.0.0" }, paths }));

	const bin = opts.redocBin ?? defaultRedocBin();
	const outPath = join(outDir, "index.html");
	try {
		await promisify(execFileCb)(process.execPath, [bin, "build-docs", specPath, "-o", outPath], { cwd, maxBuffer: 16 * 1024 * 1024 });
	}
	catch (error) {
		const stderr = (error as { stderr?: string }).stderr?.trim();
		throw new Error(`[ojm-api] redoc 渲染失败${stderr ? `：${stderr.split("\n").pop()}` : ""}——请确认 @redocly/cli 已安装（pnpm install）；若刚装依赖，重试即可。`);
	}
	// 202609032041：redocly 产物外链 CDN redoc bundle（离线/内网白页）——内联成单文件自包含页
	try {
		writeFileSync(outPath, await inlineRedocScript(readFileSync(outPath, "utf8"), opts.fetchJs ?? fetchRedocBundle));
	}
	catch (error) {
		throw new Error(`[ojm-api] 内联 redoc bundle 失败（${error instanceof Error ? error.message : String(error)}）——构建机需能访问 cdn.redocly.com；离线环境请先在有网机器生成。`);
	}
	return outPath;
}

/**
 * redocly 产物的 CDN `<script src>` 替换为内联 bundle（版本随 redocly 模板 URL 走，不硬编码）。
 * 无 CDN 标签原样返回（幂等）。bundle 中 `</script` 转义防页面提前闭合。
 */
export async function inlineRedocScript(html: string, load: (url: string) => Promise<string>): Promise<string> {
	const m = html.match(/<script src="(https:\/\/cdn\.redocly\.com\/[^"]*redoc\.standalone\.js)"[^>]*><\/script>/);
	if (!m)
		return html;
	const js = (await load(m[1])).replaceAll("</script", "<\\/script");
	// 替换函数而非字符串：bundle 含 $&/$1 等 $ 模式，字符串替换会把匹配段重复插回
	return html.replace(m[0], () => `<script>${js}</script>`);
}

/** 默认 bundle loader：全局 fetch（构建期一次性网络请求，产物离线可看） */
async function fetchRedocBundle(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	return res.text();
}

/** redocly CLI 的 js bin 路径（走 Node 模块解析，随 cli 依赖安装） */
function defaultRedocBin(): string {
	const require = createRequire(import.meta.url);
	let pkgPath: string;
	try {
		pkgPath = require.resolve("@redocly/cli/package.json");
	}
	catch {
		throw new Error("[ojm-api] 找不到 @redocly/cli——请先 pnpm install 安装依赖（ojm api --docs 的文档渲染器）。");
	}
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin?: string | Record<string, string> };
	const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.redocly;
	if (!binRel)
		throw new Error("[ojm-api] @redocly/cli 的 package.json 没有 bin 入口——依赖损坏，请重装。");
	return join(dirname(pkgPath), binRel);
}
