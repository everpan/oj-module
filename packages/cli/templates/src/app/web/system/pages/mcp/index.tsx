import { useTranslation } from "react-i18next";

// MCP 服务管理页（20261110-1027 §4.3）：T6 骨架——路由/i18n 接线；状态卡、分组工具表、
// 接入配置与 §4.3 场景测试由 T7 填实。数据源 useMarketClient().mcpCatalog() + index()。
export default function McpPage() {
	const { t } = useTranslation();

	return (
		<div>
			<h3>{t("system:menu.mcp")}</h3>
		</div>
	);
}
