import type { TFunction } from "i18next";

import type { SystemSettingsGetData } from "../../__client";

import { useGlobalStore } from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Input, Space, Switch, Tag, Tooltip } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { systemLoginMethodsGet, systemSettingsGet, systemSettingsPut } from "../../__client";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

type SettingItem = SystemSettingsGetData[number]["items"][number];

/**
 * 只动框架键（规格 §3）：按 module 字段过滤，业务自定义键（如 wiki 的 mw_config）与 market.*（security 组，super-only 写）不进入。
 * 登录方式（ldap/sso/wecom）不再作为可编辑设置，收敛为下方只读卡片（与 /login 同源）。
 */
const FRAMEWORK_MODULES = new Set(["framework"]);

/** 单项行：bool → Switch（"1"/"0"）；secret → 只读 ***；其余 Input 失焦/回车保存 */
function SettingRow({ item, t, onSave }: { item: SettingItem, t: TFunction, onSave: (key: string, value: string) => void }) {
	const [draft, setDraft] = useState<string | null>(null);

	const label = item.label_key ? t(item.label_key, { defaultValue: item.key }) : item.key;

	const save = (value: string) => {
		onSave(item.key, value);
		setDraft(null);
	};

	if (item.secret) {
		return (
			<Space>
				<Tooltip title={t("system:settingsPage.secretHint")}>
					<Input style={{ width: 320 }} value="***" disabled />
				</Tooltip>
				<span>{label}</span>
			</Space>
		);
	}

	if (item.type === "bool") {
		return (
			<Space>
				<Switch checked={item.value === "1"} onChange={checked => save(checked ? "1" : "0")} />
				<span>{label}</span>
			</Space>
		);
	}

	return (
		<Space>
			<Input
				style={{ width: 320 }}
				value={draft ?? item.value ?? ""}
				onChange={e => setDraft(e.target.value)}
				onPressEnter={() => draft !== null && save(draft)}
			/>
			<Button type="primary" size="small" disabled={draft === null || draft === item.value} onClick={() => draft !== null && save(draft)}>
				{t("system:common.save")}
			</Button>
			<span>{label}</span>
		</Space>
	);
}

/**
 * 站点设置（PRD §4.3）：GET 按组列（secret 读取面掩码 ***），逐项 PUT 写值。
 * secret 项不可在线改（后端 value 掩码，写回 "***" 会被后端原样入库——禁编辑即防线）。
 */
export default function SettingsPage() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();

	const query = useQuery({ queryKey: ["system", "settings"], queryFn: systemSettingsGet });
	const loginMethodsQuery = useQuery({ queryKey: ["system", "login-methods"], queryFn: systemLoginMethodsGet });

	const putMut = useMutation({
		mutationFn: (body: { key: string, value: string }) => systemSettingsPut(body),
		onSuccess: (_data, vars) => {
			message.success(t("system:settingsPage.saved"));
			queryClient.invalidateQueries({ queryKey: ["system", "settings"] });
			// 站点标题即时生效：DB 为权威，写入 runtime store 后 Logo / 双列侧栏 / 全屏布局
			// 三处立刻刷新，无需刷新页面（其他用户下次启动由 host 的匿名端点注入）。
			if (vars.key === "framework.site_title")
				useGlobalStore.getState().setSiteTitle(vars.value);
		},
		onError: e => message.error(explainError(e, t)),
	});

	if (query.error && isForbidden(query.error))
		return <ForbiddenPanel t={t} error={query.error} />;

	const groups = (query.data ?? [])
		.map(g => ({ ...g, items: g.items.filter(i => FRAMEWORK_MODULES.has(i.module)) }))
		.filter(g => g.items.length > 0);

	const loginMethods = loginMethodsQuery.data?.methods ?? ["local"];

	return (
		<Space direction="vertical" style={{ width: "100%", paddingTop: 16 }}>
			<Card title={t("system:setting.loginMethods")}>
				<Space wrap>
					{loginMethods.map(m => (
						<Tag key={m}>{t(`login:method.${m}`, { defaultValue: m })}</Tag>
					))}
				</Space>
			</Card>
			{groups.map(g => (
				<Card key={g.group} title={t(`system:setting.group.${g.group}`, { defaultValue: g.group })}>
					<Space direction="vertical" style={{ width: "100%" }}>
						{g.items.map(item => (
							<SettingRow key={item.key} item={item} t={t} onSave={(key, value) => putMut.mutate({ key, value })} />
						))}
					</Space>
				</Card>
			))}
		</Space>
	);
}
