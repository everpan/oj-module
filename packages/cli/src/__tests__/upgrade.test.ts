// BDD：`ojm upgrade`（计划 20261122-1055，9 场景）。
// 升级 = 评估（只读）→ 备份 → pnpm add 新 cli/runtime → 新 cli 跑 init --yes → 后置漂移检；
// 任一阶段失败回滚备份并报告（阶段 / 原始错误 / 备份路径）。
// 外部操作全注入：fetchFn（registry packument）/ runCmd（pnpm）/ spawnInit（新 cli init）/
// stageNewCli（下载解包目标版本 cli 到临时目录——测试用本地假模板树顶替）。
import type { UpgradeOptions } from "../upgrade";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeProject } from "../upgrade";

let proj: string;
let logs: string[];

/** 造一个最小 ojm 工程：钉版 package.json + 内置清单 + 保护根 + 自定义模块 + config */
function makeProject(cliVersion = "0.2.97") {
	proj = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-upgrade-"));
	fs.mkdirSync(path.join(proj, "src", "app", "api"), { recursive: true });
	fs.mkdirSync(path.join(proj, "src", "oj-market"), { recursive: true });
	fs.mkdirSync(path.join(proj, "src", "my-mod"), { recursive: true });
	fs.writeFileSync(path.join(proj, "src", ".ojm-builtin.json"), "[]\n");
	fs.writeFileSync(path.join(proj, "src", "app", "api", "x.ts"), "export const x = 1;\n");
	fs.writeFileSync(path.join(proj, "src", "oj-market", "m.ts"), "export const m = 1;\n");
	fs.writeFileSync(path.join(proj, "src", "my-mod", "mine.ts"), "// 自定义模块，升级不许碰\n");
	fs.writeFileSync(path.join(proj, "config.yaml"), "server:\n  port: 9781\n");
	fs.writeFileSync(path.join(proj, "package.json"), `${JSON.stringify({
		name: "demo",
		private: true,
		devDependencies: { "@oj-module/cli": cliVersion, "@oj-module/runtime": cliVersion },
	}, null, 2)}\n`);
	fs.writeFileSync(path.join(proj, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
	return proj;
}

/** registry packument 桩：cli/runtime 各给 dist-tags 与版本表 */
function registryStub(latest = "0.2.98", extra: { cliVersions?: string[], runtimeVersions?: string[] } = {}) {
	const cliVers = extra.cliVersions ?? [latest, "0.2.97"];
	const rtVers = extra.runtimeVersions ?? cliVers;
	const doc = (vers: string[]) => ({
		"dist-tags": { latest: vers[0] },
		"versions": Object.fromEntries(vers.map(v => [v, { version: v }])),
	});
	const calls: string[] = [];
	const fetchFn = (async (url: string | URL) => {
		const u = String(url);
		calls.push(u);
		if (u.includes("@oj-module%2fcli"))
			return { ok: true, status: 200, json: async () => doc(cliVers) } as Response;
		if (u.includes("@oj-module%2fruntime"))
			return { ok: true, status: 200, json: async () => doc(rtVers) } as Response;
		throw new Error(`stub 未覆盖：${u}`);
	}) as typeof fetch;
	return { fetchFn, calls };
}

/**
 * stageNewCli 桩：临时目录造一份「新版本」模板树（含 config.yaml）；runtimeVersion
 *  缺省 undefined——走 packument 配对裁决（与真实 defaultStage「快照缺省时回退」语义一致）
 */
function stageStub(version: string, runtimeVersion?: string) {
	const staged = { dir: "", runtimeVersion };
	const stageNewCli = async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ojm-stage-${version}-`));
		fs.mkdirSync(path.join(dir, "templates", "src", "app", "api"), { recursive: true });
		fs.mkdirSync(path.join(dir, "templates", "src", "oj-market"), { recursive: true });
		// 新模板：x.ts 内容升级 + 新增 y.ts；config.yaml 多一个顶层键
		fs.writeFileSync(path.join(dir, "templates", "src", "app", "api", "x.ts"), "export const x = 2;\n");
		fs.writeFileSync(path.join(dir, "templates", "src", "app", "api", "y.ts"), "export const y = 1;\n");
		fs.writeFileSync(path.join(dir, "templates", "src", "oj-market", "m.ts"), "export const m = 1;\n");
		fs.writeFileSync(path.join(dir, "templates", "init.include.yaml"), "include:\n  - src/app/api/x.ts\n  - src/app/api/y.ts\n  - src/oj-market/m.ts\n");
		fs.writeFileSync(path.join(dir, "templates", "config.yaml"), "server:\n  port: 9781\nnew_key: true\n");
		staged.dir = dir;
		return { dir, runtimeVersion: staged.runtimeVersion };
	};
	return { stageNewCli, staged };
}

function opts(over: Partial<UpgradeOptions> = {}): UpgradeOptions {
	return {
		yes: true,
		registry: "https://reg.example",
		fetchFn: registryStub().fetchFn,
		stageNewCli: stageStub("0.2.98").stageNewCli,
		runCmd: vi.fn(),
		// 默认 init 桩 = 正常完成职责：把保护根换成新模板内容（含新增 y.ts）
		spawnInit: vi.fn(() => {
			fs.writeFileSync(path.join(proj, "src", "app", "api", "x.ts"), "export const x = 2;\n");
			fs.writeFileSync(path.join(proj, "src", "app", "api", "y.ts"), "export const y = 1;\n");
		}),
		...over,
	};
}

const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const readPkg = () => JSON.parse(fs.readFileSync(path.join(proj, "package.json"), "utf8")) as { devDependencies: Record<string, string> };

beforeEach(() => {
	logs = [];
	vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => logs.push(a.map(String).join(" ")));
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(proj, { recursive: true, force: true });
});

describe("功能: 升级评估（只读）", () => {
	it("场景: 无 --yes → 打印评估（版本/漂移/受影响面声明），零写入", async () => {
		makeProject();
		const r = await upgradeProject(proj, opts({ yes: false }));

		expect(r.status).toBe("assessed");
		const out = logs.join("\n");
		expect(out).toContain("0.2.97");
		expect(out).toContain("0.2.98");
		expect(out).toContain("modified"); // 漂移预览：x.ts 本地版 vs 新模板
		expect(out).toContain("src/app/api/x.ts");
		expect(out).toContain("new_key"); // config.yaml 顶层键差集提示
		expect(out).toContain("--yes");
		// 零写入：无备份目录、package.json 未动、保护根未动
		expect(fs.existsSync(path.join(proj, ".ojm-upgrade"))).toBe(false);
		expect(readPkg().devDependencies["@oj-module/cli"]).toBe("0.2.97");
		expect(fs.readFileSync(path.join(proj, "src", "app", "api", "x.ts"), "utf8")).toBe("export const x = 1;\n");
	});

	it("场景: 已是最新版本 → 提示并零写入", async () => {
		makeProject("0.2.98");
		const r = await upgradeProject(proj, opts({ yes: true }));
		expect(r.status).toBe("up-to-date");
		expect(logs.join("\n")).toContain("已是最新");
		expect(fs.existsSync(path.join(proj, ".ojm-upgrade"))).toBe(false);
	});

	it("场景: --to 指定不存在的版本 → 拒绝（exit 原因），零写入", async () => {
		makeProject();
		await expect(upgradeProject(proj, opts({ to: "9.9.9" }))).rejects.toThrow(/9\.9\.9/);
		expect(fs.existsSync(path.join(proj, ".ojm-upgrade"))).toBe(false);
	});
});

describe("功能: 升级成功路径", () => {
	it("场景: --yes 全链路：评估→备份→pnpm add→新 cli init→后置漂移检", async () => {
		makeProject();
		const runCmd = vi.fn();
		// init 桩 = 正常完成职责：把保护根换成新模板内容（含新增 y.ts）
		const spawnInit = vi.fn(() => {
			fs.writeFileSync(path.join(proj, "src", "app", "api", "x.ts"), "export const x = 2;\n");
			fs.writeFileSync(path.join(proj, "src", "app", "api", "y.ts"), "export const y = 1;\n");
		});
		const { stageNewCli, staged } = stageStub("0.2.98");
		const r = await upgradeProject(proj, opts({ runCmd, spawnInit, stageNewCli }));

		expect(r.status).toBe("upgraded");
		expect(r.to).toBe("0.2.98");
		// S3：pnpm add 精确钉版 cli + runtime（lockstep 同版本）
		expect(runCmd).toHaveBeenCalledWith("pnpm", ["add", "-D", "@oj-module/cli@0.2.98", "@oj-module/runtime@0.2.98"], proj);
		// S4：新 cli 的 bin/ojm.mjs 跑 init --yes
		expect(spawnInit).toHaveBeenCalledTimes(1);
		const [binArg, binArgs, cwdArg] = spawnInit.mock.calls[0]! as unknown[];
		expect(String(binArg)).toContain(path.join("node_modules", "@oj-module", "cli", "bin", "ojm.mjs"));
		expect(binArgs).toEqual(["init", "--yes"]);
		expect(cwdArg).toBe(proj);
		expect(staged.dir).not.toBe(""); // 评估阶段确实拉了目标版本模板做漂移对比
		// S2：备份落盘且 sha256 清单可校验
		const backupDir = path.join(proj, ".ojm-upgrade", fs.readdirSync(path.join(proj, ".ojm-upgrade"))[0]!);
		const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8")) as { files: Array<{ rel: string, sha256: string }> };
		expect(manifest.files.some(f => f.rel === "package.json")).toBe(true);
		expect(manifest.files.some(f => f.rel === "src/app/api/x.ts")).toBe(true);
		for (const f of manifest.files)
			expect(sha(path.join(backupDir, f.rel))).toBe(f.sha256);
		// 受影响面之外逐字节不变
		expect(fs.readFileSync(path.join(proj, "src", "my-mod", "mine.ts"), "utf8")).toBe("// 自定义模块，升级不许碰\n");
		expect(fs.readFileSync(path.join(proj, "config.yaml"), "utf8")).toBe("server:\n  port: 9781\n");
	});

	it("场景: runtime 目标版本不存在 → 回退 runtime latest 并在输出注明", async () => {
		makeProject();
		const fetchFn = registryStub("0.2.98", { runtimeVersions: ["0.2.97"] }).fetchFn;
		const runCmd = vi.fn();
		await upgradeProject(proj, opts({ fetchFn, runCmd }));
		expect(runCmd).toHaveBeenCalledWith("pnpm", ["add", "-D", "@oj-module/cli@0.2.98", "@oj-module/runtime@0.2.97"], proj);
		expect(logs.join("\n")).toContain("runtime");
	});
});

describe("功能: 失败回滚（备份恢复 + 原因报告）", () => {
	it("场景: pnpm add 失败 → 恢复 package.json/lock 并重装，报告 S3 + 原始错误 + 备份路径", async () => {
		makeProject();
		const runCmd = vi.fn()
			.mockImplementationOnce(() => { throw new Error("ENOSPC"); }) // pnpm add 挂
			.mockImplementation(() => {}); // 回滚后的 pnpm install
		const spawnInit = vi.fn();
		await expect(upgradeProject(proj, opts({ runCmd, spawnInit }))).rejects.toThrow(/S3/);
		const out = logs.join("\n");
		expect(out).toContain("ENOSPC");
		expect(out).toContain(".ojm-upgrade");
		expect(out).toContain("回滚");
		// 恢复到位
		expect(readPkg().devDependencies["@oj-module/cli"]).toBe("0.2.97");
		expect(fs.readFileSync(path.join(proj, "pnpm-lock.yaml"), "utf8")).toBe("lockfileVersion: '9.0'\n");
		// 回滚后补一次 pnpm install（旧版本）
		expect(runCmd).toHaveBeenLastCalledWith("pnpm", ["install"], proj);
		// init 未执行
		expect(spawnInit).not.toHaveBeenCalled();
	});

	it("场景: init --yes 失败 → 保护根目录恢复 + 换版回退，报告 S4", async () => {
		makeProject();
		const runCmd = vi.fn();
		const spawnInit = vi.fn(() => {
			// init 半途改了保护根然后挂
			fs.writeFileSync(path.join(proj, "src", "app", "api", "x.ts"), "half-written");
			throw new Error("init boom");
		});
		await expect(upgradeProject(proj, opts({ runCmd, spawnInit }))).rejects.toThrow(/S4/);
		expect(fs.readFileSync(path.join(proj, "src", "app", "api", "x.ts"), "utf8")).toBe("export const x = 1;\n"); // 保护根还原
		expect(readPkg().devDependencies["@oj-module/cli"]).toBe("0.2.97");
		expect(logs.join("\n")).toContain("init boom");
	});

	it("场景: init 多出的脏文件也回滚（保护根内升级期新增文件被清除）", async () => {
		makeProject();
		const spawnInit = vi.fn(() => {
			fs.writeFileSync(path.join(proj, "src", "app", "api", "z-new.ts"), "new");
			throw new Error("fail after writes");
		});
		await expect(upgradeProject(proj, opts({ spawnInit }))).rejects.toThrow(/S4/);
		expect(fs.existsSync(path.join(proj, "src", "app", "api", "z-new.ts"))).toBe(false);
	});

	it("场景: 后置漂移检失败 → 全量回滚并点名残余漂移文件", async () => {
		makeProject();
		const spawnInit = vi.fn(() => {
			// init 没干活（模拟静默失败形态：保护根仍是旧内容）
		});
		await expect(upgradeProject(proj, opts({ spawnInit }))).rejects.toThrow(/S5/);
		expect(logs.join("\n")).toContain("src/app/api/x.ts"); // 残余漂移点名
		expect(fs.readFileSync(path.join(proj, "src", "app", "api", "x.ts"), "utf8")).toBe("export const x = 1;\n");
		expect(readPkg().devDependencies["@oj-module/cli"]).toBe("0.2.97");
	});
});

describe("功能: 备份轮换", () => {
	it("场景: 备份超过 3 份 → 最旧被清理", async () => {
		makeProject();
		const base = path.join(proj, ".ojm-upgrade");
		fs.mkdirSync(base, { recursive: true });
		for (const ts of ["backup-20261120000000", "backup-20261121000000", "backup-20261122000000"]) {
			fs.mkdirSync(path.join(base, ts));
			fs.writeFileSync(path.join(base, ts, "manifest.json"), "{}\n");
		}
		const { stageNewCli } = stageStub("0.2.98");
		const spawnInit = vi.fn(() => { // 正常完成 init 职责（保护根换新）
			fs.writeFileSync(path.join(proj, "src", "app", "api", "x.ts"), "export const x = 2;\n");
			fs.writeFileSync(path.join(proj, "src", "app", "api", "y.ts"), "export const y = 1;\n");
		});
		await upgradeProject(proj, opts({ stageNewCli, spawnInit }));
		const dirs = fs.readdirSync(base).filter(d => d.startsWith("backup-"));
		expect(dirs.length).toBe(3);
		expect(dirs).not.toContain("backup-20261120000000"); // 最旧轮换掉
	});
});
