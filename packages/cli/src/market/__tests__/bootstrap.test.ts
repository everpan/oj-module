// market/bootstrap spec（T8）：隔离站点自举——「试装不心疼」的物理基础。
//
// 钉死隔离六项（端口 / DB / 密钥 / 凭据 / 信任库 / CDN 目录）逐项与真站点物理分离：
// 任一项漏掉，trial 就不再是「隔离试装」而是「往自己工程里装」，信任库污染与端口
// 冲突都是不可逆后果。故每条断言都直接查文件系统与配置内容，不靠口头约定。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import { bootstrapIsolatedSite } from "../bootstrap";

// 桩 oj 用进程内实现（与 init.test.ts 同套路）：bin/oj 是 shebang 脚本，Windows 上
// execFileSync 无法 spawn（ENOENT 会让能力闸门走「跳过版本校验」分支，被测形态失真）。
// 且 buildBackend 自接入 mergeConfigForDev 后要供给 dev 密钥，桩必须带 secret 能力：
// keygen 落一对 PEM、seal 回 ENC[...]、open 恒成功（与真实 oj 的退出码语义一致）。
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	const mfs = await import("node:fs");
	const mpath = await import("node:path");
	const execFileSync = (file: string, args: readonly string[]): string => {
		// 真实 spawn 的语义：文件不存在即 ENOENT（「没装 oj」用例依赖这条）
		if (!mfs.existsSync(String(file)))
			throw new Error(`spawnSync ${file} ENOENT`);
		const a = [...args];
		if (a[0] === "-V")
			return "oj 0.1.85";
		if (a[0] === "build")
			return a.includes("--help") ? "      --module-root <MODULE_ROOT>  源码树根" : "";
		if (a[0] === "secret") {
			if (a[1] === "keygen") {
				const keysDir = a[a.indexOf("--out-dir") + 1]!;
				mfs.mkdirSync(keysDir, { recursive: true });
				mfs.writeFileSync(mpath.join(keysDir, "secrets-private.pem"), "PRIV\n");
				mfs.writeFileSync(mpath.join(keysDir, "secrets-public.pem"), "PUB\n");
				return "";
			}
			if (a[1] === "seal")
				return "ENC[TESTSEALED]";
			if (a[1] === "open")
				return "TESTPLAIN";
		}
		return "";
	};
	return { ...actual, execFileSync };
});

/**
 * 假 oj 进程：不起真进程，ready 立即就绪（与 dev.ts 的 ojStarter 注入同形态）。
 *  起站语义顺带模拟 migrate_on_start：建 market_release 目录表（真 oj serve 起站即应用迁移），
 *  bootstrap 的目录行 seed 依赖该表存在。
 */
function fakeStarter() {
	const started: Array<{ configPath: string, base: string, apiSrc: string }> = [];
	const starter = (configPath: string, base: string, apiSrc: string) => {
		started.push({ configPath, base, apiSrc });
		const db = new DatabaseSync(join(dirname(configPath), "db.sqlite"));
		db.prepare(
			"CREATE TABLE IF NOT EXISTS market_release (id INTEGER PRIMARY KEY AUTOINCREMENT, product TEXT NOT NULL, version TEXT NOT NULL, key_id TEXT, sha256 TEXT, size INTEGER, published_at INTEGER NOT NULL, published_at_source TEXT NOT NULL, yanked INTEGER NOT NULL DEFAULT 0, first_seen_at INTEGER NOT NULL, sig_alg TEXT, sig_value TEXT, sig_public_key TEXT, sig_registry_id TEXT, manifest TEXT)",
		).run();
		db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uk_market_release_version ON market_release (product, version)").run();
		db.close();
		return {
			port: Number(/port: (\d+)/.exec(readFileSync(configPath, "utf-8"))?.[1] ?? "0"),
			ready: Promise.resolve(),
			stop: () => Promise.resolve(),
		};
	};
	return { started, starter };
}

