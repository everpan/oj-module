import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkApi } from "../../packages/cli/src/contract/check";
import { runApi } from "../../packages/cli/src/contract/run";
import { writeOpenapiJson } from "./_fixtures";

/**
 * AC-D10：`ojm api --check` 三重校验——
 * ①生成物同步（内存重生成 vs 磁盘逐字节 diff）
 * ②route 双向对账（AST 扫 oj api.ts：default 导出方法名 + 语句起始 .route 赋值）
 * ③routes.js diff（release 路由表，dist/api 下各模块的 routes.js，vs openapi.json 契约路由表）
 *
 * 翻译层退役后，事实源即 openapi.json（oj v0.1.73 产物）。
 */

const tmpDirs: string[] = [];

function makeProject(withContract = true): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-check-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, "api/src/order"), { recursive: true });
	if (withContract) {
		writeOpenapiJson(dir, [
			{ module: "order", route: "/list", method: "GET", data: { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } }, total: { type: "number" } }, required: ["list", "total"] } },
			{ module: "order", route: "/item/{id}", method: "GET", params: { id: { type: "number" } }, data: { type: "object", properties: { id: { type: "number" }, order_no: { type: "string" } }, required: ["id", "order_no"] } },
		]);
	}
	return dir;
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

/**
 * ④WS 路由鉴权对账（oj 0.1.30 起 WS 握手过 oj-auth 守卫）：
 * 目录内 `ws.ts` 产生 `GET {base}/<模块>/<路径>/ws`，不在 auth.anonymous_paths
 * 里的 WS，未带凭据的客户端会握手 401——这是「文件在却连不上」最常见的成因。
 */
describe("checkApi ④WS 路由鉴权对账", () => {
	it("ws.ts 不在匿名列表 → warn 提示加 anonymous_paths", async () => {
		const cwd = makeProject();
		mkdirSync(join(cwd, "api/src/news/chat"), { recursive: true });
		writeFileSync(join(cwd, "api/src/news/chat/ws.ts"), "export default { message() { ws.send(\"pong\"); } };\n");
		writeFileSync(join(cwd, "api/config.yaml"), "server:\n  port: 9778\nauth:\n  anonymous_paths:\n    - /auth/login\n");

		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "warn", kind: "ws-anonymous-missing" }),
		]));
		expect(violations.find(v => v.kind === "ws-anonymous-missing")!.message).toContain("/news/chat/ws");
	});

	it("ws.ts 已在匿名列表 → 无该告警", async () => {
		const cwd = makeProject();
		mkdirSync(join(cwd, "api/src/news/chat"), { recursive: true });
		writeFileSync(join(cwd, "api/src/news/chat/ws.ts"), "export default { message() { ws.send(\"pong\"); } };\n");
		writeFileSync(join(cwd, "api/config.yaml"), "server:\n  port: 9778\nauth:\n  anonymous_paths:\n    - /news/chat/ws\n");

		const { violations } = await checkApi({ cwd });
		expect(violations.filter(v => v.kind === "ws-anonymous-missing")).toEqual([]);
	});

	it("无 config.yaml → 不报（缺配置时不做无法判定的断言）", async () => {
		const cwd = makeProject();
		mkdirSync(join(cwd, "api/src/news"), { recursive: true });
		writeFileSync(join(cwd, "api/src/news/ws.ts"), "export default { message() {} };\n");

		const { violations } = await checkApi({ cwd });
		expect(violations.filter(v => v.kind === "ws-anonymous-missing")).toEqual([]);
	});
});

