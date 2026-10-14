import type { HandlerRow } from "./handler-scan";
import type { IrEndpoint } from "./ir";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { readOjAnonymousPaths } from "../oj-config";
import { emitClient } from "./emit-client";
import { emitOpenapiYaml, emitRoutesJson } from "./emit-meta";
import { planStubWrites } from "./emit-stub";
import { handlerAbs, implementedRouteKeys, pathKey, scanHandlerFile, VERB_OF, walkApiFiles } from "./handler-scan";
import { splitRoute, wirePrefixOf } from "./ir";
import { artifactPaths, discoverContracts, irOf } from "./run";

/**
 * AC-D10：`ojm api --check` 三重校验（纯对账不写盘）——
 * ① 生成物同步：内存重生成 vs 磁盘逐字节 diff（含 stub 待更新）
 * ② route 双向对账：AST 扫 oj api.ts（default 导出方法名 + 语句起始 `.route = "..."` 赋值）
 *    vs 契约路由表：未实现 warn / 未登记 error / 参数段不一致 error
 * ③ routes.js diff：release 路由表（oj build 产物）vs routes.json；无 dist 给提示不判违规
 *
 * 原则：check 永不修文件——修复动作永远由人执行（重跑 ojm api / 补 handler / oj build）。
 */

export interface CheckViolation {
	level: "error" | "warn"
	kind: "artifact-stale" | "route-not-implemented" | "route-unregistered" | "route-params-mismatch" | "routes-js-drift" | "ws-anonymous-missing"
	message: string
	filePath?: string
}

export interface CheckResult {
	violations: CheckViolation[]
	hints: string[]
}

/**
 * D12/F19：`ojm api --check` 豁免清单（api/.ojm-api-exempt.json）。
 * - modules：整模块跳过 route 双向对账（与 dist 对账）。
 * - paths：路径前缀跳过；`/xxx/*` 为「一层通配」，否则为精确前缀匹配。
 * 仅用于降级（error→skip），绝不引入新错误；缺省/损坏一律回退空豁免。
 */
export interface ApiExemption {
	modules: string[]
	paths: string[]
}

/**
 * 加载豁免清单：默认 `<cwd>/api/.ojm-api-exempt.json`（新名），缺失时回退旧名
 * `api/.ram-api-exempt.json`（R4：存量工程豁免不因改名失效）；`opts.exempt` 为
 * 绝对/相对路径时覆盖默认。文件缺失或 JSON 损坏 → 空豁免 `{}`（绝不抛错）。
 * 反常识坑：清单是严格 JSON.parse——写 `//` 注释会解析失败、静默回退空豁免
 * （豁免全失效且无报错）；说明文字请放 `_comment` 字段（本加载器只读
 * modules/paths，多余字段天然忽略）。
 */
export function loadExemption(opts: { cwd: string, exempt?: string }): ApiExemption {
	const file = resolveExemptPath(opts.cwd, opts.exempt);
	if (!existsSync(file))
		return { modules: [], paths: [] };
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<ApiExemption>;
		return {
			modules: Array.isArray(parsed?.modules) ? parsed.modules.map(String) : [],
			paths: Array.isArray(parsed?.paths) ? parsed.paths.map(String) : [],
		};
	}
	catch {
		return { modules: [], paths: [] };
	}
}

/** 豁免清单文件名（新名优先；旧名只读回退）。`init` 只产新名。 */
const EXEMPT_FILE = "api/.ojm-api-exempt.json";
const EXEMPT_FILE_LEGACY = "api/.ram-api-exempt.json";

function resolveExemptPath(cwd: string, exempt?: string): string {
	if (exempt)
		return exempt;
	const next = join(cwd, EXEMPT_FILE);
	if (existsSync(next))
		return next;
	const legacy = join(cwd, EXEMPT_FILE_LEGACY);
	return existsSync(legacy) ? legacy : next;
}

/** 路由身份串（如 "order/list"、"auth/login"）的模块段 = 首段 */
function moduleOf(relPath: string): string {
	return relPath.split("/")[0] ?? "";
}

/**
 * 判断 `routePath`（带前导斜杠，如 "/auth/login" 或 "/web/user-info"）是否命中
 * 豁免路径项 `p`（如 "/auth/*"）。
 * - `p` 以 `/*` 结尾：base=p 去尾，要求 routePath === `${base}/<单段>`（一层通配）。
 * - 否则：精确前缀匹配（routePath 等于 p 或以 `p + "/"` 开头）。
 */
function matchExemptPath(routePath: string, p: string): boolean {
	if (!p.startsWith("/"))
		p = `/${p}`;
	if (p.endsWith("/*")) {
		const base = p.slice(0, -2); // "/auth"
		if (!routePath.startsWith(`${base}/`))
			return false;
		const rest = routePath.slice(base.length + 1); // "login"
		return rest.length > 0 && !rest.includes("/");
	}
	return routePath === p || routePath.startsWith(`${p}/`);
}

