// C4 系统设置页（PRD §4.3）：按 group 分 Card；secret 项输入掩码；
// framework.site_title 保存后经 applySiteTitle 立即生效（浏览器标签）；
// market.cdn_url（security 组）服务端仅 superadmin 可写（D11），非 superadmin 输入禁用。
import type { RbacSettingGroup } from "@oj-module/runtime";
import { BasicContent, fetchRbacSettings, fetchRbacUpdateSetting, useUserStore } from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Card, Form, Input } from "antd";
import { useTranslation } from "react-i18next";

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

	const saveMut = useMutation({
		mutationFn: ({ key, value }: { key: string, value: string }) => fetchRbacUpdateSetting(key, value),
		onSuccess: async (_d, v) => {
			if (v.key === "framework.site_title")
				applySiteTitle(v.value);
			message.success(t("common.updateSuccess"));
			await qc.invalidateQueries({ queryKey: ["rbac-settings"] });
		},
	});

	const superOnly = (group: RbacSettingGroup) => group.group === "security" && !isSuper;

	return (
		<BasicContent className="h-full">
			<Form
				form={form}
				layout="vertical"
				initialValues={Object.fromEntries((groups ?? []).flatMap(g => g.items.map(i => [i.key, i.value ?? ""])))}
				onFinish={(v) => {
					for (const g of groups ?? []) {
						for (const item of g.items)
							saveMut.mutate({ key: item.key, value: String(v[item.key] ?? "") });
					}
				}}
			>
				{groups.map(g => (
					<Card key={g.group} title={t(`system:setting.group.${g.group}`, g.group)} className="mb-4">
						{superOnly(g) && <div className="mb-2 text-xs text-gray-400">{t("system:setting.superOnly")}</div>}
						{g.items.map(item => (
							<Form.Item key={item.key} name={item.key} label={item.label_key ? t(item.label_key) : item.key}>
								<Input
									type={item.secret ? "password" : item.type === "bool" ? "text" : "text"}
									disabled={superOnly(g)}
									placeholder={item.default_value ?? undefined}
								/>
							</Form.Item>
						))}
					</Card>
				))}
			</Form>
			{groups.length > 0 && (
				<button type="button" className="ant-btn ant-btn-primary" onClick={() => form.submit()} disabled={saveMut.isPending}>
					{t("common.save")}
				</button>
			)}
		</BasicContent>
	);
}
