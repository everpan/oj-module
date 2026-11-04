import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATE_DIR } from "../helpers/paths";

/**
 * 模板工程 i18n 完整性守卫。
 *
 * 2026-11-02 内置模块聚合为 `src/app/web` 多根模块后，`system/pages/settings` 被重写为
 * 简化版，漏掉了 `setting.group.*` 与 `setting.market_cdn_url` 文案——脚手架跑起来中英文
 * 都直接显示 `general` / `framework.market_cdn_url` 这类键名。这里把「文案 key 的来源」
 * （源码 t() 调用、seed 的 label_key/title_key、设置页按组拼的标题）与 locale 文件对齐，
 * 防止再次漏迁。
 */

const WEB_DIR = path.join(TEMPLATE_DIR, "src/app/web");
const ENTRY_PATH = path.join(WEB_DIR, "entry.ts");
const SEED_PATH = path.join(TEMPLATE_DIR, "src/app/api/_platform/seed.sql");
const MARKET_DIR = path.join(TEMPLATE_DIR, "src/oj-market/web");
const LOCALES = ["zh-CN", "en-US"] as const;

type LocaleTree = Record<string, unknown>;

/** 从 entry.ts 的 i18nNamespaces 解析 namespace → locales 目录 */
function readNamespaces(): Map<string, string> {
	const entry = fs.readFileSync(ENTRY_PATH, "utf-8");
	const namespaces = new Map<string, string>();
	const pattern = /"([\w-]+)"\s*:\s*\{\s*"zh-CN"\s*:\s*\(\)\s*=>\s*import\("([^"]+)"\)/g;
	for (const match of entry.matchAll(pattern))
		namespaces.set(match[1], path.resolve(path.dirname(ENTRY_PATH), path.dirname(match[2])));
	return namespaces;
}

/** 展开 JSON 为点分叶子 key 集合（如 setting.group.general） */
function flattenKeys(tree: LocaleTree, prefix = ""): string[] {
	const keys: string[] = [];
	for (const [key, value] of Object.entries(tree)) {
		const full = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object" && !Array.isArray(value))
			keys.push(...flattenKeys(value as LocaleTree, full));
		else
			keys.push(full);
	}
	return keys;
}

const namespaces = readNamespaces();

/** namespace → locale → 叶子 key 集合 */
const localeKeys = new Map<string, Map<string, Set<string>>>();
for (const [namespace, localesDir] of namespaces) {
	const byLocale = new Map<string, Set<string>>();
	for (const locale of LOCALES) {
		const file = path.join(localesDir, `${locale}.json`);
		byLocale.set(locale, new Set(flattenKeys(JSON.parse(fs.readFileSync(file, "utf-8")))));
	}
	localeKeys.set(namespace, byLocale);
}

function collectSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "__client" && entry.name !== "locales")
				files.push(...collectSourceFiles(fullPath));
		}
		else if (/\.tsx?$/.test(entry.name)) {
			files.push(fullPath);
		}
	}
	return files;
}

function assertKeyExists(namespace: string, key: string, source: string, errors: string[]) {
	const byLocale = localeKeys.get(namespace);
	if (!byLocale) {
		errors.push(`${source}: namespace "${namespace}" is not registered in entry.ts i18nNamespaces`);
		return;
	}
	for (const locale of LOCALES) {
		if (!byLocale.get(locale)!.has(key))
			errors.push(`${source}: ${locale} locale missing "${namespace}:${key}"`);
	}
}

