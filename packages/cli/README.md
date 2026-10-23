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
# 工程脚手架
ojm init [dir] [--yes]                           # 前后端一体化脚手架（幂等补缺：重跑只补缺失，永不覆盖已有文件）
ojm new <name> [--layout container|none] [--api] # 脚手架内生成用户方案骨架（src/<name>/ + solution.yaml）

# 开发与构建
ojm dev [port]                                   # 开发服务器：/api 反代 oj + 模块重建 + SSE 自动刷新（快捷键 r/h/c/o/q）
ojm build [--bundle [name]] [--out <dir>]        # 构建后端（oj build）与模块产物；--bundle 打确定性方案包
ojm preview [port]                               # 生产形态预览：migrate → oj serve 单服务（API + 静态 SPA 同进程）
ojm api [dir] [--check] [--docs] [--exempt <p>]  # 契约代码生成（client/routes/openapi/stub）；--check 四重对账

# 清单与诊断
ojm info [--all]                                 # 版本矩阵与模块清单（报障用）
ojm merge <out.json> <in1.json> [in2.json ...]   # 合并多团队清单（清单先后 = 接管优先级）
ojm vendor [tag] [--force]                       # 下载/重装 oj vendor（经 npm 包 @oj-bin/oj，tag 形如 v0.1.13）

# 方案市场（站点侧生命周期）
ojm install <file.tgz | name[@version]>          # 安装方案包到目标站点（file 上传 / CDN 市场源）
ojm enable|disable <name>                        # 启用/禁用已装方案（锁/sidecar/路由清单/模块清单四处同写）
ojm uninstall <name>                             # 卸载已装方案（四处同删 + 权限级联清理）
ojm trust ls|add|revoke|confirm                  # 发布方信任库管理（TOFU 确认）

# 发布与签名（作者侧）
ojm keygen --id <publisher.id>                   # 生成 Ed25519 签名密钥对（私钥缺省 ~/.ojm/keys/<id>/）
ojm sign <file.tgz> --id <id> [--check]          # detached 侧车签名（产出 <tgz>.sig）
ojm publish <dir> --id <id> [--check]            # 索引发布（重算 bundles/manifests + 侧车签名）

# 本地市场模拟 CDN
ojm market setup|publish|build-index|verify|trial|walkthrough

