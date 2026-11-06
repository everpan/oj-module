import { Alert, Button, Input, Modal, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { buildKeygenCommand } from "./model";

/** 申请成功的返回值：明文只在这一刻存在 */
export interface IssuedCredential {
	token: string
	key_id: string
	product: string
	token_hint?: string
	expires_at: number
}

/** 复制到剪贴板：非 https / 无权限时静默失败（输入框里的文本本来就能手动选中） */
async function copy(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	}
	catch {
		// 不打断流程：用户可直接在只读输入框里选中复制
	}
}

/**
 * 一次性明文弹窗。
 *
 * 三条不可退让的约束：
 *   · 不渲染 = 没有。`issued` 为 null 时整个 Modal 不挂载，关闭后 DOM 里不再有明文
 *     （服务端只存 sha256，关掉就真的找不回来——所以文案必须先说清楚）。
 *   · 不可点遮罩/ESC 关闭：误触的代价是重新申请一张凭证。
 *   · 凭证与命令都是只读输入框 + 复制按钮：64 位 hex 手抄必错。
 */
export function TokenModal({ issued, onClose }: { issued: IssuedCredential | null, onClose: () => void }) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState<string | null>(null);
	if (!issued)
		return null;
	const command = buildKeygenCommand(issued.token);
	const copyRow = (testId: string, value: string) => (
		<Space.Compact style={{ width: "100%", marginBottom: 16 }}>
			<Input readOnly value={value} data-testid={testId} />
			<Button
				onClick={() => {
					void copy(value);
					setCopied(testId);
				}}
			>
				{copied === testId ? t("publish:issued.copied") : t("publish:issued.copy")}
			</Button>
		</Space.Compact>
	);

	return (
		<Modal
			open
			closable={false}
			maskClosable={false}
			keyboard={false}
			title={t("publish:issued.title")}
			footer={<Button type="primary" onClick={onClose}>{t("publish:issued.done")}</Button>}
		>
			<div data-testid="publish-issued">
				<Alert type="warning" showIcon message={t("publish:issued.warning")} style={{ marginBottom: 16 }} />
				<Typography.Paragraph>
					<Typography.Text type="secondary">{t("publish:issued.identity")}</Typography.Text>
					<br />
					<Typography.Text copyable={{ text: issued.key_id }} code>{issued.key_id}</Typography.Text>
				</Typography.Paragraph>
				<Typography.Paragraph style={{ marginBottom: 4 }}>
					<Typography.Text type="secondary">{t("publish:issued.token")}</Typography.Text>
				</Typography.Paragraph>
				{copyRow("publish-token", issued.token)}
				<Typography.Paragraph style={{ marginBottom: 4 }}>
					<Typography.Text type="secondary">{t("publish:issued.command")}</Typography.Text>
				</Typography.Paragraph>
				{copyRow("publish-command", command)}
			</div>
		</Modal>
	);
}
