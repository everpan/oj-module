// BDD：随站 bundle 启动收敛（Phase B T3b）——`ojm init --yes` 把第一方 oj-market
// 包落位 cdn/ 并写意图标记（bundles.json），站点侧幂等对账（方案 §5「上拉不下拉」）：
//   未装 → 安装；bundle > 已装 → 升级；bundle ≤ 已装 → 跳过（市场轨升过不降级，
//   对齐 rollbackGuard 禁降版红线 OJ-9）；任一失败 → 记 failed 续跑，不阻断消费面。
// 挂点说明：oj 启动段 ext_boot 有 2s 看门狗（oj-bin runtime.rs BOOT_TIMEOUT），
// 安装全程不可在 boot 内跑——收敛执行 riding 首个编排 API 请求（index 端点对账即
// 服务先例），本模块对调用方只暴露「跑一遍对账」的纯编排。
import type { FsFace } from "../../src/app/api/_platform/_lifecycle/atomic";
import type { SidecarSig } from "../../src/oj-market/api/cdn/shared";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bundleConvergePlan, convergeBundledSolutions } from "../../src/app/api/_platform/_lifecycle/bundle-converge";
import { createStateStore } from "../../src/app/api/_platform/_lifecycle/state";

const g = globalThis as any;

function nodeFsFace(): FsFace {
	return {
		writeFile: (path, data) => fsp.writeFile(path, data),
		readFile: path => fsp.readFile(path),
		mkdir: (path, opts) => fsp.mkdir(path, opts),
		remove: (path, opts) => fsp.rm(path, opts),
		rename: (oldPath, newPath) => fsp.rename(oldPath, newPath),
		copyFile: (src, dest) => fsp.copyFile(src, dest),
		readdir: path => fsp.readdir(path),
	};
}

describe("bundle 启动收敛：上拉不下拉", () => {
	it("未装（null）→ install", () => {
		expect(bundleConvergePlan(null, "0.2.0")).toBe("install");
	});

	it("已装 v1，bundle v2 → upgrade", () => {
		expect(bundleConvergePlan("0.1.0", "0.2.0")).toBe("upgrade");
	});

	it("同版本 → skip（幂等）", () => {
		expect(bundleConvergePlan("0.2.0", "0.2.0")).toBe("skip");
	});

	it("已装 v3（市场轨升的）, bundle v2 → skip（不降级，OJ-9 同源）", () => {
		expect(bundleConvergePlan("0.3.0", "0.2.0")).toBe("skip");
	});
});

