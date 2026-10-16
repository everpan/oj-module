// 绑定编辑器（AC1-18/30）：整集替换语义——勾选集即新绑定集，diff 仅作展示。
// deprecated 已绑定项标灰但**保持勾选**（判权不过滤 deprecated，§5；擅自取消 = 紧急吊销出口）。
import type { RbacRole } from "@oj-module/runtime";
import { bindingDiff } from "@oj-module/runtime";
import { Checkbox, Form } from "antd";
import { useTranslation } from "react-i18next";

interface Group {
	module: string
	items: Array<{ code: string, deprecated: boolean }>
}

export function BindingsEditor({ role, permissionGroups, onSubmit }: { role: RbacRole, permissionGroups: Group[], onSubmit: (permissions: string[]) => void }) {
	const { t } = useTranslation();
	const [form] = Form.useForm();
	return (
		<Form
			id="rbac-bindings-form"
			form={form}
			initialValues={{ permissions: role.permissions }}
			onFinish={(v) => {
				onSubmit(v.permissions ?? []);
			}}
		>
			<Form.Item name="permissions" noStyle>
				<Checkbox.Group className="flex flex-col gap-2">
					{permissionGroups.map(g => (
						<div key={g.module}>
							<div className="mb-1 font-medium">{g.module}</div>
							<div className="flex flex-col gap-1 pl-4">
								{g.items.map(p => (
									<Checkbox key={p.code} value={p.code} className={p.deprecated ? "text-gray-400" : undefined}>
										{p.code}
										{p.deprecated && <span className="ml-1 text-xs text-gray-400">（deprecated）</span>}
									</Checkbox>
								))}
							</div>
						</div>
					))}
				</Checkbox.Group>
			</Form.Item>
			<Form.Item noStyle shouldUpdate>
				{({ getFieldValue }) => {
					const next: string[] = getFieldValue("permissions") ?? [];
					const d = bindingDiff(role.permissions, next);
					return (
						<div className="mt-2 text-xs text-gray-500">
							{t("system:role.diff")}
							: +
							{d.added.join(", ") || "—"}
							{" "}
							/ -
							{d.removed.join(", ") || "—"}
						</div>
					);
				}}
			</Form.Item>
		</Form>
	);
}
