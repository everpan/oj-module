// BDD：handler AST 扫描（P2-14 裁决：修 handler-scan 认 CallExpression 工厂形态——
// `export default createXxxApi(env)` 是调用表达式，此前不认 → route-unregistered 守卫对
// market/solutions 全族失效）。镜像 oj 运行时内省语义：oj 执行工厂拿到返回对象。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlerAbs, pathKey, scanHandlerFile } from "../handler-scan";

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

/** 在相对 api/src 的任意子目录下写一个 handler 并扫（目录段参数化用例） */
function scanAt(rel: string, text: string) {
	const file = join(dir, "api", "src", rel);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text);
	return scanHandlerFile(file, join(dir, "api", "src"));
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

describe("handler-scan · 目录段参数化（`_name_` → `{name}`，v0.1.27）", () => {
	// 契约 route 走 matchit 语法（`{id}`），handler 目录走 `_id_`；两者是同一条路由的
	// 两种写法。扫描器若把目录名原样拼进 full，精确对账永远命中不了，`ojm api --check`
	// 会把「已实现的参数路由」同时报成「契约未实现」+「handler 未登记」。
	it("整段 `_id_` 目录 → `{id}`：单段与深层嵌套都转换", () => {
		const one = scanAt("wiki/_id_/api.ts", "export default { get() { return {}; } };");
		expect(one.map(r => `${r.method} ${r.full}`)).toEqual(["GET wiki/{id}"]);

		const deep = scanAt("wiki/_id_/item/_sku_/api.ts", "export default { del() { return {}; } };");
		expect(deep.map(r => `${r.method} ${r.full}`)).toEqual(["DELETE wiki/{id}/item/{sku}"]);
	});

	it("`dir` 保留磁盘事实，`full` 才是 wire 路径（两者不混用）", () => {
		const [row] = scanAt("wiki/_id_/api.ts", "export default { get() { return {}; } };");
		expect(row.dir).toBe("wiki/_id_");
		expect(row.full).toBe("wiki/{id}");
		expect(handlerAbs(row)).toBe("/wiki/{id}");
	});

	it("不满足「整段 _name_」的目录保持字面（与 oj 内省同谓词）", () => {
		const literal = ["__x__", "___", "_a{b}_", "_shared", "a_id_b"];
		for (const seg of literal) {
			const rows = scanAt(`m/${seg}/api.ts`, "export default { get() { return {}; } };");
			expect(rows.map(r => r.full)).toEqual([`m/${seg}`]);
		}
	});

	it("模块段同样适用：`_aa_/bb/api.ts` → `{aa}/bb`", () => {
		// module-root 布局：apiDir 是模块自己的 api 目录（src/<name>/api），模块名单独传
		const moduleDir = join(dir, "api", "src", "_aa_");
		const file = join(moduleDir, "api", "bb", "api.ts");
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "export default { get() { return {}; } };");
		const rows = scanHandlerFile(file, join(moduleDir, "api"), "_aa_");
		expect(rows.map(r => r.full)).toEqual(["{aa}/bb"]);
	});

	it("`.route` 尾巴已是 matchit 写法，不再做 `_` 转换；目录参数与相对尾自由组合", () => {
		const rows = scanAt("wiki/_id_/api.ts", `
function get() { return {}; }
get.route = "{sub}";
export default { get };
`);
		expect(rows.map(r => r.full)).toEqual(["wiki/{id}/{sub}"]);
	});

	it("绝对 `.route` 不受目录影响（根级挂载，full 即其自身）", () => {
		const rows = scanAt("wiki/_id_/api.ts", `
function get() { return {}; }
get.route = "/audit/{tokenId}";
export default { get };
`);
		expect(rows.map(r => r.full)).toEqual(["audit/{tokenId}"]);
		expect(handlerAbs(rows[0])).toBe("/audit/{tokenId}");
	});
});

describe("handler-scan · 对账键与契约侧同形（参数路由精确命中）", () => {
	it("`_id_` 目录与 `{id}` 契约段产生同一 pathKey", () => {
		const [row] = scanAt("wiki/_id_/api.ts", "export default { del() { return {}; } };");
		expect(pathKey(row.method, row.full)).toBe(pathKey("DELETE", "wiki/{id}"));
	});
});
