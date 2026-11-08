import type { EChartsOption } from "echarts";
import { Card } from "antd";
import ReactEChartsCore from "echarts-for-react/esm/core";
import { useTranslation } from "react-i18next";

import { echarts } from "./echarts-setup";
import { useChartTheme } from "./use-chart-theme";

/** 柱状图：按需注册的 `echarts` + `echarts-for-react/esm/core`（见 echarts-setup.ts）。 */
export default function BarChart() {
	const { t } = useTranslation();
	const ct = useChartTheme();
	const categories = [
		t("home:directAccess"),
		t("home:emailMarketing"),
		t("home:affiliateAdvertise"),
		t("home:videoAdvertise"),
	];
	const option: EChartsOption = {
		tooltip: { backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, textStyle: { color: ct.tooltipText } },
		xAxis: {
			type: "category",
			data: categories,
			axisLabel: { color: ct.text },
			axisLine: { lineStyle: { color: ct.axisLine } },
			axisTick: { lineStyle: { color: ct.axisLine } },
		},
		yAxis: {
			type: "value",
			axisLabel: { color: ct.text },
			splitLine: { lineStyle: { color: ct.splitLine } },
		},
		series: [
			{
				type: "bar",
				data: [335, 310, 234, 135],
			},
		],
	};
	return (
		<Card title={t("home:views")}>
			<ReactEChartsCore echarts={echarts} opts={{ height: 320, width: "auto" }} option={option} />
		</Card>
	);
}
