import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { emitClient } from "./emit-client";
import { emitOpenapiYaml, emitRoutesJson } from "./emit-meta";
import { applyStubWrites, planStubWrites } from "./emit-stub";
import { evaluateContract } from "./evaluate";
import { buildIr } from "./ir";

/**
 * AC-D7：`ojm api` 编排——discover → evaluate → IR → 发射 → 幂等写盘。
 *
 * 发现两档（缺省并扫）：
 * - uni-dev：`api/src/<模块>/contract.ts` → client 双产物写到对应前端模块
 *   `web/src/<模块>/client/`（模块名 = apiPrefix 去首斜杠，AC-D9 字面相等，
 *   不符即人话报错）；routes.json/openapi.yaml 写契约旁；stub 写 oj 目录镜像树。
 * - 纯前端：`web/src/<模块>/client/contract.ts` → 四产物全部落契约同目录，无 stub。
 *
 * 幂等：内容无变化不写盘（读旧比对），RunResult 报告 written/skipped。
 */

export interface RunResult {
	contracts: number
	written: string[]
	skipped: string[]
	stubs: { created: number, updated: number, skipped: number }
}

export interface DiscoveredContract {
	/** contract.ts 绝对路径 */
	path: string
	/** 模块名（uni-dev = api/src 下一级目录名；纯前端 = web/src 下一级目录名） */
	module: string
	kind: "uni-dev" | "frontend"
}

