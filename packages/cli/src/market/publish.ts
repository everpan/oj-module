/**
 * `ojm market publish`（T3）：把方案包落进 CDN 目录。
 *
 * 职责收窄到「落包 + 包级签名」（D-1）——**不碰索引**，索引由 `build-index` 扫描重建。
 * 由此多人可并发发布：每人只写 `<name>-<version>.tgz`（名字含名+版本，天然不撞），
 * 没有共享可变索引文件，也就没有 TOCTOU。
 *
 * 签名原语一行都不重写：11 复用 `ojm sign` 的 `signCommand`（规范串 `<name>@<version>:<sha256>`，
 * detached `.tgz.sig` 五字段，与 Form B archive.signature 同源同构）。
 */

import { createHash } from "node:crypto";
import fs, { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { buildBundle } from "../bundle";
import { createDeterministicTgz } from "../deterministic-tar";
import { signCommand } from "../sign";
import { resolveCdnLayout } from "./cdn-layout";
import { buildFixturePackage, parseFixtureSpec } from "./fixture";

export interface MarketPublishOptions {
	/** 站点工程根（含 api/config.yaml 与 cdn/）；缺省 process.cwd() */
	projectRoot?: string
	/** `--fixture <name>@<version>`；缺省 demo-solution@0.1.0 */
	fixture?: string
	/** `--real <方案工程根>`：走 ojm build --bundle 真构建（替代 fixture） */
	real?: string
	/** 发布方 key_id（C2-37） */
	id?: string
	/** 私钥 PEM 文件路径（与 privateKeyPem 二选一） */
	key?: string
	/** 内存私钥 PEM（一次性/隔离场景，不落盘） */
	privateKeyPem?: string
	/** 落包后离线自检（verifyCanonical 复核包级签名） */
	check?: boolean
}

export interface MarketPublishResult {
	name: string
	version: string
	tgzPath: string
	sigPath: string
	sha256: string
	size: number
	canonical: string
	keyId: string
	publicKeyHex: string
	fingerprint: string
}

export async function publishPackage(opts: MarketPublishOptions = {}): Promise<MarketPublishResult> {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const layout = resolveCdnLayout(projectRoot);
	if (!fs.existsSync(layout.dir)) {
		fs.mkdirSync(layout.dir, { recursive: true });
		console.log(`[ojm] 已建立 CDN 目录 ${path.relative(projectRoot, layout.dir)}`);
	}

	const staging = mkdtempSync(path.join(os.tmpdir(), "ojm-market-publish-"));
	try {
		const { name, version, tgzPath, sha256, preExisted } = opts.real !== undefined
			? await buildRealPackage(opts.real, staging, layout.dir)
			: await buildFixture({ fixture: opts.fixture, staging, cdnDir: layout.dir });

		// 原子性：tgz 已落盘而后续环节失败时，新包必须捡回来，不留半成品
		const rollbackPackage = () => {
			if (!preExisted)
				rmSync(tgzPath, { force: true });
		};

		let signed: ReturnType<typeof signCommand>;
		try {
			signed = signCommand(tgzPath, { id: opts.id, key: opts.key, privateKeyPem: opts.privateKeyPem, check: opts.check });
		}
		catch (error) {
			rollbackPackage();
			throw error;
		}
		if (signed.checkPassed === false) {
			rollbackPackage();
			throw new Error(`[ojm] 包级签名自检失败，已移除未签通的包：${tgzPath}`);
		}
		const size = fs.statSync(tgzPath).size;
		console.log(`[ojm] 包已落 CDN → ${path.relative(projectRoot, tgzPath)}（${size} 字节）`);
		console.log(`[ojm] 发布方 ${signed.keyId}；指纹 ${signed.fingerprint}`);
		console.log("[ojm] 索引未重建：多人场景请由维护者跑 ojm market build-index");

		return {
			name,
			version,
			tgzPath,
			sigPath: signed.sigPath,
			sha256,
			size,
			canonical: signed.canonical,
			keyId: signed.keyId,
			publicKeyHex: signed.publicKeyHex,
			fingerprint: signed.fingerprint,
		};
	}
	finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

/** fixture 路径：合成 → 确定性打包 → 与既有同名版本比对 */
async function buildFixture(args: { fixture?: string, staging: string, cdnDir: string }): Promise<{ name: string, version: string, tgzPath: string, sha256: string, preExisted: boolean }> {
	const spec = parseFixtureSpec(args.fixture);
	const pkg = buildFixturePackage({ stagingDir: args.staging, name: spec.name, version: spec.version });
	const tgzPath = path.join(args.cdnDir, `${spec.name}-${spec.version}.tgz`);
	const before = captureExisting(tgzPath);

	const sha256 = await createDeterministicTgz(pkg.dir, tgzPath);
	assertNoByteConflict(tgzPath, before, spec);
	return { name: spec.name, version: spec.version, tgzPath, sha256, preExisted: before.exists };
}

/** `--real`：走既有 ojm build --bundle，产物搬到 CDN 目录 */
async function buildRealPackage(solutionRoot: string, staging: string, cdnDir: string): Promise<{ name: string, version: string, tgzPath: string, sha256: string, preExisted: boolean }> {
	const built = await buildBundle(solutionRoot, { out: staging });
	const tgzPath = path.join(cdnDir, `${built.name}-${built.version}.tgz`);
	const before = captureExisting(tgzPath);

	fs.copyFileSync(built.tgz, tgzPath);
	assertNoByteConflict(tgzPath, before, { name: built.name, version: built.version });
	return { name: built.name, version: built.version, tgzPath, sha256: built.sha256, preExisted: before.exists };
}

/** 落包前先记下同名文件的指纹（可能不存在） */
function captureExisting(tgzPath: string): { exists: boolean, sha256: string } {
	if (!fs.existsSync(tgzPath))
		return { exists: false, sha256: "" };
	const bytes = new Uint8Array(fs.readFileSync(tgzPath));
	return { exists: true, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * 同 name@version 重发：字节一致即幂等；字节不一致是真正的冲突——
 * 同一个版本号出现两份不同的包会毁掉内容寻址前提，必须升 version 重发。
 */
function assertNoByteConflict(tgzPath: string, before: { exists: boolean, sha256: string }, spec: { name: string, version: string }): void {
	if (!before.exists)
		return;
	const bytes = new Uint8Array(fs.readFileSync(tgzPath));
	const after = createHash("sha256").update(bytes).digest("hex");
	if (after === before.sha256)
		return;
	throw new Error(
		`[ojm] 包冲突：${spec.name}@${spec.version} 已存在且字节不一致（${before.sha256.slice(0, 12)} vs ${after.slice(0, 12)}）。\n`
		+ "下一步：内容有变更请升 version 后重发（同一版本号只允许一份字节）；"
		+ "确需覆盖请先删除 CDN 目录里的旧 tgz。",
	);
}
