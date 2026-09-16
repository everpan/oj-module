import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * @plane/kit：lib 构建对齐 runtime 惯例。
 *
 * 所有裸说明符（react / antd …）external，交给宿主 importmap 解析（单例，D5）；
 * 宿主 shell 预构建时经 SHARED_DEPS 的 kit 条目打成 assets/kit.js。
 * 零 CSS 资产（组件只用 antd 语义 token，无样式文件），无需 inline-css 步骤。
 */
export default defineConfig({
	build: {
		outDir: "dist",
		emptyOutDir: true,
		sourcemap: false,
		minify: false,
		lib: {
			entry: path.join(DIR, "src/index.ts"),
			formats: ["es"],
			fileName: () => "kit.js",
		},
		rolldownOptions: {
			// 与 runtime 同规则：裸说明符全 external（宿主 importmap 提供），
			// 相对/绝对路径才是包自身代码
			external: (id: string) => !id.startsWith(".") && !path.isAbsolute(id),
			output: { codeSplitting: false },
		},
	},
	// Spike A 坑 2（runtime 同族）：lib 模式不替换 process.env.NODE_ENV，
	// 产物跑在浏览器会抛 process is not defined（风险 R15）
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
});
