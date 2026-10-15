import type { MockRoute, MockRouteContext } from "../dev-mock";
import type { OpenApiDoc } from "./openapi-ir";
import { readFileSync } from "node:fs";
import { matchMockRoute } from "../dev-mock";
import { jsonSchemaToSample } from "./json-schema-sample";
import { irFromOpenapi } from "./openapi-ir";
import { findOpenapiJson } from "./run";

/**
 * AC-D14 纯前端契约 mock：openapi.json（oj v0.1.73 产物）驱动示例值响应。
 *
 * 翻译层退役后，事实源即 openapi.json——其 data schema 是 JSON Schema 对象，
 * 由 `jsonSchemaToSample` 生成示例值（确定性、零依赖）。
 *
 * - 段级 matcher 自研极简实现（零新依赖）：字面段 > 参数段 > catch-all
 * - 手写 mock 精确匹配优先，契约 pattern 兜底（resolveMock 收敛选择序）
 * - raw 端点不进 mock 生成（二进制/流无信封可造）
 */

export interface ContractMockRoute<T = unknown> {
	method: string
	/** 含参数段的完整 pattern，如 "/order/item/{id}" */
	pattern: string
	/** 负载：openapi.json 解出的 data JSON Schema（由 jsonSchemaToSample 造示例值） */
	data: T
}

/** JSON Schema → 示例值（确定性，无外部依赖）；data 为 undefined 时返回 null */
export function exampleFromJsonSchema(schema: unknown): unknown {
	return jsonSchemaToSample(schema);
}

interface Seg { kind: "literal" | "param" | "catchAll", text: string }

function segmentsOf(pattern: string): Seg[] {
	return pattern.split("/").filter(Boolean).map((seg) => {
		if (seg.startsWith("{*"))
			return { kind: "catchAll", text: seg };
		if (seg.startsWith("{"))
			return { kind: "param", text: seg };
		return { kind: "literal", text: seg };
	});
}

/** 段级匹配 + 特异性打分：字面段多者优，其次参数段少者，catch-all 最末 */
function matchScore(segs: Seg[], pathSegs: string[]): number | undefined {
	let score = 0;
	let i = 0;
	for (const seg of segs) {
		if (seg.kind === "catchAll") {
			if (pathSegs.length - i < 1)
				return undefined; // catch-all 至少匹配一段
			return score;
		}
		if (i >= pathSegs.length)
			return undefined;
		if (seg.kind === "literal") {
			if (seg.text !== pathSegs[i])
				return undefined;
			score += 100;
		}
		else {
			score += 10;
		}
		i++;
	}
	return i === pathSegs.length ? score : undefined; // 无 catch-all 时要求段数恰好
}

/** 契约路由匹配：method + 段级特异性（字面 > 参数 > catch-all） */
export function matchContractRoute<T>(routes: ContractMockRoute<T>[], method: string, apiPath: string): ContractMockRoute<T> | undefined {
	const pathSegs = apiPath.split("/").filter(Boolean);
	let best: { route: ContractMockRoute<T>, score: number } | undefined;
	for (const route of routes) {
		if (route.method.toUpperCase() !== method.toUpperCase())
			continue;
		const score = matchScore(segmentsOf(route.pattern), pathSegs);
		if (score !== undefined && (best === undefined || score > best.score))
			best = { route, score };
	}
	return best?.route;
}

/** mock 选择序收敛：手写精确匹配优先，契约 pattern 兜底；返回带请求上下文的响应 thunk */
export function resolveMock(
	handwritten: MockRoute[],
	contract: ContractMockRoute[],
	method: string,
	apiPath: string,
): ((ctx?: MockRouteContext) => unknown) | undefined {
	const hit = matchMockRoute(handwritten, method, apiPath);
	if (hit)
		return ctx => hit.response(ctx ?? { body: {}, query: new URLSearchParams() });
	const fallback = matchContractRoute(contract, method, apiPath);
	if (fallback) {
		return () => ({
			code: 0,
			msg: "ok",
			data: exampleFromJsonSchema(fallback.data),
		});
	}
	return undefined;
}

/** dev 启动装载：openapi.json 为事实源（data schema 是 JSON Schema 对象），raw 端点跳过 */
export async function loadContractMocks(cwd: string): Promise<ContractMockRoute[]> {
	const openapiPath = findOpenapiJson(cwd);
	if (!openapiPath)
		return [];
	const doc = JSON.parse(readFileSync(openapiPath, "utf8")) as OpenApiDoc;
	return irFromOpenapi(doc)
		.filter(ep => !ep.raw)
		.map(ep => ({ method: ep.method, pattern: ep.fullPath, data: ep.dataSchema }));
}
