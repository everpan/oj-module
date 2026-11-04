# cli 内置宿主（shell 源码）

预构建宿主站点。**不再独立发包**（P1 起并入 `@oj-module/cli`，源码在 `packages/cli/shell/`，
产物在 `packages/cli/shell-dist/`）；模块工程不构建宿主，安装 cli 后直接消费内置产物。

## 定位

| | |
|---|---|
| 消费者 | `@oj-module/cli` 自身（`ojm dev` / `ojm build` 直接取包内 `shell-dist`） |
| 产物 | `shell-dist/index.html`（含 importmap）+ `shell-dist/assets/*.js` |
| 职责 | 加载外部模块、渲染容器与菜单；**不内置任何业务模块** |

宿主是「预构建」的：`shell-dist/` 随 cli 包分发，外部工程 `npm install` 后即可用，无需在模块工程里重新编译框架。

## 产物结构

```
shell-dist/
├── index.html                  # 含构建期注入的 importmap
├── versions.json               # 共享依赖实际安装版本矩阵（版本门禁真源）
└── assets/                     # 全部 .js 都是内容寻址命名 <name>.<hash>.js
    ├── index.<hash>.js         # 宿主应用（host.tsx 编译产物）
    ├── runtime.<hash>.js       # 拷贝自 @oj-module/runtime 的 dist
    ├── contract.<hash>.js      # @oj-module/runtime/contract 子路径资产
    ├── contract-errors.<hash>.js # @oj-module/runtime/contract/errors（zod-free）
    ├── react.<hash>.js         # 以下为各共享依赖的单入口自包含 ESM
    ├── react-dom.<hash>.js
    ├── react-dom-client.<hash>.js
    ├── jsx-runtime.<hash>.js
    ├── jsx-dev-runtime.<hash>.js
    ├── react-router.<hash>.js
    ├── react-router-dom.<hash>.js
    ├── react-query.<hash>.js
    ├── antd.<hash>.js
    ├── icons.<hash>.js
    ├── cssinjs.<hash>.js
    ├── i18next.<hash>.js
    ├── react-i18next.<hash>.js
    ├── dayjs.<hash>.js
    └── clsx.<hash>.js
```

哈希段是 10 位 base36，且**强制**同时含数字与字母——因为 `oj serve` ≥ 0.1.116 的
默认缓存策略按文件名判定：末段 ≥8 位且数字字母都有才发 `immutable, max-age=31536000`，
否则 `no-cache`（每次开页多一个协商 RTT）。共享资产的内容跨构建稳定，所以名字也稳定
（浏览器跨版本直接复用）；`runtime.js` 例外——它内嵌 `__APP_INFO__.lastBuildTime`，
每次构建都会变名。

## 单例是怎么保证的

每个共享依赖单独打包成一个入口文件，**并把其余共享依赖 external**，再由 `index.html` 里的 importmap 把裸说明符映射到这些真实 URL：

```jsonc
{
  "imports": {
    "react": "/assets/react.<hash>.js",
    "react-dom/client": "/assets/react-dom-client.<hash>.js",
    "@oj-module/runtime": "/assets/runtime.<hash>.js",
    "antd": "/assets/antd.<hash>.js"
    // …
  }
}
```

宿主与模块产物都不打包这些依赖，浏览器按同一个 URL 解析 ⇒ 同一份模块实例。漏配任何一项（例如 `@tanstack/react-query`）会让模块脱离对应 Context 而在运行期崩溃，因此共享依赖的判定统一取自 `@oj-module/cli/shared-deps`。

> P4.1/P4.3 起 importmap 与预构建入口均由 SHARED_DEPS 单一常量表**自动生成**（`generateImportmap` / `generateShellEntries`），不再存在手写漏配；P7.9 起 `ojm build` 还会扫描模块产物的裸说明符，深路径无法被 importmap 解析时构建期直接报错。

## 启动流程

`src/host.tsx`：

1. 初始化 i18next（资源为空，等模块注入）；
2. `fetch("./modules.json")` 拿模块清单；
3. `loadAll(manifest)` —— 并发加载、拓扑排序、执行生命周期、合并 i18n；
4. `getRoutes()` 收集模块路由，注入 `createBrowserRouter`。

外层依次包裹 `StyleProvider` → `ConfigProvider` → `AntdApp` → `QueryClientProvider`，模块无需自己再套一层。

## 构建

```bash
pnpm --filter @oj-module/cli build:shell   # 全量构建（含 runtime 完整构建）→ packages/cli/shell-dist/
```

`scripts/build.mts` 会先构建 `@oj-module/runtime`（完整：js + d.ts）并把 `runtime.js` 拷进 `assets/`，随后逐个构建共享依赖入口，最后构建宿主并注入 importmap。共享资产与宿主入口 chunk 在落盘后统一改名为 `<name>.<hash>.js`，importmap / `index.html` 的引用同步改写（见 `hashifySharedAssets` / `hashifyHostEntry`）。

`shell-dist/` 是**随仓库分发的预置产物**（`.gitignore` 中已显式放行），改动宿主源码或升级共享依赖后需要重新构建并提交。

## 新增共享依赖

共享表单一来源（`packages/cli/src/shared-deps.ts` 的 `SHARED_DEPS`）驱动一切，
只需改动一处：

1. 在 `SHARED_DEPS` 增补条目（`specifier` 为 importmap 键，`asset` 为产物名）；
2. 深路径（如 `dayjs/plugin/utc`）必须**单独成条**——importmap 无前缀通配；
3. 重新 `build:shell` 并提交 `shell-dist/`（versions.json 随之更新，版本门禁自动对齐）。
