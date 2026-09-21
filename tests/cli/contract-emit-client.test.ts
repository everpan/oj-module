import type { ScopedRequestLike } from "@oj-module/runtime/contract";
import type { Plugin } from "esbuild";
import type { ResponsePromiseLike } from "../../packages/runtime/contract/scoped-request-like";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { emitClient } from "../../packages/cli/src/contract/emit-client";
import { buildIr } from "../../packages/cli/src/contract/ir";
import { defineApi, z } from "../../packages/runtime/contract";

/**
 * AC-D5/D6/D8/D15：api.ts + api.schemas.ts 发射器。
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

/** 测试替身：把 "@oj-module/runtime" 替换为仅导出 z 的桩（生产上由 runtime re-export，Task 4.1） */
const runtimeStub: Plugin = {
	name: "runtime-stub",
	setup(b) {
		b.onResolve({ filter: /^@oj-module\/runtime$/ }, () => ({ path: "runtime-stub", namespace: "ojm-stub" }));
		b.onLoad({ filter: /.*/, namespace: "ojm-stub" }, () => ({
			contents: "export { z } from \"zod\";",
			resolveDir: join(repoRoot, "packages/runtime"), // 根 package.json 无 zod 直依，从 runtime 包（contract 所在包）解析
		}));
	},
};

/** 生成物落盘到 repo 内临时目录（node_modules/.cache 下，保证 workspace 依赖可解析）→ bundle → import */
async function bundleClient(files: Record<string, string>, dev: boolean) {
	const dir = mkdtempSync(join(repoRoot, "node_modules/.cache/ojm-client-test-"));
	writeFileSync(join(dir, "api.ts"), files["api.ts"]);
	writeFileSync(join(dir, "api.schemas.ts"), files["api.schemas.ts"]);
	const outdir = join(dir, "out");
	await build({
		entryPoints: [join(dir, "api.ts")],
		bundle: true,
		format: "esm",
		splitting: true,
		outdir,
		define: { "import.meta.env.DEV": dev ? "true" : "false" },
		plugins: [runtimeStub],
		logLevel: "silent",
	});
	const mod = await import(pathToFileURL(join(outdir, "api.js")).href);
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
		const files = emitClient(ir, { target: "module", module: "order" });
		expect(files["api.ts"]).toMatchSnapshot();
		expect(files["api.schemas.ts"]).toMatchSnapshot();
	});

	it("internal 目标：无 bindRequest，直接绑 #src/utils/request", () => {
		const files = emitClient(ir, { target: "internal" });
		expect(files["api.ts"]).not.toContain("bindRequest");
		expect(files["api.ts"]).toContain("import { request } from \"#src/utils/request\"");
	});

	it("internal 目标：z 直取 zod（runtime 树内自引包名成环）；module 目标走 runtime re-export", () => {
		const internal = emitClient(ir, { target: "internal" });
		expect(internal["api.ts"]).toContain("from \"zod\"");
		expect(internal["api.schemas.ts"]).toContain("import { z } from \"zod\"");
		const module_ = emitClient(ir, { target: "module", module: "order" });
		expect(module_["api.ts"]).toContain("from \"@oj-module/runtime\"");
		expect(module_["api.schemas.ts"]).toContain("import { z } from \"@oj-module/runtime\"");
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
		const files = emitClient(withFlag, { target: "module", module: "order" });
		expect(files["api.ts"]).toContain("{ ignoreLoading: true }");
	});

	it("未 bindRequest 即调用 → 人话报错指路 entry.ts onInit", async () => {
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), true);
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
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), true);
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
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), true);
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
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), true);
		mod.bindRequest(req);
		const err = await mod.getOrderDetail({ id: 404 }).catch((e: unknown) => e);
		expect(err).toMatchObject({ name: "ContractApiError", code: 1001, msg: "订单不存在" });
	});

	it("评审 F13：2xx 但信封 code!==0 → 同样归一 ContractApiError（防漂移）", async () => {
		const { req } = stubRequest(() => ({ code: 500, msg: "静默业务错误", data: { id: 7, order_no: "A7" } }));
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), true);
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
			// form 端点的生成物也须过 tsc：FormData 组装 + body: FormData 依赖
			// ScopedRequestLike 的 body 槽（runtime dist 声明）
			uploadAvatar: defineApi({
				apiPrefix: "/order",
				route: "/upload",
				method: "POST",
				form: {
					fields: z.object({ note: z.string().optional() }),
					files: [{ name: "avatar", required: true }, { name: "gallery", multiple: true }],
				},
				data: z.object({ url: z.string() }),
			}),
		});
		const files = emitClient(ir2, { target: "module", module: "order" });
		// F7 形态断言：raw 端点的 params 槽保留在 schemas（client 类型引用不断链）
		expect(files["api.schemas.ts"]).toContain("downloadFile");
		expect(files["api.schemas.ts"]).not.toContain("downloadFile: {\n\t\tdata");

		const dir = mkdtempSync(join(repoRoot, "node_modules/.cache/ojm-tsc-test-"));
		writeFileSync(join(dir, "api.ts"), files["api.ts"]);
		writeFileSync(join(dir, "api.schemas.ts"), files["api.schemas.ts"]);
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
					"@oj-module/runtime": [join(repoRoot, "packages/runtime/dist/index.d.ts")],
				},
			},
			include: ["api.ts", "api.schemas.ts", "typings.d.ts"],
		}));
		const tscPkg = createRequire(join(repoRoot, "packages/cli/index.js")).resolve("typescript/package.json");
		const tscBin = join(tscPkg, "..", "bin", "tsc");
		// 生成物类型级兜底：codegen 形态变更若产不可编译代码，此处先红
		execFileSync(process.execPath, [tscBin, "-p", dir], { stdio: "pipe" });
	}, 60_000);

	it("raw 端点：不解包不校验，原样返回 Response；catch-all 逐段编码", async () => {
		const { req, calls } = stubRequest(() => new Response("bin"));
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), true);
		mod.bindRequest(req);
		const res = await mod.downloadFile({ path: "a/b c.png" });
		expect(res).toBeInstanceOf(Response);
		expect(await res.text()).toBe("bin");
		expect(calls[0].url).toBe("order/file/a/b%20c.png");
	});

	it("生产构建（DEV=false）：zod 与 api.schemas 被摇出产物（AC-D15）", async () => {
		const { outdir } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), false);
		const outFiles = readdirSync(outdir).filter(f => f.endsWith(".js"));
		expect(outFiles).toEqual(["api.js"]);
		const code = readFileSync(join(outdir, "api.js"), "utf8");
		expect(code).not.toContain("api.schemas");
		expect(code).not.toContain("_zod");
	});
});

