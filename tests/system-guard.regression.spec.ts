import type { DatabaseSync } from "node:sqlite";

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "./helpers/paths";

/**
 * B16 回归（2026-10-24）：system 模块的 requiredRoles 门禁必须同时覆盖 seed 的
 * 两个内置管理账号——admin（roles=["admin"]）与 superadmin（roles=["superadmin"]）。
 *
 * 历史事故：entry.ts 注释曾写「seed 的 admin 账号只有 superadmin」，诱导把配置
 * 改成 ["admin"]——2026-10-22 D12 起账号名=角色名一一对应，admin 账号自有 admin
 * 角色，改窄后 superadmin 账号反被挡在 /system 外：getRoutes() 在注册期用实时
 * roles 过滤（module-loader B16），模块路由整体消失，登录后访问即落 404 兜底
 * （「返回首页」），且硬刷新前不恢复。
 *
 * 本 spec 全程从真实文件取证，不硬编码期望值：
 *   - requiredRoles ← templates/src/system/web/entry.ts 真实配置
 *   - 账号角色绑定 ← templates/src/_platform/api 的 migrations + seed.sql 重放
 *     （内存 sqlite，口径同 templates/tests/seed-role-accounts.spec.ts）
 * 判定式与 runtime getRoutes() 同款（命中任一角色即放行）。改 entry.ts 的
 * requiredRoles 前先跑本 spec；变异验证：只留 ["admin"] 时 superadmin 相关
 * 用例立刻变红（正是上面那条历史事故）。
 */

const req = createRequire(import.meta.url);
const { DatabaseSync: Db } = req("node:sqlite") as { DatabaseSync: typeof DatabaseSync };

const TEMPLATES_DIR = `${PROJECT_ROOT}/packages/cli/templates`;
const SYSTEM_ENTRY = `${TEMPLATES_DIR}/src/system/web/entry.ts`;
const PLATFORM_API = `${TEMPLATES_DIR}/src/_platform/api`;

/** 从 entry.ts 源码读取真实的 requiredRoles 配置（不 import 模块，避免拉起整棵页面依赖树） */
function readRequiredRoles(): string[] {
	const source = readFileSync(SYSTEM_ENTRY, "utf8");
	const matched = source.match(/requiredRoles:\s*\[([^\]]*)\]/);
	// 解析不到 = 文件被重构过，必须显式失败而不是静默放行
	expect(matched, `未能在 ${SYSTEM_ENTRY} 中解析到 requiredRoles 配置`).toBeTruthy();
	const roles = [...matched![1]!.matchAll(/["']([^"']+)["']/g)].map(m => m[1]!);
	expect(roles.length, "requiredRoles 不应为空").toBeGreaterThan(0);
	return roles;
}

/** 重放 _platform 迁移 + seed.sql 到内存 sqlite（seed 按英文分号朴素切分，同 oj 运行时口径） */
function replayPlatformSeed(): InstanceType<typeof DatabaseSync> {
	const dbo = new Db(":memory:");
	const migrations = join(PLATFORM_API, "migrations");
	for (const f of readdirSync(migrations).filter(f => f.endsWith(".sql") && !/\.(?:mysql|pg)\.sql$/.test(f)).sort())
		dbo.exec(readFileSync(join(migrations, f), "utf8"));
	for (const stmt of readFileSync(join(PLATFORM_API, "seed.sql"), "utf8").split(";")) {
		const sql = stmt.trim();
		if (sql)
			dbo.exec(sql);
	}
	return dbo;
}

/** 账号在 seed 重放后的角色绑定（sys_user_role 唯一权威源，D10） */
function accountRoles(dbo: InstanceType<typeof DatabaseSync>, username: string): string[] {
	const rows = dbo.prepare("SELECT role_name FROM sys_user_role WHERE user_id = (SELECT id FROM users WHERE username = ?)").all(username) as Array<{ role_name: string }>;
	return rows.map(r => r.role_name);
}

/** runtime getRoutes() 的 B16 过滤判定（module-loader/index.ts）：命中任一声明角色即放行 */
function passesGate(requiredRoles: string[], roles: string[]): boolean {
	return requiredRoles.some(role => roles.includes(role));
}

const requiredRoles = readRequiredRoles();
const dbo = replayPlatformSeed();

describe("system 模块 requiredRoles 门禁回归（B16 / D12）", () => {
	it("entry.ts 的 requiredRoles 同时包含 admin 与 superadmin（对齐后端 assertSystemAdmin 口径）", () => {
		expect(requiredRoles).toContain("admin");
		expect(requiredRoles).toContain("superadmin");
	});

	it("seed 重放：admin 账号（绑定 admin 角色）满足门禁", () => {
		const roles = accountRoles(dbo, "admin");
		expect(roles).toEqual(["admin"]);
		expect(passesGate(requiredRoles, roles)).toBe(true);
	});

	it("seed 重放：superadmin 账号（绑定 superadmin 角色）满足门禁", () => {
		const roles = accountRoles(dbo, "superadmin");
		expect(roles).toEqual(["superadmin"]);
		expect(passesGate(requiredRoles, roles)).toBe(true);
	});

	it("两个内置管理账号（admin / superadmin）都满足门禁——登录后 /system/* 路由可注入", () => {
		for (const username of ["admin", "superadmin"]) {
			expect(passesGate(requiredRoles, accountRoles(dbo, username)), `${username} 被 requiredRoles 挡在门外`).toBe(true);
		}
	});

	it("非管理账号（viewer）仍被门禁挡住（防退化为全放行）", () => {
		expect(passesGate(requiredRoles, accountRoles(dbo, "viewer"))).toBe(false);
	});
});
