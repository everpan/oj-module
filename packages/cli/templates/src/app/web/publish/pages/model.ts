// 「发布管理」页的纯逻辑（无 React、无 IO）——状态颜色、可撤销判定、给用户的命令行。
// 抽出来的唯一理由：这三件事是页面里最该被钉死的口径，且都必须能脱离 antd 断言。

export type CredentialStatus = "active" | "used" | "revoked" | "expired";

/** 状态 → antd Tag 颜色。Record 全量约束：新增状态时这里编译期就缺键。 */
const STATUS_COLOR: Record<CredentialStatus, string> = {
	active: "processing",
	used: "success",
	revoked: "default",
	expired: "warning",
};

export function statusColor(status: CredentialStatus): string {
	return STATUS_COLOR[status];
}

/**
 * 能否撤销：只有「待兑换」可以。
 *
 * 已兑换的凭证背后是一条长期有效的发布身份（公钥已进信任库），撤回凭证不会让它失效，
 * 反而制造「以为撤了其实没撤」的错觉——后端的 400 文案就是这个意思。
 * 按钮仍要渲染（禁用态），不用隐藏：隐藏会让用户以为页面没做完。
 */
export function canRevoke(status: string): boolean {
	return status === "active";
}

/**
 * 复制给用户的一行命令。
 *
 * 只带凭证，不带 `--site`：站点地址由 CLI 从本机配置或上次发布记录里取，
 * 页面拼一个 origin 反而在反代/多域名部署下更容易错。
 */
export function buildKeygenCommand(token: string): string {
	return `ojm keygen --credential ${token}`;
}

/**
 * 统一信封错误 → 人话。后端 fail(status, message) 的文案本身就是给用户看的，
 * 故优先取 `msg`（ContractApiError），其次 Error.message。
 *
 * 与 system/pages/errors.ts 的 errMsg 同构但不互相 import：那是系统管理根内部模块，
 * 让「发布管理」依赖它会把两个根的加载顺序绑在一起（多根聚合下互不依赖是硬约定）。
 */
export function errorText(e: unknown): string {
	const msg = (e as { msg?: unknown } | null)?.msg;
	if (typeof msg === "string" && msg !== "")
		return msg;
	return e instanceof Error ? e.message : String(e);
}
