import { describe, expect, it } from "vitest";
import { emitClient } from "../../packages/cli/src/contract/emit-client";
import { wirePrefixOf } from "../../packages/cli/src/contract/ir";
import { mkEp } from "./_fixtures";

/**
 * D-M8 前缀映射（M0 spike）：线上 URL 前缀 ≠ 目录名时，契约以 urlPrefix 显式
 * 声明线上前缀；认领/护栏仍按目录名（apiPrefix）。生成 client 的请求基址与
 * URL 模板取 urlPrefix ?? apiPrefix（wirePrefixOf），对账键不变（dir+tail）。
 *
 * 翻译层退役后，IR 由 JSON Schema 构造（mkEp）；emitClient 消费 urlPrefix/apiPrefix
 * 的口径不变。route 对账（--check）的 openapi.json 形态由 src/contract/__tests__ 覆盖。
 */
describe("urlPrefix 前缀映射（D-M8）", () => {
	it("wirePrefixOf：urlPrefix 缺省回落 apiPrefix，声明时取 urlPrefix", () => {
		expect(wirePrefixOf({ apiPrefix: "/workitems" })).toBe("/workitems");
		expect(wirePrefixOf({ apiPrefix: "/workitems", urlPrefix: "/workspaces" })).toBe("/workspaces");
	});

	it("mkEp：fullPath = urlPrefix + route（映射生效）", () => {
		const ep = mkEp({ name: "listProjectIssues", apiPrefix: "/workitems", urlPrefix: "/workspaces", route: "/{slug}/projects/{project_id}/issues" });
		expect(ep.fullPath).toBe("/workspaces/{slug}/projects/{project_id}/issues");
		expect(wirePrefixOf(ep)).toBe("/workspaces");
	});

	it("mkEp：无 urlPrefix 时 fullPath 行为不变（回归）", () => {
		const ep = mkEp({ name: "getOrderList", apiPrefix: "/order", route: "/list" });
		expect(ep.fullPath).toBe("/order/list");
	});

	it("emitClient：模块目标 API_PREFIX 取线上前缀，MODULE_PREFIX 保留认领身份", () => {
		const ir = [mkEp({
			name: "listProjectIssues",
			apiPrefix: "/workitems",
			urlPrefix: "/workspaces",
			route: "/{slug}/projects/{project_id}/issues",
			data: { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } }, required: ["list"] },
		})];
		const { "api.ts": api } = emitClient(ir, { target: "module", module: "workitems" });
		expect(api).toContain("export const API_PREFIX = \"/workspaces\"");
		expect(api).toContain("export const MODULE_PREFIX = \"/workitems\"");
		expect(api).toContain("ctx.register.apiPrefix(API_PREFIX)");
		expect(api).toContain("ctx.module.name !== MODULE_PREFIX.slice(1)");
		// URL 模板自带线上命名空间（scoped request 只护栏不拼前缀）；目录名不得漏进 URL
		expect(api).toContain("client.get(`workspaces/");
		expect(api).not.toContain("workitems/");
	});

	it("emitClient：无 urlPrefix 时两前缀同值（既有工程零漂移）", () => {
		const ir = [mkEp({ name: "getOrderList", apiPrefix: "/order", route: "/list", data: { type: "object", properties: {}, required: [] } })];
		const { "api.ts": api } = emitClient(ir, { target: "module", module: "order" });
		expect(api).toContain("export const API_PREFIX = \"/order\"");
		expect(api).toContain("export const MODULE_PREFIX = \"/order\"");
	});

	it("emitClient：同模块混用不同线上前缀 → 报错（register.apiPrefix 一模块一值）", () => {
		const ir = [
			mkEp({ name: "a", apiPrefix: "/workitems", urlPrefix: "/workspaces", route: "/x", data: { type: "object", properties: {}, required: [] } }),
			mkEp({ name: "b", apiPrefix: "/workitems", urlPrefix: "/other", route: "/y", data: { type: "object", properties: {}, required: [] } }),
		];
		expect(() => emitClient(ir, { target: "module", module: "workitems" }))
			.toThrowError(/线上前缀不一致/);
	});
});
