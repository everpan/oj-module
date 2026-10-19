// 守卫：发布脚本的帮助入口与未知参数拦截。
// 背景：脚本原先把未知参数（含误敲的 --help）静默忽略后直接开跑真实发布——
// 「以为在演练、实际在真发布」的事故路径。现在 --help/-h 打印用法退出 0，
// 未知参数 fail-fast 退出 1，两者都先于 main()（无任何校验/构建/网络动作）。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts/publish-packages.mjs");

function run(args: string[]): { status: number, stdout: string, stderr: string } {
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		return { status: 0, stdout, stderr: "" };
	}
	catch (err: any) {
		return { status: err.status ?? 1, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? "" };
	}
}

describe("publish-packages 帮助与参数守卫", () => {
	it("--help 打印用法并以 0 退出，且不进入主流程（无 == 1/5 步骤输出）", () => {
		const { status, stdout } = run(["--help"]);
		expect(status).toBe(0);
		expect(stdout).toContain("用法：node scripts/publish-packages.mjs");
		expect(stdout).toContain("--dry-run");
		expect(stdout).toContain("--web-2fa");
		// main() 的步骤行形如「== 1/5 前置校验 ==」；用法文本里只有无 == 的流程说明
		expect(stdout).not.toContain("== 1/5");
	});

	it("-h 等价于 --help", () => {
		const { status, stdout } = run(["-h"]);
		expect(status).toBe(0);
		expect(stdout).toContain("用法：node scripts/publish-packages.mjs");
	});

	it("未知参数 fail-fast：非 0 退出 + 用法指引，不进主流程", () => {
		const { status, stderr } = run(["--dryrun"]);
		expect(status).toBe(1);
		expect(stderr).toContain("未知参数：--dryrun");
		expect(stderr).toContain("用法：node scripts/publish-packages.mjs");
		expect(stderr).not.toContain("== 1/5");
	});
});
