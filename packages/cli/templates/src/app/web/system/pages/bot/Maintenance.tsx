import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Checkbox, Popconfirm, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { systemBotCleanupPost } from "../../__client";
import { explainError } from "../errors";

/**
 * 维护面板：租户级资源回收（卸载机器人接入 / 租户重置）。
 *
 * 一次清空本租户的 oj_svc_token + oj_bot_binding + oj_obo_audit（后端 assertSystemAdmin，
 * 租户边界由 sql_guard 注入）。幂等但不可逆，故要求勾选确认后再走 Popconfirm。
 * 不做进方案卸载流程：_platform 卸载纪律是「只删代码/锁/路由/权限，不删业务数据」。
 */
export function MaintenancePanel() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const [ack, setAck] = useState(false);

	const cleanupMut = useMutation({
		mutationFn: () => systemBotCleanupPost({ confirm: true }),
		onSuccess: (d) => {
			message.success(t("system:bot.maintenance.cleanupOk", d));
			setAck(false);
			// 三张表都变了：按前缀失效 bot 域下所有查询（凭据/绑定/审计），切 tab 重新取数。
			void queryClient.invalidateQueries({ queryKey: ["system", "bot"] });
		},
		onError: e => message.error(explainError(e, t)),
	});

	return (
		<Card size="small" title={t("system:bot.maintenance.title")} data-testid="bot-maintenance">
			<Space direction="vertical" size={12} style={{ width: "100%" }}>
				<Alert
					type="warning"
					showIcon
					message={t("system:bot.maintenance.desc")}
					description={(
						<>
							<Typography.Paragraph style={{ marginBottom: 4 }}>{t("system:bot.maintenance.list")}</Typography.Paragraph>
							<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{t("system:bot.maintenance.limits")}</Typography.Paragraph>
						</>
					)}
				/>
				<Checkbox checked={ack} onChange={e => setAck(e.target.checked)}>{t("system:bot.maintenance.ack")}</Checkbox>
				<Popconfirm
					title={t("system:bot.maintenance.confirmTitle")}
					description={t("system:bot.maintenance.confirmDesc")}
					okButtonProps={{ danger: true, loading: cleanupMut.isPending }}
					onConfirm={() => cleanupMut.mutate()}
					disabled={!ack}
				>
					<Button danger disabled={!ack} loading={cleanupMut.isPending}>{t("system:bot.maintenance.action")}</Button>
				</Popconfirm>
			</Space>
		</Card>
	);
}
