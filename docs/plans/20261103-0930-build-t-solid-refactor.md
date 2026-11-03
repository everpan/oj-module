# build.ts SOLID 重构（SRP 拆分 + facade 兼容）

日期：2026-11-03 09:30 · 分支：`refactor/build-solid`（并入 feat/ojm）

## 1. 背景与问题

`packages/cli/src/build.ts` 885 行，五块互不相关的职责挤在一个文件：
元数据读取（esbuild stub 机房 ~315 行）、modules.json 类型、产物说明符分析、后端编排
（`oj build` + 密封值试解）、全站合并、前端模块构建（vite/rolldown ~330 行）。
违反 SRP：改 stub 名单、改 oj 透传参数、改 chunk 完整性策略都在同一文件冲突；
新人定位「元数据读取在哪」要翻全文件。

## 2. 目标 / 非目标

**目标**：按职责拆为 `src/build/` 下 4 个模块，`build.ts` 变纯 facade（re-export 5 个既有
公开名），**行为零变化、调用方零改动**。

**非目标**：不改任何逻辑/文案/顺序；不引入依赖注入等新抽象（DIP 在此文件无真实痛点，
现有函数签名已是显式依赖）；不动调用方（dev.ts/cli.ts/bundle.ts/market/bootstrap.ts/
build-backend.test.ts 继续从 `./build` 导入）。

## 3. 拆分方案

| 新文件 | 职责（SRP） | 内容 |
|---|---|---|
| `src/build/module-def.ts` | 模块元数据读取 | RUNTIME_STUB_SOURCE、runtimeStubPlugin、dynamicImportStubPlugin、collectBareImportedNames、makeBareImportStubPlugin、`readModuleDefinition` |
| `src/build/backend.ts` | 后端编排 | `buildBackend`、assertSealedValuesOpenable |
| `src/build/site-merge.ts` | 宿主站点合并 | mergeShellSite（升为模块内导出，供 module-build 调用） |
| `src/build/module-build.ts` | 前端模块构建 | ChunkEntry、BuiltModule、resolveRoutePrefix、sha384、warnUnsharedDeps、collectBareSpecifiers、assertResolvableSpecifiers、`buildModules` |
| `src/build.ts`（facade） | 兼容出口 | 仅 re-export：`readModuleDefinition` / `buildBackend` / `buildModules` / 类型 `BuiltModule` / `ChunkEntry` |

依赖方向（无环）：`module-build → module-def、site-merge`；`backend / site-merge / module-def` 互不依赖；
调用方 → facade。

## 4. 安全网

- 既有用例：`build-backend.test.ts`（buildBackend 契约）、bundle 用例（经 `readModuleDefinition`
  走真 esbuild 打包）、usage/cli 用例（经 facade 导入链）；
- `tsc --noEmit` + eslint 全绿；
- 拆分纯移动（代码原样搬，注释随行），diff 可逐行核对。

## 5. 验收

- [x] 四个新文件 + facade 就位，`build.ts` 只剩 re-export 与拆分说明（18 行）；
- [x] `tsc --noEmit`、eslint（含 perfectionist export 排序）通过；
- [x] cli 包全量用例 597 passed / 1 skipped——与拆分前逐项一致；
- [x] 调用方清单零改动：dev.ts / cli.ts / bundle.ts / market/bootstrap.ts 四处 import 原样。

## 6. 记录

- 关键过程：通读 build.ts 全文定五块职责边界 → 计划文档 → 纯移动式拆分（注释随行、
  逻辑零改动）→ tsc 全绿 → 全量用例比对拆分前后计数一致（597/598）。
- 一处拆分笔误当场修正：resolveRoutePrefix 的 layout 参数类型直接用 `ProjectLayout` 导入，
  不玩类型体操（OCP：新构建阶段 = 新文件 + facade 加一行导出）。
- 耗时：约 25 分钟（2026-11-03 09:20–09:28，含全量回归）。
- 遗留（有意不做的 DIP）：buildModules 对 vite/esbuild 的依赖保持直连——现有签名已是
  显式依赖、无测试替换需求，注入面属过度设计（ponytail 纪律：无痛点不抽象）。
