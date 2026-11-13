// BDD：角色权限页「已绑定权限点」列按 title_key 做多语言展示名解析（回归 20261113 修复）。
// 修复前权限点列直接渲染机器名（如 platform_org_read_all）；修复后按 code 查权限元数据，
// 命中 title_key 则翻译、未配置 title_key（或当前语言无译文）则回退原键值 code。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ConfigProvider } from "antd";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zhCN from "../../locales/zh-CN.json";
import RolesPage from "./index";

// 两个列表查询是页面渲染权限点列的前提；用 hoisted mock 注入内存夹具
const { systemRolesGet, systemPermissionsGet } = vi.hoisted(() => ({
	systemRolesGet: vi.fn(),
	systemPermissionsGet: vi.fn(),
}));

vi.mock("../../__client", () => ({
	systemRolesGet: (...a: unknown[]) => systemRolesGet(...a),
	systemPermissionsGet: (...a: unknown[]) => systemPermissionsGet(...a),
}));

const ROLE = {
	name: "custom.crm",
	module: "crm",
	title: "CRM 专员",
	title_key: null,
	description: null,
	builtin: false,
	deprecated: false,
	holders: 0,
	// 一个已配 title_key（应翻译），一个未配置（应回退原键值）
	permissions: ["platform_org_read_all", "custom.perm.unknown"],
};

const PERMS = [
	{ code: "platform_org_read_all", module: "framework", title_key: "system:perm.platform_org_read_all", deprecated: false },
	{ code: "custom.perm.unknown", module: "crm", title_key: null, deprecated: false },
];

function renderPage() {
	const i18n = createInstance();
	void i18n.use(initReactI18next).init({
		lng: "zh-CN",
		fallbackLng: "zh-CN",
		resources: { "zh-CN": { system: zhCN } },
	});
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<I18nextProvider i18n={i18n}>
			<ConfigProvider button={{ autoInsertSpace: false }}>
				<QueryClientProvider client={queryClient}>
					<RolesPage />
				</QueryClientProvider>
			</ConfigProvider>
		</I18nextProvider>,
	);
}

beforeEach(() => {
	systemRolesGet.mockResolvedValue([ROLE]);
	systemPermissionsGet.mockResolvedValue(PERMS);
});

describe("角色权限页：已绑定权限点按 key 做多语言展示名解析", () => {
	it("已配 title_key 的权限点 → 译文（而非裸机器名）", async () => {
		renderPage();
		expect(await screen.findByText("组织架构全量读权限")).toBeTruthy();
		// 角色默认激活「角色」页（首 tab），权限点译文渲染于此；裸 code 不应出现
		expect(screen.queryByText("platform_org_read_all")).toBeNull();
	});

	it("未配置 title_key 的权限点 → 回退显示原键值", async () => {
		renderPage();
		expect(await screen.findByText("custom.perm.unknown")).toBeTruthy();
	});
});
