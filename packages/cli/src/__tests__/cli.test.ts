import type { Lang } from "../usage";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCli, rewriteHelpArgv } from "../cli";

/**
 * dispatch 契约（cac 驱动后）：
 *  - 帮助请求不执行 action（market setup --help 不建 CDN）
 *  - 未知命令触发 command:*（index.ts 兜底打帮助 + exit 1）
 *  - 校验从 parse*Args 搬入 action 后行为保持（new --layout / vendor tag）
 *  - 位置参数与 variadic 映射（merge out in1 in2）
 *  - --bundle 值映射到 buildBundle
 *  - help 词形重写（ojm help <cmd> → <cmd> --help）
 */

const logs: string[] = [];
let exitSpy: ReturnType<typeof vi.fn>;

// 提升式 mock：vitest 测试体内注册的 vi.mock 拦不到 cli.ts 的 dynamic import，须 hoisted 顶层注册
const buildBundleMock = vi.hoisted(() => vi.fn(async () => [{ file: "x.tgz" }]));
vi.mock("../bundle", () => ({ buildBundle: buildBundleMock }));
const vendorCommandMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../vendor", () => ({ vendorCommand: vendorCommandMock }));

beforeEach(() => {
	logs.length = 0;
	exitSpy = vi.fn();
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => logs.push(args.join(" ")));
	vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => logs.push(args.join(" ")));
});

afterEach(() => {
	vi.restoreAllMocks();
	buildBundleMock.mockClear();
	vendorCommandMock.mockClear();
});

interface RunResult { out: string, unknown: string[], exitCode: number | undefined }

/** 跑一次 parse：捕获输出、command:* 与 exit；动作异步链经条件轮询拍平（vitest 下 dynamic import 解析需数百毫秒） */
async function run(argv: string[], lang: Lang, cwd: string, until?: () => boolean): Promise<RunResult> {
	const cli = buildCli(cwd, lang, { exit: exitSpy as unknown as (code: number) => never });
	const unknown: string[] = [];
	cli.on("command:*", () => unknown.push(String(cli.args[0])));
	cli.parse(["node", "ojm", ...argv], { run: true });
	try {
		await vi.waitUntil(() => logs.length > 0 || exitSpy.mock.calls.length > 0 || unknown.length > 0 || !!until?.(), { timeout: 2500, interval: 10 });
	}
	catch {
		// 无输出型动作（如帮助打屏后无日志）：兜底继续
	}
	await new Promise(r => setTimeout(r, 50));
	return { out: logs.join("\n"), unknown, exitCode: exitSpy.mock.calls[0]?.[0] as number | undefined };
}

let tmp: string;
beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-cli-test-"));
});

describe("帮助不执行 action", () => {
	it("子命令 --help 只出单命令帮助（不叠顶层分组帮助）", async () => {
		// 回归：cac --help 后 unsetMatchedCommand 会让 args[0]=子命令，误叠顶层帮助（index.ts 已按 options.help 过滤）
		const r = await run(["market", "verify", "--help"], "zh-CN", tmp);
		expect(r.out).toContain("离线验包");
		expect(r.out).not.toContain("oj 子命令透传");
	});

	it("market setup --help 打帮助、不触发 setup、不 exit", async () => {
		const r = await run(["market", "setup", "--help"], "zh-CN", tmp);
		expect(r.out).toContain("market");
		expect(r.out).not.toContain("[ojm] 站点");
		expect(r.exitCode).toBeUndefined();
		expect(exitSpy).not.toHaveBeenCalled();
	});
});

describe("单命令帮助（双语）", () => {
	it("build --help 中文：语法 + 选项 + 详解", async () => {
		const r = await run(["build", "--help"], "zh-CN", tmp);
		expect(r.out).toContain("ojm build");
		expect(r.out).toContain("--bundle");
		expect(r.out).toContain("构建后端");
	});

	it("build --help 英文", async () => {
		const r = await run(["build", "--help"], "en-US", tmp);
		expect(r.out).toContain("Builds the backend");
	});

	it("market verify --help 按子命令注入详解（中/英）", async () => {
		expect((await run(["market", "verify", "--help"], "zh-CN", tmp)).out).toContain("离线验包");
		expect((await run(["market", "verify", "--help"], "en-US", tmp)).out).toMatch(/offline/i);
	});

	it("trust add --help 按子命令注入详解（中/英）", async () => {
		expect((await run(["trust", "add", "--help"], "zh-CN", tmp)).out).toContain("新增信任");
		expect((await run(["trust", "add", "--help"], "en-US", tmp)).out).toContain("64-hex public key");
	});
});

