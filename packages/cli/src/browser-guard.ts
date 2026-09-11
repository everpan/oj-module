/**
 * cli 是 **Node 工具链包**：包入口与 `build` / `shared-deps` / `esm-exports` /
 * `config` / `manifest` / `info` 等子路径都依赖 Node 内置模块与 vite/esbuild，
 * 浏览器侧代码**不得** import（设计 §7 R6「exports 硬分区」）。
 *
 * `package.json#exports` 为这些子路径挂了 `browser` 条件指向本模块：一旦被浏览器
 * 打包，就从「静默拖入 Node 依赖、报一堆 builtin 解析错」变成**一条明确的报错**。
 * Node 解析不使用 `browser` 条件，故 CLI 自身、构建脚本与测试均不受影响。
 */
throw new Error(
	"[ojm] @oj-module/cli 是 Node 工具链包，不能在浏览器代码中 import。"
	+ "模块工程请只 import \"@oj-module/runtime\" 与共享依赖（见框架开发手册第 3 章）。",
);

export {};
