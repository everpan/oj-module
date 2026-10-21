import { describe, expect, it } from "vitest";
import { getCommandHelp, resolveHelpRequest } from "../usage";

describe("getCommandHelp", () => {
	it("返回命令级帮助（init）", () => {
		const t = getCommandHelp("init");
		expect(t).toBeDefined();
		expect(t).toContain("ojm init");
	});

	it("子命令优先：market setup 命中专属条目", () => {
		expect(getCommandHelp("market", "setup")).toContain("ojm market setup");
	});

	it("子命令无专属条目时回退到命令级（market 无 sub）", () => {
		const t = getCommandHelp("market");
		expect(t).toContain("ojm market");
	});

	it("trust 子命令（add/revoke/confirm/ls）各自有专属条目", () => {
		for (const sub of ["ls", "add", "revoke", "confirm"]) {
			const t = getCommandHelp("trust", sub);
			expect(t, `trust ${sub}`).toBeDefined();
			expect(t).toContain(`ojm trust ${sub}`);
		}
	});

	it("未知命令返回 undefined", () => {
		expect(getCommandHelp("nope")).toBeUndefined();
	});
});

describe("resolveHelpRequest", () => {
	it("ojm --help → 顶层（无 cmd）", () => {
		expect(resolveHelpRequest(["--help"])).toEqual({ cmd: undefined, sub: undefined });
	});

	it("ojm -h → 顶层（无 cmd）", () => {
		expect(resolveHelpRequest(["-h"])).toEqual({ cmd: undefined, sub: undefined });
	});

	it("ojm init --help → cmd=init", () => {
		expect(resolveHelpRequest(["init", "--help"])).toEqual({ cmd: "init", sub: undefined });
	});

	it("ojm trust add --help → cmd=trust sub=add", () => {
		expect(resolveHelpRequest(["trust", "add", "--help"])).toEqual({ cmd: "trust", sub: "add" });
	});

	it("ojm market setup --help → cmd=market sub=setup", () => {
		expect(resolveHelpRequest(["market", "setup", "--help"])).toEqual({ cmd: "market", sub: "setup" });
	});

	it("ojm help init → cmd=init", () => {
		expect(resolveHelpRequest(["help", "init"])).toEqual({ cmd: "init", sub: undefined });
	});

	it("ojm help trust add → cmd=trust sub=add", () => {
		expect(resolveHelpRequest(["help", "trust", "add"])).toEqual({ cmd: "trust", sub: "add" });
	});

	it("ojm help → 顶层（无 cmd）", () => {
		expect(resolveHelpRequest(["help"])).toEqual({ cmd: undefined, sub: undefined });
	});

	it("非帮助调用返回 null（ojm build）", () => {
		expect(resolveHelpRequest(["build", "--bundle"])).toBeNull();
	});
});