describe("checkApi（AC-D10 三重校验）", () => {
	it("全通过：ojm api 生成后 check 零违规", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual([]);
	});

	it("①生成物过期（磁盘被改）→ error artifact-stale", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		writeFileSync(join(cwd, "web/src/order/__client/api.ts"), "// 人改了生成物\n");
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "artifact-stale" }),
		]));
		expect(violations.find(v => v.kind === "artifact-stale")?.message).toContain("ojm api");
	});

	it("②契约端点无 handler → warn 未实现；handler 未登记契约 → error", async () => {
		const cwd = makeProject();
		// 只手写 item/api.ts（覆盖 getOrderDetail），list 端点无 handler → warn
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
function detail(): void {
	json.ok({ id: 1 });
}
detail.route = "{id}";
export default { get: detail };
`);
		// 手写一个契约外的 handler → error 未登记
		mkdirSync(join(cwd, "api/src/order/legacy"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/legacy/api.ts"), `
export default {
	post(): void {
		json.ok();
	},
};
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "warn", kind: "route-not-implemented" }),
			expect.objectContaining({ level: "error", kind: "route-unregistered" }),
		]));
		expect(violations.find(v => v.kind === "route-not-implemented")?.message).toContain("order/list");
		expect(violations.find(v => v.kind === "route-unregistered")?.message).toContain("legacy");
	});

	it("②模块根动词（契约 route \"/\" vs handler 全路径=模块名）→ 精确命中不误报", async () => {
		const cwd = makeProject(false);
		// 模块根单文件聚合形态（oj v0.1.64，教程 books 演练同款）：GET /api/books
		mkdirSync(join(cwd, "api/src/books"), { recursive: true });
		writeFileSync(join(cwd, "api/src/books/api.ts"), `
export default {
	get(): void { json.ok({ list: [], total: 0 }); },
	post(): void { json.ok({ ok: true }); },
};
`);
		writeOpenapiJson(cwd, [
			{ module: "books", route: "/", method: "GET", data: { type: "object", properties: { list: { type: "array", items: { type: "object" } }, total: { type: "number" } }, required: ["list", "total"] } },
			{ module: "books", route: "/", method: "POST", body: { type: "object", properties: { title: { type: "string" } }, required: ["title"] }, data: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } },
		]);
		const { violations } = await checkApi({ cwd });
		expect(violations.filter(v => v.kind === "route-params-mismatch" || v.kind === "route-not-implemented" || v.kind === "route-unregistered")).toEqual([]);
	});

	it("②参数段不一致（handler {name} vs 契约 {id}）→ error route-params-mismatch", async () => {
		const cwd = makeProject();
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
function get(): void {
	json.ok({ id: 1 });
}
get.route = "{name}";
export default { get };
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "route-params-mismatch" }),
		]));
		expect(violations.find(v => v.kind === "route-params-mismatch")?.message).toMatch(/\{name\}.*\{id\}|\{id\}.*\{name\}/);
	});

	it("③routes.js 与 openapi.json 契约路由不一致 → error routes-js-drift；无 dist → 提示先 oj build", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		// 无 dist：hints 提示，非违规
		const noDist = await checkApi({ cwd });
		expect(noDist.violations).toEqual([]);
		expect(noDist.hints.join("\n")).toContain("oj build");
		// dist routes.js 缺 getOrderDetail → drift
		mkdirSync(join(cwd, "dist/api/order-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "dist/api/order-0.1.0/routes.js"), `// 由 oj build 生成；勿手改。
export default [
  { method: "get", pattern: "order/list", file: "list/api.js" },
];
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "routes-js-drift" }),
		]));
	});

	it("③模块根路径尾斜杠不误报（契约 fullPath 带 / vs dist pattern 不带）", async () => {
		// 复现：notifications 模块 GET / → stripBase 的 `rel || "/"` 使 fullPath 为
		// "/notifications/"，而 oj 的 routes.js pattern 为 "notifications"——直接比键必误报
		const cwd = makeProject();
		writeOpenapiJson(cwd, [
			{ module: "notifications", route: "/", method: "GET", data: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } },
			{ module: "order", route: "/list", method: "GET", data: { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { id: { type: "number" } } } } } } },
		]);
		await runApi({ cwd });
		mkdirSync(join(cwd, "dist/api/notifications-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "dist/api/notifications-0.1.0/routes.js"), `export default [
  { method: "get", pattern: "notifications", file: "api.js" },
];
`);
		mkdirSync(join(cwd, "dist/api/order-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "dist/api/order-0.1.0/routes.js"), `export default [
  { method: "get", pattern: "order/list", file: "list/api.js" },
];
`);
		const { violations } = await checkApi({ cwd });
		expect(violations.filter(v => v.kind === "routes-js-drift")).toEqual([]);
	});

	it("③豁免模块的 dist 缺行不报（豁免对「dist 缺」与「dist 多」对称生效）", async () => {
		const cwd = makeProject();
		writeOpenapiJson(cwd, [
			{ module: "order", route: "/list", method: "GET", data: { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { id: { type: "number" } } } } } } },
			{ module: "notifications", route: "/", method: "GET", data: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } },
		]);
		await runApi({ cwd });
		// 豁免清单含 notifications 整模块
		writeFileSync(join(cwd, "api/.ojm-api-exempt.json"), JSON.stringify({ modules: ["notifications"], paths: [] }));
		// dist 只有 order——notifications 缺行但被豁免，不报
		mkdirSync(join(cwd, "dist/api/order-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "dist/api/order-0.1.0/routes.js"), `export default [
  { method: "get", pattern: "order/list", file: "list/api.js" },
];
`);
		const { violations } = await checkApi({ cwd });
		expect(violations.filter(v => v.kind === "routes-js-drift")).toEqual([]);
	});

	it("③routes.js 的短方法名 del 归一为 DELETE（DELETE 端点不误报 drift）", async () => {
		const cwd = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-check-del-"));
		tmpDirs.push(cwd);
		mkdirSync(join(cwd, "api/src/order"), { recursive: true });
		writeOpenapiJson(cwd, [
			{ module: "order", route: "/item/{id}", method: "DELETE", params: { id: { type: "number" } } },
		]);
		await runApi({ cwd });
		mkdirSync(join(cwd, "dist/api/order-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "dist/api/order-0.1.0/routes.js"), `// 由 oj build 生成；勿手改。
export default [
  { method: "del", pattern: "order/item/{id}", file: "item/api.js" },
];
`);
		const { violations } = await checkApi({ cwd });
		expect(violations.find(v => v.kind === "routes-js-drift")).toBeUndefined();
	});

	it("stub 缺失 → error artifact-stale（缺失同样算过期，不再静默放过）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		rmSync(join(cwd, "api/src/order/list/api.ts"), { force: true });
		rmSync(join(cwd, "api/src/order/item/api.ts"), { force: true });
		const { violations } = await checkApi({ cwd });
		const stale = violations.filter(v => v.kind === "artifact-stale");
		expect(stale.some(v => v.level === "error" && v.message.includes("stub 缺失"))).toBe(true);
	});

	it("pOST + 响应端点：生成 + stub 落盘后 --check 零违规", async () => {
		const cwd = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-check-form-"));
		tmpDirs.push(cwd);
		mkdirSync(join(cwd, "api/src/personal-center"), { recursive: true });
		writeOpenapiJson(cwd, [
			{
				module: "personal-center",
				route: "/upload",
				method: "POST",
				body: { type: "object", properties: { note: { type: "string" } }, required: [] },
				data: { type: "string" },
			},
		]);
		await runApi({ cwd });
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual([]);
	});

	it("契约变更 → stub 过期报 error artifact-stale（锁住 update 报错分支）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		// 契约加字段：client/routes/openapi 与 stub 示例值都会变，stub 必须也在报错之列
		writeOpenapiJson(cwd, [
			{ module: "order", route: "/list", method: "GET", data: { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } }, total: { type: "number" }, page: { type: "number" } }, required: ["list", "total", "page"] } },
			{ module: "order", route: "/item/{id}", method: "GET", params: { id: { type: "number" } }, data: { type: "object", properties: { id: { type: "number" }, order_no: { type: "string" } }, required: ["id", "order_no"] } },
		]);
		const { violations } = await checkApi({ cwd });
		expect(violations.some(v => v.kind === "artifact-stale" && v.message.includes("stub 待随契约更新"))).toBe(true);
	});
});
