// BDD：迁移步骤（P1-7，十阶段 stage 5 migrating，D11 核心裁决：迁移成功后才允许后续落锁）。
// 前置备份（R14）：sqlite 库 copy 为 <db>.bak-<ts>（fsFace.copyFile），无备份不迁移（fail-closed）；
// 完成后清理仅保留最近 3 份 .bak-*（按时间戳后缀数值比较）。
// S1-6 实测契约（oj 0.1.76）：exec.run(["oj","migrate","--format","json","-d",dir,module])，
// stdout 恰一行 JSON {"results":[{module,ok,applied:[{version,name}],error?}]}（装配期全局失败
// 顶层 error + results 空）；成败真源 = exit code（exit 0 = 全部成功），逐模块 continue-and-collect。
// rollbackGuard 纯函数：目标产物 max seq < 账本 head = 降版部署，禁止（OJ-9/M003 同源红线）；
// seq 为数值非版本号，直接数值比较（semver.ts 不适用）。
// exec/fs 面注入 stub（同 steps-fs 范式），不真跑 oj/sqlite。
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import type { StateStore } from "../../src/_platform/_lifecycle/state";
import type { ExecFace } from "../../src/_platform/_lifecycle/steps/extract";
import type { MigrateContext } from "../../src/_platform/_lifecycle/steps/migrate";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLock } from "../../src/_platform/_lifecycle/lock";
import { buildMigrateCmd, maxAppliedSeq, migrate, migrateSvcDirOf, parseMigrateOutput, rollbackGuard } from "../../src/_platform/_lifecycle/steps/migrate";

const g = globalThis as any;
const DB_BYTES = new TextEncoder().encode("sqlite-header-bytes\n");

/** S1-6 实测成功样例（逐字形态）：demo 应用 seq 3 一条迁移 */
const OK_LINE = JSON.stringify({ results: [{ module: "demo-solution", ok: true, applied: [{ version: 3, name: "create_todos" }] }] });

let root: string;
let dbPath: string;
let staging: string;

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-migrate-"));
	dbPath = join(root, "db.sqlite");
	await fsp.writeFile(dbPath, DB_BYTES);
	// §2.9 解包后的扁平 staging：api/<name>-<version>/ 为 oj build 产物模块目录（原生清单 + 迁移 SQL）
	staging = join(root, "modules", ".staging");
	const modDir = join(staging, "api", "demo-solution-0.1.0");
	await fsp.mkdir(join(modDir, "migrations"), { recursive: true });
	await fsp.writeFile(join(modDir, "manifest.yaml"), "name: demo-solution\ndesc: 演示方案\nversion: 0.1.0\n");
	await fsp.writeFile(join(modDir, "routes.js"), "export {};\n");
	await fsp.writeFile(join(modDir, "migrations", "0001__init.sql"), "CREATE TABLE note (id INTEGER PRIMARY KEY);\n");
	g.fs = nodeFsFace();
});

