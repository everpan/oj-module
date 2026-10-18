import { auditOp } from "../_shared/service/audit";
// 宿主信任库（P2-2，契约 v1.3 §2.11 / C2-38/39，G3 双轨第一轨 / G5）。
// 存储：.solutions/trusted-keys.yaml（key_id → {public_key, added_at}）——YAML 受限子集
// （两层 map + 标量，同 state.ts 口径：只读回本模块写出的内容，不引 yaml 依赖，严格解析）。
// 原子写（D13）+ .bak 前一版；主文件损坏自动回落 .bak 并留 note（下次写入自愈），
// 两者皆坏 = 可读报错 fail-closed（含路径与修法指引，不半截数据）。
// 首次绑定不可改（C2-38）：同 key_id 异公钥 = trust_bound_mismatch（409）；轮换 = 新增 key_id。
// 吊销（C2-39/G5）= remove：只阻断新装/升级（P2-3/P2-6 消费），不动已装方案。
// 空沙箱红线：模块级零全局触碰——fs 经 atomic.ts 的 fsFace()（globalThis.fs 平台注入），
// audit 经注入面（缺省 auditOp，测试注入记录器）；禁 console（release isolate 抛 BadResource，Finding A）。
import { atomicWriteText, fsFace } from "./atomic";

export interface TrustEntry {
	key_id: string
	/** 32B raw 公钥 hex（契约 C2-35 public_key 口径） */
	public_key: string
	added_at: number
}

/** 审计出口形状（OpEntry 的相关子集；测试注入记录器，缺省 auditOp fire-and-forget） */
export type TrustAudit = (entry: { action: string, module: string, target: string, detail: unknown, level?: number }) => void;

/** 指纹面（sha256Hex(publicKey) 全 64 hex，契约 §2.11；缺省走运行时 crypto 增补面，测试注入） */
export type FingerprintFn = (publicKeyHex: string) => string | null;

export interface TrustStore {
	list: () => Promise<TrustEntry[]>
	/** 公钥 hex；不在库 = null */
	get: (keyId: string) => Promise<string | null>
	/** 新增信任；同 key 同公钥 = "exists_same"（幂等）；同 key 异公钥 = 拒（首次绑定不可改） */
	add: (keyId: string, publicKeyHex: string, o?: { operator?: string | null }) => Promise<"added" | "exists_same">
	/** 移除即吊销（G5）；返回是否有过该 key（审计留痕） */
	remove: (keyId: string, o?: { operator?: string | null }) => Promise<boolean>
	/** 最近一次读盘的损坏/回落 note（null = 正常；诊断观测出口，禁 console——Finding A） */
	corruptNote?: () => string | null
}

/** C2-37 key_id 命名空间：<publisher>.<id> 全小写、至少一段点后缀；禁裸通用名（default/test/单段） */
const KEY_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
const PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/;

export function isValidKeyId(keyId: string): boolean {
	return KEY_ID.test(keyId);
}

function fingerprintOf(publicKeyHex: string): string | null {
	try {
		const c = (globalThis as { crypto?: { sha256Hex?: (d: Uint8Array) => string } }).crypto;
		const raw = new Uint8Array(32);
		for (let i = 0; i < 32; i++)
			raw[i] = Number.parseInt(publicKeyHex.slice(i * 2, i * 2 + 2), 16);
		return c?.sha256Hex?.(raw) ?? null;
	}
	catch {
		return null;
	}
}

function bakPathOf(path: string): string {
	return `${path}.bak`;
}

/** 带 status 的可读失败（respond 收口：err.status → json.fail，D14/B5/409 同一通道） */
function failStatus(status: number, msg: string): never {
	throw Object.assign(new Error(msg), { status });
}

/**
 * 信任库工厂（同 state.ts：构造即读盘 hydrate；写路径每次从盘上最新内容读-改-写，多写者不丢键）。
 * fs 走 atomic.ts fsFace()（globalThis.fs 平台注入/测试 stub，state.ts/lock.ts 同款 DIP）。
 */
