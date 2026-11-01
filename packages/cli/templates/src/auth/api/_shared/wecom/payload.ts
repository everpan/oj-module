// 企微回调报文的入口归一化：把两种可能的包体（JSON / XML）折成同一份扁平字段表，
// 业务代码（`events.ts` / `wecom/api.ts`）只认字段名，不认格式。
//
// **主路径是 JSON**：回调地址带 `?callback_format=json` 下发（`config.ts::eventUrlOf`），
// 上游支持 JSON 就一定是 JSON 进来。XML 只在本文件里出现，别处看不到。
//
// 为什么还要保留 XML 兜底（而不是只留 JSON）：`callback_format=json` 只在部分回调业务里
// 有官方文档（「对外收款」指令回调 97478、「部门通知事件」92655），而通用「回调配置」
// （96238 §3.2）至今写死 `<xml>…<Encrypt>`；`suite_ticket` / `create_auth` / `cancel_auth`
// 恰好只在那份通用文档里。只留 JSON 等于赌上游，赌输的代价是企业管理员扫码时看到
// 「应用安装失败，联系服务商」。兜底只占一个正则，不含结构解析。
//
// 为什么不用通用 XML 解析器：明文已由 AES-CBC + msg_signature 双重认证（crypt.ts），
// 这里只取扁平标签，且标签名由调用方常量给出——不解析结构、不处理命名空间，
// 用正则换掉一个解析器依赖与它的实体展开攻击面。
//
// 大小写：同一份报文里信封用小写（`{"tousername","encrypt","agentid"}`），密文里的明文
// 用大写（`{"SuiteId","InfoType"}`）。查字段一律走小写键，调用方不用关心这件事。

const XML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: "\"",
	apos: "'",
};

function decodeEntities(s: string): string {
	return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (whole, body: string) => {
		if (body[0] === "#") {
			const code = body[1] === "x" || body[1] === "X"
				? Number.parseInt(body.slice(2), 16)
				: Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : whole;
		}
		return XML_ENTITIES[body.toLowerCase()] ?? whole;
	});
}

export interface CallbackFields {
	/** 小写键 → 值（查字段只走这里） */
	values: Map<string, string>
	/** 报文里出现过的字段名（原样大小写、去重保序），只用于日志取证 */
	names: string[]
}

/** 取字段；未命中空串（「没这个字段」与「字段为空」在回调处理里不需要区分） */
export function field(fields: CallbackFields, name: string): string {
	return fields.values.get(name.toLowerCase()) ?? "";
}

function isCallbackFields(v: unknown): v is CallbackFields {
	return typeof v === "object" && v !== null && (v as CallbackFields).values instanceof Map;
}

// 只取「叶子节点」：非 CDATA 分支明确排除 `<`，于是 `<xml><Encrypt>…</Encrypt></xml>` 里的
// 根标签匹配不上（它内部以 `<` 开头），正则会继续向内找到 `<Encrypt>`。换成 `[\s\S]*?` 会让
// 根标签把整段吞成一个字段（名叫 `xml`），内层字段全部丢失——这是最容易写错的一处。
const XML_FIELD_RE = /<([A-Z_]\w*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/gi;

/**
 * 归一回调包体。接受四种输入：已是归一结果的字段表（幂等，直接返回）、oj 已解析好的对象、
 * JSON 字符串、XML 字符串。
 *
 * 都解不出字段时**不在这里抛错**：调用方按「缺 Encrypt」回 400，那条文案比
 * 「JSON 解析失败」更好排查（能直接指向回调地址被中间件改写这种事）。
 */
export function callbackFields(raw: unknown): CallbackFields {
	if (isCallbackFields(raw))
		return raw;
	const values = new Map<string, string>();
	const names: string[] = [];
	const put = (name: string, value: unknown) => {
		if (!names.includes(name))
			names.push(name);
		values.set(name.toLowerCase(), value == null ? "" : String(value));
	};

	if (typeof raw === "string") {
		const text = raw.trim();
		if (text.startsWith("{")) {
			try {
				for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, unknown>))
					put(k, v);
			}
			catch {
				return { values, names };
			}
		}
		else {
			for (const m of text.matchAll(XML_FIELD_RE))
				put(m[1]!, decodeEntities((m[2] ?? m[3] ?? "").trim()));
		}
		return { values, names };
	}

	if (raw && typeof raw === "object") {
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			// 嵌套对象不是企微回调的形态（字段全平铺）；遇到就跳过，别把 [object Object] 塞进字段表
			if (v !== null && typeof v === "object")
				continue;
			put(k, v);
		}
	}
	return { values, names };
}
