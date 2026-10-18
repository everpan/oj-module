/**
 * 模块工程配置：共享依赖一律不进 dependencies（宿主 importmap 提供），
 * 这里只登记模块清单（entry 相对本工程根）。
 *
 * 模块顺序即导航顺序：`home` 必须第一个（shell 的 "/" 重定向到它）。
 */
const allModules = [
	// /home 必须是首个模块：shell 的 "/" → VITE_BASE_HOME_PATH（=/home）重定向
	{ name: "home", entry: "web/src/home/entry.ts" },
	{ name: "demo", entry: "web/src/demo/entry.ts" },
	// /login 路由由模块提供：shell 宿主不挂 runtime 内置 baseRoutes
	{ name: "login", entry: "web/src/login/entry.ts" },
	// 个人中心：runtime 用户菜单固定导航 /personal-center/my-profile，缺则点击落空
	{ name: "personal-center", entry: "web/src/personal-center/entry.ts" },
	// 通知：onInit 注册 notificationsApi provider（四方法全必填），
	// 通知铃的互动（单条已读/全部已读/清空）由此生效；未登记则永远回落内置只读兜底
	{ name: "notification", entry: "web/src/notification/entry.ts" },
	// 系统管理：用户/成员资格/角色权限/操作日志/站点设置/登录方式（oj 后端 /api/system/*）
	{ name: "system", entry: "web/src/system/entry.ts" },
	// #region demo-only
	// 以下为模板内置的演示模块（about/access/exception/outside/route-nest），
	// 用于把 templates 当可运行 demo 直接跑；其文件在 `ojm init` 时不拷入新工程
	// （见 init.exclude.yaml），故本区间连同这些条目会被 init 一并剥离，
	// 脚手架产出的配置不会残留指向缺失文件的死条目。
	{ name: "about", entry: "web/src/about/entry.ts" },
	{ name: "access", entry: "web/src/access/entry.ts" },
	{ name: "exception", entry: "web/src/exception/entry.ts" },
	{ name: "outside", entry: "web/src/outside/entry.ts" },
	{ name: "route-nest", entry: "web/src/route-nest/entry.ts" },
	// #endregion demo-only
];

export default {
	/** 产物 URL 前缀，留空表示同源相对路径 */
	baseUrl: "",
	modules: allModules,
};
