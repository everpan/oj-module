import { getAppInfo } from "@react-antd-module/runtime";

// P6.5：devDependencies 不再注入应用元信息（清单入 bundle 属信息
// 泄露），此数组恒为空，about 页对应卡片随之自动隐藏。
// 契约（P6.5/AppInfo）：不同宿主注入的应用元信息字段可缺省
// （runtime 产物即不携带 dependencies）——缺字段必须走空态而非崩溃，
// 一律经 getAppInfo() 读取。此前直接 Object.keys(dependencies) 在宿主
// 形态直接崩整页（React Router ErrorBoundary，202609010056 暴露）
const { dependencies } = getAppInfo().pkg;

export const dependenciesItems = Object.keys(dependencies ?? {}).map((dep) => {
	const value = dependencies?.[dep as keyof typeof dependencies];
	return {
		key: dep,
		label: dep,
		children: value,
	};
});

export const devDependenciesItems: { key: string, label: string, children: string }[] = [];
