// 守卫：verdaccio 模拟发布脚本的帮助入口与未知参数拦截（骨架同 publish-script-usage）。
// 目标 registry 必须显式钉本地——脚本头部注释记录过「靠 .npmrc scope 映射隐式定目标
// 曾被 auto 分类器拦下」的教训：隐式目标在 scope 映射缺席时会回落公网。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts/publish-verdaccio.mjs");

function run(args: string[]): { status: number, stdout: string, stderr: string } {
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		return { status: 0, stdout, stderr: "" };
	}
	catch (err: any) {
		return { status: err.status ?? 1, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? "" };
	}
}

describe("publish-verdaccio 帮助与参数守卫", () => {
	it("--help 打印用法并以 0 退出，且不进入主流程（无 == 1/5 步骤输出）", () => {
		const { status, stdout } = run(["--help"]);
		expect(status).toBe(0);
		expect(stdout).toContain("用法：node scripts/publish-verdaccio.mjs");
		expect(stdout).toContain("--dry-run");
		// 目标钉死本地：USAGE 须显式声明 registry（不靠 .npmrc scope 映射隐式决定）
		expect(stdout).toContain("http://127.0.0.1:4873");
		expect(stdout).not.toContain("== 1/5");
	});

	it("未知参数 fail-fast：非 0 退出 + 用法指引，不进主流程", () => {
		const { status, stderr } = run(["--dryrun"]);
		expect(status).toBe(1);
		expect(stderr).toContain("未知参数：--dryrun");
		expect(stderr).not.toContain("== 1/5");
	});

	it("裸跑（无参数）= 显示帮助并退出 1，不发生任何发布动作", () => {
		const { status, stdout } = run([]);
		expect(status).toBe(1);
		expect(stdout).toContain("用法：node scripts/publish-verdaccio.mjs");
		expect(stdout).not.toContain("== 1/5");
	});

	it("--publish 与 --dry-run 互斥", () => {
		const { status, stderr } = run(["--publish", "--dry-run"]);
		expect(status).toBe(1);
		expect(stderr).toContain("互斥");
		expect(stderr).not.toContain("== 1/5");
	});
});
