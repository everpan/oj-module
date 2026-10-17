// BDD：下载/校验/解压三步（P1-6，S1-2 裁决范式）。
// download = fetch → fs.writeFile（落 .staging/<archive.file>，S1-2.3）；verify = sha256 fail-closed
// 比对（C2-29；P1 无签名阶段 CDN 与安装器同信任域，仅防传输损坏不防投毒——设计 §9 补充①）；
// extract = list→validate→extract 三步（R1 zip-slip 防护）：-tvzf listing（消费方铁律①）trim 尾部
// 空行（铁律②）后过 validateTarListing，任一恶意成员全拒则零解压零落盘。
// 命令构造为纯函数，argv 逐字断言（与平台 exec 白名单逐字对齐，S1-2 基座）；
// exec/fetch/sha256 面经 ctx 注入 stub，不真跑网络；合法夹具集成用例的 exec stub 落到真实系统 tar
// （与生产同路径：isolate 不内嵌解压，exec.run 系统 tar）。
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import type { StateStore } from "../../src/_platform/_lifecycle/state";
import type { DownloadContext } from "../../src/_platform/_lifecycle/steps/download";
import type { ExecFace, ExtractContext } from "../../src/_platform/_lifecycle/steps/extract";
import type { VerifyContext } from "../../src/_platform/_lifecycle/steps/verify";
import { execFile as execFileCb } from "node:child_process";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archiveFileOf, download } from "../../src/_platform/_lifecycle/steps/download";
import { buildExtractCmd, buildListCmd, extract } from "../../src/_platform/_lifecycle/steps/extract";
import { verify } from "../../src/_platform/_lifecycle/steps/verify";

const execFileP = promisify(execFileCb);
const g = globalThis as any;

const FILE = "demo-solution-0.1.0.tgz";
const BYTES = new TextEncoder().encode("demo-archive-bytes\n");
const shaOf = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");

function nodeFsFace(): FsFace {
	return {
		writeFile: (path, data) => fsp.writeFile(path, data),
		readFile: path => fsp.readFile(path),
		mkdir: (path, opts) => fsp.mkdir(path, opts),
		remove: (path, opts) => fsp.rm(path, opts),
		rename: (oldPath, newPath) => fsp.rename(oldPath, newPath),
	};
}

function stateStore(): StateStore {
	return { read: () => ({ solutions: {} }), write: async () => {} };
}

function manifest(archive: Record<string, unknown> = { file: FILE, sha256: shaOf(BYTES), size: BYTES.byteLength }): any {
	return { name: "demo-solution", version: "0.1.0", archive };
}

let root: string;
let staging: string;

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-steps-fs-"));
	staging = join(root, "modules", ".staging");
	g.fs = nodeFsFace();
});

afterEach(async () => {
	g.fs = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

/** 记录 argv 的 exec stub（默认恒成功；handler 可模拟失败） */
function recordingExec(handler?: (argv: string[]) => Promise<{ code: number, stdout: string, stderr: string }>): ExecFace & { calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		run: async (argv) => {
			calls.push([...argv]);
			return handler
				? handler(argv)
				: { code: 0, stdout: "", stderr: "" };
		},
	};
}

/** 落到真实系统 tar 的 exec stub（生产同路径） */
function realTarExec(): ExecFace & { calls: string[][] } {
	return recordingExec(async (argv) => {
		try {
			const { stdout, stderr } = await execFileP(argv[0]!, argv.slice(1));
			return { code: 0, stdout, stderr };
		}
		catch (e: any) {
			return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) };
		}
	});
}

function dlCtx(overrides: Partial<DownloadContext> = {}): DownloadContext {
	return {
		manifest: manifest(),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		archiveUrl: `https://cdn.example.com/${FILE}`,
		staging,
		fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => BYTES.slice().buffer as ArrayBuffer }),
		...overrides,
	};
}

function vfCtx(overrides: Partial<VerifyContext> = {}): VerifyContext {
	return {
		manifest: manifest(),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		staging,
		sha256Hex: shaOf,
		...overrides,
	};
}

function exCtx(overrides: Partial<ExtractContext> = {}): ExtractContext {
	return {
		manifest: manifest(),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		staging,
		exec: recordingExec(),
		...overrides,
	};
}

