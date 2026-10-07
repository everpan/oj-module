# 框架贡献者路线（仅本仓）

> 读者：改 `packages/runtime/`、`packages/cli/` 的人。
> **业务工程里用不到本文件**——那些工程只有 `web/src` + `api/src`，
> 没有 `packages/`。业务开发看 `SKILL.md` + `manual.md`。

## §1 先读哪份文档

本仓已有详尽文档，**本文件不重复它们**，只做路由 + 补红线：

| 你要做的事 | 读 |
|---|---|
| 认证/路由/布局/store 怎么组织的 | `CLAUDE.md`（本仓根，架构总览） |
| 框架开发完整指南（契约层/运行时/宿主/工具链四章） | `docs/prd/framework-development-guide.md` |
| 端到端可重复验证流程 | `docs/prd/framework-verification-playbook.md` |
| 某特性的设计与评审记录 | `docs/prd/<日期>-<特性>-design.md` |
| 各阶段实战记录（骨架→注入→认证→CRUD→release） | `apps/playground-oj/docs/phase*.md` |
| 后端 handler 写法 | `bin/devkit/api-manual.md`（`oj-api-dev` skill） |

> ⚠️ 那两份 guide 有**已知陈旧处**，以源码为准：
> dev 端口实际是 **3333**（guide 写的 5173 已过时）；包版本以
> `packages/*/package.json` 为准（guide 内部 0.1.6 / 0.1.8 不一致，实际 **0.1.8**）。

## §2 两包结构与依赖方向

按运行环境切分，**只有一条边**：`cli → runtime`（`workspace:*`，发布时被
pnpm 改写成**精确版本**，不是 `^` 范围）。

| 包 | 面 | 内容 |
|---|---|---|
| `packages/runtime` | 浏览器 | 路由 / 布局 / store / 请求 / 组件 / module-loader，+ 契约 DSL 子路径（`./contract`、`./contract/errors`） |
| `packages/cli` | Node 工具链 | `ojm dev/build/info/merge/api/vendor`，+ 预构建宿主（源码 `shell/`、产物 `shell-dist/`、模板 `templates/`） |

- 宿主产物随 cli 发布；`ojm dev/build` 直接从 cli 包内 `shell-dist` 取宿主，
  不再依赖独立 shell 包或 monorepo 路径回退。
- **双入口别搞混**：给模块作者用的加在 `src/index.ts`；框架自己怎么启动看 `src/index.tsx`。
- `#src/*` alias 指向 `packages/runtime/src/*`（由 `packages/runtime/package.json`
  的 `imports` 字段与 vite alias **双声明**，即「模块仅 import 三类」不变式）。
- 业务工程**不打包共享依赖**——宿主经 importmap 提供单例。

## §3 常用命令

```bash
pnpm dev                  # 本仓开发服务器 http://localhost:3333
pnpm build                # vite build + 模块产物 + importmap 注入
pnpm test                 # vitest（happy-dom）
pnpm test:e2e             # playwright
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint（Prettier 已禁用）
pnpm check:circular-deps  # 循环依赖检查（只扫 packages/runtime/src）
pnpm create:module        # 交互式新建模块向导

# 单包构建（改了 runtime 源码就必须跑）
pnpm --filter @oj-module/runtime build      # → dist/runtime.js + index.d.ts + contract/*
pnpm --filter @oj-module/cli build:shell    # 含 runtime 构建 + host.js + importmap + 共享资产
node packages/cli/scripts/sync-host-versions.mjs   # prepack 内容：同步 vendor/host-versions.json

# 定向测试
pnpm test tests/runtime                     # 运行时单测
pnpm test tests/runtime/runtime-exports.test.ts   # 出口冻结契约
pnpm test tests/cli                         # cli 全量（contract-* 含快照）
pnpm test tests/shell                       # 宿主全量
```

格式：**Tab 缩进、双引号、必须有分号**。`simple-git-hooks` + `lint-staged`
在 pre-commit 跑 ESLint；`commitlint` 强制 conventional commit。

## §4 红线（改动前必读）

### 4.1 四条通用红线

1. **共享依赖只能有一个版本**：安装走 `catalog:`，产物走宿主（cli 内置
   `shell-dist`）importmap 单例。私自写死 `react@18` 会导致「双 React」崩溃。
2. **`packages/runtime/dist`、`packages/cli/shell-dist` 随仓库提交**
   （`.gitignore` 为它们开了例外）。**改了源码必须重建并提交产物**，
   否则本地/CI 跑的是旧产物——历史上多次出现「方法不存在」。
3. **不要绕过门禁**：宿主的导出完整性检查、动态 require 检查、版本矩阵校验
   都是硬门，失败要查根因，别 `--no-verify` 或注释掉断言。
4. **改公开出口是破坏性变更**：runtime 出口有冻结契约测试
   （`tests/runtime/runtime-exports.test.ts`），加/删导出会让它红，属预期。

### 4.2 三道硬门禁（`assertSharedExportsComplete()`，任一不过直接构建失败）

1. **具名导出完整性**——否则浏览器抛 `does not provide an export named 'x'`（整页白屏）；
2. **裸说明符被 importmap 覆盖**——否则抛 `Failed to resolve module specifier`；
3. **无未垫片的动态 `require`**——否则抛 `Dynamic require of ... is not supported`。

