// BDD：脚手架自带模块身份（`src/.ojm-builtin.json`）。
// 消费契约：bundle 排除打包 / ojm info 折叠 / ojm new 拒名；文件缺失 → 空名单（旧工程兼容）。
// 用例对应设计 docs/plans/2026-10-22-1640-multi-solution-bundle-design.md：
//   B12（坏文件 fail-fast）/ T1（名单 == 白名单派生集）/ T2（copyIfAbsent，不覆盖用户手改）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_LIST_FILE, deriveBuiltinModules, readBuiltinModules, writeBuiltinList } from "../../builtin";

let project: string;

beforeEach(() => {
	project = mkdtempSync(join(tmpdir(), "ojm-builtin-"));
});

afterEach(() => {
	rmSync(project, { recursive: true, force: true });
});

function writeList(content: string): void {
	mkdirSync(join(project, "src"), { recursive: true });
	writeFileSync(join(project, "src", BUILTIN_LIST_FILE), content);
}

describe("readBuiltinModules", () => {
	it("文件缺失 → 空名单（旧工程/框架仓无内置概念，行为退化兼容）", () => {
		expect(readBuiltinModules(project).size).toBe(0);
	});

	it("合法文件 → 返回 modules 集合", () => {
		writeList(JSON.stringify({ modules: ["auth", "home"] }));
		expect([...readBuiltinModules(project)].sort()).toEqual(["auth", "home"]);
	});

	it("b12 坏 JSON → fail-fast，报错含文件路径与错因（不静默降级）", () => {
		writeList("{ not json");
		expect(() => readBuiltinModules(project)).toThrow(new RegExp(`${BUILTIN_LIST_FILE.replace(".", "\\.")}`));
	});

	it("b12 modules 非数组 → fail-fast", () => {
		writeList(JSON.stringify({ modules: "auth" }));
		expect(() => readBuiltinModules(project)).toThrow(/modules/);
	});

	it("b12 modules 含非字符串项 → fail-fast", () => {
		writeList(JSON.stringify({ modules: ["auth", 42] }));
		expect(() => readBuiltinModules(project)).toThrow(/modules/);
	});
});

describe("deriveBuiltinModules（名单派生自 init.include.yaml，单一真源）", () => {
	it("t1 取 src/<name>/(api|web) 条目的模块名（含 web-only 模块），忽略无关路径", () => {
		const include = new Set([
			"src/auth/api",
			"src/notification/api",
			"src/login/web/entry.ts",
			"src/oj-market/web/pages",
			"src/styles.css",
			"src/tsconfig.json",
			"config.yaml",
			"web.config.ts",
		]);
		expect([...deriveBuiltinModules(include)].sort())
			.toEqual(["auth", "login", "notification", "oj-market"]);
	});

	it("白名单无模块条目 → 空集（不凭空造身份）", () => {
		expect(deriveBuiltinModules(new Set(["config.yaml", "README.md"])).size).toBe(0);
	});
});

describe("writeBuiltinList（init 接线：copyIfAbsent）", () => {
	it("t1 写入派生名单（排序）+ 自注释头，返回 created", () => {
		const include = new Set(["src/home/web/entry.ts", "src/auth/api", "src/login/web"]);
		expect(writeBuiltinList(project, include)).toBe("created");
		const p = join(project, "src", BUILTIN_LIST_FILE);
		expect(existsSync(p)).toBe(true);
		const doc = JSON.parse(readFileSync(p, "utf-8"));
		expect(doc.modules).toEqual(["auth", "home", "login"]);
		expect(typeof doc["//"]).toBe("string");
	});

	it("t2 已存在 → 返回 skipped 且内容原样不动（用户手改权）", () => {
		const include = new Set(["src/auth/api"]);
		expect(writeBuiltinList(project, include)).toBe("created");
		const p = join(project, "src", BUILTIN_LIST_FILE);
		writeFileSync(p, JSON.stringify({ modules: ["my-edit"] }));
		expect(writeBuiltinList(project, include)).toBe("skipped");
		expect(JSON.parse(readFileSync(p, "utf-8")).modules).toEqual(["my-edit"]);
	});

	it("派生集为空 → 不写文件，返回 none", () => {
		expect(writeBuiltinList(project, new Set(["config.yaml"]))).toBe("none");
		expect(existsSync(join(project, "src", BUILTIN_LIST_FILE))).toBe(false);
	});
});
