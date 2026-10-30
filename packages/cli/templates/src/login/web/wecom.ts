/**
 * 企微登录的**纯逻辑**（无 react / 无 request / 无 runtime 依赖），便于 node 侧回归：
 * 授权入口 URL 拼装、回跳落地参数解析。
 *
 * 与后端的分工（§5.4/§11.5）：
 *   · 发起：浏览器整页跳 `/auth/wecom/login?corp=` → 后端 302 到企微（前端拿不到 opaque redirect，
 *     所以必须 window.location.assign，不能用 XHR/fetch）；
 *   · 回跳：后端 302 回 `/login?wecom_ticket=&tenant=`，本文件把这两个参数解析出来；
 *   · 换票：ticket → POST /auth/wecom/ticket（由 auth-provider 完成，store 写入仍归 runtime）。
 */

/** 回跳落地参数名（后端 loginLandingUrl 拼的，改这里必须同时改后端） */
export const WECOM_TICKET_PARAM = "wecom_ticket";
export const WECOM_TENANT_PARAM = "tenant";

export interface WecomLanding {
	/** 一次性登录票据（180 秒、只能用一次） */
	ticket: string
	/** 票据所属企业代码；空串表示后端没带（此时沿用本地已存的租户） */
	tenant: string
}

/**
 * 解析回跳落地参数。非企微落地（普通打开登录页）返回 null——
 * 调用方据此决定「走表单」还是「直接换票」。
 */
export function parseWecomLanding(search: string): WecomLanding | null {
	const params = new URLSearchParams(search);
	const ticket = params.get(WECOM_TICKET_PARAM)?.trim() ?? "";
	if (!ticket)
		return null;
	return { ticket, tenant: params.get(WECOM_TENANT_PARAM)?.trim() ?? "" };
}

/**
 * 授权入口（站内路径，调用方负责 `withSiteBase` 拼部署前缀后整页跳转）。
 * `corp` 为空时**照样跳**：后端会回 400 并说明缺企业代码，比前端静默不动更容易排查。
 */
export function wecomAuthorizePath(corp: string, agent?: string): string {
	const params = new URLSearchParams();
	const c = corp.trim();
	if (c)
		params.set("corp", c);
	const a = agent?.trim();
	if (a)
		params.set("agent", a);
	const qs = params.toString();
	return `/auth/wecom/login${qs ? `?${qs}` : ""}`;
}
