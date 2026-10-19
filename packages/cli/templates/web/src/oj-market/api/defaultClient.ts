// 默认市场客户端单例：统一委托给 ojm 从契约生成的 __client（运行时校验 + 唯一真源
// URL/信封）。组件经 MarketClientContext 消费，测试可注入内存 fake，避免依赖真实后端（DIP）。
//
// 统一收益：消除手写 URL 字符串、信封 {code,msg,data} 解包与契约漂移——DEV 下生成
// client 还会对响应做 zod 校验，服务端形状一旦漂移立即在控制台报错。
//
// index 是唯一「预期空态（未配置市场地址 → 503）」端点，需 silentError 抑制全局 toast；
// 生成 client 不暴露该选项，故 index 仍直接走运行时 request（见下方注释），其余方法统一委托。

import type {
	EnableInput,
	IndexRow,
	InstallInput,
	MarketHistory,
	TaskRecord,
	UninstallImpact,
} from "../types";
import type { MarketClient } from "./client";

import { request } from "@oj-module/runtime";
import {
	bindRequest,
	platformMarketEnablePost,
	platformMarketHistoryGet,
	platformMarketInstallPost,
	platformMarketMetaGet,
	platformMarketTaskGet,
	platformMarketUninstallImpactGet,
	platformMarketUninstallPost,
} from "../../_platform/__client/api";

// 绑定运行时 request 到生成 client 的模块级单槽（生成 client 是静态单例，必须由某处
// bindRequest；此处兜底确保市场子应用无论挂载顺序都能拿到请求实例）。与 _platform 模块
// entry 若再调用 create_platformClient(ctx) 幂等（绑定同实例）。
bindRequest(request as Parameters<typeof bindRequest>[0]);

/** ky 形态的最小请求子集（仅 index 直连 request 时用，get 返回带 .json<T>() 的响应） */
interface HttpGetLike {
	get: <T = unknown>(
		url: string,
		// silentError：错误体由本客户端消化（未配置市场地址走空态），不弹全局 toast；
		// retry: 0：503 是配置态而非抖动，默认重试 3 次只会刷出 4 条同样错误。
		opts?: { searchParams?: Record<string, string>, silentError?: boolean, retry?: number },
	) => Promise<{ json: <R = T>() => Promise<R> }>
}

/** 与运行时/生成客户端一致的响应信封（DIP：服务端统一 {code,msg,data} 包裹） */
interface OjEnvelope<T> {
	code: number
	msg?: string
	data?: T
}

// 第一方市场端点：相对前缀（无前导 /），由运行时 request 的 VITE_API_BASE_URL（/api）统一加前缀；
// 与生成 client（platformMarket* 用 `_platform/...`）保持一致，避免 /api 叠加成 /api/api/（R29）。
const MARKET = "_platform/market";

/**
 * 503 = 服务端「未配置市场地址（framework.market_cdn_url）」，是**预期空态**而非故障
 * （PRD §5.3：卡片区显示「未配置市场地址」）。模板默认不配市场地址，新工程一进市场页
 * 就会撞它——在此归空数组，交由卡片空态文案承载；其它状态码照旧上抛。
 */
function isUnconfigured(e: unknown): boolean {
	return (e as { response?: { status?: number } } | null)?.response?.status === 503;
}

export const httpMarketClient: MarketClient = {
	async meta() {
		// 生成 client 已解包信封 + DEV 校验；此处仅对齐领域类型。
		return (await platformMarketMetaGet()) as { apiVersion: string };
	},
	async index() {
		// 唯一需 silentError 的端点：直连 request 抑制「未配置市场地址」的全局 toast。
		try {
			const r = await (request as unknown as HttpGetLike)
				.get<OjEnvelope<IndexRow[]>>(`${MARKET}/index`, { silentError: true, retry: 0 });
			const env = await r.json();
			return env.data!;
		}
		catch (e) {
			if (isUnconfigured(e))
				return [];
			throw e;
		}
	},
	async install(input: InstallInput) {
		const data = await platformMarketInstallPost({
			name: input.name,
			version: input.version ?? null,
			source: input.source ?? "cdn",
		});
		return data as { task_id: string };
	},
	async task(id: string) {
		// 生成 Data 为空 schema（仅 DEV catchall 校验），经 unknown 桥接领域类型；
		// 运行时形状由服务端真源 + DEV zod 校验保证，TS 侧以领域类型为准。
		return (await platformMarketTaskGet({ id })) as unknown as TaskRecord;
	},
	async enable(input: EnableInput) {
		const data = await platformMarketEnablePost({ name: input.name, enabled: input.enabled });
		return data as { ok: boolean, message: string };
	},
	async history() {
		return (await platformMarketHistoryGet()) as unknown as MarketHistory[];
	},
	async uninstallImpact(name: string) {
		return (await platformMarketUninstallImpactGet({ name })) as unknown as UninstallImpact;
	},
	async uninstall(name: string) {
		const data = await platformMarketUninstallPost({ name });
		return data as { ok: boolean, message: string };
	},
};
