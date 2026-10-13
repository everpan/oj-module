// `@oj-module/runtime/notify` 物理子路径入口（与 contract 子路径同构）。
//
// 仅导出共享契约类型 —— 服务端原语不在 runtime 内，而是落在各 oj 工程的
// api/src/_shared/notify（oj 后端按物理目录解析裸 specifier 且钳制在 api 项目根内，
// 不能 import 本项目外的包；详见 packages/README 或设计文档 §4.3）。前端经此 facade
// 取类型；后端直接 import 本地 _shared/notify 的实现。
export * from "./types.ts";
