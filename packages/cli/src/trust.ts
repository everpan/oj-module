// ojm trust（P2-2，C2-38/39，G3 双轨第一轨 / G5）：宿主信任库运维瘦客户端。
// 子命令：
//   ojm trust ls                         —— 列表（GET  /api/_platform/market/trust）
//   ojm trust add <key_id> <pubkey_hex>  —— 新增信任（POST /api/_platform/market/trust/key）
//   ojm trust revoke <key_id>            —— 吊销（DELETE /api/_platform/market/trust/key?key_id=）
// 本地零状态，纯转发（uninstall.ts 同款）；operator 由站点侧按登录用户反查，CLI 不传。
// TOFU 确认（trust confirm --task）属 P2-3（同文件追加，文件封锁面 P2-2/3 共有）。
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import process from "node:process";
import { callApi, login, resolveSite } from "./site";

export interface TrustOptions {
	url?: string
	user?: string
	pass?: string
	/** 测试注入；缺省 globalThis.fetch */
	fetchFn?: typeof fetch
}

export interface TrustKeyRow {
	key_id: string
	public_key: string
	added_at: number
}

/** 指纹分组展示（TOFU 人确认的可读形态：每 8 hex 一组，契约 §2.11） */
export function formatFingerprint(fp: string): string {
	return (fp.match(/.{1,8}/g) ?? []).join(" ");
}

/** 指纹 = sha256Hex(publicKey)（契约 §2.11，与 isolate 侧同口径；CLI 在 Node 侧本地计算） */
function fingerprintOf(publicKeyHex: string): string {
	return createHash("sha256").update(Buffer.from(publicKeyHex, "hex")).digest("hex");
}

function printRows(rows: TrustKeyRow[]): void {
	if (rows.length === 0) {
		console.log("[ojm] 信任库为空（未信任任何发布方 key_id）");
		return;
	}
	for (const r of rows)
		console.log(`[ojm] ${r.key_id}  added_at=${new Date(r.added_at).toISOString()}  fp=${formatFingerprint(fingerprintOf(r.public_key))}`);
}

/**
 * 子命令分派：ls / add <key_id> <pubkey_hex> / revoke <key_id>。
 * 站点侧拒（key_id 命名空间/公钥形态 400、撞绑定 409）打印人话 message 并 exitCode 1。
 */
export async function trustCommand(sub: string, args: string[], opts: TrustOptions = {}): Promise<void> {
	// 先校验后登录（uninstall.ts 同纪律：用法错误不发网络）
	switch (sub) {
		case "ls":
			break;
		case "add": {
			const [keyId, publicKey] = args;
			if (!keyId || !publicKey)
				throw new Error("[ojm] 用法：ojm trust add <key_id> <pubkey_hex>——key_id 形如 <publisher>.<id>（全小写），pubkey_hex 为 64 hex Ed25519 公钥");
			break;
		}
		case "revoke": {
			const [keyId] = args;
			if (!keyId)
				throw new Error("[ojm] 用法：ojm trust revoke <key_id>——吊销该发布方：只阻断新装/升级，不动已装方案");
			break;
		}
		default:
			throw new Error(`[ojm] 未知 trust 子命令：${sub || "(空)"}——可用：ls / add <key_id> <pubkey_hex> / revoke <key_id>`);
	}
	const fetchFn = opts.fetchFn ?? globalThis.fetch;
	const { base, user, pass } = resolveSite(opts);
	const token = await login(fetchFn, base, user, pass);
	switch (sub) {
		case "ls": {
			const result = await callApi<{ keys: TrustKeyRow[], note: string | null }>(fetchFn, base, token, "GET", "/api/_platform/market/trust");
			if (result.note)
				console.log(`[ojm] 注意：${result.note}`);
			printRows(result.keys ?? []);
			break;
		}
		case "add": {
			const [keyId, publicKey] = args;
			const result = await callApi<{ result: "added" | "exists_same" }>(fetchFn, base, token, "POST", "/api/_platform/market/trust/key", { key_id: keyId, public_key: publicKey });
			console.log(result.result === "added" ? `[ojm] 已信任发布方：${keyId}` : `[ojm] 该 key_id 已在信任库且公钥一致（无需重复添加）：${keyId}`);
			break;
		}
		case "revoke": {
			const [keyId] = args;
			const result = await callApi<{ revoked: boolean }>(fetchFn, base, token, "DELETE", `/api/_platform/market/trust/key?key_id=${encodeURIComponent(keyId)}`);
			console.log(result.revoked ? `[ojm] 已吊销：${keyId}（已装方案继续运行，新装/升级将被拒）` : `[ojm] 信任库中无此 key_id：${keyId}`);
			if (!result.revoked)
				process.exitCode = 1;
			break;
		}
	}
}
