import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inlineRedocScript, runApiDocs } from "../../packages/cli/src/contract/run";
import { writeOpenapiJson } from "./_fixtures";

/**
 * R5：`ojm api --docs`——聚合 openapi.json（oj v0.1.71 产物）的 paths → redoc 渲染静态站。
 * uni-dev 形态落 `api/docs/index.html`；纯前端形态落 `docs/api/index.html`。
 * 202609032041：产物自包含——CDN 外链 redoc bundle 内联进 HTML（fetchJs 注入 stub，测试不落网）。
 *
 * 翻译层退役后，事实源即 openapi.json，不再消费旧 contract.ts。
 */

/** 内联 loader stub：假装拉到了 redoc bundle */
const stubFetchJs = async (_url: string) => "/* redoc bundle stub */";

const tmpDirs: string[] = [];

function makeProject(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-docs-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, "api/src/order"), { recursive: true });
	writeOpenapiJson(dir, [
		{ module: "order", route: "/item/{id}", method: "GET", params: { id: { type: "number" } }, data: { type: "object", properties: { id: { type: "number" }, order_no: { type: "string" } }, required: ["id", "order_no"] } },
	]);
	return dir;
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("runApiDocs（R5 redoc 文档站）", () => {
	it("聚合契约 → redoc 产物含端点路径且自包含（统一落 <root>/src/docs/<name>/api/）", async () => {
		const cwd = makeProject();
		const name = basename(cwd);
		const out = await runApiDocs(cwd, { fetchJs: stubFetchJs });
		expect(out).toBe(join(cwd, "src", "docs", name, "api/index.html"));
		const html = readFileSync(out, "utf8");
		expect(html).toContain("/order/item/{id}");
		// S2：无 CDN 外链，bundle 已内联
		expect(html).not.toContain("cdn.redocly.com");
		expect(html).toContain("/* redoc bundle stub */");
		// 聚合 spec 同时落盘（评审可直读 yaml）
		expect(readFileSync(join(cwd, "src", "docs", name, "api/openapi.yaml"), "utf8")).toContain("openapi: 3.1.0");
	}, 120_000);

	it("纯前端形态（无 api/src）→ 同样落 <root>/src/docs/<name>/api/", async () => {
		const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-docs-fe-"));
		tmpDirs.push(dir);
		writeOpenapiJson(dir, [
			{ module: "demo", route: "/dashboard", method: "GET", data: { type: "object", properties: { visitors: { type: "number" } }, required: ["visitors"] } },
		]);
		const name = basename(dir);
		const out = await runApiDocs(dir, { fetchJs: stubFetchJs });
		expect(out).toBe(join(dir, "src", "docs", name, "api/index.html"));
		expect(existsSync(out)).toBe(true);
	}, 120_000);

	it("修正B：module-root 布局 → 落 src/docs/<name>/api（树外，不参与模块枚举/路由扫描）", async () => {
		const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-docs-mr-"));
		tmpDirs.push(dir);
		// 构造 module-root：src/<name>/{api/manifest.yaml, web/entry.ts}
		const name = "wiki";
		mkdirSync(join(dir, "src", name, "api"), { recursive: true });
		mkdirSync(join(dir, "src", name, "web"), { recursive: true });
		writeFileSync(join(dir, "src", name, "api", "manifest.yaml"), "name: wiki\nversion: 0.1.0\n");
		writeFileSync(join(dir, "src", name, "web", "entry.ts"), "export default {}\n");
		writeOpenapiJson(dir, [
			{ module: name, route: "/space/{id}", method: "GET", data: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } },
		]);
		const out = await runApiDocs(dir, { fetchJs: stubFetchJs });
		// 单模块 → name 取该模块名
		expect(out).toBe(join(dir, "src", "docs", name, "api/index.html"));
		expect(existsSync(out)).toBe(true);
		// 落点在模块树外：顶层 src/docs 无 manifest.yaml，不进枚举
		expect(existsSync(join(dir, "src", "docs", name, "api", "openapi.yaml"))).toBe(true);
	}, 120_000);

	it("多契约聚合一页：两份契约端点同现于单个 index.html", async () => {
		const cwd = makeProject();
		writeOpenapiJson(cwd, [
			{ module: "order", route: "/item/{id}", method: "GET", params: { id: { type: "number" } }, data: { type: "object", properties: { id: { type: "number" }, order_no: { type: "string" } }, required: ["id", "order_no"] } },
			{ module: "stock", route: "/list", method: "GET", data: { type: "object", properties: { total: { type: "number" } }, required: ["total"] } },
		]);
		const out = await runApiDocs(cwd, { fetchJs: stubFetchJs });
		const html = readFileSync(out, "utf8");
		expect(html).toContain("/order/item/{id}");
		expect(html).toContain("/stock/list");
	}, 120_000);

	it("redoc CLI 缺失 → 人话报错提示安装", async () => {
		const cwd = makeProject();
		await expect(runApiDocs(cwd, { redocBin: "/nonexistent/redocly", fetchJs: stubFetchJs }))
			.rejects
			.toThrowError(/redoc|安装/);
	});

	it("bundle 拉取失败 → 人话报错，不留半成品（S3）", async () => {
		const cwd = makeProject();
		const failFetch = async (): Promise<string> => {
			throw new Error("network down");
		};
		await expect(runApiDocs(cwd, { fetchJs: failFetch }))
			.rejects
			.toThrowError(/内联|离线|网络/);
	}, 120_000);
});

describe("inlineRedocScript", () => {
	const html = "<head><script src=\"https://cdn.redocly.com/redoc/v2.5.3/bundles/redoc.standalone.js\" integrity=\"sha384-x\" crossorigin=\"anonymous\"></script></head>";

	it("外链 script 标签替换为内联 bundle（CDN）", async () => {
		const out = await inlineRedocScript(html, async () => "bundle-js();");
		expect(out).not.toContain("cdn.redocly.com");
		expect(out).toContain("<script>bundle-js();</script>");
	});

	it("bundle 中的 </script> 转义，不截断页面（S4）", async () => {
		const out = await inlineRedocScript(html, async () => "a = \"</script>\";");
		expect(out).toContain("<\\/script>");
		expect(out.match(/<\/script>/g)?.length).toBe(1); // 仅剩闭合自身那一个
	});

	it("无 CDN 标签 → 原样返回（幂等）", async () => {
		const plain = "<html><body>hi</body></html>";
		expect(await inlineRedocScript(plain, async () => "x")).toBe(plain);
	});

	it("bundle 含 $&/$1 等替换模式 → 按字面插入（replace 字符串替换陷阱）", async () => {
		const out = await inlineRedocScript(html, async () => "e.replace(/x/g,\"$&$1\")");
		expect(out.match(/cdn\.redocly\.com/g)?.length ?? 0).toBe(0);
		expect(out).toContain("e.replace(/x/g,\"$&$1\")");
	});
});