/** 发现契约文件：api/src/<m>/contract.ts + web/src/<m>/client/contract.ts */
export function discoverContracts(cwd: string): DiscoveredContract[] {
	const found: DiscoveredContract[] = [];
	const apiSrc = join(cwd, "api/src");
	if (existsSync(apiSrc)) {
		for (const entry of readdirSync(apiSrc, { withFileTypes: true })) {
			if (!entry.isDirectory())
				continue;
			const p = join(apiSrc, entry.name, "contract.ts");
			if (existsSync(p))
				found.push({ path: p, module: entry.name, kind: "uni-dev" });
		}
	}
	const modulesSrc = join(cwd, "web/src");
	if (existsSync(modulesSrc)) {
		for (const entry of readdirSync(modulesSrc, { withFileTypes: true })) {
			if (!entry.isDirectory())
				continue;
			const p = join(modulesSrc, entry.name, "client", "contract.ts");
			if (existsSync(p))
				found.push({ path: p, module: entry.name, kind: "frontend" });
		}
	}
	return found.sort((a, b) => (a.path < b.path ? -1 : 1));
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

/** 单份契约的四产物落盘路径（run 与 --check 共用，DRY） */
export function artifactPaths(found: DiscoveredContract, cwd: string): { client: string, schemas: string, routes: string, openapi: string } {
	if (found.kind === "uni-dev") {
		const moduleClientDir = join(cwd, "web/src", found.module, "client");
		return {
			client: join(moduleClientDir, "api.ts"),
			schemas: join(moduleClientDir, "api.schemas.ts"),
			routes: join(dirname(found.path), "routes.json"),
			openapi: join(dirname(found.path), "openapi.yaml"),
		};
	}
	const dir = dirname(found.path);
	return {
		client: join(dir, "api.ts"),
		schemas: join(dir, "api.schemas.ts"),
		routes: join(dir, "routes.json"),
		openapi: join(dir, "openapi.yaml"),
	};
}

/** 契约 → IR（含 uni-dev 的 AC-D9 字面相等校验）；run 与 --check 共用 */
export async function irOf(found: DiscoveredContract, cwd: string) {
	const exports = await evaluateContract(found.path, cwd);
	const ir = buildIr(exports);
	if (ir.length === 0)
		throw new Error(`[ojm-api] ${found.path} 没有 defineApi 端点——契约文件至少导出一个端点，否则请删除该文件。`);
	if (found.kind === "uni-dev") {
		// AC-D9：uni-dev 形态 apiPrefix 字面等于 oj 模块段（= 目录名）
		for (const ep of ir) {
			if (ep.apiPrefix !== `/${found.module}`) {
				throw new Error(`[ojm-api] ${found.path} 端点 "${ep.name}" apiPrefix "${ep.apiPrefix}" 与目录名 "${found.module}" 不符——uni-dev 形态要求字面相等（AC-D9），请改 apiPrefix 或移动契约目录。`);
			}
		}
	}
	return ir;
}

async function runOne(found: DiscoveredContract, cwd: string, result: RunResult): Promise<void> {
	const ir = await irOf(found, cwd);

	const client = emitClient(ir, { target: "module" });
	const routesJson = emitRoutesJson(ir);
	const openapi = emitOpenapiYaml(ir, { title: `${found.module} api`, version: "0.0.0" });

	const paths = artifactPaths(found, cwd);
	writeIfChanged(paths.client, client["api.ts"], result);
	writeIfChanged(paths.schemas, client["api.schemas.ts"], result);
	writeIfChanged(paths.routes, routesJson, result);
	writeIfChanged(paths.openapi, openapi, result);
	if (found.kind === "uni-dev") {
		// stub：oj 目录镜像树（人碰过的文件永不写——plan 阶段已按指纹判好）
		const writes = await planStubWrites(ir, { apiSrcDir: join(cwd, "api/src") });
		const counts = applyStubWrites(writes);
		result.stubs.created += counts.created;
		result.stubs.updated += counts.updated;
		result.stubs.skipped += counts.skipped;
	}
}

/** ojm api 主入口：发现全部契约并逐一生成产物 */
export async function runApi(opts: { cwd: string }): Promise<RunResult> {
	const contracts = discoverContracts(opts.cwd);
	if (contracts.length === 0) {
		throw new Error(`[ojm-api] ${opts.cwd} 下没有发现契约文件——默认发现：api/src/*/contract.ts（uni-dev）与 web/src/*/client/contract.ts（纯前端）。存量工程请迁移：modules/ → web/、模块内 api/ → client/（生成物与契约同迁）。`);
	}
	const result: RunResult = { contracts: contracts.length, written: [], skipped: [], stubs: { created: 0, updated: 0, skipped: 0 } };
	for (const found of contracts)
		await runOne(found, opts.cwd, result);
	return result;
}

/**
 * R5：`ojm api --docs`——聚合全部契约的 OpenAPI → redoc 渲染静态站。
 * uni-dev 形态（存在 api/src 契约）落 `api/docs/index.html`，纯前端落 `docs/api/index.html`；
 * 聚合 spec 同目录落 `openapi.yaml`（评审可直读）。redoc CLI 缺失时人话报错。
 */
export async function runApiDocs(cwd: string, opts: { redocBin?: string, fetchJs?: (url: string) => Promise<string> } = {}): Promise<string> {
	const contracts = discoverContracts(cwd);
	if (contracts.length === 0) {
		throw new Error(`[ojm-api] ${cwd} 下没有发现契约文件——默认发现：api/src/*/contract.ts（uni-dev）与 web/src/*/client/contract.ts（纯前端）。`);
	}

	// 聚合：逐契约 IR → openapi doc → paths 合并（operation 打模块 tag）
	const paths: Record<string, Record<string, unknown>> = {};
	for (const found of contracts) {
		const ir = await irOf(found, cwd);
		const doc = parseYaml(emitOpenapiYaml(ir, { title: `${found.module} api`, version: "0.0.0" })) as { paths: Record<string, Record<string, { tags?: string[] }>> };
		for (const [p, methods] of Object.entries(doc.paths)) {
			for (const [method, op] of Object.entries(methods)) {
				if (paths[p]?.[method])
					throw new Error(`[ojm-api] 聚合冲突：${method.toUpperCase()} ${p} 被多个契约声明——请检查各模块 apiPrefix 是否撞车。`);
				op.tags = [found.module];
				(paths[p] ??= {})[method] = op;
			}
		}
	}

	const outDir = contracts.some(c => c.kind === "uni-dev") ? join(cwd, "api/docs") : join(cwd, "docs/api");
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
