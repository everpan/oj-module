import { request } from "./index";
/**
 * P6.3 / D11：模块专用 scoped request client。
 *
 * 模块不再拿到全局 request——它以模块登记的 apiPrefix 为边界收敛：
 * 请求 URL 必须以 `ctx.register.apiPrefix()` 声明的**任一**前缀开头，越界直接
 * 拒绝（人话报错）。前缀读取是惰性的（每次请求时求值），因此允许模块
 * 在生命周期中先发请求前登记、甚至追加登记。
 *
 * 这是纵深防御的前端一半；后端逐接口鉴权仍是安全兜底（§4.8 授权行）。
 */
type GlobalRequest = typeof request;
/** 仅暴露安全子集：callable + HTTP verb 工厂；不给 create/extend（可绕过 hooks） */
export declare function createScopedRequest(moduleName: string, 
/**
 * 惰性取已登记前缀。一模块可登记多个（多个生成 client 各自登记），
 * 传数组即「命中任一放行」；兼容单值写法。
 */
getPrefix: () => string | readonly string[] | undefined, 
/** 注入底层实例，测试用 */
underlying?: GlobalRequest): GlobalRequest;
export {};
