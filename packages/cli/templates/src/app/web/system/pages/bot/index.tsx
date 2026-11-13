import { Tabs } from "antd";
import { useTranslation } from "react-i18next";

import { BotBindingPanel } from "./BotBinding";
import { GuidePanel } from "./Guide";
import { MaintenancePanel } from "./Maintenance";
import { OboAuditPanel } from "./OboAudit";
import { ServiceTokenPanel } from "./ServiceToken";
import { WeComPluginConfigPanel } from "./WeComPluginConfig";

/**
 * 机器人接入管理端（mcp-bot-guide「线路 B」运营面）：服务凭据 / 员工绑定 / 换签审计 /
 * 普通模式插件配置（P4a）/ 接入指引五块。挂载在 /system/framework/bot，路由级
 * roles:SYSTEM_ROLES（admin + superadmin）：服务凭据签发是每租户 admin 自助面（Q-I，方案 §4.1），
 * 签出的 Bearer 租户取自签发者签名 claim，须由对应租户管理员签发。
 * 服务凭据面板后端 assertSystemAdmin；员工绑定/换签审计/清库仍 assertSuperAdmin（D11）。
 * 各面板各自懒取数，切 tab 不互相阻塞；无权面板自带 ForbiddenPanel 降级。
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
				{ key: "plugin", label: t("system:bot.tab.plugin"), children: <WeComPluginConfigPanel /> },
				{ key: "guide", label: t("system:bot.tab.guide"), children: <GuidePanel /> },
				{ key: "maintenance", label: t("system:bot.tab.maintenance"), children: <MaintenancePanel /> },
			]}
		/>
	);
}
