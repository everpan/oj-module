import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSolution } from "../new";

/**
 * ojm new 骨架内容契约（20261023-1144 计划）。
 * 背景：--api 骨架曾只产出裸命名导出 `export async function ping()`，
 * oj 内省只读 default export 且链尾须为 HTTP 动词 → 打包后 routes.js 恒空、
 * 装后探活 /api/<name>/ping 必然 404。骨架必须「生成即可路由」。
 */

const tmpRoots: string[] = [];

function projectRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-new-scaffold-"));
	tmpRoots.push(root);
	// createSolution 的 N0 工程判定：web.config.ts 与 src/ 至少一个
	fs.mkdirSync(path.join(root, "src"), { recursive: true });
	return root;
}

afterEach(() => {
	for (const root of tmpRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("ojm new --api 骨架可路由（BDD）", () => {
	it("给定 createSolution(api: true)，生成的 api.ts 是 default-export 嵌套组形状", () => {
		const root = projectRoot();
		const result = createSolution(root, "crm", { api: true, layout: "none" });
		const apiTs = fs.readFileSync(path.join(result.dir, "api", "api.ts"), "utf8");

		// Then：default export 承载路由组（oj 内省只读 default export）
		expect(apiTs).toContain("export default { ping }");
		// Then：链尾是 HTTP 动词 get（METHODS 白名单），组名 ping → GET /api/crm/ping
		expect(apiTs).toMatch(/const ping = \{[\s\S]*async get\(\)/);
		// Then：落实注释承诺——出参挂平级 .response（pong: boolean）
		expect(apiTs).toContain("ping.get.response");
		expect(apiTs).toContain("pong");
		// Then：不再有「裸命名导出而无 default export」的旧形状
		expect(apiTs).not.toMatch(/^export async function ping/m);
	});

	it("给定 createSolution(api: true)，solution.yaml 过自家 market verify 五必填（20261023-1155）", async () => {
		const root = projectRoot();
		const result = createSolution(root, "crm", { api: true, layout: "none" });
		const { parse: yamlParse } = await import("yaml");
		const doc = yamlParse(fs.readFileSync(path.join(result.dir, "solution.yaml"), "utf8")) as Record<string, unknown>;

		// Then：market/verify.ts structureCheck 五必填 name/version/summary/peerRuntime/archive 齐备
		for (const key of ["name", "version", "summary", "peerRuntime", "archive"])
			expect(doc[key], `solution.yaml 缺 ${key}（market verify 必填）`).toBeDefined();
		expect((doc.archive as Record<string, unknown>).file).toBe("crm-0.1.0.tgz");
	});
});
