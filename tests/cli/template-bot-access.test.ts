import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATE_DIR } from "../helpers/paths";

/**
 * 机器人接入管理端（mcp-bot-guide 线路 B，oj 0.1.130）跨文件接线回归守卫。
 *
 * 这条功能横跨七层：openapi 契约 → 生成 __client → 后端 handler → 域服务/迁移/共享表
 * → config 锚点 → 前端路由/菜单 → 面板/双语文案。任何一处接线断开，脚手架跑起来就是
 * 「端点 404 / 页面 404 / 契约过期」，而现有守卫只分别钉住其中几环（tenant-scope 管共享表、
 * schema-columns 管迁移序号、i18n 管被 t() 用到的 key、vendor 管版本），并不对账
 * 「端点集合 ↔ 生成函数 ↔ handler 文件 ↔ 前端路由」这条链，也不管 `# ojm:mcp-modules`
 * 安装器锚点。故集中一处把这条链钉成清单，新增/删除端点时必须同步改这里。
 */

const T = TEMPLATE_DIR;
const read = (rel: string) => readFileSync(join(T, rel), "utf-8");
const has = (rel: string) => existsSync(join(T, rel));

/** 七条机器人端点（与 oj openapi 自省产物逐条对齐）。 */
const BOT_PATHS = [
	"/api/auth/obo",
	"/api/system/service-token",
	"/api/system/bot-binding",
	"/api/system/bot-binding/import",
	"/api/system/bot-binding/export",
	"/api/system/obo-audit",
	"/api/system/obo-audit/export",
];

/** 生成 client 导出的机器人函数（system 域 10 个 + auth 域 obo 1 个）。 */
const SYSTEM_BOT_FNS = [
	"systemServiceTokenGet",
	"systemServiceTokenPost",
	"systemServiceTokenDelete",
	"systemBotBindingGet",
	"systemBotBindingPost",
	"systemBotBindingDelete",
	"systemBotBindingImportPost",
	"systemBotBindingExportGet",
	"systemOboAuditGet",
	"systemOboAuditExportGet",
];

const BACKEND_FILES = [
	"src/app/api/system/service-token/api.ts",
	"src/app/api/system/bot-binding/api.ts",
	"src/app/api/system/bot-binding/import/api.ts",
	"src/app/api/system/bot-binding/export/api.ts",
	"src/app/api/system/obo-audit/api.ts",
	"src/app/api/system/obo-audit/export/api.ts",
	"src/app/api/auth/obo/api.ts",
	"src/app/api/_platform/_shared/service/domain/bot.ts",
	"src/app/api/_platform/migrations/0007__mcp_svc_tables.sql",
	"src/app/api/_platform/migrations/0007__mcp_svc_tables.mysql.sql",
	"src/app/api/_platform/migrations/0007__mcp_svc_tables.pg.sql",
];

const WEB_FILES = [
	"src/app/web/system/pages/bot/index.tsx",
	"src/app/web/system/pages/bot/ServiceToken.tsx",
	"src/app/web/system/pages/bot/BotBinding.tsx",
	"src/app/web/system/pages/bot/OboAudit.tsx",
	"src/app/web/system/pages/bot/Guide.tsx",
	"src/app/web/system/pages/bot/csv.ts",
];

describe("模板机器人接入管理端接线（线路 B 回归）", () => {
	it("openapi.json 恰含七条机器人端点，__client 暴露对应生成函数", () => {
		const paths = JSON.parse(read("openapi.json")).paths as Record<string, unknown>;
		for (const p of BOT_PATHS)
			expect(paths, `契约缺端点 ${p}`).toHaveProperty(p);

		const systemClient = read("src/app/web/system/__client/index.ts");
		for (const fn of SYSTEM_BOT_FNS)
			expect(systemClient, `system __client 缺生成函数 ${fn}`).toContain(`export async function ${fn}(`);
		expect(read("src/app/web/auth/__client/index.ts")).toContain("export async function authOboPost(");
	});

	it("后端七 handler + 域服务 + 0007 三方言迁移落地，共享表与安装器锚点在位", () => {
		for (const f of BACKEND_FILES)
			expect(has(f), `缺后端文件 ${f}`).toBe(true);

		const schema = read("src/app/api/_platform/schema.yaml");
		const config = read("config.yaml");
		for (const table of ["oj_svc_token", "oj_bot_binding", "oj_obo_audit"]) {
			expect(schema, `schema.yaml 缺共享表 ${table}`).toContain(`${table}:`);
			expect(config, `config.yaml shared_allow 缺 ${table}`).toContain(`- ${table}`);
		}
		// 安装器文本锚点：删掉它方案安装不再登记 modules 白名单，机器人目录会空
		expect(config, "config.yaml 丢了 # ojm:mcp-modules 安装器锚点").toContain("# ojm:mcp-modules");
	});

	it("前端路由/菜单/面板/双语 bot 文案接线齐全", () => {
		const routes = read("src/app/web/system/routes.ts");
		expect(routes).toContain("\"/system/framework/bot\"");
		expect(routes).toContain("\"system:menu.bot\"");
		expect(routes).toContain("roles: [\"superadmin\"]");
		for (const f of WEB_FILES)
			expect(has(f), `缺前端文件 ${f}`).toBe(true);

		// menu.bot 是路由 handle 的字面量（不是 t() 调用），i18n 守卫抓不到，单独钉
		for (const locale of ["zh-CN", "en-US"]) {
			const tree = JSON.parse(read(`src/app/web/system/locales/${locale}.json`));
			expect(tree.menu, `${locale} 缺 menu.bot`).toHaveProperty("bot");
			for (const tab of ["token", "binding", "audit", "guide"])
				expect(tree.bot.tab, `${locale} 缺 bot.tab.${tab}`).toHaveProperty(tab);
		}
	});
});
