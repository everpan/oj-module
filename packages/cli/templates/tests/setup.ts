// jsdom 补全：antd 的响应式栅格 / 断点钩子依赖 matchMedia / ResizeObserver /
// IntersectionObserver，jsdom 默认不实现，会抛 "xxx is not a function"。
// 仅在浏览器环境（jsdom）下打补，node 环境（后端 spec）不触碰 window。
import { vi } from "vitest";

if (typeof window !== "undefined") {
	const noop = vi.fn();
	if (!window.matchMedia) {
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: noop,
			removeListener: noop,
			addEventListener: noop,
			removeEventListener: noop,
			dispatchEvent: noop,
		})) as unknown as typeof window.matchMedia;
	}
	if (!("ResizeObserver" in window)) {
		(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}
	if (!("IntersectionObserver" in window)) {
		(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		};
	}
}