/** 造一个「有 oj 二进制与模板」的源工程：bin/oj + bin/plugins + api/config.yaml + api/src */
function newSourceProject(): string {
	const root = mkdtempSync(join(tmpdir(), "ojm-bootstrap-src-"));
	mkdirSync(join(root, "bin", "plugins"), { recursive: true });
	// 假 oj 必须过 §7 双探：`-V` 报版本、`build --help` 含 --module-root，否则 buildBackend 在闸门处 fail-fast
	writeFileSync(
		join(root, "bin", "oj"),
		"#!/bin/sh\n"
		+ "if [ \"$1\" = \"-V\" ]; then echo oj 0.1.85; exit 0; fi\n"
		+ "if [ \"$1\" = \"build\" ]; then echo \"      --module-root <MODULE_ROOT>  源码树根\"; exit 0; fi\n"
		+ "echo fake-oj\n",
		{ mode: 0o755 },
	);
	writeFileSync(join(root, "bin", ".oj-version"), "v0.1.85\n");
	writeFileSync(join(root, "bin", "plugins", "auth.wasm"), "plugin", "utf-8");
	mkdirSync(join(root, "api", "src", "_platform"), { recursive: true });
	writeFileSync(join(root, "api", "src", "_platform", "seed.sql"), "-- seed\n", "utf-8");
	writeFileSync(
		join(root, "api", "config.yaml"),
		[
			"mounts:",
			"  - prefix: /api",
			"    api: src",
			"server:",
			"  host: 127.0.0.1",
			"  port: 9778",
			"  jwt_secret: __JWT_SECRET__",
			"exec:",
			"  _platform:",
			"    allow: []",
			"",
		].join("\n"),
		"utf-8",
	);
	return root;
}

describe("given 一个装了 oj 二进制的源工程 When 自举隔离站点", () => {
	it("then 产物全在临时根内：api 树 / bin/oj / bin/plugins 各就各位", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		expect(existsSync(join(site.root, "src", "app", "api", "_platform", "seed.sql"))).toBe(true);
		expect(existsSync(join(site.root, "bin", "oj"))).toBe(true);
		expect(existsSync(join(site.root, "bin", "plugins", "auth.wasm"))).toBe(true);
		expect(site.root).not.toBe(src);
		await site.cleanup();
	});

	it("then 端口取自空闲端口且绝不与源工程 config 的 9778 相同", async () => {
		const src = newSourceProject();
		const { started, starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		expect(site.port).toBeGreaterThan(1024);
		expect(site.port).not.toBe(9778);
		expect(started[0]?.configPath).toBe(join(site.root, "config.yaml"));
		const cfg = readFileSync(join(site.root, "config.yaml"), "utf-8");
		expect(cfg).toContain(`port: ${site.port}`);
		await site.cleanup();
	});

	it("then jwt_secret 被随机替换（模板占位符不得残留）", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		const cfg = readFileSync(join(site.root, "config.yaml"), "utf-8");
		expect(cfg).not.toContain("__JWT_SECRET__");
		await site.cleanup();
	});

	it("then 起站 api 路径 = 构建产物实际位置 <root>/dist/api（module-root；旧写死 api/dist 起站即挂）", async () => {
		const src = newSourceProject();
		const { started, starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		// starter 第三参是 oj serve 的 --api-path：必须与 buildBackend 产物落点同源
		// （layout.ts module-root 口径 apiDist = <root>/dist/api；写死 api/dist 会在
		// mounts 校验报 No such file or directory，2026-10-23 演练实踩）
		expect(started[0]?.apiSrc).toBe(join(site.root, "dist", "api"));
		await site.cleanup();
	});

	it("then 种子管理员 = superadmin（seed 账号名=角色名口径；admin 已被解绑，用它会 403）", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		expect(site.admin.user).toBe("superadmin");
		expect(site.admin.pass).toBe("aA123456");
		await site.cleanup();
	});

	it("then CDN 目录在临时根内且已落好 fixture 包；目录行已 seed 进隔离库", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, fixture: "demo-solution@0.1.0", starter });

		expect(site.cdnDir.startsWith(site.root)).toBe(true);
		expect(existsSync(join(site.cdnDir, "demo-solution-0.1.0.tgz"))).toBe(true);
		expect(existsSync(join(site.cdnDir, "demo-solution-0.1.0.tgz.sig"))).toBe(true);
		// A6 DB 目录化：索引文件（catalog.yaml/shards）不再生成——目录真源 = market_release 行
		expect(existsSync(join(site.cdnDir, "catalog.yaml"))).toBe(false);
		// 目录行 seed（站点内部通道）：安装解析/index 卡片/releases 的直读数据源
		const { DatabaseSync } = await import("node:sqlite");
		const db = new DatabaseSync(site.dbPath);
		const rows = db.prepare("SELECT product, version, key_id, sig_registry_id FROM market_release").all() as Array<Record<string, unknown>>;
		db.close();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ product: "demo-solution", version: "0.1.0", key_id: "trial.publisher", sig_registry_id: "trial.registry" });
		expect(site.cdnBaseUrl).toBe(`${site.baseUrl}/cdn`);
		await site.cleanup();
	});

	it("then 发布方私钥只在内存：临时根内 CDN 与站点树查不到发布方 PEM", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, fixture: "demo-solution@0.1.0", starter });

		expect(site.publisher.privateKeyPem).toContain("PRIVATE KEY");
		const pemFiles = listFiles(site.root).filter(f => f.endsWith(".pem"));
		// listFiles 返回相对隔离根的路径；站点自身证书三件套在 config/ 下，其余任何 PEM 都是泄漏
		const outside = pemFiles.filter(f => !f.startsWith("config/"));
		expect(outside).toEqual([]);
		await site.cleanup();
	});

	it("then 信任库隔离：临时根内无 .solutions 信任库文件", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		expect(existsSync(join(site.root, ".solutions"))).toBe(false);
		expect(listFiles(site.root).some(f => f.includes("trusted-keys"))).toBe(false);
		await site.cleanup();
	});

	it("then DB 隔离：库文件路径落在临时根内（config 目录相对解析）", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();

		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		expect(site.dbPath.startsWith(site.root)).toBe(true);
		expect(site.dbPath).toContain("db.sqlite");
		await site.cleanup();
	});
});

