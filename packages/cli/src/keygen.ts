import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// ojm keygen（P2-4，作者工具链）：生成 Ed25519 签名密钥对并落盘。
// 落点缺省 `~/.ojm/keys/<id>/`（private.pem 0600 + public.hex）；`--out` 指到**工程树内**
// （cwd 之下）即警告并要求 `--yes` 显式确认——私钥入仓 = 泄露（P2-12 全仓 grep 零命中的
// 前提是私钥只活在 ~/.ojm/keys 或用户显式指定的受管位置）。
// 纯函数面（generateKeyPair/导出/签名）在 lifecycle/sign.ts 与 lifecycle/keygen.ts；
// 本文件只做命令编排（SRP）：解析 → 校验 key_id 命名空间（C2-37）→ 生成 → 落盘 → 打印。
import process from "node:process";
import { generateKeyPair } from "./lifecycle/keygen";
import { fingerprintOfPublicKey } from "./lifecycle/sign";

export interface KeygenOptions {
	/** 发布方 key_id（C2-37：<publisher>.<id> 全小写，禁裸通用名） */
	id?: string
	/** 输出目录（缺省 ~/.ojm/keys/<id>） */
	out?: string
	/** 工程树内落盘的显式确认（缺省拒绝） */
	yes?: boolean
	/** 测试注入；缺省 process.cwd() */
	cwd?: string
}

export const DEFAULT_KEY_ID = "local.dev";

/** C2-37 key_id 命名空间（与 isolate 侧 trust.ts isValidKeyId 同规则；禁裸通用名单段） */
export function isValidKeyId(keyId: string): boolean {
	return /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(keyId);
}

export interface KeygenResult {
	keyId: string
	publicKeyHex: string
	fingerprint: string
	dir: string
	privateKeyPath: string
	publicKeyPath: string
}

/**
 * keygen 命令体。返回产物路径（测试/调用方断言用）；stdout 打印人话摘要。
 * 工程树内落盘无 --yes → 抛错（私钥不得意外入仓——仓内出现即 P2-12 grep 红灯）。
 */
export function keygenCommand(opts: KeygenOptions = {}): KeygenResult {
	const keyId = opts.id ?? DEFAULT_KEY_ID;
	if (!isValidKeyId(keyId))
		throw new Error(`[ojm] key_id 命名空间非法（C2-37：<publisher>.<id> 全小写、禁裸通用名单段）：「${keyId}」——示例：acme.market`);
	const cwd = opts.cwd ?? process.cwd();
	const home = path.join(os.homedir(), ".ojm", "keys", keyId);
	const dir = opts.out === undefined ? home : path.resolve(cwd, opts.out);
	if (path.resolve(cwd) !== path.parse(cwd).root && dir.startsWith(`${path.resolve(cwd)}/`) && opts.yes !== true) {
		throw new Error(`[ojm] 输出目录在工程树内（${path.relative(cwd, dir) || "."}）——私钥入仓即泄露。请使用缺省位置 ~/.ojm/keys/<id>，或确认已知风险后加 --yes 重试（建议把该目录加进 .gitignore）`);
	}
	const kp = generateKeyPair();
	const fingerprint = fingerprintOfPublicKey(kp.publicKeyHex);
	const privateKeyPath = path.join(dir, "private.pem");
	const publicKeyPath = path.join(dir, "public.hex");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(privateKeyPath, kp.privateKeyPem, { mode: 0o600 });
	fs.writeFileSync(publicKeyPath, `${kp.publicKeyHex}\n`);
	console.log(`[ojm] 已生成 Ed25519 密钥对：${dir}`);
	console.log(`[ojm] key_id：${keyId}（发布方标识，签名与信任库按它绑定；轮换 = 新 key_id，禁覆写）`);
	console.log(`[ojm] public_key：${kp.publicKeyHex}`);
	console.log(`[ojm] 指纹（sha256(publicKey)，公布给宿主核对）：${fingerprint}`);
	console.log(`[ojm] 私钥文件：${privateKeyPath}（0600；永不入仓、永不入日志——P2-5 redact 钉面）`);
	console.log(`[ojm] 下一步：ojm sign <pkg>.tgz --id ${keyId}（或 --key ${privateKeyPath} --id ${keyId}）`);
	return { keyId, publicKeyHex: kp.publicKeyHex, fingerprint, dir, privateKeyPath, publicKeyPath };
}
