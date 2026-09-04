import { getRedirectPath, useAuthStore } from "@react-antd-module/runtime";
import { Alert, Button, Form, Input, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";

interface LoginFormValues {
	username: string
	password: string
}

/**
 * 登录模块参考实现的内容区（P4）。
 *
 * 模块只写内容区：视口/品牌区/工具区/页脚由框架 FullscreenLayout 兜住。
 * 只依赖框架出口（useAuthStore / getRedirectPath）与共享依赖（antd / react-router），
 * 零框架内部 import。
 */
export default function LoginPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { search } = useLocation();
	const login = useAuthStore(s => s.login);
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);

	async function onFinish(values: LoginFormValues) {
		setLoading(true);
		setError(undefined);
		try {
			await login(values);
			navigate(getRedirectPath(search));
		}
		catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		finally {
			setLoading(false);
		}
	}

	return (
		<>
			<Typography.Title level={3}>
				{t("login:page.title")}
			</Typography.Title>
			<Typography.Paragraph type="secondary">
				{t("login:page.subtitle")}
			</Typography.Paragraph>
			{error && <Alert style={{ marginBottom: 16 }} type="error" message={error} showIcon />}
			<Form<LoginFormValues> layout="vertical" onFinish={onFinish}>
				<Form.Item name="username" label={t("login:page.username")} rules={[{ required: true }]}>
					<Input autoFocus />
				</Form.Item>
				<Form.Item name="password" label={t("login:page.password")} rules={[{ required: true }]}>
					<Input.Password />
				</Form.Item>
				<Button type="primary" htmlType="submit" block loading={loading}>
					{t("login:page.submit")}
				</Button>
			</Form>
		</>
	);
}