/** ws.ts / ws.js（目录内放即产生一条 WS 路由，文件名必须小写——oj 0.1.5 约定） */
function walkWsFiles(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir))
		return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory())
			walkWsFiles(p, out);
		else if (entry.name === "ws.ts" || entry.name === "ws.js")
			out.push(p);
	}
	return out;
}

/**
 * ④WS 路由鉴权对账：oj 0.1.30 起 WS 握手过 oj-auth 守卫，不在
 * `auth.anonymous_paths` 里的 WS，未带凭据的客户端握手即 401（表现为「文件在
 * 却连不上」）。目录 `api/src/news/chat/ws.ts` → 路由 `<base>/news/chat/ws`。
 *
 * 只 warn 不 error：带 Bearer/cookie 的受保护 WS 是正当用法。
 * 读不到 config 直接不判——缺配置时做不出有依据的断言。
 */
function checkWsAnonymous(wsFiles: string[], apiSrcDir: string, configPath: string): CheckViolation[] {
	if (!existsSync(configPath) || wsFiles.length === 0)
		return [];
	const anonymous = readOjAnonymousPaths(configPath);
	if (anonymous.length === 0)
		return [];
	return wsFiles
		.map((file) => {
			const relDir = relative(apiSrcDir, dirname(file)).split(sep).join("/");
			return { file, path: `/${relDir}/ws` };
		})
		.filter(({ path }) => !anonymous.includes(path))
		.map(({ file, path }) => ({
			level: "warn" as const,
			kind: "ws-anonymous-missing" as const,
			filePath: file,
			message: `[ojm-api] WS 路由 ${path} 不在 auth.anonymous_paths——oj 0.1.30 起 WS 握手过鉴权守卫，未带凭据的客户端会握手 401（表现为「文件在却连不上」）。若该 WS 本就要求鉴权（客户端带 Bearer/Cookie）可忽略本提示；否则请在 api/config.yaml 的 auth.anonymous_paths 补上 ${path}。`,
		}));
}

/** 路径段（去空串，忽略前导 /） */
const pathSegs = (p: string) => p.split("/").filter(Boolean);
/** 静态前缀：首个参数段（{...}）之前的路径段 */
function staticPrefixOf(p: string): string {
	const segs = pathSegs(p);
	const i = segs.findIndex(s => s.startsWith("{"));
	return segs.slice(0, i === -1 ? segs.length : i).join("/");
}

/**
 * ② route 双向对账：契约路由表 vs AST 扫描的 handler 表（D12/F19：豁免降级）。
 *
 * 定位分两层，先精确后模糊：
 * ① **精确全路径匹配**（方法 + ojFull，或方法 + wire 全路径 contractAbs）——覆盖
 *   v0.1.64 嵌套组（组名 = 虚拟路径段，全路径唯一）与绝对 `.route` 精确命中（D-M8
 *   urlPrefix 映射）。
 * ② **同位置参数段比对**（模糊兜底）——未精确命中时，在全 handler 里找「同方法、
 *   静态前缀相同、段数相同、但参数名不同」的唯一一条：即「同一端点、参数段写错」，
 *   报 route-params-mismatch（旧行为）。静态前缀/段数不同而非同位置 → 视为不同端点，
 *   报未实现 + 未登记（避免误判 mismatch）。嵌套组（虚拟段）与绝对形态都经此口径。
 */