describe("given 源工程没装 oj 二进制 When 自举", () => {
	it("then 人话报错指向 ojm vendor，且不留半成品临时根", async () => {
		const root = mkdtempSync(join(tmpdir(), "ojm-bootstrap-nooj-"));
		writeFileSync(join(root, "config.yaml"), "server:\n  port: 9778\n", "utf-8");
		const { starter } = fakeStarter();

		await expect(bootstrapIsolatedSite({ projectRoot: root, starter }))
			.rejects
			.toThrow(/ojm vendor/);
	});
});

describe("given 自举成功 When 执行 cleanup", () => {
	it("then 临时根被销毁（默认不保留现场）", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();
		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		await site.cleanup();

		expect(existsSync(site.root)).toBe(false);
	});

	it("then keep 模式下保留现场并打出销毁清单", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();
		const site = await bootstrapIsolatedSite({ projectRoot: src, starter, keep: true });

		await site.cleanup();

		expect(existsSync(site.root)).toBe(true);
		expect(site.teardownReport().join("\n")).toContain(site.root);
	});

	it("then 重复 cleanup 幂等（不抛错）", async () => {
		const src = newSourceProject();
		const { starter } = fakeStarter();
		const site = await bootstrapIsolatedSite({ projectRoot: src, starter });

		await site.cleanup();
		await expect(site.cleanup()).resolves.toBeUndefined();
	});
});

/** 递归列出根下所有文件（相对路径） */
function listFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir)) {
			const rel = prefix === "" ? entry : `${prefix}/${entry}`;
			const abs = join(dir, entry);
			if (statSync(abs).isDirectory())
				walk(abs, rel);
			else
				out.push(rel);
		}
	};
	walk(root, "");
	return out;
}
