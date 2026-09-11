/**
 * 模块工程配置：共享依赖一律不进 dependencies（宿主 importmap 提供），
 * 这里只登记模块清单（entry 相对本工程根）。
 *
 * D11：自包含拷贝根仓 8 模块 + playground 的 demo/login，并补 notification 壳，
 * 共 11 个模块。顺序对齐根仓应用菜单编排。
 */
export default {
	/** 产物 URL 前缀，留空表示同源相对路径 */
	baseUrl: "",
	modules: [
		{
			name: "about",
			entry: "web/src/about/entry.ts",
			enabled: true,
		},
		{
			name: "access",
			entry: "web/src/access/entry.ts",
			enabled: true,
		},
		{
			name: "exception",
			entry: "web/src/exception/entry.ts",
			enabled: true,
		},
		{
			name: "home",
			entry: "web/src/home/entry.ts",
			enabled: true,
		},
		{
			name: "outside",
			entry: "web/src/outside/entry.ts",
			enabled: true,
		},
		{
			name: "personal-center",
			entry: "web/src/personal-center/entry.ts",
			enabled: true,
		},
		{
			name: "route-nest",
			entry: "web/src/route-nest/entry.ts",
			enabled: true,
		},
		{
			name: "system",
			entry: "web/src/system/entry.ts",
			enabled: true,
		},
		{
			name: "demo",
			entry: "web/src/demo/entry.ts",
			enabled: true,
		},
		{
			name: "login",
			entry: "web/src/login/entry.ts",
			enabled: true,
		},
		{
			name: "notification",
			entry: "web/src/notification/entry.ts",
			enabled: true,
		},
	],
};
