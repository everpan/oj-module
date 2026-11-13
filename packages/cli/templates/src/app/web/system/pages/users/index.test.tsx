// BDD：用户管理页角色列按 key 做多语言展示名解析（回归 20261113 修复）。
// 修复前角色列直接渲染机器名（如 superadmin）；修复后走 roleLabel(row, t)，
// 与角色页/成员资格页同口径：title_key → 内置 locale（system:rolesPage.roleTitle.<name>）
// → title → name。本测试钉「同一角色随站点语言切换译文」，防止回退成裸 key。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "../../locales/en-US.json";
import zhCN from "../../locales/zh-CN.json";
import UsersPage from "./index";

// 三个列表查询是页面渲染角色列的前提；用 hoisted mock 注入内存夹具
const { systemUsersGet, systemRolesGet, systemDepartmentsGet } = vi.hoisted(() => ({
	systemUsersGet: vi.fn(),
	systemRolesGet: vi.fn(),
	systemDepartmentsGet: vi.fn(),
}));

vi.mock("@oj-module/runtime", () => ({
	// 当前登录者设为 superadmin（id=1），避免行级置灰干扰角色列断言
	useUserStore: vi.fn((selector: (s: { id: string, roles: string[] }) => unknown) => selector({ id: "1", roles: ["superadmin"] })),
}));

vi.mock("../../__client", () => ({
	systemUsersGet: (...a: unknown[]) => systemUsersGet(...a),
	systemRolesGet: (...a: unknown[]) => systemRolesGet(...a),
	systemDepartmentsGet: (...a: unknown[]) => systemDepartmentsGet(...a),
	systemUsersForbiddenPut: vi.fn(),
	systemUsersPasswordPut: vi.fn(),
	systemUsersPost: vi.fn(),
}));

const USER = {
	id: 2,
	username: "alice",
	display_name: "Alice",
	email: null,
	position: null,
	departments: [{ id: 1, name: "研发部", isMain: true }],
	is_forbidden: false,
	must_change: false,
	roles: ["superadmin"],
};

// 内置角色：title/title_key 均为空，强制走 locale 键 system:rolesPage.roleTitle.superadmin
const ROLES = [
	{ name: "superadmin", module: "framework", title: null, title_key: null, description: null, builtin: true, deprecated: false, holders: 1, permissions: [] },
];

function renderPage(lng: "zh-CN" | "en-US", locale: typeof zhCN | typeof enUS) {
	const i18n = createInstance();
	void i18n.use(initReactI18next).init({
		lng,
		fallbackLng: lng,
		resources: { [lng]: { system: locale } },
	});
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<I18nextProvider i18n={i18n}>
			<ConfigProvider button={{ autoInsertSpace: false }}>
				<AntApp>
					<QueryClientProvider client={queryClient}>
						<MemoryRouter>
							<UsersPage />
						</MemoryRouter>
					</QueryClientProvider>
				</AntApp>
			</ConfigProvider>
		</I18nextProvider>,
	);
}

beforeEach(() => {
	systemUsersGet.mockResolvedValue([USER]);
	systemRolesGet.mockResolvedValue(ROLES);
	systemDepartmentsGet.mockResolvedValue([]);
});

describe("用户管理页：角色列按 key 做多语言展示名解析", () => {
	it("zh-CN：superadmin 渲染为「超级管理员」，且不出现裸机器名", async () => {
		renderPage("zh-CN", zhCN);
		expect(await screen.findByText("超级管理员")).toBeTruthy();
		expect(screen.queryByText("superadmin")).toBeNull();
	});

	it("en-US：同一角色随语言切换为 Super Admin", async () => {
		renderPage("en-US", enUS);
		expect(await screen.findByText("Super Admin")).toBeTruthy();
		expect(screen.queryByText("superadmin")).toBeNull();
	});
});
