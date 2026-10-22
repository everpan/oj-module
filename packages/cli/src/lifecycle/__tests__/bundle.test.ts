// BDD：`ojm build --bundle` 方案包组装（P1-11）。
// 组装契约（对齐 tgz 内布局，契约 §2.9 + P1-9 staging copy 源定版）：
//   <root>/solution.yaml | manifest.yaml           ← 必填（solution.yaml 优先，避开 oj 的 api 枚举冲突），契约校验 fail-fast 先于打包
//   <root>/src/<模块>/solution.yaml | manifest.yaml ← 模块级方案：契约与所打包模块同位（同优先级回退）
//   api/dist/<name>-<version>/                    ← oj build 产物原样 → tgz 内 api/<name>-<version>/（C2-31 分层核对）
//   web/dist/modules/<name>/                      ← 站点构建模块产物 → tgz 内 web/modules/<name>/（只入包方案自己的模块）
// 禁携 modules.json（C2-31 红线）；产物确定性（C2-32）由 deterministic-tar 承担，此处断言端到端复现。
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { buildBundle } from "../../bundle";

const FIXTURE_VALID = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fixture-valid");

let project: string;
let out: string;

beforeEach(() => {
	project = mkdtempSync(join(tmpdir(), "ojm-bundle-proj-"));
	out = mkdtempSync(join(tmpdir(), "ojm-bundle-out-"));
	cpSync(FIXTURE_VALID, project, { recursive: true });
	makePrebuiltArtifacts();
});

afterEach(() => {
	rmSync(project, { recursive: true, force: true });
	rmSync(out, { recursive: true, force: true });
});

/** 预置「已构建」产物：oj build（api/dist/<name>-<version>/）与站点构建（web/dist/modules/） */
function makePrebuiltArtifacts(): void {
	// oj build 产物（模块级 manifest 仅 oj 原生七键；name/version 与 bundle 级逐一相等，C2-31）
	const apiDist = join(project, "api/dist/demo-solution-0.1.0");
	mkdirSync(join(apiDist, "ping"), { recursive: true });
	mkdirSync(join(apiDist, "migrations"), { recursive: true });
	writeFileSync(join(apiDist, "manifest.yaml"), "name: demo-solution\ndesc: manifest.yaml 契约全字段合法夹具\nversion: 0.1.0\ntables:\n  - note\n");
	writeFileSync(join(apiDist, "schema.yaml"), "tables:\n  note: {}\n");
	writeFileSync(join(apiDist, "routes.js"), "export {};\n");
	writeFileSync(join(apiDist, "ping/api.js"), "export async function ping() {}\n");
	// 站点构建产物（web/dist/modules/<name>/<version>/entry.js + css，对应 web.entry/css 声明）
	const webDist = join(project, "web/dist/modules/demo-solution/0.1.0");
	mkdirSync(webDist, { recursive: true });
	writeFileSync(join(webDist, "entry.js"), "export default {};\n");
	writeFileSync(join(webDist, "demo-solution.css"), ".demo{}\n");
}

const pack = () => buildBundle(project, { out }).then(r => r[0]!);

/** 造一个 web-only 用户方案（模块级契约 + 站点产物，无 api 段校验面最小） */
function addWebSolution(name: string, version = "0.1.0"): void {
	const dir = join(project, "src", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "solution.yaml"), [
		`name: ${name}`,
		`version: ${version}`,
		`summary: ${name} 用户方案`,
		`changelog: ${name} 首个版本`,
		"web:",
		`  entry: modules/${name}/${version}/entry.js`,
		"",
	].join("\n"));
	const webDist = join(project, "web/dist/modules", name, version);
	mkdirSync(webDist, { recursive: true });
	writeFileSync(join(webDist, "entry.js"), "export default {};\n");
}

