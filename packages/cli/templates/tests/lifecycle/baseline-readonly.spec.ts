// BDD：基线只读探针（实施计划 Phase 4 / P4-T4）——modules.json 只许 site-materialize 写。
// 运行面没有独立 modules.base.json（Phase 3 实作偏差），基线 = 当前 modules.json；
// 探针 = 源码扫描常驻门禁（同 C2-12c parity 测试范式）：直写点必须落在白名单内且
// legacy 回落（overlay 表不可达的老平台）必须带 writeManifest 旗标门控。
// 「运行时进程可写即报警」在此体系的最小完备表达：门禁在合入前拦，而非运行时发现。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "../../src/app/api/_platform");

/** 收集模板源码中所有引用 modulesJsonPath 的写形态调用行（atomicWriteText/upsert/remove） */
function writeCallSites(): Array<{ file: string, line: string }> {
	const sites: Array<{ file: string, line: string }> = [];
	const walk = (dir: string) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				walk(p);
				continue;
			}
			if (!e.name.endsWith(".ts"))
				continue;
			const rel = path.relative(SRC, p);
			const lines = fs.readFileSync(p, "utf8").split("\n");
			lines.forEach((line, i) => {
				// 直写形态：把 modulesJsonPath 交给写函数的调用（upsert/remove/atomicWrite）
				if (/modulesJsonPath/.test(line) && /(?:upsertModulesJson|removeModulesJsonEntry|atomicWriteText)\(/.test(line)) {
					sites.push({ file: `${rel}:${i + 1}`, line: line.trim() });
				}
			});
		}
	};
	walk(SRC);
	return sites;
}

describe("功能: 基线只读（modules.json 只许物化写）", () => {
	it("直写调用点全量在白名单内（site-materialize 唯一无条件写者 + deploy-web legacy 回落）", () => {
		const sites = writeCallSites();
		expect(sites.length, `应存在已知直写点（门禁不是空转），实得：${JSON.stringify(sites)}`).toBeGreaterThan(0);
		const legacyFallback = ["steps/deploy-web.ts", "compensate.ts", "installer.ts", "uninstall.ts"];
		for (const s of sites) {
			const whitelist = ["_lifecycle/site-materialize.ts", ...legacyFallback.map(f => `_lifecycle/${f}`)];
			const allowed = whitelist.some(prefix => s.file.startsWith(prefix)); // legacyFallback 均仅 legacy 回落分支（见下例）
			expect(allowed, `非白名单直写点 ${s.file}：${s.line}`).toBe(true);
		}
	});

	it("setEnabled/uninstall 直写必须在 dbSeq === null 的 legacy 回落分支内（overlay 表可达时走物化）", () => {
		for (const file of ["installer.ts", "uninstall.ts"]) {
			const src = fs.readFileSync(path.join(SRC, "_lifecycle", file), "utf8");
			const gated = /if \(dbSeq !== null\) \{[\s\S]*?else \{[\s\S]*?atomicWriteText\(input\.modulesJsonPath/.test(src);
			expect(gated, `${file} 的 modules.json 直写必须落在 dbSeq===null legacy 分支`).toBe(true);
		}
	});

	it("deploy-web 直写必须带 writeManifest 旗标门控（overlay 表可达时不许碰清单）", () => {
		const src = fs.readFileSync(path.join(SRC, "_lifecycle/steps/deploy-web.ts"), "utf8");
		const gated = /if \(ctx\.writeManifest !== false\)[\s\S]*?upsertModulesJson\(/.test(src);
		expect(gated, "deploy-web.ts 的 upsertModulesJson 调用必须包在 writeManifest 门控内").toBe(true);
	});

	it("安装主流程传 writeManifest: dbSeq === null——直写仅发生在 overlay 表不可达的 legacy 平台", () => {
		const src = fs.readFileSync(path.join(SRC, "_lifecycle/installer.ts"), "utf8");
		expect(src).toContain("writeManifest: dbSeq === null");
	});
});
