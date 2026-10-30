// 企微消息 XML 取字段（只读、白名单式）。
// 为什么不用通用 XML 解析：明文已由 AES-CBC + msg_signature 双重认证（见 crypt.ts），
// 这里只从**可信明文**里取几个扁平标签，且标签名由调用方常量给出——不解析结构、不处理命名空间，
// 用正则换掉一个解析器依赖与它的实体展开攻击面。标签名非纯字母直接抛错（防拼接正则）。
// 未命中返回 null（「没这个字段」与「字段为空」由调用方区分）。

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

/** 取 `<Name>值</Name>`（支持 CDATA 与实体）；未命中 null */
export function xmlField(xml: string, name: string): string | null {
	if (!/^[A-Z_]\w*$/i.test(name))
		throw new Error(`xml: illegal field name ${name}`);
	const re = new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${name}>`);
	const m = re.exec(xml);
	if (!m)
		return null;
	return decodeEntities((m[1] ?? m[2] ?? "").trim());
}
