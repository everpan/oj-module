import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
// BDD：发布管理页（申请 → 一次性明文 → 列表 → 撤销）。
//
// 用 vi.mock 替掉契约客户端（页面的 IO 边界只有这一个模块），于是不需要起站点，
// 断言全部落在「用户看见什么」上：明文只出现一次、状态由服务端给、超管才看得到租户维度。
import { App as AntdApp } from "antd";
import i18n from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import zhCN from "../../packages/cli/templates/src/app/web/publish/locales/zh-CN.json";

vi.mock("../../packages/cli/templates/src/app/web/publish/__client", () => ({
	createPublishClient: vi.fn(),
	publishCredentialGet: vi.fn(),
	publishCredentialPost: vi.fn(),
	publishCredentialRevokePost: vi.fn(),
}));

const client = await import("../../packages/cli/templates/src/app/web/publish/__client");
const { default: PublishPage } = await import("../../packages/cli/templates/src/app/web/publish/pages");

const TOKEN = "a".repeat(64);

beforeAll(() => {
	if (!i18n.isInitialized) {
		i18n.use(initReactI18next).init({
			lng: "zh-CN",
			fallbackLng: "zh-CN",
			ns: ["publish"],
			defaultNS: "publish",
			resources: { "zh-CN": { publish: zhCN } },
			interpolation: { escapeValue: false },
		});
	}
});

function row(over: Record<string, unknown> = {}) {
	return {
		id: 1,
		product: "demo-solution",
		key_id: "demo-solution.alice",
		username: "alice",
		display_name: null,
		token_hint: "aaaaaaaa",
		status: "active",
		expires_at: 1_700_604_800,
		used_at: null,
		created_at: 1_700_000_000,
		...over,
	};
}

function mockList(rows: unknown[], total = rows.length): void {
	vi.mocked(client.publishCredentialGet).mockResolvedValue({ list: rows, total } as never);
}

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<I18nextProvider i18n={i18n}>
				<AntdApp>
					<PublishPage />
				</AntdApp>
			</I18nextProvider>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockList([]);
});

describe("发布管理页", () => {
	it("given 空列表 When 打开页面 Then 显示空态与「申请发布凭证」按钮", async () => {
		renderPage();
		expect(screen.getByTestId("publish-apply")).toBeTruthy();
		await waitFor(() => expect(screen.getByText("还没有申请过发布凭证")).toBeTruthy());
	});

	it("given 一条待兑换记录 When 渲染 Then 显示产品名、发布身份、申请人与状态标签", async () => {
		mockList([row({ display_name: "张三" })]);
		renderPage();

		await waitFor(() => expect(screen.getByText("demo-solution.alice")).toBeTruthy());
		expect(screen.getByText("demo-solution")).toBeTruthy();
		// 申请人优先显示真名，并附登录名以便辨认
		expect(screen.getByText("张三（alice）")).toBeTruthy();
		expect(screen.getByText("待兑换")).toBeTruthy();
		expect(screen.getByRole("button", { name: "撤销" })).toBeTruthy();
	});

	it("given 已兑换/已撤销记录 When 渲染 Then 不提供撤销入口（发布身份不能靠撤凭证回收）", async () => {
		mockList([row({ id: 1, status: "used", used_at: 1_700_000_100 }), row({ id: 2, status: "revoked", key_id: "demo-solution.bob" })]);
		renderPage();

		await waitFor(() => expect(screen.getByText("已兑换")).toBeTruthy());
		expect(screen.getByText("已撤销")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
	});

	it("given 普通用户（响应无归属租户）Then 无租户筛选与租户列", async () => {
		mockList([row()]);
		renderPage();

		await waitFor(() => expect(screen.getByText("demo-solution.alice")).toBeTruthy());
		expect(screen.queryByTestId("publish-tenant-filter")).toBeNull();
		expect(screen.queryByText("归属租户")).toBeNull();
	});

	it("given 超管（响应带归属租户）Then 出现租户列与租户筛选", async () => {
		mockList([row({ owner_tenant: "default" })]);
		renderPage();

		await waitFor(() => expect(screen.getByTestId("publish-tenant-filter")).toBeTruthy());
		expect(screen.getByText("归属租户")).toBeTruthy();
	});

	it("given 填产品名并提交 When 成功 Then 弹窗给出明文与可直接执行的命令", async () => {
		vi.mocked(client.publishCredentialPost).mockResolvedValue({
			token: TOKEN,
			key_id: "demo-solution.alice",
			product: "demo-solution",
			token_hint: "aaaaaaaa",
			expires_at: 1_700_604_800,
		} as never);
		renderPage();

		fireEvent.click(screen.getByTestId("publish-apply"));
		fireEvent.change(await screen.findByTestId("publish-product"), { target: { value: "demo-solution" } });
		fireEvent.click(screen.getByRole("button", { name: "生成凭证" }));

		await waitFor(() => expect(client.publishCredentialPost).toHaveBeenCalledWith({ product: "demo-solution" }));
		// 明文与命令都放在只读输入框里（64 位 hex 手抄必错），故按 value 断言而非文本
		await waitFor(() => expect(screen.getByDisplayValue(TOKEN)).toBeTruthy());
		expect(screen.getByDisplayValue(`ojm keygen --credential ${TOKEN}`)).toBeTruthy();
		expect(screen.getByText(/只显示这一次/)).toBeTruthy();
	});

	it("given 明文弹窗已保存关闭 Then 页面上再也取不到明文（组件卸载而非 CSS 隐藏）", async () => {
		vi.mocked(client.publishCredentialPost).mockResolvedValue({
			token: TOKEN,
			key_id: "demo-solution.alice",
			product: "demo-solution",
			token_hint: "aaaaaaaa",
			expires_at: 1_700_604_800,
		} as never);
		renderPage();

		fireEvent.click(screen.getByTestId("publish-apply"));
		fireEvent.change(await screen.findByTestId("publish-product"), { target: { value: "demo-solution" } });
		fireEvent.click(screen.getByRole("button", { name: "生成凭证" }));
		await waitFor(() => expect(screen.getByDisplayValue(TOKEN)).toBeTruthy());

		fireEvent.click(screen.getByRole("button", { name: "我已保存" }));
		await waitFor(() => expect(screen.queryByDisplayValue(TOKEN)).toBeNull());
		expect(document.body.textContent).not.toContain(TOKEN);
	});

	it("given 撤销确认 When 确认 Then 调撤销接口", async () => {
		mockList([row()]);
		vi.mocked(client.publishCredentialRevokePost).mockResolvedValue({ ok: true } as never);
		renderPage();

		await waitFor(() => expect(screen.getByRole("button", { name: "撤销" })).toBeTruthy());
		fireEvent.click(screen.getByRole("button", { name: "撤销" }));
		await waitFor(() => expect(screen.getByText("撤销后该凭证立刻作废，确定？")).toBeTruthy());
		// 确认气泡里的「撤销」与行内按钮同名，按容器取，避免命中行内那颗
		const confirmOk = document.querySelector(".ant-popconfirm .ant-btn-primary") as HTMLButtonElement;
		fireEvent.click(confirmOk);

		await waitFor(() => expect(client.publishCredentialRevokePost).toHaveBeenCalledWith({ id: 1 }));
	});
});
