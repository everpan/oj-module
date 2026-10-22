import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printInfo } from "../../packages/cli/src/info";

/**
 * 多方案 phase 4：ojm info 模块清单——扫描并集数据源（module-root）+ 自带方案折叠（I1–I4）。
 * 设计：docs/plans/2026-10-22-1640-multi-solution-bundle-design.md §D
 */

const logs: string[] = [];

beforeEach(() => {
	logs.length = 0;
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logs.push(args.join(" "));
	});
	vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
		logs.push(`[warn] ${args.join(" ")}`);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

const stubOj = {
	ojVersion: () => null,
	ojHealth: () => Promise.resolve(null),
};

/** module-root 工程：home（自带）+ crm（用户，未登记 web.config.ts） */
function makeProject(root: string, opts: { builtinList?: string[] | "bad" } = {}): void {
	fs.mkdirSync(path.join(root, "src", "home", "web"), { recursive: true });
	fs.writeFileSync(path.join(root, "src", "home", "web", "entry.ts"), "export default { name: \"home\" };\n");
	fs.mkdirSync(path.join(root, "src", "crm", "web"), { recursive: true });
	fs.writeFileSync(path.join(root, "src", "crm", "web", "entry.ts"), "export default { name: \"crm\" };\n");
	if (opts.builtinList === "bad")
		fs.writeFileSync(path.join(root, "src", ".ojm-builtin.json"), "{ not json");
	else if (opts.builtinList)
		fs.writeFileSync(path.join(root, "src", ".ojm-builtin.json"), JSON.stringify({ modules: opts.builtinList }));
}

function tmp(): string {
	// web.config.ts 故意不生成：测试环境无法 tsx import() .ts——
	// loadSiteConfig 对缺失文件回退 DEFAULT_CONFIG（module-root 扫描仍是真源，与生产等价）
	return fs.mkdtempSync(path.join(tmpdir(), "ojm-info-mod-"));
}

describe("ojm info 模块清单（自带折叠 + 扫描并集）", () => {
	it("i1 默认：用户模块全列，自带折叠为一行计数", async () => {
		const root = tmp();
		try {
			makeProject(root, { builtinList: ["home"] });
			await printInfo(root, stubOj);
			const out = logs.join("\n");
			expect(out).toContain("· crm");
			expect(out).toMatch(/框架自带：1 个/);
			expect(out).not.toContain("· home");
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("i2 --all：自带模块平铺可见", async () => {
		const root = tmp();
		try {
			makeProject(root, { builtinList: ["home"] });
			await printInfo(root, stubOj, { all: true });
			expect(logs.join("\n")).toContain("· home");
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("i3 无名单文件：平铺全部（旧工程兼容）", async () => {
		const root = tmp();
		try {
			makeProject(root);
			await printInfo(root, stubOj);
			const out = logs.join("\n");
			expect(out).toContain("· crm");
			expect(out).toContain("· home");
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("i4 未登记 web.config.ts 的用户模块仍可见（扫描并集数据源）", async () => {
		const root = tmp();
		try {
			makeProject(root, { builtinList: ["home"] });
			await printInfo(root, stubOj);
			// crm 未出现在 web.config.ts modules（[]），旧数据源会漏掉它
			expect(logs.join("\n")).toContain("· crm");
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("b12 坏名单文件：告警降级为平铺，info 不失败", async () => {
		const root = tmp();
		try {
			makeProject(root, { builtinList: "bad" });
			await expect(printInfo(root, stubOj)).resolves.toBeUndefined();
			const out = logs.join("\n");
			expect(out).toContain("[warn]");
			expect(out).toContain("· crm");
			expect(out).toContain("· home");
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