describe("buildBundle · 正路径", () => {
	it("产出 out/<name>-<version>.tgz + 64 位 sha256，布局单根三分（manifest/api/web）", async () => {
		const r = await pack();
		expect(r.tgz).toBe(join(out, "demo-solution-0.1.0.tgz"));
		expect(existsSync(r.tgz)).toBe(true);
		expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);
		const names = tarList(r.tgz);
		// 顶层目录成员（仅一个斜杠且在末尾）恰为单根，且居首（字典序）
		expect(names.filter(n => n.endsWith("/") && n.indexOf("/") === n.length - 1)).toEqual(["demo-solution-0.1.0/"]);
		expect(names[0]).toBe("demo-solution-0.1.0/");
		for (const member of ["manifest.yaml", "api/demo-solution-0.1.0/manifest.yaml", "web/modules/demo-solution/0.1.0/entry.js", "web/modules/demo-solution/0.1.0/demo-solution.css"])
			expect(names, `缺成员 ${member}`).toContain(`demo-solution-0.1.0/${member}`);
	});

	it("只入包方案自己的前端模块：模板模块（home/login…）不随包", async () => {
		// 安装器 deployWeb 把包内 web/modules 整树覆盖进目标站，模板产物随包会覆盖宿主同名前端
		const hostWeb = join(project, "web/dist/modules/home/0.1.0");
		mkdirSync(hostWeb, { recursive: true });
		writeFileSync(join(hostWeb, "entry.js"), "export default {};\n");
		const names = tarList((await pack()).tgz);
		expect(names.some(n => n.includes("/web/modules/home/"))).toBe(false);
		expect(names).toContain("demo-solution-0.1.0/web/modules/demo-solution/0.1.0/entry.js");
	});

	it("端到端确定性：同一工程两次打包 sha256 相等（C2-32）", async () => {
		const r1 = await pack();
		const r2 = await pack();
		expect(r1.sha256).toBe(r2.sha256);
	});

	it("tgz 内任何位置无 modules.json（C2-31：清单由安装器在目标站点 upsert）", async () => {
		const r = await pack();
		expect(tarList(r.tgz).some(n => n.endsWith("/modules.json"))).toBe(false);
	});

	it("solution.yaml 作为 bundle 契约（优先于 manifest.yaml，避开 oj 按 manifest.yaml 枚举 api 后端的冲突）", async () => {
		// 根目录若用 manifest.yaml 当 bundle 契约，会被 oj 的 api 模块搜索枚举误判为 api 模块；
		// 故解决方案改用 solution.yaml，bundle 工具优先认它（manifest.yaml 仅旧方案回退）。
		const mf = join(project, "manifest.yaml");
		const sf = join(project, "solution.yaml");
		cpSync(mf, sf);
		rmSync(mf);
		const r = await pack();
		expect(r.name).toBe("demo-solution");
		expect(existsSync(r.tgz)).toBe(true);
		// tgz 内固定为 manifest.yaml（安装侧只认这个名字），与源文件名无关
		const names = tarList(r.tgz);
		expect(names).toContain("demo-solution-0.1.0/manifest.yaml");
		expect(names.some(n => n.endsWith("/solution.yaml"))).toBe(false);
	});

	it("src/<模块>/solution.yaml 作为 bundle 契约（模块级方案：契约与所打包模块同位）", async () => {
		// 单模块方案：契约紧贴它打包的模块 src/<name>/，比工程根更直观；
		// 仍不在 api/ 下、也不叫 manifest.yaml，等价避开 oj 按 manifest.yaml 枚举 api 后端的冲突。
		const mf = join(project, "manifest.yaml");
		const sf = join(project, "src/demo-solution/solution.yaml");
		mkdirSync(dirname(sf), { recursive: true });
		cpSync(mf, sf);
		rmSync(mf);
		const r = await pack();
		expect(r.name).toBe("demo-solution");
		expect(existsSync(r.tgz)).toBe(true);
		// tgz 内固定为 manifest.yaml（安装侧只认这个名字），与源文件名/源位置无关
		const names = tarList(r.tgz);
		expect(names).toContain("demo-solution-0.1.0/manifest.yaml");
		expect(names.some(n => n.endsWith("/solution.yaml"))).toBe(false);
	});

	it("src/ 下多份模块级契约 → 全部打包（多方案；B2）", async () => {
		// 多方案正是本特性要支持的场景：每份契约独立校验、独立出包
		rmSync(join(project, "manifest.yaml"));
		addWebSolution("mod-a");
		addWebSolution("mod-b");
		const results = await buildBundle(project, { out });
		expect(results.map(r => r.name).sort()).toEqual(["mod-a", "mod-b"]);
		for (const r of results)
			expect(existsSync(r.tgz)).toBe(true);
	});

	it("产物树混入 modules.json → 打包自检拒绝（C2-31 红线）", async () => {
		writeFileSync(join(project, "web/dist/modules/demo-solution/0.1.0/modules.json"), "[]");
		await expect(pack()).rejects.toThrow(/modules\.json/);
	});

	it("私钥/凭证混入包树 → 打包自检拒绝（P2-4 入包红线：*.pem/*.key/.env(.local…)/id_ed25519/id_rsa/*.p12/*.pfx）", async () => {
		writeFileSync(join(project, "api/dist/demo-solution-0.1.0/signing.pem"), "-----BEGIN PRIVATE KEY-----\n");
		await expect(pack()).rejects.toThrow(/私钥\/凭证/);
		rmSync(join(project, "api/dist/demo-solution-0.1.0/signing.pem"));
		writeFileSync(join(project, "web/dist/modules/demo-solution/0.1.0/.env"), "SECRET=1\n");
		await expect(pack()).rejects.toThrow(/私钥\/凭证/);
		rmSync(join(project, "web/dist/modules/demo-solution/0.1.0/.env"));
		writeFileSync(join(project, "web/dist/modules/demo-solution/0.1.0/.env.production"), "SECRET=1\n");
		await expect(pack()).rejects.toThrow(/私钥\/凭证/);
	});
});

