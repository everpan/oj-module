// BDD：个人中心「修改密码」卡片——登录态自助改密（PUT /api/auth/password，本人 + 旧口令）。
// 覆盖：两次新密码不一致不提交 / 少于 6 位不提交 / 成功按契约提交并回调 onDone / 后端拒绝如实显示。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zhCN from "../../locales/zh-CN.json";
import { ChangePasswordCard } from "./change-password-card";

// fetchChangePassword 走 runtime 的全局 request 出口，单测里换成可断言的假实现
const { changePassword } = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock("@oj-module/runtime", () => ({ fetchChangePassword: changePassword }));

const i18n = createInstance();
void i18n.use(initReactI18next).init({
	lng: "zh-CN",
	fallbackLng: "zh-CN",
	resources: { "zh-CN": { "personal-center": zhCN } },
});

function renderCard(onDone = vi.fn()) {
	render(
		<I18nextProvider i18n={i18n}>
			<ConfigProvider button={{ autoInsertSpace: false }}>
				<ChangePasswordCard onDone={onDone} />
			</ConfigProvider>
		</I18nextProvider>,
	);
	const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
	const submit = () => fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
	return { onDone, fill, submit };
}

beforeEach(() => {
	changePassword.mockReset();
});

describe("个人中心：修改密码卡片", () => {
	it("当 两次新密码不一致，则 拦在本地校验、不发请求", async () => {
		const { fill, submit } = renderCard();
		fill("当前密码", "old-pass");
		fill("新密码", "new-pass-1");
		fill("确认新密码", "new-pass-2");
		submit();
		expect(await screen.findByText("两次输入的新密码不一致")).toBeTruthy();
		expect(changePassword).not.toHaveBeenCalled();
	});

	it("当 新密码不足 6 位，则 提示下限、不发请求", async () => {
		const { fill, submit } = renderCard();
		fill("当前密码", "old-pass");
		fill("新密码", "12345");
		fill("确认新密码", "12345");
		submit();
		expect(await screen.findByText("新密码至少 6 位")).toBeTruthy();
		expect(changePassword).not.toHaveBeenCalled();
	});

	it("当 校验通过，则 按契约提交旧/新口令，成功后回调 onDone（页面负责清会话并回登录页）", async () => {
		changePassword.mockResolvedValue({ access_token: "a", refresh_token: "r" });
		const { onDone, fill, submit } = renderCard();
		fill("当前密码", "old-pass");
		fill("新密码", "new-pass-1");
		fill("确认新密码", "new-pass-1");
		submit();
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(changePassword).toHaveBeenCalledWith({ old_password: "old-pass", new_password: "new-pass-1" });
	});

	it("当 后端拒绝（旧口令错），则 如实显示错误且不回调 onDone", async () => {
		changePassword.mockRejectedValue(new Error("invalid credentials"));
		const { onDone, fill, submit } = renderCard();
		fill("当前密码", "wrong-pass");
		fill("新密码", "new-pass-1");
		fill("确认新密码", "new-pass-1");
		submit();
		expect(await screen.findByText("invalid credentials")).toBeTruthy();
		expect(onDone).not.toHaveBeenCalled();
	});
});
