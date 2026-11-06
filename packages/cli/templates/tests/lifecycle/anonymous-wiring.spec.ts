// BDD：市场匿名面接线（计划 v4 §五——签名推送不经账号口令，企微用户无障碍）。
// auth.anonymous_paths 与 tenant.anonymous_paths 双列（去 base 前缀形态）：
//   /oj-market/catalog/**  目录匿名读（站点身份发现面 + CLI 2×2 矩阵探测：旧站点 404 → 人话）
//   /oj-market/cdn/upload  签名推送端点（X-OJM-Key-Id/X-OJM-Signature 即凭证，不经 Bearer）
//   /oj-market/yank        签名下线端点（全分支终审 C1：不经匿名列表则 oj-auth 守卫在
//                          handler 前硬 401——文档承诺的签名制 yank 永远无法到达处理器）
// 匹配语义（oj-auth v0.1.20，../oj-bin 只读核实）：字面精确；`*` 恰一段；`**` 跨段（≥0 段）——
// `/oj-market/catalog/**` 同条覆盖 catalog 与 catalog/detail。
// 生效口径：config.yaml 是启动冻结段，改后须重启（restart_pending），发版说明提醒。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REQUIRED = ["/oj-market/catalog/**", "/oj-market/cdn/upload", "/oj-market/yank"];

function section(config: Record<string, unknown>, key: "auth" | "tenant"): string[] {
	const anon = (config[key] as Record<string, unknown>)?.anonymous_paths;
	return Array.isArray(anon) ? anon.filter((p): p is string => typeof p === "string") : [];
}

describe("场景：匿名接线（templates config.yaml 双列齐了市场匿名面）", () => {
	const config = parse(readFileSync(join(TEMPLATES, "config.yaml"), "utf-8")) as Record<string, unknown>;

	it("当 未登录访问目录/上传，则 auth.anonymous_paths 放行 catalog 两条 GET 与 upload", () => {
		const anon = section(config, "auth");
		for (const p of REQUIRED)
			expect(anon, `auth.anonymous_paths 缺 ${p}`).toContain(p);
	});

	it("当 CLI 裸 fetch 不带租户头推送，则 tenant.anonymous_paths 同列（缺头不 400）", () => {
		const anon = section(config, "tenant");
		for (const p of REQUIRED)
			expect(anon, `tenant.anonymous_paths 缺 ${p}`).toContain(p);
	});

	it("数据表 通配语义：catalog/** 覆盖 catalog 与 catalog/detail 两级（`**` 跨段 ≥0 段）", () => {
		// oj-auth v0.1.20 segments_match：`/` 分段后 `**` 匹配任意剩余段（含零段）。
		// 此处按同语义做分段模拟，钉死「一条覆盖两条 GET」的写法不因收紧而静默漏 detail。
		const match = (pattern: string, path: string): boolean => {
			const seg = (s: string) => s.split("/").filter(Boolean);
			const pat = seg(pattern);
			const p = seg(path);
			const rec = (i: number, j: number): boolean => {
				if (i === pat.length)
					return j === p.length;
				if (pat[i] === "**") {
					for (let k = j; k <= p.length; k++) {
						if (rec(i + 1, k))
							return true;
					}
					return false;
				}
				return j < p.length && (pat[i] === "*" || pat[i] === p[j]) && rec(i + 1, j + 1);
			};
			return rec(0, 0);
		};
		const pat = REQUIRED[0]!;
		expect(match(pat, "/oj-market/catalog")).toBe(true);
		expect(match(pat, "/oj-market/catalog/detail")).toBe(true);
		expect(match(pat, "/oj-market/index")).toBe(false);
	});
});