describe("buildBundle · 多方案与内置排除（B3/B7/B8/B9/B10/B12）", () => {
	it("b3 内置方案跳过：名单内的模块契约不出包，用户契约照打", async () => {
		rmSync(join(project, "manifest.yaml"));
		addWebSolution("crm");
		addWebSolution("oj-market"); // 自带方案也带契约（第一方可分发形态）
		mkdirSync(join(project, "src"), { recursive: true });
		writeFileSync(join(project, "src/.ojm-builtin.json"), JSON.stringify({ modules: ["oj-market"] }));
		const results = await buildBundle(project, { out });
		expect(results.map(r => r.name)).toEqual(["crm"]);
	});

	it("b6/B3 无名单文件 → 无内置概念，多份契约全部打包", async () => {
		rmSync(join(project, "manifest.yaml"));
		addWebSolution("crm");
		addWebSolution("oj-market");
		const results = await buildBundle(project, { out });
		expect(results.map(r => r.name).sort()).toEqual(["crm", "oj-market"]);
	});

	it("b7+B8：目录不同契约 name 撞车 → 被 name===目录名 校验拦下（B8 使 B7 向量不可达，决策见计划文档）", async () => {
		rmSync(join(project, "manifest.yaml"));
		addWebSolution("crm");
		// 拷贝改目录忘改 name 的典型症状——B8 在收集期即拒，dist/ 不会出现同名产物
		const dir = join(project, "src", "crm-copy");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "solution.yaml"), "name: crm\nversion: 0.1.0\nsummary: dup\nchangelog: x\nweb:\n  entry: modules/crm/0.1.0/entry.js\n");
		await expect(buildBundle(project, { out })).rejects.toThrow(/与目录名「crm-copy」不一致/);
	});

	it("b8 模块级契约 name ≠ 目录名 → fail-fast", async () => {
		rmSync(join(project, "manifest.yaml"));
		const dir = join(project, "src", "crm");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "solution.yaml"), "name: erp\nversion: 0.1.0\nsummary: x\n");
		await expect(pack()).rejects.toThrow(/与目录名「crm」不一致/);
	});

	it("b9 两段式：多契约其一校验失败 → dist/ 零增量", async () => {
		rmSync(join(project, "manifest.yaml"));
		addWebSolution("crm");
		// erp 契约违规（name 大写触发契约校验）
		const dir = join(project, "src", "erp");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "solution.yaml"), "name: erp\nversion: 0.1.0\nsummary: x\n");
		await expect(buildBundle(project, { out })).rejects.toThrow(/C2-08/);
		expect(existsSync(join(out, "crm-0.1.0.tgz"))).toBe(false);
	});

	it("b10 旧契约回退：src/<name>/manifest.yaml（非内置）参与收集", async () => {
		rmSync(join(project, "manifest.yaml"));
		const dir = join(project, "src", "crm");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "manifest.yaml"), "name: crm\nversion: 0.1.0\nsummary: x\nchangelog: x\nweb:\n  entry: modules/crm/0.1.0/entry.js\n");
		const webDist = join(project, "web/dist/modules/crm/0.1.0");
		mkdirSync(webDist, { recursive: true });
		writeFileSync(join(webDist, "entry.js"), "export default {};\n");
		const results = await buildBundle(project, { out });
		expect(results.map(r => r.name)).toEqual(["crm"]);
	});

	it("b12 坏 .ojm-builtin.json → fail-fast 报路径与错因", async () => {
		mkdirSync(join(project, "src"), { recursive: true });
		writeFileSync(join(project, "src/.ojm-builtin.json"), "{ not json");
		await expect(pack()).rejects.toThrow(/\.ojm-builtin\.json/);
	});

	it("b4 --bundle <name>：按名打包；内置名拒绝；非法名拒绝", async () => {
		rmSync(join(project, "manifest.yaml"));
		addWebSolution("crm");
		addWebSolution("erp");
		const one = await buildBundle(project, { out, name: "crm" });
		expect(one.map(r => r.name)).toEqual(["crm"]);
		await expect(buildBundle(project, { out, name: "erp2" })).rejects.toThrow(/未找到「erp2」/);
		writeFileSync(join(project, "src/.ojm-builtin.json"), JSON.stringify({ modules: ["erp"] }));
		await expect(buildBundle(project, { out, name: "erp" })).rejects.toThrow(/框架自带方案/);
		await expect(buildBundle(project, { out, name: "../evil" })).rejects.toThrow(/非法/);
		await expect(buildBundle(project, { out, name: "Bad Name" })).rejects.toThrow(/非法/);
	});

	it("b1 根契约优先于 src 契约（旧行为）+ B11 hint", async () => {
		addWebSolution("crm"); // 根 manifest.yaml（demo-solution）仍在
		const spy: string[] = [];
		const orig = console.log;
		console.log = (m?: unknown) => {
			spy.push(String(m));
		};
		try {
			const results = await buildBundle(project, { out });
			expect(results.map(r => r.name)).toEqual(["demo-solution"]);
		}
		finally {
			console.log = orig;
		}
		expect(spy.join("\n")).toMatch(/工程根契约优先/);
	});
});

