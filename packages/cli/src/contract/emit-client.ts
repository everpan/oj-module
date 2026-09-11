import type { IrEndpoint } from "./ir";
import { emitSchemaSource } from "./emit-schema";

/**
 * AC-D5/D6/D8/D15：client.ts + client.schemas.ts 发射器。
 *
 * 生成物约定：
 * - module 目标：bindRequest(ctx.utils.request) 能力持有者（AC-D8，零新增 runtime 导出）
 * - internal 目标：直接 import runtime 全局 request（生成物落 runtime src 树内，走 #src alias）
 * - 信封解包内联 + 业务错误归一 ContractApiError（§6.2）
 * - DEV 下动态 import("./client.schemas") safeParse 校验（AC-D15）；生产构建该分支
 *   被 import.meta.env.DEV 常量消除，zod 随之摇出产物
 * - raw 端点：不解包不校验，原样透传 Response（escape hatch）
 */

const BANNER = `/* eslint-disable */
// 生成物：ram api 从契约生成，勿手改（改动请改契约文件后重跑 ram api）`;

type Slot = "params" | "query" | "body";

const SLOT_TYPE_SUFFIX: Record<Slot, string> = { params: "Params", query: "Query", body: "Body" };

const KY_METHOD: Record<IrEndpoint["method"], string> = {
	GET: "get",
	POST: "post",
	PUT: "put",
	DELETE: "delete",
	PATCH: "patch",
	HEAD: "head",
	OPTIONS: "", // 不支持
};