/**
 * multipart/form-data 契约（与上面的 JSON 契约分开建模）：JSON 生成物必须逐字节不变，
 * 故 form 用例一律独立 IR + 独立快照，不污染既有快照。
 */
const formIr = buildIr({
	uploadAvatar: defineApi({
		apiPrefix: "/personal-center",
		route: "/upload",
		method: "POST",
		form: {
			fields: z.object({ kind: z.enum(["photo", "doc"]), note: z.string().optional() }),
			files: [{ name: "avatar", required: true }, { name: "gallery", multiple: true }],
		},
		data: z.string(),
		description: "上传头像/附件，返回资源 URL",
	}),
	uploadInFolder: defineApi({
		apiPrefix: "/personal-center",
		route: "/folder/{id}/upload",
		method: "PUT",
		params: z.object({ id: z.number() }),
		form: { files: [{ name: "file", required: true }] },
		data: z.string(),
	}),
});

describe("emitClient：multipart/form-data（form 槽）", () => {
	it("快照：Form 类型 + FormData 组装函数 + body 走 FormData（无 json / 不设 content-type）", () => {
		const files = emitClient(formIr, { target: "module", module: "personal-center" });
		expect(files["api.ts"]).toMatchSnapshot();
		expect(files["api.schemas.ts"]).toMatchSnapshot();
	});

	it("形态：文本部件走 schemas 的 form 槽；文件部件只有 File/Blob（binary 不进 zod/schemas）", () => {
		const files = emitClient(formIr, { target: "module", module: "personal-center" });
		const api = files["api.ts"];
		// 单槽直接传 form 对象（{ fields, files }），多槽打包 input.form
		expect(api).toContain("export type UploadAvatarForm = {");
		expect(api).toContain("files: { avatar: File | Blob, gallery?: Array<File | Blob> }");
		expect(api).toContain("body: buildUploadAvatarForm(form)");
		expect(api).toContain("body: buildUploadInFolderForm(input.form)");
		expect(api).not.toContain("json:");
		// content-type 由运行时（ky 见 FormData 自补 boundary）——生成物不得插手
		expect(api).not.toContain("content-type");
		expect(api).not.toContain("Content-Type");
		// 纯文件 form：无 fields → 无 form 槽 schema，但类型仍在（files 只按名字声明）
		expect(files["api.schemas.ts"]).toContain("form: z.object({");
		expect(files["api.schemas.ts"]).not.toContain("avatar");
		expect(files["api.schemas.ts"]).not.toContain("gallery");
	});

	it("行为：组装 FormData——文本部件 String 化、可选缺省不 append、multiple 逐项 append", async () => {
		const { req, calls } = stubRequest(() => ok("https://cdn.example.com/a.png"));
		const { mod } = await bundleClient(emitClient(formIr, { target: "module", module: "personal-center" }), true);
		mod.bindRequest(req);

		const data = await mod.uploadAvatar({
			fields: { kind: "photo" },
			files: { avatar: new File(["bytes"], "a.png", { type: "image/png" }) },
		});
		expect(data).toBe("https://cdn.example.com/a.png");
		expect(calls[0]).toMatchObject({ method: "post", url: "personal-center/upload" });
		const options = calls[0].options!;
		expect(options.body).toBeInstanceOf(FormData);
		expect(options.json).toBeUndefined();
		// 不设 headers/content-type（否则 boundary 写死会破坏 multipart）
		expect(options).not.toHaveProperty("headers");
		const fd = options.body as FormData;
		expect(fd.get("kind")).toBe("photo");
		expect(fd.has("note")).toBe(false);
		expect((fd.get("avatar") as File).name).toBe("a.png");

		await mod.uploadAvatar({
			fields: { kind: "doc", note: "合同扫描件" },
			files: { avatar: new File(["x"], "b.png"), gallery: [new File(["1"], "1.png"), new File(["2"], "2.png")] },
		});
		const fd2 = calls[1].options!.body as FormData;
		expect(fd2.get("kind")).toBe("doc");
		expect(fd2.get("note")).toBe("合同扫描件");
		expect(fd2.getAll("gallery").map(f => (f as File).name)).toEqual(["1.png", "2.png"]);

		// params + form 双槽：URL 插值照旧，请求体仍是 FormData
		await mod.uploadInFolder({ params: { id: 7 }, form: { files: { file: new File(["z"], "z.bin") } } });
		expect(calls[2].url).toBe("personal-center/folder/7/upload");
		expect(calls[2].options!.body).toBeInstanceOf(FormData);
	});

	it("行为：非标量文本部件走 JSON.stringify（不得静默变 [object Object]）", async () => {
		const ir = buildIr({
			save: defineApi({
				apiPrefix: "/personal-center",
				route: "/save",
				method: "POST",
				form: { fields: z.object({ meta: z.object({ a: z.number() }), tags: z.array(z.string()) }) },
				data: z.string(),
			}),
		});
		const { req, calls } = stubRequest(() => ok("ok"));
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "personal-center" }), true);
		mod.bindRequest(req);
		await mod.save({ fields: { meta: { a: 1 }, tags: ["x", "y"] } });
		const fd = calls[0].options!.body as FormData;
		expect(fd.get("meta")).toBe("{\"a\":1}");
		expect(fd.get("tags")).toBe("[\"x\",\"y\"]");
	});

	it("form 与 data 并存：响应仍解包信封并做 DEV 校验", async () => {
		const { req } = stubRequest(() => ok({ url: 42 }));
		const { mod } = await bundleClient(emitClient(formIr, { target: "module", module: "personal-center" }), true);
		mod.bindRequest(req);
		// uploadAvatar.data = z.string()，返回对象 → DEV 校验应报契约违例
		const err = await mod.uploadAvatar({ fields: { kind: "photo" }, files: { avatar: new File(["x"], "x.png") } })
			.catch((e: unknown) => e);
		expect(err).toMatchObject({ name: "ContractApiError", code: -1 });
		expect((err as Error).message).toMatch(/契约违例.*uploadAvatar/s);
	});
});

