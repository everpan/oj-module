# @oj-module/runtime

框架运行时。模块工程**唯一**应该 import 的框架入口。

## 定位

| | |
|---|---|
| 消费者 | 模块工程（`entry.ts` 与页面代码）、宿主（`@oj-module/cli` 内置 `shell-dist`） |
| 产物 | `dist/runtime.js`（单文件 ESM）。`dist/runtime.d.ts` 尚未产出，类型出口在 P3 随出口冻结一起收敛 |
| 加载方式 | 由宿主 importmap 映射为 `/assets/runtime.js`，全站唯一实例（单例，见设计文档 D5） |

产物只保留**相对路径**代码；所有裸说明符（`react` / `antd` / `react-router` …）都被 external，交给宿主 importmap 解析。这是单例的实现前提——模块与宿主 import 到的是同一个 URL，因而是同一份实例。

## 安装

模块工程把它放在 `devDependencies`（仅用于类型检查与 IDE 跳转），运行期由宿主提供：

```jsonc
{
  "devDependencies": {
    "@oj-module/runtime": "^x.y.z"
  }
}
```

## 对外出口

出口在 `src/index.ts` 收敛，当前为最小集合（P3 阶段依据实际用量冻结）：

```ts
// 模块契约
import type {
  AppRouteRecordRaw,
  ModuleDefinition,
  RouteMeta,
} from "@oj-module/runtime";
import {
  BasicContent,
  defineModule,
} from "@oj-module/runtime";

// 宿主侧模块加载（模块工程一般不需要）
import {
  getModule,
  getModules,
  getRegisteredApiPrefix,
  getRegisteredStore,
  getRoutes,
  loadAll,
} from "@oj-module/runtime";
```

> `antd`、`react`、`react-router`、`@tanstack/react-query` 等共享依赖**不从 runtime 转出**。模块请直接 import 这些包，由 importmap 命中宿主提供的同一份实例。

## 模块定义示例

```ts
import type { AppRouteRecordRaw, ModuleDefinition } from "@oj-module/runtime";
import { defineModule } from "@oj-module/runtime";
import { lazy } from "react";

const routes: AppRouteRecordRaw[] = [
  {
    path: "/demo",
    Component: lazy(() => import("./pages/demo")),
    handle: {
      title: "demo:menu.demo",
      // 布局语义：container（默认）| parent | none
      layout: "container",
    },
  },
];

export default defineModule({
  name: "demo",
  description: "示例模块",
  version: "1.0.0",
  routes,
  i18n: {
    "zh-CN": () => import("./locales/zh-CN.json"),
    "en-US": () => import("./locales/en-US.json"),
  },
} satisfies ModuleDefinition);
```

## 内置能力（非出口，但影响模块行为）

- **路由级缓存**：KeepAlive 位于宿主固定层，缓存开关由各模块路由的 `handle.keepAlive` 汇总得出，不依赖任何具体布局组件是否存在。
- **布局语义**：`handle.layout` 决定该路由用哪层布局包裹（`container` / `parent` / `none`）。迁移期未声明时按 `container` 处理，保持既有行为。
- **兜底页**：`NotFound`（404）与 `UnknownComponent`（后端下发路由找不到前端组件）由框架内置，模块无需提供；需要自定义时用自己的路由覆盖。

## 构建

```bash
# 只出 JS（shell 构建链路走这条，当前唯一可用的构建）
pnpm --filter @oj-module/runtime exec vite build

# vite build + tsc 出 d.ts + 重写 d.ts 里的 #src/* 说明符
# ⚠️ 目前 tsc 声明阶段仍有 3 处 declaration-emit 报错，属 P3 待办
pnpm --filter @oj-module/runtime build
```

`dist/` 是**随仓库分发的预置产物**（`.gitignore` 中已显式放行），改动 runtime 源码后需要重新构建并提交。

## 目录约定

```
packages/runtime/src/
├── index.ts          # 唯一对外出口
├── components/       # 框架组件（含 not-found / unknown-component 兜底页）
├── layout/           # 布局与 keep-alive-layer（宿主固定层）
├── module-loader/    # 模块加载、拓扑排序、生命周期、i18n 合并
├── router/           # 路由类型、工具、核心路由表
├── locales/          # 框架文案（模块文案由模块自带）
└── store/            # 框架状态
```

内部引用统一走 `#src/*` 子路径 imports；**禁止**出现 `#modules/*`（框架不得反向依赖业务模块，CI 有卡口）。
