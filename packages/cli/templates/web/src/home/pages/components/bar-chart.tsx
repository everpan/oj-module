import type { EChartsOption } from "echarts";
import { Card } from "antd";
import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";

/** 柱状图：演示 `echarts` + `echarts-for-react`（共享依赖，宿主 importmap 提供）。 */
export default function BarChart() {
	const { t } = useTranslation();
	const categories = [
		t("home:directAccess"),
		t("home:emailMarketing"),
		t("home:affiliateAdvertise"),
		t("home:videoAdvertise"),
	];
	const option: EChartsOption = {
		tooltip: {},
		xAxis: { type: "category", data: categories },
		yAxis: { type: "value" },
		series: [
			{
				type: "bar",
				data: [335, 310, 234, 135],
			},
		],
	};
	return (
		<Card title={t("home:views")}>
			<ReactECharts opts={{ height: 320, width: "auto" }} option={option} />
		</Card>
	);
}
