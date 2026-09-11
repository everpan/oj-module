import type { StubWrite } from "../../packages/cli/src/contract/emit-stub";
import { describe, expect, it } from "vitest";
import { planStubWrites } from "../../packages/cli/src/contract/emit-stub";
import { buildIr } from "../../packages/cli/src/contract/ir";
import { defineApi, z } from "../../packages/runtime/contract";

/**
 * AC-D10 §9.1：handler stub 发射 + 指纹幂等。
 * 原则：人碰过的文件工具永不写、永不删；契约未变重跑零写入（git diff 为空）。
 * 测试注入确定性 fixer（identity / 空白归一），真实 ESLint fixer 由集成路径使用。
 */

const identityFix = async (code: string) => code;

const ir = buildIr({
	getOrderDetail: defineApi({
		apiPrefix: "/order",
		route: "/item/{id}",
		params: z.object({ id: z.number() }),
		data: z.object({ id: z.number(), order_no: z.string(), amount: z.number().min(0) }),
	}),
	createOrder: defineApi({
		apiPrefix: "/order",
		route: "/item",
		method: "POST",
		body: z.object({ order_no: z.string() }),
		data: z.object({ id: z.number() }),
	}),
	deleteOrder: defineApi({
		apiPrefix: "/order",
		route: "/item/{id}",
		method: "DELETE",
		params: z.object({ id: z.number() }),
	}),
	getOrderList: defineApi({
		apiPrefix: "/order",
		route: "/list",
		data: z.object({ list: z.array(z.object({ id: z.number() })), total: z.number() }),
	}),
});

/** 首轮跑出的落盘内容 → 内存文件表（模拟磁盘） */
function seedFiles(writes: StubWrite[]): Map<string, string> {
	const files = new Map<string, string>();
	for (const w of writes) {
		if (w.action !== "skip")
			files.set(w.filePath, w.content);
	}
	return files;
}

describe("planStubWrites（AC-D10 §9.1 五场景）", () => {
	it("handler 不存在 → action create：oj 模板（默认导出 + .route 赋值 + json.ok 示例值）", async () => {
		const writes = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		expect(writes.every(w => w.action === "create")).toBe(true);
		const item = writes.find(w => w.filePath === "api/src/order/item/api.ts");
		expect(item?.content).toMatchSnapshot();
		// 指纹行 + oj 惯例（语句起始 .route 赋值、json.ok 收口、示例值含 min 约束）
		expect(item?.content).toMatch(/^\/\/ ojm-api:stub .+ sha256:[0-9a-f]{64}\n/);
		expect(item?.content).toContain("get.route = \"{id}\";");
		expect(item?.content).toContain("json.ok({");
		expect(item?.content).toContain("amount: 0");
		// 同目录 GET/POST/DELETE 归并一个文件，方法排序稳定
		expect(item?.content).toContain("export default { get, post, del };");
		// 无参数尾巴的端点不挂 .route
		expect(writes.find(w => w.filePath === "api/src/order/list/api.ts")?.content).not.toContain(".route");
	});

	it("重跑契约未变 → 全部 skip，零写入", async () => {
		const first = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		const files = seedFiles(first);
		const second = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: p => files.get(p) });
		expect(second.every(w => w.action === "skip")).toBe(true);
		expect(second.every(w => /未变/.test(w.reason ?? ""))).toBe(true);
	});

	it("指纹匹配的 stub 随契约变更 → action update（无人的劳动成果，覆盖安全）", async () => {
		const first = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		const files = seedFiles(first);
		// 契约变更：data 加字段 → 示例值变化
		const ir2 = buildIr({
			getOrderDetail: defineApi({
				apiPrefix: "/order",
				route: "/item/{id}",
				data: z.object({ id: z.number(), order_no: z.string(), remark: z.string() }),
			}),
		});
		const second = await planStubWrites(ir2, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: p => files.get(p) });
		const item = second.find(w => w.filePath === "api/src/order/item/api.ts");
		expect(item?.action).toBe("update");
		expect(item?.content).toContain("remark");
	});

	it("指纹不匹配（人已编辑）→ skip 且 reason 提示走 --check", async () => {
		const first = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		const files = seedFiles(first);
		const edited = files.get("api/src/order/item/api.ts")!.replace("json.ok({", "// 人写的业务逻辑\n	json.ok({");
		files.set("api/src/order/item/api.ts", edited);
		const second = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: p => files.get(p) });
		const item = second.find(w => w.filePath === "api/src/order/item/api.ts");
		expect(item?.action).toBe("skip");
		expect(item?.reason).toMatch(/人工编辑|--check/);
	});

	it("delete 端点 → 方法名 del（oj 约定）", async () => {
		const writes = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		const item = writes.find(w => w.filePath === "api/src/order/item/api.ts")!;
		expect(item.content).toContain("function del(): void {");
		expect(item.content).toContain("del.route = \"{id}\";");
	});

	it("指纹健壮性：写盘前先过 fixer 再算哈希（lint-staged 重排不致静默失配）", async () => {
		// 模拟 lint-staged 会把连空行压成单空行：fixer 做同样归一，指纹即稳定
		const collapse = async (code: string) => code.replaceAll(/\n{3,}/g, "\n\n");
		const first = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: collapse, readFile: () => undefined });
		const files = seedFiles(first);
		// 磁盘上的文件与指纹同源（都已过 fixer）→ 重跑 skip
		const second = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: collapse, readFile: p => files.get(p) });
		expect(second.every(w => w.action === "skip")).toBe(true);
	});
});
