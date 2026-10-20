/**
 * fixture 方案包合成（T3）：生成一棵**能被安装器真正装下**的最小合法方案树。
 *
 * 形状取自 `scripts/verify-solution-smoke/make-solution.mjs`——那套字段组合已被真链路
 * （oj serve 安装 + ping 端点）验证过，这里照抄布局而不是另发明一套（DRY）。
 * 打包交给 `createDeterministicTgz`（同输入字节一致，不受 mtime/uid 影响）。
 */

import fs from "node:fs";
import path from "node:path";
import { stringify as yamlStringify } from "yaml";

export interface FixturePackage {
	name: string
	version: string
	/** 方案树根目录：<staging>/<name>-<version> */
	dir: string
	manifestPath: string
}

export const DEFAULT_FIXTURE_NAME = "demo-solution";
export const DEFAULT_FIXTURE_VERSION = "0.1.0";

/** 解析 `--fixture <name>@<version>`；缺省/缺段用默认值补齐 */
export function parseFixtureSpec(spec?: string): { name: string, version: string } {
	if (spec === undefined || spec.trim() === "" || spec === "latest")
		return { name: DEFAULT_FIXTURE_NAME, version: DEFAULT_FIXTURE_VERSION };
	const at = spec.lastIndexOf("@");
	if (at <= 0)
		return { name: spec.trim(), version: DEFAULT_FIXTURE_VERSION };
	const name = spec.slice(0, at).trim();
	const version = spec.slice(at + 1).trim();
	return { name: name === "" ? DEFAULT_FIXTURE_NAME : name, version: version === "" ? DEFAULT_FIXTURE_VERSION : version };
}

export function buildFixturePackage(opts: { stagingDir: string, name?: string, version?: string }): FixturePackage {
	const name = opts.name ?? DEFAULT_FIXTURE_NAME;
	const version = opts.version ?? DEFAULT_FIXTURE_VERSION;
	const dir = path.join(opts.stagingDir, `${name}-${version}`);
	const mod = path.join(dir, "api", `${name}-${version}`);
	const webDir = path.join(dir, "web", "modules", name, version);
	fs.mkdirSync(path.join(mod, "migrations"), { recursive: true });
	fs.mkdirSync(path.join(mod, "ping"), { recursive: true });
	fs.mkdirSync(webDir, { recursive: true });

	fs.writeFileSync(path.join(dir, "manifest.yaml"), yamlStringify(solutionManifest(name, version)));
	// oj 模块清单：oj 侧对齐 schema/迁移归属
	fs.writeFileSync(path.join(mod, "manifest.yaml"), `name: ${name}\ndesc: ${name} ${version} 模块\nversion: ${version}\ntables:\n  - ${tableOf(name)}\n`);
	fs.writeFileSync(path.join(mod, "routes.js"), `export default [{ method: "get", pattern: "${name}/ping", file: "ping/api.js" }];\n`);
	// ping 处理器必须调 oj 运行时的全局 json.ok：直接 return 对象会被丢掉，装完看不到健康探针响应
	fs.writeFileSync(path.join(mod, "ping", "api.js"), `export default { async get() { json.ok({ pong: true, module: "${name}", version: "${version}" }); } };\n`);
	fs.writeFileSync(path.join(mod, "migrations", "0001__init.sql"), `CREATE TABLE ${tableOf(name)} (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n`);
	fs.writeFileSync(path.join(webDir, "entry.js"), `console.log("${name} ${version}");\n`);
	fs.writeFileSync(path.join(webDir, "main.css"), `.${cssClassOf(name, version)} { color: red; }\n`);

	return { name, version, dir, manifestPath: path.join(dir, "manifest.yaml") };
}

/** 表名：只允许标识符字符（fixture 名可能带连字符） */
function tableOf(name: string): string {
	return `${name.replace(/\W/g, "_")}_note`;
}

function cssClassOf(name: string, version: string): string {
	return `${name}-v${version.replace(/[^0-9A-Z]/gi, "-")}`;
}

/** 方案清单（Form A：archive 只写 file，sha256/size 由索引侧填 Form B） */
function solutionManifest(name: string, version: string): Record<string, unknown> {
	return {
		name,
		version,
		title: `${name} fixture`,
		summary: `本地模拟 CDN 的 fixture 方案（${name} ${version}）`,
		author: "ojm-market",
		license: "MIT",
		changelog: [`${version} fixture 初始版本`],
		peerRuntime: ">=0.0.0",
		health: `/${name}/ping`,
		archive: { file: `${name}-${version}.tgz` },
		api: { module: name, prefix: `/api/${name}`, tables: [tableOf(name)], anonymous: [`${name}/ping`] },
		web: { entry: `modules/${name}/${version}/entry.js`, css: [`modules/${name}/${version}/main.css`] },
		routes: [
			{ path: `/${name}`, category: "main", order: 200, title_key: `${name}:menu.main` },
			{ path: `/${name}/ping`, category: "hidden", order: 205, title_key: `${name}:menu.ping` },
		],
		permissions: [{ code: `${name}.view`, title_key: `${name}:perm.view` }],
		roles: [{ name: `${name}.admin`, title_key: `${name}:role.admin`, permissions: [`${name}.view`] }],
	};
}
