/**
 * 契约制 client 的统一错误类型（AC-D5/§6.2）。
 *
 * 业务错误（非 2xx，oj json.fail(code,msg)）与契约违例（dev 校验失败，
 * code=-1）都收敛为本类型，消费方可 `instanceof` 判别并取 code/msg。
 *
 * 本子路径出口（`@react-antd-module/runtime/contract/errors`）是**生成 client 在
 * 浏览器侧的唯一入口**（评审 F3）：刻意 zod-free——zod 只随 runtime dist
 * 走（AC-D15），不进共享资产。
 */
export declare class ContractApiError extends Error {
    readonly code: number;
    readonly msg: string;
    constructor(code: number, msg: string);
}
export type { ScopedRequestLike } from "./scoped-request-like.ts";
