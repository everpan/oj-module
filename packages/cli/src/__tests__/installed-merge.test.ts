// installed-merge spec：重建合并已装方案登记（支柱二 / U5 根治）。
//
// 2026-11-07 实锤：ojm dev / ojm build 重建 modules.json 只收源码树模块，已装方案
// 的登记被冲掉（市场菜单消失），愈合只能 backfill + 逐方案重装。本模块把「已装且
// face 在盘」的方案并回重建清单——face 在盘是 release 整树擦除后从版本目录重物化
// （restoreInstalledFaces）再合并的两段式。
//
// 行为钉：
//   - sidecar state（modules/.solutions/state.yaml）为已装真源；face 版本目录的
//     `.ojm-module.json`（deploy-web 落的条目旁车）为条目形状真源（含 extras）；
//   - enabled 以 sidecar state 为准（旁车只记安装时形态）；
//   - 源码树模块同名 → fail-fast（双轨同名红线，不静默覆盖）；
//   - face 缺失而版本目录（<apiDist>/<name>-<ver>/web/modules/…）在盘 → 重物化后并入；
//   - 无 state.yaml / 损坏 / 无已装方案 → 原样返回（纯源码工程零动作）。

import type { BuiltModule } from "../build/module-build";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { mergeInstalledModules, restoreInstalledFaces } from "../build/installed-merge";

const roots: string[] = [];
function tempRoot(): { root: string, dist: string, apiDist: string } {
	const root = fs.mkdtempSync(join(tmpdir(), "ojm-instmerge-"));
	roots.push(root);
	return { root, dist: join(root, "dist", "web"), apiDist: join(root, "dist", "api") };
}

afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function writeState(root: string, solutions: Record<string, { version: string, enabled: boolean }>): void {
	const dir = join(root, "modules", ".solutions");
	fs.mkdirSync(dir, { recursive: true });
	const lines = ["solutions:"];
	for (const [name, e] of Object.entries(solutions))
		lines.push(`  ${name}:`, `    version: "${e.version}"`, `    enabled: ${e.enabled}`, "    installedAt: 1730000000000");
	fs.writeFileSync(join(dir, "state.yaml"), `${lines.join("\n")}\n`);
}

function writeFace(dist: string, name: string, version: string, entry: Record<string, unknown>): void {
	const dir = join(dist, "modules", name, version);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(join(dir, "entry.js"), "console.log(1);\n");
	fs.writeFileSync(join(dir, ".ojm-module.json"), `${JSON.stringify({ name, entry: `modules/${name}/${version}/entry.js`, enabled: true, version, chunks: [], ...entry })}\n`);
}

const BUILT: BuiltModule[] = [{
	name: "system",
	version: "0.1.0",
	enabled: true,
	dependencies: [],
	entry: "modules/system/0.1.0/entry.js",
	integrity: "sha384-x",
	css: [],
	chunks: [],
	routePrefix: "system",
}];

