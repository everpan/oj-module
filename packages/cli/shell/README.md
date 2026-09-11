# @react-antd-module/shell

预构建宿主站点。模块工程不构建宿主，直接消费这里的 `dist/`。

## 定位

| | |
|---|---|
| 消费者 | `@react-antd-module/cli`（`ram dev` / `ram build`） |
| 产物 | `dist/index.html`（含 importmap）+ `dist/assets/*.js` |
| 职责 | 加载外部模块、渲染容器与菜单；**不内置任何业务模块** |

宿主是「预构建」的：`dist/` 随包分发，外部工程 `npm install` 后即可用，无需在模块工程里重新编译框架。

## 产物结构

```
dist/
├── index.html                  # 含手写 importmap
└── assets/
    ├── index-<hash>.js         # 宿主应用（host.tsx 编译产物）
    ├── runtime.js              # 拷贝自 @react-antd-module/runtime 的 dist
    ├── react.js                # 以下为各共享依赖的单入口自包含 ESM
    ├── react-dom.js
    ├── react-dom-client.js
    ├── jsx-runtime.js
    ├── jsx-dev-runtime.js
    ├── react-router.js
    ├── react-router-dom.js
    ├── react-query.js
    ├── antd.js
    ├── icons.js
    ├── cssinjs.js
    ├── i18next.js
    ├── react-i18next.js
    ├── dayjs.js
    └── clsx.js
```

## 单例是怎么保证的

每个共享依赖单独打包成一个入口文件，**并把其余共享依赖 external**，再由 `index.html` 里的 importmap 把裸说明符映射到这些真实 URL：

```jsonc
{
  "imports": {
    "react": "/assets/react.js",
    "react-dom/client": "/assets/react-dom-client.js",
    "@react-antd-module/runtime": "/assets/runtime.js",
    "antd": "/assets/antd.js"
    // …
  }
}
```

宿主与模块产物都不打包这些依赖，浏览器按同一个 URL 解析 ⇒ 同一份模块实例。漏配任何一项（例如 `@tanstack/react-query`）会让模块脱离对应 Context 而在运行期崩溃，因此共享依赖的判定统一取自 `@react-antd-module/cli/shared-deps`。

> P4.1/P4.3 起 importmap 与预构建入口均由 SHARED_DEPS 单一常量表**自动生成**（`generateImportmap` / `generateShellEntries`），不再存在手写漏配；P7.9 起 `ram build` 还会扫描模块产物的裸说明符，深路径无法被 importmap 解析时构建期直接报错。

## 启动流程

`src/host.tsx`：

1. 初始化 i18next（资源为空，等模块注入）；
2. `fetch("./modules.json")` 拿模块清单；
3. `loadAll(manifest)` —— 并发加载、拓扑排序、执行生命周期、合并 i18n；
4. `getRoutes()` 收集模块路由，注入 `createBrowserRouter`。

外层依次包裹 `StyleProvider` → `ConfigProvider` → `AntdApp` → `QueryClientProvider`，模块无需自己再套一层。

## 构建

```bash
pnpm --filter @react-antd-module/shell build   # 全量构建 dist/
pnpm --filter @react-antd-module/shell dev     # 同上，watch 模式
```

`scripts/build.mts` 会先构建 `@react-antd-module/runtime` 并把 `runtime.js` 拷进 `assets/`，随后逐个构建共享依赖入口，最后构建宿主并注入 importmap。

`dist/` 是**随仓库分发的预置产物**（`.gitignore` 中已显式放行），改动宿主源码或升级共享依赖后需要重新构建并提交。

## 新增共享依赖

共享表单一来源（`packages/cli/src/shared-deps.ts` 的 `SHARED_DEPS`）驱动一切，
只需改动一处：

1. 在 `SHARED_DEPS` 增补条目（`specifier` 为 importmap 键，`asset` 为产物名）；
2. 深路径（如 `dayjs/plugin/utc`）必须**单独成条**——importmap 无前缀通配；
3. 重新 `build` 并提交 `dist/`（versions.json 随之更新，版本门禁自动对齐）。
