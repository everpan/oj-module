/**
 * 共享依赖表 —— 单一常量源（设计文档 §4.3，解决 B11 / B12）。
 *
 * importmap、shell 预构建入口、`external` 列表、CLI 的版本校验
 * 全部由这张表生成（P4.1）；任何一侧手写清单都必然漂移
 * （B11 实锤：手写 importmap 15 项 vs runtime 产物裸导入 24+ 包）。
 *
 * 硬共享（hard）：破坏即崩溃（React 单例、Context 单例），
 * 宿主 importmap 必须提供、模块不得自带（C4：仅 devDependencies 且版本严格相等）。
 * 软共享：默认也由宿主提供，允许 importmap scopes 多版本共存兜底（C7）。
 *
 * 条目粒度 = importmap 键 = 实际裸说明符（importmap 无前缀通配，
 * `motion/react`、`zustand/shallow` 等深路径必须单独成条）。
 * runtime 产物新增导入时，tests/shared-deps.test.ts 的防漂移断言先红。
 */
export interface SharedDepEntry {
	/** importmap 键 & 包名（深路径如实列出） */
	specifier: string
	/** shell 预构建产物名（不含扩展名）；runtime 由 shell 拷贝 dist，不在此列 */
	asset?: string
	/** 硬共享：模块不得自带 */
	hard: boolean
}

