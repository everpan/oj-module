import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 租户上下文（L2：登录带租户）。
 *
 * tenant.enable 后每个 `{base}` 请求都必须带 `X-TENANT-ID`，而登录**之前**还没有会话，
 * 所以租户只能由「URL 上的企业代码 → 本地持久化 → 部署默认值」这条链推导：
 *   1. `?tenant=<企业代码>`（服务商后台生成的专属登录链接、或客户自己带）；
 *   2. 上一轮选择过的值（刷新/深链不丢）；
 *   3. 部署默认 `default`（单租户部署恒走这里，UX 与今天完全一致）。
 *
 * 值先按字面使用。企微代开发阶段（Phase 1）企业代码是 `corp_id`，由服务端
 * `wecom_app_profile(corp_id → tenant_key)` 解析成真实 `tenant_id`，前端不改。
 */
export const DEFAULT_TENANT = "default";

/** URL 查询参数名 = 企业代码（D10：客户能从企微后台看到 corp_id，内部 tenant_key 不进 URL）。 */
export const TENANT_QUERY_PARAM = "tenant";

interface TenantState {
	/** 当前请求应当携带的租户 id（`X-TENANT-ID` 的取值） */
	tenant: string
	setTenant: (tenant: string) => void
	/** 登出/切换租户时调用：清回部署默认值 */
	clear: () => void
}

export const useTenantStore = create<TenantState>()(
	persist(
		set => ({
			tenant: DEFAULT_TENANT,
			setTenant: tenant => set({ tenant: tenant.trim() || DEFAULT_TENANT }),
			clear: () => set({ tenant: DEFAULT_TENANT }),
		}),
		{ name: "oj-tenant" },
	),
);

/**
 * 启动时把 `?tenant=` 落到 store（URL 优先于持久化值）。
 * 返回最终生效的租户，供调用方打日志/透传。
 */
export function bootstrapTenant(): string {
	const fromUrl = new URLSearchParams(window.location.search).get(TENANT_QUERY_PARAM)?.trim();
	if (fromUrl)
		useTenantStore.getState().setTenant(fromUrl);
	return useTenantStore.getState().tenant;
}
