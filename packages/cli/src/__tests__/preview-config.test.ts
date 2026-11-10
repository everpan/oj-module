// derivePreviewConfigText convergeToken spec（2026-11-10）：出厂收敛 token 注入面（preview 轨）。
// ojm preview 与 ojm dev 同口径：每次启动生成随机 vars.ojm_converge_token，派生 config
// （.ojm-preview.yaml，进程退出即清理）注入服务端，供 POST /oj-market/converge 持有型证明。
// 不传 token → vars 段原样（行为不回归）。

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { derivePreviewConfigText } from "../preview-config";

const BASE_CONFIG = [
	"server:",
	"  port: 9778",
	"vars:",
	"  canonical_origin: https://site.example.com",
	"mounts:",
	"  - prefix: /",
].join("\n");

describe("derivePreviewConfigText convergeToken（出厂收敛 token 注入，preview 轨）", () => {
	it("given convergeToken When derive Then vars.ojm_converge_token 落派生文本、原 vars 键保留", () => {
		const out = derivePreviewConfigText(BASE_CONFIG, {
			siteDir: "/tmp/site",
			convergeToken: "tok-abc",
		});
		const doc = parse(out) as { vars: Record<string, string> };
		expect(doc.vars.ojm_converge_token).toBe("tok-abc");
		expect(doc.vars.canonical_origin).toBe("https://site.example.com");
	});

	it("given 不传 convergeToken When derive Then vars 段原样（不注入、不报错）", () => {
		const out = derivePreviewConfigText(BASE_CONFIG, { siteDir: "/tmp/site" });
		const doc = parse(out) as { vars: Record<string, string> };
		expect(doc.vars).toEqual({ canonical_origin: "https://site.example.com" });
	});

	it("given 站点 config 手删内置匿名条目 When derive Then 输出按权威清单补齐、自定义项保留", () => {
		const out = derivePreviewConfigText([
			"auth:",
			"  anonymous_paths:",
			"    - /custom/x",
			"    - /auth/login",
			"tenant:",
			"  anonymous_paths:",
			"    - /custom/y",
		].join("\n"), {
			siteDir: "/tmp/site",
			builtinAnonymous: () => ({
				auth: ["/auth/login", "/auth/refresh"],
				tenant: ["/system/login-methods"],
			}),
		});
		const doc = parse(out) as { auth: { anonymous_paths: string[] }, tenant: { anonymous_paths: string[] } };
		expect(doc.auth.anonymous_paths).toEqual(["/custom/x", "/auth/login", "/auth/refresh"]);
		expect(doc.tenant.anonymous_paths).toEqual(["/custom/y", "/system/login-methods"]);
	});
});