describe("mergeInstalledModules", () => {
	it("已装方案（face + 旁车在盘）并回重建清单，enabled 以 sidecar 为真源", () => {
		const { root, dist } = tempRoot();
		writeState(root, { "oj-market": { version: "0.2.0", enabled: true } });
		writeFace(dist, "oj-market", "0.2.0", { peerRuntime: ">=0.0.0" });

		const merged = mergeInstalledModules(root, dist, BUILT);

		expect(merged).toHaveLength(2);
		const inst = merged[1] as unknown as Record<string, unknown>;
		expect(inst.name).toBe("oj-market");
		expect(inst.entry).toBe("/modules/oj-market/0.2.0/entry.js"); // 根绝对路径：浏览器裸 import 契约（legacy 无斜杠旁车并入时归一）
		expect(inst.enabled).toBe(true);
		expect(inst.peerRuntime).toBe(">=0.0.0"); // 旁车 extras 原样保留
	});

	it("sidecar enabled=false → 条目 enabled=false（四处同写之 modules.json 面随动）", () => {
		const { root, dist } = tempRoot();
		writeState(root, { "oj-market": { version: "0.2.0", enabled: false } });
		writeFace(dist, "oj-market", "0.2.0", {});

		const merged = mergeInstalledModules(root, dist, BUILT);

		expect((merged[1] as unknown as Record<string, unknown>).enabled).toBe(false);
	});

	it("源码树模块同名 → fail-fast（双轨同名红线）", () => {
		const { root, dist } = tempRoot();
		writeState(root, { system: { version: "9.9.9", enabled: true } });
		writeFace(dist, "system", "9.9.9", {});

		expect(() => mergeInstalledModules(root, dist, BUILT)).toThrow(/双轨同名/);
	});

	it("face 缺失且无版本目录 → 跳过并告警（登记不凭空重建）", () => {
		const { root, dist } = tempRoot();
		writeState(root, { "oj-market": { version: "0.2.0", enabled: true } });

		const warn = console.warn;
		const warnings: string[] = [];
		console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
		try {
			const merged = mergeInstalledModules(root, dist, BUILT);
			expect(merged).toHaveLength(1);
			expect(warnings.join("\n")).toContain("oj-market");
		}
		finally {
			console.warn = warn;
		}
	});

	it("face 有 entry.js 但旁车缺失（版本目录重物化形态/旁车引入前旧装）→ 重建最小条目并入（css 扫描）", () => {
		const { root, dist } = tempRoot();
		writeState(root, { "oj-market": { version: "0.2.0", enabled: true } });
		const faceDir = join(dist, "modules", "oj-market", "0.2.0");
		fs.mkdirSync(faceDir, { recursive: true });
		fs.writeFileSync(join(faceDir, "entry.js"), "console.log(1);\n");
		fs.writeFileSync(join(faceDir, "main.css"), ".a{}\n");
		fs.writeFileSync(join(faceDir, "theme.css"), ".b{}\n");

		const warn = console.warn;
		const warnings: string[] = [];
		console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
		let merged: ReturnType<typeof mergeInstalledModules>;
		try {
			merged = mergeInstalledModules(root, dist, BUILT);
		}
		finally {
			console.warn = warn;
		}

		expect(merged).toHaveLength(2);
		const inst = merged[1] as unknown as Record<string, unknown>;
		expect(inst.entry).toBe("/modules/oj-market/0.2.0/entry.js"); // 根绝对路径：浏览器裸 import 契约（legacy 无斜杠旁车并入时归一）
		expect(inst.css).toEqual(["/modules/oj-market/0.2.0/main.css", "/modules/oj-market/0.2.0/theme.css"]);
		expect(warnings.join("\n")).toContain("最小条目"); // 降级有痕
		// 重建结果落回旁车：下次重建静默（告警只出现一次）
		expect(fs.existsSync(join(dist, "modules", "oj-market", "0.2.0", ".ojm-module.json"))).toBe(true);
	});

	it("无 state.yaml：原样返回（纯源码工程零动作）", () => {
		const { root, dist } = tempRoot();
		expect(mergeInstalledModules(root, dist, BUILT)).toEqual(BUILT);
	});

	describe("离线 fail-stale（断网不用过期货，P3-T6 BDD）", () => {
		function writeStateWithSeq(root: string, solutions: Record<string, { version: string, enabled: boolean, overlaySeq?: number }>): void {
			const dir = join(root, "modules", ".solutions");
			fs.mkdirSync(dir, { recursive: true });
			const lines = ["solutions:"];
			for (const [name, e] of Object.entries(solutions)) {
				lines.push(`  ${name}:`, `    version: "${e.version}"`, `    enabled: ${e.enabled}`, "    installedAt: 1730000000000");
				if (e.overlaySeq !== undefined)
					lines.push(`    overlay_seq: ${e.overlaySeq}`);
			}
			fs.writeFileSync(join(dir, "state.yaml"), `${lines.join("\n")}\n`);
		}
		function writeCache(root: string, dbSeq: number): void {
			const dir = join(root, "modules", ".solutions");
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(join(dir, "overlay-cache.json"), `${JSON.stringify({ db_seq: dbSeq, at: 1, actor: "spec" })}\n`);
		}

		it("例子: sidecar seq=7 < 已知 DB seq=8 → 拒绝覆盖 + 报警（fail-stale）", () => {
			const { root, dist } = tempRoot();
			writeStateWithSeq(root, { "oj-market": { version: "0.2.0", enabled: true, overlaySeq: 7 } });
			writeFace(dist, "oj-market", "0.2.0", {});
			writeCache(root, 8);

			const errors: string[] = [];
			const error = console.error;
			console.error = (...args: unknown[]) => errors.push(String(args[0]));
			try {
				expect(() => mergeInstalledModules(root, dist, BUILT)).toThrow(/fail-stale/);
			}
			finally {
				console.error = error;
			}
			expect(errors.join("\n")).toContain("oj-market");
		});

		it("例子: sidecar seq=8 = 已知 DB seq=8 → 正常计算（信息完备）", () => {
			const { root, dist } = tempRoot();
			writeStateWithSeq(root, { "oj-market": { version: "0.2.0", enabled: false, overlaySeq: 8 } });
			writeFace(dist, "oj-market", "0.2.0", {});
			writeCache(root, 8);

			const merged = mergeInstalledModules(root, dist, BUILT);
			expect(merged).toHaveLength(2);
			expect((merged[1] as unknown as Record<string, unknown>).enabled).toBe(false);
		});

		it("无 overlay-cache.json（从未在线物化）→ 无从判 stale，legacy 照跑", () => {
			const { root, dist } = tempRoot();
			writeStateWithSeq(root, { "oj-market": { version: "0.2.0", enabled: true } });
			writeFace(dist, "oj-market", "0.2.0", {});

			expect(mergeInstalledModules(root, dist, BUILT)).toHaveLength(2);
		});
	});
});

