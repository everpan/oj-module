// 市场 API 客户端（DIP）：定义与宿主 _platform 编排面 + market_history 端点的契约。
// 实现与 ky 形态解耦——组件/hooks 注入 MarketClient，测试可注入内存 fake（见 __tests__）。
// 第一方专用调用面（R29）：仅市场应用消费 /api/_platform/market/*，第三方方案不得仿照。

import type {
	EnableInput,
	IndexRow,
	InstallInput,
	MarketHistory,
	TaskRecord,
	UninstallImpact,
} from "../types";

/** ky 形态的最小请求子集（get/post 返回带 .json<T>() 的响应） */
export interface HttpRequest {
	get: <T = unknown>(
		url: string,
		opts?: { searchParams?: Record<string, string> },
	) => Promise<{ json: <R = T>() => Promise<R> }>
	post: <T = unknown>(
		url: string,
		opts?: { json?: unknown },
	) => Promise<{ json: <R = T>() => Promise<R> }>
}

/** 与运行时/生成客户端一致的响应信封（DIP：服务端统一 {code,msg,data} 包裹） */
interface OjEnvelope<T> {
	code: number
	msg?: string
	data?: T
}

/** 市场客户端契约（组件/hooks 依赖此接口，而非具体 http 实现） */
export interface MarketClient {
	/** 登录即可：{ apiVersion }（peerPlatform 预检口径） */
	meta: () => Promise<{ apiVersion: string }>
	/** 卡片数据源（superadmin） */
	index: () => Promise<IndexRow[]>
	/** 触发安装，返回轮询用 task_id */
	install: (input: InstallInput) => Promise<{ task_id: string }>
	/** 任务轮询消费面（query 形态 ?id=） */
	task: (id: string) => Promise<TaskRecord>
	/** 生命周期开关（同步 setEnabled，无任务模型；{ok,message} 200 渲染 ok 位） */
	enable: (input: EnableInput) => Promise<{ ok: boolean, message: string }>
	/** 市场操作历史（_platform 只读端点 /_platform/market/history） */
	history: () => Promise<MarketHistory[]>
	/** 卸载影响面预检（P3 U1；服务端返回供二次确认，P1-15a 补齐后接通） */
	uninstallImpact: (name: string) => Promise<UninstallImpact>
	/** 卸载（P1-15a 补齐后接通） */
	uninstall: (name: string) => Promise<{ ok: boolean, message: string }>
}

// 第一方市场端点：相对前缀，由运行时 request 的 VITE_API_BASE_URL（/api）统一加前缀；
// 此处若再写 /api 会与运行时前缀叠加成 /api/api/（R29 联调发现）。
const PLATFORM = "/_platform/market";
const HISTORY = "/_platform/market/history";

/**
 * 503 = 服务端「未配置市场地址（framework.market_cdn_url）」，是**预期空态**而非故障
 * （PRD §5.3：卡片区显示「未配置市场地址」）。模板默认不配市场地址，新工程一进市场页
 * 就会撞它——在此归空数组，交由卡片空态文案承载；其它状态码照旧上抛。
 */
function isUnconfigured(e: unknown): boolean {
	return (e as { response?: { status?: number } } | null)?.response?.status === 503;
}

/** 默认 HTTP 实现：基于运行时 request（ky 形态） */
export function createHttpMarketClient(request: HttpRequest): MarketClient {
	return {
		async meta() {
			const r = await request.get<OjEnvelope<{ apiVersion: string }>>(`${PLATFORM}/meta`);
			const env = await r.json();
			return env.data!;
		},
		async index() {
			try {
				const r = await request.get<OjEnvelope<IndexRow[]>>(`${PLATFORM}/index`);
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
			const r = await request.post<OjEnvelope<{ task_id: string }>>(`${PLATFORM}/install`, {
				json: {
					name: input.name,
					version: input.version ?? null,
					source: input.source ?? "cdn",
				},
			});
			const env = await r.json();
			return env.data!;
		},
		async task(id: string) {
			const r = await request.get<OjEnvelope<TaskRecord>>(`${PLATFORM}/task`, { searchParams: { id } });
			const env = await r.json();
			return env.data!;
		},
		async enable(input: EnableInput) {
			const r = await request.post<OjEnvelope<{ ok: boolean, message: string }>>(`${PLATFORM}/enable`, {
				json: { name: input.name, enabled: input.enabled },
			});
			const env = await r.json();
			return env.data!;
		},
		async history() {
			const r = await request.get<OjEnvelope<MarketHistory[]>>(HISTORY);
			const env = await r.json();
			return env.data!;
		},
		async uninstallImpact(name: string) {
			const r = await request.get<OjEnvelope<UninstallImpact>>(`${PLATFORM}/uninstall-impact`, {
				searchParams: { name },
			});
			const env = await r.json();
			return env.data!;
		},
		async uninstall(name: string) {
			const r = await request.post<OjEnvelope<{ ok: boolean, message: string }>>(`${PLATFORM}/uninstall`, {
				json: { name },
			});
			const env = await r.json();
			return env.data!;
		},
	};
}
