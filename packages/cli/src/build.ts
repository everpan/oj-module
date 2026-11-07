// 构建编排 facade（2026-11-03 SOLID 拆分，行为零变化，计划 docs/plans/20261103-0930-build-t-solid-refactor）。
//
// 原单文件 885 行按职责（SRP）拆为 src/build/ 下四个模块，本文件只保留兼容出口——
// 既有调用方（dev.ts / cli.ts / bundle.ts / market/bootstrap.ts / build-backend.test.ts，
// 及经 package exports `./build` 复用的主仓 scripts/build-modules.ts）零改动：
//
//   module-def.ts    模块元数据读取（esbuild stub 机房 + readModuleDefinition）
//   backend.ts       后端编排（oj build + 别名投影 + 密封值试解 + versions.json 双落点）
//   site-merge.ts    宿主站点合并（shell-dist 全量 + index.html 改写）
//   module-build.ts  前端模块构建（vite/rolldown + 产物完整性 + modules.json）
//
// 依赖方向无环：module-build → module-def / site-merge；其余互不依赖。
export { buildBackend, materializeInstallerVersions } from "./build/backend";
export type { BuiltModule, ChunkEntry } from "./build/module-build";
export { buildModules } from "./build/module-build";
export { readModuleDefinition } from "./build/module-def";