function reconcileRoutes(contractIr: IrEndpoint[], handlers: HandlerRow[], exemption: ApiExemption): CheckViolation[] {
	const violations: CheckViolation[] = [];

	// ① 精确索引：handler 全路径（绝对 .route 另按 wire 全路径索引）。
	const byPath = new Map<string, HandlerRow>();
	for (const h of handlers) {
		byPath.set(pathKey(h.method, h.full), h);
		if (h.tail?.startsWith("/"))
			byPath.set(pathKey(h.method, h.tail), h);
	}

	const claimed = new Set<HandlerRow>();
	for (const ep of contractIr) {
		const { dir } = splitRoute(ep.route);
		const dirFull = `${ep.apiPrefix.replace(/^\//, "")}${dir ? `/${dir}` : ""}`;
		const ojFull = `${ep.apiPrefix.replace(/^\//, "")}${ep.route}`.replace(/\/+/g, "/");
		const contractAbs = `${wirePrefixOf(ep)}${ep.route}`;

		// ① 精确全路径：嵌套组 / 绝对精确命中
		const exact = byPath.get(pathKey(ep.method, ojFull)) ?? byPath.get(pathKey(ep.method, contractAbs));
		if (exact) {
			claimed.add(exact);
			continue;
		}

		// ② 模糊兜底：同位置（静态前缀 + 段数相同）但参数名不同的唯一 handler → mismatch
		const candidates = handlers.filter(h =>
			!claimed.has(h)
			&& h.method === ep.method
			&& handlerAbs(h) !== contractAbs
			&& staticPrefixOf(handlerAbs(h)) === staticPrefixOf(contractAbs)
			&& pathSegs(handlerAbs(h)).length === pathSegs(contractAbs).length,
		);
		if (candidates.length === 1) {
			const h = candidates[0];
			claimed.add(h);
			violations.push({
				level: "error",
				kind: "route-params-mismatch",
				message: `[ojm-api] 参数段不一致（${ep.method} ${dirFull}）：契约 route "${ep.route}" vs handler .route "${h.tail ?? h.full}"——契约 route 是唯一手写事实源（AC-D10），请改 handler 的 .route 字面量对齐。`,
				filePath: h.filePath,
			});
			continue;
		}
		violations.push({
			level: "warn",
			kind: "route-not-implemented",
			message: `[ojm-api] 契约端点 "${ep.name}"（${ep.method} ${ojFull}）未实现——oj 树缺少 handler；重跑 ojm api 生成 stub 或手动实现（嵌套组形态：组名即路径段，见 oj v0.1.64）。`,
		});
	}
	for (const h of handlers) {
		if (claimed.has(h))
			continue;
		// D12/F19：整模块豁免，或路径命中豁免前缀 → 视为已覆盖，跳过未登记报错。
		// 豁免路径同时按文件目录（旧口径）与有效路由全路径（v0.1.64 嵌套口径）判定。
		const mod = moduleOf(h.dir);
		if (exemption.modules.includes(mod))
			continue;
		if (exemption.paths.some(p => matchExemptPath(`/${h.dir}`, p) || matchExemptPath(`/${h.full}`, p)))
			continue;
		const nested = h.chain.includes(".") ? `，handler 链 ${h.chain}` : "";
		violations.push({
			level: "error",
			kind: "route-unregistered",
			message: `[ojm-api] handler 未登记（${h.method} ${h.full}${nested}）——oj 路由表存在但契约没有对应端点，请补契约或删除该 handler。`,
			filePath: h.filePath,
		});
	}
	return violations;
}

/**
 * routes.js（oj build 产物）行解析：`{ method: "get", pattern: "order/list", ... }`。
 * `options` 行直接跳过——契约不表达 OPTIONS（runtime 白名单拒绝），oj 树里合法的
 * options handler 进了 routes.js 也不该判「dist 多」（跨仓同步：oj v0.1.64）。
 */
function parseRoutesJs(text: string): { method: string, pattern: string }[] {
	const rows: { method: string, pattern: string }[] = [];
	for (const m of text.matchAll(/\{\s*method:\s*"(\w+)",\s*pattern:\s*"([^"]+)"/g)) {
		if (m[1].toLowerCase() === "options")
			continue;
		// oj 的路由表用短方法名（DELETE → "del"）；与契约 IR 的 HTTP 名对齐（同 VERB_OF 口径），
		// 否则 uni-dev 工程里任何 DELETE 端点都会被误报 routes-js-drift。
		const method = VERB_OF[m[1].toLowerCase()] ?? m[1].toUpperCase() as string;
		rows.push({ method, pattern: m[2] });
	}
	return rows;
}

