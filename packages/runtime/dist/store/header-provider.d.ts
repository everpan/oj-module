/**
 * 请求头 provider（D-M9）：模块经 ctx.register.headerProvider 注入惰性求值的
 * 自定义请求头（租户等），beforeRequest 在 token / X-Lang 注入之后逐请求合并。
 *
 * 合并语义 = 追加非替换：provider 未提及的头不受影响；同名头以后写（provider）
 * 为准（ky Headers.set 语义）。provider 未注册时请求照发（时序容忍：
 * 登录前 guard 请求无租户头）。
 */
export type HeaderProvider = () => Record<string, string>;
export declare function registerHeaderProvider(moduleName: string, provider: HeaderProvider): void;
export declare function currentHeaderProvider(): HeaderProvider | undefined;
export declare function unregisterHeaderProvider(moduleName: string): void;
