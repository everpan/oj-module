import { createHash } from "node:crypto";

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
	/**
	 * 模块自打包：宿主 shell 不预构建该资产、importmap 不列该键，模块若 import 它
	 * 则自行打包进模块产物（设计文档 §4.3 的「软共享缺席→模块自带副本兜底」语义）。
	 * 用于**仅模块使用、宿主与共享 chunk 永不 import**的重型依赖（编辑器 / 图表 /
	 * Markdown），避免把它们 5~6MB 的体量无谓铺进 shell-dist 并要求公开链路多传
	 * 一堆文件。宿主侧有真实 import 的共享依赖（antd / pro-components / icons 内部
	 * 依赖的 motion / react-jss / dayjs / zustand / @dnd-kit 等）绝不能标 bundle ——
	 * 否则会被 antd 等共享 chunk 经 importmap 解析不到而 404。判定依据：宿主
	 * host.tsx + runtime.js 的传递 import 图，以及 antd/pro-components/icons 的
	 * 传递依赖图，都不含这些说明符。
	 *
	 * ⚠️ 本档位**不计入宿主版本一致性保障**：模块把副本打进产物，多副本不会报错，
	 * 只会重复体积。体积怎么控，见 docs/devkit/manual.md §2.6。
	 */
	bundle?: boolean
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
	{ specifier: "@oj-module/runtime", asset: "runtime", hard: true },
	// 契约主入口（含 zod re-export）。并入 runtime 子路径后仍单独成资产：
	// 浏览器侧生成的 client 不 import 它（只 import 下方 zod-free 出口），
	// 但模块运行期若 import 契约入口，缺条目会产出无法解析的裸说明符。
	{ specifier: "@oj-module/runtime/contract", asset: "contract", hard: true },
	// zod-free 子路径出口（评审 F3）：生成 client 浏览器侧只 import
	// ContractApiError/ScopedRequestLike，instanceof 要求宿主与模块单实例 →
	// 硬共享；zod 不随该资产（AC-D15 零成本承诺）
	{ specifier: "@oj-module/runtime/contract/errors", asset: "contract-errors", hard: true },
	// 首方共享 UI 包（M1 T7）：登录/注册/profile 组件，模块与宿主命中同一份
	// 组件实现（单例语义与 React context 同级——多副本会产生两份 antd 上下文树）
	{ specifier: "@plane/kit", asset: "kit", hard: true },
	// —— 软共享 ——
	/**
	 * 首方共享编辑器包（M3 G1）：RichText / LiteText / Document 三种**非协作**
	 * 编辑器，自包含 ESM 资产（除 React 家族外零裸说明符）+ 样式自注入。
	 *
	 * 为什么是软共享（与 @plane/kit 的 hard: true 不同）：
	 *   - 无单例语义。kit 必须唯一是因为多副本 = 两份 antd 上下文树；编辑器资产
	 *     把 @tiptap/*、@plane/ui 等**全部内联**在自身里，跨边界穿过的只有 React
	 *     家族（那是独立的硬共享条目），多一份编辑器副本不会拆散任何 context。
	 *   - 不是每个模块都用编辑器。软共享的语义是「允许缺席」——宿主**不预构建**
	 *     这份资产（bundle: true，不进 shell-dist、不进 importmap），模块 import 它
	 *     就自己打进产物。代价是每个用编辑器的模块各带一份约 5.4 MB，换来宿主
	 *     分发体积不被没人用的重型依赖撑大。
	 */
	{ specifier: "@plane/editor", asset: "editor", hard: false, bundle: true },
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
	// echarts 家族：模块自打包。整包 index（`import * as echarts from "echarts"`）会让
	// 单个模块产物从 ~180KB 涨到 1.7MB（实测 echarts 918KB + zrender 221KB 占 87%），
	// 故脚手架改用 `echarts/core` 按需注册；接入方写法见 docs/devkit/manual.md §2.6。
	{ specifier: "echarts", asset: "echarts", hard: false, bundle: true },
	{ specifier: "echarts/charts", asset: "echarts-charts", hard: false, bundle: true },
	{ specifier: "echarts/features.js", asset: "echarts-features", hard: false, bundle: true },
	{ specifier: "echarts-for-react", asset: "echarts-for-react", hard: false, bundle: true },
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
	// react-countup 只有 CJS 入口（main: build），其 require("react") 在模块自打包时会退化成
	// 浏览器不可用的 require 桩 → 必须走宿主共享资产（shell 侧有 CJS→ESM 垫片）
	{ specifier: "react-countup", asset: "react-countup", hard: false },
	{ specifier: "simplebar-react", asset: "simplebar-react", hard: false },
	{ specifier: "spin-delay", asset: "spin-delay", hard: false },
	{ specifier: "tailwind-merge", asset: "tailwind-merge", hard: false },
	/**
	 * Markdown 编辑器（Vditor v4，M5 回升自下游 oj-wiki）：npm 包是 webpack **UMD**
	 * 单产物（main=dist/index.js，无 ESM 出口、仅 default 导出）。bundle: true 表示
	 * 宿主不预构建 —— CJS/UMD interop 交给模块自己的 rolldown 打包链路处理。
	 *
	 * 为什么不预构建：体积大（gzip ≈700 KiB）且不是每个模块都用。宿主为它留一份
	 * /assets/vditor.js，等于给所有站点无条件加 700 KiB 分发体积，而只有编辑器页
	 * 才用得上。改由模块自带后，代价转给「真正 import 它的那个模块」。
	 *
	 * 副作用（写文档时容易说错）：模块产物是单文件（codeSplitting: false），
	 * 所以 `import("vditor")` 会被内联回去，**动态导入并不能把它从首屏摘掉**；
	 * 要省这笔体积只能把编辑器页拆成独立模块/方案。
	 *
	 * 深路径只登记 CSS 主样式（nprogress 同款样式垫片）。vditor 其余 dist 深路径
	 * （lute / i18n / icons / 主题 CSS…）是**运行期经 cdn 选项按需拉取的资源**而非
	 * import 说明符，由模块侧自行处理（自注入或指向宿主可服务的路径）；若模块代码
	 * 直接 import 它们，会命中前缀 external 但无共享表键 → 构建期深路径报错，
	 * 属预期拦截（与 dayjs/plugin/* 同规则）。
	 */
	{ specifier: "vditor", asset: "vditor", hard: false, bundle: true },
	{ specifier: "vditor/dist/index.css", asset: "vditor-index-css", hard: false, bundle: true },
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
		.filter(dep => dep.asset && !dep.bundle && dep.specifier !== "@oj-module/runtime")
		.map(dep => ({ name: dep.asset!, pkg: dep.specifier }));
}

