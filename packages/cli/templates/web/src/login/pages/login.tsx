import { fetchLoginMethods, getRedirectPath, useAuthStore } from "@oj-module/runtime";
import { Alert, Button, Form, Input, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";

type LoginMethod = "local" | "ldap" | "sso";

interface LoginFormValues {
	username: string
	password: string
}

/**
 * 登录页内容区。
 *
 * 只写内容区：视口/品牌区/工具区/页脚由框架 FullscreenLayout 兜住。
 * 只依赖框架出口（useAuthStore / getRedirectPath / fetchLoginMethods）与共享依赖
 * （antd / react-router），零框架内部 import。
 *
 * 登录方式由后端匿名端点 `GET /system/login-methods` 发现（local 恒在，
 * ldap/sso 由系统设置开关）。多于一种方式时渲染切换 tab；local/ldap 走同一表单，
 * 仅把 `method` 透传给运行时 `login()`（其按 method 路由到 auth/login / auth/ldap-login）；
 * sso 走重定向（端点由宿主/平台提供，模板仅负责跳转）。
 */
export default function LoginPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { search } = useLocation();
	const login = useAuthStore(s => s.login);
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);
	const [methods, setMethods] = useState<LoginMethod[]>(["local"]);
	const [active, setActive] = useState<LoginMethod>("local");

	useEffect(() => {
		fetchLoginMethods()
			.then((r) => {
				const m = r.methods.filter((x): x is LoginMethod => x === "local" || x === "ldap" || x === "sso");
				if (!m.length)
					return;
				setMethods(m);
				if (!m.includes("local"))
					setActive(m[0]);
			})
			.catch(() => {
				// 发现失败时回落单表单（local），不阻断登录。
			});
	}, []);

	async function onFinish(values: LoginFormValues, method: LoginMethod) {
		setLoading(true);
		setError(undefined);
		try {
			await login({ ...values, method });
			navigate(getRedirectPath(search));
		}
		catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		finally {
			setLoading(false);
		}
	}

	function ssoLogin() {
		// SSO 重定向端点由宿主/平台提供（如 GET /auth/sso），模板侧仅跳转。
		window.location.assign("/auth/sso");
	}

	const showTabs = methods.length > 1;

	const form = (method: LoginMethod) => (
		<Form<LoginFormValues> layout="vertical" onFinish={values => onFinish(values, method)}>
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
	);

	return (
		<>
			<Typography.Title level={3}>
				{t("login:page.title")}
			</Typography.Title>
			<Typography.Paragraph type="secondary">
				{t("login:page.subtitle")}
			</Typography.Paragraph>
			{error && <Alert style={{ marginBottom: 16 }} type="error" message={error} showIcon />}
			{showTabs
				? (
					<Tabs
						activeKey={active}
						onChange={key => setActive(key as LoginMethod)}
						items={methods.map(m => ({
							key: m,
							label: t(`login:method.${m}`),
							children: m === "sso"
								? <Button type="primary" block onClick={ssoLogin}>{t("login:method.sso.action")}</Button>
								: form(m),
						}))}
					/>
				)
				: form("local")}
		</>
	);
}