describe("模板工程 i18n 完整性", () => {
	it("源码中的 t(\"ns:key\") 必须在对应 locale 双语存在", () => {
		const errors: string[] = [];
		for (const file of collectSourceFiles(WEB_DIR)) {
			const source = fs.readFileSync(file, "utf-8");
			const relative = path.relative(TEMPLATE_DIR, file);
			for (const match of source.matchAll(/t\(\s*"([\w-]+):([^"]+)"/g))
				assertKeyExists(match[1], match[2], `${relative} t("${match[0].slice(3)}")`, errors);
		}
		expect(errors, errors.join("\n")).toEqual([]);
	});

	it("seed 的 label_key / title_key 必须在对应 locale 双语存在", () => {
		const errors: string[] = [];
		const seed = fs.readFileSync(SEED_PATH, "utf-8");
		for (const match of seed.matchAll(/'([\w-]+):([\w.-]+)'/g)) {
			const [, namespace, key] = match;
			// 只校验已注册到 web 侧的命名空间（seed 里可能还有别的写法）
			if (!namespaces.has(namespace))
				continue;
			assertKeyExists(namespace, key, `seed.sql "${namespace}:${key}"`, errors);
		}
		expect(errors, errors.join("\n")).toEqual([]);
	});

	it("系统设置页展示的框架设置组必须有 setting.group.* 标题", () => {
		const seed = fs.readFileSync(SEED_PATH, "utf-8");
		const frameworkModules = new Set(["framework", "ldap", "sso"]);
		const groups = new Set<string>();
		const rowPattern = /INSERT OR IGNORE INTO sys_setting \([^)]*\) VALUES \('[^']+', '([^']+)', '([^']+)'/g;
		for (const match of seed.matchAll(rowPattern)) {
			if (frameworkModules.has(match[1]))
				groups.add(match[2]);
		}

		const errors: string[] = [];
		for (const group of groups)
			assertKeyExists("system", `setting.group.${group}`, `seed.sql setting group "${group}"`, errors);
		expect(errors, errors.join("\n")).toEqual([]);
	});

	/**
	 * 内置角色的 `title` 是种子里的站点默认语言文本（中文），英文界面靠页面按角色名
	 * 再查一层 `system:rolesPage.roleTitle.*`。角色是固定枚举（domain/roles.ts 的 RESERVED），
	 * 少一条就在英文界面露出中文，故把种子里的 builtin 行钉进用例。
	 */
	it("seed 内置角色必须都有 rolesPage.roleTitle.* 翻译", () => {
		const seed = fs.readFileSync(SEED_PATH, "utf-8");
		const errors: string[] = [];
		let count = 0;
		for (const match of seed.matchAll(/INSERT OR IGNORE INTO sys_role \([^)]*\) VALUES \('([^']+)', '[^']*', '[^']*', 1\)/g)) {
			count++;
			assertKeyExists("system", `rolesPage.roleTitle.${match[1]}`, `seed.sql builtin role "${match[1]}"`, errors);
		}
		expect(count, "seed.sql 里没找到 builtin 角色行，守卫失效").toBeGreaterThan(0);
		expect(errors, errors.join("\n")).toEqual([]);
	});

	/**
	 * 安装对话框按 `task:stage.${record.stage}` 动态拼 key，静态扫描抓不到；
	 * 这里拿 oj-market 的 InstallStage 枚举逐项对 locale，防止新增阶段后显示裸 stage 名。
	 */
	it("oj-market 安装阶段枚举必须全部有 task.stage.* 文案", () => {
		const types = fs.readFileSync(path.join(MARKET_DIR, "types.ts"), "utf-8");
		const union = types.match(/export type InstallStage = ([^;]+);/)?.[1] ?? "";
		const stages = [...union.matchAll(/"([\w-]+)"/g)].map(match => match[1]);
		expect(stages.length, "types.ts 里没解析到 InstallStage 枚举，守卫失效").toBeGreaterThan(0);

		const errors: string[] = [];
		for (const locale of LOCALES) {
			const file = path.join(MARKET_DIR, "locales", `${locale}.json`);
			const tree = JSON.parse(fs.readFileSync(file, "utf-8")) as { task?: { stage?: Record<string, unknown> } };
			for (const stage of stages) {
				if (typeof tree.task?.stage?.[stage] !== "string")
					errors.push(`oj-market ${locale} locale missing "task.stage.${stage}"`);
			}
		}
		expect(errors, errors.join("\n")).toEqual([]);
	});
});
