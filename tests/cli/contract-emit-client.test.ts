import type { ScopedRequestLike } from "@react-antd-module/runtime/contract";
import type { Plugin } from "esbuild";
import type { ResponsePromiseLike } from "../../packages/runtime/contract/scoped-request-like";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { emitClient } from "../../packages/cli/src/contract/emit-client";
import { buildIr } from "../../packages/cli/src/contract/ir";
import { defineApi, z } from "../../packages/runtime/contract";

/**
 * AC-D5/D6/D8/D15：client.ts + client.schemas.ts 发射器。
 * 快照锁定生成物形态；行为测试把生成文本落盘 → esbuild bundle → 真实 import
 * 跑在 stub ScopedRequestLike 上，断言 URL 插值 / query / body / 信封解包 /
 * 业务错误归一 ContractApiError / DEV 校验 / raw 通道 / 产物 zod 排除。
 */

const repoRoot = process.cwd();

const ir = buildIr({
	getOrderList: defineApi({
		apiPrefix: "/order",
		route: "/list",
		query: z.object({ page: z.number().int().min(1), size: z.number().int().optional() }),
		data: z.object({ list: z.array(z.object({ id: z.number(), order_no: z.string() })), total: z.number() }),
		description: "订单列表",
	}),
	getOrderDetail: defineApi({
		apiPrefix: "/order",
		route: "/item/{id}",
		params: z.object({ id: z.number() }),
		data: z.object({ id: z.number(), order_no: z.string() }),
	}),
	createOrder: defineApi({
		apiPrefix: "/order",
		route: "/item",
		method: "POST",
		body: z.object({ order_no: z.string().min(1) }),
		data: z.object({ id: z.number() }),
	}),
	updateOrder: defineApi({
		apiPrefix: "/order",
		route: "/item/{id}",
		method: "PUT",
		params: z.object({ id: z.number() }),
		body: z.object({ order_no: z.string().optional() }),
		data: z.object({ id: z.number() }),
	}),
	downloadFile: defineApi({
		apiPrefix: "/order",
		route: "/file/{*path}",
		response: "raw",
	}),
});

/** 测试替身：把 "@react-antd-module/runtime" 替换为仅导出 z 的桩（生产上由 runtime re-export，Task 4.1） */
const runtimeStub: Plugin = {
	name: "runtime-stub",
	setup(b) {
		b.onResolve({ filter: /^@react-antd-module\/runtime$/ }, () => ({ path: "runtime-stub", namespace: "ram-stub" }));
		b.onLoad({ filter: /.*/, namespace: "ram-stub" }, () => ({
			contents: "export { z } from \"zod\";",
			resolveDir: join(repoRoot, "packages/runtime"), // 根 package.json 无 zod 直依，从 runtime 包（contract 所在包）解析
		}));
	},
};

/** 生成物落盘到 repo 内临时目录（node_modules/.cache 下，保证 workspace 依赖可解析）→ bundle → import */
async function bundleClient(files: Record<string, string>, dev: boolean) {
	const dir = mkdtempSync(join(repoRoot, "node_modules/.cache/ram-client-test-"));
	writeFileSync(join(dir, "client.ts"), files["client.ts"]);
	writeFileSync(join(dir, "client.schemas.ts"), files["client.schemas.ts"]);
	const outdir = join(dir, "out");
	await build({
		entryPoints: [join(dir, "client.ts")],
		bundle: true,
		format: "esm",
		splitting: true,
		outdir,
		define: { "import.meta.env.DEV": dev ? "true" : "false" },
		plugins: [runtimeStub],
		logLevel: "silent",
	});
	const mod = await import(pathToFileURL(join(outdir, "client.js")).href);
	return { mod, outdir };
}

interface Call { method: string, url: string, options?: Record<string, unknown> }

/** stub ScopedRequestLike：记录调用，handler 返回信封对象或 Response，抛错模拟 ky HTTPError */
function stubRequest(handler: (call: Call) => unknown) {
	const calls: Call[] = [];
	const make = (method: string) => (url: string, options?: Record<string, unknown>): ResponsePromiseLike => {
		const call = { method, url, options };
		calls.push(call);
		let value: unknown;
		try {
			value = handler(call);
		}
		catch (e) {
			const base = Promise.reject(e) as ResponsePromiseLike;
			base.catch(() => {}); // 生成物只 await .json()，抑制基 promise 的未处理拒绝
			base.json = () => Promise.reject(e);
			return base;
		}
		const res = value instanceof Response ? value : new Response(JSON.stringify(value));
		const p = Promise.resolve(res) as ResponsePromiseLike;
		p.json = <T>() => Promise.resolve(value as T);
		return p;
	};
	const req: ScopedRequestLike = {
		get: make("get"),
		post: make("post"),
		put: make("put"),
		delete: make("delete"),
		patch: make("patch"),
		head: make("head"),
	};
	return { req, calls };
}

