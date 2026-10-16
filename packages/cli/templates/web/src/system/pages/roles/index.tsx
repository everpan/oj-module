import type { SystemPermissionsGetData, SystemRolesGetData } from "../../__client/api";

import { useQuery } from "@tanstack/react-query";
import { Alert, Space, Table, Tabs, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { systemPermissionsGet, systemRolesGet } from "../../__client/api";
import { isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

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

	if ((rolesQuery.error && isForbidden(rolesQuery.error)) || (permsQuery.error && isForbidden(permsQuery.error)))
		return <ForbiddenPanel t={t} />;

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
		{ title: "module", dataIndex: "module" },
		{ title: "title", dataIndex: "title" },
		{ title: t("system:rolesPage.holders"), dataIndex: "holders" },
		{
			title: t("system:rolesPage.permissions"),
			dataIndex: "permissions",
			render: (perms: string[]) => perms.map(p => <Tag key={p}>{p}</Tag>),
		},
	];

	const permColumns = [
		{
			title: "code",
			dataIndex: "code",
			render: (code: string, row: PermRow) => (row.deprecated ? <Tag color="default">{code}</Tag> : <span>{code}</span>),
		},
		{ title: "module", dataIndex: "module" },
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
			items={[
				{
					key: "roles",
					label: t("system:rolesPage.tabRoles"),
					children: (
						<>
							<Alert style={{ marginBottom: 12 }} type="info" showIcon message={t("system:rolesPage.readonlyHint")} />
							<Table rowKey="name" loading={rolesQuery.isLoading} dataSource={rolesQuery.data ?? []} columns={roleColumns} pagination={{ hideOnSinglePage: true }} />
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
