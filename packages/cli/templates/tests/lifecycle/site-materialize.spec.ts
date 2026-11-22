// BDD：站点物化 + catch-up 自愈 + verify 只读/--repair（实施计划 Phase 3 / P3-T1~T4）。
// 功能: 崩溃窗口自愈 / 巡检默认只看不修 / 断网不用过期货（cli 侧 fail-stale 见
// packages/cli/src/__tests__/installed-merge.test.ts）。
// db 用 installDb 真 sqlite 夹具（重放全部迁移，sys_module_overlay 表在场）；
// fs 为 globalThis.fs node 适配（同 installer.spec 范式）。
import type { FsFace } from "../../src/app/api/_platform/_lifecycle/atomic";
import type { StateStore } from "../../src/app/api/_platform/_lifecycle/state";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcile } from "../../src/app/api/_platform/_lifecycle/installer";
import { catchUpSiteModules, materialize, siteMaterialize } from "../../src/app/api/_platform/_lifecycle/site-materialize";
import { createStateStore } from "../../src/app/api/_platform/_lifecycle/state";
import { installDb } from "../fixture";

const g = globalThis as any;

let root: string;
let sharedRoot: string;
let dist: string;
let modulesJsonPath: string;
let siteModulesDir: string;
let state: StateStore;

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

/** 种 overlay 行（直接走真表，含 seq） */
async function seedOverlayRow(input: { name: string, version: string, enabled: number, face_ref?: string | null, seq?: number }) {
	const seq = input.seq ?? 1;
	await g.db.table("sys_module_overlay").insert({
		name: input.name,
		version: input.version,
		enabled: input.enabled,
		source: "solution",
		face_ref: input.face_ref ?? null,
		seq,
		actor: "spec",
		changed_at: 1_700_000_000,
		old_state: null,
	}).run();
	return seq;
}

/** 种 face 旁车（方案轨判定的真源） */
async function seedFace(name: string, version: string, entry: Record<string, unknown>) {
	const dir = join(siteModulesDir, name, version);
	await fsp.mkdir(dir, { recursive: true });
	await fsp.writeFile(join(dir, ".ojm-module.json"), `${JSON.stringify({ name, version, entry: `/modules/${name}/${version}/entry.js`, enabled: true, ...entry }, null, 2)}\n`);
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-site-materialize-"));
	sharedRoot = join(root, "modules");
	dist = join(root, "dist");
	siteModulesDir = join(dist, "modules");
	modulesJsonPath = join(dist, "modules.json");
	await fsp.mkdir(join(sharedRoot, ".solutions"), { recursive: true });
	await fsp.mkdir(dist, { recursive: true });
	g.fs = nodeFsFace();
	installDb();
	state = await createStateStore(join(sharedRoot, ".solutions", "state.yaml"));
});