/** ojm api --check 主入口。opts.exempt 为可选豁免清单路径（覆盖默认 api/.ojm-api-exempt.json） */
export async function checkApi(opts: { cwd: string, exempt?: string }): Promise<CheckResult> {
	const exemption = loadExemption(opts);
	const contracts = discoverContracts(opts.cwd);
	if (contracts.length === 0) {
		throw new Error(`[ojm-api] ${opts.cwd} 下没有发现契约文件——默认发现：api/src/*/contract.ts（uni-dev）与 web/src/*/__client/contract.ts（纯前端，旧名 client/ 兼容）。存量工程请迁移：modules/ → web/、模块内 api/ → __client/（生成物与契约同迁）。`);
	}
	const violations: CheckViolation[] = [];
	const hints: string[] = [];
	const uniDevIr: IrEndpoint[] = [];

	for (const found of contracts) {
		const ir = await irOf(found, opts.cwd);
		if (found.kind === "uni-dev")
			uniDevIr.push(...ir);

		// ① 生成物同步：内存重生成 vs 磁盘逐字节
		const paths = artifactPaths(found, opts.cwd);
		const client = emitClient(ir, { target: "module", module: found.module });
		const expected: [string, string][] = [
			[paths.client, client["api.ts"]],
			[paths.schemas, client["api.schemas.ts"]],
			[paths.routes, emitRoutesJson(ir)],
			[paths.openapi, emitOpenapiYaml(ir, { title: `${found.module} api`, version: "0.0.0" })],
		];
		for (const [p, content] of expected) {
			if (!existsSync(p) || readFileSync(p, "utf8") !== content) {
				violations.push({
					level: "error",
					kind: "artifact-stale",
					message: `[ojm-api] 生成物过期或缺失：${relative(opts.cwd, p)}——请重跑 ojm api 使其与契约同步。`,
					filePath: p,
				});
			}
		}
		// stub 生成物：缺失（create）与待更新（update，指纹匹配但契约已变）都属过期。
		// 纯指纹头前缀升级（旧 ram-api:stub → 新 ojm-api:stub，正文未变）不算过期：
		// 存量工程升级后首次 --check 不应因改名误报（R2 平滑升级）。
		if (found.kind === "uni-dev") {
			const stubWrites = await planStubWrites(ir, { apiSrcDir: join(opts.cwd, "api/src"), implemented: implementedRouteKeys(join(opts.cwd, "api/src")) });
			for (const w of stubWrites) {
				if (w.action === "create") {
					violations.push({
						level: "error",
						kind: "artifact-stale",
						message: `[ojm-api] stub 缺失：${relative(opts.cwd, w.filePath)}——请重跑 ojm api 生成。`,
						filePath: w.filePath,
					});
					continue;
				}
				if (w.action === "update" && !w.prefixUpgrade) {
					violations.push({
						level: "error",
						kind: "artifact-stale",
						message: `[ojm-api] stub 待随契约更新：${relative(opts.cwd, w.filePath)}——请重跑 ojm api。`,
						filePath: w.filePath,
					});
				}
			}
		}
	}

	// ② route 双向对账（仅 uni-dev——oj 树存在才有意义）
	if (contracts.some(c => c.kind === "uni-dev")) {
		const apiSrcDir = join(opts.cwd, "api/src");
		const handlers = walkApiFiles(apiSrcDir).flatMap(f => scanHandlerFile(f, apiSrcDir));
		violations.push(...reconcileRoutes(uniDevIr, handlers, exemption));
	}

	// ④ WS 路由鉴权对账（oj 0.1.30 起握手过鉴权守卫）
	violations.push(...checkWsAnonymous(
		walkWsFiles(join(opts.cwd, "api/src")),
		join(opts.cwd, "api/src"),
		join(opts.cwd, "api/config.yaml"),
	));

	// ③ routes.js diff
	const distDir = join(opts.cwd, "api/dist");
	const distRows: { method: string, pattern: string }[] = [];
	if (existsSync(distDir)) {
		for (const entry of readdirSync(distDir, { withFileTypes: true })) {
			if (!entry.isDirectory())
				continue;
			const routesJs = join(distDir, entry.name, "routes.js");
			if (existsSync(routesJs))
				distRows.push(...parseRoutesJs(readFileSync(routesJs, "utf8")));
		}
	}
	if (distRows.length === 0) {
		hints.push("[ojm-api] 未发现 api/dist/**/routes.js——release 路由表对账跳过；发布前请先 oj build 再跑 ojm api --check。");
	}
	else {
		const contractRows = uniDevIr.map(ep => ({ method: ep.method, pattern: ep.fullPath.replace(/^\//, "") }));
		const keyOf = (r: { method: string, pattern: string }) => `${r.method} ${r.pattern}`;
		const contractSet = new Set(contractRows.map(keyOf));
		const distSet = new Set(distRows.map(keyOf));
		const missingInDist = [...contractSet].filter(r => !distSet.has(r));
		// D12/F19：dist 行命中豁免（整模块或路径前缀）→ 不报 "dist 多"
		const isExemptRow = (r: { method: string, pattern: string }) => {
			const mod = moduleOf(r.pattern);
			const hitModule = exemption.modules.includes(mod);
			const hitPath = exemption.paths.some(p => matchExemptPath(`/${r.pattern}`, p));
			return hitModule || hitPath;
		};
		const extraInDist = distRows
			.filter(r => !contractSet.has(keyOf(r)))
			.filter(r => !isExemptRow(r))
			.map(keyOf);
		if (missingInDist.length || extraInDist.length) {
			violations.push({
				level: "error",
				kind: "routes-js-drift",
				message: `[ojm-api] routes.js 与契约路由表不一致——${[
					missingInDist.length ? `dist 缺：${missingInDist.join(", ")}` : "",
					extraInDist.length ? `dist 多：${extraInDist.join(", ")}` : "",
				].filter(Boolean).join("；")}。请重跑 oj build 后再对账。`,
			});
		}
	}

	return { violations, hints };
}
