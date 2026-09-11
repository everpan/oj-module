import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 偏差 3（layout e2e header 几何探测暴露，2026-08-31）：
 *
 * runtime 预构建产物未携带自身 CSS——vite lib 构建缺 @tailwindcss/vite 插件，
 * index.tsx 的 `import "./styles/index.css"`（tailwind 工具类 + base/animation/
 * keep-alive 自定义样式）被静默丢弃。app 链路（vite dev/根构建）有根级
 * tailwind 插件兜底看不出来；宿主链路（shell / 外部模块工程经 importmap 消费
 * dist/runtime.js）则完全没有布局工具类——框架 chrome flex 失效、元素纵向
 * 堆叠、header 操作按钮溢出到页签栏带区（视觉崩坏 + 点击被页签元素拦截）。
 *
 * 契约：runtime 产物必须自包含 CSS（style 注入，marker=data-ojm-runtime-css），
 * 任何宿主 import 即得完整样式，不得依赖使用方构建链兜底。
 */
describe("runtime 产物自携带 CSS（宿主链路自包含）", () => {
	const bundle = readFileSync(
		path.join(PROJECT_ROOT, "packages/runtime/dist/runtime.js"),
		"utf-8",
	);

	it("tailwind 工具类随产物内联注入", () => {
		expect(bundle).toContain("data-ojm-runtime-css");
		// 布局 chrome 最基础的工具类必须真实编译进产物（而非 cn() 里的类名字符串）
		expect(bundle).toMatch(/\.flex\s*\{[^}]*display\s*:\s*flex/);
		expect(bundle).toMatch(/\.items-center\s*\{/);
	});

	it("keep-alive / 动画等自定义样式随产物内联注入", () => {
		expect(bundle).toMatch(/\.keepalive-fade\.active\s*\{/);
	});
});
