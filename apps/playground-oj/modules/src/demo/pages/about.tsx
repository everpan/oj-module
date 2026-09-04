import { BasicContent } from "@react-antd-module/runtime";
import { Card, Tag } from "antd";
import { useTranslation } from "react-i18next";

/** e2e 基线夹具页：为 T3/T4（关闭非激活/激活页签）提供第三个可关闭页签 */
export default function DemoAboutPage() {
	const { t } = useTranslation();

	return (
		<BasicContent>
			<Card title={t("demo:page.about")}>
				<Tag color="processing">{t("demo:page.loaded")}</Tag>
			</Card>
		</BasicContent>
	);
}
