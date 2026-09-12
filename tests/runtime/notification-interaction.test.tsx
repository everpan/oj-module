import type { NotificationsApiProvider } from "#src/store/api-provider";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchNotifications } from "#src/api/notifications";
import { JSSThemeProvider } from "#src/components/jss-theme-provider";
import { NotificationContainer } from "#src/layout/widgets/notification/notification-container";
import {
	registerNotificationsApiProvider,
	unregisterApiProviders,
} from "#src/store/api-provider";

// 通知互动接线（G4，BDD 5.3）：provider 四方法全必填，container 接 onEventChange，
// 未注册/缺写方法降级只读。§5.3#8（契约 zod 守护）属模板侧，不在此测。
vi.mock("#src/api/notifications", () => ({
	fetchNotifications: vi.fn(),
}));

const fetchMock = vi.mocked(fetchNotifications);

function item(id: string | number, isRead = false) {
	return { id, avatar: "", date: "2026-09-12", isRead, message: `m${id}`, title: `t${id}` };
}

function fullProvider(overrides: Partial<NotificationsApiProvider> = {}): NotificationsApiProvider {
	return {
		fetchNotifications: vi.fn().mockResolvedValue([item("1")]),
		markRead: vi.fn().mockResolvedValue(undefined),
		markAllRead: vi.fn().mockResolvedValue(undefined),
		clearAll: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

beforeAll(() => {
	if (!("ResizeObserver" in globalThis)) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
			dispatchEvent() {
				return false;
			},
		})) as unknown as typeof window.matchMedia;
	}
});

beforeEach(() => {
	fetchMock.mockResolvedValue([item("1")]);
});

afterEach(() => {
	cleanup();
	unregisterApiProviders("notif");
	fetchMock.mockReset();
});

/** 打开弹层并返回其 DOM；按钮序：[0] 全部已读（头部），[1] 清空，[2] 查看全部（底部） */
async function openPopup() {
	// 生产环境弹层渲染在 ContainerLayout 自供的 JSSThemeProvider 内，测试手动复刻该接线
	const utils = render(
		<ConfigProvider>
			<JSSThemeProvider>
				<NotificationContainer />
			</JSSThemeProvider>
		</ConfigProvider>,
	);
	await waitFor(() => expect(fetchMock).toHaveBeenCalled());
	const bell = utils.baseElement.querySelector("button");
	fireEvent.click(bell!);
	const popover = await waitFor(() => {
		const el = utils.baseElement.querySelector(".ant-popover");
		expect(el).toBeTruthy();
		return el!;
	});
	return { ...utils, popover };
}

describe("通知互动接线（G4，BDD 5.3）", () => {
	it("5.3#1 点「全部已读」：调 markAllRead 并重拉", async () => {
		const p = fullProvider();
		registerNotificationsApiProvider("notif", p);
		const { popover, baseElement } = await openPopup();
		fireEvent.click(popover.querySelectorAll("button")[0]!);
		await waitFor(() => expect(p.markAllRead).toHaveBeenCalled());
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(baseElement.querySelectorAll(".ant-list-item").length).toBeGreaterThan(0);
	});

	it("5.3#2 点单条通知：调 markRead(item.id)", async () => {
		const p = fullProvider();
		registerNotificationsApiProvider("notif", p);
		fetchMock.mockResolvedValue([item("a"), item("b")]);
		const { popover } = await openPopup();
		fireEvent.click(popover.querySelectorAll(".ant-list-item")[1]!);
		await waitFor(() => expect(p.markRead).toHaveBeenCalledWith("b"));
	});

	it("5.3#3 点「清空」：调 clearAll 并重拉", async () => {
		const p = fullProvider();
		registerNotificationsApiProvider("notif", p);
		const { popover } = await openPopup();
		fireEvent.click(popover.querySelectorAll("button")[1]!);
		await waitFor(() => expect(p.clearAll).toHaveBeenCalled());
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});

	it("5.3#4 未注册 provider：互动按钮禁用、单条点击 no-op", async () => {
		const { popover } = await openPopup();
		const buttons = popover.querySelectorAll("button");
		expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
		expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(popover.querySelectorAll(".ant-list-item")[0]!);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("5.3#5 provider 写方法 reject：列表保持原状不崩溃", async () => {
		const p = fullProvider({ markAllRead: vi.fn().mockRejectedValue(new Error("boom")) });
		registerNotificationsApiProvider("notif", p);
		const { popover } = await openPopup();
		fireEvent.click(popover.querySelectorAll("button")[0]!);
		await waitFor(() => expect(p.markAllRead).toHaveBeenCalled());
		expect(popover.querySelectorAll(".ant-list-item")).toHaveLength(1);
	});

	it("5.3#6 provider 缺写方法（老 bundle 漂移）：warn 一次 + 降级只读", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const stale = { fetchNotifications: vi.fn().mockResolvedValue([item("1")]) } as unknown as NotificationsApiProvider;
		registerNotificationsApiProvider("notif", stale);
		const { popover } = await openPopup();
		expect(warn).toHaveBeenCalledOnce();
		const buttons = popover.querySelectorAll("button");
		expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(popover.querySelectorAll(".ant-list-item")[0]!);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it("5.3#7 互动成功但重拉失败：现有列表保持不清空", async () => {
		const p = fullProvider();
		registerNotificationsApiProvider("notif", p);
		const { popover } = await openPopup();
		fetchMock.mockRejectedValueOnce(new Error("reload boom"));
		fireEvent.click(popover.querySelectorAll("button")[0]!);
		await waitFor(() => expect(p.markAllRead).toHaveBeenCalled());
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(popover.querySelectorAll(".ant-list-item")).toHaveLength(1);
	});
});
