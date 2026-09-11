/**
 * `ojm` 用法文本（抽为纯函数供测试断言；index.ts 仅负责打印与退出码）。
 */

export function usageText(): string {
	return `@oj-module/cli

用法:
  ojm init [dir] [--yes]              前后端一体化工程脚手架（幂等补缺）
  ojm dev [port]                      启动开发服务器（/api 反代 oj + 模块重建 + SSE 刷新）
  ojm build                           构建后端（oj build）与模块产物（含全站合并）
  ojm preview [port] [--oj-static]    生产形态预览（migrate → oj server + 静态兜底）
  ojm api [dir] [--check] [--docs] [--exempt <path>]  契约代码生成（client/routes/openapi/stub）；--check 三重对账（可用 --exempt 指定豁免清单覆盖默认 api/.ojm-api-exempt.json）；--docs 出自包含文档站（单文件离线可看）
  ojm info                            输出版本矩阵与模块清单（报障用，US-7）
  ojm vendor [tag] [--force]           下载/重装 oj vendor（经 npm 包 @oj-bin/oj，tag 缺省取最新版本，形如 v0.1.13）
  ojm merge <out.json> <in1.json> [in2.json ...]  合并多团队清单（R12）

别名: ram 是 ojm 的弃用别名（打印更名警告后转发），将在下个 major 移除。
`;
}
