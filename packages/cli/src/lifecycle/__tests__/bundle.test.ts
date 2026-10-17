// BDD：`ojm build --bundle` 方案包组装（P1-11）。
// 组装契约（对齐 tgz 内布局，契约 §2.9 + P1-9 staging copy 源定版）：
//   <root>/manifest.yaml                          ← 必填，契约校验 fail-fast 先于打包
//   api/dist/<name>-<version>/                    ← oj build 产物原样 → tgz 内 api/<name>-<version>/（C2-31 分层核对）
//   web/dist/modules/                             ← 站点构建模块产物 → tgz 内 web/modules/（web.entry 存在性复核）
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
	// oj build 产物（模块级 manifest 仅 oj 原生七键；name/version/desc 与 bundle 级逐一相等，C2-31）
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

	it("端到端确定性：同一工程两次打包 sha256 相等（C2-32）", async () => {
		const r1 = await pack();
		const r2 = await pack();
		expect(r1.sha256).toBe(r2.sha256);
	});

	it("tgz 内任何位置无 modules.json（C2-31：清单由安装器在目标站点 upsert）", async () => {
		const r = await pack();
		expect(tarList(r.tgz).some(n => n.endsWith("/modules.json"))).toBe(false);
	});

	it("产物树混入 modules.json → 打包自检拒绝（C2-31 红线）", async () => {
		writeFileSync(join(project, "web/dist/modules/demo-solution/0.1.0/modules.json"), "[]");
		await expect(pack()).rejects.toThrow(/modules\.json/);
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

	it("c2-31 分层核对：模块级 desc ≠ bundle summary → 拒绝", async () => {
		writeFileSync(join(project, "api/dist/demo-solution-0.1.0/manifest.yaml"), "name: demo-solution\ndesc: 不一致描述\nversion: 0.1.0\n");
		await expect(pack()).rejects.toThrow(/C2-31/);
	});

	it("c2-31 分层核对：api/dist 缺 <name>-<version>/ → 可读报错指明期望产物路径", async () => {
		rmSync(join(project, "api/dist"), { recursive: true, force: true });
		await expect(pack()).rejects.toThrow(/api\/dist\/demo-solution-0\.1\.0/);
	});

	it("web 段存在但站点产物缺失 → 可读报错指引先构建", async () => {
		rmSync(join(project, "web/dist"), { recursive: true, force: true });
		await expect(pack()).rejects.toThrow(/web\/dist\/modules/);
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