describe("buildBundle · 校验先于打包（fail-fast）", () => {
	it("契约违规：抛可读清单（编号逐条），且不产出 tgz", async () => {
		writeFileSync(join(project, "manifest.yaml"), "name: Demo\nversion: 1.0.0+build.5\nsummary: x\nchangelog: x\n");
		await expect(pack()).rejects.toThrow(/C2-01[\s\S]*C2-02/);
		expect(existsSync(join(out, "Demo-1.0.0+build.5.tgz"))).toBe(false);
	});

	it("manifest.yaml 缺失且无用户方案：可读报错指向 ojm new（B5）", async () => {
		rmSync(join(project, "manifest.yaml"));
		await expect(pack()).rejects.toThrow(/没有可打包的用户方案/);
	});

	it("c2-31 分层核对：模块级 desc ≠ bundle summary → 放行（等值要求已移除）", async () => {
		writeFileSync(join(project, "api/dist/demo-solution-0.1.0/manifest.yaml"), "name: demo-solution\ndesc: 不一致描述\nversion: 0.1.0\n");
		await expect(pack()).resolves.toMatchObject({ name: "demo-solution" });
	});

	it("c2-31 分层核对：api/dist 缺 <name>-<version>/ → 可读报错指明期望产物路径", async () => {
		rmSync(join(project, "api/dist"), { recursive: true, force: true });
		await expect(pack()).rejects.toThrow(/api\/dist\/demo-solution-0\.1\.0/);
	});

	it("web 段存在但站点产物缺失 → 可读报错指引先构建", async () => {
		rmSync(join(project, "web/dist"), { recursive: true, force: true });
		await expect(pack()).rejects.toThrow(/web\/dist\/modules/);
	});

	it("web/dist/modules 在但缺本方案目录 → 可读报错（不整树入包）", async () => {
		rmSync(join(project, "web/dist/modules/demo-solution"), { recursive: true, force: true });
		await expect(pack()).rejects.toThrow(/web\/dist\/modules\/demo-solution\//);
	});

	it("c2-12a：api.tables 与 schema.yaml 表集不一致 → 构建期拒绝", async () => {
		const m = readManifest();
		m.api.tables = ["note", "ghost"];
		writeManifest(m);
		await expect(pack()).rejects.toThrow(/C2-12a/);
	});

	it("c2-25：locales 缺引用 key → 构建期 fail-fast", async () => {
		const m = readManifest();
		m.roles[0].title_key = "demo-solution:role.absent";
		writeManifest(m);
		await expect(pack()).rejects.toThrow(/C2-25/);
	});
});

// ── 助手 ──

function readManifest(): any {
	return parse(readFileSync(join(project, "manifest.yaml"), "utf8"));
}

function writeManifest(m: unknown): void {
	writeFileSync(join(project, "manifest.yaml"), stringify(m));
}

function tarList(tgz: string): string[] {
	return execFileSync("tar", ["-tvzf", tgz], { encoding: "utf8" })
		// 铁律②（P1-6）：tar 输出恒带尾随换行，trim 后再 split
		.trim()
		.split("\n")
		.map(line => line.split(" ").pop()!);
}
