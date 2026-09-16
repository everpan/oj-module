/**
 * 请求头 provider（D-M9）：模块经 ctx.register.headerProvider 注入惰性求值的
 * 自定义请求头（租户等），beforeRequest 在 token / X-Lang 注入之后逐请求合并。
 *
 * 合并语义 = 追加非替换：provider 未提及的头不受影响；同名头以后写（provider）
 * 为准（ky Headers.set 语义）。provider 未注册时请求照发（时序容忍：
 * 登录前 guard 请求无租户头）。
 */
export type HeaderProvider = () => Record<string, string>;

/**
 * 模块作用域注册表（同 auth-provider：先到先得，刻意不用 zustand——
 * provider 只在 beforeRequest 中被读，无订阅需求）。
 */
interface Registration {
	moduleName: string
	provider: HeaderProvider
}

let current: Registration | undefined;

export function registerHeaderProvider(moduleName: string, provider: HeaderProvider): void {
	if (current) {
		console.warn(
			`[header] 重复的请求头 provider 忽略：已由模块 "${current.moduleName}" 提供，`
			+ `忽略 "${moduleName}"（先到先得，与 authProvider 同一规则）。`,
		);
		return;
	}
	current = { moduleName, provider };
}

export function currentHeaderProvider(): HeaderProvider | undefined {
	return current?.provider;
}

export function unregisterHeaderProvider(moduleName: string): void {
	if (current?.moduleName === moduleName) {
		current = undefined;
	}
}
