import type { LoginInfo } from "#src/api/user";

import { Button, Form, Input } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useNavigate, useSearchParams } from "react-router";
import { useAuthStore } from "#src/store/auth";
import { getRedirectPath } from "#src/utils/get-redirect-path";

/**
 * 内置登录兜底页（极简形态）。
 *
 * 完整版登录页（多表单模式：密码/验证码/注册/找回密码）已模块化为
 * `modules/login`，本页只是**框架兜底**：模块清单没有 login 模块、或模块
 * 加载失败时，保证 /login 仍有可用表单（退出登录路由 reset 防死锁，
 * 见 login-module-design.md §1 硬障碍 2）。
 *
 * 视口 / 品牌区 / 工具区 / 页脚由框架级 FullscreenLayout 兜住
 *（见 router/routes/core/auth.ts），本页只写内容区。
 */
const FORM_INITIAL_VALUES: LoginInfo = {
	username: "admin",
	password: "123456789admin",
};

export default function Login() {
	const [loading, setLoading] = useState(false);
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const login = useAuthStore(state => state.login);

	const handleFinish = async (values: LoginInfo) => {
		setLoading(true);
		login(values).then(() => {
			navigate(getRedirectPath(searchParams));
		}).catch(() => {
			// 失败提示已由 request 层 / auth store 统一吐司，这里只吞 rejection
		}).finally(() => {
			setLoading(false);
		});
	};

	return (
		<div className="w-full max-w-90 mx-auto">
			<h2 className="text-colorText mb-6 text-3xl font-bold tracking-tight">
				{t("authority.welcomeBack")}
			</h2>
			<Form<LoginInfo>
				name="builtinLoginForm"
				layout="vertical"
				initialValues={FORM_INITIAL_VALUES}
				onFinish={handleFinish}
			>
				<Form.Item
					label={t("authority.username")}
					name="username"
					rules={[{ required: true, message: t("form.username.required") }]}
				>
					<Input autoFocus placeholder={t("form.username.required")} />
				</Form.Item>

				<Form.Item
					label={t("authority.password")}
					name="password"
					rules={[{ required: true, message: t("form.password.required") }]}
				>
					<Input.Password placeholder={t("form.password.required")} />
				</Form.Item>

				<Form.Item>
					<Button block type="primary" htmlType="submit" loading={loading}>
						{t("authority.login")}
					</Button>
				</Form.Item>
			</Form>
		</div>
	);
}