describe("bundle 启动收敛：执行编排（真实 marker/cdn/状态文件 + installLocal 注入）", () => {
	let root: string;
	let cdnDir: string;
	let statePath: string;
	let markerPath: string;
	const installLocal = vi.fn<(entry: { name: string, version: string, file: string }, archive: { bytes: Uint8Array, sig: SidecarSig | null }) => Promise<void>>();

	async function seedMarker(entries: unknown): Promise<void> {
		await fsp.writeFile(markerPath, JSON.stringify({ solutions: entries }));
	}

	beforeEach(async () => {
		root = await fsp.mkdtemp(join(tmpdir(), "ojm-bundle-converge-"));
		cdnDir = join(root, "cdn");
		statePath = join(root, ".solutions", "state.yaml");
		markerPath = join(cdnDir, "bundles.json");
		await fsp.mkdir(cdnDir, { recursive: true });
		await fsp.mkdir(join(root, ".solutions"), { recursive: true });
		g.fs = nodeFsFace();
		installLocal.mockReset();
	});

	afterEach(async () => {
		g.fs = undefined;
		await fsp.rm(root, { recursive: true, force: true });
	});

	const env = () => ({ markerPath, cdnDir, statePath, installLocal });

	it("marker 缺失 → 零动作安静返回（无 bundle 的站点/旧工程）", async () => {
		const r = await convergeBundledSolutions(env());
		expect(r).toEqual({ installed: [], upgraded: [], skipped: [], failed: [], cooling: [] });
		expect(installLocal).not.toHaveBeenCalled();
	});

	it("未装 → 读 cdn 字节与旁车，installLocal 收 install 计划", async () => {
		await seedMarker([{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" }]);
		await fsp.writeFile(join(cdnDir, "oj-market-0.2.0.tgz"), new Uint8Array([1, 2, 3]));
		await fsp.writeFile(join(cdnDir, "oj-market-0.2.0.tgz.sig"), JSON.stringify({ alg: "Ed25519", key_id: "platform.release", public_key: "ab".repeat(32), value: "AQID", canon: "v2", registry_id: "oj-registry" }));
		const r = await convergeBundledSolutions(env());
		expect(r.installed).toEqual(["oj-market@0.2.0"]);
		expect(installLocal).toHaveBeenCalledTimes(1);
		const [entry, archive] = installLocal.mock.calls[0]!;
		expect(entry).toEqual({ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" });
		expect(archive.bytes).toEqual(new Uint8Array([1, 2, 3]));
		expect(archive.sig?.key_id).toBe("platform.release");
	});

	it("已装 v1、bundle v2 → upgrade；另一产品同版 → skip", async () => {
		await seedMarker([
			{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" },
			{ name: "wiki", version: "1.0.0", file: "wiki-1.0.0.tgz" },
		]);
		await fsp.writeFile(join(cdnDir, "oj-market-0.2.0.tgz"), new Uint8Array([1]));
		await fsp.writeFile(join(cdnDir, "wiki-1.0.0.tgz"), new Uint8Array([2]));
		await (await createStateStore(statePath)).write({ solutions: {
			"oj-market": { version: "0.1.0", enabled: true, installedAt: 0 },
			"wiki": { version: "1.0.0", enabled: true, installedAt: 0 },
		} });
		const r = await convergeBundledSolutions(env());
		expect(r.upgraded).toEqual(["oj-market@0.2.0"]);
		expect(r.skipped).toEqual(["wiki@1.0.0"]);
		expect(installLocal).toHaveBeenCalledTimes(1);
	});

	it("已装 v3（市场轨）> bundle v2 → skip，installLocal 零调用（不降级）", async () => {
		await seedMarker([{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" }]);
		await (await createStateStore(statePath)).write({ solutions: { "oj-market": { version: "0.3.0", enabled: true, installedAt: 0 } } });
		const r = await convergeBundledSolutions(env());
		expect(r.skipped).toEqual(["oj-market@0.2.0"]);
		expect(installLocal).not.toHaveBeenCalled();
	});

	it("installLocal 抛错 → 记 failed 且续跑后续条目（降级不阻断）", async () => {
		await seedMarker([
			{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" },
			{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" },
		]);
		await fsp.writeFile(join(cdnDir, "oj-market-0.2.0.tgz"), new Uint8Array([1]));
		installLocal.mockRejectedValueOnce(new Error("验签失败"));
		const r = await convergeBundledSolutions(env());
		expect(r.failed).toEqual(["oj-market@0.2.0（验签失败）"]);
		expect(r.installed).toEqual(["oj-market@0.2.0"]);
		expect(installLocal).toHaveBeenCalledTimes(2);
	});

	it("旁车缺失 → sig 传 null（无签名包交安装器 verify 六码分流，不本地预判）", async () => {
		await seedMarker([{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" }]);
		await fsp.writeFile(join(cdnDir, "oj-market-0.2.0.tgz"), new Uint8Array([1]));
		await convergeBundledSolutions(env());
		expect(installLocal.mock.calls[0]![1].sig).toBeNull();
	});
});

describe("bundle 收敛：卸载墓碑（终审 Important-1）", () => {
	let root: string;

	beforeEach(async () => {
		root = await fsp.mkdtemp(join(tmpdir(), "ojm-bundle-prune-"));
		g.fs = nodeFsFace();
	});

	afterEach(async () => {
		g.fs = undefined;
		await fsp.rm(root, { recursive: true, force: true });
	});

	it("pruneBundledMarker：摘除指定条目、其余保留；marker 缺失/损坏安静 no-op", async () => {
		const { pruneBundledMarker } = await import("../../src/app/api/_platform/_lifecycle/bundle-converge");
		const marker = join(root, "bundles.json");
		await fsp.writeFile(marker, JSON.stringify({ solutions: [
			{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" },
			{ name: "wiki", version: "1.0.0", file: "wiki-1.0.0.tgz" },
		] }));
		await pruneBundledMarker(marker, "oj-market");
		const after = JSON.parse(await fsp.readFile(marker, "utf-8"));
		expect(after.solutions).toEqual([{ name: "wiki", version: "1.0.0", file: "wiki-1.0.0.tgz" }]);
		// 幂等：再摘同名（条目已不在）不报错
		await pruneBundledMarker(marker, "oj-market");
		// marker 缺失 no-op
		await pruneBundledMarker(join(root, "nope.json"), "oj-market");
	});

	it("卸载摘碑后收敛不再自动重装（installLocal 零调用）", async () => {
		const { pruneBundledMarker } = await import("../../src/app/api/_platform/_lifecycle/bundle-converge");
		const cdnDir = join(root, "cdn");
		const statePath = join(root, ".solutions", "state.yaml");
		const markerPath = join(cdnDir, "bundles.json");
		await fsp.mkdir(cdnDir, { recursive: true });
		await fsp.mkdir(join(root, ".solutions"), { recursive: true });
		await fsp.writeFile(markerPath, JSON.stringify({ solutions: [{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" }] }));
		await fsp.writeFile(join(cdnDir, "oj-market-0.2.0.tgz"), new Uint8Array([1]));
		const installLocal = vi.fn(async () => {});
		// 未装 → 装
		const cdnDirArg = cdnDir;
		const r1 = await convergeBundledSolutions({ markerPath, cdnDir: cdnDirArg, statePath, installLocal });
		expect(r1.installed).toEqual(["oj-market@0.2.0"]);
		// 卸载 = 摘碑（端点侧 runUninstall 成功后调用；状态条目由卸载面清除，此处模拟无条目）
		await pruneBundledMarker(markerPath, "oj-market");
		const r2 = await convergeBundledSolutions({ markerPath, cdnDir: cdnDirArg, statePath, installLocal });
		expect(r2).toEqual({ installed: [], upgraded: [], skipped: [], failed: [], cooling: [] });
		expect(installLocal).toHaveBeenCalledTimes(1);
	});
});

describe("bundle 收敛：失败冷却（终审 Important-2）", () => {
	let root: string;
	let cdnDir: string;
	let statePath: string;
	let markerPath: string;
	let cooldownPath: string;
	const installLocal = vi.fn<(entry: { name: string, version: string, file: string }, archive: { bytes: Uint8Array, sig: unknown | null }) => Promise<void>>();

	const env = (now: () => number) => ({
		markerPath,
		cdnDir,
		statePath,
		installLocal,
		cooldownPath,
		now,
	});

	beforeEach(async () => {
		root = await fsp.mkdtemp(join(tmpdir(), "ojm-bundle-cooldown-"));
		cdnDir = join(root, "cdn");
		statePath = join(root, ".solutions", "state.yaml");
		markerPath = join(cdnDir, "bundles.json");
		cooldownPath = join(root, ".converge-cooldown.json");
		await fsp.mkdir(cdnDir, { recursive: true });
		await fsp.mkdir(join(root, ".solutions"), { recursive: true });
		await fsp.writeFile(markerPath, JSON.stringify({ solutions: [{ name: "oj-market", version: "0.2.0", file: "oj-market-0.2.0.tgz" }] }));
		await fsp.writeFile(join(cdnDir, "oj-market-0.2.0.tgz"), new Uint8Array([1]));
		g.fs = nodeFsFace();
		installLocal.mockReset();
	});

	afterEach(async () => {
		g.fs = undefined;
		await fsp.rm(root, { recursive: true, force: true });
	});

	it("失败后在冷却窗内不再重试（cooling 桶），出窗恢复重试；成功清除冷却", async () => {
		let t = 1_000_000;
		installLocal.mockRejectedValueOnce(new Error("验签失败"));
		const r1 = await convergeBundledSolutions(env(() => t));
		expect(r1.failed).toHaveLength(1);
		// 窗内（10 分钟 = 600_000ms）：cooling，installLocal 不再被调
		t += 60_000;
		const r2 = await convergeBundledSolutions(env(() => t));
		expect(r2.cooling).toEqual(["oj-market@0.2.0"]);
		expect(installLocal).toHaveBeenCalledTimes(1);
		// 出窗：重试并成功 → 冷却清除；此后同版本 skip
		t += 600_000;
		const r3 = await convergeBundledSolutions(env(() => t));
		expect(r3.installed).toEqual(["oj-market@0.2.0"]);
		expect(installLocal).toHaveBeenCalledTimes(2);
		// 成功清除冷却：冷却文件已无该键
		const cd = JSON.parse(await fsp.readFile(cooldownPath, "utf-8"));
		expect(cd).toEqual({});
	});

	it("无 cooldownPath（调用方不启用）→ 行为与既有口径一致（全部进 failed 重试）", async () => {
		let calls = 0;
		installLocal.mockImplementation(async () => {
			calls++;
			throw new Error("boom");
		});
		const envNoCd = () => ({ markerPath, cdnDir, statePath, installLocal });
		await convergeBundledSolutions(envNoCd());
		const r2 = await convergeBundledSolutions(envNoCd());
		expect(r2.failed).toHaveLength(1);
		expect(calls).toBe(2);
	});
});