# oj 子命令透传
ojm test|exec|openapi|migrate|schema [args...]   # 透传给 oj 同名子命令（自动补 -c <project>/config.yaml）
```

> 每个命令都有中英双语帮助：`ojm <cmd> --help` 看单命令详解，`ojm help` 看全量索引
> （语言按 `OJM_LANG` / `LANG` 探测，缺省 zh-CN）。`ojm --version` 显示 cli 包版本。
> 方案市场的完整链路（打包 → 签名 → 索引 → 安装 → 生命周期）见 devkit 手册 §10–§12。

### `ojm build`

构建后端与前端产物（module-root 布局为默认，模块由扫描 `src/*/web/entry.ts` 收录，
`web.config.ts` 仅作可选覆盖；历史布局仍以 `web.config.ts` 的 `modules` 为真源）：

```
web/dist/
├── index.html                             # 全站合并后的宿主页（仅 build 做清场合并）
├── modules.json                           # 模块清单（供宿主 fetch）
└── modules/<name>/<version>/
    ├── entry.js                           # 模块入口
    ├── <chunk>.js                         # 保留 code splitting
    └── *.css
```

- 只有共享表内的依赖被 external，其余依赖会被打进模块产物（不在表内时 CLI 会告警）；
- 每个 chunk 计算 `sha384` 完整性摘要写入 `modules.json`，懒加载 chunk 标记 `lazy: true`；
- 模块元信息（`name` / `version` / `peerRuntime`）通过 esbuild 打包后真实 `import()` entry 读取，而非正则解析——因此配置文件里可以写注释、用变量、做条件判断；
- 读取元信息时 `@oj-module/runtime` 被替换为只读占位模块，避免在 Node 下加载含 Vite 专有 svg 导入的框架运行时；
- `--bundle [name]`：只组装不构建，先 `ojm build` 再打包——两段式契约校验（fail-fast）后产出确定性
  `dist/<name>-<version>.tgz` + sha256（市场安装器的上游产物）；无参 = 全部用户方案。

### `ojm dev`

1. 直接取本包内置的预构建宿主 `shell-dist`（随 cli 发布，**不再**查询 `node_modules/@oj-module/shell`，也无 monorepo 路径回退）；
2. 先跑一次 `ojm build`；
3. 起开发服务器：

   | 路由 | 来源 |
   |---|---|
   | `/api/*` | 反代到 oj 后端（oj 端口以 `config.yaml` 的 `server.port` 为准，默认 9778） |
   | `/`、`/index.html` | `@oj-module/cli/shell-dist/index.html`（含 importmap） |
   | `/assets/*` | `@oj-module/cli/shell-dist/assets/*` |
   | `/modules.json` | 本地 `web/dist/modules.json` |
   | `/modules/*` | 本地 `web/dist/modules/*` |

4. 监听 `web/src/`（module-root 为 `src/*/web/`）变更并增量重建（防抖 300ms），经 SSE 通道**自动刷新浏览器**；
5. TTY 终端启用类 Vite 快捷键：`r` 强制重建热更新 · `h` 帮助 · `c` 清屏 · `o` 浏览器打开 · `q` 退出（后端 oj 一并终止，不留孤儿占端口）。

## 配置文件

工程根目录的 `web.config.ts`（module-root 布局下可选，仅 `baseUrl` / `siteBase` /
`htmlTransform` 等站点级配置才需要它；`modules` 登记只对历史布局必填）：

```ts
export default {
  /** 产物 URL 前缀，留空表示同源相对路径；跨源时填 CDN 绝对地址 */
  baseUrl: "",
  /** 站点部署子路径（如 "/oj"），留空 = 挂在域名根；与 baseUrl 正交可同用 */
  siteBase: "",
  /** 历史布局的模块登记；module-root 布局由扫描 src/*/web/entry.ts 得出 */
  modules: [
    { name: "demo", entry: "./web/src/demo/entry.ts", enabled: true },
  ],
  /** 按路由改写 HTML 的模块（仅 ojm dev 生效，见下） */
  htmlTransform: "./html-transform.ts",
};
```

`name` 必须与 `entry.ts` 中 `defineModule({ name})` 一致，不一致会直接构建失败。`enabled: false` 的模块会被跳过。

### 按路由改写 HTML（`htmlTransform`，可选）

模块联邦站点每条路由都出同一份 `index.html`，逐路由的 `<title>` / OpenGraph 无从表达——IM 链接预览与非 JS 爬虫只会看到默认 title。配 `htmlTransform` 指向一个模块（相对工程根的路径，或已安装的包名），`ojm dev` 会加载它，对 `/`、`/index.html` 与 SPA 回落的深链接统一生效：

```ts
// html-transform.ts —— default 导出即变换函数
export default async function (path: string, html: string) {
  if (path.startsWith("/share/"))
    return html.replace("</title>", ` · 分享</title>`); // 返回新 HTML 字符串
  return { html, cacheControl: "public, max-age=300" };   // 或 { html, cacheControl? }
}
```

- `path` 是解码后的请求路径（查询串已剥离），`html` 是宿主原文；
- 先变换、后注入 dev 刷新脚本，故热刷新不受影响；
- 变换抛错或返回非字符串 → 回退原文，站点不 500；
- 模块缺失或 default 不是函数 → 启动即人话报错（fail-fast）；
- 非 HTML 资产（`/assets/*`、`/modules/*`）不受影响；
- **仅 `ojm dev` 生效**：单服务 `ojm preview` 由 oj 直出 HTML，钩子无从介入（启动 WARN 并指向 oj 的 `server.html_meta` / `server.html_meta_handler`）。

## 子出口

```ts
// 共享依赖表 —— importmap / external / 版本校验的单一常量源
import { generateImportmap, generateShellEntries, isSharedDep, SHARED_DEPS } from "@oj-module/cli/shared-deps";

// 配置加载
import { loadModulesConfig, resolveModuleEntry } from "@oj-module/cli/config";

// 构建 / 诊断 / 校验（Node 侧工具链复用）
import { buildModules } from "@oj-module/cli/build";
import { printInfo, mergeManifests } from "@oj-module/cli/info";
import { collectExportGaps } from "@oj-module/cli/esm-exports";
import { mergeModuleManifests } from "@oj-module/cli/manifest";

// 预构建宿主资产（随包发布）
import "@oj-module/cli/shell-dist/index.html";
```

**硬共享**（`react` / `react-router` / `@tanstack/react-query` / `@oj-module/runtime` …）破坏即崩溃，必须由宿主提供，模块不得自带；**软共享**（`antd` / `dayjs` / `i18next` …）允许版本漂移。

## 实现说明

`bin/ojm.mjs` 通过 `--import tsx` 让 Node 直接执行 TypeScript 源码，因此包发布时带 `src/` 而不是编译产物。
