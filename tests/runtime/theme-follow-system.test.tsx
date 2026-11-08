import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePreferences } from "#src/hooks/use-preferences";
import { usePreferencesStore } from "#src/store/preferences";

vi.hoisted(() => {
	// happy-dom 的 localStorage 缺 setItem，preferences persist 在 setState 时会写库
	const mem = new Map<string, string>();
	(globalThis as Record<string, unknown>).localStorage = {
		getItem: (k: string) => mem.get(k) ?? null,
		setItem: (k: string, v: string) => void mem.set(k, String(v)),
		removeItem: (k: string) => void mem.delete(k),
		clear: () => mem.clear(),
		key: () => null,
		get length() { return mem.size; },
	};
});

/**
 * auto 主题必须真的「跟随系统」：系统/浏览器切深色时，usePreferences 的 isDark
 * 要跟着翻转（否则工作台里切换系统主题，站点壳仍停在旧色）。
 */

type Listener = (event: MediaQueryListEvent) => void;

let listeners: Listener[] = [];
let systemDark = false;

function emitSystemDark(next: boolean) {
	systemDark = next;
	for (const cb of [...listeners])
		cb({ matches: next } as MediaQueryListEvent);
}

function Probe() {
	const { isDark, isLight } = usePreferences();
	return <span data-testid="probe">{isDark ? "dark" : isLight ? "light" : "?"}</span>;
}

beforeEach(() => {
	listeners = [];
	systemDark = false;
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes("dark") ? systemDark : false,
			media: query,
			onchange: null,
			addEventListener: (_type: string, cb: Listener) => listeners.push(cb),
			removeEventListener: (_type: string, cb: Listener) => {
				listeners = listeners.filter(x => x !== cb);
			},
			addListener: (cb: Listener) => listeners.push(cb),
			removeListener: (cb: Listener) => {
				listeners = listeners.filter(x => x !== cb);
			},
			dispatchEvent: () => false,
		}),
	});
});

afterEach(() => {
	cleanup();
	usePreferencesStore.setState({ theme: "auto" });
});

describe("主题跟随系统（prefers-color-scheme）", () => {
	it("given 主题=auto 且系统为深色 When 首次渲染 Then isDark=true", () => {
		systemDark = true;
		usePreferencesStore.setState({ theme: "auto" });
		render(<Probe />);
		expect(screen.getByTestId("probe").textContent).toBe("dark");
	});

	it("given 主题=auto When 系统在运行中切换深/浅色 Then 立即跟随（无需刷新）", () => {
		usePreferencesStore.setState({ theme: "auto" });
		render(<Probe />);
		expect(screen.getByTestId("probe").textContent).toBe("light");

		act(() => emitSystemDark(true));
		expect(screen.getByTestId("probe").textContent).toBe("dark");

		act(() => emitSystemDark(false));
		expect(screen.getByTestId("probe").textContent).toBe("light");
	});

	it("given 旧版持久化 theme=light（version=0）When 水合 Then 一次性归位 auto", async () => {
		const name = usePreferencesStore.persist.getOptions().name!;
		// 先造“旧版本留下的 version=0”，再水合（setState 会以当前 version=1 回写存储）
		usePreferencesStore.setState({ theme: "light" });
		localStorage.setItem(name, JSON.stringify({ state: { theme: "light" }, version: 0 }));

		await act(async () => {
			await usePreferencesStore.persist.rehydrate();
		});

		expect(usePreferencesStore.getState().theme).toBe("auto");
	});

	it("given 用户显式选 light/dark When 系统切换 Then 不被系统覆盖", () => {
		usePreferencesStore.setState({ theme: "light" });
		render(<Probe />);
		act(() => emitSystemDark(true));
		expect(screen.getByTestId("probe").textContent).toBe("light");

		act(() => usePreferencesStore.setState({ theme: "dark" }));
		systemDark = false;
		expect(screen.getByTestId("probe").textContent).toBe("dark");
	});
});
