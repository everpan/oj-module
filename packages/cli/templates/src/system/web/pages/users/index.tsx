import type { SystemUsersGetData } from "../../__client/api";

import { PlusOutlined } from "@ant-design/icons";
import { useUserStore } from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useNavigate } from "react-router";

import { systemUsersForbiddenPut, systemUsersGet, systemUsersPasswordPut, systemUsersPost } from "../../__client/api";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

type UserRow = SystemUsersGetData[number];

/**
 * 用户管理（C1）：GET /system/users 列表 + 建号 / 禁用切换 / 重置口令。
 * 本人行禁用一切自操作（后端 assertNotSelf 400 兜底，前端不给会失败的按钮，R3）；
 * 成员资格入口仅 superadmin 可见（成员资格写是 superadmin-only，规格 §4）。
 */
export default function UsersPage() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const me = useUserStore(s => s.id);
	const myRoles = useUserStore(s => s.roles);
	const isSuper = myRoles.includes("superadmin");

	const [createOpen, setCreateOpen] = useState(false);
	const [createForm] = Form.useForm<{ username: string, password: string, displayName?: string, email?: string }>();
	const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);
	const [pwdForm] = Form.useForm<{ password: string }>();

	const usersQuery = useQuery({ queryKey: ["system", "users"], queryFn: systemUsersGet });

	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["system", "users"] });

	const forbiddenMut = useMutation({
		mutationFn: (input: { uid: number, forbidden: boolean }) => systemUsersForbiddenPut({ query: { uid: input.uid }, body: { forbidden: input.forbidden } }),
		onSuccess: invalidate,
		onError: e => message.error(explainError(e, t)),
	});

	const createMut = useMutation({
		mutationFn: (body: { username: string, password: string, displayName?: string, email?: string }) => systemUsersPost(body),
		onSuccess: () => {
			message.success(t("system:users.createOk"));
			setCreateOpen(false);
			createForm.resetFields();
			invalidate();
		},
		onError: e => message.error(explainError(e, t)),
	});

	const pwdMut = useMutation({
		mutationFn: (input: { uid: number, password: string }) => systemUsersPasswordPut({ query: { uid: input.uid }, body: { password: input.password } }),
		onSuccess: () => {
			message.success(t("system:common.saved"));
			setPwdTarget(null);
			pwdForm.resetFields();
			invalidate();
		},
		onError: e => message.error(explainError(e, t)),
	});

	if (usersQuery.error && isForbidden(usersQuery.error))
		return <ForbiddenPanel t={t} error={usersQuery.error} />;

	const columns = [
		{ title: t("system:users.columns.username"), dataIndex: "username" },
		{ title: t("system:users.columns.displayName"), dataIndex: "display_name" },
		{ title: t("system:users.columns.email"), dataIndex: "email" },
		{
			title: t("system:users.columns.roles"),
			dataIndex: "roles",
			render: (roles: string[]) => roles.map(r => <Tag key={r}>{r}</Tag>),
		},
		{
			title: t("system:users.columns.status"),
			dataIndex: "is_forbidden",
			render: (forbidden: boolean, row: UserRow) => (
				<Space>
					<Popconfirm
						title={t("system:users.forbidden")}
						description={`${row.username} → ${forbidden ? "false" : "true"}`}
						onConfirm={() => forbiddenMut.mutate({ uid: row.id, forbidden: !forbidden })}
					>
						<Switch size="small" checked={forbidden} disabled={String(row.id) === me} />
					</Popconfirm>
					{row.must_change ? <Tag color="orange">{t("system:users.firstLoginHint")}</Tag> : null}
				</Space>
			),
		},
		{
			title: t("system:users.columns.actions"),
			key: "actions",
			render: (_: unknown, row: UserRow) => (
				<Space>
					<Button size="small" disabled={String(row.id) === me} onClick={() => setPwdTarget(row)}>
						{t("system:users.resetPwd")}
					</Button>
					{isSuper
						? (
							<Button size="small" type="link" onClick={() => navigate(`/system/users/${row.id}/roles`)}>
								{t("system:users.membership")}
							</Button>
						)
						: null}
				</Space>
			),
		},
	];

	return (
		<Space direction="vertical" style={{ width: "100%", paddingTop: 16 }}>
			<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
				{t("system:users.create")}
			</Button>
			<Table
				rowKey="id"
				loading={usersQuery.isLoading}
				dataSource={usersQuery.data ?? []}
				columns={columns}
				pagination={{ hideOnSinglePage: true }}
			/>

			<Modal
				title={t("system:users.create")}
				open={createOpen}
				onCancel={() => setCreateOpen(false)}
				confirmLoading={createMut.isPending}
				onOk={() => createForm.submit()}
			>
				<Form form={createForm} layout="vertical" onFinish={values => createMut.mutate(values)}>
					<Form.Item name="username" label={t("system:users.columns.username")} rules={[{ required: true }]} extra="ldap:/ sso:/ wecom: 为外部身份源保留">
						<Input />
					</Form.Item>
					<Form.Item name="password" label="Password" rules={[{ required: true }, { min: 6 }]} extra={t("system:users.pwdPlaceholder")}>
						<Input.Password />
					</Form.Item>
					<Form.Item name="displayName" label={t("system:users.columns.displayName")}>
						<Input />
					</Form.Item>
					<Form.Item name="email" label={t("system:users.columns.email")}>
						<Input />
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				title={`${t("system:users.resetPwd")}: ${pwdTarget?.username ?? ""}`}
				open={pwdTarget !== null}
				onCancel={() => setPwdTarget(null)}
				confirmLoading={pwdMut.isPending}
				onOk={() => pwdForm.submit()}
			>
				<Form form={pwdForm} layout="vertical" onFinish={values => pwdTarget && pwdMut.mutate({ uid: pwdTarget.id, password: values.password })}>
					<Form.Item name="password" label="Password" rules={[{ required: true }, { min: 6 }]} extra={t("system:users.pwdPlaceholder")}>
						<Input.Password />
					</Form.Item>
				</Form>
			</Modal>
		</Space>
	);
}
