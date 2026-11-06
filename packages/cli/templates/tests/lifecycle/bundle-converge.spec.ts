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
		expect(r).toEqual({ installed: [], upgraded: [], skipped: [], failed: [] });
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
