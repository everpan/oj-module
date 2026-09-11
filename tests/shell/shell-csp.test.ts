import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { generateCsp } from "../../packages/cli/shell/src/csp";
import { PROJECT_ROOT } from "../helpers/paths";

const BUILD_SCRIPT = path.join(PROJECT_ROOT, "packages/cli/shell/scripts/build.mts");
const SHELL_HTML = path.join(PROJECT_ROOT, "packages/cli/shell/index.html");

const NONCE = "abc123";

/**
 * P6.2 / §4.8：CSP 落地——内联 importmap 必须带 nonce（否则被
 * script-src 'self' 拦掉）；**不加** strict-dynamic（它会让任意 host
 * 的动态 import 合法，反而废掉来源白名单）。
 * 静态部署无 per-request 能力，nonce 为构建期随机值（每次 build 轮换）。
 */
describe("shell CSP（P6.2）", () => {
	it("script-src 含 self、模块 CDN 与 nonce", () => {
		const csp = generateCsp(["https://modules.cdn.example.com"], NONCE);
		const scriptSrc = csp.split(";").find(d => d.trim().startsWith("script-src"));
		expect(scriptSrc).toContain("'self'");
		expect(scriptSrc).toContain("https://modules.cdn.example.com");
		expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
	});

	it("不含 strict-dynamic（会废掉来源白名单）", () => {
		expect(generateCsp([], NONCE)).not.toContain("strict-dynamic");
	});

	it("锁定基线：default-src none；style 允许 inline（antd cssinjs）；object/base/form 收敛", () => {
		const csp = generateCsp([], NONCE);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toMatch(/style-src [^;]*'unsafe-inline'/);
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
	});

	it("构建脚本给 importmap 注入 nonce 并落 CSP meta", () => {
		const source = fs.readFileSync(BUILD_SCRIPT, "utf-8");
		expect(source).toContain("nonce");
		expect(source).toMatch(/Content-Security-Policy/);
		expect(source).toContain("generateCsp");
	});

	it("shell index.html 含 CSP 注入占位", () => {
		expect(fs.readFileSync(SHELL_HTML, "utf-8")).toContain("<!--CSP-->");
	});
});
