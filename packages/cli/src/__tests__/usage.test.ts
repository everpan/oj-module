import { describe, expect, it } from "vitest";
import { getCommandHelp, resolveHelpRequest, usageText } from "../usage";

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

describe("usageText 分组（cac 渲染）", () => {
	const GROUP_TITLES = ["工程脚手架", "开发与构建", "清单与诊断", "方案市场（站点侧生命周期）", "发布与签名（作者侧）", "本地市场模拟 CDN", "oj 子命令透传"];

	it("分组头齐全且顺序固定", () => {
		const text = usageText();
		let last = -1;
		for (const title of GROUP_TITLES) {
			const i = text.indexOf(`${title}:`);
			expect(i, title).toBeGreaterThan(last);
			last = i;
		}
	});

	it("命令归入正确分组（组内出现、不串组）", () => {
		const text = usageText();
		const section = (from: string, to?: string) =>
			text.slice(text.indexOf(`${from}:`), to === undefined ? undefined : text.indexOf(`${to}:`));
		expect(section("工程脚手架", "开发与构建")).toContain("ojm init [dir]");
		expect(section("工程脚手架", "开发与构建")).toContain("ojm new <name>");
		expect(section("开发与构建", "清单与诊断")).toContain("ojm dev [port]");
		expect(section("开发与构建", "清单与诊断")).toContain("ojm build");
		expect(section("清单与诊断", "方案市场（站点侧生命周期）")).toContain("ojm info");
		const market = section("方案市场（站点侧生命周期）", "发布与签名（作者侧）");
		for (const cmd of ["install", "enable|disable", "uninstall", "trust"])
			expect(market).toContain(`ojm ${cmd}`);
		expect(section("发布与签名（作者侧）", "本地市场模拟 CDN")).toContain("ojm keygen");
		const cdn = section("本地市场模拟 CDN", "oj 子命令透传");
		for (const sub of ["setup", "publish", "build-index", "verify", "trial"])
			expect(cdn).toContain(`ojm market ${sub}`);
		expect(section("oj 子命令透传")).toContain("ojm test|exec|openapi|migrate|schema");
	});

	it("命令行带 ojm 前缀与一句话描述", () => {
		const text = usageText();
		expect(text).toMatch(/ojm init \[dir\]\s+前后端一体化工程脚手架/);
		expect(text).toMatch(/ojm market verify\s+离线验包/);
	});

	it("版本项保留", () => {
		const text = usageText();
		expect(text).toContain("ojm --version | -V");
		expect(text).toContain("显示 cli 包版本");
	});
});
