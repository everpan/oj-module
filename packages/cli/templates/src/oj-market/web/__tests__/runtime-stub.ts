// 测试用运行时桩：组件测试经 MarketClientContext 注入内存 fake，从不真正调用 request，
// 故只需 defineModule（identity）与最小 ky 形态 request，避免引入宿主构建期注入的全局（__APP_INFO__）。
export function defineModule(def: unknown) {
	return def;
}

export const request = {
	get(_url: string, _opts?: unknown) {
		return Promise.resolve({ json: () => Promise.resolve({}) });
	},
	post(_url: string, _opts?: unknown) {
		return Promise.resolve({ json: () => Promise.resolve({}) });
	},
};
