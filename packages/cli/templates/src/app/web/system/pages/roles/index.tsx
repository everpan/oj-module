import type { SystemPermissionsGetData, SystemRolesGetData } from "../../__client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Space, Table, Tabs, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { systemPermissionsGet, systemRolesGet } from "../../__client";
import { isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";
import { visibleRoles } from "./visible-roles";

type RoleRow = SystemRolesGetData[number];
type PermRow = SystemPermissionsGetData[number];

/**
 * 角色/权限（C2，只读视图）：写出口唯一为 upsertSolutionPerms（解决方案工具链），
 * 页面不暴露建/删角色与绑定编辑（后端有 POST/DELETE，规格决定不开放 UI）。
 */
export default function RolesPage() {
	const { t } = useTranslation();
	const rolesQuery = useQuery({ queryKey: ["system", "roles"], queryFn: systemRolesGet });
	const permsQuery = useQuery({ queryKey: ["system", "permissions"], queryFn: systemPermissionsGet });
	const rows = visibleRoles(rolesQuery.data ?? []);

	if ((rolesQuery.error && isForbidden(rolesQuery.error)) || (permsQuery.error && isForbidden(permsQuery.error)))
		return <ForbiddenPanel t={t} error={rolesQuery.error ?? permsQuery.error} />;

	const roleColumns = [
		{
			title: t("system:rolesPage.tabRoles"),
			dataIndex: "name",
			render: (name: string, row: RoleRow) => (
				<Space>
					<span>{name}</span>
					{row.builtin ? <Tag>{t("system:rolesPage.builtin")}</Tag> : null}
					{row.deprecated ? <Tag color="default">{t("system:rolesPage.deprecated")}</Tag> : null}
				</Space>
			),
		},
		{ title: t("system:rolesPage.columns.module"), dataIndex: "module" },
		{
			// R2：solution 角色带 title_key → 按当前语言实时翻译，title（安装期解析文本）兜底；
			// 内置角色（builtin）的 title 是种子里的站点默认语言文本，按角色名再兜一层 locale；
			// custom 角色无 key 原样显示 title（对齐下方权限点 title_key 的渲染先例）
			title: t("system:rolesPage.columns.title"),
			dataIndex: "title",
			render: (_: string, row: RoleRow) => {
				if (row.title_key)
					return t(row.title_key, { defaultValue: row.title ?? "" });
				return row.builtin
					? t(`system:rolesPage.roleTitle.${row.name}`, { defaultValue: row.title ?? row.name })
					: row.title;
			},
		},
		{ title: t("system:rolesPage.holders"), dataIndex: "holders" },
		{
			title: t("system:rolesPage.permissions"),
			dataIndex: "permissions",
			render: (perms: string[]) => perms.map(p => <Tag key={p}>{p}</Tag>),
		},
	];

	const permColumns = [
		{
			title: t("system:rolesPage.columns.code"),
			dataIndex: "code",
			render: (code: string, row: PermRow) => (row.deprecated ? <Tag color="default">{code}</Tag> : <span>{code}</span>),
		},
		{ title: t("system:rolesPage.columns.module"), dataIndex: "module" },
		{
			// title_key 是跨模块 namespace（如 wiki:perm.*），本模块 locale 不命中回退 code（R6）
			title: t("system:rolesPage.titleKey"),
			dataIndex: "title_key",
			render: (key: string | null, row: PermRow) => (key ? t(key, { defaultValue: row.code }) : row.code),
		},
		{
			title: t("system:rolesPage.deprecated"),
			dataIndex: "deprecated",
			render: (dep: boolean) => (dep ? <Tag color="default">{t("system:rolesPage.deprecated")}</Tag> : null),
		},
	];

	return (
		<Tabs
			style={{ paddingTop: 16 }}
			items={[
				{
					key: "roles",
					label: t("system:rolesPage.tabRoles"),
					children: (
						<>
							<Alert style={{ marginBottom: 12 }} type="info" showIcon message={t("system:rolesPage.readonlyHint")} />
							<Table rowKey="name" loading={rolesQuery.isLoading} dataSource={rows} columns={roleColumns} pagination={{ hideOnSinglePage: true }} />
						</>
					),
				},
				{
					key: "perms",
					label: t("system:rolesPage.tabPerms"),
					children: (
						<Table rowKey="code" loading={permsQuery.isLoading} dataSource={permsQuery.data ?? []} columns={permColumns} pagination={{ hideOnSinglePage: true }} />
					),
				},
			]}
		/>
	);
}
