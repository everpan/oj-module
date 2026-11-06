/**
 * 市场发布包构建（A6 重构）：buildSignedPackage = 合成/构建 + 确定性 tgz + 包级 detached 签名，
 * 产出**内存字节**（不落 CDN）——本地落盘（publishPackage）与远端推送（remote-push.ts）
 * 共用同一构建面（DRY：签名/打包一行不重复）。
 *
 * 本地落盘模式（publishPackage）仍保留：walkthrough/trial 的隔离站点需要 cdn/ 字节 +
 * DB 目录行双写（内部通道）；CLI 命令层 `ojm market publish` 缺省走远端推送。
 *
 * 签名原语一行都不重写：11 复用 `ojm sign` 的 `signCommand`（规范串 `<registry_id>:<name>@<version>:<sha256>`，
 * detached `.tgz.sig` 六字段，与 Form B archive.signature 同源同构）。
 */

import { createHash } from "node:crypto";
import fs, { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { buildBundle } from "../bundle";
import { createDeterministicTgz } from "../deterministic-tar";
import { isValidKeyId } from "../keygen";
import { readPrivateKeyPem } from "../lifecycle/keygen";
import { assertDefaultModulesUntouched } from "../scaffold-guard";
import { signCommand } from "../sign";
import { resolveCdnLayout } from "./cdn-layout";
import { buildFixturePackage, parseFixtureSpec } from "./fixture";

export interface MarketPublishOptions {
	/** 站点工程根（含 api/config.yaml 与 cdn/）；缺省 process.cwd() */
	projectRoot?: string
	/** `--fixture <name@version>`；缺省 demo-solution@0.1.0 */
	fixture?: string
	/** `--real <方案工程根>`：走 ojm build --bundle 真构建（替代 fixture） */
	real?: string
	/** 发布方 key_id（C2-37） */
	id?: string
	/** 私钥 PEM 文件路径（与 privateKeyPem 二选一） */
	key?: string
	/** 内存私钥 PEM（一次性/隔离场景，不落盘） */
	privateKeyPem?: string
	/** 签发方 registry 身份（REG-CS3 v2 防跨仓库重放；透传 signCommand --registry-id） */
	registryId?: string
	/** 落包后离线自检（verifyCanonical 复核包级签名） */
	check?: boolean
}

/** 已签名发布包（内存字节态；落盘/推送由调用方决定） */
export interface SignedPackage {
	name: string
	version: string
	tgzBytes: Uint8Array
	/** tgz 字节 sha256（内容寻址；上传 canonical 与 Form B archive.sha256 同源） */
	sha256: string
	size: number
	/** 包级 detached 签名（六字段，与 .tgz.sig 旁车文件内容一致） */
	sig: Record<string, unknown>
	sigBytes: Uint8Array
	keyId: string
	publicKeyHex: string
	fingerprint: string
	/** 包级 canonical（`<registry_id>:<name>@<version>:<sha256>`） */
	canonical: string
	/** 本次签名用私钥（远端推送构造上传 canonical 要用；内存态不落盘纪律不变） */
	privateKeyPem: string
}

/**
 * 解析签名身份（内存 PEM > --key 显式文件 > ~/.ojm/keys/<id>/private.pem）。
 * 与 sign.ts signCommand 同源规则；独立抽出是因为推送路径不经 signCommand 也要签
 * 上传 canonical（`cdn-upload:<站点 registry>:<file>:<sha256>`）——同一身份两把签名。
 */
export function resolveSigningIdentity(opts: { id?: string, key?: string, privateKeyPem?: string, cwd?: string }): { keyId: string, privateKeyPem: string } {
	const cwd = opts.cwd ?? process.cwd();
	if (opts.privateKeyPem !== undefined && opts.privateKeyPem !== "") {
		const keyId = opts.id ?? "";
		if (keyId === "")
			throw new Error("[ojm] 使用内存私钥时须同时给 --id <publisher.id>（.sig 的发布方标识；C2-37 命名空间）");
		if (!isValidKeyId(keyId))
			throw new Error(`[ojm] key_id 命名空间非法（C2-37）：「${keyId}」`);
		return { keyId, privateKeyPem: opts.privateKeyPem };
	}
	let keyFile: string;
	let keyId: string;
	if (opts.key !== undefined) {
		keyFile = path.resolve(cwd, opts.key);
		const m = /[/\\]\.ojm[/\\]keys[/\\]([^/\\]+)[/\\]private\.pem$/.exec(keyFile);
		keyId = opts.id ?? m?.[1] ?? "";
		if (keyId === "")
			throw new Error("[ojm] --key 指向自定义位置时须同时给 --id <publisher.id>（.sig 的发布方标识；C2-37 命名空间）");
	}
	else {
		keyId = opts.id ?? "";
		if (keyId === "")
			throw new Error("[ojm] 缺少签名身份：--id <publisher.id>（从 ~/.ojm/keys/<id>/ 取私钥）或 --key <pem> --id <publisher.id>。先生成：ojm keygen --id <publisher.id>");
		keyFile = path.join(os.homedir(), ".ojm", "keys", keyId, "private.pem");
	}
	if (!isValidKeyId(keyId))
		throw new Error(`[ojm] key_id 命名空间非法（C2-37）：「${keyId}」`);
	if (!fs.existsSync(keyFile))
		throw new Error(`[ojm] 私钥文件不存在：${keyFile}（用 ojm keygen --id ${keyId} 生成，或 --key 指定）`);
	return { keyId, privateKeyPem: readPrivateKeyPem(keyFile) };
}

/** 构建 + 包级签名（staging 内完成，staging 自清理；产出内存字节） */
export async function buildSignedPackage(opts: MarketPublishOptions = {}): Promise<SignedPackage> {
	const staging = mkdtempSync(path.join(os.tmpdir(), "ojm-market-build-"));
	try {
		const identity = resolveSigningIdentity({ id: opts.id, key: opts.key, privateKeyPem: opts.privateKeyPem, cwd: opts.projectRoot });
		const { name, version, tgzPath, sha256 } = opts.real !== undefined
			? await buildRealPackage(opts.real, staging)
			: await buildFixture({ fixture: opts.fixture, staging });

		const signed = signCommand(tgzPath, { id: identity.keyId, privateKeyPem: identity.privateKeyPem, check: opts.check, registryId: opts.registryId });
		if (signed.checkPassed === false)
			throw new Error("[ojm] 包级签名自检失败，已丢弃未签通的包");
		const tgzBytes = new Uint8Array(fs.readFileSync(tgzPath));
		const sigBytes = new Uint8Array(fs.readFileSync(signed.sigPath));
		const sig = JSON.parse(new TextDecoder().decode(sigBytes)) as Record<string, unknown>;
		return {
			name,
			version,
			tgzBytes,
			sha256,
			size: tgzBytes.byteLength,
			sig,
			sigBytes,
			keyId: signed.keyId,
			publicKeyHex: signed.publicKeyHex,
			fingerprint: signed.fingerprint,
			canonical: signed.canonical,
			privateKeyPem: identity.privateKeyPem,
		};
	}
	finally {
		rmSync(staging, { recursive: true, force: true });
	}
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

/**
 * 本地落盘模式：把已签名包写进 cdn/（内部通道——walkthrough/trial 隔离站点用；
 * CLI 命令层 publish 缺省走远端推送，本地-only 发布模式已退役）。
 * 多人可并发：每人只写 `<name>-<version>.tgz`（名字含名+版本，天然不撞）。
 */
export async function publishPackage(opts: MarketPublishOptions = {}): Promise<MarketPublishResult> {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const layout = resolveCdnLayout(projectRoot);
	if (!fs.existsSync(layout.dir)) {
		fs.mkdirSync(layout.dir, { recursive: true });
		console.log(`[ojm] 已建立 CDN 目录 ${path.relative(projectRoot, layout.dir)}`);
	}
	const built = await buildSignedPackage(opts);

	const tgzPath = path.join(layout.dir, `${built.name}-${built.version}.tgz`);
	const sigPath = `${tgzPath}.sig`;
	const before = captureExisting(tgzPath);
	// 同 name@version 重发：字节一致即幂等；字节不一致是真正的冲突——同一版本号出现两份
	// 不同的包会毁掉内容寻址前提，必须升 version 重发
	if (before.exists && before.sha256 !== built.sha256) {
		throw new Error(
			`[ojm] 包冲突：${built.name}@${built.version} 已存在且字节不一致（${before.sha256.slice(0, 12)} vs ${built.sha256.slice(0, 12)}）。\n`
			+ "下一步：内容有变更请升 version 后重发（同一版本号只允许一份字节）；"
			+ "确需覆盖请先删除 CDN 目录里的旧 tgz。",
		);
	}
	fs.writeFileSync(tgzPath, built.tgzBytes);
	fs.writeFileSync(sigPath, built.sigBytes);
	console.log(`[ojm] 包已落 CDN → ${path.relative(projectRoot, tgzPath)}（${built.size} 字节）`);
	console.log(`[ojm] 发布方 ${built.keyId}；指纹 ${built.fingerprint}`);

	return {
		name: built.name,
		version: built.version,
		tgzPath,
		sigPath,
		sha256: built.sha256,
		size: built.size,
		canonical: built.canonical,
		keyId: built.keyId,
		publicKeyHex: built.publicKeyHex,
		fingerprint: built.fingerprint,
	};
}

/** fixture 路径：合成 → 确定性打包（staging 内） */
async function buildFixture(args: { fixture?: string, staging: string }): Promise<{ name: string, version: string, tgzPath: string, sha256: string }> {
	const spec = parseFixtureSpec(args.fixture);
	const pkg = buildFixturePackage({ stagingDir: args.staging, name: spec.name, version: spec.version });
	const tgzPath = path.join(args.staging, `${spec.name}-${spec.version}.tgz`);
	const sha256 = await createDeterministicTgz(pkg.dir, tgzPath);
	return { name: spec.name, version: spec.version, tgzPath, sha256 };
}

/** `--real`：走既有 ojm build --bundle，产物归拢 staging（一次只发一份：多方案工程请显式指定） */
async function buildRealPackage(solutionRoot: string, staging: string): Promise<{ name: string, version: string, tgzPath: string, sha256: string }> {
	// 与 ojm build 同一道完整性门禁：发布链路同样不许携带被改过的默认模块
	assertDefaultModulesUntouched(solutionRoot);
	const builtList = await buildBundle(solutionRoot, { out: staging });
	if (builtList.length !== 1) {
		throw new Error(
			`[ojm] market publish --real 一次只发布一份方案，但该工程打出了 ${builtList.length} 份用户方案。`
			+ "请改用显式链路：在方案工程里 `ojm build --bundle <name>`，再 `ojm sign dist/<name>-<version>.tgz --id <publisher>.<key>`。",
		);
	}
	const built = builtList[0]!;
	const tgzPath = path.join(staging, `${built.name}-${built.version}.tgz`);
	fs.copyFileSync(built.tgz, tgzPath);
	return { name: built.name, version: built.version, tgzPath, sha256: built.sha256 };
}

/** 落包前记下同名文件的指纹（可能不存在） */
function captureExisting(tgzPath: string): { exists: boolean, sha256: string } {
	if (!fs.existsSync(tgzPath))
		return { exists: false, sha256: "" };
	const bytes = new Uint8Array(fs.readFileSync(tgzPath));
	return { exists: true, sha256: createHash("sha256").update(bytes).digest("hex") };
}
