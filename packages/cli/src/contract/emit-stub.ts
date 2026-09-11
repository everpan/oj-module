import type { IrEndpoint } from "./ir";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { keyOf } from "./emit-schema";
import { splitRoute } from "./ir";

/**
 * AC-D10 §9.1：handler stub 发射器 + 指纹幂等。
 *
 * 幂等规则（设计文档 §9 表格的代码化）：
 * - 文件不存在 → create
 * - 指纹匹配且内容一致 → skip（零写入，git diff 为空）
 * - 指纹匹配但契约已变 → update（无人劳动成果，覆盖安全）
 * - 指纹不匹配（人已编辑）→ skip + reason 指路 --check；工具永不写、永不删
 *
 * 指纹健壮性（评审 F6）：stub 模板按仓风格写死（tab/双引号/分号）天然
 * lint-clean，指纹直接哈希发射内容——不再依赖消费工程装了 ESLint
 * （cli 并未声明该依赖，真实工程里 `await import("eslint")` 即崩）。
 * eslintFix 注入缝保留给测试与特殊工程的自定义格式化。
 */

export interface StubWrite {
	filePath: string
	content: string
	action: "create" | "update" | "skip"
	reason?: string
}

export interface PlanStubOptions {
	/** oj api 源码根（如 "api/src"） */
	apiSrcDir: string
	/** 读已有文件（不存在返回 undefined）；缺省真实 fs */
	readFile?: (path: string) => string | undefined
	/** 格式化注入缝（测试/特殊工程）；缺省恒等——模板本身天然 lint-clean（F6） */
	eslintFix?: (code: string, filePath: string) => Promise<string>
}

/** oj 方法名映射（DELETE → del） */
const OJ_METHOD: Record<string, string> = {
	GET: "get",
	POST: "post",
	PUT: "put",
	DELETE: "del",
	PATCH: "patch",
	HEAD: "head",
};

/**
 * 指纹头前缀：新写用 `ojm-api:stub`；读兼容旧 `ram-api:stub`（存量生成物）——
 * 否则升级后旧 stub 会被判为「人工编辑」而永不随契约更新（R2）。
 */
const FINGERPRINT_RE = /^\/\/ (?:ojm|ram)-api:stub (.+) sha256:([0-9a-f]{64})\r?\n/;

/** 哈希输入归一：LF + 行尾空白剔除（跨机器/lint 稳定） */
export function hashContent(body: string): string {
	const norm = body.replaceAll("\r\n", "\n").split("\n").map(l => l.replace(/[ \t]+$/, "")).join("\n");
	return createHash("sha256").update(norm).digest("hex");
}

/** 最小示例值源码生成（与 mock.ts 的值版有意不收敛——此处产代码模板文本） */
function exampleSourceFromSchema(schema: unknown): string {
	const def = (schema as { _zod?: { def?: Record<string, unknown> } })?._zod?.def;
	if (!def)
		return "null";
	switch (def.type) {
		case "string": {
			for (const check of (def.checks as { _zod?: { def?: Record<string, unknown> } }[]) ?? []) {
				const format = check._zod?.def?.format as string | undefined;
				if (format === "email")
					return "\"user@example.com\"";
				if (format === "uuid")
					return "\"00000000-0000-0000-0000-000000000000\"";
				if (format === "datetime")
					return "\"2026-01-01T00:00:00.000Z\"";
				if (format === "date")
					return "\"2026-01-01\"";
				if (format === "url")
					return "\"https://example.com\"";
			}
			return "\"示例\"";
		}
		case "number": {
			for (const check of (def.checks as { _zod?: { def?: Record<string, unknown> } }[]) ?? []) {
				const cd = check._zod?.def;
				if (cd?.check === "greater_than")
					return String(cd.inclusive === false ? (cd.value as number) + 1 : cd.value);
			}
			return "1";
		}
		case "boolean":
			return "true";
		case "date":
			return "\"2026-01-01T00:00:00.000Z\"";
		case "literal":
			return JSON.stringify((def.values as unknown[])[0]);
		case "enum":
			return JSON.stringify(Object.keys(def.entries as object)[0]);
		case "union":
			return exampleSourceFromSchema((def.options as unknown[])[0]);
		case "array":
			return `[${exampleSourceFromSchema(def.element)}]`;
		case "object": {
			const entries = Object.entries(def.shape as Record<string, unknown>)
				.map(([k, v]) => `\t\t${keyOf(k)}: ${exampleSourceFromSchema(v).replaceAll("\n", "\n\t\t")},`);
			return `{\n${entries.join("\n")}\n\t}`;
		}
		case "optional":
			return exampleSourceFromSchema(def.innerType);
		case "nullable":
			return "null";
		case "default":
			return JSON.stringify(def.defaultValue);
		default:
			return "null";
	}
}