describe("restoreInstalledFaces", () => {
	it("face 缺失而版本目录含 web/modules 树 → 重物化到 dist/web 并返回恢复名单", () => {
		const { root, dist, apiDist } = tempRoot();
		writeState(root, { "oj-market": { version: "0.2.0", enabled: true } });
		const versionDir = join(apiDist, "oj-market-0.2.0", "web", "modules", "oj-market", "0.2.0");
		fs.mkdirSync(versionDir, { recursive: true });
		fs.writeFileSync(join(versionDir, "entry.js"), "console.log(1);\n");
		// 版本目录根旁车带 extras 标记：验证重物化走的是「根旁车随行」而非最小条目重建
		const fullSidecar = { name: "oj-market", entry: "modules/oj-market/0.2.0/entry.js", enabled: true, version: "0.2.0", chunks: [], peerRuntime: ">=0.0.0" };
		fs.writeFileSync(join(apiDist, "oj-market-0.2.0", ".ojm-module.json"), `${JSON.stringify(fullSidecar)}\n`);

		const restored = restoreInstalledFaces(root, dist, apiDist);

		expect(restored).toEqual(["oj-market"]);
		expect(fs.existsSync(join(dist, "modules", "oj-market", "0.2.0", "entry.js"))).toBe(true);
		expect(JSON.parse(fs.readFileSync(join(dist, "modules", "oj-market", "0.2.0", ".ojm-module.json"), "utf8"))).toEqual(fullSidecar);
		// 二次重物化（再擦除）带走旁车：extras 不丢、不走最小条目重建
		fs.rmSync(join(dist, "modules", "oj-market"), { recursive: true, force: true });
		restoreInstalledFaces(root, dist, apiDist);
		expect(JSON.parse(fs.readFileSync(join(dist, "modules", "oj-market", "0.2.0", ".ojm-module.json"), "utf8"))).toEqual(fullSidecar);
	});

	it("face 在盘 → 不重复恢复（幂等）", () => {
		const { root, dist, apiDist } = tempRoot();
		writeState(root, { "oj-market": { version: "0.2.0", enabled: true } });
		writeFace(dist, "oj-market", "0.2.0", {});

		expect(restoreInstalledFaces(root, dist, apiDist)).toEqual([]);
	});

	it("无 state.yaml：零动作", () => {
		const { root, dist, apiDist } = tempRoot();
		expect(restoreInstalledFaces(root, dist, apiDist)).toEqual([]);
	});
});
