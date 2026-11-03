import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { defaultRun, npmExecSpec } from "../vendor";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(() => ""),
}));

const mockedExec = vi.mocked(execFileSync);

describe("npmExecSpec / defaultRun（Windows npm.cmd 兼容）", () => {
	it("非 Windows：直接以 npm 执行，不经 shell", () => {
		expect(npmExecSpec("linux", ["view", "x", "version"])).toEqual({
			cmd: "npm",
			execArgs: ["view", "x", "version"],
		});
		expect(npmExecSpec("darwin", ["install", "y"])).toEqual({
			cmd: "npm",
			execArgs: ["install", "y"],
		});
	});

	it("windows：以 cmd.exe /c npm.cmd 包裹（修复 spawnSync npm.cmd EINVAL）", () => {
		expect(npmExecSpec("win32", ["install", "@oj-bin/oj@0.1.86"])).toEqual({
			cmd: "cmd.exe",
			execArgs: ["/c", "npm.cmd", "install", "@oj-bin/oj@0.1.86"],
		});
	});

	it("defaultRun 按当前平台选择执行方式", () => {
		defaultRun(["view", "x", "version"], "/tmp/x");
		const platform = process.platform;
		const expectedCmd = platform === "win32" ? "cmd.exe" : "npm";
		const expectedArgs = platform === "win32"
			? ["/c", "npm.cmd", "view", "x", "version"]
			: ["view", "x", "version"];
		expect(mockedExec).toHaveBeenCalledWith(expectedCmd, expectedArgs, expect.objectContaining({ cwd: "/tmp/x" }));
	});
});
