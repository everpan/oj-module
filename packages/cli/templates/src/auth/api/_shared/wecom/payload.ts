// 企微回调报文的入口归一化：把两种可能的包体（XML / JSON）折成同一份扁平字段表，
// 业务代码（`events.ts` / `wecom/api.ts`）只认字段名，不认格式。
//
// **按官方文档，我们这类回调收到的是 XML**：代开发 / 第三方应用所属的「通用回调配置」
// （96238 §3.2）只写 `<xml><ToUserName><Encrypt>`；`callback_format=json` 只在「对外收款」的
// 指令回调（97478）有说明。所以回调地址不带那个参数（`config.ts::eventUrlOf` 记了这段依据）。
//
// 那为什么还收 JSON：解密后的**明文**在多份业务文档里都有 JSON 版（如 92655 的 change_contact），
// 上游哪天默认切 JSON、或某类事件改发 JSON，这里不用动就能吃下。归一化只此一个入口，多一个分支
// 的成本；反过来「只吃 XML」意味着那天要回头改事件分发与端点接线。
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
