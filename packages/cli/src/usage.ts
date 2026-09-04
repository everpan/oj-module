/**
 * `ram` 用法文本（抽为纯函数供测试断言；index.ts 仅负责打印与退出码）。
 */

export function usageText(): string {
	return `@react-antd-module/cli

用法:
  ram init [dir] [--yes]              前后端一体化工程脚手架（幂等补缺）
  ram dev [port]                      启动开发服务器（/api 反代 oj + 模块重建 + SSE 刷新）
  ram build                           构建后端（oj build）与模块产物（含全站合并）
  ram preview [port] [--oj-static]    生产形态预览（migrate → oj server + 静态兜底）
  ram api [dir] [--check] [--docs]     契约代码生成（client/routes/openapi/stub）；--check 三重对账；--docs 出自包含文档站（单文件离线可看）
  ram info                            输出版本矩阵与模块清单（报障用，US-7）
  ram vendor [--force]                检查并按需更新 oj vendor（GitHub releases 按平台下载）
  ram merge <out.json> <in1.json> [in2.json ...]  合并多团队清单（R12）
`;
}
