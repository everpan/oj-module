// C4 系统设置页（PRD §4.3）+ 三层嵌套（P1-14，R20）：框架组在前（按 group 聚合，维持现状渲染）、
// 「解决方案设置」区段在后（groupSettingsByModule 按模块分组，标题 = label_key → <name>:settings.group.*）；
// secret 项输入掩码；framework.site_title 保存后经 applySiteTitle 立即生效（浏览器标签）；
// framework.market_cdn_url（security 组）服务端仅 superadmin 可写（D11），非 superadmin 输入禁用；
// 管理市场未装时本页显示 ojm install 引导卡（R26 空态：管理区唯一必经页，消费 useSolutionRoutes）。
// 保存语义（R20）：脏组增量提交——只提交有改动的设置项，按组聚合反馈（部分失败不静默）。
import type { RbacSettingCard } from "@oj-module/runtime";
import { BasicContent, fetchLoginMethods, fetchRbacSettings, fetchRbacUpdateSetting, groupSettingsByModule, useSolutionRoutes, useUserStore } from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Card, Form, Input, Tag } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/**
 * 登录方式开关（ldap.enabled / sso.enabled / wecom.enabled）：不再作为可编辑设置项，
 * 其开关数据源保留在 sys_setting，但展示收敛为「系统设置」内的只读卡片（与 /login 一致）。
 */
const LOGIN_METHOD_KEYS = new Set(["ldap.enabled", "sso.enabled", "wecom.enabled"]);

function applySiteTitle(title: string) {
	if (title)
		document.title = title;
}

export default function Settings() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const qc = useQueryClient();
	const myRoles = useUserStore(s => s.roles);
	const isSuper = myRoles.includes("superadmin");
	const [form] = Form.useForm();

	const { data: groups } = useQuery({ queryKey: ["rbac-settings"], queryFn: fetchRbacSettings, initialData: [] });
	// 登录方式开关（LOGIN_METHOD_KEYS）从可编辑设置中剔除——其展示收敛为下方只读卡片。
	const cards: RbacSettingCard[] = groupSettingsByModule(
		(groups ?? []).flatMap(g => g.items).filter(i => !LOGIN_METHOD_KEYS.has(i.key)),
	).filter(c => c.items.length > 0);

	// 当前登录方式（只读，与 /login 同源：listLoginMethods 按 ldap/sso/wecom 开关派生）。
	const { data: loginMethodsData } = useQuery({ queryKey: ["settings-login-methods"], queryFn: fetchLoginMethods, retry: false, staleTime: 60_000 });
	const loginMethodsList = loginMethodsData?.methods ?? ["local"];

	// 服务端现值快照：脏组判定基准（保存成功后同步，避免回写刚保存的值再被判脏）
	const savedRef = useRef<Record<string, string>>({});
	useEffect(() => {
		savedRef.current = Object.fromEntries((groups ?? []).flatMap(g => g.items.map(i => [i.key, i.value ?? ""])));
	}, [groups]);

	const saveMut = useMutation({
		mutationFn: async () => {
			const values = form.getFieldsValue() as Record<string, unknown>;
			// 脏组增量提交（R20）：每组只提交相对快照有改动的项；组内全部命中才算该组成功
			const dirty = cards.map(card => ({
				card,
				items: card.items.filter(i => String(values[i.key] ?? "") !== (savedRef.current[i.key] ?? "")),
			})).filter(c => c.items.length > 0);
			const results = await Promise.allSettled(dirty.map(c =>
				Promise.all(c.items.map(i => fetchRbacUpdateSetting(i.key, String(values[i.key] ?? "")))),
			));
			for (const [i, r] of results.entries()) {
				if (r.status === "fulfilled") {
					for (const item of dirty[i]!.items) {
						savedRef.current[item.key] = String(values[item.key] ?? "");
						if (item.key === "framework.site_title")
							applySiteTitle(String(values[item.key] ?? ""));
					}
				}
			}
			return {
				saved: results.filter(r => r.status === "fulfilled").length,
				failed: results.map((r, i) => r.status === "rejected" ? dirty[i]!.card : null).filter((c): c is RbacSettingCard => c !== null),
			};
		},
		onSuccess: async ({ saved, failed }) => {
			if (saved > 0)
				message.success(t("system:setting.saved", { count: saved }));
			if (failed.length > 0) {
				message.error(t("system:setting.saveFailed", { groups: failed.map(c => c.label_key ? t(c.label_key, c.module ?? c.group) : t(`system:setting.group.${c.group}`, c.group)).join("、") }));
			}
			if (saved > 0)
				await qc.invalidateQueries({ queryKey: ["rbac-settings"] });
		},
	});

	const superOnly = (card: RbacSettingCard) => card.group === "security" && !isSuper;
	const frameworkCards = cards.filter(c => c.module === null);
	const solutionCards = cards.filter(c => c.module !== null);
	// R26 空态引导：管理市场（oj-market 方案）未装时给出 ojm install 指引（市场管理页本身随方案安装）
	const marketInstalled = useSolutionRoutes(s => s.routes.some(r => r.module === "oj-market"));

	const renderCard = (card: RbacSettingCard) => (
		<Card
			key={card.module === null ? `fw:${card.group}` : `sol:${card.module}:${card.group}`}
			title={card.label_key ? t(card.label_key, card.module ?? card.group) : t(`system:setting.group.${card.group}`, card.group)}
			className="mb-4"
		>
			{superOnly(card) && <div className="mb-2 text-xs text-gray-400">{t("system:setting.superOnly")}</div>}
			{card.items.map(item => (
				<Form.Item key={item.key} name={item.key} label={item.label_key ? t(item.label_key) : item.key}>
					<Input
						type={item.secret ? "password" : "text"}
						disabled={superOnly(card)}
						placeholder={item.default_value ?? undefined}
					/>
				</Form.Item>
			))}
		</Card>
	);

	return (
		<BasicContent className="h-full">
			<Form form={form} layout="vertical" initialValues={Object.fromEntries(cards.flatMap(c => c.items.map(i => [i.key, i.value ?? ""])))}>
				{frameworkCards.map(renderCard)}
				<Card className="mb-4" title={t("system:setting.loginMethods")}>
					<div className="flex flex-wrap gap-2">
						{loginMethodsList.map(m => (
							<Tag key={m}>{t(`login:method.${m}`, { defaultValue: m })}</Tag>
						))}
					</div>
				</Card>
				{!marketInstalled && (
					<Card className="mb-4" title={t("system:setting.marketAbsentTitle")}>
						<div className="text-sm text-gray-500">
							{t("system:setting.marketAbsentHint")}
							<pre className="mt-2 rounded bg-gray-50 p-2 text-xs dark:bg-gray-800">ojm install oj-market --url &lt;site&gt; --user &lt;superadmin&gt;</pre>
						</div>
					</Card>
				)}
				{solutionCards.length > 0 && (
					<>
						<div className="mb-4 mt-2 text-base font-medium text-gray-500">{t("system:setting.solutions")}</div>
						{solutionCards.map(renderCard)}
					</>
				)}
			</Form>
			{cards.length > 0 && (
				<button type="button" className="ant-btn ant-btn-primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
					{t("common.save")}
				</button>
			)}
		</BasicContent>
	);
}
