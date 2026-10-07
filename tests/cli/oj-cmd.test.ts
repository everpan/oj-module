import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runOjSubcommand } from "../../packages/cli/src/oj-cmd";

/**
 * ojm 的 oj 子命令透传（test / exec / openapi / migrate / schema）。
 *
 * 要点：这些子命令的 -c 缺省是 ./config.yaml（相对 CWD），而 ojm 的 config 在
 * api/ 下——不补绝对路径就会读不到 config（oj 只 warn 或直接按默认值跑）。
 * -d / --db 等一律交给用户，ojm 不猜（oj 自己会自 config 逐级搜 src 优先）。
 */
describe("runOjSubcommand", () => {
	function makeProject(withConfig = true): string {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-cmd-"));
		fs.mkdirSync(path.join(root, "bin"), { recursive: true });
		fs.writeFileSync(path.join(root, "bin/oj"), "#!/bin/sh\necho oj\n");
		if (withConfig) {
			fs.mkdirSync(path.join(root, "api"), { recursive: true });
			fs.writeFileSync(path.join(root, "api/config.yaml"), "server:\n  port: 9778\n");
		}
		return root;
	}

	it("缺 -c 时自动补绝对路径（config 在 api/ 下，相对 CWD 会读不到）", () => {
		const root = makeProject();
		const calls: string[][] = [];
		runOjSubcommand(root, "test", ["--anonymous"], args => calls.push(args));
		expect(calls[0][0]).toBe("test");
		expect(calls[0]).toContain("-c");
		expect(calls[0][calls[0].indexOf("-c") + 1]).toBe(path.join(root, "api/config.yaml"));
		// 用户参数原样保留且不重复
		expect(calls[0].at(-1)).toBe("--anonymous");
	});

	it("用户已给 -c / --config → 不覆盖", () => {
		const root = makeProject();
		const calls: string[][] = [];
		runOjSubcommand(root, "migrate", ["--config", "./other.yaml", "--db", "report"], args => calls.push(args));
		const args = calls[0];
		expect(args.filter(a => a === "-c" || a === "--config")).toHaveLength(1);
		expect(args[args.indexOf("--config") + 1]).toBe("./other.yaml");
		expect(args).toContain("--db");
	});

	it("工程无 config.yaml → 不强塞 -c（oj 按自己的缺省走）", () => {
		const root = makeProject(false);
		const calls: string[][] = [];
		runOjSubcommand(root, "openapi", ["--check"], args => calls.push(args));
		expect(calls[0]).toEqual(["openapi", "--check"]);
	});

	it("bin/oj 缺失 → 人话报错指向 init/vendor", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-cmd-nobin-"));
		expect(() => runOjSubcommand(root, "test", [], () => {})).toThrowError(/init|vendor/);
	});
});