/**
 * 由共享表生成 importmap：说明符 → /assets/<asset>.js。
 * baseUrl 供宿主部署在子路径时使用。
 *
 * 注意：这里给出的是**逻辑名**。shell 构建落盘时会把每个资产改名成
 * `<asset>.<hash>.js`（见 `hashedAssetFileName`），importmap 由构建脚本同步改写，
 * 运行时拿到的仍是 `/assets/<asset>.<hash>.js`。
 */
export function generateImportmap(baseUrl = ""): Record<string, string> {
	const map: Record<string, string> = {};
	for (const dep of SHARED_DEPS) {
		if (dep.asset && !dep.bundle) {
			map[dep.specifier] = `${baseUrl}/assets/${dep.asset}.js`;
		}
	}
	return map;
}

export function isPrebuiltDep(id: string): boolean {
	return SHARED_DEPS.some(dep => !dep.bundle && (id === dep.specifier || id.startsWith(`${dep.specifier}/`)));
}

/**
 * 共享资产的内容哈希段：10 位 base36，且**保证**同时含数字与字母。
 *
 * 为什么必须保证：oj serve ≥ 0.1.116 的默认缓存策略按**文件名**判定
 * （`serve/src/static_files.rs::default_cache_control`）——文件名 stem 按 `-` `_` `.`
 * 切段，末段 ≥8 位且同时含数字与字母才发 `public, max-age=31536000, immutable`，
 * 其余一律 `no-cache`。纯 base36 有十万分之一量级会全数字（vite 的 base64url 更糟：
 * 8 位全字母约 19%），漏判就白丢一年缓存。这里按「缺哪类补哪类」定长补齐，
 * 让每个资产 100% 命中长缓存，而不是赌概率。
 *
 * 9 位 base36 ≈ 46.5 bit，65 个资产量级碰撞概率可忽略。
 */
export function assetHash(content: string | Uint8Array): string {
	const digest = createHash("sha256").update(content).digest();
	const body = digest.readBigUInt64BE(0).toString(36).slice(0, 9).padStart(9, "0");
	// 已有字母 → 补数字；全数字 → 补字母。两类必在其一，补齐另一类即可。
	return /[a-z]/.test(body) ? `${body}0` : `${body}z`;
}

/** 内容寻址文件名：`<base>.<hash>.js`（js 与 map 同为 .js 后缀，map 保持原名不动） */
export function hashedAssetFileName(base: string, content: string | Uint8Array): string {
	return `${base}.${assetHash(content)}.js`;
}

/**
 * 与 oj serve 的 `default_cache_control` 同口径：末段 ≥8 位且数字字母都有 → 可发 immutable。
 * 构建期用它断言产物名，避免哪天哈希算法换掉后长缓存静默失效。
 */
export function isImmutableAssetFileName(fileName: string): boolean {
	const stem = fileName.replace(/\.[^.]*$/, "");
	const seg = stem.split(/[-_.]/).pop() ?? "";
	return seg.length >= 8 && /\d/.test(seg) && /[a-z]/i.test(seg);
}
