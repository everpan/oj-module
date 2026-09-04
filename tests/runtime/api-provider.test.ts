import type {
	NotificationsApiProvider,
	SystemApiProvider,
	UploadApiProvider,
} from "#src/store/api-provider";

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNotifications } from "#src/api/notifications";

import {
	fetchAddMenuItem,
	fetchAddRoleItem,
	fetchMenuList,
	fetchRoleList,
} from "#src/api/system/role";
import {
	getNotificationsApiProvider,
	getSystemApiProvider,
	getUploadApiProvider,
	registerNotificationsApiProvider,
	registerSystemApiProvider,
	registerUploadApiProvider,
	unregisterApiProviders,
} from "#src/store/api-provider";

function systemProvider(tag: string): SystemApiProvider {
	return {
		fetchRoleList: vi.fn().mockResolvedValue(`roleList:${tag}`),
		fetchAddRoleItem: vi.fn().mockResolvedValue(`addRole:${tag}`),
		fetchUpdateRoleItem: vi.fn().mockResolvedValue(`updRole:${tag}`),
		fetchDeleteRoleItem: vi.fn().mockResolvedValue(`delRole:${tag}`),
		fetchRoleMenu: vi.fn().mockResolvedValue(`roleMenu:${tag}`),
		fetchMenuByRoleId: vi.fn().mockResolvedValue(`menuByRole:${tag}`),
		fetchMenuList: vi.fn().mockResolvedValue(`menuList:${tag}`),
		fetchAddMenuItem: vi.fn().mockResolvedValue(`addMenu:${tag}`),
		fetchUpdateMenuItem: vi.fn().mockResolvedValue(`updMenu:${tag}`),
		fetchDeleteMenuItem: vi.fn().mockResolvedValue(`delMenu:${tag}`),
	};
}

function notificationsProvider(tag: string): NotificationsApiProvider {
	return {
		fetchNotifications: vi.fn().mockResolvedValue([{ title: `n:${tag}` } as any]),
	};
}

function uploadProvider(tag: string): UploadApiProvider {
	return {
		action: `https://up-${tag}/x`,
		headers: () => ({ authorization: `Bearer ${tag}` }),
	};
}

afterEach(() => {
	// 每个用例用独立 module name，统一复位避免串扰
	unregisterApiProviders("sys");
	unregisterApiProviders("notif");
	unregisterApiProviders("up");
});

describe("system api provider 注册表（D9）", () => {
	it("注册后 getSystemApiProvider 返回 provider", () => {
		const p = systemProvider("a");
		registerSystemApiProvider("sys", p);
		expect(getSystemApiProvider()).toBe(p);
		unregisterApiProviders("sys");
	});

	it("未注册 → 回落内置（返回 undefined）", () => {
		expect(getSystemApiProvider()).toBeUndefined();
	});

	it("先到先得：第二个注册者被忽略并告警", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = systemProvider("first");
		registerSystemApiProvider("sys", first);
		registerSystemApiProvider("sys", systemProvider("second"));
		expect(getSystemApiProvider()).toBe(first);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		unregisterApiProviders("sys");
	});

	it("unregisterApiProviders 复位", () => {
		registerSystemApiProvider("sys", systemProvider("x"));
		unregisterApiProviders("sys");
		expect(getSystemApiProvider()).toBeUndefined();
	});

	it("消费点委托：有 provider 时 role/index 的 fetchRoleList 走 provider", async () => {
		const p = systemProvider("del");
		registerSystemApiProvider("sys", p);
		const r = await fetchRoleList({} as any);
		expect(p.fetchRoleList).toHaveBeenCalled();
		expect(r).toBe("roleList:del");
		unregisterApiProviders("sys");
	});

	it("消费点委托：菜单类 fetch 合并进同一 provider", async () => {
		const p = systemProvider("del");
		registerSystemApiProvider("sys", p);
		await fetchMenuList({} as any);
		await fetchAddMenuItem({} as any);
		await fetchAddRoleItem({} as any);
		expect(p.fetchMenuList).toHaveBeenCalled();
		expect(p.fetchAddMenuItem).toHaveBeenCalled();
		expect(p.fetchAddRoleItem).toHaveBeenCalled();
		unregisterApiProviders("sys");
	});
});

describe("notifications api provider 注册表（D9）", () => {
	it("注册后 getNotificationsApiProvider 返回 provider", () => {
		const p = notificationsProvider("a");
		registerNotificationsApiProvider("notif", p);
		expect(getNotificationsApiProvider()).toBe(p);
		unregisterApiProviders("notif");
	});

	it("未注册 → undefined（回落内置）", () => {
		expect(getNotificationsApiProvider()).toBeUndefined();
	});

	it("先到先得：第二个注册者被忽略并告警", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = notificationsProvider("first");
		registerNotificationsApiProvider("notif", first);
		registerNotificationsApiProvider("notif", notificationsProvider("second"));
		expect(getNotificationsApiProvider()).toBe(first);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		unregisterApiProviders("notif");
	});

	it("消费点委托：fetchNotifications 走 provider", async () => {
		const p = notificationsProvider("del");
		registerNotificationsApiProvider("notif", p);
		const r = await fetchNotifications();
		expect(p.fetchNotifications).toHaveBeenCalled();
		expect(r).toEqual([{ title: "n:del" }]);
		unregisterApiProviders("notif");
	});
});

describe("upload api provider 注册表（D9）", () => {
	it("注册后 getUploadApiProvider 返回 provider", () => {
		const p = uploadProvider("a");
		registerUploadApiProvider("up", p);
		expect(getUploadApiProvider()).toBe(p);
		unregisterApiProviders("up");
	});

	it("未注册 → undefined（回落内置根级 /upload + Bearer）", () => {
		expect(getUploadApiProvider()).toBeUndefined();
	});

	it("先到先得：第二个注册者被忽略并告警", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = uploadProvider("first");
		registerUploadApiProvider("up", first);
		registerUploadApiProvider("up", uploadProvider("second"));
		expect(getUploadApiProvider()).toBe(first);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		unregisterApiProviders("up");
	});

	it("unregisterApiProviders 复位", () => {
		registerUploadApiProvider("up", uploadProvider("x"));
		unregisterApiProviders("up");
		expect(getUploadApiProvider()).toBeUndefined();
	});

	it("unregisterApiProviders 同时复位三个注册表（命名隔离）", () => {
		registerSystemApiProvider("up", systemProvider("x"));
		registerNotificationsApiProvider("up", notificationsProvider("x"));
		registerUploadApiProvider("up", uploadProvider("x"));
		unregisterApiProviders("up");
		expect(getSystemApiProvider()).toBeUndefined();
		expect(getNotificationsApiProvider()).toBeUndefined();
		expect(getUploadApiProvider()).toBeUndefined();
	});
});
