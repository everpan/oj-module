import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// core 是纯逻辑 lib：无 css / 无 icons / 无 define 烤制（PRD §4 事件化③——
// import.meta.env.DEV 不进 core，dev 旗标由宿主 bootstrap 时注入，跨 dev/prod 同 tgz）。
// 全部裸说明符（react / react-router / i18next / ky 类型）交给宿主 importmap 解析。
export default defineConfig({
	build: {
		outDir: "dist",
		emptyOutDir: true,
		sourcemap: false,
		minify: false,
		lib: {
			entry: path.join(DIR, "src/index.ts"),
			formats: ["es"],
			fileName: () => "core.js",
		},
		rolldownOptions: {
			external: id => !id.startsWith(".") && !path.isAbsolute(id),
			output: { codeSplitting: false },
		},
	},
});
