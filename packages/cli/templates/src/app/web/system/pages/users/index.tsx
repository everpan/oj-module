import type { SystemUsersGetData } from "../../__client";

import { PlusOutlined } from "@ant-design/icons";
import { useUserStore } from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, TreeSelect, Typography } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useNavigate } from "react-router";

import { systemDepartmentsGet, systemUsersForbiddenPut, systemUsersGet, systemUsersPasswordPut, systemUsersPost } from "../../__client";
import { buildTreeData, subtreeIds } from "../departments/tree";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";
import { canManageUser } from "./can-manage";

type UserRow = SystemUsersGetData[number];

/**
 * 用户管理（C1）：GET /system/users 列表 + 建号 / 禁用切换 / 重置口令。
 * 本人行禁用一切自操作（后端 assertNotSelf 400 兜底，前端不给会失败的按钮，R3）；
 * superadmin 行也禁用一切操作，除非当前登录者是 superadmin（红线：只有 superadmin 能改
 * superadmin——后端 assertCanManageTarget 403 兜底，前端把按钮置灰）；
 * 成员资格入口：superadmin 与 **本租户 admin** 均可见（授予 admin 已下放到租户内，
 * 但授予 superadmin 仍只许 superadmin——见 domain/users.ts::assertMembershipAllowed）。
 * 部门列标出主部门，顶部可按部门筛选（含子部门）——筛选在前端做，名单本来就是一页全量。
 */
export default function UsersPage() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const me = useUserStore(s => s.id);
	const myRoles = useUserStore(s => s.roles);
	const isSuper = myRoles.includes("superadmin");
	// 任命本租户管理员已下放到租户内的 admin（提权到 superadmin 仍只许 superadmin）
	const canManageMembership = isSuper || myRoles.includes("admin");

	const [createOpen, setCreateOpen] = useState(false);
	const [createForm] = Form.useForm<{ username: string, password: string, displayName?: string, email?: string }>();
	const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);
	const [pwdForm] = Form.useForm<{ password: string }>();
	const [deptId, setDeptId] = useState<number | null>(null);

	const usersQuery = useQuery({ queryKey: ["system", "users"], queryFn: systemUsersGet });
	// 与部门页共用同一份缓存键：那边改完部门，这边的筛选树也跟着新
	const deptQuery = useQuery({ queryKey: ["system", "departments"], queryFn: systemDepartmentsGet });

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

	const deptRows = useMemo(() => deptQuery.data ?? [], [deptQuery.data]);
	const deptTree = useMemo(() => buildTreeData(deptRows, d => d.name ?? `#${d.id}`), [deptRows]);
	// 选中部门 + 全部子部门：筛「研发部」要能带出「研发部/前端组」的人
	const scope = useMemo(() => (deptId == null ? null : subtreeIds(deptRows, [deptId])), [deptRows, deptId]);
	const visibleUsers = useMemo(() => {
		const all = usersQuery.data ?? [];
		return scope ? all.filter(u => u.departments.some(d => scope.has(d.id))) : all;
	}, [usersQuery.data, scope]);

	if (usersQuery.error && isForbidden(usersQuery.error))
		return <ForbiddenPanel t={t} error={usersQuery.error} />;

	const columns = [
		{ title: t("system:users.columns.username"), dataIndex: "username" },
		{ title: t("system:users.columns.displayName"), dataIndex: "display_name" },
		{ title: t("system:users.columns.position"), dataIndex: "position" },
		{
			title: t("system:users.columns.departments"),
			dataIndex: "departments",
			render: (departments: UserRow["departments"]) => departments.length === 0
				? <Typography.Text type="secondary">—</Typography.Text>
				: departments.map(d => (
					<Tag key={d.id} color={d.isMain ? "blue" : undefined}>
						{d.name ?? `#${d.id}`}
						{d.isMain ? ` · ${t("system:users.mainDept")}` : ""}
					</Tag>
				)),
		},
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
						// 置灰的 Switch 不会触发 Popconfirm，这里只是把「为什么点不了」挡在确认框之前
						disabled={String(row.id) === me || !canManageUser(myRoles, row.roles)}
					>
						<Switch size="small" checked={forbidden} disabled={String(row.id) === me || !canManageUser(myRoles, row.roles)} />
					</Popconfirm>
					{row.must_change ? <Tag color="orange">{t("system:users.firstLoginHint")}</Tag> : null}
				</Space>
			),
		},
		{
			title: t("system:users.columns.actions"),
			key: "actions",
			render: (_: unknown, row: UserRow) => {
				const manageable = canManageUser(myRoles, row.roles);
				return (
					<Space>
						<Button size="small" disabled={String(row.id) === me || !manageable} onClick={() => setPwdTarget(row)}>
							{t("system:users.resetPwd")}
						</Button>
						{canManageMembership
							? (
								<Button size="small" type="link" disabled={!manageable} onClick={() => navigate(`/system/users/${row.id}/roles`)}>
									{t("system:users.membership")}
								</Button>
							)
							: null}
					</Space>
				);
			},
		},
	];

	return (
		<Space direction="vertical" style={{ width: "100%", paddingTop: 16 }}>
			<Space wrap>
				<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
					{t("system:users.create")}
				</Button>
				<TreeSelect
					allowClear
					showSearch
					treeNodeFilterProp="title"
					loading={deptQuery.isLoading}
					style={{ width: 240 }}
					placeholder={t("system:users.filterDept")}
					treeData={deptTree}
					// 树是按 antd Tree 口径拼的（key/title），TreeSelect 认的是 value —— 这里换名映射
					fieldNames={{ label: "title", value: "key", children: "children" }}
					value={deptId ?? undefined}
					onChange={(v?: number) => setDeptId(v ?? null)}
				/>
			</Space>
			<Table
				rowKey="id"
				loading={usersQuery.isLoading}
				dataSource={visibleUsers}
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
