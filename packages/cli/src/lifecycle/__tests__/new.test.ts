// BDD：`ojm new <name>` 方案骨架生成（docs/plans/2026-10-22-1640-multi-solution-bundle-design.md §C）。
// N0 非工程拒绝 / N1 骨架 round-trip（生成→补产物→buildBundle 直接过）/ N2 --api
// N3 非法·保留·内置·重名拒绝 / N5 空名拒绝 / N6 历史布局拒绝 / N7 失败清理
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeFileSync as writeFileSyncOrig } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBundle } from "../../bundle";
import { createSolution } from "../../new";

let project: string;

beforeEach(() => {
	project = mkdtempSync(join(tmpdir(), "ojm-new-"));
});

afterEach(() => {
	rmSync(project, { recursive: true, force: true });
});

/** 最小 module-root 工程面：web.config.ts + src/（含一个自带模块 home 与内置名单） */
function makeModuleRootProject(builtin = true): void {
	mkdirSync(join(project, "src", "home", "web"), { recursive: true });
	writeFileSync(join(project, "src", "home", "web", "entry.ts"), "export default { name: \"home\" };\n");
	writeFileSync(join(project, "web.config.ts"), "export default { baseUrl: \"\", modules: [] };\n");
	if (builtin)
		writeFileSync(join(project, "src", ".ojm-builtin.json"), JSON.stringify({ modules: ["home"] }));
}

/** 给已生成的方案补站点产物，模拟「ojm build 之后」的打包前置 */
function addWebArtifacts(name: string, version = "0.1.0"): void {
	const webDist = join(project, "dist/web/modules", name, version);
	mkdirSync(webDist, { recursive: true });
	writeFileSync(join(webDist, "entry.js"), "export default {};\n");
}

describe("createSolution · 守卫", () => {
	it("n0 非 ojm 工程（无 web.config.ts / src/）→ 拒绝且零写入", () => {
		expect(() => createSolution(project, "crm")).toThrow(/不是 ojm 工程/);
		expect(existsSync(join(project, "src"))).toBe(false);
	});

	it("n6 历史布局工程（web/src 树）→ 拒绝 + 迁移指引", () => {
		mkdirSync(join(project, "web", "src", "old"), { recursive: true });
		writeFileSync(join(project, "web.config.ts"), "export default { modules: [] };\n");
		expect(() => createSolution(project, "crm")).toThrow(/module-root/);
		expect(existsSync(join(project, "src", "crm"))).toBe(false);
	});

	it("n3 非法名（大写/数字开头/路径穿越）→ 拒绝", () => {
		makeModuleRootProject();
		for (const bad of ["Crm", "9crm", "../crm", "bad name"])
			expect(() => createSolution(project, bad)).toThrow(/非法/);
	});

	it("n3 保留名（system）与内置名（home）→ 拒绝 + 指引", () => {
		makeModuleRootProject();
		expect(() => createSolution(project, "system")).toThrow(/保留名/);
		expect(() => createSolution(project, "home")).toThrow(/框架自带/);
	});

	it("n3 目录已存在（非内置共享目录撞名）→ 拒绝", () => {
		makeModuleRootProject();
		mkdirSync(join(project, "src", "crm"), { recursive: true });
		expect(() => createSolution(project, "crm")).toThrow(/已存在/);
	});

	it("n5 空名 → 拒绝", () => {
		makeModuleRootProject();
		expect(() => createSolution(project, "")).toThrow(/非法/);
	});
});

describe("createSolution · 生成", () => {
	it("n1 生成 web 骨架：solution.yaml/entry.ts/页面/双语 locales 齐备，layout 写进 handle", () => {
		makeModuleRootProject();
		const r = createSolution(project, "crm", { layout: "container" });
		expect(r.files).toHaveLength(5);
		const entry = readFileSync(join(project, "src/crm/web/entry.ts"), "utf-8");
		expect(entry).toContain("layout: \"container\"");
		expect(entry).toContain("crm:menu.main");
		expect(readFileSync(join(project, "src/crm/solution.yaml"), "utf-8")).toContain("name: crm");
		expect(JSON.parse(readFileSync(join(project, "src/crm/web/locales/zh-CN.json"), "utf-8")).menu.main).toBeTruthy();
		expect(JSON.parse(readFileSync(join(project, "src/crm/web/locales/en-US.json"), "utf-8")).menu.main).toBeTruthy();
		// --layout none
		createSolution(project, "erp", { layout: "none" });
		expect(readFileSync(join(project, "src/erp/web/entry.ts"), "utf-8")).toContain("layout: \"none\"");
	});

	it("n1 round-trip：生成的骨架补产物后 buildBundle({ name }) 直接过", async () => {
		makeModuleRootProject();
		createSolution(project, "crm");
		addWebArtifacts("crm");
		const results = await buildBundle(project, { out: join(project, "dist"), name: "crm" });
		expect(results.map(r => r.name)).toEqual(["crm"]);
		expect(existsSync(results[0]!.tgz)).toBe(true);
	});

	it("n2 --api：额外生成 api 骨架且 solution.yaml 含 api 段", () => {
		makeModuleRootProject();
		createSolution(project, "crm", { api: true });
		expect(existsSync(join(project, "src/crm/api/manifest.yaml"))).toBe(true);
		expect(readFileSync(join(project, "src/crm/api/manifest.yaml"), "utf-8")).toContain("name: crm");
		expect(readFileSync(join(project, "src/crm/api/api.ts"), "utf-8")).toContain("/api/crm/ping");
		const sol = readFileSync(join(project, "src/crm/solution.yaml"), "utf-8");
		expect(sol).toContain("api:");
		expect(sol).toContain("prefix: /api/crm");
	});

	it("n7 生成中途失败 → 不残留半截 src/<name>/", () => {
		makeModuleRootProject();
		// 让第二次写盘（entry.ts）必失败：首写（solution.yaml）成功后触发清理路径——
		// 预置冲突文件会先在「目录已存在」守卫被拒，测不到 rmSync 回滚（审查发现 n7 旧用例假绿）
		let calls = 0;
		const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((...args: unknown[]) => {
			calls++;
			if (calls === 2)
				throw new Error("ENOSPC: disk full");
			return (writeFileSyncOrig as (...a: unknown[]) => unknown)(...args);
		}) as typeof fs.writeFileSync);
		try {
			expect(() => createSolution(project, "crm")).toThrow(/disk full/);
		}
		finally {
			spy.mockRestore();
		}
		expect(existsSync(join(project, "src", "crm"))).toBe(false);
	});
});
