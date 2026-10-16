// C1 用户管理页（AC1-7~10 的用户界面）：
// - 用户列表（无口令哈希）+ 建号（B6 前端预检）+ 角色分配（下拉按 module 分组）
// - 管理员重置口令 / 禁用开关（禁用即强退，撤销即强退）
// - 保护红线由服务端硬 enforcement（禁自操作/成员资格/最后超管），前端按当前用户角色显隐：
//   非 superadmin 的操作者不渲染 superadmin/admin 分配项（AC1-8）；自己不渲染操作列
import type { RbacUser } from "@oj-module/runtime";
import {
	BasicButton,
	BasicContent,
	canAssignRole,
	fetchRbacAdminResetPassword,
	fetchRbacCreateUser,
	fetchRbacRoleList,
	fetchRbacSetForbidden,
	fetchRbacUpdateUserRoles,
	fetchRbacUserList,
	groupByModule,
	roleLabel,
	useUserStore,
} from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Form, Input, Modal, Select, Switch, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export default function User() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const qc = useQueryClient();
	const myRoles = useUserStore(s => s.roles);
	const myId = useUserStore(s => s.id);

	const [creating, setCreating] = useState(false);
	const [editingRoles, setEditingRoles] = useState<RbacUser | null>(null);
	const [resetting, setResetting] = useState<RbacUser | null>(null);
	const [form] = Form.useForm();
	const [rolesForm] = Form.useForm();
	const [pwdForm] = Form.useForm();

	const { data: users } = useQuery({ queryKey: ["rbac-users"], queryFn: fetchRbacUserList, initialData: [] });
	const { data: roles } = useQuery({ queryKey: ["rbac-roles"], queryFn: fetchRbacRoleList, initialData: [] });
	const roleGroups = useMemo(() => groupByModule(roles), [roles]);
	// AC1-8：可分配角色 = 当前操作者有权分配的角色
	const assignableGroups = useMemo(
		() => roleGroups
			.map(g => ({ module: g.module, items: g.items.filter(r => canAssignRole(myRoles, r.name)) }))
			.filter(g => g.items.length > 0),
		[roleGroups, myRoles],
	);

	const refresh = () => qc.invalidateQueries({ queryKey: ["rbac-users"] });

	const createMut = useMutation({
		mutationFn: fetchRbacCreateUser,
		onSuccess: async () => {
			message.success(t("common.addSuccess"));
			setCreating(false);
			form.resetFields();
			await refresh();
		},
	});
	const rolesMut = useMutation({
		mutationFn: ({ uid, roles }: { uid: number, roles: string[] }) => fetchRbacUpdateUserRoles(uid, roles),
		onSuccess: async () => {
			message.success(t("common.updateSuccess"));
			setEditingRoles(null);
			await refresh();
		},
	});
	const resetMut = useMutation({
		mutationFn: ({ uid, password }: { uid: number, password: string }) => fetchRbacAdminResetPassword(uid, password),
		onSuccess: async () => {
			message.success(t("system:user.passwordReset"));
			setResetting(null);
			pwdForm.resetFields();
		},
	});
	const forbidMut = useMutation({
		mutationFn: ({ uid, forbidden }: { uid: number, forbidden: boolean }) => fetchRbacSetForbidden(uid, forbidden),
		onSuccess: async () => {
			message.success(t("common.updateSuccess"));
			await refresh();
		},
	});

	return (
		<BasicContent className="h-full">
			<Table<RbacUser>
				rowKey="id"
				dataSource={users}
				pagination={false}
				columns={[
					{ title: t("system:user.username"), dataIndex: "username" },
					{ title: t("system:user.displayName"), dataIndex: "display_name" },
					{ title: t("system:user.email"), dataIndex: "email" },
					{
						title: t("system:user.roles"),
						dataIndex: "roles",
						render: (v: string[]) => v.map(r => <Tag key={r}>{r}</Tag>),
					},
					{
						title: t("system:user.mustChange"),
						dataIndex: "must_change",
						width: 100,
						render: (v: boolean) => (v ? <Tag color="orange">{t("common.yes")}</Tag> : <Tag>{t("common.no")}</Tag>),
					},
					{
						title: t("system:user.forbidden"),
						dataIndex: "is_forbidden",
						width: 100,
						render: (v: boolean, r) => (
							<Switch
								checked={v}
								disabled={String(r.id) === String(myId)}
								onChange={checked => forbidMut.mutate({ uid: r.id, forbidden: checked })}
							/>
						),
					},
					{
						title: t("common.action"),
						key: "action",
						width: 200,
						render: (_, r) => String(r.id) === String(myId)
							? <span className="text-xs text-gray-400">{t("system:user.selfNoOp")}</span>
							: [
								<BasicButton
									key="roles"
									type="link"
									size="small"
									onClick={() => {
										setEditingRoles(r);
										rolesForm.setFieldsValue({ roles: r.roles });
									}}
								>
									{t("system:user.assignRoles")}
								</BasicButton>,
								<BasicButton key="pwd" type="link" size="small" onClick={() => setResetting(r)}>{t("system:user.resetPassword")}</BasicButton>,
							],
					},
				]}
			/>
			<BasicButton type="primary" className="mt-2" onClick={() => setCreating(true)}>{t("system:user.addUser")}</BasicButton>

			<Modal
				open={creating}
				title={t("system:user.addUser")}
				onCancel={() => setCreating(false)}
				onOk={() => form.submit()}
				confirmLoading={createMut.isPending}
				destroyOnHidden
			>
				<Form form={form} layout="vertical" onFinish={v => createMut.mutate(v)}>
					<Form.Item name="username" label={t("system:user.username")} rules={[{ required: true }]}>
						<Input />
					</Form.Item>
					<Form.Item name="password" label={t("system:user.initialPassword")} rules={[{ required: true }, { min: 6, message: t("system:user.passwordMin6") }]}>
						<Input.Password />
					</Form.Item>
					<Form.Item name="displayName" label={t("system:user.displayName")}>
						<Input />
					</Form.Item>
					<Form.Item name="email" label={t("system:user.email")}>
						<Input />
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				open={!!editingRoles}
				title={editingRoles ? `${t("system:user.assignRoles")} — ${editingRoles.username}` : ""}
				onCancel={() => setEditingRoles(null)}
				onOk={() => rolesForm.submit()}
				confirmLoading={rolesMut.isPending}
				destroyOnHidden
			>
				<Form
					form={rolesForm}
					layout="vertical"
					onFinish={v => editingRoles && rolesMut.mutate({ uid: editingRoles.id, roles: v.roles ?? [] })}
				>
					<Form.Item name="roles" label={t("system:user.roles")}>
						<Select
							mode="multiple"
							options={assignableGroups.map(g => ({
								label: g.module,
								options: g.items.map(r => ({ label: roleLabel(r), value: r.name })),
							}))}
						/>
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				open={!!resetting}
				title={resetting ? `${t("system:user.resetPassword")} — ${resetting.username}` : ""}
				onCancel={() => setResetting(null)}
				onOk={() => pwdForm.submit()}
				confirmLoading={resetMut.isPending}
				destroyOnHidden
			>
				<Form
					form={pwdForm}
					layout="vertical"
					onFinish={v => resetting && resetMut.mutate({ uid: resetting.id, password: v.password })}
				>
					<Form.Item name="password" label={t("system:user.initialPassword")} rules={[{ required: true }, { min: 6, message: t("system:user.passwordMin6") }]}>
						<Input.Password />
					</Form.Item>
				</Form>
			</Modal>
		</BasicContent>
	);
}
