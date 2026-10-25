// 索引 / 吊销正文的 detached 侧车校验——REG-CS1（索引）与 REG-R10（吊销清单）共用的唯一判定点。
//
// 为什么单独成模块：`ojm registry export`（产离线包）与 `ojm registry import`（吃离线包）必须对
// 「一份侧车算不算数」给同一个答案。两边各写一份校验，一旦口径漂移就会出现最难查的那类故障——
// **导出的包自己导不进去**：导出侧松一点，问题拖到运维救站时才炸。
//
// 本模块只管**自洽**（alg / 公钥形态 / seq / base64 / Ed25519 验签）；
// **信任**（这把公钥是不是本站登记的 active 索引 key）由调用方注入 `isTrusted`：
// export 侧手上没有本地信任库，只做自洽（信任判定留给真正落盘的 import / 安装侧）；
// import 侧**必须**给 isTrusted，否则等于绕过 REG-CS1。
//
// 判别码沿用线上词汇（排障一眼归并）：index_sig_mismatch（形态/验签不符）、index_key_mismatch（公钥不受信）。
import { verifyCanonical } from "./lifecycle/sign";

/** 侧车唯一支持的签名算法（与服务端 verifyEd25519 同口径） */
export const SIDECAR_ALG = "Ed25519";

const HEX_RE = /^[0-9a-f]+$/i;
const BASE64_RE = /^[A-Z0-9+/]+={0,2}$/i;

export interface SidecarVerdict {
	ok: boolean
	code?: string
	message?: string
	/** 侧车声明的代次（形态合法时才有值） */
	seq: number | null
	/** 侧车声明的公钥（小写 hex；形态合法时才有值） */
	publicKey: string | null
}

export interface SidecarInput {
	/** 展示用文件名（`catalog.yaml` / `shards/2.yaml` / `revocations.yaml`） */
	rel: string
	/** 被签的正文（逐字节原文） */
	body: string
	/** 侧车 JSON 文本 */
	sigText: string
	/** 按种类拼规范串：`index:<kind>:<seq>:<sha256>` 或 `revocations:<seq>:<sha256>` */
	canon: (seq: number, text: string) => string
	/** 信任判定：公钥是否属于本站登记的 active 索引 key；缺省 = 只验自洽不验归属 */
	isTrusted?: (publicKeyHex: string) => boolean
}

/**
 * 校验一份侧车。**空侧车不在这里判**（缺文件 / 空正文的码因种类而异，由调用方先判）。
 * 坏 JSON 也算 `index_sig_mismatch`：这是数据破损，不是命令行用法问题。
 */
export function inspectSidecar(input: SidecarInput): SidecarVerdict {
	const { rel, body, sigText, canon, isTrusted } = input;

	let doc: unknown;
	try {
		doc = JSON.parse(sigText);
	}
	catch {
		return { ok: false, code: "index_sig_mismatch", message: `${rel} 的 .sig 不是合法 JSON`, seq: null, publicKey: null };
	}
	if (doc === null || typeof doc !== "object" || Array.isArray(doc))
		return { ok: false, code: "index_sig_mismatch", message: `${rel} 的 .sig 必须是对象（六字段：alg/key_id/public_key/value/canon/seq）`, seq: null, publicKey: null };
	const sig = doc as Record<string, unknown>;

	const alg = String(sig.alg ?? "");
	if (alg !== SIDECAR_ALG)
		return { ok: false, code: "index_sig_mismatch", message: `${rel} 签名算法只支持 ${SIDECAR_ALG}（收到「${alg}」）`, seq: null, publicKey: null };

	const pk = String(sig.public_key ?? "").toLowerCase();
	if (!HEX_RE.test(pk))
		return { ok: false, code: "index_sig_mismatch", message: `${rel} 签名公钥不是 hex 文本`, seq: null, publicKey: null };
	if (isTrusted !== undefined && !isTrusted(pk))
		return { ok: false, code: "index_key_mismatch", message: `${rel} 的签名公钥不在站点已登记的 active 索引 key 集合里——无法确认它属于 registry，已拒载`, seq: null, publicKey: pk };

	const seq = Number(sig.seq);
	if (!Number.isInteger(seq) || seq < 0)
		return { ok: false, code: "index_sig_mismatch", message: `${rel} 签名 seq 不合法（应为非负整数）`, seq: null, publicKey: pk };

	const value = String(sig.value ?? "");
	if (!BASE64_RE.test(value))
		return { ok: false, code: "index_sig_mismatch", message: `${rel} 签名 value 不是标准 base64`, seq, publicKey: pk };

	if (!verifyCanonical(pk, canon(seq, body), value))
		return { ok: false, code: "index_sig_mismatch", message: `${rel} 验签失败——正文与签名不匹配（或被篡改），已拒载`, seq, publicKey: pk };

	return { ok: true, seq, publicKey: pk };
}