export function createTrustStore(path: string, opts?: { audit?: TrustAudit, fingerprintOf?: FingerprintFn }): TrustStore {
	const audit = opts?.audit ?? auditOp;
	const fingerprint = opts?.fingerprintOf ?? fingerprintOf;
	let note: string | null = null;

	async function readDisk(): Promise<{ text: string | null, entries: Map<string, TrustEntry>, recovered: boolean }> {
		const main = await readTextOrNull(path);
		if (main !== null) {
			try {
				return { text: main, entries: parseTrust(main), recovered: false };
			}
			catch (e) {
				// 主文件损坏：尝试 .bak 回落（自动恢复 + note，下次写入自愈）
				const bak = await readTextOrNull(bakPathOf(path));
				if (bak !== null) {
					try {
						return { text: bak, entries: parseTrust(bak), recovered: true };
					}
					catch {
						// bak 也坏：落到底部统一报错
					}
				}
				failStatus(500, `信任库损坏：${path} 无法解析（${String(e)}）且 ${bakPathOf(path)} 不可用——请按 key_id/公钥手工修复 YAML，或删除该文件后经 ojm trust add 重建；损坏期间拒绝一切信任变更（fail-closed）`);
			}
		}
		return { text: null, entries: new Map(), recovered: false };
	}

	async function readTextOrNull(p: string): Promise<string | null> {
		try {
			return new TextDecoder().decode(await fsFace().readFile(p));
		}
		catch {
			return null; // 不存在/不可读按缺失（读缺失不炸；isMissingPath 双形态由调用方不关心——空库语义）
		}
	}

	async function commit(disk: { text: string | null, entries: Map<string, TrustEntry>, recovered: boolean }): Promise<void> {
		const next = serializeTrust(disk.entries);
		// .bak 只在主文件健康且内容将变时更新（recovered 时保住可用的 .bak 不覆盖）
		if (!disk.recovered && disk.text !== null && disk.text !== next)
			await atomicWriteText(bakPathOf(path), disk.text);
		await atomicWriteText(path, next);
		note = null; // 写成功即自愈：note 清零
	}

	return {
		async list() {
			const disk = await readDisk();
			note = disk.recovered ? `${path} 损坏，已自动回落 ${bakPathOf(path)}（下次信任变更写入即自愈）` : null;
			return [...disk.entries.values()].sort((a, b) => (a.key_id < b.key_id ? -1 : a.key_id > b.key_id ? 1 : 0));
		},
		async get(keyId) {
			const disk = await readDisk();
			return disk.entries.get(keyId)?.public_key ?? null;
		},
		corruptNote: () => note,
		async add(keyId, publicKeyHex, o) {
			if (!isValidKeyId(keyId))
				failStatus(400, `key_id 格式非法（C2-37 命名空间 <publisher>.<id> 全小写、禁裸通用名）：${keyId}`);
			if (!PUBLIC_KEY_HEX.test(publicKeyHex))
				failStatus(400, `public_key 必须是 64 hex（Ed25519 32B raw）：${publicKeyHex.slice(0, 16)}…`);
			const disk = await readDisk();
			const existing = disk.entries.get(keyId);
			if (existing !== undefined) {
				if (existing.public_key === publicKeyHex)
					return "exists_same"; // 幂等：不重写不审计
				failStatus(409, `信任库首次绑定不可改（C2-38）：key_id「${keyId}」已绑定其他公钥（库内指纹 ${fingerprint(existing.public_key) ?? "?"} ≠ 新钥指纹 ${fingerprint(publicKeyHex) ?? "?"}）——轮换请新增 key_id，禁覆写`);
			}
			const next = new Map(disk.entries);
			next.set(keyId, { key_id: keyId, public_key: publicKeyHex, added_at: Date.now() });
			await commit({ ...disk, entries: next });
			// operator 不可得 → 记 "unknown" 且告警级（level 4），不静默 null（P2-5）
			const op = o?.operator ?? null;
			audit({
				action: "solution.trust.add",
				module: "market",
				target: keyId,
				detail: { key_id: keyId, fingerprint: fingerprint(publicKeyHex), operator: op ?? "unknown" },
				level: op ? 6 : 4,
			});
			return "added";
		},
		async remove(keyId, o) {
			const disk = await readDisk();
			if (!disk.entries.has(keyId))
				return false; // 无此 key：无吊销可执行，不审计
			const next = new Map(disk.entries);
			next.delete(keyId);
			await commit({ ...disk, entries: next });
			// operator 不可得 → 记 "unknown" 且告警级（level 4），不静默 null（P2-5）
			const op = o?.operator ?? null;
			audit({
				action: "solution.trust.revoke",
				module: "market",
				target: keyId,
				detail: { key_id: keyId, operator: op ?? "unknown" },
				level: op ? 6 : 4,
			});
			return true;
		},
	};
}

// ── 序列化/解析（严格受限子集，同 state.ts 口径）──────────────────────────────

function serializeTrust(entries: Map<string, TrustEntry>): string {
	const ids = [...entries.keys()].sort();
	if (ids.length === 0) {
		return "trusted_keys: {}\n";
	}
	const lines = ["trusted_keys:"];
	for (const id of ids) {
		const e = entries.get(id)!;
		lines.push(
			`  ${id}:`,
			`    public_key: "${e.public_key}"`,
			`    added_at: ${e.added_at}`,
		);
	}
	return `${lines.join("\n")}\n`;
}

/** 严格解析：首行 `trusted_keys:`/`trusted_keys: {}`，随后每组三行（键行/public_key/added_at），任何偏差 = 损坏 */
function parseTrust(text: string): Map<string, TrustEntry> {
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") {
		lines.pop();
	}
	if (lines.length === 0) {
		throw new Error("空文件");
	}
	const entries = new Map<string, TrustEntry>();
	if (lines[0] === "trusted_keys: {}") {
		if (lines.length !== 1) {
			throw new Error("「trusted_keys: {}」之后存在多余内容");
		}
		return entries;
	}
	if (lines[0] !== "trusted_keys:") {
		throw new Error(`首行应为「trusted_keys:」，实为「${lines[0]}」`);
	}
	let i = 1;
	while (i < lines.length) {
		const keyId = /^ {2}([^:\s]+):$/.exec(lines[i])?.[1];
		if (keyId === undefined) {
			throw new Error(`第 ${i + 1} 行应为 key_id 行，实为「${lines[i]}」`);
		}
		const publicKey = /^ {4}public_key: "([0-9a-f]{64})"$/.exec(lines[i + 1] ?? "")?.[1];
		const addedAt = /^ {4}added_at: (-?\d+)$/.exec(lines[i + 2] ?? "")?.[1];
		if (publicKey === undefined || addedAt === undefined) {
			throw new Error(`key「${keyId}」条目格式不完整或字段损坏`);
		}
		entries.set(keyId, { key_id: keyId, public_key: publicKey, added_at: Number(addedAt) });
		i += 3;
	}
	return entries;
}
