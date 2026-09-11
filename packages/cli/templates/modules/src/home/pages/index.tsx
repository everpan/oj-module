import { BasicContent } from "@react-antd-module/runtime";
import { Card, Col, Row, Typography } from "antd";
import { useTranslation } from "react-i18next";

export default function HomePage() {
	const { t } = useTranslation();
	return (
		<BasicContent>
			<Row gutter={[20, 20]}>
				<Col span={24}>
					<Card title={t("home:page.title")}>
						<Typography.Title level={3}>{t("home:page.welcome")}</Typography.Title>
						<Typography.Paragraph type="secondary">{t("home:page.subtitle")}</Typography.Paragraph>
					</Card>
				</Col>
				<Col xs={24} sm={24} md={8}>
					<Card title={t("home:tip.dev.title")}>{t("home:tip.dev.text")}</Card>
				</Col>
				<Col xs={24} sm={24} md={8}>
					<Card title={t("home:tip.contract.title")}>{t("home:tip.contract.text")}</Card>
				</Col>
				<Col xs={24} sm={24} md={8}>
					<Card title={t("home:tip.build.title")}>{t("home:tip.build.text")}</Card>
				</Col>
			</Row>
		</BasicContent>
	);
}
