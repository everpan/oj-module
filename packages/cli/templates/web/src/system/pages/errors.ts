/**
 * 已知业务错误 → i18n 人话；未知透传后端 msg。ContractApiError 的 code/msg
 * （HTTP 403 时 toApiError 已归一）与后端 fail(status, message) 的 message 逐字匹配。
 */
export function explainError(e: unknown, t: (key: string) => string): string {
	const err = e as { code?: number, msg?: string } | null;
	if (err?.code === 403)
		return t("system:err.forbidden");
	const msg = err?.msg ?? (e instanceof Error ? e.message : String(e));
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

/** 该错误是否为 403（页面切「无权限」面板的判据） */
export function isForbidden(e: unknown): boolean {
	return (e as { code?: number } | null)?.code === 403;
}