afterEach(async () => {
	g.fs = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

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

/** 记录 argv 的 exec stub（同 steps-fs 范式；handler 可模拟失败/违约输出） */
function recordingExec(handler?: (argv: string[]) => Promise<{ code: number, stdout: string, stderr: string }>): ExecFace & { calls: string[][], opts: (undefined | { timeoutMs?: number })[] } {
	const calls: string[][] = [];
	const opts: (undefined | { timeoutMs?: number })[] = [];
	return {
		calls,
		opts,
		run: async (argv, o) => {
			calls.push([...argv]);
			opts.push(o);
			return handler
				? handler(argv)
				: { code: 0, stdout: "", stderr: "" };
		},
	};
}

/** 恒成功且返回 S1-6 合同 JSON 的 exec stub（stdout 带尾随换行，oj 真实形态） */
function okExec(): ExecFace & { calls: string[][] } {
	return recordingExec(async () => ({ code: 0, stdout: `${OK_LINE}\n`, stderr: "" }));
}

/** 记录写入次数的 state stub（迁移步绝不允许触碰 state——锁前语义 D11） */
function recordingState(): StateStore & { writes: number } {
	const s = { writes: 0 } as StateStore & { writes: number };
	s.read = () => ({ solutions: {} });
	s.write = async () => {
		s.writes++;
	};
	return s;
}

function mgCtx(overrides: Partial<MigrateContext> = {}): MigrateContext {
	return {
		manifest: { name: "demo-solution", version: "0.1.0" },
		name: "demo-solution",
		version: "0.1.0",
		state: recordingState(),
		staging,
		dbPath,
		exec: okExec(),
		...overrides,
	};
}

describe("命令构造纯函数（exec 白名单逐字对齐，S1-2/S1-6）", () => {
	it("buildMigrateCmd 逐字：[oj, migrate, --format, json, -d, dir, module]", () => {
		expect(buildMigrateCmd("/site/dist", "demo-solution")).toEqual([
			"oj",
			"migrate",
			"--format",
			"json",
			"-d",
			"/site/dist",
			"demo-solution",
		]);
	});
});

describe("rollbackGuard（纯函数：true=放行，OJ-9 禁降版）", () => {
	it("首装放行：ledgerHead 为 null/undefined/0 一律放行", () => {
		expect(rollbackGuard(3, null)).toBe(true);
		expect(rollbackGuard(3, undefined)).toBe(true);
		expect(rollbackGuard(3, 0)).toBe(true);
		expect(rollbackGuard(3n, 0n)).toBe(true);
	});

	it("正常升级放行：目标 max seq ≥ head（含等值与 number/bigint 混比）", () => {
		expect(rollbackGuard(7, 5)).toBe(true);
		expect(rollbackGuard(5, 5)).toBe(true);
		expect(rollbackGuard(10n, 7)).toBe(true);
		expect(rollbackGuard(7, 7n)).toBe(true);
	});

	it("降版禁止：目标 max seq < head（OJ-9 红线）", () => {
		expect(rollbackGuard(5, 7)).toBe(false);
		expect(rollbackGuard(3n, 5)).toBe(false);
	});
});

describe("parseMigrateOutput（纯函数，S1-6 实测契约）", () => {
	it("实测样例逐字解析：results 三条、applied 取 {version:1, name:create_todos}、失败模块带 error", () => {
		const line = JSON.stringify({
			results: [
				{ module: "auth", ok: true, applied: [] },
				{ module: "demo", ok: true, applied: [{ version: 1, name: "create_todos" }] },
				{ module: "home", ok: false, applied: [], error: "at seq 2: `error applying migration V2__broken`" },
			],
		});
		const r = parseMigrateOutput(`${line}\n`);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.output.results).toHaveLength(3);
			expect(r.output.results[1]).toEqual({ module: "demo", ok: true, applied: [{ version: 1, name: "create_todos" }] });
			expect(r.output.results[2]!.ok).toBe(false);
		}
	});

	it("尾随换行/空白先 trim 再解析（stdout 恒带换行）", () => {
		const r = parseMigrateOutput(`  ${OK_LINE}\n\n`);
		expect(r.ok).toBe(true);
	});

	it("装配期全局失败形态：顶层 error + results 空数组，仍算合法输出（成败以 exit code 为真源）", () => {
		const r = parseMigrateOutput(JSON.stringify({ error: "refinery: DSN 已脱敏", results: [] }));
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.output.results).toHaveLength(0);
		}
	});

	it("非 JSON 输出拒（ok=false 带原因）", () => {
		const r = parseMigrateOutput("not-json at all");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.message).toContain("JSON");
	});

	it("顶层非键值对象（数组/标量/null）拒", () => {
		expect(parseMigrateOutput("[]").ok).toBe(false);
		expect(parseMigrateOutput("42").ok).toBe(false);
		expect(parseMigrateOutput("null").ok).toBe(false);
	});

	it("results 缺失或非数组拒", () => {
		expect(parseMigrateOutput("{}").ok).toBe(false);
		expect(parseMigrateOutput(JSON.stringify({ results: {} })).ok).toBe(false);
	});

	it("条目形状损坏拒：module 非字符串 / ok 非布尔 / applied 非数组 / applied 条目 version 非数字", () => {
		const bad = [
			{ results: [{ module: 1, ok: true, applied: [] }] },
			{ results: [{ module: "demo", ok: "yes", applied: [] }] },
			{ results: [{ module: "demo", ok: true, applied: {} }] },
			{ results: [{ module: "demo", ok: true, applied: [{ version: "1", name: "x" }] }] },
			{ results: ["demo"] },
		];
		for (const shape of bad) {
			expect(parseMigrateOutput(JSON.stringify(shape)).ok).toBe(false);
		}
	});
});

