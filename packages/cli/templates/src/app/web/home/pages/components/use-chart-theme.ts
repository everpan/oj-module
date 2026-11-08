import { theme } from "antd";
import { useMemo } from "react";

/**
 * ECharts 是 canvas 绘制，既不读 CSS 也不读 antd 的 cssVar——明暗切换时轴/图例/提示框
 * 会停留在初始化时的浅色，看起来「没切过来」。这里把 antd token 显式映射成图表配色，
 * ConfigProvider 切换 algorithm 时 token 变化 → useMemo 产出新对象 → echarts-for-react
 * 重新 setOption，图表随之重绘。
 */
export function useChartTheme() {
	const { token } = theme.useToken();

	return useMemo(() => ({
		text: token.colorTextSecondary,
		axisLine: token.colorBorder,
		splitLine: token.colorBorderSecondary,
		tooltipBg: token.colorBgElevated,
		tooltipBorder: token.colorBorderSecondary,
		tooltipText: token.colorText,
		containerBg: token.colorBgContainer,
	}), [token]);
}