export const SHARED_DEPS: SharedDepEntry[] = [
	// —— 硬共享 ——
	{ specifier: "react", asset: "react", hard: true },
	{ specifier: "react/jsx-runtime", asset: "jsx-runtime", hard: true },
	{ specifier: "react/jsx-dev-runtime", asset: "jsx-dev-runtime", hard: true },
	{ specifier: "react-dom", asset: "react-dom", hard: true },
	{ specifier: "react-dom/client", asset: "react-dom-client", hard: true },
	{ specifier: "react-router", asset: "react-router", hard: true },
	{ specifier: "react-router/dom", asset: "react-router-dom", hard: true },
	{ specifier: "@tanstack/react-query", asset: "react-query", hard: true },
	// runtime 由 shell 直接拷贝其 dist/runtime.js
	{ specifier: "@react-antd-module/runtime", asset: "runtime", hard: true },
	// 契约主入口（含 zod re-export）。并入 runtime 子路径后仍单独成资产：
	// 浏览器侧生成的 client 不 import 它（只 import 下方 zod-free 出口），
	// 但模块运行期若 import 契约入口，缺条目会产出无法解析的裸说明符。
	{ specifier: "@react-antd-module/runtime/contract", asset: "contract", hard: true },
	// zod-free 子路径出口（评审 F3）：生成 client 浏览器侧只 import
	// ContractApiError/ScopedRequestLike，instanceof 要求宿主与模块单实例 →
	// 硬共享；zod 不随该资产（AC-D15 零成本承诺）
	{ specifier: "@react-antd-module/runtime/contract/errors", asset: "contract-errors", hard: true },
	// —— 软共享 ——
	// 注：@rc-component/form（antd 6 Form 底层）曾尝试单例化以修 my-profile
	// 崩溃（React #130），假说未证实——多副本并非充分根因，已回退；见
	// docs/prd/202609010056-playground-full-modules-plan.md 差异项 D2。
	{ specifier: "antd", asset: "antd", hard: false },
	{ specifier: "antd/locale/en_US", asset: "antd-locale-en_US", hard: false },
	{ specifier: "antd/locale/zh_CN", asset: "antd-locale-zh_CN", hard: false },
	{ specifier: "antd/es/locale/zh_CN", asset: "antd-es-locale-zh_CN", hard: false },
	{ specifier: "@ant-design/icons", asset: "icons", hard: false },
	/**
	 * antd 用 `import IconContext from "@ant-design/icons/es/components/Context"`
	 * 取图标 Context（向图标注入 prefixCls / csp）。
	 *
	 * 深路径默认走「父包透传」映射（SUBPATH_PARENT_REEXPORTS）指到 icons.js，
	 * 但那条假设只对**具名**导出成立：icons.js 的 default 是整个命名空间，
	 * 于是 `IconContext.Provider` 为 undefined，ConfigProvider 一渲染就
	 * React #130 整页崩（A27）。这里给它独立资产，default 才是真正的 Context。
	 *
	 * 单例不受影响：icons.js 构建时它是共享依赖 → external → 同一份实例，
	 * antd 注入的配置才能传达到图标（与 zustand → zustand/vanilla 同理）。
	 */
	{
		specifier: "@ant-design/icons/es/components/Context",
		asset: "icons-es-components-Context",
		hard: false,
	},
	{ specifier: "@ant-design/cssinjs", asset: "cssinjs", hard: false },
	{ specifier: "@ant-design/pro-components", asset: "pro-components", hard: false },
	{ specifier: "i18next", asset: "i18next", hard: false },
	{ specifier: "react-i18next", asset: "react-i18next", hard: false },
	{ specifier: "zustand", asset: "zustand", hard: false },
	{ specifier: "zustand/middleware", asset: "zustand-middleware", hard: false },
	{ specifier: "zustand/shallow", asset: "zustand-shallow", hard: false },
	{ specifier: "zustand/vanilla", asset: "zustand-vanilla", hard: false },
	{ specifier: "zustand/react", asset: "zustand-react", hard: false },
	{ specifier: "zustand/react/shallow", asset: "zustand-react-shallow", hard: false },
	{ specifier: "zustand/vanilla/shallow", asset: "zustand-vanilla-shallow", hard: false },
	// react-i18next 与 pro-components 各自内嵌一份（CJS），纳入共享表后合为一份。
	// 注意：这是**软**共享且外部模块零直接引用，纳入只为产物去重，不要求外部工程对齐
	{ specifier: "use-sync-external-store/shim", asset: "use-sync-external-store-shim", hard: false },
	{ specifier: "dayjs", asset: "dayjs", hard: false },
	{ specifier: "dayjs/plugin/advancedFormat", asset: "dayjs-plugin-advancedFormat", hard: false },
	{ specifier: "dayjs/plugin/customParseFormat", asset: "dayjs-plugin-customParseFormat", hard: false },
	{ specifier: "dayjs/plugin/isoWeek", asset: "dayjs-plugin-isoWeek", hard: false },
	{ specifier: "dayjs/plugin/localeData", asset: "dayjs-plugin-localeData", hard: false },
	{ specifier: "dayjs/plugin/quarterOfYear", asset: "dayjs-plugin-quarterOfYear", hard: false },
	{ specifier: "dayjs/plugin/relativeTime", asset: "dayjs-plugin-relativeTime", hard: false },
	{ specifier: "dayjs/plugin/weekday", asset: "dayjs-plugin-weekday", hard: false },
	{ specifier: "dayjs/plugin/weekOfYear", asset: "dayjs-plugin-weekOfYear", hard: false },
	{ specifier: "dayjs/plugin/weekYear", asset: "dayjs-plugin-weekYear", hard: false },
	{ specifier: "echarts", asset: "echarts", hard: false },
	{ specifier: "echarts/charts", asset: "echarts-charts", hard: false },
	{ specifier: "echarts/features.js", asset: "echarts-features", hard: false },
	{ specifier: "echarts-for-react", asset: "echarts-for-react", hard: false },
	{ specifier: "motion", asset: "motion", hard: false },
	{ specifier: "motion/react", asset: "motion-react", hard: false },
	{ specifier: "@dnd-kit/core", asset: "dnd-kit-core", hard: false },
	{ specifier: "@dnd-kit/sortable", asset: "dnd-kit-sortable", hard: false },
	{ specifier: "@dnd-kit/utilities", asset: "dnd-kit-utilities", hard: false },
	{ specifier: "ahooks", asset: "ahooks", hard: false },
	{ specifier: "antd-img-crop", asset: "antd-img-crop", hard: false },
	{ specifier: "keepalive-for-react", asset: "keepalive-for-react", hard: false },
	{ specifier: "ky", asset: "ky", hard: false },
	{ specifier: "nprogress", asset: "nprogress", hard: false },
	{ specifier: "nprogress/nprogress.css", asset: "nprogress-css", hard: false },
	{ specifier: "pinyin-pro", asset: "pinyin-pro", hard: false },
	{ specifier: "react-error-boundary", asset: "react-error-boundary", hard: false },
	{ specifier: "react-jss", asset: "react-jss", hard: false },
	{ specifier: "clsx", asset: "clsx", hard: false },
	{ specifier: "react-countup", asset: "react-countup", hard: false },
	{ specifier: "simplebar-react", asset: "simplebar-react", hard: false },
	{ specifier: "spin-delay", asset: "spin-delay", hard: false },
	{ specifier: "tailwind-merge", asset: "tailwind-merge", hard: false },
];

/** 判断一个裸说明符是否命中共享表（命中主包前缀的深路径也按共享处理） */
export function isSharedDep(id: string): boolean {
	return SHARED_DEPS.some(dep => id === dep.specifier || id.startsWith(`${dep.specifier}/`));
}

/**
 * shell 预构建入口清单：全表减去 runtime（其产物由 shell 拷贝）。
 */
export function generateShellEntries(): { name: string, pkg: string }[] {
	return SHARED_DEPS
		.filter(dep => dep.asset && dep.specifier !== "@react-antd-module/runtime")
		.map(dep => ({ name: dep.asset!, pkg: dep.specifier }));
}

/**
 * 由共享表生成 importmap：说明符 → /assets/<asset>.js。
 * baseUrl 供宿主部署在子路径时使用。
 */
export function generateImportmap(baseUrl = ""): Record<string, string> {
	const map: Record<string, string> = {};
	for (const dep of SHARED_DEPS) {
		if (dep.asset) {
			map[dep.specifier] = `${baseUrl}/assets/${dep.asset}.js`;
		}
	}
	return map;
}