describe("maxAppliedSeq（目标产物 max seq，rollbackGuard 的 seq 来源）", () => {
	it("跨模块取最大 version；无 applied 返回 null", () => {
		const r = parseMigrateOutput(JSON.stringify({
			results: [
				{ module: "a", ok: true, applied: [{ version: 2, name: "x" }] },
				{ module: "b", ok: true, applied: [{ version: 7, name: "y" }, { version: 4, name: "z" }] },
			],
		}));
		expect(r.ok && maxAppliedSeq(r.output)).toBe(7);
		const empty = parseMigrateOutput(JSON.stringify({ results: [{ module: "a", ok: true, applied: [] }] }));
		expect(empty.ok && maxAppliedSeq(empty.output)).toBeNull();
	});
});

describe("p2-13 exec.spawn 流式路径（G2①：feature-detect 双路径；onStdout 回调内自累积跨块拼接）", () => {
	/** spawn stub：stdout 按 byteLength 切成多块（默认切在 UTF-8 双字节中文字符中间）异步吐出 */
	function spawnExec(output: string, opts: { code?: number, sliceAt?: number[] } = {}): ExecFace & { spawnCalls: number, opts: (undefined | { timeoutMs?: number })[] } {
		const bytes = new TextEncoder().encode(output);
		const cuts = opts.sliceAt ?? [5, 12];
		const chunks: Uint8Array[] = [];
		let prev = 0;
		for (const c of [...cuts, bytes.byteLength]) {
			if (c > prev && c <= bytes.byteLength) {
				chunks.push(bytes.slice(prev, c));
				prev = c;
			}
		}
		if (prev < bytes.byteLength) {
			chunks.push(bytes.slice(prev));
		}
		const self = {
			spawnCalls: 0,
			opts: [] as (undefined | { timeoutMs?: number })[],
			run: async (): Promise<{ code: number, stdout: string, stderr: string }> => {
				throw new Error("spawn 在场时不得回落 exec.run");
			},
			spawn: async (_argv: string[], o?: { timeoutMs?: number }) => {
				self.spawnCalls++;
				self.opts.push(o);
				async function* gen(list: Uint8Array[]) {
					for (const c of list)
						yield c;
				}
				return {
					stdout: gen(chunks),
					stderr: gen([new TextEncoder().encode("warn-line\n")]),
					exit: async () => ({ code: opts.code ?? 0 }),
					kill: () => {},
				};
			},
		};
		return self as unknown as ExecFace & { spawnCalls: number, opts: (undefined | { timeoutMs?: number })[] };
	}

	it("跨块拼接：S1-6 JSON 恰一行被切 3 块（含中文多字节边界）→ 解析成功、onMigrateOutput 捕获 applied max seq", async () => {
		const seen: { frac: number }[] = [];
		const outs: unknown[] = [];
		const exec = spawnExec(`${OK_LINE}\n`);
		const r = await migrate(mgCtx({
			exec,
			onProgress: frac => seen.push({ frac }),
			onMigrateOutput: o => outs.push(o),
		}));
		expect(r.ok).toBe(true);
		// 解析成功且 applied 捕获（跨 chunk 拼接后 parseMigrateOutput 拿到完整 JSON）
		expect(outs).toHaveLength(1);
		const out = outs[0] as { results: Array<{ applied: Array<{ version: number }> }> };
		const max = Math.max(...out.results.flatMap(x => x.applied.map(a => a.version)));
		expect(max).toBeGreaterThan(0);
		// 进度逐块上报且单调
		expect(seen.length).toBeGreaterThanOrEqual(3);
		for (let i = 1; i < seen.length; i++)
			expect(seen[i]!.frac).toBeGreaterThan(seen[i - 1]!.frac);
		expect(seen[seen.length - 1]!.frac).toBeLessThan(1);
	});

	it("spawn 在场：argv/timeoutMs 逐字转发；stdout 与 stderr 双流消费（背压语义不悬挂）", async () => {
		const exec = spawnExec(`${OK_LINE}\n`);
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(true);
		expect(exec.spawnCalls).toBe(1);
		expect(exec.opts[0]).toEqual({ timeoutMs: 600_000 });
	});

	it("spawn 超时/超限形态（code=137 不抛错，v0.1.79 订正）→ 迁移失败 retryable，stderr 摘要在场", async () => {
		const exec = spawnExec("", { code: 137 });
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("137");
		expect(r.message).toContain("warn-line");
	});

	it("无 spawn（回落 stage 粒度）：exec.run 缓冲路径照常（既有用例同路径，此处显式钉回落不炸）", async () => {
		const exec = okExec();
		const r = await migrate(mgCtx({ exec, onProgress: () => {
			throw new Error("缓冲路径不得触发进度回调");
		} }));
		expect(r.ok).toBe(true);
	});
});

