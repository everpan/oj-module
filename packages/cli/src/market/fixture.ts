/**
 * fixture 方案包合成（T3）：生成一棵**能被安装器真正装下**的最小合法方案树。
 *
 * 形状取自 `scripts/verify-solution-smoke/make-solution.mjs`——那套字段组合已被真链路
 * （oj serve 安装 + ping 端点）验证过，这里照抄布局而不是另发明一套（DRY）。
 * 打包交给 `createDeterministicTgz`（同输入字节一致，不受 mtime/uid 影响）。
 */

import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
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
	// 迁移阶梯（T12）：minor ≥ 2 多一段 ALTER——upgrade 真的多走一段迁移，rollback 才有
	// 「包内最大 seq < 账本 head」可拦（OJ-9 宿主层预锁拦截的物理前提）。确定性：内容只依赖 name。
	if (minorOf(version) >= 2)
		fs.writeFileSync(path.join(mod, "migrations", "0002__more.sql"), `ALTER TABLE ${tableOf(name)} ADD COLUMN body TEXT;\n`);
	fs.writeFileSync(path.join(webDir, "entry.js"), `console.log("${name} ${version}");\n`);
	fs.writeFileSync(path.join(webDir, "main.css"), `.${cssClassOf(name, version)} { color: red; }\n`);

	return { name, version, dir, manifestPath: path.join(dir, "manifest.yaml") };
}

/** 表名：只允许标识符字符（fixture 名可能带连字符） */
function tableOf(name: string): string {
	return `${name.replace(/\W/g, "_")}_note`;
}

/** minor 段取数（迁移阶梯判定用；非 semver 形态一律按 0 处理） */
function minorOf(version: string): number {
	const m = /^\d+\.(\d+)/.exec(version);
	return m === null ? 0 : Number(m[1]);
}

/**
 * 手造 zip-slip 恶意 tgz（成员 `../evil.sql`）——neg-evil op 的上传载荷。
 * 为什么不用 createDeterministicTgz：它只打包真实目录树，文件系统里造不出 `../` 成员；
 * ustar 头是纯字节布局，手写 40 行可控成员名。确定性：mtime 置 0，同输入恒同字节。
 */
export function buildEvilZipSlipTgz(outPath: string): string {
	const chunks: Buffer[] = [];
	for (const [name, content] of [
		["../evil.sql", "DROP TABLE users;"],
		["manifest.yaml", "name: evil-solution\nversion: 9.9.9\n"],
	] as Array<[string, string]>) {
		const header = Buffer.alloc(512);
		header.write(name, 0, "utf-8"); // name[100]
		header.write("0000644\0", 100); // mode
		header.write("0000000\0", 108); // uid
		header.write("0000000\0", 116); // gid
		header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124); // size[12]
		header.write("00000000000\0", 136); // mtime[12] 置 0（确定性）
		header.fill(0x20, 148, 156); // chksum 先填空格
		header.write("0", 156); // typeflag：普通文件
		header.write("ustar\0", 257); // magic
		header.write("00", 263); // version
		let sum = 0;
		for (const b of header)
			sum += b;
		header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148); // chksum[8]
		chunks.push(header, Buffer.from(content));
		const pad = Math.ceil(content.length / 512) * 512 - content.length;
		if (pad > 0)
			chunks.push(Buffer.alloc(pad));
	}
	chunks.push(Buffer.alloc(1024)); // 尾零块
	fs.writeFileSync(outPath, gzipSync(Buffer.concat(chunks)));
	return outPath;
}

function cssClassOf(name: string, version: string): string {
	return `${name}-v${version.replace(/[^0-9A-Z]/gi, "-")}`;
}

/**
 * 方案清单（Form A：archive 只写 file，sha256/size 由索引侧填 Form B）。
 * 导出给 build-index 的体积实测用：需求 §7 估「单条 Form B ≈535–684B」偏乐观——本形态
 * 实测 945B YAML、进索引 ≈1.2KB/条，SHARD_MAX_VERSIONS 的 1000 校准即以它为据。
 */
export function solutionManifest(name: string, version: string): Record<string, unknown> {
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
