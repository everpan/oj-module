/**
 * 错误归一辅助：兼容两种形态——生成物 client 抛的 ContractApiError（code/msg）
 * 与 ky HTTPError（response.status / data 信封）。判断尽量宽，避免依赖单一
 * 形态的脆弱字段（ky 版本间 HTTPError.data 行为有差异）。
 */

/** HTTP 状态：ContractApiError.code 优先，HTTPError 回落 response.status */
function statusOf(e: unknown): number | undefined {
	const err = e as { code?: number, response?: Response } | null;
	if (typeof err?.code === "number")
		return err.code;
	return err?.response?.status;
}

/** 该错误是否为 403（页面切「无权限/引导」面板的判据） */
export function isForbidden(e: unknown): boolean {
	return statusOf(e) === 403;
}

/** must_change 判定：悬挂期 403 的 msg 为后端固定文案（access.ts 硬编码） */
export function isMustChange(e: unknown): boolean {
	const err = e as { msg?: string, data?: { code?: string } } | null;
	return err?.data?.code === "must_change" || (err?.msg ?? "").includes("password change required");
}

/** 人话 msg：优先信封 msg，未知透传后端原文 */
export function errMsg(e: unknown): string {
	const err = e as { msg?: string, data?: { msg?: string } } | null;
	return err?.msg ?? err?.data?.msg ?? (e instanceof Error ? e.message : String(e));
}

/**
 * 已知业务错误 → i18n 人话；未知透传后端 msg。与后端 fail(status, message)
 * 的 message 逐字匹配（users.ts 等 service 的 fail 文案）。
 */
export function explainError(e: unknown, t: (key: string) => string): string {
	if (isForbidden(e))
		return t("system:err.forbidden");
	if (isMustChange(e))
		return t("system:err.mustChange.title");
	const msg = errMsg(e);
	if (msg.includes("yourself"))
		return t("system:err.selfAction");
	if (msg.includes("password too short"))
		return t("system:err.pwdTooShort");
	if (msg.includes("username exists"))
		return t("system:err.usernameExists");
	if (msg.includes("reserved"))
		return t("system:err.usernameReserved");
	return msg;
}
