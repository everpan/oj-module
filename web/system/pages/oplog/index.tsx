// C3 操作日志页（AC1-29；D13 admin 可查）：action/username/module 过滤 + 截断标记。
// 403 拒绝类（auth.deny）经 action 过滤检索——分钟窗口聚合的计数在 detail 列。
import type { RbacOplogEntry } from "@oj-module/runtime";
import { BasicContent, fetchRbacOplog } from "@oj-module/runtime";
import { useQuery } from "@tanstack/react-query";
import { Alert, Input, Table, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function Oplog() {
	const { t } = useTranslation();
	const [action, setAction] = useState("");
	const [username, setUsername] = useState("");
	const [module, setModule] = useState("");

	const { data } = useQuery({
		queryKey: ["rbac-oplog", action, username, module],
		queryFn: () => fetchRbacOplog({ action, username, module, limit: 200 }),
	});

	return (
		<BasicContent className="h-full">
			<div className="mb-2 flex gap-2">
				<Input.Search placeholder={t("system:oplog.actionFilter")} allowClear onSearch={setAction} style={{ width: 220 }} />
				<Input.Search placeholder={t("system:oplog.usernameFilter")} allowClear onSearch={setUsername} style={{ width: 180 }} />
				<Input.Search placeholder={t("system:oplog.moduleFilter")} allowClear onSearch={setModule} style={{ width: 160 }} />
				{data?.truncated && <Alert type="warning" showIcon message={t("system:oplog.truncated")} className="py-1" />}
			</div>
			<Table<RbacOplogEntry>
				rowKey="id"
				size="small"
				dataSource={data?.list}
				pagination={{ pageSize: 50, showTotal: total => `${t("common.total")} ${data?.total ?? total}` }}
				columns={[
					{ title: "ID", dataIndex: "id", width: 80 },
					{
						title: t("system:oplog.time"),
						dataIndex: "create_time",
						width: 180,
						render: (v: number) => new Date(v).toLocaleString(),
					},
					{ title: t("system:oplog.username"), dataIndex: "username", width: 140 },
					{
						title: t("system:oplog.action"),
						dataIndex: "action",
						render: (v: string) => (v === "auth.deny" ? <Tag color="red">{v}</Tag> : <Tag>{v}</Tag>),
					},
					{ title: t("system:oplog.module"), dataIndex: "module", width: 120 },
					{ title: t("system:oplog.target"), dataIndex: "target", width: 160 },
					{ title: t("system:oplog.detail"), dataIndex: "detail", ellipsis: true },
				]}
			/>
		</BasicContent>
	);
}
