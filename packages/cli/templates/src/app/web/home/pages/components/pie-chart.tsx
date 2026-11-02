import type { EChartsOption } from "echarts";
import { Card, Segmented } from "antd";
import ReactECharts from "echarts-for-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * 饼图：演示 `echarts` + `echarts-for-react` + antd `Segmented` 联动。
 * 数据为静态演示值（各渠道 × 品类）。
 */
const VALUES: Record<string, number[]> = {
	all: [1048, 735, 580, 484, 300],
	online: [820, 560, 430, 360, 240],
	site: [228, 175, 150, 124, 60],
};

export default function PieChart() {
	const { t } = useTranslation();
	const [channel, setChannel] = useState<string>("all");

	const option: EChartsOption = useMemo(() => {
		const names = [
			t("home:electronics"),
			t("home:homeGoods"),
			t("home:apparelAccessories"),
			t("home:foodBeverages"),
			t("home:beautySkincare"),
		];
		const values = VALUES[channel] ?? VALUES.all;
		return {
			tooltip: { trigger: "item", formatter: "{a} <br/>{b} : {c} ({d}%)" },
			legend: { orient: "vertical", left: "left" },
			series: [
				{
					name: t("home:salesCategoryProportion"),
					type: "pie",
					radius: "55%",
					center: ["50%", "60%"],
					data: names.map((name, i) => ({ name, value: values[i] })),
				},
			],
		};
	}, [channel, t]);

	const channelOptions = [
		{ label: t("home:allChannels"), value: "all" },
		{ label: t("home:online"), value: "online" },
		{ label: t("home:site"), value: "site" },
	];

	return (
		<Card
			title={t("home:salesCategoryProportion")}
			extra={(
				<Segmented
					options={channelOptions}
					value={channel}
					onChange={value => setChannel(String(value))}
				/>
			)}
		>
			<ReactECharts opts={{ height: 320, width: "auto" }} option={option} />
		</Card>
	);
}
