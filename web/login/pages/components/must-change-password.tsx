// AC1-27 首登强制改密（must_change 限权闭环的界面侧）：
// 登录成功但 user.mustChange=true 时切入本表单；改密成功（后端换发无限制令牌）
// 后写回 auth store 再走正常重定向。未改密前不放行导航（弱端点外的接口均被 403 must_change 拒绝）。
import { fetchChangePassword, getRedirectPath, useAuthStore } from "@oj-module/runtime";
import { App, Button, Form, Input } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";

export function MustChangePassword() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const [loading, setLoading] = useState(false);
	const [form] = Form.useForm();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();

	return (
		<>
			<h2 className="text-colorText mb-3 text-3xl font-bold leading-9 tracking-tight lg:text-4xl">
				{t("login:mustChange.title")}
			</h2>
			<p className="mb-4 text-sm text-colorTextSecondary lg:text-base">
				{t("login:mustChange.description")}
			</p>
			<Form
				form={form}
				layout="vertical"
				onFinish={(v) => {
					setLoading(true);
					fetchChangePassword({ old_password: v.oldPassword, new_password: v.newPassword })
						.then((p) => {
							useAuthStore.setState({ token: p.access_token, refreshToken: p.refresh_token });
							message.success(t("login:mustChange.success"));
							navigate(getRedirectPath(searchParams));
						})
						.catch(() => {
							// 失败提示由 request 层统一吐司（403 must_change / 400 / 401）
						})
						.finally(() => {
							setLoading(false);
						});
				}}
			>
				<Form.Item
					label={t("authority.password")}
					name="oldPassword"
					rules={[{ required: true, message: t("form.password.required") }]}
				>
					<Input.Password placeholder={t("login:mustChange.oldPassword")} />
				</Form.Item>
				<Form.Item
					label={t("login:mustChange.newPassword")}
					name="newPassword"
					rules={[
						{ required: true, message: t("login:mustChange.newPasswordRequired") },
						{ min: 6, message: t("login:mustChange.min6") },
					]}
				>
					<Input.Password />
				</Form.Item>
				<Form.Item>
					<Button block type="primary" htmlType="submit" loading={loading}>
						{t("common.save")}
					</Button>
				</Form.Item>
			</Form>
		</>
	);
}
