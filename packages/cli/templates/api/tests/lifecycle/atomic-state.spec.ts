// BDD：状态文件原子写 + sidecar 状态存储（D12/D13，P1-4）。
// atomicWriteText：同目录 tmp + rename 原子替换，一切状态落盘（state.yaml/manifests.yaml/任务文件）的底座。
// StateStore：.solutions/state.yaml 读写；YAML 为受限子集（两层 map + 标量），
// 只保证读回自己写出的内容；任何不符格式的字节一律视为损坏 → 空状态 + console.warn。
// fs 依赖经 globalThis.fs 注入（平台 isolate 注入 FsApi；测试注入 node:fs/promises 适配）。
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atomicWriteText } from "../../src/_platform/_lifecycle/atomic";
import { createStateStore } from "../../src/_platform/_lifecycle/state";

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

let root: string;

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-atomic-state-"));
	g.fs = nodeFsFace();
});

afterEach(async () => {
	g.fs = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

describe("atomicWriteText（D13）", () => {
	it("写入后读回内容逐字节完整（无半截态）", async () => {
		const p = join(root, "state.yaml");
		await atomicWriteText(p, "solutions:\n  demo:\n    version: \"1.0.0\"\n");
		expect(await fsp.readFile(p, "utf8")).toBe("solutions:\n  demo:\n    version: \"1.0.0\"\n");
	});

	it("并发双写交错完成后内容完整，无交错字节（最终为其中一份完整内容）", async () => {
		const p = join(root, "f.yaml");
		const contentA = `${"A".repeat(5000)}\n`;
		const contentB = `${"B".repeat(5000)}\n`;
		await Promise.all([atomicWriteText(p, contentA), atomicWriteText(p, contentB)]);
		const final = await fsp.readFile(p, "utf8");
		expect(final === contentA || final === contentB).toBe(true);
	});

	it("rename 失败（模拟 tmp 源缺失）时旧文件原样保留、tmp 清理、错误上抛", async () => {
		const p = join(root, "f.yaml");
		await atomicWriteText(p, "old\n");
		const base = nodeFsFace();
		let renameCalls = 0;
		g.fs = {
			...base,
			rename: (oldPath: string, newPath: string) => {
				renameCalls++;
				if (renameCalls === 1) {
					throw new Error("rename 源不存在（模拟）");
				}
				return base.rename(oldPath, newPath);
			},
		};
		await expect(atomicWriteText(p, "new\n")).rejects.toThrow(/rename 源不存在/);
		expect(await fsp.readFile(p, "utf8")).toBe("old\n");
		expect((await fsp.readdir(root)).sort()).toEqual(["f.yaml"]);
	});

	it("父目录不存在时自动创建（首装 .solutions/ 场景）", async () => {
		const p = join(root, ".solutions", "state.yaml");
		await atomicWriteText(p, "solutions: {}\n");
		expect(await fsp.readFile(p, "utf8")).toBe("solutions: {}\n");
	});
});

describe("stateStore（D12）", () => {
	it("write 后新实例 read 读回一致（落盘格式 round-trip，含 prerelease 版本与 enabled=false）", async () => {
		const p = join(root, ".solutions", "state.yaml");
		const store = await createStateStore(p);
		await store.write({
			solutions: {
				wiki: { version: "1.0.0-beta.1+build.5", enabled: false, installedAt: 1730000000001 },
				demo: { version: "0.2.0", enabled: true, installedAt: 1730000000000 },
			},
		});
		const again = await createStateStore(p);
		expect(again.read()).toEqual({
			solutions: {
				wiki: { version: "1.0.0-beta.1+build.5", enabled: false, installedAt: 1730000000001 },
				demo: { version: "0.2.0", enabled: true, installedAt: 1730000000000 },
			},
		});
	});

	it("patch 合并不丢其他方案键", async () => {
		const p = join(root, ".solutions", "state.yaml");
		const store = await createStateStore(p);
		await store.write({ solutions: { demo: { version: "1.0.0", enabled: true, installedAt: 1 } } });
		await store.write({ solutions: { wiki: { version: "2.0.0", enabled: true, installedAt: 2 } } });
		expect(store.read()).toEqual({
			solutions: {
				demo: { version: "1.0.0", enabled: true, installedAt: 1 },
				wiki: { version: "2.0.0", enabled: true, installedAt: 2 },
			},
		});
	});

	it("patch 值为 null 删除该方案键（GC/卸载删除出口）", async () => {
		const p = join(root, ".solutions", "state.yaml");
		const store = await createStateStore(p);
		await store.write({
			solutions: {
				demo: { version: "1.0.0", enabled: true, installedAt: 1 },
				wiki: { version: "2.0.0", enabled: true, installedAt: 2 },
			},
		});
		await store.write({ solutions: { demo: null as any } });
		expect(store.read()).toEqual({ solutions: { wiki: { version: "2.0.0", enabled: true, installedAt: 2 } } });
		const again = await createStateStore(p);
		expect(again.read()).toEqual({ solutions: { wiki: { version: "2.0.0", enabled: true, installedAt: 2 } } });
	});

	it("read 不存在的文件返回空状态不炸", async () => {
		const store = await createStateStore(join(root, "nope", "state.yaml"));
		expect(store.read()).toEqual({ solutions: {} });
	});

	it("read 返回快照：调用方改动不影响 store 后续读数", async () => {
		const store = await createStateStore(join(root, "state.yaml"));
		await store.write({ solutions: { demo: { version: "1.0.0", enabled: true, installedAt: 1 } } });
		const snapshot = store.read();
		snapshot.solutions.demo.version = "9.9.9";
		expect(store.read().solutions.demo.version).toBe("1.0.0");
	});

	it("损坏 yaml 返回空状态 + console.warn 告警不炸", async () => {
		const p = join(root, "state.yaml");
		await fsp.writeFile(p, "solutions:\n  demo:\n    version: [broken\n");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const store = await createStateStore(p);
			expect(store.read()).toEqual({ solutions: {} });
			expect(warn).toHaveBeenCalled();
		}
		finally {
			warn.mockRestore();
		}
	});

	it("盘上内容损坏时 write 以 patch 为基自愈重写（不因坏文件拒写）", async () => {
		const p = join(root, "state.yaml");
		await fsp.writeFile(p, "这不是状态文件");
		const store = await createStateStore(p);
		await store.write({ solutions: { demo: { version: "1.0.0", enabled: true, installedAt: 1 } } });
		const again = await createStateStore(p);
		expect(again.read()).toEqual({ solutions: { demo: { version: "1.0.0", enabled: true, installedAt: 1 } } });
	});

	it("非法条目（version 含换行）拒绝落盘，旧状态原样保留", async () => {
		const p = join(root, "state.yaml");
		const store = await createStateStore(p);
		await store.write({ solutions: { demo: { version: "1.0.0", enabled: true, installedAt: 1 } } });
		await expect(store.write({ solutions: { wiki: { version: "2.0.0\nenabled: true", enabled: true, installedAt: 2 } } }))
			.rejects
			.toThrow(/version/);
		expect(store.read().solutions.demo.version).toBe("1.0.0");
		expect(Object.keys(store.read().solutions)).toEqual(["demo"]);
	});
});
