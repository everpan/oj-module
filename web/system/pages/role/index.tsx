// C2 角色管理页（AC1-15~20/28/30 的用户界面）：
// - 新建角色：机器名强制 custom.<slug> + 展示名 + 勾选绑定（跨模块，AC1-16）
// - 绑定编辑：声明/自定义角色的整集替换；deprecated 已绑定项标灰（AC1-18/§5）
// - builtin（superadmin/admin/editor/viewer）无绑定编辑入口、无删除按钮（AC1-19）
// - 删除：占用中禁删（服务端 409 权威， holders>0 时按钮置灰并提示，AC1-20）
// - 手动摘绑定 = deprecated 紧急吊销出口（AC1-30）：绑定编辑器里取消勾选即吊销，下一次请求即 403
import type { RbacRole } from "@oj-module/runtime";
import {
	BasicButton,
	BasicContent,
	canDeleteRole,
	canEditRoleBindings,
	fetchRbacCreateRole,
	fetchRbacDeleteRole,
	fetchRbacPermissionList,
	fetchRbacRoleList,
	fetchRbacUpdateBindings,
	groupByModule,
	roleLabel,
} from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Modal, Popconfirm, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BindingsEditor } from "./components/bindings-editor";
import { RoleForm } from "./components/role-form";

export default function Role() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const qc = useQueryClient();
	const [editing, setEditing] = useState<RbacRole | null>(null);
	const [creating, setCreating] = useState(false);

	const { data: roles } = useQuery({ queryKey: ["rbac-roles"], queryFn: fetchRbacRoleList, initialData: [] });
	const { data: permissions } = useQuery({ queryKey: ["rbac-permissions"], queryFn: fetchRbacPermissionList, initialData: [] });
	const permissionGroups = useMemo(() => groupByModule(permissions), [permissions]);

	const refresh = () => qc.invalidateQueries({ queryKey: ["rbac-roles"] });

	const createMut = useMutation({
		mutationFn: fetchRbacCreateRole,
		onSuccess: async () => {
			message.success(t("common.addSuccess"));
			setCreating(false);
			await refresh();
		},
	});
	const bindingsMut = useMutation({
		mutationFn: ({ name, permissions }: { name: string, permissions: string[] }) => fetchRbacUpdateBindings(name, permissions),
		onSuccess: async () => {
			message.success(t("common.updateSuccess"));
			setEditing(null);
			await refresh();
		},
	});
	const deleteMut = useMutation({
		mutationFn: fetchRbacDeleteRole,
		onSuccess: async () => {
			message.success(t("common.deleteSuccess"));
			await refresh();
		},
		onError: (e) => {
			// AC1-20：占用禁删——服务端 409 holders 提示经错误吐司透出
			message.error((e as Error).message || t("common.deleteFailed"));
		},
	});

	return (
		<BasicContent className="h-full">
			<Table<RbacRole>
				rowKey="name"
				dataSource={roles}
				pagination={false}
				columns={[
					{ title: t("system:role.machineName"), dataIndex: "name" },
					{
						title: t("system:role.displayName"),
						dataIndex: "title",
						render: (v: string | null, r) => roleLabel(r),
					},
					{ title: t("system:role.module"), dataIndex: "module", width: 120 },
					{
						title: t("system:role.builtin"),
						dataIndex: "builtin",
						width: 90,
						render: (v: boolean) => (v ? <Tag color="blue">{t("common.yes")}</Tag> : <Tag>{t("common.no")}</Tag>),
					},
					{ title: t("system:role.holders"), dataIndex: "holders", width: 90 },
					{
						title: t("system:role.bindings"),
						dataIndex: "permissions",
						render: (v: string[]) => (
							<span className="text-xs">
								{v.length}
								{v.length > 0 && `（${v.slice(0, 3).join("、")}${v.length > 3 ? "…" : ""}）`}
							</span>
						),
					},
					{
						title: t("common.action"),
						key: "action",
						width: 160,
						render: (_, r) => [
							canEditRoleBindings(r) && (
								<BasicButton key="bind" type="link" size="small" onClick={() => setEditing(r)}>
									{t("system:role.editBindings")}
								</BasicButton>
							),
							canDeleteRole(r) && (
								<Popconfirm
									key="del"
									title={t("common.confirmDelete")}
									onConfirm={() => deleteMut.mutate(r.name)}
								>
									<BasicButton type="link" size="small" danger>{t("common.delete")}</BasicButton>
								</Popconfirm>
							),
							// AC1-19：builtin 无编辑/删除入口——这里渲染占位提示而非禁用按钮，避免「看起来能点」
							r.builtin && (
								<span key="na" className="text-xs text-gray-400">{t("system:role.builtinNoEdit")}</span>
							),
						],
					},
				]}
			/>
			<BasicButton type="primary" className="mt-2" onClick={() => setCreating(true)}>
				{t("system:role.addRole")}
			</BasicButton>

			<Modal
				open={creating}
				title={t("system:role.addRole")}
				onCancel={() => setCreating(false)}
				onOk={() => {
					const f = document.getElementById("rbac-role-form") as HTMLFormElement | null;
					f?.requestSubmit();
				}}
				confirmLoading={createMut.isPending}
				destroyOnHidden
			>
				<RoleForm
					permissions={permissions}
					onSubmit={v => createMut.mutate(v)}
				/>
			</Modal>

			<Modal
				open={!!editing}
				title={editing ? `${t("system:role.editBindings")} — ${roleLabel(editing)}` : ""}
				onCancel={() => setEditing(null)}
				onOk={() => {
					const f = document.getElementById("rbac-bindings-form") as HTMLFormElement | null;
					f?.requestSubmit();
				}}
				confirmLoading={bindingsMut.isPending}
				destroyOnHidden
				width={640}
			>
				{editing && (
					<BindingsEditor
						role={editing}
						permissionGroups={permissionGroups}
						onSubmit={permissions => bindingsMut.mutate({ name: editing.name, permissions })}
					/>
				)}
			</Modal>
		</BasicContent>
	);
}