function emitHandler(ep: IrEndpoint): string {
	const method = OJ_METHOD[ep.method];
	if (!method)
		throw new Error(`[ojm-api] stub 发射失败：端点 "${ep.name}" 方法 ${ep.method} 不在 oj 支持范围。`);
	const { tail } = splitRoute(ep.route);
	const body = ep.raw
		? "\t// TODO: raw 端点（二进制/流）——请自行实现响应写回\n\tjson.fail(501, \"not implemented\");"
		: `\tjson.ok(${ep.dataSchema ? exampleSourceFromSchema(ep.dataSchema) : ""});`;
	const routeLine = tail ? `${method}.route = "${tail}";\n` : "";
	return `function ${method}(): void {
${body}
}
${routeLine}`;
}

/** 同目录多端点归并一个 api.ts；方法按 HTTP 序排列保证字节稳定 */
const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

function emitStubBody(endpoints: IrEndpoint[]): string {
	const sorted = [...endpoints].sort((a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method));
	const handlers = sorted.map(emitHandler).join("\n");
	const names = sorted.map(ep => OJ_METHOD[ep.method]).join(", ");
	return `${handlers}export default { ${names} };\n`;
}

/** 纯计划不写盘：IR → 逐文件 StubWrite（create/update/skip + reason） */
export async function planStubWrites(ir: IrEndpoint[], opts: PlanStubOptions): Promise<StubWrite[]> {
	const readFile = opts.readFile ?? ((p: string) => {
		try {
			return readFileSync(p, "utf8");
		}
		catch {
			return undefined;
		}
	});
	const fix = opts.eslintFix ?? ((code: string) => Promise.resolve(code));

	// 按（模块段 + 目录镜像）分组 → 一个 api.ts
	const groups = new Map<string, IrEndpoint[]>();
	for (const ep of ir) {
		const { dir } = splitRoute(ep.route);
		const rel = [ep.apiPrefix.replace(/^\//, ""), dir, "api.ts"].filter(Boolean).join("/");
		const list = groups.get(rel) ?? [];
		list.push(ep);
		groups.set(rel, list);
	}

	const writes: StubWrite[] = [];
	for (const [rel, endpoints] of [...groups.entries()].sort()) {
		const filePath = `${opts.apiSrcDir}/${rel}`;
		// 模板天然 lint-clean（F6）→ 直接哈希发射内容；注入缝仅供测试/特殊工程对齐
		const body = await fix(emitStubBody(endpoints), filePath);
		const fingerprint = `// ojm-api:stub ${endpoints.map(e => e.name).sort().join(",")} sha256:${hashContent(body)}\n`;
		const content = fingerprint + body;

		const existing = readFile(filePath);
		if (existing === undefined) {
			writes.push({ filePath, content, action: "create" });
			continue;
		}
		const match = FINGERPRINT_RE.exec(existing);
		if (!match || match[2] !== hashContent(existing.replace(FINGERPRINT_RE, ""))) {
			writes.push({
				filePath,
				content,
				action: "skip",
				reason: "文件已被人工编辑（指纹缺失或不匹配）——工具永不覆盖人的劳动成果；如契约新增 method 未实现，ojm api --check 会对账报出。",
			});
			continue;
		}
		if (existing === content) {
			writes.push({ filePath, content, action: "skip", reason: "契约未变，产物字节一致（零写入）" });
			continue;
		}
		writes.push({ filePath, content, action: "update", reason: "指纹匹配（stub 未被人编辑），随契约变更更新" });
	}
	return writes;
}

/** 落盘：仅 create/update 写文件（父目录递归创建）；skip 零写入 */
export function applyStubWrites(writes: StubWrite[], writeFile?: (path: string, content: string) => void): { created: number, updated: number, skipped: number } {
	const write = writeFile ?? ((p: string, content: string) => {
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, content);
	});
	let created = 0;
	let updated = 0;
	let skipped = 0;
	for (const w of writes) {
		if (w.action === "skip") {
			skipped++;
			continue;
		}
		write(w.filePath, w.content);
		if (w.action === "create")
			created++;
		else
			updated++;
	}
	return { created, updated, skipped };
}