describe("工厂（create<Module>Client，构造即 install，BDD §4）", () => {
	it("5.1#1 module 目标：生成 API_PREFIX 常量 + createOrderClient 工厂（登记前缀 + 绑定 request + 返回端点函数）", () => {
		const files = emitClient(ir, { target: "module", module: "order" });
		expect(files["api.ts"]).toContain("export const API_PREFIX = \"/order\";");
		expect(files["api.ts"]).toContain("export function createOrderClient(ctx: ModuleContext)");
		// 工厂体内：登记前缀（唯一真源常量）+ 绑定 scoped request
		expect(files["api.ts"]).toContain("ctx.register.apiPrefix(API_PREFIX);");
		expect(files["api.ts"]).toContain("bindRequest(ctx.utils.request);");
		// 返回对象覆盖全部端点函数
		for (const name of ["getOrderList", "getOrderDetail", "createOrder", "updateOrder", "downloadFile"])
			expect(files["api.ts"]).toContain(name);
	});

	it("5.2#2 连字符模块名 camelize：personal-center → createPersonalCenterClient", () => {
		// D-M8：线上前缀以契约为真源——契约 apiPrefix 与模块名一致时生成物形态不变
		const pc = buildIr({
			listCenterFeed: defineApi({ apiPrefix: "/personal-center", route: "/feed" }),
		});
		const files = emitClient(pc, { target: "module", module: "personal-center" });
		expect(files["api.ts"]).toContain("export const API_PREFIX = \"/personal-center\";");
		expect(files["api.ts"]).toContain("export function createPersonalCenterClient(ctx: ModuleContext)");
	});

	it("5.3#3 bindRequest 保留导出且标 @deprecated（指路工厂）", () => {
		const files = emitClient(ir, { target: "module", module: "order" });
		expect(files["api.ts"]).toContain("@deprecated");
		expect(files["api.ts"]).toMatch(/export function bindRequest\(/);
	});

	it("5.4#4 internal 目标：不含 API_PREFIX 与工厂（无 ctx 可收，形状不变）", () => {
		const files = emitClient(ir, { target: "internal" });
		expect(files["api.ts"]).not.toContain("API_PREFIX");
		expect(files["api.ts"]).not.toContain("createOrderClient");
	});

	it("5.5#5 行为：工厂构造即接线——apiPrefix 已登记、端点经 factory 调用打到 stub", async () => {
		const { req, calls } = stubRequest(() => ok({ list: [], total: 0 }));
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), true);
		const registeredPrefixes: string[] = [];
		const ctx = {
			module: { name: "order", version: "0.0.0" },
			register: { apiPrefix: (p: string) => { registeredPrefixes.push(p); } },
			utils: { request: req },
		};
		const client = mod.createOrderClient(ctx);
		expect(registeredPrefixes).toEqual(["/order"]);
		const data = await client.getOrderList({ page: 1, size: 10 });
		expect(data).toEqual({ list: [], total: 0 });
		expect(calls[0].url).toBe("order/list");
		expect(calls[0].options?.searchParams).toEqual({ page: 1, size: 10 });
	});

	it("5.6#6 module 目标缺模块名 → 发射期人话报错（R1 防漏传）", () => {
		expect(() => emitClient(ir, { target: "module" } as never)).toThrow(/模块名/);
	});

	it("5.7#7 跨模块认领护栏：DEV 下 ctx.module.name 与 API_PREFIX 不符 → console.warn 指路；名实相符不警告", async () => {
		const { req } = stubRequest(() => ok({ list: [], total: 0 }));
		const { mod } = await bundleClient(emitClient(ir, { target: "module", module: "order" }), true);
		const warn = vi.fn();
		const original = console.warn;
		console.warn = warn;
		try {
			// 模块名与契约前缀不符 = 跨模块认领（共享 request 单槽、卸载互相耦合）
			mod.createOrderClient({
				module: { name: "other", version: "0.0.1" },
				register: { apiPrefix: () => {} },
				utils: { request: req },
			});
			expect(warn).toHaveBeenCalledOnce();
			expect(warn.mock.calls[0]![0]).toContain("\"other\"");
			expect(warn.mock.calls[0]![0]).toContain("/order");
			// 名实相符（本模块自己创建）→ 不警告
			warn.mockClear();
			mod.createOrderClient({
				module: { name: "order", version: "0.0.1" },
				register: { apiPrefix: () => {} },
				utils: { request: req },
			});
			expect(warn).not.toHaveBeenCalled();
		}
		finally {
			console.warn = original;
		}
	});
});
