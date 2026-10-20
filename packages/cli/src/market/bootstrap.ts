/**
 * 隔离站点自举（T8）：`ojm market trial` / `walkthrough` 的地基。
 *
 * 目标：给你一个「别人家的站点」来试装——不碰你的工程、DB、信任库、端口。
 * 隔离六项各有落点：
 * - **端口**：临时根 config 写入空闲端口（startOj 从 config 读端口，故派生 config 是唯一真相）；
 * - **DB**：oj 的 sqlite 按 config 所在目录解析，临时根内自然隔离（dbPath 暴露供断言）；
 * - **密钥**：发布方 Ed25519 由公开 seed 经 SHA-256 派生（照 fixtures/sig 夹具手法），
 *   私钥只在内存，临时根内无 PEM（站点自己的开发证书走 mintDevCert，属站点身份）；
 * - **凭据**：隔离库是全新 seed，admin 口令即种子默认值，与真站点凭据零交集；
 * - **信任库**：`.solutions/trusted-keys.yaml` 只在安装器写入时生成，全新根内不存在；
 * - **CDN 目录**：临时根内 cdn/，由本模块自建（publish + build-index 直落）。
 *
 * 提库来源：`scripts/verify-solution-smoke/bootstrap-host.mjs`（同手法，脚本形态）；
 * 本文件是它的 cli 内嵌版（计划 §9.1：phase1 从这里提库而非重写）。
 */

