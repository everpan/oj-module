/**
 * 按需注册的 echarts 实例（体积治理）。
 *
 * 为什么不用 `import ReactECharts from "echarts-for-react"`：
 * 那条路径会 `import * as echarts from "echarts"`（整包 index），把 **全部图表类型 +
 * 全部组件 + 全部渲染器** 打进模块产物。实测 `app` 模块 entry.js 1,697,666 B 中
 * echarts 918 KB + zrender 221 KB，占 **87%**；而首页只用到折线/柱状/饼图三种。
 *
 * 这里改用 `echarts/core` 按需注册：只留 3 种图表 + 3 个组件 + Canvas 渲染器，
 * 同一份代码实测 1,125 KB → 572 KB（−49%）。
 *
 * 新图表类型/组件时，务必在这里 `use()` 补上——否则运行期渲染为空且**不报错**，
 * 是最常见的 echarts 按需踩坑。
 */
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
	BarChart,
	LineChart,
	PieChart,
	GridComponent,
	LegendComponent,
	TooltipComponent,
	CanvasRenderer,
]);

export { echarts };
