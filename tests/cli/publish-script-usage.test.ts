// 守卫：发布脚本的帮助入口与未知参数拦截。
// 背景：脚本原先把未知参数（含误敲的 --help）静默忽略后直接开跑真实发布——
// 「以为在演练、实际在真发布」的事故路径。现在 --help/-h 打印用法退出 0，
// 未知参数 fail-fast 退出 1，两者都先于 main()（无任何校验/构建/网络动作）。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
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
		// 发布目标钉死：USAGE 须如实声明双重钉法（--registry + 发布步工程级 .npmrc 临时
		// 追加 @oj-module:registry 行）——@scope:registry 映射优先级高于 --registry，
		// 只钉 --registry 会被用户 ~/.npmrc 映射劫走（2026-10-23 实锤，见计划
		// 20261023-1531-publish-scope-registry-pin）
		expect(stdout).toContain("发布仓库：https://registry.npmjs.org");
		expect(stdout).toContain("@oj-module:registry");
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

	it("裸跑（无参数）= 显示帮助并退出 1，不发生任何发布动作", () => {
		const { status, stdout } = run([]);
		expect(status).toBe(1);
		expect(stdout).toContain("用法：node scripts/publish-packages.mjs");
		expect(stdout).not.toContain("== 1/5"); // main() 从未开跑
	});

	it("只给修饰旗标不给 --publish = 意图不明，fail-fast", () => {
		const { status, stderr } = run(["--tag", "beta"]);
		expect(status).toBe(1);
		expect(stderr).toContain("未指定 --publish");
		expect(stderr).not.toContain("== 1/5");
	});

	it("--publish 与 --dry-run 互斥", () => {
		const { status, stderr } = run(["--publish", "--dry-run"]);
		expect(status).toBe(1);
		expect(stderr).toContain("互斥");
		expect(stderr).not.toContain("== 1/5");
	});

	it("值旗标等号形式（--otp=/--tag=）不被误判未知参数，正常进入后续守卫", () => {
		// 复现：--otp=123456 曾被打成「未知参数：--otp=123456」；
		// 用 --publish --dry-run 互斥作探针——能走到互斥 fail-fast 即证明已通过参数解析
		for (const extra of [["--otp=123456"], ["--tag=beta"], ["--otp", "123456", "--tag=beta"]]) {
			const { status, stderr } = run(["--publish", "--dry-run", ...extra]);
			expect(status).toBe(1);
			expect(stderr).toContain("互斥");
			expect(stderr).not.toContain("未知参数");
			expect(stderr).not.toContain("== 1/5");
		}
	});

	it("真正未知的等号参数仍被拦截", () => {
		const { status, stderr } = run(["--dryrun=x"]);
		expect(status).toBe(1);
		expect(stderr).toContain("未知参数：--dryrun=x");
	});
});

describe("随站 bundle 每次发布从源码重建（不清旧包补缺口）", () => {
	const source = fs.readFileSync(SCRIPT, "utf-8");
	const start = source.indexOf("function rebuildArtifacts");
	const end = source.indexOf("守卫测试（真跑 pnpm pack", start);
	const rebuild = source.slice(start, end);

	it("链路顺序：build:shell 清空 → 模板 build → bundle 重建 → 验签 → 收编", () => {
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const steps = ["build:shell", "pnpm\", [\"build\"", "--bundle", "market\", \"verify", "sync-bundles.mjs"];
		let cursor = -1;
		for (const step of steps) {
			const at = rebuild.indexOf(step, cursor + 1);
			expect(at, `重建链路缺步骤或顺序错：${step}`).toBeGreaterThan(cursor);
			cursor = at;
		}
	});

	it("验签失败 fail-closed：签名是人工动作，脚本不自动签（私钥红线）", () => {
		expect(rebuild).toContain("market\", \"verify");
		expect(rebuild).toContain("catch");
		expect(rebuild).toContain("重签");
		// 不应在发布脚本里调用 sign（私钥只在本机 ~/.ojm/keys，发布人不交给脚本）
		expect(rebuild).not.toMatch(/["']sign["']/);
	});
});
