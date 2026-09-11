# @oj-module/cli

模块工程命令行工具 `ojm`。让外部团队只维护模块代码，框架与宿主全部来自 npm。

## 安装

```jsonc
{
  "devDependencies": {
    "@oj-module/cli": "^x.y.z",
    "@oj-module/runtime": "^x.y.z"
  },
  "scripts": {
    "dev": "ojm dev",
    "build": "ojm build"
  }
}
```

> 只需两个框架包（P1 起合为双包）：`@oj-module/cli`（Node 工具链 + 内置预构建宿主 `shell-dist`）
> 与 `@oj-module/runtime`（浏览器运行时 + `contract` 子路径）。

## 命令

```bash
ojm dev [port]   # 启动开发服务器（默认 5174）：宿主代理 + 本地模块重建
ojm build        # 构建模块产物与 dist/modules.json
ojm init [dir] [--yes]        # 脚手架：模板工程 + 证书签发 + 联网下载 oj 到 bin/
ojm vendor [tag] [--force]    # 下载/重装 oj vendor（经 npm 包 @oj-bin/oj，tag 缺省取最新版本，形如 v0.1.13）
ojm preview [port] [--oj-static]   # 生产形态预览：oj migrate + release + 静态兜底
ojm info        # 输出报障所需的版本矩阵与后端观测
ojm api [dir]   # 契约产物生成（client/openapi/mock stub）
ojm merge <out> <in...>  # 合并多份 modules.json
```

> `ojm init` / `ojm vendor` 需要访问 npm registry（经 `npm i @oj-bin/oj` 安装 oj 到 `bin/`，走 `.npmrc` 镜像配置）。已装版本记录在 `bin/.oj-version`，`ojm info` 可查。
>
> **别名**：`ram` 是 `ojm` 的弃用别名（打印更名警告后转发），供存量工程 scripts 平滑升级，将在下个 major 移除。

### `ojm build`

读取 `modules.config.ts`，逐个模块构建：

```
dist/
├── modules.json                              # 模块清单（供宿主 fetch）
└── modules/<name>/<version>/
    ├── entry.js                              # 模块入口
    ├── <chunk>.js                            # 保留 code splitting
    └── *.css
```

- 只有共享表内的依赖被 external，其余依赖会被打进模块产物（不在表内时 CLI 会告警）；
- 每个 chunk 计算 `sha384` 完整性摘要写入 `modules.json`，懒加载 chunk 标记 `lazy: true`；
- 模块元信息（`name` / `version` / `peerRuntime`）通过 esbuild 打包后真实 `import()` entry 读取，而非正则解析——因此配置文件里可以写注释、用变量、做条件判断；
- 读取元信息时 `@oj-module/runtime` 被替换为只读占位模块，避免在 Node 下加载含 Vite 专有 svg 导入的框架运行时。

### `ojm dev`

1. 直接取本包内置的预构建宿主 `shell-dist`（随 cli 发布，**不再**查询 `node_modules/@oj-module/shell`，也无 monorepo 路径回退）；
2. 先跑一次 `ojm build`；
3. 起静态服务器：

   | 路由 | 来源 |
   |---|---|
   | `/`、`/index.html` | `@oj-module/cli/shell-dist/index.html`（含 importmap） |
   | `/assets/*` | `@oj-module/cli/shell-dist/assets/*` |
   | `/modules.json` | 本地 `dist/modules.json` |
   | `/modules/*` | 本地 `dist/modules/*` |

4. 监听 `modules/` 变更并增量重建（防抖 300ms）。

> 当前为「保存即重建 + 手动刷新」。完整 HMR（react-refresh preamble、dev-runtime 映射）在后续阶段接入。

## 配置文件

工程根目录的 `modules.config.ts`：

```ts
export default {
  /** 产物 URL 前缀，留空表示同源相对路径；跨源时填 CDN 绝对地址 */
  baseUrl: "",
  modules: [
    { name: "demo", entry: "./modules/demo/entry.ts", enabled: true },
  ],
};
```

`name` 必须与 `entry.ts` 中 `defineModule({ name })` 一致，不一致会直接构建失败。`enabled: false` 的模块会被跳过。

## 子出口

```ts
// 共享依赖表 —— importmap / external / 版本校验的单一常量源
import { generateImportmap, generateShellEntries, isSharedDep, SHARED_DEPS } from "@oj-module/cli/shared-deps";

// 配置加载
import { loadModulesConfig, resolveModuleEntry } from "@oj-module/cli/config";
```

**硬共享**（`react` / `react-router` / `@tanstack/react-query` / `@oj-module/runtime` …）破坏即崩溃，必须由宿主提供，模块不得自带；**软共享**（`antd` / `dayjs` / `i18next` …）允许版本漂移。

## 实现说明

`bin/ojm.mjs` 通过 `--import tsx` 让 Node 直接执行 TypeScript 源码，因此包发布时带 `src/` 而不是编译产物；`bin/ram.mjs` 是等价的弃用别名 shim。
