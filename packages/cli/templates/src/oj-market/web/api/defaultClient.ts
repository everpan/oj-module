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
	IndexPage,
	InstallInput,
	MarketHistory,
	McpCatalogResult,
	PurgeHistoryResult,
	ReleasePage,
	TaskRecord,
	TrustReviewItem,
	UninstallImpact,
	UploadPackageResult,
} from "../types";
import type { MarketClient } from "./client";

import { request } from "@oj-module/runtime";
import {
	bindRequest,
	ojMarketEnablePost,
	ojMarketHistoryDelete,
	ojMarketHistoryGet,
	ojMarketInstallPost,
	ojMarketMcpCatalogGet,
	ojMarketMetaGet,
	ojMarketReleasesGet,
	ojMarketTaskGet,
	ojMarketTrustGet,
	ojMarketTrustPost,
	ojMarketTrustReviewGet,
	ojMarketUninstallImpactGet,
	ojMarketUninstallPost,
} from "../__client";

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

/** ky 形态 post 子集（仅离线包上传 multipart 直连 request 时用；生成 client 只会 JSON body） */
interface HttpPostLike {
	post: <T = unknown>(
		url: string,
		opts?: { searchParams?: Record<string, string>, body?: unknown, timeout?: number | false, retry?: number },
	) => Promise<{ json: <R = T>() => Promise<R> }>
}

/** 与运行时/生成客户端一致的响应信封（DIP：服务端统一 {code,msg,data} 包裹） */
interface OjEnvelope<T> {
	code: number
	msg?: string
	data?: T
}

// 第一方市场端点：相对前缀（无前导 /），由运行时 request 的 VITE_API_BASE_URL（/api）统一加前缀；
// 与生成 client（ojMarket* 用 `oj-market/...`）保持一致，避免 /api 叠加成 /api/api/（R29）。
const MARKET = "oj-market";

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
		return (await ojMarketMetaGet()) as { apiVersion: string };
	},
	async index(input: { page?: number, size?: number } = {}) {
		// 唯一需 silentError 的端点：直连 request 抑制「未配置市场地址」的全局 toast。
		// v4 §四：分页数据源（{list,total,page,size}）；503（市场地址未配置）归空页——空态由卡片区文案承载。
		try {
			const params: Record<string, string> = {};
			if (input.page != null)
				params.page = String(input.page);
			if (input.size != null)
				params.size = String(input.size);
			const r = await (request as unknown as HttpGetLike)
				.get<OjEnvelope<IndexPage>>(`${MARKET}/index`, { searchParams: params, silentError: true, retry: 0 });
			const env = await r.json();
			return env.data!;
		}
		catch (e) {
			if (isUnconfigured(e))
				return { list: [], total: 0, page: 1, size: 20 };
			throw e;
		}
	},
	async install(input: InstallInput) {
		const data = await ojMarketInstallPost({
			name: input.name,
			version: input.version ?? null,
			source: input.source ?? "cdn",
		});
		return data as { task_id: string };
	},
	async task(id: string) {
		// 生成 Data 为空 schema（仅 DEV catchall 校验），经 unknown 桥接领域类型；
		// 运行时形状由服务端真源 + DEV zod 校验保证，TS 侧以领域类型为准。
		return (await ojMarketTaskGet({ id })) as unknown as TaskRecord;
	},
	async trust(taskId: string) {
		// 服务端自任务记录重取公钥复算指纹比对（防混淆代理），前端只传 task_id，不传公钥
		const data = await ojMarketTrustPost({ task_id: taskId });
		return data as { result: string, key_id: string, fingerprint: string };
	},
	async trustReview() {
		// 生成 client 已解包信封 + DEV 校验；此处仅对齐领域类型。
		return (await ojMarketTrustReviewGet()) as TrustReviewItem[];
	},
	async trustKeys() {
		return (await ojMarketTrustGet()) as unknown as { keys: Array<{ key_id: string, public_key: string }>, note: string | null };
	},
	async uploadPackage(input: { name: string, tgz: Blob, sig: Blob }) {
		// multipart 手写（生成 client 只会 JSON body；index 同款直连 request）：files 顺序
		// [tgz, sig] 即协议——oj http 面不透出文件名，包名走 query.name。
		// 大包（体积闸 50MB）远超默认 10s 超时：关超时 + 禁重试（整包重传只会放大内网耗时）。
		const form = new FormData();
		form.append("package", input.tgz, "package.tgz");
		form.append("signature", input.sig, "package.tgz.sig");
		const r = await (request as unknown as HttpPostLike)
			.post(`${MARKET}/upload`, { searchParams: { name: input.name }, body: form, timeout: false, retry: 0 });
		const env = await r.json() as OjEnvelope<UploadPackageResult>;
		// 信封业务错对齐生成 client 口径：code 非 0 / data 缺失 = 失败（200 信封异常也如实抛，
		// 不让 mutation 假成功——那会渲染成「既无结果也无报错」的静默面）
		if ((typeof env.code === "number" && env.code !== 0) || env.data == null)
			throw new Error(typeof env.msg === "string" && env.msg !== "" ? env.msg : "离线包上传失败（响应信封异常）");
		return env.data;
	},
	async enable(input: EnableInput) {
		const data = await ojMarketEnablePost({ name: input.name, enabled: input.enabled });
		return data as { ok: boolean, message: string };
	},
	async history() {
		return (await ojMarketHistoryGet()) as unknown as MarketHistory[];
	},
	async purgeHistory(input: { name: string, version: string }) {
		const data = await ojMarketHistoryDelete({ name: input.name, version: input.version });
		return data as unknown as PurgeHistoryResult;
	},
	async releases(input: { page?: number, limit?: number } = {}) {
		return (await ojMarketReleasesGet(input as { page: number, limit: number })) as unknown as ReleasePage;
	},
	async uninstallImpact(name: string) {
		return (await ojMarketUninstallImpactGet({ name })) as unknown as UninstallImpact;
	},
	async uninstall(name: string) {
		const data = await ojMarketUninstallPost({ name });
		return data as { ok: boolean, message: string };
	},
	async mcpCatalog() {
		// 生成 client 已解包信封 + DEV 校验；此处仅对齐领域类型。
		return (await ojMarketMcpCatalogGet()) as unknown as McpCatalogResult;
	},
};