afterEach(async () => {
	g.fs = undefined;
	g.db = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

describe("materialize 运行时语义（与 cli 侧构建期不同：原位替换 + 方案轨剔除）", () => {
	it("face 行：基线同名原位替换（位置保持），新版本升级就换代", () => {
		const baseline = [
			{ name: "system", enabled: true, version: "0.1.0" },
			{ name: "wiki", enabled: true, version: "0.1.0", entry: "/modules/wiki/0.1.0/entry.js" },
		];
		const out = materialize(baseline, [{ name: "wiki", version: "0.2.0", enabled: false, manifest: { entry: "/modules/wiki/0.2.0/entry.js" } }], new Set(["wiki"]));
		expect(out.map(m => m.name)).toEqual(["system", "wiki"]); // 位置保持
		expect(out[1]).toMatchObject({ version: "0.2.0", enabled: false, entry: "/modules/wiki/0.2.0/entry.js" });
	});

	it("dropNames 且无对应 face 行：方案轨残留剔除（卸载不复活）", () => {
		const baseline = [
			{ name: "system", enabled: true, version: "0.1.0" },
			{ name: "wiki", enabled: false, version: "0.1.0" },
		];
		const out = materialize(baseline, [], new Set(["wiki"]));
		expect(out.map(m => m.name)).toEqual(["system"]);
	});

	it("face 行撞非旁车同名条目且版本不同：双轨同名红线（文案与 cli 侧逐字一致）", () => {
		const baseline = [{ name: "wiki", enabled: true, version: "0.9.9" }];
		expect(() => materialize(baseline, [{ name: "wiki", version: "0.2.0", enabled: true, manifest: { entry: "/modules/wiki/0.2.0/entry.js" } }], new Set())).toThrow(
			"[ojm] 已装方案「wiki」与源码树模块同名（双轨同名红线）：请卸载该方案（ojm uninstall wiki）或改源码模块名后重建。",
		);
	});

	it("无 face 行 + 基线同名：叠启停掩码（builtin 停用）", () => {
		const out = materialize([{ name: "home", enabled: true, version: "1.0.0" }], [{ name: "home", version: "1.0.0", enabled: false }], new Set());
		expect(out[0]!.enabled).toBe(false);
	});
});

describe("功能: 崩溃窗口自愈（DB 写好文件没算就崩，下一 API 请求无感收敛）", () => {
	it("场景: 启停事务已提交但物化未执行 → catch-up 发现滞后，自动重算，文件与 DB 一致", async () => {
		await seedFace("wiki", "0.2.0", {});
		await seedOverlayRow({ name: "wiki", version: "0.2.0", enabled: 0, face_ref: "modules/wiki/0.2.0", seq: 5 });
		// 滞后文件：条目仍 enabled=true（物化未跑的 crash 窗口态）；cache 停在 seq 3
		await fsp.writeFile(modulesJsonPath, `${JSON.stringify([{ name: "wiki", version: "0.2.0", enabled: true, entry: "/modules/wiki/0.2.0/entry.js" }], null, 2)}\n`);
		await fsp.writeFile(join(sharedRoot, ".solutions", "overlay-cache.json"), `${JSON.stringify({ db_seq: 3, at: 1, actor: "old" })}\n`);

		const r = await catchUpSiteModules({ modulesJsonPath, sharedRoot, state, actor: "catch-up" });
		expect(r).not.toBeNull();
		expect(r!.changed).toBe(true);

		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8")) as Array<{ name: string, enabled: boolean }>;
		expect(list.find(m => m.name === "wiki")!.enabled).toBe(false); // 与 DB 一致
		const cache = JSON.parse(await fsp.readFile(join(sharedRoot, ".solutions", "overlay-cache.json"), "utf8")) as { db_seq: number };
		expect(cache.db_seq).toBe(5); // 标记推进，下次不再重算

		const again = await catchUpSiteModules({ modulesJsonPath, sharedRoot, state, actor: "catch-up" });
		expect(again!.changed).toBe(false); // 幂等：已对齐零写入
	});

	it("场景: 崩溃在 DB 写与 sidecar 写之间 → 物化顺带愈合 sidecar（enabled/overlay_seq 补齐）", async () => {
		await seedFace("wiki", "0.2.0", {});
		await seedOverlayRow({ name: "wiki", version: "0.2.0", enabled: 0, face_ref: "modules/wiki/0.2.0", seq: 7 });
		await state.write({ solutions: { wiki: { version: "0.2.0", enabled: true, installedAt: 1 } } }); // sidecar 滞后（crash 窗）

		await siteMaterialize({ modulesJsonPath, sharedRoot, state });

		const healed = state.read().solutions.wiki!;
		expect(healed.enabled).toBe(false);
		expect(healed.overlay_seq).toBe(7);
	});

	it("场景: overlay 表不可达（老平台）→ catch-up 不动作（null，legacy 回落）", async () => {
		g.db = undefined;
		const r = await catchUpSiteModules({ modulesJsonPath, sharedRoot, state });
		expect(r).toBeNull();
	});
});

describe("功能: 巡检默认只看不修（verify --repair 语义，reconcile repair 旗标）", () => {
	async function seedStale() {
		await seedFace("wiki", "0.2.0", {});
		await seedOverlayRow({ name: "wiki", version: "0.2.0", enabled: 0, face_ref: "modules/wiki/0.2.0", seq: 9 });
		await fsp.writeFile(join(sharedRoot, "manifests.yaml"), "wiki: 0.2.0\nother: 0.1.0\n");
		await fsp.writeFile(modulesJsonPath, `${JSON.stringify([{ name: "wiki", version: "0.2.0", enabled: true, entry: "/modules/wiki/0.2.0/entry.js" }], null, 2)}\n`);
		await fsp.writeFile(join(sharedRoot, ".solutions", "overlay-cache.json"), `${JSON.stringify({ db_seq: 4, at: 1, actor: "old" })}\n`);
	}

	const baseInput = () => ({
		lockPath: join(sharedRoot, "manifests.yaml"),
		sharedRoot,
		taskDir: join(sharedRoot, ".install-tasks"),
		modulesJsonPath,
		state,
		ledgerHeadOf: async () => null,
		headFloorOf: async () => null,
	});

	it("例子: mode=默认 → 报告滞后（modules_json_stale），文件不被修改", async () => {
		await seedStale();
		const before = await fsp.readFile(modulesJsonPath, "utf8");

		const report = await reconcile(baseInput());

		expect(report.inconsistencies.some(i => i.kind === "modules_json_stale")).toBe(true);
		expect(await fsp.readFile(modulesJsonPath, "utf8")).toBe(before); // 只报不修
	});

	it("例子: mode=--repair（repair:true）→ 重算并报告已修复（healed 记 materialize）", async () => {
		await seedStale();
		const report = await reconcile({ ...baseInput(), repair: true });

		expect(report.inconsistencies.some(i => i.kind === "modules_json_stale")).toBe(false);
		expect(report.healed.some(h => h.action === "materialize")).toBe(true);
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8")) as Array<{ name: string, enabled: boolean }>;
		expect(list.find(m => m.name === "wiki")!.enabled).toBe(false); // 已修复与 DB 一致
	});
});

describe("siteMaterialize 写盘纪律", () => {
	it("内容零变化 → 不重写文件（mtime 不扰动 no-cache/304 消费面）", async () => {
		await seedFace("wiki", "0.2.0", {});
		await seedOverlayRow({ name: "wiki", version: "0.2.0", enabled: 1, face_ref: "modules/wiki/0.2.0", seq: 2 });
		const first = await siteMaterialize({ modulesJsonPath, sharedRoot, state });
		expect(first.changed).toBe(true);
		const mtime = (await fsp.stat(modulesJsonPath)).mtimeMs;
		const second = await siteMaterialize({ modulesJsonPath, sharedRoot, state });
		expect(second.changed).toBe(false);
		expect((await fsp.stat(modulesJsonPath)).mtimeMs).toBe(mtime); // 零写入
	});

	it("基线损坏 → fail-loud 拒产（绝不覆盖他模块条目）", async () => {
		await fsp.writeFile(modulesJsonPath, "not-json");
		await expect(siteMaterialize({ modulesJsonPath, sharedRoot, state })).rejects.toThrow(/物化失败：modules\.json 不可读或损坏/);
		expect(await fsp.readFile(modulesJsonPath, "utf8")).toBe("not-json");
	});
});

// BDD：物化可观测（实施计划 Phase 4 / P4-T1+P4-T2）——结构化日志带 actor/db_seq/lag，
// catch-up 连续失败计数达上限告警（启动探针 = catch-up 滞后检测，拓扑声明见 runbook）。
describe("功能: 物化可观测（结构化日志 + 滞后指标 + 重试上限告警）", () => {
	it("物化落结构化日志：event/actor/db_seq/changed/lag_sec/entries 字段齐", async () => {
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => logs.push(a.map(String).join(" ")));
		try {
			await seedFace("wiki", "0.2.0", {});
			await seedOverlayRow({ name: "wiki", version: "0.2.0", enabled: 0, face_ref: "modules/wiki/0.2.0", seq: 5 });
			await fsp.writeFile(join(sharedRoot, ".solutions", "overlay-cache.json"), `${JSON.stringify({ db_seq: 3, at: Date.now() - 60_000, actor: "old" })}\n`);
			await catchUpSiteModules({ modulesJsonPath, sharedRoot, state, actor: "catch-up" });
		}
		finally {
			spy.mockRestore();
		}
		const line = logs.find(l => l.includes("\"site-materialize\""));
		expect(line, "应有 site-materialize 结构化日志").toBeTruthy();
		const evt = JSON.parse(line!) as Record<string, unknown>;
		expect(evt).toMatchObject({ event: "site-materialize", actor: "catch-up", db_seq: 5, changed: true });
		expect(typeof evt.lag_sec).toBe("number"); // 滞后指标：cache.at 距本次物化的秒数
		expect(evt.entries).toBe(1);
	});

	it("catch-up 连续失败累计计数，达 5 次告警（site-materialize-alarm），成功后清零", async () => {
		await fsp.writeFile(modulesJsonPath, "not-json"); // 基线损坏：物化必 fail-loud
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => logs.push(a.map(String).join(" ")));
		try {
			for (let i = 1; i <= 5; i++) {
				await expect(catchUpSiteModules({ modulesJsonPath, sharedRoot, state })).rejects.toThrow();
				const cache = JSON.parse(await fsp.readFile(join(sharedRoot, ".solutions", "overlay-cache.json"), "utf8")) as { fail_count?: number };
				expect(cache.fail_count ?? 0).toBe(i); // 计数持久化（跨请求累计）
			}
			expect(logs.some(e => e.includes("site-materialize-alarm")), "第 5 次失败应告警（console 通道）").toBe(true);
			const jsonl = await fsp.readFile(join(sharedRoot, ".solutions", "site-materialize.jsonl"), "utf8");
			expect(jsonl.includes("site-materialize-alarm"), "告警同条持久化 jsonl").toBe(true);
			// 修复基线 → 成功 → 计数清零
			await fsp.writeFile(modulesJsonPath, "[]\n");
			await catchUpSiteModules({ modulesJsonPath, sharedRoot, state });
			const cache = JSON.parse(await fsp.readFile(join(sharedRoot, ".solutions", "overlay-cache.json"), "utf8")) as { fail_count?: number };
			expect(cache.fail_count ?? 0).toBe(0);
		}
		finally {
			spy.mockRestore();
		}
	});

	it("console 通道不可用（oj serve detached 上下文 BadResource）→ 物化不受影响，日志落 jsonl 文件", async () => {
		await seedFace("wiki", "0.2.0", {});
		await seedOverlayRow({ name: "wiki", version: "0.2.0", enabled: 1, face_ref: "modules/wiki/0.2.0", seq: 5 });
		const spy = vi.spyOn(console, "log").mockImplementation(() => {
			throw new Error("BadResource: Bad resource ID"); // 真机 oj serve 实证形态
		});
		try {
			const r = await siteMaterialize({ modulesJsonPath, sharedRoot, state, actor: "drill" });
			expect(r.ok).toBe(true); // 日志绝不允许反噬物化主流程
		}
		finally {
			spy.mockRestore();
		}
		const jsonl = await fsp.readFile(join(sharedRoot, ".solutions", "site-materialize.jsonl"), "utf8");
		const evt = JSON.parse(jsonl.trim().split("\n").at(-1)!) as Record<string, unknown>;
		expect(evt).toMatchObject({ event: "site-materialize", actor: "drill", db_seq: 5 });
	});
});
