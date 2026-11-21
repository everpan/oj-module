// materialize 纯函数 spec（实施计划 Phase 1/2 / P1-T2、P2）：无副作用、幂等、
// 双轨同名红线文案逐字不变；无 face 行按名叠停用掩码（P3 修复的语义钉）。
import type { BuiltModule } from "../build/module-build";
import { describe, expect, it } from "vitest";
import { materialize } from "../build/materialize";

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

function face(name: string, version: string, enabled: boolean): { name: string, version: string, manifest: Record<string, unknown>, enabled: boolean } {
	return {
		name,
		version,
		manifest: {
			entry: `modules/${name}/${version}/entry.js`,
			integrity: "sha384-f",
			css: [],
			chunks: [],
		},
		enabled,
	};
}

describe("materialize 纯计算（无副作用）", () => {
	it("无叠加层 → 原样返回（纯源码工程零动作）", () => {
		expect(materialize(BUILT, [])).toEqual(BUILT);
	});

	it("有 face 条目并入，enabled 以叠加层真源覆盖（不取旁车 enabled）", () => {
		const out = materialize(BUILT, [face("wiki", "0.2.0", false)]);
		expect(out.map(m => m.name)).toEqual(["system", "wiki"]);
		const wiki = out.find(m => m.name === "wiki")!;
		expect(wiki.enabled).toBe(false);
		expect(wiki.version).toBe("0.2.0");
		// 逐字节透传：manifest 里的构建信息一个数都不许动（铁律）
		expect(wiki.integrity).toBe("sha384-f");
		expect(wiki.entry).toBe("modules/wiki/0.2.0/entry.js");
	});

	it("同名源码树模块（有 face）→ 双轨同名红线，文案逐字不变", () => {
		expect(() => materialize(BUILT, [face("system", "0.9.9", true)])).toThrow(
			"[ojm] 已装方案「system」与源码树模块同名（双轨同名红线）：请卸载该方案（ojm uninstall system）或改源码模块名后重建。",
		);
	});

	it("无 face 行 + 基线同名 → 叠停用掩码，停用跨构建存活（P3 修复语义钉）", () => {
		const out = materialize(BUILT, [{ name: "system", version: "0.1.0", enabled: false }]);
		expect(out.find(m => m.name === "system")!.enabled).toBe(false);
		// 掩码只动 enabled，构建信息原样
		expect(out.find(m => m.name === "system")!.integrity).toBe("sha384-x");
	});

	it("无 face 行 + 基线无此名 → 孤儿跳过，不进清单", () => {
		const out = materialize(BUILT, [{ name: "ghost", version: "0.0.1", enabled: false }]);
		expect(out.map(m => m.name)).toEqual(["system"]);
	});

	it("掩码不改输入数组（无副作用）", () => {
		const built = [...BUILT];
		materialize(built, [{ name: "system", version: "0.1.0", enabled: false }]);
		expect(built[0].enabled).toBe(true);
	});

	it("幂等：同输入两次计算输出逐字节一致", () => {
		const overlay = [face("wiki", "0.2.0", false), { name: "system", version: "0.1.0", enabled: false } as const];
		expect(materialize(BUILT, [...overlay])).toEqual(materialize(BUILT, [...overlay]));
	});
});
