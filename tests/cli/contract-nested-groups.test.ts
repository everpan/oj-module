import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkApi } from "../../packages/cli/src/contract/check";

/**
 * v0.1.64 跨仓同步：oj 嵌套 handler 组（非动词键 + 对象 = 子组；组级 `.route` 作
 * 整组默认前缀；动词自身 `.route` 优先；文件层 `.route` 同为默认前缀）在
 * `ojm api --check` 的 AST 对账里必须可见——否则嵌套端点被误报「未实现」、
 * 嵌套 handler 被误报「未登记」（ silent drop 的跨仓复刻）。
 */

const tmpDirs: string[] = [];

function makeProject(contract: string): string {
	return makeProjectIn("order", contract);
}

/** 契约落指定模块目录（AC-D9：apiPrefix 必须等于契约目录名） */
function makeProjectIn(module: string, contract: string): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-nest-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, `api/src/${module}`), { recursive: true });
	writeFileSync(join(dir, `api/src/${module}/contract.ts`), contract);
	return dir;
}

function routeViolations(violations: { kind: string }[]): { kind: string }[] {
	return violations.filter(v => v.kind.startsWith("route-"));
}

const ORDER_CONTRACT = `
import { defineApi, z } from "@oj-module/runtime/contract";

export const uploadAsset = defineApi({
	apiPrefix: "/order",
	route: "/item/upload",
	method: "POST",
	data: z.object({ ok: z.boolean() }),
});
`;

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("checkApi 嵌套 handler 组对账（oj v0.1.64）", () => {
	it("组 handler（无 .route）命中契约端点：不报未实现/未登记", async () => {
		const cwd = makeProject(ORDER_CONTRACT);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
const upload = {
	post: () => {
		json.ok({ ok: true });
	},
};
export default { upload };
`);
		const { violations } = await checkApi({ cwd });
		expect(routeViolations(violations)).toEqual([]);
	});

	it("组级 .route（绝对）作整组前缀：命中契约端点", async () => {
		const cwd = makeProjectIn("x", `
import { defineApi, z } from "@oj-module/runtime/contract";

export const anchorUpload = defineApi({
	apiPrefix: "/x",
	route: "/{anchor}/upload",
	method: "POST",
	params: z.object({ anchor: z.string() }),
	data: z.object({ ok: z.boolean() }),
});
`);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
const upload = {
	post: () => {
		json.ok({ ok: true });
	},
};
upload.route = "/x/{anchor}/upload";
export default { upload };
`);
		const { violations } = await checkApi({ cwd });
		expect(routeViolations(violations)).toEqual([]);
	});

	it("动词自身 .route 优先覆盖组前缀（相对形态）", async () => {
		const cwd = makeProject(`
import { defineApi, z } from "@oj-module/runtime/contract";

export const deepThing = defineApi({
	apiPrefix: "/order",
	route: "/item/sub/deep/thing",
	method: "POST",
	data: z.object({ ok: z.boolean() }),
});
`);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
const cccc = {
	post: () => {
		json.ok({ ok: true });
	},
};
cccc.route = "sub";
cccc.post.route = "deep/thing";
export default { cccc };
`);
		const { violations } = await checkApi({ cwd });
		expect(routeViolations(violations)).toEqual([]);
	});

	it("文件层 .route（const api = {...}; api.route = ...）作默认前缀", async () => {
		const cwd = makeProjectIn("x", `
import { defineApi, z } from "@oj-module/runtime/contract";

export const xList = defineApi({
	apiPrefix: "/x",
	route: "/list",
	data: z.object({ ok: z.boolean() }),
});
`);
		mkdirSync(join(cwd, "api/src/order"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/api.ts"), `
const api = {
	get: () => {
		json.ok({ ok: true });
	},
};
api.route = "/x/list";
export default api;
`);
		const { violations } = await checkApi({ cwd });
		expect(routeViolations(violations)).toEqual([]);
	});

	it("同文件同动词多 handler（顶层 + 组）各自对上，不互相遮蔽", async () => {
		const cwd = makeProject(`
import { defineApi, z } from "@oj-module/runtime/contract";

export const getItem = defineApi({
	apiPrefix: "/order",
	route: "/item",
	data: z.object({ ok: z.boolean() }),
});

export const getItemCccc = defineApi({
	apiPrefix: "/order",
	route: "/item/cccc",
	data: z.object({ ok: z.boolean() }),
});
`);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
function get(): void {
	json.ok({ ok: true });
}
const cccc = {
	get: () => {
		json.ok({ ok: true });
	},
};
export default { get, cccc };
`);
		const { violations } = await checkApi({ cwd });
		expect(routeViolations(violations)).toEqual([]);
	});

	it("options handler：契约不表达 OPTIONS——AST 跳过不误报未登记，routes.js 行跳过不误报 drift", async () => {
		const cwd = makeProject(ORDER_CONTRACT);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
const upload = {
	post: () => {
		json.ok({ ok: true });
	},
	options: () => {
		json.ok({ ok: true });
	},
};
export default { upload };
`);
		mkdirSync(join(cwd, "api/dist/order-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "api/dist/order-0.1.0/routes.js"), `// 由 oj build 生成；勿手改。
export default [
  { method: "post", pattern: "order/item/upload", file: "item/api.js" },
  { method: "options", pattern: "order/item/upload", file: "item/api.js" },
];
`);
		const { violations } = await checkApi({ cwd });
		expect(routeViolations(violations)).toEqual([]);
		expect(violations.find(v => v.kind === "routes-js-drift")).toBeUndefined();
	});

	it("嵌套组同形态参数段不一致 → error route-params-mismatch（旧行为保持）", async () => {
		const cwd = makeProject(`
import { defineApi, z } from "@oj-module/runtime/contract";

export const getItemCccc = defineApi({
	apiPrefix: "/order",
	route: "/item/cccc/{id}",
	params: z.object({ id: z.string() }),
	data: z.object({ ok: z.boolean() }),
});
`);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
const cccc = {
	get: () => {
		json.ok({ ok: true });
	},
};
cccc.get.route = "{name}";
export default { cccc };
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "route-params-mismatch" }),
		]));
	});

	it("嵌套组静态前缀不同（非同名参数段）→ 未实现 + 未登记，不误判 mismatch", async () => {
		const cwd = makeProject(`
import { defineApi, z } from "@oj-module/runtime/contract";

export const getItem = defineApi({
	apiPrefix: "/order",
	route: "/item/{id}",
	params: z.object({ id: z.string() }),
	data: z.object({ ok: z.boolean() }),
});
`);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
const cccc = {
	get: () => {
		json.ok({ ok: true });
	},
};
cccc.get.route = "{name}";
export default { cccc };
`);
		const { violations } = await checkApi({ cwd });
		expect(violations.find(v => v.kind === "route-params-mismatch")).toBeUndefined();
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "warn", kind: "route-not-implemented" }),
			expect.objectContaining({ level: "error", kind: "route-unregistered" }),
		]));
	});

	it("非动词键挂函数/数组（oj 红线）不被当作路由误报未登记", async () => {
		const cwd = makeProject(ORDER_CONTRACT);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
function helper(): void {
	json.ok({});
}
const upload = {
	post: () => {
		json.ok({ ok: true });
	},
};
export default { upload, helper, junk: [1, 2] };
`);
		const { violations } = await checkApi({ cwd });
		expect(routeViolations(violations)).toEqual([]);
	});

	it("嵌套 handler 未登记契约 → error route-unregistered（消息带全路径）", async () => {
		const cwd = makeProject(ORDER_CONTRACT);
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
const upload = {
	post: () => {
		json.ok({ ok: true });
	},
	get: () => {
		json.ok({ ok: true });
	},
};
export default { upload };
`);
		const { violations } = await checkApi({ cwd });
		const unreg = violations.find(v => v.kind === "route-unregistered");
		expect(unreg).toBeDefined();
		expect(unreg!.message).toContain("order/item/upload");
	});

	it("字符串字面量连字符组键参与对账（oj 组名允许非标识符，如 push-broadcast）", async () => {
		const cwd = makeProjectIn("notify", `
import { defineApi, z } from "@oj-module/runtime/contract";

export const pushBroadcast = defineApi({
	apiPrefix: "/notify",
	route: "/push-broadcast",
	method: "POST",
	data: z.object({ ok: z.boolean() }),
});
`);
		writeFileSync(join(cwd, "api/src/notify/api.ts"), `
export default {
	"push-broadcast": {
		post: () => {
			json.ok({ ok: true });
		},
	},
};
`);
		const { violations } = await checkApi({ cwd });
		expect(routeViolations(violations)).toEqual([]);
	});
});
