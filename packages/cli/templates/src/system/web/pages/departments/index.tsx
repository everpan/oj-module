import type { TreeDataNode } from "antd";

import type { SystemDepartmentsGetData, SystemDepartmentsMembersGetData } from "../../__client/api";

import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	App,
	Button,
	Form,
	Input,
	Modal,
	Popconfirm,
	Select,
	Space,
	Table,
	Tag,
	Tree,
	TreeSelect,
	Typography,
} from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	systemDepartmentsDelete,
	systemDepartmentsDetachPost,
	systemDepartmentsGet,
	systemDepartmentsMembersDelete,
	systemDepartmentsMembersGet,
	systemDepartmentsMembersPost,
	systemDepartmentsMembersPut,
	systemDepartmentsMovePut,
	systemDepartmentsPost,
	systemDepartmentsPut,
	systemUsersGet,
} from "../../__client/api";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

type DeptRow = SystemDepartmentsGetData[number];
type MemberRow = SystemDepartmentsMembersGetData[number];

/** 组装 antd 树数据。后端下发平表（响应契约不支持递归 schema），树在这里拼。 */
function buildTreeData(rows: DeptRow[], titleOf: (d: DeptRow) => React.ReactNode): TreeDataNode[] {
	const byId = new Map(rows.map(d => [d.id, d]));
	const childIds = new Map<number, number[]>();
	for (const d of rows) {
		if (d.parentId != null && byId.has(d.parentId))
			(childIds.get(d.parentId) ?? childIds.set(d.parentId, []).get(d.parentId)!).push(d.id);
	}
	// 两条脏数据防线（外部源可见范围裁剪的必然产物，不是 bug）：
	//   · emitted：每个节点只挂一次——成环时不会无限递归，环上未挂到的节点补挂到根；
	//   · depth：兜底，防御性上限，正常数据远达不到。
	const emitted = new Set<number>();
	const build = (d: DeptRow, depth: number): TreeDataNode | null => {
		if (emitted.has(d.id) || depth > 32)
			return null;
		emitted.add(d.id);
		return {
			key: d.id,
			title: titleOf(d),
			children: (childIds.get(d.id) ?? [])
				.map(id => build(byId.get(id)!, depth + 1))
				.filter((n): n is TreeDataNode => n !== null),
		};
	};
	const roots = rows.filter(d => d.parentId == null || !byId.has(d.parentId)).map(d => build(d, 0));
	// 环上节点：父存在但永远轮不到挂（父在环里）→ 补挂到根，保证一个不丢
	for (const d of rows) {
		if (!emitted.has(d.id))
			roots.push(build(d, 0));
	}
	return roots.filter((n): n is TreeDataNode => n !== null);
}

/** 归属权 → 人话标签（local = 本站可改；其余 = 适配器管辖，改前须「转为本地维护」） */
function originTag(origin: string, t: (k: string, opts?: { defaultValue?: string }) => string): React.ReactNode {
	if (origin === "local")
		return <Tag>{t("system:departments.origin.local")}</Tag>;
	return <Tag color="blue">{t(`system:departments.origin.${origin}`, { defaultValue: origin })}</Tag>;
}

