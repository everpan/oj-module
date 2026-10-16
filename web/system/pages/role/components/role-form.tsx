// 新建角色表单（AC1-16/17）：机器名强制 custom.<slug>（服务端同名红线的前端预检），
// 展示名必填，绑定勾选按 module 分组（跨模块绑定是 custom 角色的本职场景）。
import type { RbacPermission } from "@oj-module/runtime";
import { Checkbox, Form, Input } from "antd";
import { useTranslation } from "react-i18next";

const CUSTOM_NAME = /^custom\.[a-z0-9][a-z0-9-]*$/;

export function RoleForm({ permissions, onSubmit }: { permissions: RbacPermission[], onSubmit: (v: { name: string, title: string, permissions: string[] }) => void }) {
	const { t } = useTranslation();
	const [form] = Form.useForm();
	return (
		<Form
			id="rbac-role-form"
			form={form}
			layout="vertical"
			onFinish={(v) => {
				onSubmit({ name: v.name, title: v.title, permissions: v.permissions ?? [] });
			}}
		>
			<Form.Item
				name="name"
				label={t("system:role.machineName")}
				rules={[
					{ required: true, message: t("system:role.nameRequired") },
					{ pattern: CUSTOM_NAME, message: t("system:role.namePattern") },
				]}
			>
				<Input placeholder="custom.reviewer" />
			</Form.Item>
			<Form.Item name="title" label={t("system:role.displayName")} rules={[{ required: true, message: t("system:role.titleRequired") }]}>
				<Input />
			</Form.Item>
			<Form.Item name="permissions" label={t("system:role.bindings")}>
				<Checkbox.Group
					className="flex flex-col gap-1"
					options={permissions.map(p => ({ label: `${p.code}${p.deprecated ? " (deprecated)" : ""}`, value: p.code, disabled: p.deprecated }))}
				/>
			</Form.Item>
		</Form>
	);
}