function pascal(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

function slotsOf(ep: IrEndpoint): Slot[] {
	const slots: Slot[] = [];
	if (ep.paramNames.length > 0)
		slots.push("params"); // 槽位由 route 参数段决定；params schema 可省（省则参数全按 string 声明）
	if (ep.querySchema)
		slots.push("query");
	if (ep.bodySchema)
		slots.push("body");
	return slots;
}

/** 单槽直接传参、多槽打包对象（{ params, query, body }）；返回槽位访问前缀 */
function argPrefix(slots: Slot[]): string {
	return slots.length > 1 ? "input." : "";
}

/** fullPath → 相对路径模板字面量：去前导 "/"（scoped client 相对前缀拼接）；参数段插值 */
function urlTemplate(ep: IrEndpoint, prefix: string): string {
	const segs = ep.fullPath.split("/").filter(Boolean).map((seg) => {
		if (!seg.startsWith("{"))
			return seg;
		const isCatchAll = seg.startsWith("{*");
		const key = seg.replace(/^\{\*?/, "").replace(/\}$/, "");
		const expr = `${prefix}params.${key}`;
		return isCatchAll
			? `\${String(${expr}).split("/").map(encodeURIComponent).join("/")}`
			: `\${encodeURIComponent(String(${expr}))}`;
	});
	return `\`${segs.join("/")}\``;
}

function emitTypes(ep: IrEndpoint): string[] {
	const lines: string[] = [];
	for (const slot of slotsOf(ep)) {
		if (slot === "params" && !ep.paramsSchema) {
			// route 参数段存在但未声明 schema → 按 string 声明（catch-all 天然字符串）
			lines.push(`export type ${pascal(ep.name)}Params = { ${ep.paramNames.map(n => `${n}: string`).join(", ")} };`);
			continue;
		}
		// 请求槽用 z.input（带 .default() 的字段入参可选）；data 用 z.infer（输出型）
		lines.push(`export type ${pascal(ep.name)}${SLOT_TYPE_SUFFIX[slot]} = z.input<(typeof schemas)["${ep.name}"]["${slot}"]>;`);
	}
	if (ep.dataSchema)
		lines.push(`export type ${pascal(ep.name)}Data = z.infer<(typeof schemas)["${ep.name}"]["data"]>;`);
	return lines;
}

function emitEndpoint(ep: IrEndpoint): string {
	const method = KY_METHOD[ep.method];
	if (!method) {
		throw new Error(`[ram-api] client 发射失败：端点 "${ep.name}" 方法 OPTIONS 不在支持范围（ky 无 options 方法）——契约里请改用其他方法。`);
	}
	const slots = slotsOf(ep);
	const prefix = argPrefix(slots);
	const url = urlTemplate(ep, prefix);
	const pascalName = pascal(ep.name);
	const typeName = (suffix: string) => `${pascalName}${suffix}`;

	// 入参签名
	let argDecl = "";
	if (slots.length === 1)
		argDecl = `${slots[0]}: ${typeName(SLOT_TYPE_SUFFIX[slots[0]])}`;
	else if (slots.length > 1)
		argDecl = `input: { ${slots.map(s => `${s}: ${typeName(SLOT_TYPE_SUFFIX[s])}`).join(", ")} }`;

	// 请求 options
	const optParts: string[] = [];
	if (ep.querySchema)
		optParts.push(`searchParams: ${prefix}query as Record<string, string | number | boolean>`);
	if (ep.bodySchema)
		optParts.push(`json: ${prefix}body`);
	if (ep.ignoreLoading)
		optParts.push("ignoreLoading: true");
	const opts = optParts.length ? `, { ${optParts.join(", ")} }` : "";

	const call = `client.${method}(${url}${opts})`;

	if (ep.raw) {
		return `export function ${ep.name}(${argDecl}): Promise<Response> {
	const client = ensureReq();
	return ${call};
}`;
	}

	const returnType = ep.dataSchema ? typeName("Data") : "unknown";
	const devValidate = ep.dataSchema
		? `
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.${ep.name}.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, \`[契约违例] ${ep.name} 响应与契约不符：\${r.error.issues.map(i => \`\${i.path.join(".") || "(root)"}: \${i.message}\`).join("; ")}\`);
		}`
		: "";

	return `export async function ${ep.name}(${argDecl}): Promise<${returnType}> {
	const client = ensureReq();
	try {
		const env = await ${call}.json<OjEnvelope<${returnType}>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as ${returnType};${devValidate}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}`;
}

function emitPrelude(target: "module" | "internal"): string {
	const binding = target === "module"
		? `let req: ScopedRequestLike | undefined;

/** 模块入口 onInit 里调用：bindRequest(ctx.utils.request)（AC-D8 能力持有者） */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req)
		throw new ContractApiError(-1, "[ram-api] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 bindRequest(ctx.utils.request)。");
	return req;
}`
		: `function ensureReq(): ScopedRequestLike {
	return request;
}`;

	return `${BANNER}
import { ContractApiError } from "@oj-module/runtime/contract/errors";
import type { ScopedRequestLike } from "@oj-module/runtime/contract/errors";
${target === "internal" ? "import { request } from \"#src/utils/request\";\n" : ""}import type { z } from "${zImport(target)}";
import type { schemas } from "./client.schemas";

/** oj 信封（AC-D16）：code=0 成功；非 0 时 HTTP status=code，由 toApiError 归一为 ContractApiError */
interface OjEnvelope<T> { code: number, msg?: string, data?: T }

${binding}

/** ky HTTPError → ContractApiError（错误体为信封时取 code/msg）；契约违例与原错误原样透传 */
async function toApiError(e: unknown): Promise<unknown> {
	if (e instanceof ContractApiError)
		return e;
	const res = (e as { response?: Response } | null)?.response;
	if (res instanceof Response) {
		try {
			const env = await res.clone().json() as { code?: number, msg?: string } | null;
			if (env && typeof env.code === "number")
				return new ContractApiError(env.code, env.msg ?? res.statusText);
		}
		catch { /* 非 JSON 错误体——回退原错误 */ }
	}
	return e;
}`;
}

/** z 导入来源：模块走 runtime re-export（AC-D15）；internal 在 runtime 树内，自引包名成环，直取 zod */
function zImport(target: "module" | "internal"): string {
	return target === "internal" ? "zod" : "@oj-module/runtime";
}

function emitSchemas(ir: IrEndpoint[], target: "module" | "internal"): string {
	const entries = ir
		.map((ep) => {
			const slots: string[] = [];
			// raw 端点也保留请求槽（params/query/body 类型引用此处 schema）；
			// 仅 data 槽与 raw 互斥（定义期已拦截 data+raw）
			if (ep.paramsSchema)
				slots.push(`\t\tparams: ${emitSchemaSource(ep.paramsSchema)},`);
			if (ep.querySchema)
				slots.push(`\t\tquery: ${emitSchemaSource(ep.querySchema)},`);
			if (ep.bodySchema)
				slots.push(`\t\tbody: ${emitSchemaSource(ep.bodySchema)},`);
			if (!ep.raw && ep.dataSchema)
				slots.push(`\t\tdata: ${emitSchemaSource(ep.dataSchema)},`);
			if (slots.length === 0)
				return "";
			return `\t${ep.name}: {\n${slots.join("\n")}\n\t},`;
		})
		.filter(Boolean);

	return `${BANNER}
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "${zImport(target)}";

export const schemas = {
${entries.join("\n")}
};
`;
}

/** 发射双产物：client.ts（类型 + 请求函数）与 client.schemas.ts（DEV 校验 schema） */
export function emitClient(ir: IrEndpoint[], opts: { target: "module" | "internal" }): { "client.ts": string, "client.schemas.ts": string } {
	if (ir.length === 0)
		throw new Error("[ram-api] client 发射失败：IR 为空——契约文件里没有 defineApi 端点，无需生成。");
	const sections: string[] = [emitPrelude(opts.target)];
	for (const ep of ir) {
		const types = emitTypes(ep);
		if (types.length)
			sections.push(types.join("\n"));
		sections.push(emitEndpoint(ep));
	}
	return {
		"client.ts": `${sections.join("\n\n")}\n`,
		"client.schemas.ts": emitSchemas(ir, opts.target),
	};
}