describe("migrate（stage=migrating：R14 备份 → exec → 解析 → 禁降版守卫；绝触碰锁与 state）", () => {
	it("成功：备份文件存在且字节一致，exec argv 逐字对齐 buildMigrateCmd，state 零写入", async () => {
		const state = recordingState();
		const exec = okExec();
		const r = await migrate(mgCtx({ state, exec }));
		expect(r.stage).toBe("migrating");
		expect(r.ok).toBe(true);
		const baks = (await fsp.readdir(root)).filter(n => n.startsWith("db.sqlite.bak-"));
		expect(baks).toHaveLength(1);
		expect(new Uint8Array(await fsp.readFile(join(root, baks[0]!)))).toEqual(DB_BYTES);
		expect(exec.calls[0]).toEqual(buildMigrateCmd(migrateSvcDirOf(staging), "demo-solution"));
		// 超时显式取平台硬上限：oj exec.run timeoutMs 缺省 30s 会杀生产级长迁移（0.1.78 文档化口径）
		expect(exec.opts[0]).toEqual({ timeoutMs: 600_000 });
		expect(state.writes).toBe(0);
	});

	it("备份保留 3 份：完成后仅留最近 3 个 .bak-*（R14 清理策略）", async () => {
		await fsp.writeFile(`${dbPath}.bak-1000`, DB_BYTES);
		await fsp.writeFile(`${dbPath}.bak-2000`, DB_BYTES);
		await fsp.writeFile(`${dbPath}.bak-3000`, DB_BYTES);
		const r = await migrate(mgCtx());
		expect(r.ok).toBe(true);
		const baks = (await fsp.readdir(root)).filter(n => n.startsWith("db.sqlite.bak-"));
		expect(baks).toHaveLength(3);
		expect(baks.some(n => n.endsWith(".bak-1000"))).toBe(false);
	});

	it("备份清理 readdir 失败：迁移照常 ok，清理失败 note 并入 message（禁 console——release isolate console 抛 BadResource，Finding A）", async () => {
		const base = nodeFsFace();
		g.fs = {
			...base,
			readdir: (path: string) => (path === root ? Promise.reject(new Error("readdir 炸了")) : fsp.readdir(path)),
		};
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const r = await migrate(mgCtx());
			expect(r.ok).toBe(true);
			expect(r.message).toContain("备份清理失败");
			expect(r.message).toContain("readdir 炸了");
			expect(warn).not.toHaveBeenCalled();
		}
		finally {
			warn.mockRestore();
		}
	});

	it("oj migrate 失败（exit≠0）：ok=false retryable=true，stderr 摘要入 message，state 未变", async () => {
		const state = recordingState();
		const exec = recordingExec(async () => ({
			code: 1,
			stdout: JSON.stringify({ results: [{ module: "demo-solution", ok: false, applied: [], error: "at seq 2: migration V2__broken" }] }),
			stderr: "",
		}));
		const r = await migrate(mgCtx({ state, exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("exit 1");
		expect(r.message).toContain("at seq 2");
		expect(r.message).toContain(".bak-");
		expect(state.writes).toBe(0);
	});

	it("exit 0 但 stdout 非 JSON：ok=false retryable=false（输出契约破坏，重试不自愈）", async () => {
		const exec = recordingExec(async () => ({ code: 0, stdout: "segmentation fault", stderr: "" }));
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
	});

	it("exit 0 但 results 含 ok=false 模块：按失败处理，message 含模块名与 error 摘要", async () => {
		const line = JSON.stringify({ results: [{ module: "demo-solution", ok: false, applied: [], error: "incomplete input" }] });
		const exec = recordingExec(async () => ({ code: 0, stdout: line, stderr: "" }));
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("demo-solution");
		expect(r.message).toContain("incomplete input");
	});

	it("禁降版守卫：ledgerHead=5、applied max seq=3 → ok=false retryable=false 引降版红线；ledgerHead=3 放行", async () => {
		const state = recordingState();
		const blocked = await migrate(mgCtx({ state, ledgerHead: 5 }));
		expect(blocked.ok).toBe(false);
		expect(blocked.retryable).toBe(false);
		expect(blocked.message).toContain("降版");
		expect(state.writes).toBe(0);

		const allowed = await migrate(mgCtx({ ledgerHead: 3 }));
		expect(allowed.ok).toBe(true);
	});

	it("no-op（applied 空数组，同版重装）不触发禁降版判定：ledgerHead=5 仍 ok=true", async () => {
		const line = JSON.stringify({ results: [{ module: "demo-solution", ok: true, applied: [] }] });
		const exec = recordingExec(async () => ({ code: 0, stdout: line, stderr: "" }));
		const r = await migrate(mgCtx({ exec, ledgerHead: 5 }));
		expect(r.ok).toBe(true);
	});

	it("备份不可用（copyFile 抛错）：ok=false 且 exec 零调用（无备份不迁移，fail-closed）", async () => {
		const exec = okExec();
		const brokenFs = { ...nodeFsFace(), copyFile: async () => {
			throw new Error("EACCES");
		} };
		g.fs = brokenFs;
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("备份");
		expect(exec.calls.length).toBe(0);
	});

	it("exec 抛异常：ok=false retryable=true", async () => {
		const exec = recordingExec(async () => {
			throw new Error("NotCapable: exec requires module ownership");
		});
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
	});
});

// B-11：`oj migrate -d` 必须指向 oj release discover 可解析的目录——D11 迁移先于落锁，模块
// 尚不在站点锁内，站点 sharedRoot 不可作 -d；安装器物化「迁移服务目录」（staging 兄弟目录，
// release 形态 = 扁平锁 manifests.yaml + <name>-<version>/ 模块目录拷贝），oj is_release 判定
// （目录含 manifests.yaml 即 release）使 dev 站点上同样走 release discover（oj-bin serve_cmd.rs
// is_release + manifest.rs discover 真源）。运行前后svc 目录都不得残留。
describe("迁移服务目录（B-11：-d 指向 release 形态 svc 目录，oj discover 可解析）", () => {
	it("migrateSvcDirOf 布局推导：staging 兄弟目录 <staging>-migrate（相对/绝对路径同构）", () => {
		expect(migrateSvcDirOf("modules/.staging")).toBe("modules/.staging-migrate");
		expect(migrateSvcDirOf("/site/modules/.staging")).toBe("/site/modules/.staging-migrate");
	});

	it("物化 + 清场：svc 目录含扁平锁（恰一条目，D12）与模块目录全量拷贝（原生清单/迁移 SQL 随行）；exec -d 逐字指向；运行后清场", async () => {
		// svc 目录在 migrate 返回前已被 finally 清场——物化内容须在 exec（oj migrate 视角）运行时点验证
		let capturedDir: string | null = null;
		let lockSeen: Record<string, string> | null = null;
		let modFilesSeen: string[] | null = null;
		const exec = recordingExec(async (argv) => {
			capturedDir = argv[5] ?? null;
			lockSeen = parseLock(await fsp.readFile(join(capturedDir!, "manifests.yaml"), "utf8"));
			modFilesSeen = (await fsp.readdir(join(capturedDir!, "demo-solution-0.1.0"))).sort();
			await fsp.access(join(capturedDir!, "demo-solution-0.1.0", "migrations", "0001__init.sql"));
			return { code: 0, stdout: `${OK_LINE}\n`, stderr: "" };
		});
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(true);
		expect(capturedDir).toBe(migrateSvcDirOf(staging));
		expect(lockSeen).toEqual({ "demo-solution": "0.1.0" });
		expect(modFilesSeen).toEqual(["manifest.yaml", "migrations", "routes.js"]);
		// 运行后清场：svc 目录不得残留（staging 本体原样保留，lock_commit 的 rename 源）
		await expect(fsp.access(migrateSvcDirOf(staging))).rejects.toThrow();
		await fsp.access(join(staging, "api", "demo-solution-0.1.0", "manifest.yaml"));
	});

	it("失败路径（exit≠0）svc 目录同样清场（finally 语义）", async () => {
		const exec = recordingExec(async () => ({ code: 1, stdout: "", stderr: "boom" }));
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(false);
		await expect(fsp.access(migrateSvcDirOf(staging))).rejects.toThrow();
	});

	it("包内无 api/<name>-<version>/ 段（web-only 方案）：跳过迁移 ok=true，exec 与 R14 备份零触发", async () => {
		await fsp.rm(join(staging, "api"), { recursive: true });
		const exec = okExec();
		const r = await migrate(mgCtx({ exec }));
		expect(r.ok).toBe(true);
		expect(r.message).toContain("web-only");
		expect(exec.calls.length).toBe(0);
		const baks = (await fsp.readdir(root)).filter(n => n.startsWith("db.sqlite.bak-"));
		expect(baks).toHaveLength(0);
	});

	it("残留 svc 目录（上次崩溃遗留）：先清后建，不污染本次迁移输入", async () => {
		const svc = migrateSvcDirOf(staging);
		await fsp.mkdir(join(svc, "junk"), { recursive: true });
		await fsp.writeFile(join(svc, "manifests.yaml"), "evil: 9.9.9\n");
		const r = await migrate(mgCtx());
		expect(r.ok).toBe(true);
		await expect(fsp.access(join(svc, "junk"))).rejects.toThrow();
	});

	// oj 真机实测（0.1.78）：remove 不存在的路径即使 force:true 也抛 TypeError: invalid_argument
	// ——首装（无残留）不得被残留清除的报错挡死（真机冒烟 P1-13b 首轮失败根因）
	it("首装无残留：oj 语义 remove(missing) 抛 invalid_argument 不阻断物化", async () => {
		const ojLikeFs: FsFace = {
			...nodeFsFace(),
			remove: async (path, opts) => {
				await fsp.access(path);
				return fsp.rm(path, opts);
			},
		};
		g.fs = ojLikeFs;
		const r = await migrate(mgCtx());
		expect(r.ok).toBe(true);
		expect(r.message).toContain("迁移完成");
	});
});
