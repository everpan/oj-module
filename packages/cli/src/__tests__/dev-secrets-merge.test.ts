// mergeConfigForDev extraVars spec（2026-11-10）：出厂收敛 token 注入面。
// ojm dev 每次启动生成随机 vars.ojm_converge_token（POST /oj-market/converge 的持有型
// 证明，替代账密登录），经合并产物 .ojm-tmp-config.yaml 的 vars 段注入服务端。
// extraVars 只进派生产物（gitignored），绝不写回 tracked config / config.local.yaml。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { mergeConfigForDev } from "../dev-secrets";

let root = "";

afterEach(() => {
	if (root)
		fs.rmSync(root, { recursive: true, force: true });
	root = "";
});

function newProject(tracked: Record<string, unknown>): string {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-merge-"));
	fs.writeFileSync(path.join(root, "config.yaml"), JSON.stringify(tracked));
	return root;
}

const noopDeps = {
	provision: () => ({}),
	redLine: () => {},
};

describe("mergeConfigForDev extraVars（出厂收敛 token 注入）", () => {
	it("given extraVars When merge Then vars 段出现在派生产物、tracked config 不变", () => {
		const projectRoot = newProject({ vars: { canonical_origin: "https://site.example.com" } });

		mergeConfigForDev(projectRoot, path.join(projectRoot, "config.yaml"), {
			...noopDeps,
			extraVars: { ojm_converge_token: "tok-123" },
		});

		const merged = parse(fs.readFileSync(path.join(projectRoot, ".ojm-tmp-config.yaml"), "utf-8")) as { vars: Record<string, string> };
		expect(merged.vars.ojm_converge_token).toBe("tok-123");
		// 原 vars 键保留（深合并不是覆盖）
		expect(merged.vars.canonical_origin).toBe("https://site.example.com");
		// tracked config 不被写回
		const tracked = JSON.parse(fs.readFileSync(path.join(projectRoot, "config.yaml"), "utf-8")) as { vars: Record<string, string> };
		expect(tracked.vars.ojm_converge_token).toBeUndefined();
	});

	it("given 不传 extraVars When merge Then vars 段保持原样（行为不回归）", () => {
		const projectRoot = newProject({ vars: { canonical_origin: "https://site.example.com" } });

		mergeConfigForDev(projectRoot, path.join(projectRoot, "config.yaml"), { ...noopDeps });

		const merged = parse(fs.readFileSync(path.join(projectRoot, ".ojm-tmp-config.yaml"), "utf-8")) as { vars: Record<string, string> };
		expect(merged.vars).toEqual({ canonical_origin: "https://site.example.com" });
	});

	it("given 用户 config 手删内置匿名条目 When merge Then 派生产物按权威清单补齐、原文件不动、自定义项保留", () => {
		const projectRoot = newProject({
			auth: { anonymous_paths: ["/custom/x", "/auth/login"] },
			tenant: { anonymous_paths: ["/custom/y"] },
		});

		mergeConfigForDev(projectRoot, path.join(projectRoot, "config.yaml"), {
			...noopDeps,
			builtinAnonymous: () => ({
				auth: ["/auth/login", "/auth/refresh", "/oj-market/converge"],
				tenant: ["/system/login-methods"],
			}),
		});

		const merged = parse(fs.readFileSync(path.join(projectRoot, ".ojm-tmp-config.yaml"), "utf-8")) as {
			auth: { anonymous_paths: string[] }
			tenant: { anonymous_paths: string[] }
		};
		// 原顺序 + 自定义项保留，缺失权威条目追加尾部（幂等：/auth/login 不重复）
		expect(merged.auth.anonymous_paths).toEqual(["/custom/x", "/auth/login", "/auth/refresh", "/oj-market/converge"]);
		expect(merged.tenant.anonymous_paths).toEqual(["/custom/y", "/system/login-methods"]);
		// 原文件不被写回
		const tracked = JSON.parse(fs.readFileSync(path.join(projectRoot, "config.yaml"), "utf-8")) as { auth: { anonymous_paths: string[] } };
		expect(tracked.auth.anonymous_paths).toEqual(["/custom/x", "/auth/login"]);
	});
});
