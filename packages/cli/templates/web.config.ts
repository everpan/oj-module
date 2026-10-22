/**
 * 模块工程配置：共享依赖一律不进 dependencies（宿主 importmap 提供），
 * 这里只登记模块清单（entry 相对本工程根）。
 *
 * 布局：`src/<name>/{api,web}`——模块的前后端同处一个目录，`web/entry.ts` 是前端入口、
 * `api/manifest.yaml` 是后端模块标记（两者其一即可成模块；纯共享库目录两边都没有）。
 *
 * 新布局下本清单退化为**可选覆盖**：`ojm build/dev` 以 `src/<name>/web/entry.ts` 扫描结果
 * 为真源（字典序），这里登记的条目按声明顺序排前、其余按扫描顺序追加——忘登记不会漏构建。
 * 登记了不存在的前端入口才报错。
 *
 * 注意：这里的登记顺序只影响模块加载顺序，**不决定侧边栏导航顺序**——
 * 菜单顺序由各模块 entry 路由的 handle.order 决定（≥0 主菜单区升序；
 * <0 底部固定区，pin 在侧边栏底部；同 order 按根 path 字母序）。
 * `home` 必须第一个登记（shell 的 "/" 重定向到它）。
 */
const allModules = [
	// /home 必须是首个模块：shell 的 "/" → VITE_BASE_HOME_PATH（=/home）重定向
	{ name: "home", entry: "src/home/web/entry.ts" },
	// /login 路由由模块提供：shell 宿主不挂 runtime 内置 baseRoutes
	{ name: "login", entry: "src/login/web/entry.ts" },
	// 个人中心：runtime 用户菜单固定导航 /personal-center/my-profile，缺则点击落空
	{ name: "personal-center", entry: "src/personal-center/web/entry.ts" },
	// 通知：onInit 注册 notificationsApi provider（四方法全必填），
	// 通知铃的互动（单条已读/全部已读/清空）由此生效；未登记则永远回落内置只读兜底
	{ name: "notification", entry: "src/notification/web/entry.ts" },
	// 系统管理：用户/成员资格/角色权限/操作日志/站点设置/登录方式（oj 后端 /api/system/*）
	{ name: "system", entry: "src/system/web/entry.ts" },
	// 解决方案市场：第一方能力（消费 _platform 编排面 /api/_platform/market/*，
	// R29：第三方方案不得仿照此调用面），默认随脚手架下发
	{ name: "oj-market", entry: "src/oj-market/web/entry.ts" },
	// #region demo-only
	// 以下为模板内置的演示模块（demo/about/access/exception/outside/route-nest），
	// 用于把 templates 当可运行 demo 直接跑；其文件不在 `ojm init` 的
	// init.include.yaml 白名单里，不拷入新工程，故本区间连同这些条目会被
	// init 一并剥离，脚手架产出的配置不会残留指向缺失文件的死条目。
	//
	// 注意：新布局的清单是「扫描 + 覆盖」并集——注释掉不会让它们消失，
	// 扫描仍会捡到 `src/<name>/web/entry.ts`。要「不构建」必须写 `enabled: false`。
	{ name: "demo", entry: "src/demo/web/entry.ts", enabled: false },
	{ name: "about", entry: "src/about/web/entry.ts", enabled: false },
	{ name: "access", entry: "src/access/web/entry.ts", enabled: false },
	{ name: "exception", entry: "src/exception/web/entry.ts", enabled: false },
	{ name: "outside", entry: "src/outside/web/entry.ts", enabled: false },
	{ name: "route-nest", entry: "src/route-nest/web/entry.ts", enabled: false },
	// #endregion demo-only
];

export default {
	/** 产物 URL 前缀，留空表示同源相对路径 */
	baseUrl: "",
	modules: allModules,
};
