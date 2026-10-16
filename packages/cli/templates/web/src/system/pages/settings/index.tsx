import type { TFunction } from "i18next";

import type { SystemSettingsGetData } from "../../__client/api";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Input, Space, Switch, Tooltip } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { systemSettingsGet, systemSettingsPut } from "../../__client/api";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

type SettingItem = SystemSettingsGetData[number]["items"][number];

/** 只动框架键（规格 §3）：按 module 字段过滤，业务自定义键（如 wiki 的 mw_config）与 market.*（security 组，super-only 写）不进入 */
const FRAMEWORK_MODULES = new Set(["framework", "ldap", "sso"]);

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

	const putMut = useMutation({
		mutationFn: (body: { key: string, value: string }) => systemSettingsPut({ body }),
		onSuccess: () => {
			message.success(t("system:settingsPage.saved"));
			queryClient.invalidateQueries({ queryKey: ["system", "settings"] });
		},
		onError: e => message.error(explainError(e, t)),
	});

	if (query.error && isForbidden(query.error))
		return <ForbiddenPanel t={t} />;

	const groups = (query.data ?? [])
		.map(g => ({ ...g, items: g.items.filter(i => FRAMEWORK_MODULES.has(i.module)) }))
		.filter(g => g.items.length > 0);

	return (
		<Space direction="vertical" style={{ width: "100%" }}>
			{groups.map(g => (
				<Card key={g.group} title={g.group}>
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
