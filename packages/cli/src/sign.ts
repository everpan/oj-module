import { createHash } from "node:crypto";
// ojm sign（P2-4，作者工具链）：对方案包 tgz 签 detached 侧车 `.sig`（契约 v1.3 §2.11 / C2-35）。
// 签名原文 = 规范串 `<name>@<version>:<sha256>`（C2-34）；.sig 五字段
// {alg,key_id,public_key,value,canon}，与 Form B archive.signature 同源同构。
// `--check`：写完离线自检（作者不必靠宿主装失败发现签错——先红后绿的第一道防线）。
// 只出签名不碰包：`ojm build --bundle` 保持只出包不签名（私钥红线见 bundle.ts 入包自检）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isValidKeyId } from "./keygen";
import { readPrivateKeyPem } from "./lifecycle/keygen";
import { CANON, canonicalString, exportRawPublicKeyHex, fingerprintOfPublicKey, SIG_ALG, signCanonical, verifyCanonical } from "./lifecycle/sign";

export interface SignOptions {
	/** 发布方 key_id（C2-37；.sig 的发布方标识） */
	id?: string
	/** 私钥 PEM 文件（缺省 ~/.ojm/keys/<id>/private.pem） */
	key?: string
	/**
	 * 内存私钥 PEM（一次性/隔离场景专用，与 --key 二选一）。
	 * 用途：`ojm market trial` 的一次性 keypair 不落盘，经此直接传进来；
	 * 给了它就跳过文件存在性检查，也永远不读真 ~/.ojm/keys（计划 §3.3.1）。
	 */
	privateKeyPem?: string
	/**
	 * 签发方 registry 身份（REG-CS3 v2 防跨仓库重放）：`.sig.registry_id` 与规范串首段。
	 * 缺省报错——旧版 ojm 未带此字段，新规范串要求显式声明归属 registry，否则无法区分
	 * 「A 签的包被 B 的 CDN 安装」这类重放。
	 */
	registryId?: string
	/** 写完离线自检（verifyCanonical 复核） */
	check?: boolean
	/** 测试注入；缺省 process.cwd() */
	cwd?: string
}

export interface SignResult {
	sigPath: string
	keyId: string
	publicKeyHex: string
	fingerprint: string
	sha256: string
	canonical: string
	/** --check 的自检结果（未传 --check = undefined） */
	checkPassed?: boolean
}

/** 从 --key 路径推导 key_id（~/.ojm/keys/<id>/private.pem 形态）；推导不出返回 null */
function keyIdFromKeyPath(keyFile: string): string | null {
	const m = /^\.ojm[\\/]keys[\\/]([^\\/]+)[\\/]private\.pem$/.exec(keyFile) ?? /[/\\]\.ojm[/\\]keys[/\\]([^/\\]+)[/\\]private\.pem$/.exec(keyFile);
	return m?.[1] ?? null;
}

export function signCommand(tgz: string, opts: SignOptions = {}): SignResult {
	if (!tgz.endsWith(".tgz"))
		throw new Error(`[ojm] 签名目标必须是 .tgz 方案包：${tgz}`);
	if (!fs.existsSync(tgz))
		throw new Error(`[ojm] 方案包不存在：${tgz}`);
	const cwd = opts.cwd ?? process.cwd();
	// key 解析：内存 PEM（不落盘）> --key 显式文件 > ~/.ojm/keys/<id>/private.pem（--id 必填）
	let keyFile = "";
	let keyId: string;
	let memoryPem: string | undefined;
	if (opts.privateKeyPem !== undefined && opts.privateKeyPem !== "") {
		memoryPem = opts.privateKeyPem;
		keyId = opts.id ?? "";
		if (keyId === "")
			throw new Error("[ojm] 使用内存私钥时须同时给 --id <publisher.id>（.sig 的发布方标识；C2-37 命名空间）");
	}
	else if (opts.key !== undefined) {
		keyFile = path.resolve(cwd, opts.key);
		keyId = opts.id ?? keyIdFromKeyPath(path.relative(os.homedir(), keyFile)) ?? "";
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
	// REG-CS3 v2：规范串首段 = 签发方 registry 身份，缺省即报错（不兼容旧 ojm 未带此字段的 .sig）
	const registryId = opts.registryId ?? "";
	if (registryId === "")
		throw new Error("[ojm] 缺少签发方身份：--registry-id <registry.id>（REG-CS3 v2 规范串首段，防跨仓库重放）。例如 ojm sign --registry-id oj-registry");
	if (memoryPem === undefined) {
		if (!fs.existsSync(keyFile!))
			throw new Error(`[ojm] 私钥文件不存在：${keyFile}（用 ojm keygen --id ${keyId} 生成，或 --key 指定）`);
	}

	const bytes = new Uint8Array(fs.readFileSync(tgz));
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const canonical = canonicalString(registryId, deriveName(tgz), deriveVersion(tgz), sha256);
	const privateKeyPem = memoryPem ?? readPrivateKeyPem(keyFile!);
	const value = signCanonical(privateKeyPem, canonical);
	const publicKeyHex = exportRawPublicKeyHex(privateKeyPem);
	const sig = { alg: SIG_ALG, key_id: keyId, public_key: publicKeyHex, value, canon: CANON, registry_id: registryId };
	const sigPath = `${tgz}.sig`;
	fs.writeFileSync(sigPath, `${JSON.stringify(sig, null, 2)}\n`);
	console.log(`[ojm] 签名完成 → ${sigPath}`);
	console.log(`[ojm] 发布方 ${keyId}；规范串 ${canonical}`);
	let checkPassed: boolean | undefined;
	if (opts.check === true) {
		checkPassed = verifyCanonical(publicKeyHex, canonical, value);
		console.log(checkPassed
			? `[ojm] 自检通过：签名与包体匹配（指纹 ${fingerprintOfPublicKey(publicKeyHex)}）`
			: "[ojm] 自检失败：签名与包体不匹配——请检查私钥与包体后重签");
		if (!checkPassed)
			process.exitCode = 1;
	}
	return { sigPath, keyId, publicKeyHex, fingerprint: fingerprintOfPublicKey(publicKeyHex), sha256, canonical, checkPassed };
}

/** 身份从文件名推导（<name>-<version>.tgz；与 ojm install parseTarget 同规则，Finding C 正则） */
function deriveIdentity(stem: string): { name: string, version: string } {
	const m = /^(.+)-(\d[\w.]+(?:-[\w.]+)?)$/.exec(stem);
	if (m === null)
		throw new Error(`[ojm] 无法从文件名推导 <name>-<version>：${stem}.tgz——请按 ojm build --bundle 产物命名（或重命名后再签）`);
	return { name: m[1]!, version: m[2]! };
}

function deriveName(tgz: string): string {
	return deriveIdentity(path.basename(tgz).replace(/\.tgz$/, "")).name;
}

function deriveVersion(tgz: string): string {
	return deriveIdentity(path.basename(tgz).replace(/\.tgz$/, "")).version;
}