/** 部门管理页：树形增删改 + 成员维护 + 转为本地维护（D14 保底出口）。 */
export default function DepartmentsPage() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();

	const [editOpen, setEditOpen] = useState(false);
	const [editing, setEditing] = useState<DeptRow | null>(null);
	const [form] = Form.useForm<{ name: string, nameEn?: string, parentId?: number | null, orderNo?: number }>();
	const [memberDept, setMemberDept] = useState<DeptRow | null>(null);
	const [addUid, setAddUid] = useState<number | null>(null);

	const deptsQuery = useQuery({ queryKey: ["system", "departments"], queryFn: systemDepartmentsGet });
	const usersQuery = useQuery({ queryKey: ["system", "users"], queryFn: systemUsersGet });
	const membersQuery = useQuery({
		queryKey: ["system", "departments", "members", memberDept?.id],
		queryFn: () => systemDepartmentsMembersGet({ id: memberDept!.id }),
		enabled: memberDept !== null,
	});

	const rows = useMemo(() => deptsQuery.data ?? [], [deptsQuery.data]);
	const invalidateAll = () => {
		queryClient.invalidateQueries({ queryKey: ["system", "departments"] });
		queryClient.invalidateQueries({ queryKey: ["system", "departments", "members"] });
	};
	const onError = (e: unknown) => message.error(explainError(e, t));

	const createMut = useMutation({
		mutationFn: (input: { name: string, nameEn?: string | null, parentId?: number | null, orderNo?: number }) => systemDepartmentsPost(input),
		onSuccess: () => {
			message.success(t("system:common.saved"));
			setEditOpen(false);
			form.resetFields();
			invalidateAll();
		},
		onError,
	});

	const updateMut = useMutation({
		mutationFn: (input: { id: number, body: { name?: string, nameEn?: string | null, orderNo?: number } }) => systemDepartmentsPut({ query: { id: input.id }, body: input.body }),
		onSuccess: () => {
			message.success(t("system:common.saved"));
			setEditOpen(false);
			invalidateAll();
		},
		onError,
	});

	const moveMut = useMutation({
		mutationFn: (input: { id: number, parentId: number | null }) => systemDepartmentsMovePut({ query: { id: input.id }, body: { parentId: input.parentId } }),
		onSuccess: invalidateAll,
		onError,
	});

	const deleteMut = useMutation({
		mutationFn: (id: number) => systemDepartmentsDelete({ id }),
		onSuccess: invalidateAll,
		onError,
	});

	const detachMut = useMutation({
		mutationFn: (id: number) => systemDepartmentsDetachPost({ id }),
		onSuccess: () => {
			message.success(t("system:common.saved"));
			invalidateAll();
		},
		onError,
	});

	const addMemberMut = useMutation({
		mutationFn: (input: { id: number, userId: number }) => systemDepartmentsMembersPost({ query: { id: input.id }, body: { userId: input.userId } }),
		onSuccess: () => {
			setAddUid(null);
			invalidateAll();
		},
		onError,
	});

	const updateMemberMut = useMutation({
		mutationFn: (input: { id: number, userId: number, body: { isLeader?: boolean, isMain?: boolean } }) => systemDepartmentsMembersPut({ query: { id: input.id, userId: input.userId }, body: input.body }),
		onSuccess: invalidateAll,
		onError,
	});

	const removeMemberMut = useMutation({
		mutationFn: (input: { id: number, userId: number }) => systemDepartmentsMembersDelete({ id: input.id, userId: input.userId }),
		onSuccess: invalidateAll,
		onError,
	});

	// 父级选择器：排除自己及其子孙（选了会被后端判环 400，不如不给）
	const parentOptions = useMemo(() => {
		if (!editing)
			return rows.map(d => ({ title: d.name ?? `#${d.id}`, value: d.id }));
		const banned = new Set<number>([editing.id]);
		for (let grew = true; grew;) {
			grew = false;
			for (const d of rows) {
				if (d.parentId != null && banned.has(d.parentId) && !banned.has(d.id)) {
					banned.add(d.id);
					grew = true;
				}
			}
		}
		return rows.filter(d => !banned.has(d.id)).map(d => ({ title: d.name ?? `#${d.id}`, value: d.id }));
	}, [rows, editing]);

	const treeData = useMemo(() => buildTreeData(rows, (d) => {
		const editable = d.origin === "local";
		return (
			<Space size={4} wrap>
				<Typography.Text strong>{d.name ?? t("system:departments.unnamed")}</Typography.Text>
				{originTag(d.origin, t)}
				<Typography.Text type="secondary">{`${t("system:departments.memberCount")} ${d.memberCount}`}</Typography.Text>
				{!d.syncVisible ? <Tag color="orange">{t("system:departments.hidden")}</Tag> : null}
				{!d.deleted ? null : <Tag color="red">{t("system:departments.removed")}</Tag>}
				<Button
					size="small"
					type="link"
					onClick={() => {
						setEditing(d);
						form.setFieldsValue({ name: d.name ?? "", nameEn: d.nameEn ?? undefined, parentId: d.parentId, orderNo: d.orderNo });
						setEditOpen(true);
					}}
				>
					{editable ? t("system:common.edit") : t("system:departments.view")}
				</Button>
				<Button
					size="small"
					type="link"
					onClick={() => {
						setMemberDept(d);
						setAddUid(null);
					}}
				>
					{t("system:departments.members")}
				</Button>
				{editable
					? (
						<Popconfirm title={t("system:departments.confirmDelete")} onConfirm={() => deleteMut.mutate(d.id)}>
							<Button size="small" type="link" danger>{t("system:common.delete")}</Button>
						</Popconfirm>
					)
					: (
						<Popconfirm
							title={t("system:departments.detach")}
							description={t("system:departments.detachHint")}
							onConfirm={() => detachMut.mutate(d.id)}
						>
							<Button size="small" type="link">{t("system:departments.detach")}</Button>
						</Popconfirm>
					)}
			</Space>
		);
	}), [rows, t, form, deleteMut, detachMut]);

	if (deptsQuery.error && isForbidden(deptsQuery.error))
		return <ForbiddenPanel t={t} error={deptsQuery.error} />;

	const memberColumns = [
		{
			title: t("system:departments.memberColumns.user"),
			dataIndex: "username",
			render: (_: unknown, row: MemberRow) => (row.displayName ? `${row.displayName}（${row.username}）` : row.username),
		},
		{
			title: t("system:departments.memberColumns.main"),
			dataIndex: "isMain",
			render: (isMain: boolean, row: MemberRow) => (
				<Popconfirm
					title={t("system:departments.memberColumns.main")}
					onConfirm={() => updateMemberMut.mutate({ id: row.deptId, userId: row.userId, body: { isMain: !isMain } })}
				>
					<Tag color={isMain ? "green" : undefined}>{isMain ? t("system:departments.yes") : t("system:departments.no")}</Tag>
				</Popconfirm>
			),
		},
		{
			title: t("system:departments.memberColumns.leader"),
			dataIndex: "isLeader",
			render: (isLeader: boolean, row: MemberRow) => (
				<Popconfirm
					title={t("system:departments.memberColumns.leader")}
					onConfirm={() => updateMemberMut.mutate({ id: row.deptId, userId: row.userId, body: { isLeader: !isLeader } })}
				>
					<Tag color={isLeader ? "blue" : undefined}>{isLeader ? t("system:departments.yes") : t("system:departments.no")}</Tag>
				</Popconfirm>
			),
		},
		{
			title: t("system:departments.memberColumns.actions"),
			key: "actions",
			render: (_: unknown, row: MemberRow) => (
				<Popconfirm
					title={t("system:departments.confirmRemoveMember")}
					onConfirm={() => removeMemberMut.mutate({ id: row.deptId, userId: row.userId })}
				>
					<Button size="small" type="link" danger>{t("system:departments.removeMember")}</Button>
				</Popconfirm>
			),
		},
	];

	return (
		<Space direction="vertical" style={{ width: "100%", paddingTop: 16 }}>
			<Space>
				<Button
					type="primary"
					icon={<PlusOutlined />}
					onClick={() => {
						setEditing(null);
						form.resetFields();
						setEditOpen(true);
					}}
				>
					{t("system:departments.create")}
				</Button>
				<Typography.Text type="secondary">{t("system:departments.createHint")}</Typography.Text>
			</Space>

			<Tree blockNode defaultExpandAll treeData={treeData} />

			<Modal
				title={editing ? t("system:departments.edit") : t("system:departments.create")}
				open={editOpen}
				onCancel={() => setEditOpen(false)}
				confirmLoading={createMut.isPending || updateMut.isPending}
				onOk={() => form.submit()}
			>
				<Form
					form={form}
					layout="vertical"
					onFinish={(values) => {
						const parentId = values.parentId ?? null;
						if (!editing) {
							createMut.mutate({ name: values.name, nameEn: values.nameEn ?? null, parentId, orderNo: values.orderNo });
							return;
						}
						if (editing.origin === "local")
							updateMut.mutate({ id: editing.id, body: { name: values.name, nameEn: values.nameEn ?? null, orderNo: values.orderNo } });
						if (parentId !== editing.parentId)
							moveMut.mutate({ id: editing.id, parentId });
					}}
				>
					<Form.Item name="name" label={t("system:departments.columns.name")} rules={[{ required: true }]}>
						<Input disabled={editing !== null && editing.origin !== "local"} />
					</Form.Item>
					<Form.Item name="nameEn" label={t("system:departments.columns.nameEn")}>
						<Input disabled={editing !== null && editing.origin !== "local"} />
					</Form.Item>
					<Form.Item name="parentId" label={t("system:departments.columns.parent")}>
						<TreeSelect allowClear treeData={parentOptions} placeholder={t("system:departments.root")} />
					</Form.Item>
				</Form>
				{editing && editing.origin !== "local"
					? (
						<Space>
							<Typography.Text type="secondary">{t("system:departments.readonlyHint")}</Typography.Text>
							<Button size="small" type="link" onClick={() => detachMut.mutate(editing.id)}>
								{t("system:departments.detach")}
							</Button>
						</Space>
					)
					: null}
			</Modal>

			<Modal
				width={720}
				title={`${t("system:departments.members")}：${memberDept?.name ?? ""}`}
				open={memberDept !== null}
				onCancel={() => setMemberDept(null)}
				footer={null}
			>
				<Space style={{ marginBottom: 12 }}>
					<Select
						style={{ minWidth: 240 }}
						placeholder={t("system:departments.selectUser")}
						value={addUid ?? undefined}
						onChange={v => setAddUid(v)}
						options={(usersQuery.data ?? []).map(u => ({ label: u.display_name ? `${u.display_name}（${u.username}）` : u.username, value: u.id }))}
					/>
					<Button
						type="primary"
						disabled={addUid === null || !memberDept}
						loading={addMemberMut.isPending}
						onClick={() => memberDept && addUid !== null && addMemberMut.mutate({ id: memberDept.id, userId: addUid })}
					>
						{t("system:departments.addMember")}
					</Button>
				</Space>
				<Table
					rowKey="userId"
					size="small"
					loading={membersQuery.isLoading}
					dataSource={membersQuery.data ?? []}
					columns={memberColumns}
					pagination={{ hideOnSinglePage: true }}
					locale={{ emptyText: t("system:departments.noMembers") }}
				/>
			</Modal>
		</Space>
	);
}
