// 发布身份的推导规则 —— **唯一真源**。
//
// 为什么只在服务端算：`key_id` 直接决定 `~/.ojm/keys/<id>/` 的目录名与签名身份，
// 同一规则若在 `packages/cli` 与模板工程（互不可 import 的两棵树）各写一份，必然漂移，
// 表现为「CLI 建了 demo-solution.wecom-everpan，服务端记录成 demo-solution.wecom-everpan-x」。
// 故 key_id 在**申请时**由本文件算好落库，兑换接口原样下发，CLI 零推导。
//
// 规则与约束：
//   · 产品名 = 解决方案名，遵循 NAME_RE（小写字母开头，仅 [a-z0-9-]，≤64）
//   · 人名段 = username 归一化：小写 → 非 [a-z0-9-] 一律替换为 '-' → 折叠连续 '-' → 去首尾 '-'
//     （`wecom:everpan` → `wecom-everpan`，目录名不出现冒号；比对也无需回到裸人名）
//   · key_id = `<product>.<person>`，必须满足 C2-37 的 key_id 形状
//   · 归一化后为空（例如纯中文用户名）→ 退化为 `u<uid>`，保证仍满足 key_id 形状

/** C2-37 key_id 形状：小写、≥2 段、仅 [a-z0-9-]（与 packages/cli/src/keygen.ts 的 isValidKeyId 同规则） */
export const KEY_ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

/** 解决方案名规则（与 packages/cli/src/manifest-contract.ts 的 NAME_RE 同规则） */
export const PRODUCT_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * 保留名：产品名占用它们会让人误以为是框架/平台自身发布的包。
 * 与 manifest-contract 的 RESERVED_NAMES 取交集（`_platform` / `_system` 等带下划线的
 * 本就过不了 PRODUCT_RE，不必重复列）。
 */
export const RESERVED_PRODUCTS = new Set(["oj", "ojm", "system", "auth", "market", "framework", "health", "plugins", "registry"]);

/** 凭证有效期：7 天（一次性令牌的暴露窗口） */
export const CREDENTIAL_TTL_SECS = 7 * 24 * 3600;

export interface IdentityInput {
	product: string
	username: string
	uid: number
}

/** username → key_id 的人名段 */
export function encodePerson(username: string, uid: number): string {
	const normalized = username
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return normalized === "" ? `u${uid}` : normalized;
}

/** 产品名 + 用户名 → key_id（不做校验，调用方先用 assertProduct 收口） */
export function deriveKeyId(input: IdentityInput): string {
	return `${input.product}.${encodePerson(input.username, input.uid)}`;
}

/** 产品名校验：形状 + 保留名。错误信息给可用示例，避免用户反复试错 */
export function assertProduct(value: unknown): string {
	const product = typeof value === "string" ? value.trim() : "";
	if (product === "")
		throw Object.assign(new Error("产品名不能为空：填你要发布的解决方案名，例如 demo-solution"), { status: 400 });
	if (!PRODUCT_RE.test(product))
		throw Object.assign(new Error("产品名只能是小写字母开头的 [a-z0-9-]，最长 64 个字符，例如 demo-solution"), { status: 400 });
	if (RESERVED_PRODUCTS.has(product))
		throw Object.assign(new Error(`产品名 ${product} 是框架保留名，请换成你的解决方案名`), { status: 400 });
	return product;
}

/** 派生结果自检：理论上必然成立，不成立说明归一化有 bug，宁可 500 也不发一个畸形身份 */
export function assertKeyId(keyId: string): string {
	if (!KEY_ID_RE.test(keyId))
		throw new Error(`内部错误：推导出的发布身份 ${keyId} 不符合 key_id 规则，请联系管理员`);
	return keyId;
}
