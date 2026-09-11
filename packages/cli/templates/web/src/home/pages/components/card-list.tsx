import type { ColProps } from "antd";
import {
	MessageOutlined,
	MoneyCollectOutlined,
	ShoppingCartOutlined,
	UserOutlined,
} from "@ant-design/icons";
import { Card, Col, Row, Typography } from "antd";
import CountUpModule from "react-countup";
import { useTranslation } from "react-i18next";

/**
 * 统计卡片：演示 `react-countup`（共享依赖）+ `@ant-design/icons`。
 * Broken default export with Vite 8 / Rolldown —— 与 playground 同款兜底。
 * @see https://github.com/glennreyes/react-countup/issues/884
 */
const CountUp = (CountUpModule as unknown as { default?: typeof CountUpModule }).default ?? CountUpModule;

const wrapperCol: ColProps = {
	xs: 24,
	sm: 24,
	md: 12,
	xl: 6,
};

export default function CardList() {
	const { t } = useTranslation();

	const cards = [
		{ key: "newVisits", title: t("home:newVisits"), data: 102_400, icon: <UserOutlined /> },
		{ key: "messages", title: t("home:messages"), data: 81212, icon: <MessageOutlined /> },
		{ key: "purchases", title: t("home:purchases"), data: 9280, icon: <MoneyCollectOutlined /> },
		{ key: "shoppings", title: t("home:shoppings"), data: 13600, icon: <ShoppingCartOutlined /> },
	];

	return (
		<Row gutter={[20, 20]}>
			{cards.map(card => (
				<Col key={card.key} {...wrapperCol}>
					<Card>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<div>
								<Typography.Text type="secondary">{card.title}</Typography.Text>
								<div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.4 }}>
									<CountUp end={card.data} separator="," />
								</div>
							</div>
							<span style={{ fontSize: 28, color: "#1677ff" }}>{card.icon}</span>
						</div>
					</Card>
				</Col>
			))}
		</Row>
	);
}
