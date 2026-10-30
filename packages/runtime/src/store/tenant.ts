import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 租户上下文（L2：登录带租户）——**运行时级**，不属于任何业务模块。
 *
 * 为什么放在 runtime 而不是登录模块（2026-10-30 冷启动 e2e 实测）：
 * `tenant.enable` 后除 `anonymous_paths` 白名单外每个 `{base}` 请求都必须带
 * `X-TENANT-ID`，而宿主 shell 在任何模块 `onInit` 之前就要发两个请求：
 *   · `packages/cli/shell/src/host.tsx` 的 `hydrateUser()`（角色必须早于 loadAll 就位，
 *     否则 B16 按空角色过滤，admin 看不到 /system）；
 *   · `store/solution-routes.ts` 的 token 监视（导入即武装）。
 * 这两发过去由模块在 `onInit` 里注册 headerProvider 提供租户头，时序上必然晚一步：
 * 冷启动实测 t=88ms/187ms 两个请求无头 → 400 `missing tenant header` → 角色被清空。
 * 租户头是**传输层**关注点，与「哪个模块先加载」无关，故由运行时直接注入。
 *
 * 取值链（登录前还没有会话，只能这么推）：
 *   1. `?tenant=<企业代码>`（服务商后台生成的专属登录链接、或客户自己带）；
 *   2. 上一轮选择过的值（刷新/深链不丢）；
 *   3. 部署默认 `default`（单租户部署恒走这里，UX 与单租户时代完全一致）。
 *
 * 值先按字面使用。企微代开发阶段企业代码是 `corp_id`，由服务端
 * `wecom_app_profile(corp_id → tenant_key)` 解析成真实 `tenant_id`，前端不改。
 */
export const DEFAULT_TENANT = "default";

/** URL 查询参数名 = 企业代码（D10：客户能从企微后台看到 corp_id，内部 tenant_key 不进 URL） */
export const TENANT_QUERY_PARAM = "tenant";

/** 租户请求头名（与站点 config.yaml 的 `tenant.header_key` 同值，两侧改动需同步） */
export const TENANT_HEADER = "X-TENANT-ID";

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

/** 当前应携带的租户（请求层唯一取值口；空值回落部署默认，绝不发空头） */
export function currentTenant(): string {
	return useTenantStore.getState().tenant || DEFAULT_TENANT;
}

// 模块作用域执行 `?tenant=` 引导：请求层首次请求就可能早于任何模块 onInit，
// 引导必须同样早。浏览器环境才执行（vitest/Node 下无 location，跳过）。
if (typeof window !== "undefined")
	bootstrapTenant();
