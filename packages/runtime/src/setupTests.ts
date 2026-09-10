// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)

import { vi } from "vitest";

/**
 * @see https://github.com/testing-library/jest-dom?tab=readme-ov-file#with-vitest
 */
import "@testing-library/jest-dom/vitest";

/**
 * nprogress 是 DOM-only 库：其 trickle 内部定时器若在测试环境（happy-dom）
 * 销毁后触发，会抛 "ReferenceError: document is not defined"（unhandled
 * error，fullscreen-layout 渲染 rootRoute loader → NProgress.start() 场景
 * 实测）。进度条视觉行为不在单测覆盖范围，测试统一以 no-op 桩替代。
 */
vi.mock("nprogress", () => {
	const stub = {
		configure: vi.fn(),
		start: vi.fn(),
		done: vi.fn(),
		remove: vi.fn(),
		inc: vi.fn(),
		set: vi.fn(),
		isStarted: vi.fn(() => false),
		status: null,
	};
	return { default: stub, NProgress: stub };
});