describe("未知命令与兜底", () => {
	it("未知命令触发 command:*", async () => {
		const r = await run(["nope"], "zh-CN", tmp);
		expect(r.unknown).toEqual(["nope"]);
	});
});

describe("校验搬入 action 后行为保持", () => {
	it("new 多余位置参数显式拒绝（F8）", async () => {
		const r = await run(["new", "crm", "erp"], "zh-CN", tmp);
		expect(r.out).toContain("只接受一个方案名");
		expect(r.exitCode).toBe(1);
	});

	it("new --layout 非 container|none 报错", async () => {
		const r = await run(["new", "demo", "--layout", "bogus"], "zh-CN", tmp);
		expect(r.out).toContain("--layout 只接受 container | none");
		expect(r.exitCode).toBe(1);
	});

	it("new 缺 name 打印用法并 exit 1", async () => {
		const r = await run(["new"], "zh-CN", tmp);
		expect(r.out).toContain("ojm new <name>");
		expect(r.exitCode).toBe(1);
	});

	it("vendor 非法 tag 报错", async () => {
		const r = await run(["vendor", "notatag"], "zh-CN", tmp);
		expect(r.out).toContain("非法版本号");
		expect(r.exitCode).toBe(1);
	});

	it("vendor 0.1.12 规范化补 v 前缀后传入 vendorCommand", async () => {
		await run(["vendor", "0.1.12"], "zh-CN", tmp, () => vendorCommandMock.mock.calls.length > 0);
		expect(vendorCommandMock).toHaveBeenCalledWith(tmp, { force: false, tag: "v0.1.12" });
	});

	it("vendor --force 透传 force", async () => {
		await run(["vendor", "v0.1.12", "--force"], "zh-CN", tmp, () => vendorCommandMock.mock.calls.length > 0);
		expect(vendorCommandMock).toHaveBeenCalledWith(tmp, { force: true, tag: "v0.1.12" });
	});
});

describe("参数映射", () => {
	it("merge <out> <inputs...> variadic 映射（缺文件报错提及输入名）", async () => {
		const r = await run(["merge", "out.json", "in1.json", "in2.json"], "zh-CN", tmp);
		expect(r.out).toContain("in1.json");
		expect(r.exitCode).toBe(1);
	});

	it("build --bundle demo 映射 bundleName", async () => {
		const r = await run(["build", "--bundle", "demo"], "zh-CN", tmp, () => buildBundleMock.mock.calls.length > 0);
		expect(buildBundleMock).toHaveBeenCalledWith(tmp, { out: undefined, name: "demo" });
		expect(r.exitCode).toBeUndefined();
	});

	it("build 裸 --bundle 无名称（全部用户方案）", async () => {
		await run(["build", "--bundle"], "zh-CN", tmp, () => buildBundleMock.mock.calls.length > 0);
		expect(buildBundleMock).toHaveBeenCalledWith(tmp, { out: undefined, name: undefined });
	});
});

describe("help 词形", () => {
	it("ojm help build → build --help", () => {
		expect(rewriteHelpArgv(["help", "build"])).toEqual(["build", "--help"]);
	});

	it("ojm help trust add → trust add --help", () => {
		expect(rewriteHelpArgv(["help", "trust", "add"])).toEqual(["trust", "add", "--help"]);
	});

	it("ojm help → 顶层 --help", () => {
		expect(rewriteHelpArgv(["help"])).toEqual(["--help"]);
	});

	it("非 help 调用不改动", () => {
		expect(rewriteHelpArgv(["build", "--bundle"])).toEqual(["build", "--bundle"]);
	});
});
