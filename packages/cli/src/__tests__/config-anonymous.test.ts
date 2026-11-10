// config-anonymous spec（2026-11-10）：内置匿名面权威提取 + force-union。
// 背景：auth/tenant anonymous_paths 全靠模板 config.yaml 手维护，用户删错/漏配即 401
// （oj 匿名模型 config 独占；安装器 C2-26 接线只覆盖市场方案，baseline 模块无接线通道）。
// 本模块把模板 config.yaml 提为单一权威源，ojm dev/preview 派生 config 时 force-union
// 补齐——原文件不动，dev/preview 产物自愈。
// BDD 用例表：
// | 场景 | 期望 |
// | --- | --- |
// | 模板 config 完整 | 提取 auth/tenant 两段列表（与模板条目一致） |
// | 模板缺 config 文件 / 缺段 / 段缺 anonymous_paths 键 | fail-fast 人话报错（同 readInitInclude 纪律） |
// | unionAnonymous：用户列表缺权威条目 | 追加尾部，原顺序与自定义项保留 |
// | unionAnonymous：用户列表已全含 | 幂等不变 |

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readBuiltinAnonymous, unionAnonymous } from "../config-anonymous";

let root = "";

afterEach(() => {
	if (root)
		fs.rmSync(root, { recursive: true, force: true });
	root = "";
});

const FULL_CONFIG = [
	"auth:",
	"  anonymous_paths:",
	"    - /auth/login",
	"    - /auth/refresh",
	"    - /oj-market/converge",
	"tenant:",
	"  require_signed_claim: false",
	"  anonymous_paths:",
	"    - /system/login-methods",
	"    - /oj-market/catalog/**",
].join("\n");

function newTemplatesDir(configText: string | null): string {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-tpl-"));
	if (configText !== null)
		fs.writeFileSync(path.join(root, "config.yaml"), configText);
	return root;
}

describe("readBuiltinAnonymous（模板 config.yaml 为内置匿名面权威源）", () => {
	it("模板 config 完整 → 提取 auth/tenant 两段列表", () => {
		const got = readBuiltinAnonymous(newTemplatesDir(FULL_CONFIG));
		expect(got.auth).toEqual(["/auth/login", "/auth/refresh", "/oj-market/converge"]);
		expect(got.tenant).toEqual(["/system/login-methods", "/oj-market/catalog/**"]);
	});

	it("模板缺 config 文件 → fail-fast 人话报错", () => {
		expect(() => readBuiltinAnonymous(newTemplatesDir(null))).toThrow(/模板 config\.yaml/);
	});

	it("模板缺 auth 段 → fail-fast", () => {
		expect(() => readBuiltinAnonymous(newTemplatesDir("tenant:\n  anonymous_paths: []\n"))).toThrow(/auth 段/);
	});

	it("段缺 anonymous_paths 键 → fail-fast", () => {
		expect(() => readBuiltinAnonymous(newTemplatesDir("auth:\n  jwt_secret: x\ntenant:\n  anonymous_paths: []\n"))).toThrow(/anonymous_paths/);
	});
});

describe("unionAnonymous（force-union：保留用户项，缺权威条目追加尾部，幂等）", () => {
	it("用户列表缺权威条目 → 追加尾部，原顺序与自定义项保留", () => {
		const got = unionAnonymous(["/custom/x", "/auth/login"], ["/auth/login", "/auth/refresh"]);
		expect(got).toEqual(["/custom/x", "/auth/login", "/auth/refresh"]);
	});

	it("用户列表已全含 → 幂等不变", () => {
		const got = unionAnonymous(["/auth/refresh", "/auth/login"], ["/auth/login", "/auth/refresh"]);
		expect(got).toEqual(["/auth/refresh", "/auth/login"]);
	});

	it("existing 非数组（用户删键） → 按空列表对待，全量补齐", () => {
		expect(unionAnonymous(undefined, ["/auth/login"])).toEqual(["/auth/login"]);
	});
});
