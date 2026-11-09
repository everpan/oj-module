// 静态红线守卫：防止「跨租户身份」实现回归到请求级 asSystem 逃生口 / 裸 SQL / 手写租户列。
//
// 为什么还要源码层这一道：L2 夹具是手写垫片（fixture.ts 头注释），真 SQL 构造器在 oj
// 二进制里。行为用例只能钉「垫片渲染出的 SQL 语义等价」——若有人把生产代码改回
// `db.asSystem()` 或裸 `db.exec(...)`，而垫片恰好还能跑，行为用例会假绿。这一层直接扫
// src（剥注释后）断言红线，改回即挂。
//
// 沿用 solutions-entry.spec.ts / seed-role-accounts.spec.ts 的 readFileSync 源码扫描先例。
// 覆盖的是「模板后端自己写的跨租户读写」，不约束 _platform 的既有通用件（如 query.ts
// 的遗留 paged 裸 SQL 包装器，零生产调用方，见该文件的诚实标注）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../src/app/api", import.meta.url));
const WECOM = join(API, "auth", "_shared", "wecom");
const STORE = join(WECOM, "store.ts");
const TENANT_ADMIN = join(WECOM, "tenant-admin.ts");

/**
 * 剥行注释与块注释。文本级近似，不处理字符串字面量里的 `//`（URL）——本套断言只判
 * 「调用形态是否出现」，且被扫文件里不存在「同一行 URL 后面还跟着 asSystem 调用」的写法。
 */
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function tsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (name !== "web") // 前端目录不在后端红线范围
				out.push(...tsFiles(p));
		}
		else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
			out.push(p);
		}
	}
	return out;
}

const codeOf = (p: string): string => stripComments(readFileSync(p, "utf8"));

const API_TS = tsFiles(API);
const WECOM_TS = tsFiles(WECOM);
const TARGETS = [STORE, TENANT_ADMIN];

describe("生产代码红线守卫（防止 asSystem / 裸 SQL 回归）", () => {
	it("src/app/api 全域零 db.asSystem() 调用（请求级逃生口已由 forTenant 语句级覆盖取代）", () => {
		const hits = API_TS.filter(f => /\.asSystem\s*\(/.test(codeOf(f)));
		expect(hits.map(f => f.replace(`${API}/`, ""))).toEqual([]);
	});

	it("auth/_shared/wecom 域零裸 db.exec / db.query（跨租户读写全部走构造器）", () => {
		const hits = WECOM_TS.filter(f => /\bdb\.(?:exec|query)\s*\(/.test(codeOf(f)));
		expect(hits.map(f => f.replace(`${API}/`, ""))).toEqual([]);
	});
});

describe("forTenant 收敛形态守卫（防止身份双轨 / 手写租户列）", () => {
	it("store.ts / tenant-admin.ts 不手写 tenant_id（租户条件一律由 forTenant 注入）", () => {
		// 手写相同值只是冗余，与覆盖值不符时上游直接报 insert tenant_id mismatch；
		// 更糟的是 where 里手写会让「当前请求租户」与「覆盖租户」两套身份并存。
		for (const f of TARGETS)
			expect(codeOf(f), f).not.toMatch(/tenant_id/);
	});

	it("两处跨租户入口确实使用 forTenant（防止删掉覆盖后悄悄退回当前请求租户）", () => {
		for (const f of TARGETS)
			expect(codeOf(f), f).toMatch(/\.forTenant\s*\(/);
	});

	it("forTenant 的 id 不直接取请求输入（http./req./body./query. 一律拒绝）", () => {
		// 上游红线：id 必须服务端派生。tenantId 是入口鉴权后显式指定的目标，或由
		// corp_id 查表推导；直接喂请求参数等于把租户身份交给调用方（跨租户泄露）。
		const args: string[] = [];
		for (const f of API_TS) {
			for (const m of codeOf(f).matchAll(/\.forTenant\s*\(([^)]*)\)/g))
				args.push(m[1]!.trim());
		}
		expect(args.length).toBeGreaterThan(0);
		for (const arg of args)
			expect(arg).not.toMatch(/^(?:g\.)?(?:http|req|request|body|query|ctx|params)\s*[.[]/i);
	});

	it("revokeTenantSessions 用 forTenant().truncate()（delete 无业务 where 会被真构造器拒）", () => {
		// 实测：forTenant(id).delete() 不带 where 时 run() 抛 `delete requires where`，
		// 守卫注入的 tenant_id 不算业务条件；truncate() 才是构造器里唯一的无 where 写动词。
		expect(codeOf(STORE)).toMatch(/\.forTenant\([^)]*\)\.truncate\(\)/);
	});
});
