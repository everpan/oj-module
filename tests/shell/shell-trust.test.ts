import { describe, expect, it } from "vitest";

import { assertTrustedModules, TRUSTED_ORIGINS } from "../../packages/cli/shell/src/trust";

/** 便捷构造：显式控制 entry/css/chunks 三个 URL 载体 */
function mod(entry: string, css: string[], chunkUrls: string[], name = "order") {
	return {
		name,
		entry,
		css,
		chunks: chunkUrls.map(url => ({ url, integrity: "sha384-x", lazy: false })),
	};
}

/**
 * P6.1 / D10 信任根：宿主内置 moduleOrigins 白名单（§4.8）。
 * 同源相对路径总是可信；绝对 URL 的 origin 必须登记在白名单，
 * 否则（来源未登记）在 loadAll 之前直接拒绝。
 */
describe("moduleOrigins 白名单（P6.1）", () => {
	it("同源相对路径全部通过（entry/css/chunks）", () => {
		expect(() =>
			assertTrustedModules([mod("/modules/order/1.0.0/entry.js", ["/modules/order/1.0.0/style.css"], ["/modules/order/1.0.0/entry.js"])]),
		).not.toThrow();
	});

	it("白名单内 CDN 绝对 URL 通过", () => {
		const cdn = TRUSTED_ORIGINS[0] ?? "https://modules.cdn.example.com";
		expect(() =>
			assertTrustedModules([mod(`${cdn}/order/1.0.0/entry.js`, [`${cdn}/order/style.css`], [`${cdn}/order/1.0.0/entry.js`])]),
		).not.toThrow();
	});

	it("白名单外来源直接拒绝，报错含模块名与 URL", () => {
		expect(() =>
			assertTrustedModules([mod("https://evil.example.com/order/entry.js", [], [], "rogue")]),
		).toThrow(/rogue/);
		try {
			assertTrustedModules([mod("https://evil.example.com/order/entry.js", [], [], "rogue")]);
		}
		catch (error) {
			expect((error as Error).message).toContain("https://evil.example.com/order/entry.js");
			expect((error as Error).message).toContain("moduleOrigins");
		}
	});

	it("css 与 chunks 同样受检（任一字段越界即拒绝）", () => {
		expect(() => assertTrustedModules([mod("/m/e.js", ["https://evil.example.com/x.css"], [])])).toThrow();
		expect(() => assertTrustedModules([mod("/m/e.js", [], ["https://evil.example.com/c.js"])])).toThrow();
	});

	it("空清单直接通过", () => {
		expect(() => assertTrustedModules([])).not.toThrow();
	});

	// P7.1：「不含 :// 即同源」的判定可被多种 URL 形态绕过，全部必须拒绝
	it.each([
		["协议相对 URL（跨源）", "//evil.example.com/order/entry.js"],
		["反斜杠规范化（WHATWG 解析为跨源）", "https:\\\\evil.example.com\\x.js"],
		["data: URL（违反 C6）", "data:text/javascript,alert(1)"],
		["blob: URL（违反 C6）", "blob:https://modules.cdn.example.com/1"],
	])("%s 被拒绝", (_label, url) => {
		expect(() => assertTrustedModules([mod(url, [], [])])).toThrow(/moduleOrigins/);
	});

	it("白名单 origin 的子路径放行，但相似域名不放行", () => {
		const cdn = TRUSTED_ORIGINS[0] ?? "https://modules.cdn.example.com";
		expect(() => assertTrustedModules([mod(`${cdn}/deep/path/entry.js`, [], [])])).not.toThrow();
		expect(() => assertTrustedModules([mod(`${cdn}.evil.example.com/entry.js`, [], [])])).toThrow();
	});
});
