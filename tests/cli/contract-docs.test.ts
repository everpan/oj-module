import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inlineRedocScript, runApiDocs } from "../../packages/cli/src/contract/run";

/**
 * R5：`ram api --docs`——聚合全部契约的 OpenAPI → redoc 渲染静态站。
 * uni-dev 形态落 `api/docs/index.html`；纯前端形态落 `docs/api/index.html`。
 * 202609032041：产物自包含——CDN 外链 redoc bundle 内联进 HTML（fetchJs 注入 stub，测试不落网）。
 */

/** 内联 loader stub：假装拉到了 redoc bundle */
const stubFetchJs = async (_url: string) => "/* redoc bundle stub */";

const tmpDirs: string[] = [];

function makeProject(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ram-docs-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, "api/src/order"), { recursive: true });
	writeFileSync(join(dir, "api/src/order/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";
export const getOrderDetail = defineApi({
	apiPrefix: "/order",
	route: "/item/{id}",
	params: z.object({ id: z.number() }),
	data: z.object({ id: z.number(), order_no: z.string() }),
	description: "订单详情",
});
`);
	return dir;
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("runApiDocs（R5 redoc 文档站）", () => {
	it("聚合契约 → redoc 产物含端点路径且自包含（uni-dev 落 api/docs/）", async () => {
		const cwd = makeProject();
		const out = await runApiDocs(cwd, { fetchJs: stubFetchJs });
		expect(out).toBe(join(cwd, "api/docs/index.html"));
		const html = readFileSync(out, "utf8");
		expect(html).toContain("/order/item/{id}");
		// S2：无 CDN 外链，bundle 已内联
		expect(html).not.toContain("cdn.redocly.com");
		expect(html).toContain("/* redoc bundle stub */");
		// 聚合 spec 同时落盘（评审可直读 yaml）
		expect(readFileSync(join(cwd, "api/docs/openapi.yaml"), "utf8")).toContain("openapi: 3.1.0");
	}, 120_000);

	it("纯前端形态（无 api/src）→ 落 docs/api/", async () => {
		const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ram-docs-fe-"));
		tmpDirs.push(dir);
		mkdirSync(join(dir, "modules/src/demo/api"), { recursive: true });
		writeFileSync(join(dir, "modules/src/demo/api/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";
export const getDashboard = defineApi({
	apiPrefix: "/demo",
	route: "/dashboard",
	data: z.object({ visitors: z.number() }),
});
`);
		const out = await runApiDocs(dir, { fetchJs: stubFetchJs });
		expect(out).toBe(join(dir, "docs/api/index.html"));
		expect(existsSync(out)).toBe(true);
	}, 120_000);

	it("多契约聚合一页：两份契约端点同现于单个 index.html", async () => {
		const cwd = makeProject();
		mkdirSync(join(cwd, "api/src/stock"), { recursive: true });
		writeFileSync(join(cwd, "api/src/stock/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";
export const getStock = defineApi({
	apiPrefix: "/stock",
	route: "/list",
	data: z.object({ total: z.number() }),
	description: "库存列表",
});
`);
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
