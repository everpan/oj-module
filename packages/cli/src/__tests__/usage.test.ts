import { describe, expect, it } from "vitest";
import { resolveLang, usageText } from "../usage";

describe("resolveLang", () => {
	it("显式 OJM_LANG 优先于系统 locale", () => {
		expect(resolveLang({ OJM_LANG: "en-US", LANG: "zh_CN.UTF-8" } as NodeJS.ProcessEnv)).toBe("en-US");
		expect(resolveLang({ OJM_LANG: "zh-CN", LANG: "en_US.UTF-8" } as NodeJS.ProcessEnv)).toBe("zh-CN");
	});

	it("无显式设置时按 LANG/LC_ALL 前缀探测英文", () => {
		expect(resolveLang({ LANG: "en_US.UTF-8" } as NodeJS.ProcessEnv)).toBe("en-US");
		expect(resolveLang({ LC_ALL: "en_GB.UTF-8" } as NodeJS.ProcessEnv)).toBe("en-US");
		expect(resolveLang({ LANG: "C" } as NodeJS.ProcessEnv)).toBe("zh-CN");
	});

	it("非法值回退 zh-CN", () => {
		expect(resolveLang({ OJM_LANG: "fr" } as NodeJS.ProcessEnv)).toBe("zh-CN");
	});

	it("全缺省为 zh-CN", () => {
		expect(resolveLang({} as NodeJS.ProcessEnv)).toBe("zh-CN");
	});
});

describe("usageText 分组（cac 渲染）", () => {
	const ZH_TITLES = ["工程脚手架", "开发与构建", "清单与诊断", "方案市场（站点侧生命周期）", "发布与签名（作者侧）", "本地市场模拟 CDN", "oj 子命令透传"];
	const EN_TITLES = ["Project scaffolding", "Development & build", "Manifest & diagnostics", "Marketplace (site-side lifecycle)", "Publishing & signing (author side)", "Local marketplace mock CDN", "oj subcommand passthrough"];

	it("中文分组头齐全且顺序固定", () => {
		const text = usageText("zh-CN");
		let last = -1;
		for (const title of ZH_TITLES) {
			const i = text.indexOf(`${title}:`);
			expect(i, title).toBeGreaterThan(last);
			last = i;
		}
	});

	it("英文分组头齐全且顺序固定", () => {
		const text = usageText("en-US");
		let last = -1;
		for (const title of EN_TITLES) {
			const i = text.indexOf(`${title}:`);
			expect(i, title).toBeGreaterThan(last);
			last = i;
		}
	});

	it("两种语言均含全部命令语法行", () => {
		for (const lang of ["zh-CN", "en-US"] as const) {
			const text = usageText(lang);
			for (const cmd of ["ojm init [dir]", "ojm dev [port]", "ojm build", "ojm preview [port]", "ojm api [dir]", "ojm info", "ojm merge", "ojm vendor", "ojm install", "ojm trust", "ojm keygen", "ojm sign", "ojm publish", "ojm market verify", "ojm test", "ojm migrate"])
				expect(text, `${lang} ${cmd}`).toContain(cmd);
		}
	});

	it("版本项保留（双语）", () => {
		expect(usageText("zh-CN")).toContain("ojm --version | -V");
		expect(usageText("en-US")).toContain("ojm --version | -V");
	});
});
