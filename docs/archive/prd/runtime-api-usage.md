# Runtime 外部 API 实际用量（P1 基线）

> 用途：作为 **P3 Runtime 出口收敛** 的输入。记录「外部模块工程」真实从
> `@react-antd-module/runtime` import 了哪些符号，从而确定哪些能力必须成为
> runtime 的公开导出、哪些仍可留在框架内部。

## 扫描范围

- `apps/playground/modules/**`（P1 垂直切片演示模块）
- 不统计 `packages/runtime/**` 自身（那里的 23 处 `#src/*` 是框架内部耦合，
  由 P3 收敛，不在此基线内）。

## P1 实测结果

外部模块当前**仅**用到两个符号：

| 符号 | 使用位置 | 用途 |
| --- | --- | --- |
| `defineModule` | `apps/playground/modules/demo/entry.ts` | 声明模块契约（name/version/routes/i18n/lifecycle） |
| `BasicContent` | `apps/playground/modules/demo/pages/index.tsx` | 页面骨架容器组件 |

代码摘录：

```ts
// entry.ts
import { defineModule } from "@react-antd-module/runtime";
// pages/index.tsx
import { BasicContent } from "@react-antd-module/runtime";
```

## 结论与对 P3 的含义

1. **最小可见面**：P1 阶段外部模块只依赖 `defineModule` + `BasicContent`，
   与 `packages/runtime/src/index.ts` 当前导出的「最小集合」一致。
2. **共享依赖直连**：模块对 `react` / `antd` / `react-router` /
   `@tanstack/react-query` / `@ant-design/icons` 直接 import（由宿主 importmap
   提供），**不应**从 runtime 转出——否则会破坏单例（D5）。
3. **P3 待收敛的内部能力**：`packages/runtime` 内部仍有 23 处 `#src/*` 引用
   （i18n 合并、request、store/apiPrefix register、keepAlive、layout handle、
   icon 约定等）。这些目前外部模块用不到，但 P3 会把「外部模块确实需要」的子集
   提升为 runtime 公开导出（含类型，如 `AppRouteRecordRaw`、`ModuleDefinition`、
   `ModuleContext`），并在 P3 冻结出口。
4. **增量校验**：每迁移一个真实业务模块（P5）后，回到本文档补充其 runtime
   用量，避免 P3 冻结时遗漏外部依赖的符号。

## 统计命令（复跑用）

```bash
grep -rn 'from "@react-antd-module/runtime"' apps --include=*.ts --include=*.tsx
```
