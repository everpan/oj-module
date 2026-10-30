import { fetchLoginMethods, getRedirectPath, resolveApiBase, useAuthStore, useTenantStore, withSiteBase } from "@oj-module/runtime";
import { Alert, Button, Form, Input, Tabs, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { parseWecomLanding, wecomAuthorizePath } from "../wecom";

type LoginMethod = "local" | "ldap" | "sso" | "wecom";

/**
 * 已实现的登录方式（顺序即 tab 顺序）。
 * 后端 `methods` 是**发现结果**、这里是**渲染能力**：后端多报一种而本页没有对应
 * renderer 时宁可不显示（点了也没实现），新增方式 = 这里加一项 + 渲染分支加一路。
 */
const KNOWN_METHODS: LoginMethod[] = ["local", "ldap", "sso", "wecom"];

function isKnownMethod(x: string): x is LoginMethod {
	return (KNOWN_METHODS as string[]).includes(x);
}

interface LoginFormValues {
	username: string
	password: string
	/** 企业代码（多租户部署才需要，L2：登录带租户） */
	tenant?: string
}

/**
 * 登录页内容区。
 *
 * 只写内容区：视口/品牌区/工具区/页脚由框架 FullscreenLayout 兜住。
 * 只依赖框架出口（useAuthStore / getRedirectPath / fetchLoginMethods / withSiteBase）与共享依赖
 * （antd / react-router），零框架内部 import。
 *
 * 登录方式由后端匿名端点 `GET /system/login-methods` 发现（local 恒在，
 * ldap/sso/wecom 由系统设置开关）。多于一种方式时渲染切换 tab；local/ldap 走同一表单，
 * 仅把 `method` 透传给运行时 `login()`；sso 与 wecom 走整页跳转（拿不到 302 的
 * opaque redirect，不能用 XHR）。
 *
 * 企微回跳落地：`/login?wecom_ticket=&tenant=` —— 先落租户再换票（服务端要求头与票据
 * 租户一致），票换出的 token 由 runtime 统一写库（见 ../auth-provider.ts）。
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
	// 企业代码入口默认收起：单租户部署（绝大多数）保持今天的登录页外观，
	// 只有服务商/客户带 `?tenant=` 或手工展开时才需要填。
	const [showTenant, setShowTenant] = useState(false);
	// 企微 tab 的企业代码（优先用已持久化的值，单租户的 default 不预填）
	const [corp, setCorp] = useState(() => {
		const current = useTenantStore.getState().tenant;
		return current === "default" ? "" : current;
	});

	// 企微 302 落地参数：只在首次渲染解析一次（ticket 一次性，解析结果必须稳定）
	const [landing] = useState(() => parseWecomLanding(search));
	const exchangedRef = useRef(false);

	useEffect(() => {
		fetchLoginMethods()
			.then((r) => {
				const m = r.methods.filter(isKnownMethod);
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

	useEffect(() => {
		// 换票只做一次：ticket 单次有效，重复 POST 只会拿到 401 并盖掉真正的错误
		if (!landing || exchangedRef.current)
			return;
		exchangedRef.current = true;
		void (async () => {
			setLoading(true);
			setError(undefined);
			try {
				// 租户先落 store：provider 每请求读 getState，服务端会比对「头值 == 票据租户」
				if (landing.tenant)
					useTenantStore.getState().setTenant(landing.tenant);
				await login({ username: "", password: "", method: "wecom", ticket: landing.ticket });
				navigate(getRedirectPath(search), { replace: true });
			}
			catch (e) {
				setError(e instanceof Error ? e.message : String(e));
				setLoading(false);
			}
		})();
	}, [landing, login, navigate, search]);

	async function onFinish(values: LoginFormValues, method: LoginMethod) {
		setLoading(true);
		setError(undefined);
		try {
			// L2：登录请求必须带租户头。先落 store（provider 每请求读 getState），再登录。
			if (values.tenant?.trim())
				useTenantStore.getState().setTenant(values.tenant);
			await login({ username: values.username, password: values.password, method });
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
		window.location.assign(withSiteBase("/auth/sso"));
	}

	function wecomLogin() {
		// 整页跳转（拿不到 302 的 opaque redirect）：授权入口是**后端端点**，
		// 必须拼 API base（部署期可为 /api 或网关前缀）；拼站点 base 只会落到
		// SPA 兜底页——点击后页面原地重载、一个 auth 请求都不发。
		// 企业代码不在这里写 store——只有服务端回跳带的 tenant 才是权威值。
		window.location.assign(`${resolveApiBase()}${wecomAuthorizePath(corp)}`);
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
			{showTenant && (
				<Form.Item name="tenant" label={t("login:page.tenant.label")} extra={t("login:page.tenant.hint")}>
					<Input autoComplete="off" placeholder="ww..." />
				</Form.Item>
			)}
			<Button type="primary" htmlType="submit" block loading={loading}>
				{t("login:page.submit")}
			</Button>
			<Button type="link" size="small" block onClick={() => setShowTenant(v => !v)}>
				{t(showTenant ? "login:page.tenant.hide" : "login:page.tenant.toggle")}
			</Button>
		</Form>
	);

	// 企微：只需企业代码（服务商后台生成的专属链接会预填，客户也可手输）
	// 受控值不走 antd 表单（Form.Item 无 name），故显式给 id/htmlFor：
	// 少了这层关联，标签只是视觉文本，读屏与 getByLabel 都取不到输入框。
	const wecomCorpId = "wecom-corp";
	const wecomPanel = (
		<Form layout="vertical" onFinish={wecomLogin}>
			<Form.Item
				label={t("login:page.tenant.label")}
				htmlFor={wecomCorpId}
				extra={t("login:method.wecom.hint")}
			>
				<Input
					id={wecomCorpId}
					autoComplete="off"
					placeholder="ww..."
					value={corp}
					onChange={e => setCorp(e.target.value)}
				/>
			</Form.Item>
			<Button type="primary" htmlType="submit" block>
				{t("login:method.wecom.action")}
			</Button>
		</Form>
	);

	function panelOf(m: LoginMethod) {
		if (m === "sso")
			return <Button type="primary" block onClick={ssoLogin}>{t("login:method.sso.action")}</Button>;
		if (m === "wecom")
			return wecomPanel;
		return form(m);
	}

	return (
		<>
			<Typography.Title level={3}>
				{t("login:page.title")}
			</Typography.Title>
			<Typography.Paragraph type="secondary">
				{t("login:page.subtitle")}
			</Typography.Paragraph>
			{landing && loading && (
				<Alert style={{ marginBottom: 16 }} type="info" message={t("login:method.wecom.exchanging")} showIcon />
			)}
			{error && <Alert style={{ marginBottom: 16 }} type="error" message={error} showIcon />}
			{/* 换票期间不渲染 tab：避免用户在跳转前又点一次登录 */}
			{landing && loading
				? null
				: showTabs
					? (
						<Tabs
							activeKey={active}
							onChange={key => setActive(key as LoginMethod)}
							items={methods.map(m => ({
								key: m,
								label: t(`login:method.${m}`),
								children: panelOf(m),
							}))}
						/>
					)
					: panelOf(methods[0] ?? "local")}
		</>
	);
}