const ok = (data: unknown) => ({ code: 0, msg: "ok", data });

describe("emitClient（AC-D5/D6/D8/D15）", () => {
	it("快照：module 目标双产物（bindRequest 持有者 + 类型推导 + DEV 校验 + raw 通道）", () => {
		const files = emitClient(ir, { target: "module" });
		expect(files["client.ts"]).toMatchSnapshot();
		expect(files["client.schemas.ts"]).toMatchSnapshot();
	});

	it("internal 目标：无 bindRequest，直接绑 #src/utils/request", () => {
		const files = emitClient(ir, { target: "internal" });
		expect(files["client.ts"]).not.toContain("bindRequest");
		expect(files["client.ts"]).toContain("import { request } from \"#src/utils/request\"");
	});

	it("internal 目标：z 直取 zod（runtime 树内自引包名成环）；module 目标走 runtime re-export", () => {
		const internal = emitClient(ir, { target: "internal" });
		expect(internal["client.ts"]).toContain("from \"zod\"");
		expect(internal["client.schemas.ts"]).toContain("import { z } from \"zod\"");
		const module_ = emitClient(ir, { target: "module" });
		expect(module_["client.ts"]).toContain("from \"@react-antd-module/runtime\"");
		expect(module_["client.schemas.ts"]).toContain("import { z } from \"@react-antd-module/runtime\"");
	});

	it("ignoreLoading 契约开关透传为请求 options", () => {
		const withFlag = buildIr({
			getSilent: defineApi({
				apiPrefix: "/order",
				route: "/silent",
				data: z.object({ ok: z.boolean() }),
				ignoreLoading: true,
			}),
		});
		const files = emitClient(withFlag, { target: "module" });
		expect(files["client.ts"]).toContain("{ ignoreLoading: true }");
	});

	it("未 bindRequest 即调用 → 人话报错指路 entry.ts onInit", async () => {
		const { mod } = await bundleClient(emitClient(ir, { target: "module" }), true);
		await expect(mod.getOrderList({ page: 1 })).rejects.toThrowError(/bindRequest/);
	});

	it("成功路径：URL 插值 / query→searchParams / body→json / 信封解包返回 data", async () => {
		const { req, calls } = stubRequest((call) => {
			if (call.url === "order/list")
				return ok({ list: [{ id: 1, order_no: "A1" }], total: 1 });
			if (call.url === "order/item/7")
				return ok({ id: 7, order_no: "A7" });
			if (call.url === "order/item")
				return ok({ id: 2 });
			throw new Error(`未预期调用: ${call.url}`);
		});
		const { mod } = await bundleClient(emitClient(ir, { target: "module" }), true);
		mod.bindRequest(req);

		const list = await mod.getOrderList({ page: 1 });
		expect(list).toEqual({ list: [{ id: 1, order_no: "A1" }], total: 1 });
		expect(calls[0]).toMatchObject({ method: "get", url: "order/list", options: { searchParams: { page: 1 } } });

		const detail = await mod.getOrderDetail({ id: 7 });
		expect(detail).toEqual({ id: 7, order_no: "A7" });

		await mod.createOrder({ order_no: "A2" });
		expect(calls[2]).toMatchObject({ method: "post", url: "order/item", options: { json: { order_no: "A2" } } });

		await mod.updateOrder({ params: { id: 7 }, body: { order_no: "A3" } });
		expect(calls[3]).toMatchObject({ method: "put", url: "order/item/7", options: { json: { order_no: "A3" } } });
	});

	it("dev 下响应违例 → ContractApiError(code=-1)，人话含端点名与字段路径", async () => {
		const { req } = stubRequest(() => ok({ id: "七", order_no: 7 }));
		const { mod } = await bundleClient(emitClient(ir, { target: "module" }), true);
		mod.bindRequest(req);
		const err = await mod.getOrderDetail({ id: 7 }).catch((e: unknown) => e);
		expect(err).toMatchObject({ name: "ContractApiError", code: -1 });
		expect((err as Error).message).toMatch(/契约违例.*getOrderDetail/s);
		expect((err as Error).message).toContain("id");
	});

	it("业务错误（信封 code!=0）→ ContractApiError(code, msg)", async () => {
		const { req } = stubRequest(() => {
			throw Object.assign(new Error("HTTP Error"), {
				response: new Response(JSON.stringify({ code: 1001, msg: "订单不存在" }), { status: 400 }),
			});
		});
		const { mod } = await bundleClient(emitClient(ir, { target: "module" }), true);
		mod.bindRequest(req);
		const err = await mod.getOrderDetail({ id: 404 }).catch((e: unknown) => e);
		expect(err).toMatchObject({ name: "ContractApiError", code: 1001, msg: "订单不存在" });
	});

	it("评审 F13：2xx 但信封 code!==0 → 同样归一 ContractApiError（防漂移）", async () => {
		const { req } = stubRequest(() => ({ code: 500, msg: "静默业务错误", data: { id: 7, order_no: "A7" } }));
		const { mod } = await bundleClient(emitClient(ir, { target: "module" }), true);
		mod.bindRequest(req);
		const err = await mod.getOrderDetail({ id: 7 }).catch((e: unknown) => e);
		expect(err).toMatchObject({ name: "ContractApiError", code: 500, msg: "静默业务错误" });
	});

	it("评审 F7/F25：raw+params 与 .default() 槽位的生成物过 tsc --noEmit", async () => {
		const ir2 = buildIr({
			downloadFile: defineApi({
				apiPrefix: "/order",
				route: "/file/{*path}",
				params: z.object({ path: z.string() }),
				response: "raw",
			}),
			getOrderList: defineApi({
				apiPrefix: "/order",
				route: "/list",
				query: z.object({ page: z.number().default(1) }),
				data: z.object({ total: z.number() }),
			}),
		});
		const files = emitClient(ir2, { target: "module" });
		// F7 形态断言：raw 端点的 params 槽保留在 schemas（client 类型引用不断链）
		expect(files["client.schemas.ts"]).toContain("downloadFile");
		expect(files["client.schemas.ts"]).not.toContain("downloadFile: {\n\t\tdata");

		const dir = mkdtempSync(join(repoRoot, "node_modules/.cache/ram-tsc-test-"));
		writeFileSync(join(dir, "client.ts"), files["client.ts"]);
		writeFileSync(join(dir, "client.schemas.ts"), files["client.schemas.ts"]);
		// 与 apps/playground/typings.d.ts 同款最小 ImportMeta.env 声明（模块工程无 vite 依赖的形态）
		writeFileSync(join(dir, "typings.d.ts"), "interface ImportMeta { readonly env: { readonly DEV: boolean } }\n");
		writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				module: "esnext",
				moduleResolution: "bundler",
				target: "esnext",
				skipLibCheck: true,
				allowImportingTsExtensions: true,
				types: [],
				// 仓根 node_modules 未链接 runtime（pnpm 只链接声明依赖）——paths 直指 dist 声明
				// （TS 6 已弃 baseUrl；paths 值用绝对路径免 baseUrl）
				paths: {
					"@react-antd-module/runtime": [join(repoRoot, "packages/runtime/dist/index.d.ts")],
				},
			},
			include: ["client.ts", "client.schemas.ts", "typings.d.ts"],
		}));
		const tscPkg = createRequire(join(repoRoot, "packages/cli/index.js")).resolve("typescript/package.json");
		const tscBin = join(tscPkg, "..", "bin", "tsc");
		// 生成物类型级兜底：codegen 形态变更若产不可编译代码，此处先红
		execFileSync(process.execPath, [tscBin, "-p", dir], { stdio: "pipe" });
	}, 60_000);

	it("raw 端点：不解包不校验，原样返回 Response；catch-all 逐段编码", async () => {
		const { req, calls } = stubRequest(() => new Response("bin"));
		const { mod } = await bundleClient(emitClient(ir, { target: "module" }), true);
		mod.bindRequest(req);
		const res = await mod.downloadFile({ path: "a/b c.png" });
		expect(res).toBeInstanceOf(Response);
		expect(await res.text()).toBe("bin");
		expect(calls[0].url).toBe("order/file/a/b%20c.png");
	});

	it("生产构建（DEV=false）：zod 与 client.schemas 被摇出产物（AC-D15）", async () => {
		const { outdir } = await bundleClient(emitClient(ir, { target: "module" }), false);
		const outFiles = readdirSync(outdir).filter(f => f.endsWith(".js"));
		expect(outFiles).toEqual(["client.js"]);
		const code = readFileSync(join(outdir, "client.js"), "utf8");
		expect(code).not.toContain("client.schemas");
		expect(code).not.toContain("_zod");
	});
});
