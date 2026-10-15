/**
 * 统一中间表示（IR）。
 *
 * 翻译层退役后，IR 由 `openapi.json`（oj v0.1.73 `oj openapi` 产物）经
 * `openapi-ir.ts` 构造——本模块只承载 IR 的**类型定义**与少量与路由拼接/切分
 * 相关的纯函数（`wirePrefixOf` / `splitRoute`），供 emit-client、emit-stub、check
 * 复用，不再包含任何 zod 求值/白名单逻辑。
 */

/** multipart 文件部件（DSL 声明归一：required/multiple 显式化，发射器不再看 undefined） */
export interface IrFormFile {
	name: string
	required: boolean
	multiple: boolean
}

/**
 * multipart 请求体：文本部件保留 schema（JSON Schema，转 api.schemas 用），
 * 文件部件只有名字与形态——binary 刻意不进 schema（FormData 由生成 client 组装）。
 */
export interface IrForm {
	fieldsSchema?: unknown
	/** 文本部件名（shape 键序 = 契约声明序：FormData append 与 OpenAPI 键序都据此，保字节稳定） */
	fieldNames: string[]
	files: IrFormFile[]
}

export interface IrEndpoint {
	/** 端点方法名（来自 operationId 的 camelCase 推导） */
	name: string
	apiPrefix: string
	/** 线上前缀（D-M8）：缺省 = apiPrefix */
	urlPrefix?: string
	/** 相对 apiPrefix 的 route，如 "/item/{id}" */
	route: string
	method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"
	/** wirePrefixOf(api) + route，如 "/order/item/{id}" */
	fullPath: string
	/** 参数段名（catch-all 去 *），如 ["id"] */
	paramNames: string[]
	querySchema?: unknown
	paramsSchema?: unknown
	bodySchema?: unknown
	/** multipart/form-data 请求体（与 bodySchema 互斥） */
	form?: IrForm
	dataSchema?: unknown
	raw: boolean
	ignoreLoading?: boolean
	description?: string
}

/** 线上前缀（D-M8）：urlPrefix 声明时取之（URL 命名空间 ≠ 目录名），否则回落 apiPrefix */
export function wirePrefixOf(api: { apiPrefix: string, urlPrefix?: string }): string {
	return api.urlPrefix ?? api.apiPrefix;
}

/**
 * route →（目录镜像 + `.route` 尾巴）切分（AC-D10 §4 算法，stub 生成与
 * --check 对账共用同一实现）：静态前缀段 → 目录；自首个参数段起的尾巴 → `.route`。
 */
export function splitRoute(route: string): { dir: string, tail?: string } {
	const segs = route.split("/").filter(Boolean);
	const firstParam = segs.findIndex(seg => seg.startsWith("{"));
	if (firstParam === -1)
		return { dir: segs.join("/") };
	return {
		dir: segs.slice(0, firstParam).join("/"),
		tail: segs.slice(firstParam).join("/"),
	};
}
