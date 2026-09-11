import antfu from "@antfu/eslint-config";

/**
 * P2.4 卡口：runtime 是框架产物，必须单向被模块依赖，不得反向 import 业务模块。
 *
 * 为什么不用 `no-restricted-imports`：该规则底层用 minimatch 匹配，而 minimatch 默认把
 * 以 `#` 开头的 pattern 当成「注释」直接忽略，导致 `#web` / `#web/**` 永远匹配不到
 * （已实测：`react` 能匹配，`#web/**` 匹配不到）。因此这里用一条本地自定义规则，
 * 直接对 import / export / 动态 import() 的 source 做前缀判断，覆盖所有形态。
 *
 * 仅对 `packages/runtime/src/**` 生效（模块工程仍可正常使用 #web）。
 */
const noWebInRuntime = {
	meta: {
		type: "problem",
		docs: {
			description: "禁止 runtime 源码反向依赖业务模块（#web）",
		},
		schema: [],
		messages: {
			restricted: "runtime 不得反向依赖业务模块（#web）。请改用框架内置组件或通过 defineModule 契约解耦。",
		},
	},
	create(context) {
		function check(node, source) {
			if (typeof source === "string" && source.startsWith("#web")) {
				context.report({ node, messageId: "restricted" });
			}
		}

		return {
			ImportDeclaration(node) {
				check(node, node.source.value);
			},
			ExportNamedDeclaration(node) {
				if (node.source)
					check(node, node.source.value);
			},
			ExportAllDeclaration(node) {
				check(node, node.source.value);
			},
			ImportExpression(node) {
				if (node.source.type === "Literal")
					check(node, node.source.value);
			},
		};
	},
};

const runtimeNoModulesGuard = {
	files: ["packages/runtime/src/**/*"],
	plugins: {
		"runtime-guard": {
			rules: { "no-web-in-runtime": noWebInRuntime },
		},
	},
	rules: {
		"runtime-guard/no-web-in-runtime": "error",
	},
};

export default antfu({
	react: true,
	markdown: false,
	ignores: [
		// ojm api 生成物（banner 注明勿手改），不参与 lint——
		// yaml/json 经 eslint 重排版会导致 --check 永久误报 artifact-stale
		"**/client/api.ts",
		"**/client/api.schemas.ts",
		"**/openapi.yaml",
		"**/routes.json",
		// P1：宿主预构建产物并入 cli 后目录名为 shell-dist（不叫 dist，
		// 不在 antfu 默认忽略内）。生成资产绝不能被 eslint --fix 改写
		"**/shell-dist/**",
		// playground 工程里由 `ojm vendor/init` 联网落盘的 oj 二进制与 devkit
		// （未入库，由 apps/*/.gitignore 忽略；eslint 只读根 .gitignore，需显式排除）
		"apps/*/bin/**",
	],
	rules: {
		"style/quotes": ["error", "double"],
		"style/semi": ["error", "always"],
		"style/indent": ["error", "tab"],
		"jsonc/indent": ["error", "tab"],
		"style/no-tabs": "off",
		"style/jsx-indent-props": ["error", "tab"],
		"react-hooks/exhaustive-deps": "off",
	},
}, runtimeNoModulesGuard, {
	// cli package.json 的 `files` 数组顺序有语义：npm 按出现顺序应用模式，
	// **后者优先**，故取反模式 `!shell-dist/**/*.map` 必须排在 `shell-dist` 之后
	// 才能生效（P5 实测：排在前面时 117 个 sourcemap 照发）。sort-array-values
	// 会强制按字典序把它排到最前，与语义冲突，这里关掉该文件的排序检查。
	files: ["packages/cli/package.json"],
	rules: {
		"jsonc/sort-array-values": "off",
	},
});
