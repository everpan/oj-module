/**
 * 模块工程配置：共享依赖一律不进 dependencies（宿主 importmap 提供），
 * 这里只登记模块清单（entry 相对本工程根）。
 */
export default {
	/** 产物 URL 前缀，留空表示同源相对路径 */
	baseUrl: "",
	modules: [
		{
			// /home 必须是首个模块：shell 的 "/" → VITE_BASE_HOME_PATH（=/home）重定向
			name: "home",
			entry: "web/src/home/entry.ts",
			enabled: true,
		},
		{
			name: "demo",
			entry: "web/src/demo/entry.ts",
			enabled: true,
		},
		{
			// /login 路由由模块提供：shell 宿主不挂 runtime 内置 baseRoutes
			name: "login",
			entry: "web/src/login/entry.ts",
			enabled: true,
		},
		{
			// 个人中心：runtime 用户菜单固定导航 /personal-center/my-profile，缺则点击落空
			name: "personal-center",
			entry: "web/src/personal-center/entry.ts",
			enabled: true,
		},
		{
			// 通知：onInit 注册 notificationsApi provider（四方法全必填），
			// 通知铃的互动（单条已读/全部已读/清空）由此生效；未登记则永远回落内置只读兜底
			name: "notification",
			entry: "web/src/notification/entry.ts",
			enabled: true,
		},
	],
};