describe("命令构造纯函数（无 exec；argv 逐字断言，exec 白名单对齐 S1-2）", () => {
	it("buildListCmd 逐字：[tar, -tvzf, file]", () => {
		expect(buildListCmd("/m/.staging/demo-solution-0.1.0.tgz")).toEqual([
			"tar",
			"-tvzf",
			"/m/.staging/demo-solution-0.1.0.tgz",
		]);
	});

	it("列表命令必须 verbose 形态（铁律①：非 verbose 裸名撞 l/h 误拒，禁退化 -tzf）", () => {
		const argv = buildListCmd("x.tgz");
		expect(argv).toContain("-tvzf");
		expect(argv).not.toContain("-tzf");
	});

	it("buildExtractCmd 逐字：[tar, -xzf, file, -C, staging]（-C 限定目标目录）", () => {
		expect(buildExtractCmd("/m/.staging/x.tgz", "/m/.staging")).toEqual([
			"tar",
			"-xzf",
			"/m/.staging/x.tgz",
			"-C",
			"/m/.staging",
		]);
	});

	it("archiveFileOf：合法 Form B 提取 file（archive 段随行返回供 verify 取 sha256）", () => {
		const r = archiveFileOf(manifest());
		expect(r.ok).toBe(true);
		expect(r.ok && r.file).toBe(FILE);
	});

	it("archiveFileOf：archive 段缺失拒（C2-29）", () => {
		const r = archiveFileOf({ name: "demo-solution" });
		expect(r.ok).toBe(false);
		expect(!r.ok && r.message).toContain("C2-29");
	});

	it("archiveFileOf：路径穿越/分隔符形态拒（C2-29 安全形态，信任边界）", () => {
		for (const file of ["../evil.tgz", "a/b.tgz", ".hidden.tgz", "", ".."]) {
			const r = archiveFileOf(manifest({ file }));
			expect(r.ok).toBe(false);
			expect(!r.ok && r.message).toContain("C2-29");
		}
	});
});

