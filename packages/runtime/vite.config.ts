import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupSVG, isEmptyColor, parseColors, runSVGO, SVG } from "@iconify/tools";
import tailwindcss from "@tailwindcss/vite";
import dayjs from "dayjs";
import { FileSystemIconLoader } from "unplugin-icons/loaders";
import Icons from "unplugin-icons/vite";
import { defineConfig, loadEnv } from "vite";

import { license, name, version } from "./package.json";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * 构建期注入的应用元信息（A26）。
 *
 * 与根 vite.config.ts 同源但取 runtime 包自身字段：runtime 产物要作为 npm 包
 * 分发到外部模块工程，不可能依赖使用方的 vite define，必须自包含。
 * 刻意不注入 dependencies 清单 —— 那等于把工具链构成公开给攻击者（P6.5 教训）。
 */
const APP_INFO = {
	// runtime 包未声明 author；dependencies 也刻意不注入（P6.5 教训：
	// 注入依赖清单等于把工具链构成公开给攻击者）。此处字段少于 AppInfo
	// 是刻意的——消费方只应经 getAppInfo() 读取，缺字段走空态即可。
	pkg: { name, version, license },
	lastBuildTime: dayjs(new Date()).format("YYYY-MM-DD HH:mm:ss"),
};

export default defineConfig({
	resolve: {
		alias: {
			// `#src/*` 必须在构建期内联（P3.1 修复：此前经 package.json imports
			// 字段解析时好时坏，产物残留 `from "#src/..."` 外部导入，浏览器无映射会崩）
			"#src": path.join(DIR, "src"),
		},
	},
	plugins: [
		// 偏差 3（layout e2e 暴露）：lib 构建必须自带 tailwind 管线，否则
		// index.tsx 的 `import "./styles/index.css"` 被静默丢弃，宿主链路
		// （shell/外部模块工程）没有布局工具类。产物 CSS 由 scripts/inline-css.mjs
		// 内联回 runtime.js（style 注入），保证 import 即得完整样式。
		tailwindcss(),
		// P3.1：出口新增 icons，`~icons/*` 为裸说明符，必须构建期内联，
		// 否则会成为外部导入（宿主 importmap 无法提供）。配置与根
		// vite.config.ts 的 Icons 块保持一致（P4 SHARED_DEPS 时收敛为共享）。
		Icons({
			customCollections: {
				svg: FileSystemIconLoader(path.join(DIR, "src/icons/svg")),
			},
			/**
			 * @see https://iconify.design/docs/articles/cleaning-up-icons/#parsing-one-monotone-icon
			 * Cleaning up icons
			 * Set default color to currentColor
			 * Set default width and height to 1em
			 */
			transform: (svg, collection) => {
				if (collection === "svg") {
					const svgObject = new SVG(svg);
					cleanupSVG(svgObject);
					runSVGO(svgObject);
					parseColors(svgObject, {
						defaultColor: "currentColor",
						callback: (attr, colorStr, color) => {
							if (!color) {
								// Color cannot be parsed!
								throw new Error(`Invalid color: "${colorStr}" in attribute ${attr}`);
							}

							if (isEmptyColor(color)) {
								// Color is empty: 'none' or 'transparent'. Return as is
								return color;
							}

							// If color is not empty, return it
							return color;
						},
					});
					return svgObject.toString({ height: "1em", width: "1em" });
				}
				return svg;
			},
			compiler: "jsx",
			jsx: "react",
			scale: 1,
		}),
	],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		sourcemap: false,
		// 首屏传输治理（2026-11-04）：runtime.js 是每个宿主工程都要下载的单份产物，
		// 不压缩 = 白付约 20% gzip（277→221KB）。lib 模式下 vite 只在显式开启时压缩，
		// 且这里开的是**全量**压缩（含标识符）——本包不发 sourcemap，产物本就不可断点，
		// 换传输体积更划算。导出面判定走 es-module-lexer，压缩不影响门禁。
		minify: true,
		// 偏差 3：单入口 lib 构建，CSS 统一产出 runtime.css（随后由
		// scripts/inline-css.mjs 内联回 runtime.js）
		cssCodeSplit: false,
		// 注意：0 = 任何 url() 资产（字体/图片）都会成为 dist 外部文件，
		// 内联后的 CSS 引用 ./assets/* 在 importmap 宿主中无法解析——当前
		// 产物无外部 url() 引用（契约测试守护），若未来引入资产需改高内联限
		assetsInlineLimit: 0,
		lib: {
			entry: path.join(DIR, "src/index.ts"),
			formats: ["es"],
			fileName: () => "runtime.js",
		},
		rolldownOptions: {
			// 所有裸说明符都交给宿主的 importmap 解析。
			// 相对路径 / 绝对路径才是框架自身代码，需要打进产物。
			// 例外：`#src/*` 与 `~icons/*` 由上方 alias / Icons 插件构建期内联；
			// `zod` 同样内联（AC-D15：不进 importmap，随 runtime dist 走，模块经
			// runtime re-export 的 `z` 写契约 schema，保证单实例与同源钉版）。
			external: (id: string) =>
				!id.startsWith(".")
				&& !path.isAbsolute(id)
				&& !id.startsWith("#src/")
				&& !id.startsWith("~icons/")
				&& id !== "zod",
			output: { codeSplitting: false },
		},
	},
	// Spike A 坑 2：lib 模式不替换 process.env.NODE_ENV，
	// 产物跑在浏览器会抛 process is not defined（风险 R15）
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
		// 同一个坑的第三处（同族 A26）：runtime 在 packages/runtime 下独立构建，
		// vite 仅从自己的 root 加载 .env，仓库根 `.env` 的 VITE_* 全部不生效。
		// 于是产物里 `import.meta.env.VITE_BASE_HOME_PATH` 等是 undefined，发布到宿主
		// （shell）/ 外部模块工程后：
		//   · VITE_BASE_HOME_PATH 缺失 → tabbar 的 insertBeforeTab(undefined) 在 effect 里
		//     读 `undefined.length` 崩溃（React Router 默认 ErrorBoundary → 整页白屏）；
		//   · VITE_API_BASE_URL / VITE_GLOB_APP_TITLE 等同样带着 undefined 发布。
		// runtime 是要当 npm 包分发的，必须自带这些构建期全局（与已处理的
		// VITE_APP_NAMESPACE / __APP_INFO__ 同族）。这里显式把仓库根 `.env` 的 VITE_*
		// 全部注入产物，使预构建 runtime.js 自包含——宿主/外部工程无需再各自 define。
		// 注意：只取基础 `.env`（不取 `.env.production`），避免把 VITE_ROUTER_MODE=hash
		// 等生产专属值烤进会被 dev 宿主复用的同一份 dist。
		...Object.fromEntries(
			Object.entries(loadEnv("", path.join(DIR, "..", ".."), "VITE_")).map(
				([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)],
			),
		),
		// runtime 包未声明 author；dependencies 也刻意不注入（P6.5 教训：
		// 注入依赖清单等于把工具链构成公开给攻击者）。此处字段少于 AppInfo
		// 是刻意的——消费方只应经 getAppInfo() 读取，缺字段走空态即可。
		"__APP_INFO__": JSON.stringify(APP_INFO),
	},
});
