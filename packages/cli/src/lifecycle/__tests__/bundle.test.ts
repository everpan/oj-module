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

const pack = () => buildBundle(project, { out });

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

	it("src/ 下多份模块级契约 → 报错列出归属候选", async () => {
		// 同一工程只应有一份方案契约；多份模块级契约时无法判定方案归属，fail-fast。
		rmSync(join(project, "manifest.yaml"));
		const a = join(project, "src/mod-a/solution.yaml");
		const b = join(project, "src/mod-b/solution.yaml");
		mkdirSync(dirname(a), { recursive: true });
		mkdirSync(dirname(b), { recursive: true });
		writeFileSync(a, "name: mod-a\nversion: 0.1.0\n");
		writeFileSync(b, "name: mod-b\nversion: 0.1.0\n");
		await expect(pack()).rejects.toThrow(/src\/ 下发现多份 solution\.yaml/);
	});

	it("产物树混入 modules.json → 打包自检拒绝（C2-31 红线）", async () => {
		writeFileSync(join(project, "web/dist/modules/demo-solution/0.1.0/modules.json"), "[]");
		await expect(pack()).rejects.toThrow(/modules\.json/);
	});

	it("私钥/凭证混入包树 → 打包自检拒绝（P2-4 入包红线：*.pem/*.key/.env/id_ed25519/id_rsa）", async () => {
		writeFileSync(join(project, "api/dist/demo-solution-0.1.0/signing.pem"), "-----BEGIN PRIVATE KEY-----\n");
		await expect(pack()).rejects.toThrow(/私钥\/凭证/);
		rmSync(join(project, "api/dist/demo-solution-0.1.0/signing.pem"));
		writeFileSync(join(project, "web/dist/modules/demo-solution/0.1.0/.env"), "SECRET=1\n");
		await expect(pack()).rejects.toThrow(/私钥\/凭证/);
	});
});

describe("buildBundle · 校验先于打包（fail-fast）", () => {
	it("契约违规：抛可读清单（编号逐条），且不产出 tgz", async () => {
		writeFileSync(join(project, "manifest.yaml"), "name: Demo\nversion: 1.0.0+build.5\nsummary: x\nchangelog: x\n");
		await expect(pack()).rejects.toThrow(/C2-01[\s\S]*C2-02/);
		expect(existsSync(join(out, "Demo-1.0.0+build.5.tgz"))).toBe(false);
	});

	it("manifest.yaml 缺失：可读报错指明期望路径", async () => {
		rmSync(join(project, "manifest.yaml"));
		await expect(pack()).rejects.toThrow(/manifest\.yaml/);
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