describe("download（stage=downloading，S1-2.3 fetch→fs.writeFile）", () => {
	it("成功：落盘 .staging/<archive.file>，staging 不存在自动创建，字节完整", async () => {
		const r = await download(dlCtx());
		expect(r.stage).toBe("downloading");
		expect(r.ok).toBe(true);
		expect(new Uint8Array(await fsp.readFile(join(staging, FILE)))).toEqual(BYTES);
	});

	it("hTTP 非 2xx：ok=false retryable=true，message 带状态码与附录 A 引用，零落盘", async () => {
		const r = await download(dlCtx({ fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("下载失败");
		expect(r.message).toContain("404");
		expect(r.message).toContain("附录 A");
		await expect(fsp.readdir(staging)).rejects.toThrow();
	});

	it("fetch 抛错（网络异常）：ok=false retryable=true", async () => {
		const r = await download(dlCtx({ fetch: async () => {
			throw new Error("ECONNREFUSED");
		} }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("下载失败");
	});

	it("archive.file 缺失（Form A 占位无身份）：ok=false retryable=false 引 C2-29，fetch 零调用", async () => {
		let calls = 0;
		const r = await download(dlCtx({
			manifest: manifest({}),
			fetch: async () => {
				calls++;
				return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
			},
		}));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("C2-29");
		expect(calls).toBe(0);
	});
});

describe("verify（stage=verifying，C2-29 sha256 fail-closed）", () => {
	async function seed(): Promise<void> {
		await fsp.mkdir(staging, { recursive: true });
		await fsp.writeFile(join(staging, FILE), BYTES);
	}

	it("成功：sha256 与索引一致 → ok=true", async () => {
		await seed();
		const r = await verify(vfCtx());
		expect(r.stage).toBe("verifying");
		expect(r.ok).toBe(true);
	});

	it("摘要不符：ok=false retryable=true，message 引 C2-29 且含实得摘要", async () => {
		await seed();
		const r = await verify(vfCtx({ manifest: manifest({ file: FILE, sha256: "0".repeat(64), size: 1 }) }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("C2-29");
		expect(r.message).toContain(shaOf(BYTES));
	});

	it("archive.sha256 缺失：fail-closed 拒（retryable=false，Form A 占位不可用于安装校验）", async () => {
		await seed();
		const r = await verify(vfCtx({ manifest: manifest({ file: FILE }) }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("C2-29");
		expect(r.message).toContain("fail-closed");
	});

	it("盘上文件缺失：ok=false retryable=true（附录 A verifying：请重试下载）", async () => {
		const r = await verify(vfCtx());
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("附录 A");
	});

	it("摘要能力不可用（ctx 未注入且运行时全局无 sha256Hex）：fail-closed 不静默跳过", async () => {
		await seed();
		expect((g.crypto ?? {}).sha256Hex).toBeUndefined();
		const { sha256Hex: _drop, ...without } = vfCtx();
		const r = await verify(without as VerifyContext);
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("fail-closed");
	});
});

describe("extract（stage=extracting，R1 list→validate→extract 三步）", () => {
	it("合法夹具集成（真实系统 tar）：解压后目录树断言，两次 exec argv 逐字对齐命令构造", async () => {
		const pkg = join(root, "pkg", "demo-solution-0.1.0");
		await fsp.mkdir(join(pkg, "src"), { recursive: true });
		await fsp.writeFile(join(pkg, "manifest.yaml"), "name: demo-solution\n");
		await fsp.writeFile(join(pkg, "src", "entry.js"), "export default {};\n");
		await fsp.mkdir(staging, { recursive: true });
		const tgz = join(staging, FILE);
		await execFileP("tar", ["-czf", tgz, "-C", join(root, "pkg"), "demo-solution-0.1.0"]);

		const exec = realTarExec();
		const r = await extract(exCtx({ exec }));
		expect(r.stage).toBe("extracting");
		expect(r.ok).toBe(true);
		expect(await fsp.readFile(join(staging, "demo-solution-0.1.0", "manifest.yaml"), "utf8")).toBe("name: demo-solution\n");
		expect(await fsp.readFile(join(staging, "demo-solution-0.1.0", "src", "entry.js"), "utf8")).toBe("export default {};\n");
		expect(exec.calls[0]).toEqual(buildListCmd(tgz));
		expect(exec.calls[1]).toEqual(buildExtractCmd(tgz, staging));
	});

	it("恶意 listing（symlink + `..` 成员）：validate 段全拒，零解压零落盘（exec 仅 1 次列表调用）", async () => {
		const exec = recordingExec(async () => ({
			code: 0,
			stdout: [
				"-rw-r--r--  0 ever staff    7 10 17 12:00 demo-solution-0.1.0/manifest.yaml",
				"lrwxr-xr-x  0 ever staff    0 10 17 12:00 demo-solution-0.1.0/link -> /etc/passwd",
				"-rw-r--r--  0 ever staff    7 10 17 12:00 ../evil",
			].join("\n"),
			stderr: "",
		}));
		await fsp.mkdir(staging, { recursive: true });
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("R1");
		expect(r.message).toContain("零解压");
		expect(r.message).toContain("demo-solution-0.1.0/link");
		expect(exec.calls.length).toBe(1);
		expect(exec.calls[0]).toEqual(buildListCmd(join(staging, FILE)));
		expect(await fsp.readdir(staging)).toEqual([]);
	});

	it("列表命令失败（exit≠0）：ok=false retryable=true，stderr 入 message", async () => {
		const exec = recordingExec(async () => ({ code: 2, stdout: "", stderr: "tar: unrecognized format" }));
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("tar: unrecognized format");
		expect(exec.calls.length).toBe(1);
	});

	it("解压命令失败（合法 listing 后 exit≠0）：ok=false retryable=true", async () => {
		const clean = "-rw-r--r--  0 ever staff    7 10 17 12:00 demo-solution-0.1.0/manifest.yaml";
		const exec = recordingExec(async argv => argv[1] === "-xzf"
			? { code: 1, stdout: "", stderr: "tar: cannot extract" }
			: { code: 0, stdout: clean, stderr: "" });
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("解压失败");
		expect(exec.calls.length).toBe(2);
	});

	it("铁律②：尾部多空行的 listing 先 trim 再校验，合法成员照常放行", async () => {
		const exec = recordingExec(async () => ({
			code: 0,
			stdout: "-rw-r--r--  0 ever staff    7 10 17 12:00 demo-solution-0.1.0/manifest.yaml\n\n\n",
			stderr: "",
		}));
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(true);
		expect(exec.calls.length).toBe(2);
	});

	it("空 listing：退化行=空成员名，fail-closed 拒绝", async () => {
		const exec = recordingExec(async () => ({ code: 0, stdout: "", stderr: "" }));
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("R1");
		expect(exec.calls.length).toBe(1);
	});
});
