import {
	DEFAULT_TENANT,
	fetchLoginMethods,
	getRedirectPath,
	resolveApiBase,
	useAuthStore,
	useTenantStore,
} from "@oj-module/runtime";
import { Alert, Button, Form, Input, Skeleton, Tabs, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { getWecomBootError } from "../routes";
import { parseWecomLanding, wecomAuthorizePath } from "../wecom";

type LoginMethod = "local" | "ldap" | "sso" | "wecom";

/**
 * 已实现的登录方式（顺序即 tab 顺序）。
 * 后端 `methods` 是**发现结果**、这里是**渲染能力**：后端多报一种而本页没有对应
 * renderer 时宁可不显示（点了也没实现），新增方式 = 这里加一项 + 渲染分支加一路。
 */
const KNOWN_METHODS: LoginMethod[] = ["wecom", "local", "ldap", "sso"];

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
	// onInit 阶段换票若失败，首帧直接显示表单与错误（不再闪「认证中」）
	const bootError = getWecomBootError();
	const [error, setError] = useState<string | undefined>(bootError || undefined);
	const [loading, setLoading] = useState(false);
	const [known, setKnown] = useState(false);
	const inWecom = typeof navigator !== "undefined" && /wxwork/i.test(navigator.userAgent);
	const [methods, setMethods] = useState<LoginMethod[]>(["local"]);
	const [active, setActive] = useState<LoginMethod>("wecom");
	// 企业代码入口默认收起：单租户部署（绝大多数）保持今天的登录页外观，
	// 只有服务商/客户带 `?tenant=` 或手工展开时才需要填。
	// 例外一：持久化租户不是部署默认值时必须展开——租户头是**隐式**跟着请求走的
	// （runtime 每请求注入），藏起来等于让上一次的租户无声地把这次登录带走。
	// 例外二：**开了企业微信登录就默认展开**（见下方 effect）——企微租户的键是 corp_id，
	//   一旦有企业接入，「登录哪个租户」就是真问题：平台管理员在 default，而各企业的
	//   管理员在各自的 corp 租户里，收起等于让运维找不到切租户的入口。
	//   判据用「wecom 是否在登录方式里」而不是去数租户：匿名请求没有租户上下文，
	//   统计租户要动用 db.asSystem（全仓仅 tenant-admin.ts 一处，不为此破例）。
	const [showTenant, setShowTenant] = useState(() => useTenantStore.getState().tenant !== DEFAULT_TENANT);
	// 「其他企业」折叠：仅服务商 / 多企业共存部署才需要手填企业代码
	const [showOtherCorp, setShowOtherCorp] = useState(false);
	// 表单里的企业代码：带上 persisted 值（URL `?tenant=` 已先落到 store），用户看得见才改得动
	const [tenant] = useState(() => {
		const current = useTenantStore.getState().tenant;
		return current === DEFAULT_TENANT ? "" : current;
	});
	// 企微深链入口：应用「主页」配成 /login?corp=<corpId>&agent=<agentId>，
	// 成员从企微内点开即带参到达——据此预填企业代码/应用，并由下方 effect 自动发起授权。
	const urlCorp = new URLSearchParams(search).get("corp")?.trim() ?? "";
	const urlAgent = new URLSearchParams(search).get("agent")?.trim() ?? "";
	// 企微 tab 的企业代码（优先用 URL 深链带的，其次已持久化的值，单租户的 default 不预填）
	const [corp, setCorp] = useState(() => urlCorp || tenant);
	const [agent, setAgent] = useState(() => urlAgent);

	// 企微 302 落地参数：只在首次渲染解析一次（ticket 一次性，解析结果必须稳定）
	const [landing] = useState(() => parseWecomLanding(search));
	// 仅「认证中 / 已失败」两态：企微内、回跳落地、或 ?corp 深链即进入认证态，
	// 直接展示「认证中」，不渲染登录表单；只有认证失败（换票失败 / 企微方式不可用）才回落表单。
	// 换票成功时 onInit 已把 URL 改到首页，路由首帧就落在 /home，本组件根本不会挂载；bootError 非空即换票失败。
	const [phase, setPhase] = useState<"auth" | "form">(
		bootError ? "form" : inWecom || landing || urlCorp ? "auth" : "form",
	);

	useEffect(() => {
		fetchLoginMethods()
			.then((r) => {
				setKnown(true);
				// 先按 string[] 看一眼：runtime 的返回类型把 wecom 排除在外，而这里恰恰要认它
				const raw: string[] = r.methods;
				// 按 KNOWN_METHODS 排序：企微是主入口，排第一个 tab 并默认选中，
				// 「使用企业微信一键登录」首帧即可见，点一次就走。
				const m = raw.filter(isKnownMethod).sort(
					(a, b) => KNOWN_METHODS.indexOf(a) - KNOWN_METHODS.indexOf(b),
				);
				if (!m.length)
					return;
				setMethods(m);
				setActive(m.includes("wecom") ? "wecom" : m[0]);
			})
			.catch(() => {
				setKnown(true);
				// 发现失败时回落单表单（local），不阻断登录。
			});
	}, []);

	// 企微票据换会话已提前到模块 onInit（见 login/routes.ts::exchangeWecomTicketOnBoot）：
	// 成功时 URL 已在首帧前改到首页，本页不挂载；失败时 bootError 已在上面落成表单 + 错误态。
	// 这里不再发第二次 POST——票据一次性，重复换只会拿到 401 并盖掉真正的错误。

	// 企微深链自动入口：带 ?corp= 到达（且非回跳落地 / 非出错）且企微方式可用时，
	// 直接整页发起授权——「点开即登录」，无需手动点「企业微信」tab。
	const autoFiredRef = useRef(false);
	useEffect(() => {
		const c = new URLSearchParams(search).get("corp")?.trim() ?? "";
		// 企微内（wxwork UA）从「应用主页」点开即自动发起授权；带 ?corp= 的深链同样自动发起。
		// 换票失败后不再自动重发授权：否则废票 → 重新授权 → 再换一次废票会原地打转。
		if ((!c && !inWecom) || landing || getWecomBootError() || autoFiredRef.current)
			return;
		if (new URLSearchParams(search).get("error")) {
			setPhase("form");
			return;
		}
		if (known && !methods.includes("wecom")) {
			setPhase("form");
			return;
		}
		autoFiredRef.current = true;
		window.location.assign(`${resolveApiBase()}${wecomAuthorizePath(corp, agent)}`);
	}, [landing, methods, search, corp, agent]);

	async function onFinish(values: LoginFormValues, method: LoginMethod) {
		setLoading(true);
		setError(undefined);
		try {
			// L2：登录请求必须带租户头。先落 store（provider 每请求读 getState），再登录。
			// 字段留空即「回到部署默认」——否则上一个用户/上一次企微登录留下的租户头
			// 会把这次本地登录静默带到别家企业（表现为账号不存在，界面上看不出原因）。
			if (values.tenant?.trim())
				useTenantStore.getState().setTenant(values.tenant);
			else
				useTenantStore.getState().clear();
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
		// 与企微同口径拼 API base：它是**后端端点**（要发 302 到 IdP），拼站点 base
		// 只会落到 SPA 兜底页（点了没反应，一个请求都不发）。
		window.location.assign(`${resolveApiBase()}/auth/sso`);
	}

	/**
	 * 一键扫码登录：默认不传 corp/agent，后端 `corpSelf()` 从部署常量 `wecom_corp_*`
	 * 自动解析本企业（api.ts::login → resolveWecomProfile），用户不必填企业代码。
	 * 普通浏览器 UA 下后端 302 到企微 qrConnect 扫码页；企微内 UA 走 oauth2 静默。
	 * 只有「其他企业」折叠里才带 corp/agent（服务商 / 多企业共存部署）。
	 */
	function wecomLogin(withCorp = false) {
		// 整页跳转（拿不到 302 的 opaque redirect）：授权入口是**后端端点**，
		// 必须拼 API base（部署期可为 /api 或网关前缀）；拼站点 base 只会落到
		// SPA 兜底页——点击后页面原地重载、一个 auth 请求都不发。
		// 企业代码不在这里写 store——只有服务端回跳带的 tenant 才是权威值。
		window.location.assign(`${resolveApiBase()}${wecomAuthorizePath(withCorp ? corp : "", withCorp ? agent : "")}`);
	}

	// 所有登录方式收进同一组 Tabs，同一时刻只渲染当前面板；默认选中企微（见上方 effect），
	// 一键按钮首帧即可见、点一次就走，账号密码收在另一个 tab，不再上下平铺。
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
				<Form.Item
					name="tenant"
					label={t("login:page.tenant.label")}
					extra={t("login:page.tenant.hint")}
					initialValue={tenant}
				>
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

	// 企微一键扫码：默认可见、不藏在 tab 里，点一次即进入企微授权（浏览器扫码 / 企微内静默）。
	// 企业代码 / 应用 ID 收进折叠，只服务服务商多企业场景；单企业部署用户什么都不用填。
	const wecomCorpId = "wecom-corp";
	const wecomAgentId = "wecom-agent";
	const wecomQuickPanel = (
		<>
			<Typography.Paragraph type="secondary">
				{t("login:method.wecom.scan.hint")}
			</Typography.Paragraph>
			<Button type="primary" block size="large" onClick={() => wecomLogin()}>
				{t("login:method.wecom.scan.action")}
			</Button>
			<Button type="link" size="small" block onClick={() => setShowOtherCorp(v => !v)}>
				{t(showOtherCorp ? "login:method.wecom.otherCorpHide" : "login:method.wecom.otherCorp")}
			</Button>
			{showOtherCorp && (
				<Form layout="vertical" onFinish={() => wecomLogin(true)} style={{ marginTop: 8 }}>
					<Form.Item label={t("login:page.tenant.label")} htmlFor={wecomCorpId} extra={t("login:method.wecom.hint")}>
						<Input id={wecomCorpId} autoComplete="off" placeholder="ww..." value={corp} onChange={e => setCorp(e.target.value)} />
					</Form.Item>
					<Form.Item label={t("login:method.wecom.agent")} htmlFor={wecomAgentId} extra={t("login:method.wecom.agentHint")}>
						<Input id={wecomAgentId} autoComplete="off" placeholder="1000..." value={agent} onChange={e => setAgent(e.target.value)} />
					</Form.Item>
					<Button htmlType="submit" block>{t("login:method.wecom.action")}</Button>
				</Form>
			)}
		</>
	);

	function panelOf(m: LoginMethod) {
		if (m === "sso")
			return <Button type="primary" block onClick={ssoLogin}>{t("login:method.sso.action")}</Button>;
		if (m === "wecom")
			return wecomQuickPanel;
		return form(m);
	}

	// 认证态：只展示「认证中」，不渲染任何登录表单（满足「只有登录失败才出现 login」）
	if (phase === "auth") {
		return (
			<>
				<Typography.Title level={3}>
					{t("login:page.title")}
				</Typography.Title>
				<Alert style={{ marginBottom: 16 }} type="info" message={t("login:method.wecom.exchanging")} showIcon />
			</>
		);
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
			{/* 登录方式发现完成前不渲染表单区：否则首帧先画账号密码、再切成默认企微 tab，
			    工作台用户会看到一次无谓的闪动（见 8b06d4e1 的闪屏回归）。 */}
			{!known
				? <Skeleton active paragraph={{ rows: 4 }} />
				: showTabs
					? (
						<Tabs
							destroyInactiveTabPane
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
