// BDD：handler AST 扫描（P2-14 裁决：修 handler-scan 认 CallExpression 工厂形态——
// `export default createXxxApi(env)` 是调用表达式，此前不认 → route-unregistered 守卫对
// market/solutions 全族失效）。镜像 oj 运行时内省语义：oj 执行工厂拿到返回对象。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanHandlerFile } from "../handler-scan";

let dir: string;
let apiSrc: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ojm-scan-"));
	apiSrc = join(dir, "api", "src", "_platform", "market");
	mkdirSync(apiSrc, { recursive: true });
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function scan(name: string, text: string) {
	writeFileSync(join(apiSrc, name), text);
	return scanHandlerFile(join(apiSrc, name), join(dir, "api", "src"));
}

describe("handler-scan · 工厂形态（P2-14：export default createXxxApi(env)）", () => {
	it("callExpression → 同名函数声明 return 对象字面量：动词键/嵌套组照常展开（dir 镜像起算）", () => {
		const rows = scan("api.ts", `
import type { Env } from "./types";
export function createMarketApi(env: Env) {
	return {
		"install": {
			async post() { return {}; },
		},
		"verify": {
			async post() { return {}; },
			last: {
				async get() { return {}; },
			},
		},
	};
}
export default createMarketApi({} as Env);
`);
		expect(rows.map(r => `${r.method} ${r.full}`).sort()).toEqual([
			"GET _platform/market/verify/last",
			"POST _platform/market/install",
			"POST _platform/market/verify",
		]);
	});

	it("标识符默认导出指回工厂调用：const x = createXxx(env); export default x（market/api.ts 真形态）", () => {
		// 真实模板形态：工厂调用赋给 const，再 export default 该标识符。
		// 此前 scanHandlerFile 只认「default 导出 = 调用表达式」，认不出
		// 「default 导出 = 标识符 → 指向一次工厂调用」，导致 market 整族 route 漏登。
		const rows = scan("api.ts", `
import type { Env } from "./types";
export function createMarketApi(env: Env) {
	return {
		"install": {
			async post() { return {}; },
		},
		"verify": {
			async post() { return {}; },
			last: {
				async get() { return {}; },
			},
		},
	};
}
const marketApi = createMarketApi({} as Env);
export default marketApi;
`);
		expect(rows.map(r => `${r.method} ${r.full}`).sort()).toEqual([
			"GET _platform/market/verify/last",
			"POST _platform/market/install",
			"POST _platform/market/verify",
		]);
	});

	it("无 return 对象 / 未知 callee / 点分 callee 不可解析 → 零行（不炸不猜）", () => {
		expect(scan("a.ts", "export default createMissingApi({});")).toEqual([]);
		expect(scan("b.ts", `
function createApi() { console.log("no return object"); }
export default createApi();
`)).toEqual([]);
		expect(scan("c.ts", "export default (makeApi())({});")).toEqual([]);
	});

	it("既有形态回归：内联字面量与标识符 default 导出照常识别（P2-14 改动不破旧口径）", () => {
		const inline = scan("inline.ts", `
export default {
	hello: {
		get() { return {}; },
	},
};
`);
		expect(inline.map(r => `${r.method} ${r.full}`)).toEqual(["GET _platform/market/hello"]);
		const viaIdent = scan("ident.ts", `
const api = {
	bye: {
		del() { return {}; },
	},
};
export default api;
`);
		expect(viaIdent.map(r => `${r.method} ${r.full}`)).toEqual(["DELETE _platform/market/bye"]);
	});
});
