import type { IrEndpoint } from "./ir";
import { emitSchemaSource, keyOf } from "./emit-schema";
import { wirePrefixOf } from "./ir";

/**
 * AC-D5/D6/D8/D15：api.ts + api.schemas.ts 发射器。
 *
 * 生成物约定：
 * - module 目标：bindRequest(ctx.utils.request) 能力持有者（AC-D8，零新增 runtime 导出）
 * - internal 目标：直接 import runtime 全局 request（生成物落 runtime src 树内，走 #src alias）
 * - 信封解包内联 + 业务错误归一 ContractApiError（§6.2）
 * - DEV 下动态 import("./api.schemas") safeParse 校验（AC-D15）；生产构建该分支
 *   被 import.meta.env.DEV 常量消除，zod 随之摇出产物
 * - raw 端点：不解包不校验，原样透传 Response（escape hatch）
 */

const BANNER = `/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）`;

type Slot = "params" | "query" | "body" | "form";

const SLOT_TYPE_SUFFIX: Record<Slot, string> = { params: "Params", query: "Query", body: "Body", form: "Form" };

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

/** 模块目录名 → PascalCase（连字符分段首字母大写拼接）：personal-center → PersonalCenter */
function pascalModuleName(module: string): string {
	return module.split("-").map(pascal).join("");
}

function slotsOf(ep: IrEndpoint): Slot[] {
	const slots: Slot[] = [];
	if (ep.paramNames.length > 0)
		slots.push("params"); // 槽位由 route 参数段决定；params schema 可省（省则参数全按 string 声明）
	if (ep.querySchema)
		slots.push("query");
	if (ep.bodySchema)
		slots.push("body");
	if (ep.form)
		slots.push("form"); // 与 body 互斥（定义期已拦截），故二者不同时出现
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
		// form 槽不是单个 schema（文本部件 + 文件部件两截），单独发射
		if (slot === "form") {
			lines.push(emitFormType(ep));
			continue;
		}
		// 请求槽用 z.input（带 .default() 的字段入参可选）；data 用 z.infer（输出型）
		lines.push(`export type ${pascal(ep.name)}${SLOT_TYPE_SUFFIX[slot]} = z.input<(typeof schemas)["${ep.name}"]["${slot}"]>;`);
	}
	if (ep.dataSchema)
		lines.push(`export type ${pascal(ep.name)}Data = z.infer<(typeof schemas)["${ep.name}"]["data"]>;`);
	return lines;
}

/**
 * multipart 入参类型：文本部件取 api.schemas 的 form 槽（z.input，与 body 同款推导），
 * 文件部件是**二进制**——只能声明 File/Blob（multiple → 数组），不进 zod/JSON Schema。
 */
function emitFormType(ep: IrEndpoint): string {
	const form = ep.form!;
	const members: string[] = [];
	if (form.fieldsSchema)
		members.push(`\tfields: z.input<(typeof schemas)["${ep.name}"]["form"]>`);
	if (form.files.length) {
		const files = form.files
			.map(f => `${keyOf(f.name)}${f.required ? "" : "?"}: ${f.multiple ? "Array<File | Blob>" : "File | Blob"}`)
			.join(", ");
		members.push(`\tfiles: { ${files} }`);
	}
	return `export type ${pascal(ep.name)}Form = {\n${members.join("\n")}\n};`;
}

/**
 * multipart/form-data 组装函数：文本部件逐个 append（undefined 缺省不 append，
 * 与 oj 侧 http.body 缺省同义），文件部件按 multiple 展开。**不设 content-type**——
 * ky 见到 FormData 自补 `multipart/form-data; boundary=…`，手写反而丢 boundary。
 *
 * 文本部件的取值：标量 `String(v)`；对象/数组 `JSON.stringify(v)`——多部件文本只能是字符串，
 * 直接 `String({a:1})` 会静默变成 `[object Object]`，宁可发一份可解析的 JSON 文本。
 */
function emitFormBuilder(ep: IrEndpoint): string {
	const form = ep.form!;
	const lines = [
		`function build${pascal(ep.name)}Form(input: ${pascal(ep.name)}Form): FormData {`,
		"\tconst fd = new FormData();",
	];
	for (const name of form.fieldNames) {
		const access = `input.fields.${keyOf(name)}`;
		lines.push(`\tif (${access} !== undefined) {`);
		lines.push(`\t\tconst v = ${access};`);
		// 文本部件只能是字符串：对象/数组 JSON 化（直接 String() 会静默变 [object Object]）
		lines.push(
			`\t\tfd.append(${JSON.stringify(name)}, v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));`,
		);
		lines.push("\t}");
	}
	for (const file of form.files) {
		const access = `input.files.${keyOf(file.name)}`;
		if (file.multiple) {
			lines.push(`\tfor (const file of ${access}${file.required ? "" : " ?? []"})`);
			lines.push(`\t\tfd.append(${JSON.stringify(file.name)}, file);`);
		}
		else if (file.required) {
			lines.push(`\tfd.append(${JSON.stringify(file.name)}, ${access});`);
		}
		else {
			lines.push(`\tif (${access} !== undefined)`);
			lines.push(`\t\tfd.append(${JSON.stringify(file.name)}, ${access});`);
		}
	}
	lines.push("\treturn fd;", "}");
	return lines.join("\n");
}