> **构建成功 ≠ 能加载。** `export *` 经 external 子路径会退化成运行期对象
> （文件在、体积对、退出码 0，浏览器却白屏）。这就是门禁存在的原因。

### 4.3 新增一个共享依赖（三步，漏一处即红）

1. `packages/cli/src/shared-deps.ts` 的 `SHARED_DEPS` 登记 `{ specifier, asset, hard }`；
2. `pnpm-workspace.yaml` 的 `catalog` 登记版本；
3. 各包 `package.json` 改写成 `"catalog:"`（**不要写死版本**）。

漏改任一处，`tests/shell/host-version-drift.test.ts` 与
`tests/shell/version-gate.test.ts` 会红。

### 4.4 不变式索引

| 不变式 | 说明 |
|---|---|
| scoped request 在 onInit 绑定 | `onInit` 里绑定 scoped request |
| 契约前缀字面相等 | uni-dev 形态 `apiPrefix` 必须字面等于目录名 |
| 模块仅 import 三类（`#src` 双声明） | `#src/*` 由 package.json `imports` 与 vite alias 双声明 |
| 模块元信息从 entry.ts 解析 | 模块 name/version 从 `entry.ts` 解析（esbuild bundle + 真实 `import()`） |
| 生产产物不含 fake | 生产构建不含 fake 代码（**有测试断言产物里无 fake**） |
| 模块级权限路由注入前过滤 | 模块级 `requiredRoles` / `requiredPermissions` 在路由**注入之前**筛掉 |
| 布局显式声明 | 布局显式声明，不做隐式推导；模块不 import 布局组件 |
| 请求前缀收敛 | `ctx.utils.request` 只拿按 `apiPrefix` 收敛的 scoped client；越界、`../` 穿越、逐请求 prefix 覆盖均被拒 |
| 内置异常后备页 | 框架内置 `/exception/403\|404\|500` 后备页；exception 模块仅为可选覆盖 |
| 宿主 runtime 版本锁等 | prepack 断言宿主 runtime 版本 == `packages/runtime` 版本 |
| merge 合并多团队清单 | `ojm merge` 合并多团队清单 |

### 4.5 守卫测试索引（改动后知道哪个会红）

| 测试 | 守护内容 |
|---|---|
| `tests/runtime/runtime-exports.test.ts` | runtime 出口冻结（加/删导出即红） |
| `tests/module/module-package-imports.test.ts` | 模块只 import 三类东西（「模块仅 import 三类」不变式） |
| `tests/module/module-required-roles.test.ts` | 模块级权限路由注入前过滤 |
| `tests/runtime/scoped-request.test.ts` | 请求前缀收敛（scoped client） |
| `tests/shell/no-fake-in-dist.test.ts` | 生产产物不含 fake |
| `tests/shell/shell-importmap.test.ts` | 门禁一致性 + runtime.js 与包 dist 一致 + 深路径回归 |
| `tests/shell/host-version-drift.test.ts`、`version-gate.test.ts` | 共享依赖三处同步 |
| `tests/cli/release-manifest.test.ts` | 真跑 `pnpm pack`，守护 `workspace:*` → 精确版本改写 |
| `tests/cli/__snapshots__` | 契约代码生成快照（改 `defineApi` 校验规则需同步更新） |

## §5 发布（lockstep，别用 npm publish）

- 两包**同版本号**（当前 `0.1.8`），后续发版保持 lockstep。
- **必须 `pnpm publish`**——用 `npm publish` 会漏出 `workspace:*` / `catalog:` 字面量。
- **顺序：先 `runtime` 后 `cli`**。`runtime` 未公开时，新 `cli` 的精确依赖会悬空，
  消费者直接装不上。
- 发布后**立刻**读 registry 可能仍是旧版本/404（CDN 传播延迟，实测约 90s）。
  最可靠的确认是**再发一次同版本**——返回
  `403 You cannot publish over the previously published versions: x.y.z` 即已成功。
  `npm view` 读镜像可能一直 404，别用它判断。
- `package.json#files` 的**取反有顺序语义**：`"!shell-dist/**/*.map"` 必须排在
  `"shell-dist"` **之后**才生效（排前面等于没写，包体 3.85MB → 10.8MB）。
  `files` 白名单内的文件无法被 `.npmignore` 排除。

## §6 本仓工作纪律

1. **文档先行**：先写计划/任务/需求/用例文档，保存后才动代码。
   文档命名 `日期+时分` 前缀，带序号时用 `phase1`/`round1`。
2. **TDD / BDD**：用例先红后绿；文档优用 BDD markdown，多条件测试编数据表格。
3. **一次逻辑一个分支**：实现或重构前先建分支。
4. **发现反常规/反常识/与业界不符的问题**，当场追加到文档并分类记录。
5. **完工更新任务状态 + 写小结段**（关键过程与耗时）。

## §7 待对接（未做）

本 devkit（`docs/devkit/`）目前只是**源文件**，还没接进发布链路：

- `packages/cli/src/init.ts` 的分发逻辑（约 77–87 行）现在只拷 `bin/devkit/`
  里的 **oj** devkit 到 `.claude/skills/oj-api-dev/`；
- 要让业务工程自动拿到本 skill，需把 `docs/devkit/` 归置进 cli 包，
  并在 init 里多拷一份到 `.claude/skills/ojm-module-dev/`。

在此之前，业务工程按 `README.md` 的手动拷贝方式安装。
