import { Tabs } from "antd";
import { useTranslation } from "react-i18next";

import { BotBindingPanel } from "./BotBinding";
import { GuidePanel } from "./Guide";
import { OboAuditPanel } from "./OboAudit";
import { ServiceTokenPanel } from "./ServiceToken";

/**
 * 机器人接入管理端（mcp-bot-guide「线路 B」运营面）：服务凭据 / 员工绑定 / 换签审计 /
 * 接入指引四块。挂载在 /system/framework/bot，路由级 roles:["superadmin"]，各面板后端
 * 亦为 assertSuperAdmin 双保险。四个面板各自懒取数，切 tab 不互相阻塞。
 */
export default function BotPage() {
	const { t } = useTranslation();
	return (
		<Tabs
			style={{ paddingTop: 16 }}
			items={[
				{ key: "token", label: t("system:bot.tab.token"), children: <ServiceTokenPanel /> },
				{ key: "binding", label: t("system:bot.tab.binding"), children: <BotBindingPanel /> },
				{ key: "audit", label: t("system:bot.tab.audit"), children: <OboAuditPanel /> },
				{ key: "guide", label: t("system:bot.tab.guide"), children: <GuidePanel /> },
			]}
		/>
	);
}