function emitEndpoint(ep: IrEndpoint): string {
	const method = KY_METHOD[ep.method];
	if (!method) {
		throw new Error(`[ojm-api] client 发射失败：端点 "${ep.name}" 方法 OPTIONS 不在支持范围（ky 无 options 方法）——契约里请改用其他方法。`);
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
	// multipart：请求体是就地组装的 FormData（json 通道与 form 互斥）
	if (ep.form)
		optParts.push(`body: build${pascalName}Form(${prefix}form)`);
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
			const { schemas } = await import("./api.schemas");
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

function emitPrelude(target: "module" | "internal", module?: string, endpointNames: string[] = [], wirePrefix?: string): string {
	const binding = target === "module"
		? `let req: ScopedRequestLike | undefined;

/** 线上 API 前缀（ojm api 从契约抽取，唯一真源，勿手改）：请求基址 + 前缀登记用 */
export const API_PREFIX = "${wirePrefix ?? `/${module}`}";

/** 认领身份前缀（契约 apiPrefix，字面等于模块目录名）：跨模块认领护栏对比基准 */
export const MODULE_PREFIX = "/${module}";

/**
 * 模块 entry 的 onInit 里一行创建（构造即 install）：完成 apiPrefix 登记 +
 * scoped request 绑定，返回绑好前缀的端点函数集合。一模块一 client；
 * 重复构造幂等安全（前缀重复登记同值、request 重绑同值）。
 */
export function create${pascalModuleName(module!)}Client(ctx: ModuleContext) {
	// 跨模块认领护栏（DEV）：工厂知道自己该属于谁（MODULE_PREFIX = 契约 apiPrefix），
	// ctx 又带 module.name——名实不符说明别的模块在替本模块创建 client，会共享 request
	// 单槽、卸载互相耦合；跨模块需求应由本模块创建后经 provider 暴露。
	// 注意对比基准是 MODULE_PREFIX（目录名）而非 API_PREFIX——D-M8 映射时线上前缀
	// 属于别的命名空间，认领身份仍按目录名。
	if (import.meta.env.DEV && ctx.module.name !== MODULE_PREFIX.slice(1)) {
		console.warn(\`[ojm-api] 模块 "\${ctx.module.name}" 正在认领 \${MODULE_PREFIX} 的 client——跨模块认领会共享 request 单槽、卸载互相耦合；应由 "\${MODULE_PREFIX.slice(1)}" 模块在自身 onInit 创建，跨模块需求经 provider 暴露。\`);
	}
	ctx.register.apiPrefix(API_PREFIX);
	bindRequest(ctx.utils.request);
	return { ${endpointNames.join(", ")} };
}

/**
 * @deprecated 请改用 create${pascalModuleName(module!)}Client(ctx)——工厂构造即完成
 * 前缀登记 + request 绑定，不会出现「登记了前缀没绑 request」的半接线状态。
 */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req)
		throw new ContractApiError(-1, "[ojm-api] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 create${pascalModuleName(module!)}Client(ctx)（或 bindRequest(ctx.utils.request)）。");
	return req;
}`
		: `function ensureReq(): ScopedRequestLike {
	return request;
}`;

	const ctxImport = target === "module"
		? "import type { ModuleContext } from \"@oj-module/runtime\";\n"
		: "";

	return `${BANNER}
import { ContractApiError } from "@oj-module/runtime/contract/errors";
import type { ScopedRequestLike } from "@oj-module/runtime/contract/errors";
${ctxImport}${target === "internal" ? "import { request } from \"#src/utils/request\";\n" : ""}import type { z } from "${zImport(target)}";
import type { schemas } from "./api.schemas";

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
			// form 槽只发射文本部件（files 是二进制，无 schema）；api.ts 的 Form 类型据此推导
			if (ep.form?.fieldsSchema)
				slots.push(`\t\tform: ${emitSchemaSource(ep.form.fieldsSchema)},`);
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

/** 发射双产物：api.ts（类型 + 请求函数 + 工厂）与 api.schemas.ts（DEV 校验 schema） */
export function emitClient(ir: IrEndpoint[], opts: { target: "module" | "internal", module?: string }): { "api.ts": string, "api.schemas.ts": string } {
	if (ir.length === 0)
		throw new Error("[ojm-api] client 发射失败：IR 为空——契约文件里没有 defineApi 端点，无需生成。");
	if (opts.target === "module" && !opts.module) {
		throw new Error(
			"[ojm-api] client 发射失败：module 目标需要模块名——"
			+ "emitClient(ir, { target: \"module\", module })（工厂名 create<Module>Client 与 API_PREFIX 都依赖它）。",
		);
	}
	// D-M8：模块目标的登记前缀 = 线上前缀（scoped request 基座）；一模块一登记值，
	// 混用不同线上前缀的端点在此拦截（register.apiPrefix 每模块只收一个值）。
	const wirePrefixes = new Set(ir.map(ep => wirePrefixOf(ep)));
	if (opts.target === "module" && wirePrefixes.size > 1) {
		throw new Error(
			`[ojm-api] client 发射失败：模块 "${opts.module}" 的端点线上前缀不一致（${[...wirePrefixes].join(" / ")}）`
			+ "——register.apiPrefix 一模块一值，urlPrefix 映射须整模块一致（不同前缀请拆模块）。",
		);
	}
	const sections: string[] = [emitPrelude(opts.target, opts.module, ir.map(ep => ep.name), wirePrefixes.size === 1 ? wirePrefixes.values().next().value : undefined)];
	for (const ep of ir) {
		const types = emitTypes(ep);
		if (types.length)
			sections.push(types.join("\n"));
		if (ep.form)
			sections.push(emitFormBuilder(ep));
		sections.push(emitEndpoint(ep));
	}
	return {
		"api.ts": `${sections.join("\n\n")}\n`,
		"api.schemas.ts": emitSchemas(ir, opts.target),
	};
}
