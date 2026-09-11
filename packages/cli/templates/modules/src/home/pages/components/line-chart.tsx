import type { EChartsOption } from "echarts";
import { Card, Radio } from "antd";
import dayjs from "dayjs";
import ReactECharts from "echarts-for-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * 折线图：演示 `echarts` + `echarts-for-react` + `dayjs`（共享依赖）。
 * 数据为静态演示值——真实业务请走模块契约 + `ram api` 生成的 client
 * （参考 `demo` 模块的裸 fetch 与教程里 books 模块的契约式接法）。
 */
const WEEK = [820, 932, 901, 934, 1290, 1330, 1320];
const MONTH = [620, 732, 701, 734, 1090, 1130, 1120, 920, 1032, 1001, 1034, 1390];
const YEAR = [320, 432, 401, 434, 790, 830, 820, 620, 732, 701, 734, 1090];

type Range = "week" | "month" | "year";

export default function LineChart() {
	const { t } = useTranslation();
	const [range, setRange] = useState<Range>("week");

	const { labels, data } = useMemo(() => {
		if (range === "week") {
			return {
				labels: [
					t("home:monday"),
					t("home:tuesday"),
					t("home:wednesday"),
					t("home:thursday"),
					t("home:friday"),
					t("home:saturday"),
					t("home:sunday"),
				],
				data: WEEK,
			};
		}
		if (range === "month") {
			return {
				labels: MONTH.map((_, i) => dayjs().subtract(MONTH.length - 1 - i, "day").format("MM-DD")),
				data: MONTH,
			};
		}
		return {
			labels: YEAR.map((_, i) => dayjs().subtract(YEAR.length - 1 - i, "month").format("YYYY-MM")),
			data: YEAR,
		};
	}, [range, t]);

	const option: EChartsOption = {
		tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
		xAxis: { type: "category", boundaryGap: false, data: labels },
		yAxis: { type: "value" },
		series: [{ type: "line", smooth: true, areaStyle: {}, data }],
	};

	return (
		<Card
			title={t("home:sales")}
			extra={(
				<Radio.Group
					buttonStyle="solid"
					value={range}
					onChange={e => setRange(e.target.value)}
				>
					<Radio.Button value="week">{t("home:thisWeek")}</Radio.Button>
					<Radio.Button value="month">{t("home:thisMonth")}</Radio.Button>
					<Radio.Button value="year">{t("home:thisYear")}</Radio.Button>
				</Radio.Group>
			)}
		>
			<ReactECharts opts={{ height: 320, width: "auto" }} option={option} />
		</Card>
	);
}