import type { OjProcess } from "../oj";
import { Buffer } from "node:buffer";
import { createHash, createPrivateKey, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { fileURLToPath } from "node:url";
import { exportRawPublicKeyHex, fingerprintOfPublicKey } from "../lifecycle/sign";
import { startOj } from "../oj";
import { mintDevCert } from "../oj-cert";
import { resolveOjBin } from "../vendor";
import { buildIndex } from "./build-index";
import { publishPackage } from "./publish";

/** 种子管理员（隔离库全新 seed；与 templates seed.sql 一致） */
const SEED_ADMIN_USER = "admin";
const SEED_ADMIN_PASS = "123456";

/** Ed25519 PKCS#8 DER 前缀（RFC 8410 固定头；与 gen-signed-fixtures.mjs 同一手法） */
const ED25519_PKCS8_PREFIX = "302e020100300506032b657004220420";

export interface IsolatedPublisher {
	keyId: string
	privateKeyPem: string
	publicKeyHex: string
	fingerprint: string
}

export interface IsolatedSite {
	/** 临时根（含 api/ bin/ cdn/） */
	root: string
	port: number
	baseUrl: string
	apiBase: string
	cdnDir: string
	cdnBaseUrl: string
	/** sqlite 库路径（config 目录相对解析；断言隔离用） */
	dbPath: string
	/** 一次性发布方身份（私钥只在内存） */
	publisher: IsolatedPublisher
	/** 隔离库的种子管理员 */
	admin: { user: string, pass: string }
	/** 销毁隔离根与 oj 进程；幂等 */
	cleanup: () => Promise<void>
	/** 销毁清单（--keep 时给人看这里到底有什么） */
	teardownReport: () => string[]
}

export interface BootstrapOptions {
	/** 源工程（提供 bin/oj 与 cli 内置模板）；缺省 process.cwd() */
	projectRoot?: string
	/** 落进隔离 CDN 的 fixture；缺省 demo-solution@0.1.0 */
	fixture?: string
	/** 保留现场（cleanup 不删根，只打清单） */
	keep?: boolean
	/** 测试注入；缺省真 startOj */
	starter?: (configPath: string, base: string, apiSrc: string) => OjProcess
	/** 日志旁路（测试收集用） */
	onLog?: (line: string) => void
}

export async function bootstrapIsolatedSite(opts: BootstrapOptions = {}): Promise<IsolatedSite> {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const log = (line: string) => (opts.onLog ?? ((l: string) => console.log(l)))(line);

	const ojBin = resolveOjBin(projectRoot);
	if (!existsSync(ojBin)) {
		throw new Error(
			`[ojm] 源工程未安装 oj 二进制：${ojBin}\n`
			+ "下一步：在源工程目录跑一次 `ojm vendor`（经 npm 包 @oj-bin/oj 下载），再重试。",
		);
	}

	const root = mkdtempSync(path.join(tmpdir(), "ojm-trial-"));
	const apiDir = path.join(root, "api");
	const configPath = path.join(apiDir, "config.yaml");
	const cdnDir = path.join(root, "cdn");
	const dbPath = path.join(apiDir, "db.sqlite");

	// 1) api 树 + config（模板由 cli 包内置，init 同源；与 cli→templates 依赖红线不冲突——那是运行期文件而非 import）
	const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
	const templateApi = path.join(cliRoot, "templates", "api");
	if (!existsSync(path.join(templateApi, "config.yaml"))) {
		throw new Error(`[ojm] cli 内置模板缺失：${templateApi}（@oj-module/cli 安装不完整？）`);
	}
	cpSync(path.join(templateApi, "src"), path.join(apiDir, "src"), { recursive: true });
	writeFileSync(configPath, readFileSync(path.join(templateApi, "config.yaml"), "utf-8"), "utf-8");

	// 2) oj 二进制与插件（startOj 按 <root>/bin/oj 解析；plugins 让 auth 插件可用）
	mkdirSync(path.join(root, "bin"), { recursive: true });
	cpSync(ojBin, path.join(root, "bin", "oj"), { recursive: true });
	const versionMarker = path.join(projectRoot, "bin", ".oj-version");
	if (existsSync(versionMarker)) {
		cpSync(versionMarker, path.join(root, "bin", ".oj-version"));
	}
	const pluginsDir = path.join(projectRoot, "bin", "plugins");
	if (existsSync(pluginsDir)) {
		cpSync(pluginsDir, path.join(root, "bin", "plugins"), { recursive: true });
	}

	// 3) 派生 config：空闲端口 / 随机 jwt / CDN 挂载指绝对路径 / fs 段
	const port = await freePort();
	let cfg = readFileSync(configPath, "utf-8");
	cfg = cfg.replace("port: 9778", `port: ${port}`);
	if (!cfg.includes(`port: ${port}`)) {
		throw new Error(`[ojm] 模板 config 未含 端口: 9778 字面（模板结构变了？）：${configPath}`);
	}
	cfg = cfg.replace("__JWT_SECRET__", randomBytes(32).toString("hex"));
	cfg = cfg.replace("web: ../cdn", `web: ${cdnDir}`);
	// fs 段：模板自 0.2.13 起已自带（安装器落盘面）；旧模板没有时才补，避免重复键
	if (!/^fs:/m.test(cfg))
		cfg = `${cfg.trimEnd()}\nfs:\n  root: .\n  readonly: false\n`;
	writeFileSync(configPath, cfg, "utf-8");

	// 4) 站点开发证书（oj serve 无绕过开关；mintDevCert 落 api/config 三件套）
	await mintDevCert(path.join(apiDir, "config"));

	// 5) 一次性发布方身份：seed 派生，私钥只在内存
	const keyId = "trial.publisher";
	const publisher = derivePublisherKey(randomBytes(16).toString("hex"));

	// 6) 隔离 CDN：落 fixture 包 + 重建索引（publish/buildIndex 直落临时根）
	mkdirSync(cdnDir, { recursive: true });
	await publishPackage({ projectRoot: root, fixture: opts.fixture, id: keyId, privateKeyPem: publisher.privateKeyPem });
	await buildIndex({ projectRoot: root, id: keyId, privateKeyPem: publisher.privateKeyPem });

	// 7) 起 oj（starter 注入供测试）；ready 失败即整体作废，不留孤儿
	const starter = opts.starter ?? ((cfgPath: string, base: string, apiSrc: string) => startOj(cfgPath, base, apiSrc));
	let oj: OjProcess;
	try {
		oj = starter(configPath, "/api", path.join(apiDir, "src"));
		await oj.ready;
	}
	catch (error) {
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
	log(`[ojm] 隔离站点就绪：http://127.0.0.1:${port}（根 ${root}）`);

	// 8) cleanup：停进程 → 按 keep 决定删不删根 → 摘信号；全程幂等
	let done = false;
	let cleanup: () => Promise<void>;
	const onSignal = () => {
		void cleanup();
	};
	cleanup = async () => {
		if (done) {
			return;
		}
		done = true;
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		await oj.stop().catch(() => {});
		if (opts.keep === true) {
			log(`[ojm] --keep：隔离根保留在 ${root}（内容见销毁清单）`);
			return;
		}
		rmSync(root, { recursive: true, force: true });
		log("[ojm] 隔离站点已销毁");
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	return {
		root,
		port,
		baseUrl: `http://127.0.0.1:${port}`,
		apiBase: "/api",
		cdnDir,
		cdnBaseUrl: `http://127.0.0.1:${port}/cdn`,
		dbPath,
		publisher: { keyId, privateKeyPem: publisher.privateKeyPem, publicKeyHex: publisher.publicKeyHex, fingerprint: fingerprintOfPublicKey(publisher.publicKeyHex) },
		admin: { user: SEED_ADMIN_USER, pass: SEED_ADMIN_PASS },
		cleanup,
		teardownReport: () => teardownReport(root, port),
	};
}

/**
 * seed 派生一次性 Ed25519 身份（照 fixtures/sig 夹具手法：公开 seed → SHA-256 → PKCS#8 DER）。
 * 私钥只在内存；label 每次随机，故每次 trial 都是不同身份（不会与任何既有信任库条目撞）。
 */
function derivePublisherKey(label: string): { privateKeyPem: string, publicKeyHex: string } {
	const seed = createHash("sha256").update(`ojm-trial-publisher:${label}`).digest();
	const der = Buffer.concat([Buffer.from(ED25519_PKCS8_PREFIX, "hex"), seed]);
	const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
	const privateKeyPem = key.export({ type: "pkcs8", format: "pem" }).toString();
	return { privateKeyPem, publicKeyHex: exportRawPublicKeyHex(privateKeyPem) };
}
/** 空闲端口：listen(0) 取端口后立刻归还（本地一次性使用，竞态可接受） */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

/** 销毁清单：--keep 时告诉人这里到底有什么、怎么手动清 */
function teardownReport(root: string, port: number): string[] {
	const lines = [
		`隔离根：${root}`,
		"  api/    站点树（src + config.yaml + config/ 证书 + db.sqlite）",
		"  bin/    oj 二进制与插件（拷贝自源工程）",
		"  cdn/    隔离 CDN（fixture 包 + 两份索引 + 签名）",
		`监听端口：127.0.0.1:${port}（进程已停）`,
		`手动清理：rm -rf ${root}`,
	];
	return lines;
}
