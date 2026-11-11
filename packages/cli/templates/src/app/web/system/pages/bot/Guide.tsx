import { CopyOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";

import { explainError } from "../errors";

/**
 * config.yaml 参考片段。保留模板安装器的 `# ojm:mcp-modules` 文本锚点——删掉它方案安装
 * 时就不会把方案名登记进 modules 白名单（见 config.yaml 该行的逐字红线注释）。
 */
const CONFIG_SNIPPET = [
	"server:",
	"  mcp:",
	"    enabled: true",
	"    # ojm:mcp-modules   ← 安装器锚点：方案安装时把方案名登记进 modules 白名单，勿删",
	"    modules: [user, news, order]  # 示例：仅白名单内方案的工具对外暴露",
	"    act_mask_destructive: true    # 代操作遮蔽：act 会话拒 delete、隐藏 destructive tool",
].join("\n");

/** 多行文案（steps/checklist/codes/security）用 pre-wrap 原样保留换行。 */
function Block({ text }: { text: string }) {
	return <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{text}</Typography.Paragraph>;
}

/**
 * 接入指引 / 上线检查单：纯静态运营文档，不读后端。
 * 「群聊」只是使用场景（员工在群里 @ 机器人），不是新实体，无群聊注册表。
 */
export function GuidePanel() {
	const { t } = useTranslation();
	const { message } = App.useApp();

	const copyConfig = async () => {
		try {
			await navigator.clipboard.writeText(CONFIG_SNIPPET);
			message.success(t("system:bot.common.copied"));
		}
		catch (e) {
			message.error(explainError(e, t));
		}
	};

	return (
		<Space direction="vertical" style={{ width: "100%" }} size="middle">
			<Alert type="warning" showIcon message={t("system:bot.guide.tenantNote")} />

			<Card size="small" title={t("system:bot.guide.mcpTitle")}>
				<Typography.Paragraph type="secondary">{t("system:bot.guide.mcpHint")}</Typography.Paragraph>
				<Typography.Paragraph style={{ marginBottom: 8 }}><Typography.Text strong>{t("system:bot.guide.configTitle")}</Typography.Text></Typography.Paragraph>
				<Button size="small" icon={<CopyOutlined />} style={{ marginBottom: 8 }} onClick={() => void copyConfig()}>{t("system:bot.guide.configCopy")}</Button>
				<pre style={{ background: "rgba(0,0,0,0.04)", padding: 12, borderRadius: 6, overflowX: "auto", margin: 0 }}>{CONFIG_SNIPPET}</pre>
			</Card>

			<Card size="small" title={t("system:bot.guide.botTitle")}>
				<Typography.Paragraph type="secondary">{t("system:bot.guide.botHint")}</Typography.Paragraph>
				<Block text={t("system:bot.guide.steps")} />
			</Card>

			<Card size="small" title={t("system:bot.guide.checklistTitle")}>
				<Block text={t("system:bot.guide.checklist")} />
			</Card>

			<Card size="small" title={t("system:bot.guide.codeTitle")}>
				<Block text={t("system:bot.guide.codes")} />
			</Card>

			<Card size="small" title={t("system:bot.guide.securityTitle")}>
				<Block text={t("system:bot.guide.security")} />
			</Card>
		</Space>
	);
}
