import { BasicContent } from "@react-antd-module/runtime";
import { Card, Input } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function DemoDetailPage() {
	const { t } = useTranslation();
	const [value, setValue] = useState("");
	return (
		<BasicContent>
			<Card title={t("demo:page.detail")}>
				{/* 受控输入供 e2e T2 验证 keepalive 状态保留 */}
				<Input placeholder="detail-input" value={value} onChange={e => setValue(e.target.value)} />
			</Card>
		</BasicContent>
	);
}
