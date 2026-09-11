import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { IFRAME_ALLOWED_HOSTS } from "#src/utils/iframe-guard";
import { generateCsp } from "../../packages/cli/shell/src/csp";
import { PROJECT_ROOT } from "../helpers/paths";

/** 扫描仓库内全部 iframeLink 字面量（模块 entry + fake 后端数据） */
function collectIframeLinks(): { file: string, url: string }[] {
	const roots = ["web", "fake"];
	const found: { file: string, url: string }[] = [];
	const walk = (dir: string) => {
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name);
			if (fs.statSync(full).isDirectory()) {
				walk(full);
			}
			else if (/\.(?:tsx?|jsx?)$/.test(name)) {
				const source = fs.readFileSync(full, "utf-8");
				for (const match of source.matchAll(/iframeLink:\s*["'`](https?:\/\/[^"'`]+)["'`]/g)) {
					found.push({ file: path.relative(PROJECT_ROOT, full), url: match[1]! });
				}
			}
		}
	};
	for (const root of roots) walk(path.join(PROJECT_ROOT, root));
	return found;
}

/**
 * P7.4 / 评审 S5：iframe 守卫白名单、CSP frame-src 与仓库真实 iframeLink
 * 三者必须一致——P6.4 落地时漏登 condorheroblog.github.io，
 * 导致「项目文档」嵌入页回归空白。本测试保证新增 iframeLink 时先红。
 */
describe("iframe 白名单一致性（P7.4）", () => {
	const links = collectIframeLinks();

	it("仓库内全部 iframeLink 均命中 IFRAME_ALLOWED_HOSTS（含子域）", () => {
		const offenders = links.filter(({ url }) => {
			const host = new URL(url).host;
			return !IFRAME_ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
		});
		expect(offenders, `未登记的 iframeLink：${offenders.map(o => `${o.file} → ${o.url}`).join(", ")}`).toEqual([]);
	});

	it("cSP frame-src 覆盖全部 iframeLink 域名", () => {
		const csp = generateCsp([], "nonce");
		const frameSrc = csp.split(";").find(d => d.trim().startsWith("frame-src")) ?? "";
		const offenders = links.filter(({ url }) => {
			const host = new URL(url).host;
			return !frameSrc.includes(host);
		});
		expect(offenders, `frame-src 未覆盖：${offenders.map(o => `${o.file} → ${o.url}`).join(", ")}`).toEqual([]);
	});

	it("扫描确实找到了 iframeLink（防空转）", () => {
		expect(links.length).toBeGreaterThan(0);
	});
});

/** P7.4 / 评审 S4：跨源模块的 CSS 与 fetch 同样需要 CSP 信任源 */
describe("cSP 信任源覆盖 style-src / connect-src（P7.4）", () => {
	const cdn = "https://modules.cdn.example.com";
	const csp = generateCsp([cdn], "nonce");

	it("style-src 含信任源（模块 CSS <link> 不被拦）", () => {
		const styleSrc = csp.split(";").find(d => d.trim().startsWith("style-src"))!;
		expect(styleSrc).toContain(cdn);
	});

	it("connect-src 含信任源（模块 fetch CDN 不被拦）", () => {
		const connectSrc = csp.split(";").find(d => d.trim().startsWith("connect-src"))!;
		expect(connectSrc).toContain(cdn);
	});
});
