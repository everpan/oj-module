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
import { DEFAULT_SITE_URL, unwrapEnvelope } from "./site";

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

/** 兑换结果：服务端下发身份（CLI 零推导——编码规则只在 templates 侧一份） */
export interface ExchangedIdentity {
	key_id: string
	product: string
	username: string
	display_name: string | null
}

export interface ExchangeOptions {
	/** 站点地址；flag > OJM_SITE_URL > DEFAULT_SITE_URL */
	siteUrl?: string
	/** 测试注入 */
	fetchFn?: typeof fetch
}

/**
 * 用一次性发布凭证换身份（匿名端点，不需要账号密码）。
 *
 * 只做「取回服务端算好的 key_id」——不做任何编码推导（规则漂移比多一次网络请求贵得多），
 * 但**必须**校验拿回的 key_id 形状：它马上会被拼进 `~/.ojm/keys/<key_id>`，
 * 一个被中间人改成 `../../x` 的响应就是任意路径写入。失败一律不落盘（调用方先兑换后生成）。
 */
export async function exchangePublishCredential(token: string, opts: ExchangeOptions = {}): Promise<ExchangedIdentity> {
	const t = token.trim();
	// 形状先挡：不是 64 位 hex 的输入连请求都不必发（与页面生成规则一致）
	if (!/^[0-9a-f]{64}$/i.test(t))
		throw new Error("[ojm] 发布凭证格式不对（应为 64 位十六进制）：请在站点「发布管理」页复制完整凭证");

	const base = (opts.siteUrl ?? process.env.OJM_SITE_URL ?? DEFAULT_SITE_URL).replace(/\/+$/, "");
	const fetchFn = opts.fetchFn ?? fetch;
	let res: Response;
	try {
		// 兑换是匿名端点（publish_credential 属共享表）：强绑定下裸租户头无 claim 可复核，
		// 会被判 403，故不注头——租户语义不参与这一跳。
		res = await fetchFn(`${base}/api/publish/credential/exchange`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: t }),
		});
	}
	catch (e) {
		throw new Error(`[ojm] 无法连接站点 ${base}：${e instanceof Error ? e.message : String(e)}——请确认站点地址（--site-url / OJM_SITE_URL）与网络`);
	}
	const data = await unwrapEnvelope(res) as Partial<ExchangedIdentity> | null;
	const keyId = String(data?.key_id ?? "");
	if (!isValidKeyId(keyId))
		throw new Error(`[ojm] 站点返回的 key_id 非法（C2-37）：「${keyId}」——已中止，未写入任何密钥（请核对站点版本）`);
	return {
		key_id: keyId,
		product: String(data?.product ?? ""),
		username: String(data?.username ?? ""),
		display_name: data?.display_name == null ? null : String(data.display_name),
	};
}
