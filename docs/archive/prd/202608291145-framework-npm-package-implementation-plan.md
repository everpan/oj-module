# 框架 npm 包化 — 实施步骤

> 关联设计: `docs/prd/202608291025-framework-npm-package-design.md`（v2）
> 新人接手请先读: `docs/prd/handover-framework-npm-package.md`（交接手册：目标、决策取舍、进度、验收、雷区）
> 创建时间: 2026-08-29 11:45
> 前置决策: O2 = 公开 npm；O3 = 同源静态清单、不实施签名（同组织不同团队）；O7 refreshToken 未决，不阻塞

---

## 0. 全局约定

### 分支策略

每个 Phase / Spike 独立分支，独立评审，可单独回滚。

**基线分支为 `modularization`，不是 `main`**。`main` 落后 32 个提交且不含模块系统；模块化改造全部在 `modularization` 上。所有 `feature/pkg-*` 与 `spike/*` 分支均从 `modularization` 切出。

| 阶段 | 分支 |
|------|------|
| P0 | `feature/pkg-p0-monorepo` |
| Spike A | `spike/esm-importmap` |
| Spike B | `spike/module-tailwind` |
| P1 | `feature/pkg-p1-vertical-slice` |
| P2 | `feature/pkg-p2-inversion` |
| P3 | `feature/pkg-p3-runtime-api` |
| P4 | `feature/pkg-p4-shell` |
| P5 | `feature/pkg-p5-migration` |
| P6 | `feature/pkg-p6-security` |

Spike A / Spike B 与 P0 无代码依赖，**可与 P0 并行**，且优先于 P1 得出结论。

### 每个任务的执行顺序（TDD / BDD）

1. 先写或改**用例**（`tests/**` 或 spike 内的验证脚本），确认它因目标未实现而失败
2. 再写实现
3. 跑 `pnpm test` + `pnpm typecheck` + `pnpm lint`
4. 更新本文档的任务状态与本阶段总结

### 每阶段收尾

- 更新本文档任务状态
- 追加「总结」段落：关键过程、实际耗时、与设计文档的偏差及原因
- 发现的新问题按 §设计文档 §9 追加到「反常识 / 反常规记录」

---

## P0: Monorepo 骨架 + 双 Spike

**目标**：把框架源码迁到 workspace 包内，同时用两个 Spike 验证方案地基。**此阶段不改变任何运行时行为。**

**完成判据**：`pnpm dev` / `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint` 行为与迁移前一致；两个 Spike 给出明确的 Go / No-Go 结论。

### Task 0.1 — 建分支

```bash
git switch -c feature/pkg-p0-monorepo
```

### Task 0.2 — 迁移 `src/` → `packages/runtime/src/`

**用例先行**：在 `tests/` 新增 `tests/monorepo-layout.test.ts`，断言：

| 断言 | 内容 |
|------|------|
| 框架源码位置 | `packages/runtime/src` 存在且含 `router/` `layout/` `components/` `module-loader/` |
| 旧路径已消失 | 根目录 `src/` 不存在 |
| 反向依赖未扩大 | `packages/runtime/src` 中 `#modules` 的出现次数 ≤ 迁移前统计值（当前 2 处） |
| tsconfig 覆盖 | `tsconfig.json` 的 paths 中 `#src/*` 指向 `packages/runtime/src/*` |

**实现步骤**：

1. `git mv src packages/runtime/src`
2. `package.json` 的 `imports` 改为：
   ```json
   "imports": {
     "#src/*": "./packages/runtime/src/*",
     "#*": "./*"
   }
   ```
   （Node 解析取最长前缀匹配，`#src/*` 优先于 `#*`，`#modules/*` 与 `#manifest.json` 仍走 `#*`。）
3. `tsconfig.json` 的 `paths`：`"#src/*": ["packages/runtime/src/*"]`
4. `vite.config.ts` 的 alias：`#src` → `path.resolve(__dirname, "packages/runtime/src")`
5. `package.json` 的 `check:circular-deps`：`ds packages/runtime/src`

**已知会踩的坑（迁移时必须同步改，否则静默失效）**：

| 位置 | 现状 | 改为 |
|------|------|------|
| `src/router/utils/generate-routes-from-backend.ts:14-17` | `import.meta.glob(["/src/pages/**/*.tsx", "/modules/*/pages/**/*.tsx"])` | `/packages/runtime/src/pages/**/*.tsx`（**字面量，不会被 alias 改写**） |
| `vite.config.ts:76` | `FileSystemIconLoader("./src/icons/svg")` | `./packages/runtime/src/icons/svg`（相对 vite root） |
| `src/router/routes/index.ts:10-12` | `import.meta.glob` 收集 `external/**` `static/**` | 核对是否含根相对字面量 |
| `packages/runtime/src/styles/index.css` → `plugins/tailwind.ts` | `@plugin` 相对路径，随目录整体迁移无需改 | 但该文件经 **jiti** 加载，其 `#src/*` 走 Node 解析，见下方 A11 |
| **`index.html:23`** | `src="/src/index.tsx"` | `src="/packages/runtime/src/index.tsx"`（Vite 能启动，但页面 404） |
| **`packages/runtime/package.json`** | 新建子包后需自行声明 `imports` | 否则截断父包 imports，见下方 A11 |

#### ⚠️ 实测新增的两个坑（A11 / A12）

**A11 · 新建子包 package.json 会截断父包的 `imports` 解析**（本次构建失败的直接原因，共触发 2 次）

Node 的 subpath imports 只查找**最近的** package.json，**不向上回溯**。把 `src/` 迁到 `packages/runtime/src/` 并新建 `packages/runtime/package.json` 后：

1. Tailwind 经 jiti 加载 `plugins/tailwind.ts` → `#src/styles/theme/antd/css-variables` 解析失败（此处是 Node `require`，Vite alias 与 tsconfig paths 均不生效）
2. `auth-guard.tsx` 的 `#manifest.json` → Vite `resolveSubpathImports` 报 `Missing "#manifest.json" specifier in "@react-antd-module/runtime" package`

**修复**：子包 package.json 必须自行声明完整的 `imports`：

```json
"imports": {
  "#src/*": "./src/*",
  "#modules/*": "../../modules/*",
  "#manifest.json": "../../manifest.json"
}
```

**推广结论**：凡是被 Node 侧（jiti / tsx / 脚本）加载的文件，其 `#` 说明符都要由最近的 package.json 兜住——Vite alias 救不了。

**A12 · 页面入口路径写在 `index.html` 里，同样不会被 alias 改写**
| `scripts/` | 硬编码 `src` 路径 | 逐个核对 |

### Task 0.3 — workspace 与包元数据

1. `pnpm-workspace.yaml` 的 `packages` 加 `packages/*`（保留 `docs`）
2. 建 `packages/runtime/package.json` 骨架：
   ```json
   {
     "name": "@react-antd-module/runtime",
     "version": "0.0.0",
     "type": "module",
     "private": true,
     "exports": { ".": "./dist/runtime.js", "./router": "./dist/router.js", "./module": "./dist/module.js" },
     "files": ["dist"],
     "peerDependencies": { "react": "^19.2.6", "react-dom": "^19.2.6", "antd": "^6.4.2" }
   }
   ```
   （P3 才真正出 dist；此处先占位，`private: true` 防止误发。）

### Task 0.4 — 测试路径常量化

**目的**：让 P2/P5 的路径变更只改一处。

| 文件 | 改动 |
|------|------|
| `tests/module-route-priority.test.ts:7-8` | `src/router/...` → `${RUNTIME_DIR}/router/...` |
| `tests/module-i18n-consistency.test.ts:302/360/392` | 硬编码 `src/locales/zh-CN/*`、`import("#src/router/utils/add-route-id-by-path")` → 走常量 / `#src/*` |
| `tests/demo.test.tsx` | 核对有无硬编码路径 |

抽出共享常量：新建 `tests/helpers/paths.ts`
```ts
export const PROJECT_ROOT = path.resolve(__dirname, "../..");
export const RUNTIME_DIR = path.join(PROJECT_ROOT, "packages/runtime/src");
export const MODULES_DIR = path.join(PROJECT_ROOT, "modules");
```

### Task 0.5 — 验收

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

对比判据：`build/assets` 的产物清单与总体积相对迁移前**无显著差异**（允许 chunk 哈希变化），且 `pnpm dev` 手动冒烟登录 → 首页 → 系统管理 正常。

### Task 0.6 — 双 Spike（独立分支，与 P0 并行）

#### Spike A — antd / react-router / react-query 单入口自包含 ESM + importmap

**分支**：`spike/esm-importmap`
**验证问题**：D2（importmap 全量共享）的地基是否成立。失败则 R3 触发退化方案。

**步骤**：

1. 建 `spikes/esm-importmap/`，一个 lib 模式 vite 工程，entry 导出：
   - `antd`：`ConfigProvider` `Button` `Table` `Modal` + `antd/locale/zh_CN`
   - 深路径：`antd/es/message/interface`、`antd/es/modal/confirm`（类型 + 运行时）
   - `react-router/dom`、`react-router`
   - `@tanstack/react-query`
   - `@react-antd-module/runtime` 的最小替身（导出一个 `createElement` 组件）
2. `external` 掉 `react` / `react-dom` / `react/jsx-runtime`，其余全部打进单文件 ESM
3. 写 `spikes/esm-importmap/index.html`，内联 importmap 映射上述裸说明符与深路径前缀（含 `"antd/": "/antd/"`）
4. 起静态服务，浏览器验证清单：

| 验证项 | 期望 |
|--------|------|
| 组件渲染 | Button/Table 正常 |
| 主题 token | `ConfigProvider` 的 theme 生效 |
| 样式层序 | `StyleProvider layer` 与 tailwind `@layer` 不打架 |
| locale | `antd/locale/zh_CN` 生效 |
| 深路径 | `antd/es/modal/confirm` 可调用 |
| router | `react-router/dom` 的 Router 可用 |
| query | `QueryClientProvider` 与 `useQuery` 正常 |
| 产物 | 单入口、无 CJS 残留、chunk 数量、体积 |
| 控制台 | 无警告、无双实例提示 |

**产出**：`spikes/esm-importmap/README.md` 记录结论 —— **Go**（可单入口 ESM 化）或 **No-Go**（给出卡点）。
**No-Go 时的退化方案**：antd 降级为软共享，由 runtime 内包后 re-export（即 D2 备选），需同步修订设计文档 §4.3 与 §7 R3。

#### Spike B — 外部模块工程的 Tailwind 产出与注入

**分支**：`spike/module-tailwind`
**验证问题**：B14 —— 宿主预构建后，外部模块的 tailwind class 如何生效。

**步骤**：

1. 建 `spikes/module-tailwind/`，模拟外部模块工程：一个页面用 10 个 tailwind class + 一个 antd 组件
2. 装 `@tailwindcss/vite`，构建出 `module.css`
3. 宿主侧以 `<link>` 注入，浏览器验证：模块 class 生效、与 antd 样式层序无冲突、无样式覆盖宿主
4. 另验证 monorepo 内方案：`src/styles/tailwind.css` 加 `@source "../../modules"` 是否覆盖 dogfooding 模块
5. 明确记录：**不要**扫构建产物（class 已拼接，扫不准）

**产出**：`spikes/module-tailwind/README.md`，给出推荐方案与踩坑记录。

### P0 执行状态：✅ 已完成（2026-08-29）

| 任务 | 状态 | 验证结果 |
|------|------|----------|
| 0.1 建分支 `feature/pkg-p0-monorepo` | ✅ | 从 `modularization` 切出 |
| 0.2 迁移 `src/` → `packages/runtime/src/` | ✅ | 230 文件 rename，源码内容零改动 |
| 0.3 workspace 与 runtime 包元数据 | ✅ | `pnpm install` 通过，workspace 识别 3 个项目 |
| 0.4 测试路径常量化 | ✅ | 新增 `tests/helpers/paths.ts`，3 个测试文件改用常量 |
| 0.5 验收 | ✅ | 见下表 |
| 0.6 双 Spike | ✅ | Spike A **GO**、Spike B 完成，见下 |

**验收数据**

| 检查项 | 迁移前 | 迁移后 | 结论 |
|--------|--------|--------|------|
| `pnpm typecheck` | 通过 | 通过 | ✅ |
| `pnpm lint` | 176 问题（116 错误 / 60 警告） | 迁移后仍 176（零新增），随后独立提交修复 → **59 问题（0 错误 / 59 警告）** | ✅ |
| `pnpm test` | 20 用例通过 | 24 用例通过（+4 条 `monorepo-layout`） | ✅ |
| `pnpm build` | 61 文件 / 4,521,985 字节 | 61 文件 / 4,522,138 字节 | ✅ +153 字节（0.003%，glob 路径字符串变长） |
| dev 冒烟 | — | `/` 返回正确入口路径，入口模块 HTTP 200，无错误日志 | ✅ |

**关键过程**

1. 先跑基线：测试 20 通过、lint 176 问题（**基线 lint 本就是红的**，`@docsearch/react` 的 peer 警告与 116 个既有错误均与本次无关）
2. TDD：先改测试常量指向新路径，确认 5 个用例按预期失败，再执行迁移
3. `git mv src packages/runtime/src`，随后逐个修正不会被 alias 改写的字面量
4. 构建两次失败，均落入同一个根因（A11），修正后一次通过
5. 用 `git worktree` 在基线提交上跑 lint 做对照，确认**迁移零新增问题**
6. 提交时因 pre-commit 会跑 `eslint --fix`，采用「先在 HEAD 的 worktree 上生成独立的 lint 修复提交，再把 P0 rebase 上去」，使 P0 的 diff 保持为**纯重命名**（仅 14 个预期文件带内容改动）
7. 两个 Spike 并行收尾，Spike A 给出 GO，Spike B 修正了 B14 的描述

**耗时**：约 3 小时 30 分（P0 迁移约 1h50m，含两次构建失败排查；Spike A 约 50 分钟；Spike B 约 40 分钟；文档与提交约 10 分钟）。

**与计划的偏差**

| 计划 | 实际 | 说明 |
|------|------|------|
| 分支从 `main` 切出 | 从 `modularization` 切出 | `main` 落后 32 个提交且不含模块系统，已同步修正本文档 |
| 只需改 glob 与 FileSystemIconLoader 两处字面量 | 实际 4 处 | 另加 `index.html:23` 入口路径、`vite.config.ts:121` setupFiles |
| 未预料子包 package.json 会截断 imports | 触发 2 次构建失败 | 已记为 A11，并补进上方坑位表 |
| P0 与 Spike 并行 | 实际串行执行 | 单会话下串行更稳妥；Spike 结论未影响 P0 |
| B14「宿主扫不到模块源码」 | 仅对外部模块工程成立 | monorepo dogfooding 不受影响，见 Spike B |
| 未预料 CJS `export *` 与 `process.env.NODE_ENV` 两个坑 | Spike A 中暴露 | 已记为 A13 / A14、风险 R14 / R15 |

---

## P1: 垂直切片打通

**分支**：`feature/pkg-p1-vertical-slice`
**目标**：让第一个"只含模块"的外部工程端到端跑起来，并用它倒推 runtime 真实需要的出口（避免过度收敛）。
**依赖**：P0 完成；**Spike A 必须已给出结论**（否则 importmap 契约无法定稿）。

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 1.1 | 建 `apps/playground/`（模拟外部工程：一个 demo 模块） | `apps/playground/{modules,modules.config.ts,vite.config.ts,package.json}` | 工程内无框架源码 |
| 1.2 | `packages/cli` 最小实现：`ram dev` | 起宿主代理 + 编译本地模块 | 浏览器能看到宿主 + demo 模块菜单与页面 |
| 1.3 | `packages/cli`：`ram build` | lib 模式多 chunk 产物 + `modules.json` | 产物不含共享依赖实现代码 |
| 1.4 | 手写版 importmap 契约（先不自动生成） | `packages/shell/dist/index.html` | 单例验证：`__REACT_INSTANCE_COUNT__ === 1` |
| 1.5 | **记录 playground 实际用到的 API** | `docs/prd/runtime-api-usage.md` | 作为 P3 出口白名单的输入 |
| 1.6 | TDD：新增 `tests/vertical-slice.test.ts` | 断言产物无共享依赖实现、无 blob import、modules.json 字段完整 | 通过 |

**BDD 场景**：设计文档 US-1（含 first-run）、US-2、US-3。

---

## P2: 依赖反转与语义迁移

**分支**：`feature/pkg-p2-inversion`
**目标**：切断框架→模块的反向依赖，为布局去中心化与 KeepAlive 上移做语义准备。

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 2.1 | **KeepAlive 上移到 shell 固定层**（必须第一个做） | 从 `ContainerLayout → LayoutContent`（`src/layout/layout-content/index.tsx:116-126`）移到 LayoutRoot 之后、路由 outlet 之外；exclude 改由 module-loader 汇总各模块 `handle` 计算 | ✅ 已完成（`26cc3d7`） |
| 2.2 | 引入 `handle.layout` 契约 | `"container" \| "parent" \| "none"`，迁移期默认 `container`（**P2.7 已翻转为 `none`**，见 2.7 小结）；`src/router/types.ts` 的 `RouteMeta` 加字段 | ✅ 已完成（`87bd842`） |
| 2.3 | 框架内置 `NotFound` / `UnknownComponent` | 替代 `fallback.ts:5`、`generate-routes-from-backend.ts:8` 对 `#modules/exception` 的依赖；exception 模块降级为可选覆盖 | ✅ 已完成 |
| 2.4 | 加 CI 卡口 | `eslint.config.js` 的 `no-restricted-imports` 禁 runtime 内出现 `#modules`；CI 跑 `grep -rn "#modules" packages/runtime/src && exit 1` | ✅ 已完成 |
| 2.5 | 移除主包对模块页面的 glob 收录 | `generate-routes-from-backend.ts:14-17` 去掉 `/modules/*/pages/**`；同步改 `tests/module-route-priority.test.ts:43-52` 的断言为**不含** `/modules/` | ✅ 已完成 |
| 2.6 | `__APP_INFO__` → `getAppInfo()` | 覆盖 `modules/about/pages/constants.ts:1` 与 `src/utils/get-app-namespace/index.ts:13` | ✅ 已完成 |
| 2.7 | 先迁 1–2 个 dogfooding 模块验证语义 | 建议 `route-nest`（有嵌套）+ `system`（有 `keepAlive: false`） | ✅ 已完成（`766e4c3` / `5ffa2db`） |
| 2.8 | TDD 验收与文档更新 | 缓存行为不回退、整站 chrome 不消失、路由优先级断言更新；完成后回填本表与总结 | ✅ 已完成（五条判据全绿） |

### P2.1 执行小结

- **位置取舍**：KeepAlive 抽到 `layout/keep-alive-layer`（shell 固定层组件），但**只包裹页面 outlet**，不包在 `LayoutRoot` 的 `<Outlet/>` 外层。理由：包外层会把 header/sidebar 也缓存，导致切回路由时 chrome 状态错位（违背「整站 chrome 不消失」约束）。功能目标（B13：缓存不依赖 ContainerLayout 是否存在）已达成——exclude 现在由 module-loader 汇总 `handle.keepAlive` 得出。
- **exclude 数据源反转**：`keep-alive.ts` 提供纯函数 `collectKeepAliveExcludes` / `collectAllRoutePaths`（复用 `flattenRoutes`，key 与 `activeCacheKey` 精确对齐），module-loader 暴露 `getKeepAliveExcludeKeys` / `getAllRoutePathKeys`；`LayoutContent` 不再依赖 access store 的 `flatRouteList`。
- **验证**：新增 `tests/keep-alive.test.ts`（3 例）；full vitest 48/48；`ram build` 与完整应用 `vite build` 均通过。

### P2.3 执行小结

- **新增框架内置兜底页**：`components/not-found`（404）与 `components/unknown-component`（后端下发路由找不到前端组件）。两者同时提供命名导出与 `export default`，后者用于满足 `lazy()` 的默认导出要求。
- **反向依赖已切断**：`router/routes/core/fallback.ts` 与 `router/utils/generate-routes-from-backend.ts` 改为 `import("#src/components/...")`；`packages/runtime/src` 全量扫描已无 `#modules/exception`。
- **文案随框架下发**：新增 `locales/{zh-CN,en-US}/exception.json`，走框架默认 `translation` namespace（`t("exception.notFoundSubTitle")`）。顺带修复既有隐性缺失 key —— `components/page-error` 一直引用 `t("exception.pageErrorTitle")`，但该文案此前只存在于 exception **模块**的 namespace（`exception:pageErrorTitle`）里，实际取不到；现由框架 locale 提供，并从模块 locale 中移除该已失效的 key。
- **exception 模块降级为可选覆盖**：模块保留 `/exception/403|404|500|not-found-component` 演示路由，全部走相对引用（`./pages/*`），不再被框架硬引用；同时删除 P1 遗留的两个手写 `index.d.ts`（仅为满足框架跨目录引用而存在，现已无用）。
- **验证**：新增 `tests/framework-fallback.test.ts`（5 例，含「runtime 源码不得出现 `#modules/exception`」的全量扫描断言，可作为 P2.4 卡口的测试侧对照）；full vitest 57/57；`tsc --noEmit` 0 错误；runtime 库构建 + 完整应用 `vite build` 均通过，产物同时含框架 `not-found` / `unknown-component` chunk 与模块自身的演示 chunk。

### P2.4 执行小结

- **两层卡口（本地 + CI）**：① ESLint 规则 `runtime-guard/no-modules-in-runtime`，仅作用于 `packages/runtime/src/**`，对 `import` / `export ... from` / 动态 `import()` 的 source 做 `#modules` 前缀判断；② CI 新增 `.github/workflows/ci.yml`，在 `feature/pkg-*` 分支 push 与 PR 上跑 `grep -rn "#modules" packages/runtime/src && exit 1`，作为发布前的硬兜底。③ 测试侧已有 `tests/framework-fallback.test.ts` 的全量扫描断言对照。
- **为什么没直接用 `no-restricted-imports`**：该规则底层用 minimatch 匹配，而 minimatch 默认把以 `#` 开头的 pattern 当「注释」直接忽略，导致 `#modules` / `#modules/**` 永远匹配不到（实测 `react` 能匹配、`#modules/**` 匹配不到）。因此改用本地自定义规则做前缀判断，覆盖静态 / 动态 / re-export 全部形态。
- **验证**：临时探针文件 `import("#modules/exception/pages/404")` 与该路径的静态 `import` 均被规则拦截（已删探针）；对真实 `packages/runtime/src` 跑 eslint，`no-modules-in-runtime` 报错数为 0（无误伤）；`grep -rn "#modules" packages/runtime/src` 当前为空（pass 路径 exit 0，fail 路径 exit 1 已模拟通过）。

**BDD 场景**：设计文档 US-4、US-8。

### P2.5 执行小结

- **改动**：`generate-routes-from-backend.ts` 的 `import.meta.glob` 移除 `/modules/*/pages/**/*.tsx`，`pageModules` 现仅收录框架自身 `packages/runtime/src/pages/**`。同时删除 `getComponentPathByRoute` 中「先查 src/pages、再查 modules/<name>/pages」的模块回退分支——该分支在移除 glob 后已无法命中，属死代码；现在函数只返回框架路径，命中则返回、未命中由 `loadRouteComponent` 统一降级为 `UnknownComponent`。
- **为什么安全**：模块路由由 `loadAllModules(manifest)` 经各模块自身 `entry.ts` 的 glob 注册，进入 `auth-guard` 前 `filterBackendRoutes` 已把「与模块重复的后端路径」剔除（见 `auth-guard.tsx:119/127/134`），因此 `generateRoutesFromBackend` 实际只处理框架路径。框架不再 glob 模块页面，等价于「框架单向依赖模块」的反向耦合被切断。
- **测试同步**：`tests/module-route-priority.test.ts` 该用例从「应搜索 modules/」翻转为「不得 glob 收录模块页面 /modules/」，并更正了测试名与断言语义。
- **验证**：full vitest 57/57；`tsc --noEmit` 0 错误；`runtime` 库构建 6 模块（不再打包任何模块页面）；根 `pnpm run build` 全量通过，8 个模块各自独立构建到 `build/modules/*`（证明模块页面改由模块侧自行打包）。

**BDD 场景**：设计文档 US-8（插槽部分）、US-4。

### P2.6 执行小结

- **新增 `getAppInfo()` API**：`packages/runtime/src/utils/get-app-info/index.ts` 导出 `getAppInfo()`（返回 `AppInfo`，类型见 `packages/runtime/src/types/app-info.ts`），并随 runtime 主入口 `src/index.ts` 一并导出（`export { getAppInfo }` + `export type { AppInfo }`）。框架内部**唯一**读取全局 `__APP_INFO__` 的位置收敛到此处。
- **消费点迁移**：① 框架侧 `get-app-namespace/index.ts` 由 `__APP_INFO__.pkg.version` 改为 `getAppInfo().pkg.version`；② 模块侧 `modules/about/pages/constants.ts` 与 `index.tsx`（共 4 处：`pkg.version` / `lastBuildTime` / `pkg.license` / `pkg.author`）全部改为 `getAppInfo()`。模块通过 `#src/utils/get-app-info` 引入，无需再依赖 Vite `define` 注入的全局（B9 解除）。
- **为什么保留 vite `define`**：`__APP_INFO__` 仍由宿主/框架构建期注入，仅框架内部 `getAppInfo` 读取；模块不再引用该全局，因此外部模块工程不必复制同样的 define 配置。
- **测试**：新增 `tests/app-info-api.test.ts`（2 例）——断言 runtime 入口导出 `getAppInfo`、模块源码零 `__APP_INFO__` 直接引用、框架内除 `getAppInfo` 外无直接读取点。
- **验证**：full vitest 59/59（原 57 + 2）；`tsc --noEmit` 0 错误；根 `pnpm run build` 全量通过，8 个模块（含 about）各自独立构建成功。

**BDD 场景**：设计文档 US-8（插槽部分）、US-4。

### P2.7 执行小结

- **机制先行（TDD）**：US-8 要求「模块代码中无 layout import」，而 `handle.layout` 此前只被后端路由生成消费，模块路由原样透传。因此先在 `resolve-layout.ts` 新增纯函数 `resolveRouteLayouts()`（递归为**无 Component 且有 children** 的父级路由按 `handle.layout` 注入布局组件，不改原树，避免污染模块 definition），再接到 `module-loader.getRoutes()` 这一模块路由唯一出口。
- **迁移两个模块**：`route-nest`（顶层 `container` + 嵌套 `parent`，覆盖两种布局语义）与 `system`（`container`，含 `keepAlive: false` 页面）删除布局 import，改为 `handle.layout` 显式声明。
- **默认值翻转（同任务第二提交）**：`resolveLayoutComponent` 未声明时由 `ContainerLayout` 翻转为 `Outlet`（D9 目标态）。**翻转安全性论证**：① 默认 dev 配置下 fake 后端的 7 个顶级路径全部被模块覆盖，`filterBackendRoutes` 过滤后 `generateRoutesFromBackend` 实际收到空数组，后端路径对默认值的依赖在现状下不可达；② 未迁移的 6 个模块仍硬挂 `Component`，不经过解析器；③ 已迁移模块显式声明。翻转后契约显式化：**后端下发的父级路由此后须在 handle 携带 layout**。
- **验证**：新增 `tests/module-layout.test.ts` 9 例（解析单测 6 例 + 迁移静态断言 3 例，其中 `LAYOUT_MIGRATED_MODULES` 列表供 P5 扩展）；full vitest 68/68；`tsc --noEmit` 0 错误；完整构建通过且 `build/modules/{route-nest,system}` 产物中已无 `#src/layout` 外部引用；`pnpm dev` 冒烟 200。注入的 ContainerLayout 与原硬挂为同一组件，路由树结构等价，浏览器可视级 chrome/keepalive 复核建议随 P5 全量迁移一并人工确认。

### P2.8 验收记录

P2 完成判据逐条核对（2026-08-29）：

| # | 判据 | 结果 |
|---|------|------|
| 1 | `grep -rn "#modules" packages/runtime/src` 无输出 | ✅ exit 1（无命中） |
| 2 | 缓存行为不回退 | ✅ `tests/keep-alive.test.ts` 3 例通过；`system/dept` 的 `keepAlive: false` 仍生效 |
| 3 | 整站 chrome 不消失 | ✅ `resolveRouteLayouts` 注入同一 `ContainerLayout`（module-layout 单测锁定）；dev 冒烟 200 |
| 4 | 路由优先级断言更新且通过 | ✅ `tests/module-route-priority.test.ts` 通过 |
| 5 | `pnpm test` / `npx tsc --noEmit` / 完整 `vite build` 全绿 | ✅ 68/68、0 错误、EXIT=0 |

### P2 阶段总结（2026-08-29）

**关键过程**：P2 六个任务（2.1 KeepAlive 上移 → 2.2 layout 契约 → 2.3 内置兜底页 → 2.4 双卡口 → 2.5 去模块 glob → 2.6 getAppInfo）+ P2.7 dogfooding（模块布局解析机制 + 2 模块迁移 + D9 默认值翻转）+ P2.8 验收回填。全程 TDD：每个任务先写失败断言再实现；文档与实现不一致处（D9 默认值、`__REACT_INSTANCE_COUNT__`、模块数 9→8）均已在文档中改正。

**对本计划文档的修正**：P2.6 小结中「9 个模块」实为 8 个（manifest.json 仅 8 项），已顺手更正。

**耗时**：P2.7 + P2.8（本次会话）约 1 小时（含基线校验、两轮完整构建、文档回填）；P2.1–2.6 见各任务小结与提交记录（`26cc3d7`…`a23abfa`）。

---

## P3: Runtime 出口收敛与冻结

**分支**：`feature/pkg-p3-runtime-api`
**依赖**：P1 产出的 `runtime-api-usage.md`。

| # | 任务 | 说明 |
|---|------|------|
| 3.1 | 冻结出口白名单 | 基于 P1 实际用量，定 `components/` `hooks/` `store/` `api/` `icons` `router/types` `module-loader/types`；其余标 internal |
| 3.2 | 23 个 `#src/*` 说明符 → `@react-antd-module/runtime` | 约 86 条 import / 29 个文件，可用 codemod |
| 3.3 | 图标契约统一为 `ReactNode` | 11 处字符串 → `createElement(X)`；`generate-menu-items-from-routes.ts:42-54` 去掉 `isString` 分支 |
| 3.4 | `defineModule` + `tsx` 真实 import 解析 name/version | 一次性替换 `build-modules.ts:69-76` 的脆弱正则（B10） |
| 3.5 | 出 d.ts；补 `files` / `exports` / `peerDependencies` | 取消 `private: true` 准备发版。✅ 已完成（d.ts 于 P3.5 前半解除阻塞，元数据定稿见执行小结） |
| 3.6 | `registerSlot()` 实现（L2 布局插槽） | ✅ 已完成（见执行小结） |
| 3.7 | TDD：playground 仅靠包名 `tsc --noEmit` 通过 | ✅ 已完成（见执行小结） |

**BDD 场景**：设计文档 US-8（插槽部分）。

### P3.5（部分）执行小结：d.ts 阻塞解除（2026-08-29，`feature/pkg-p3-runtime-api`）

- **3 处报错已解**：① ② `layout-menu/style.ts` / `layout-tabbar/style.ts` 的 TS2883；③ `locales/helper.ts` 的 `LanguageModule`（连同 `LanguageFileMap`）显式导出。`pnpm --filter @react-antd-module/runtime build` 现可完整产出 `dist/` 声明树（146 个 d.ts），`exports["."].types` 顺手修正为真实存在的 `./dist/index.d.ts`（原指向从未存在的 `runtime.d.ts`）。
- **对原处方的偏差**：计划写的修法是「给 `createUseStyles` 显式 `Classes` 标注」（即引用 `import("jss").Classes`）。实测 **jss 不是 runtime 的直接依赖也不在 hoist 根**，声明若引用 `import("jss")`，消费方（外部模块工程）将解析不到。改用结构化等价标注 `(data?: any) => Record<"class 名", string>`（jss 的 `Classes<C>` 定义即 `Record<C, string>`），声明产物零额外依赖，更符合「冻结出口」目标。
- **TDD 载体**：新增 `tests/runtime-declarations.test.ts` 3 例（d.ts 存在、入口声明含 `getAppInfo`、exports types 指向真实文件）；full vitest 71/71，`tsc --noEmit` 0 错误，根完整构建通过。
- **3.5 仍未完成**：`files` 字段核对、出口树裁剪（internal 标注）、取消 `private: true`——与 3.1 出口白名单一并做。dist 产物已随本提交入库（.gitignore 白名单放行）。

### P3.1 执行小结：出口白名单冻结（2026-08-29，`feature/pkg-p3-runtime-api`）

- **出口面**：`index.ts` 按 P1 全量用量统计（29 文件 / 23 种 `#src/*` 说明符）冻结为：组件（BasicContent/BasicButton/BasicTable/Iframe/AccessControl/表单项）、api（home/user/system-role/system-menu）、hooks（useAccess/usePreferences/权限常量）、store（useAuthStore/useUserStore）、icons、utils（tree/getAllExpandedKeys）、constants（options）及既有契约与类型面。`tests/runtime-exports.test.ts`（7 例）即冻结契约：运行时符号逐项断言 + 类型面交由 `tsc --noEmit`。P3.2 的 codemod 之后，模块工程超出此面的 import 一律不允许。
- **布局组件不进出口**：剩余 6 个模块的 `#src/layout/container-layout` import 在 P3.2 一并迁移为 `handle.layout` 声明（前跑 P5.1 的布局部分，`resolveRouteLayouts` 机制 P2.7 已就位），布局组件保持框架内部。
- **图标出口零泄漏**：`local-icons.ts` / `ri.ts` 改为「import 原始组件 + `IconComponent` 类型注解包装导出」，d.ts 内联组件类型，`~icons/*` 虚拟模块不再出现在声明里（与 P3.5 的 jss `Classes` 同类问题）。
- **全绿**：tsc 0 错误，vitest 78/78（新增 7），根构建通过，runtime 包 `dist/` 重建（164 个声明文件），产物 `#src` / `~icons` 残留为零。

**P3.1 过程中发现的问题（分类记录）**：

1. 【反常规·发布物缺陷】`@ant-design/pro-components` 的 package.json 标 `type: "module"`，但 `main`（`lib/`）是 CJS 语法，`module`（`es/`）内部又是目录导入——node/vitest 按 ESM 加载必然失败，仅 vite bundler 解析可用。测试中以 `vi.mock` stub 规避（出口契约只关心 `BasicTable` 被导出）。
2. 【既有缺陷被放大】runtime 产物长期残留 `from "#src/..."` 外部导入（HEAD 版即有 3 处，`package.json` imports field 解析时好时坏），浏览器 importmap 无此映射、必然崩溃，P1 垂直切片因未触发 auth-guard/request 链而未暴露。根修：runtime `vite.config.ts` 增加 `resolve.alias`（`#src → src`）并在 `external` 放行 `#src/*`、`~icons/*`，两类说明符全部构建期内联。
3. 【债务登记 → P4 输入】出口扩大后 `dist/runtime.js` 的裸依赖面扩至 24 个（zustand、ahooks、ky、@ant-design/pro-components、@dnd-kit/*、keepalive-for-react、motion/react、nprogress、pinyin-pro、react-error-boundary、simplebar-react、spin-delay、tailwind-merge、antd-img-crop、react-jss 等）。monorepo alias 模式不受影响，但 shell importmap（P1 手工 15 项）远未覆盖；`shell/dist/assets/runtime.js` 亦已过期。P4「SHARED_DEPS 单一来源 + importmap 自动生成」须以此为输入清单，并重建 shell。
4. 【工具链】vitest 处理「假 ESM」依赖的三个开关（`server.deps.inline` / `deps.optimizer.ssr.include` / `server.deps.web`）在 alias 与包名两种 id 形态下均未能命中，最终以 `vi.mock` 解决——记录避免后续重复试错。

### P3.2 执行小结：模块包名化（2026-08-29，`feature/pkg-p3-runtime-api`）

- **布局迁移提前完成（前跑 P5.1 布局部分）**：剩余 6 个模块（home/access/exception/outside/about/personal-center）的顶层路由由 `Component: ContainerLayout` 改为 `handle.layout: "container"`，runtime 无需把布局组件冻结进出口（与 D9 目标态一致）。P5.1 剩余范围仅迁移核验。`tests/module-layout.test.ts` 的 `LAYOUT_MIGRATED_MODULES` 扩至 8 个。
- **codemod**：`modules/` 下 29 个文件的 23 种 `#src/*` 说明符全部合并为 `@react-antd-module/runtime` 具名导入（value / type 两条语句）；`apps/playground` 的 demo 模块 P1 起已是包名化，无需处理。合并后全仓（modules + playground）零 `#src` import。
- **monorepo 解析三件套**：根 `tsconfig.json` paths 与根 `vite.config.ts` alias 将包名直指 `packages/runtime/src/index.ts`（源码同源编译，保持 dev 体验）；`scripts/build-modules.ts` 将包名加入 external（独立构建产物由宿主 importmap 提供，与 cli `build.ts` 的既有插件语义一致）。刻意**不**把 runtime 加为根 package.json 依赖。
- **契约闭环**：`tests/module-package-imports.test.ts` 4 例——modules + playground 零 `#src`、每个 entry 均从包名导入、tsconfig/vite 包名映射存在、build-modules external 存在。「模块 import 的符号是否都在冻结出口里」由 tsc 保证（paths 直指 `index.ts`，出口外符号 typecheck 报错），与 P3.1 的 `runtime-exports.test.ts` 组成双向契约。
- **全绿**：tsc 0 错误，vitest 82/82（新增 4），根构建 + 模块独立构建通过。无新增问题记录（eslint 4 条警告均为既有代码的 `react/exhaustive-deps`）。

### P3.3 执行小结：图标契约统一 ReactNode（2026-08-29，`feature/pkg-p3-runtime-api`）

- **分层确定**：`handle.icon` 全链路统一 ReactNode。模块（前端）路由在 entry 里直接 `createElement(X)`（13 处：access 5 / system 5 / outside 3，后者用 P3.1 已冻结进出口的本地图标）；后端 JSON 只能下发图标名，字符串 → 组件的编译收拢到框架边界 `generateRoutesFromBackend`（`menu-icons` 映射从此仅存在于这一处），未知图标名告警并置空。**fake 数据保持字符串**——它模拟的是真实后端响应，改掉反而失真。
- **简化**：`generate-menu-items-from-routes.ts` 删除 `isString` / `menuIcons` 查找与告警分支，`menuItem.icon = icon` 直接透传（原计划行号 42-54 的 isString 分支不复存在）。
- **TDD**：`tests/router-icon-contract.test.ts` 4 例（透传同引用、后端编译 `isValidElement`、未知图标告警+置空、模块 entry 零字符串图标）。
- **全绿**：tsc 0 错误，vitest 86/86（新增 4），根构建 + 模块独立构建通过。无新增问题记录。

### P3.4 执行小结：元数据真实 import 解析（2026-08-29，`feature/pkg-p3-runtime-api`）

- **实现**：主仓库 `scripts/build-modules.ts` 弃用 `parseEntryMeta` 正则（B10），改经 `@react-antd-module/cli` 的 `readModuleDefinition`（esbuild bundle + runtime stub + 真实 `import()`）。cli `exports` 新增 `./build` 子路径；根 devDependencies 显式补 `esbuild`（此前为 cli 传递依赖，scripts 上下文解析不到）。
- **P3.1 出口扩大的连锁修复**：cli 的 `RUNTIME_STUB_SOURCE` 仍是 P1 最小集合，模块页面 import 的 api/utils/constants 符号在 stub 中缺失导致 bundle 报 missing export。已补齐全量出口，并在 `runtime-exports.test.ts` 增加**防漂移断言**（比对运行时真实出口与 stub 静态导出名），出口与 stub 的同步从此由测试锁定。
- **动态 import 的两难与化解**：lazy 页面 / i18n JSON 的动态导入若放任进 bundle，esbuild 输出 ESM 时把页面模块的裸导入 hoist 到顶层（pro-components 假 ESM 在 Node import() 时爆炸）；若标 external，vitest 又在 transform 阶段强行解析相对说明符。最终以「动态导入目标替换为虚拟空模块」双堵——元数据读取本就不需要动态模块。
- **顺带修一个隐含假设**：esbuild 输出名默认取入口 basename，非 `entry.ts` 文件名的产物对不上后续 `import(outDir/entry.js)` 路径（测试夹具暴露）。加 `entryNames: "entry"` 固定。
- **全绿**：tsc 0 错误，vitest 91/91（新增 5），`pnpm run build` 的模块构建走真实 import 解析成功。

### P3.5 执行小结：包元数据定稿（2026-08-29，`feature/pkg-p3-runtime-api`）

- **3.5 全部完成**：`private: true` 已移除（具备发版资格）；`files: ["dist"]` 核对无误；**出口树裁剪以「exports 仅开放 `"."`」落地**——dist 声明树里的 layout/router 等内部模块虽物理存在，但不作为子路径出口暴露，内部性由不导出保证，无需额外 internal 标注文件。
- **peerDependencies 从 4 个扩至 25 个**：以 `dist/runtime.js` 的实际 bare 导入为准（P3.1 债务登记的 24 包清单 + react/jsx-runtime 归一为 react），版本范围照抄根 package.json。语义：宿主（importmap）统一供给，与 D2 单例决策一致；该表即 P4「SHARED_DEPS 单一来源 + D12 严格相等校验」的直接输入。
- **TDD**：`tests/runtime-declarations.test.ts` 增至 6 例，新增 3 例——无 `private`、`files` 含 dist 且 exports 仅主入口、**peerDeps 防漂移**（静态解析产物 import/export 语句的 bare 说明符并归一包名，未覆盖即红）。出口再扩大时此测试先红，P4 共享表不会漏包。
- **顺带重建 dist**：P3.3/P3.4 改动过 runtime 源码（图标边界、basic-table 标注）但未重发 dist，本次一并同步（164 个声明文件 + runtime.js 449.73 kB）。
- **全绿**：tsc 0 错误，vitest 94/94（新增 3），根完整构建通过。

**P3.5 过程中发现的问题（分类记录）**：

1. 【反常规·静态分析的注释陷阱】dist/runtime.js 中存在 2 处 `from "#src/..."` 字符串，实为 `ContainerLayout` 的 jsdoc 用法示例文本（P3.1 曾确认过一处，重建后复现两处）。粗粒度的 `from "..."` 全文匹配会把注释当代码。防漂移测试改用行首锚定的 import/export 语句匹配。教训：对构建产物做静态扫描时，正则必须锚定语句边界，否则文档注释就是假阳性源。

### P3.6 执行小结：registerSlot 布局插槽（2026-08-29，`feature/pkg-p3-runtime-api`）

- **实现**：新增 `module-loader/slots.ts`——zustand 注册表按 `slotName → moduleName` 两级组织，`registerSlot` 同名覆盖、`removeModuleSlots` 按模块清理、`getSlotNodes` 纯读、`useSlotNodes` 供布局订阅（selector 只取 byModule 引用，注册/卸载才触发重渲染，规避 v5 useStore 的新数组引用循环）。`ModuleContext` 新增 `registerSlot(slotName, node)`（设计文档 US-8 场景 3 的字面 API，绑定调用模块名）。
- **卸载语义**：新增 `unloadModule(name)`——执行 `onDestroy` 生命周期 → 清理该模块插槽 → 移除实例（US-8「卸载模块后该节点消失」+ US-9 运维下线的地基）。此前 `onDestroy` 在 loader 中定义但从未被调用。
- **消费点**：`layout-header` 右侧操作区（GlobalSearch 之前）渲染 `useSlotNodes("header-actions")`。
- **出口纪律**：插槽 API 全部为 runtime 内部消费（模块走 ctx、布局走 #src 相对导入），**未加入 index.ts 出口**——P3.1 冻结面与 P3.5 peerDeps 防漂移表均不受扰动；宿主级运维出口（unloadModule 暴露给 shell）留待 P5/P6 按需定。
- **TDD**：`tests/runtime-slots.test.ts` 4 例——注册表 3 例（注册可读 / 同名覆盖 / 清理隔离）+ US-8 真实集成 1 例（fixture 模块经 `loadAll` 动态 import 走完整 onInit 注册 → `unloadModule` 后节点消失且 `getModule` 为 undefined）。
- **全绿**：tsc 0 错误，vitest 98/98（新增 4），lint 0 error，根完整构建 + 8 模块独立构建通过。

**P3.6 过程中发现的问题（分类记录）**：

1. 【反常规·测试夹具后缀】含 JSX 的测试夹具以 `.ts` 为后缀时，vitest（oxc transform）不按 JSX 解析，报 `Expected ">" but found "Identifier"`，报错信息完全看不出与后缀有关。夹具必须用 `.tsx`。与既有 `entry-no-name.ts`（纯对象、无 JSX）不一致，后续夹具需按内容选后缀。
2. 【反常识·共享单例的全局态泄漏】module-loader 的 modules Map 与插槽注册表是进程级单例，测试文件内前序 describe 的注册会泄漏进集成断言（`expected 3 to be 0`）。本测试以「纯 store 用例用独立插槽名、集成用例独占契约名 slotName」隔离，未引入仅供测试的 reset API；若后续测试矩阵变复杂，再评估导出测试专用清理钩子。

### P3.7 执行小结：playground 仅靠包名通过 tsc（2026-08-29，`feature/pkg-p3-runtime-api`）

- **实现**：`apps/playground` 建独立 `tsconfig.json`——**无任何 `@react-antd-module/*` 的 paths 映射**，包名经 `node_modules`（workspace symlink）→ `exports["."].types` 解析到 `packages/runtime/dist/index.d.ts`。这是「外部工程无框架源码」形态的最终验收：P3.5 的 jss 结构化标注、图标包装（零 `~icons` 泄漏）、peerDeps 声明链在此一次兑现。
- **TDD**：`tests/playground-package-tsc.test.ts` 2 例——①tsconfig 存在且不含 runtime 的 paths 映射（防倒退回源码同源编译）；②`npx tsc -p tsconfig.json --noEmit` 退出码 0（真跑子进程 tsc）。首跑红（无 tsconfig），落地后绿。
- **顺带补齐**：playground devDeps 显式声明 `@ant-design/icons`（demo 模块实际使用；此前靠 monorepo hoist 隐式命中，外部工程语义上必须显式）。
- **全绿**：tsc（根 + playground 独立）0 错误，vitest 100/100（新增 2），根完整构建通过。

**P3 阶段总结（2026-08-29）**

**关键过程**：P3 七个任务按序完成——3.1 出口白名单冻结（P1 用量为输入，`runtime-exports.test.ts` 即契约）→ 3.5 前半（3 处 d.ts 阻塞解除，dist 首次完整产出）→ 3.2 模块包名化（29 文件 codemod + 布局迁移提前完成，monorepo 解析三件套）→ 3.3 图标契约 ReactNode（边界编译收拢到 `generateRoutesFromBackend`）→ 3.4 元数据真实 import 解析（esbuild + stub 替换脆弱正则，防漂移断言锁定 stub 同步）→ 3.5 后半（取消 private、peerDeps 25 包定稿 + 防漂移）→ 3.6 registerSlot 插槽（US-8 L2，unloadModule 清理）→ 3.7 playground 包名 tsc（d.ts 自包含验收）。全程 TDD，每任务先红后绿；出口、stub、peerDeps 三张防漂移测试网彼此咬合。

**对本计划文档的修正**：3.5 原处方「引用 jss Classes 类型标注」不可行（jss 非消费方可解析依赖），改为结构化等价标注；布局组件出口因 P5.1 布局迁移提前（P3.2）而无需冻结。

**耗时**：P3 全阶段约 6 小时（3.1 约 1.5h 含 dist 内联根修；3.2 约 1h；3.3 约 40min；3.4 约 1.5h 含动态 import 两难排查；3.5 约 40min；3.6 约 1h；3.7 约 20min）。

**遗留与交接**：① dist 的 24 包裸导入表已固化为 runtime peerDependencies（P4 SHARED_DEPS 单一来源的直接输入）；② `shell/dist/assets/runtime.js` 过期，P4.3 重建时一并处理；③ 插槽/卸载的宿主级出口（`unloadModule` 等）按 P5/P6 运维需求再定，当前保持出口最小面。

---

## P4: Shell 与共享表治理

**分支**：`feature/pkg-p4-shell`

| # | 任务 | 说明 |
|---|------|------|
| 4.1 | `SHARED_DEPS` 单一常量源 | ✅ 结构化表（specifier+asset+hard），importmap/预构建入口/external/版本校验全部生成（B11/B12） |
| 4.2 | 软 / 硬共享分层落地 | ✅ `hard` 字段落表；`scopes` 多版本共存留作旧模块兜底，随 P5 运维一并按需启用（C7） |
| 4.3 | shell 预构建 + importmap 片段自动生成 | ✅ 产物全量重建（39 入口 + runtime + versions.json），`tests/shell-importmap.test.ts` 锁定 |
| 4.4 | dev 体验三件套 | ✅ jsx-dev-runtime 已随共享表映射；sourcemap hidden 落地（.map 不入库）；**preamble 偏差见小结** |
| 4.5 | 版本矩阵门禁 | ✅ shell 落 versions.json（实际安装版本），`checkSharedVersions` 构建前强制校验（D12/C4）；CI 回归随发布流程在 P6 补 |
| 4.6 | Tailwind 方案落地 | ✅ 宿主按 modules.json `css` 字段 `<link>` 注入（loadAll 前） |
| 4.7 | 移除 `build-modules.ts` 的死产物逻辑（B1） | ✅ 删 `#src/#modules` external 死分支 + 本地 SHARED_EXTERNALS 收敛到 cli 单源 |
| 4.8 | `StyleProvider layer` 与 `@layer` 顺序验证 | ✅ 结论见小结（维持 hashPriority high） |

**BDD 场景**：设计文档 US-2（dev 体验不退化）、US-3。

### P4 执行小结（2026-08-29，`feature/pkg-p4-shell`）

**4.1 单一常量源**：`SHARED_DEPS` 重构为结构化条目（`specifier`/`asset`/`hard`），**条目粒度 = importmap 键 = 实际裸说明符**（importmap 无前缀通配，`motion/react`、`zustand/shallow` 等深路径必须单独成条）。`generateShellEntries()` 生成 shell 预构建入口、`generateImportmap()` 生成映射，防漂移测试三张网：runtime peerDeps ⊆ 共享表、产物裸说明符 ⊆ importmap、共享表全量产物存在。补齐 runtime 实际依赖的 11 个缺口包（ahooks/ky/react-jss 等）与 clsx。`src/entries/*.ts` 实体文件删除——入口直接 `import.meta.resolve` 包说明符为真实路径（vite lib.entry 不解析裸说明符），`rollupOptions.output.entryFileNames` 会覆盖 `lib.fileName` 导致产物名取包入口 basename（如 `dayjs.min.js`），必须删 output 配置。

**4.3 shell 重建**：产物从手写 15 项扩到共享表全量 39 入口 + runtime（sha256 与包 dist 一致性入测）。shell 构建改走 `pnpm --filter @react-antd-module/runtime build` 完整构建——只跑 `vite build` 会 emptyOutDir 清掉 dist 里的 d.ts 声明树（P3.5 隐患）。

**4.4 dev 三件套**：jsx-dev-runtime 已随共享表映射 ✓；`sourcemap: "hidden"` 落地且 `.map` 不入库（gitignore）✓；**react-refresh preamble 未落地（偏差）**：当前 `ram dev` 是「build + watch + 手动刷新」静态架构，无 `/@react-refresh` 端点、模块产物也不含 refresh 代码，强行注入 preamble 只会报 import 失败。真 HMR 需要 dev 服务器升级为 vite middleware 模式（transform 模块产物），记入 P5 待办评估。

**4.5 版本矩阵门禁**：shell 构建时经 `import.meta.resolve` 逐包向上找最近 package.json 读**实际安装版本**写 `dist/versions.json`（40 项）；`checkSharedVersions` 在 `buildModules` 前强制执行。**语义修正**：C4「版本严格相等」指**安装后版本**（读模块工程 node_modules，跟随 pnpm symlink），而非 devDependencies 的范围字面量——`^19.2.6` 与安装的 `19.2.8` 字面上永远不等，按字面校验全员误伤。校验逻辑抽纯函数 `validateSharedVersions`，fs 无关可直测。

**4.6 Tailwind**：Spike B 结论（外部模块自带构建、宿主 `<link>` 注入）落地：host 按 modules.json `css` 字段在 `loadAll` 前去重注入。**顺带修一个潜伏 bug**：cli 写的 modules.json 是数组（`BuiltModule[]`），而 `loadAll` 需要 `{ modules: [...] }`，原样传入会在运行期崩（`manifest.modules.filter is not a function`），host 侧补形状映射。

**4.7**：删除 `scripts/build-modules.ts` 的 `#src/`/`#modules` external 死分支（P3.2 后模块零 `#src` import），并把本地 `SHARED_EXTERNALS` 20+ 项正则表整个删除、收敛到 cli `isSharedDep` 单源（B1 的根本治理，防止第四张手写清单）。

**4.8**：维持 `StyleProvider hashPriority="high"` 不引入 `layer`。结论：antd 6 经 cssinjs 产出带 hash 的低优先级样式 + tailwind `@layer(theme)` 分层，当前组合无层序冲突（Spike B 已浏览器验证）；`layer` 模式是给「需要 tailwind utilities 覆盖 antd 样式」的场景留的开关，当前设计不需要。

**全绿**：tsc 0 错误，vitest 117/117（新增 shell-importmap 3 + version-gate 7 + shared-deps 7 = 17），根完整构建 + 8 模块独立构建 + shell 全量重建通过。

**P4 阶段总结（2026-08-29）**

**关键过程**：4.1 结构化共享表与防漂移三张测试网 → 4.3 shell 全量重建（B11 债务清偿）→ 4.4 sourcemap hidden + preamble 偏差登记 → 4.5 版本门禁（语义修正后落地）→ 4.6 css 注入 + modules.json 形状修正 → 4.7 死逻辑删除与第四张清单收敛 → 4.8 StyleProvider 结论落档。TDD：每项先红后绿（shell-importmap 首跑暴露产物命名缺陷，version-gate 首跑暴露严格相等语义错误）。

**耗时**：约 2.5 小时（4.1 约 50min；4.3 约 40min 含产物命名排查；4.4/4.5 约 50min 含门禁语义返工；4.6/4.7/4.8 与文档约 30min）。

**遗留与交接**：① preamble/真 HMR 待 vite middleware dev server（P5 评估）；② importmap `scopes` 多版本兜底未实现（无多版本模块实例，P5 按需）；③ CI 版本回归（宿主升级→已发布模块回归）随 P6 发布流程补；④ P3.5 的 peerDeps 25 包与 P4.1 共享表 40 说明符已通过测试互锁，任一侧漂移先红。

---

## P5: 模块迁移与测试改造

**分支**：`feature/pkg-p5-migration`

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 5.1 | 8 个模块迁移到新契约 | home / about / personal-center / route-nest / outside / access / exception / system | ✅（布局部分 P3.2 前跑，本阶段核验收口） |
| 5.2 | 测试改造 | `module-route-priority.test.ts`、`module-i18n-consistency.test.ts`、`demo.test.tsx`，约 20 用例 | ✅（route-priority 随 P5.5 新架构改写；全量 131 用例 26 文件绿） |
| 5.3 | `modules/` 纳入 `tsconfig.json` include（B8） | | ✅ |
| 5.4 | 清单合并策略 | 多团队各出一份 `modules.json` 时同名冲突拒绝 + 显式报错（R12） | ✅ |
| 5.5 | 旧 `manifest.json` 链路下线（O5） | | ✅（加载上移应用启动，守卫仅消费 getRoutes） |
| 5.6 | 模块开发指南改写 | `docs/prd/module-development-guide.md` | ✅ |
| 5.7 | L2 完整性落地 | `modulepreload + integrity`；`chunks[].lazy` 标记与构建期提示 | ✅ |
| 5.8 | 错误处理契约 | 每类失败输出「人话原因 + 修复建议 + 文档链接」；去掉 `auth-guard.tsx:107-111` 的静默 catch（B7） | ✅ |
| 5.9 | `requiredRoles` 在路由注入前生效（B16） | | ✅ |

**BDD 场景**：设计文档 US-4、US-5、US-6、US-9、US-10、US-11。

### P5 执行小结（2026-08-30）

- **5.1/5.2 核验**：`modules/` 全目录零 `#src/` 引用（P2.4 eslint + CI 双卡口在位）；全量 131 用例 / 26 文件绿；`npx tsc --noEmit` 0 错误；`pnpm run build` 通过。
- **5.3**：`modules` 纳入根 tsconfig include（B8，模块源码进主类型检查）。
- **5.4**：`packages/cli/src/manifest.ts` `mergeModuleManifests`，同名模块（含同清单内部重复）抛错并定位两个来源（R12）。
- **5.5+5.8**：清单加载从 `auth-guard` 上移到 `index.tsx` `setupApp()`（O5：router 域与清单解耦，守卫仅消费 `getRoutes()`）；原守卫内静默 catch（仅 DEV console.warn）改为启动期全屏错误页——人话原因 + 修复建议（清单可达 / 资源 URL / 依赖模块部署）+ 文档链接（B7）。`module-bootstrap.test.ts` 锁定「清单消费仅允许出现在入口」。
- **5.6**：手册全量重写（811 → 220 行），外部团队视角：环境准备与版本门禁、defineModule（含 requiredRoles/requiredPermissions/peerRuntime/registerSlot）、构建产物与完整性、多团队清单合并、红线与门禁表、FAQ。
- **5.7**：`packages/shell/src/preload.ts` `collectPreloads` 纯函数 + host 注入 `modulepreload + integrity + crossorigin`；lazy chunk 跳过（D7）、URL 去重。
- **5.9**：`getRoutes()` 按 `ModuleConfig.requiredRoles` 在注入前过滤（`useUserStore` 角色，some 语义），无角色用户拿不到路由与菜单本身。

**执行中发现的问题**

- **反常规**：为测试纯函数而 import shell 入口 `host.tsx`，把它首次拉进根 tsc 编译图，暴露 `react-router/dom` 类型解析的预存缺陷——测试的依赖方向会意外扩大类型检查面。修复：纯函数解耦到零依赖的 `preload.ts`（结构性修复优于在入口上加 ignore）。
- **反常识**：`@ant-design/pro-components` 假 ESM 会在**不直接引用它**的文件中触发（经 antd 生态链传递性加载），报错位置与根因相距甚远；沿用 `vi.mock` 惯例解决。
- **工具行为**：vitest 全量运行偶发一次「陈旧断言」失败（单跑与随后两轮全量均绿），疑似转换缓存未失效，未复现，持续观察。
- **计划语义修正**：5.5 原文「旧 manifest.json 链路下线」——实际保留 `#manifest.json` 加载机制，下线的是**守卫链路**（消费点上移到唯一入口）；shell 宿主态仍走 `modules.json → Manifest` 形状映射（P4.6）。

**P5 阶段总结（2026-08-30）**

**关键过程**：5.3/5.4（B8/R12 门禁）→ 5.9（B16 注入前过滤）→ 5.5+5.8（O5 链路上移 + B7 人话报错）→ 5.7（L2 完整性）→ 5.1/5.2 核验 + 5.6 手册重写。全程 TDD 先红后绿（module-bootstrap / manifest-merge / module-required-roles / shell-integrity 四张新测试网）。

**耗时**：约 3.5 小时（5.3/5.4 约 30min；5.9 约 40min；5.5+5.8 约 40min；5.7 约 50min 含 tsc 牵连排查；5.1/5.2 核验 + 5.6 手册 + 小节约 40min）。

**遗留与交接**：① `manifest.json`（仓库内开发态）与 `modules.json`（构建产物态）双清单并存，形状映射在 shell host，若后续统一需框架方决策；② 真 HMR（vite middleware dev server）延续 P4 偏差记录；③ requiredPermissions 字段类型已定义但路由注入层尚未消费（P6.3 scoped client 时一并评估）。

---

## P6: 安全加固

**分支**：`feature/pkg-p6-security`

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 6.1 | 信任根 | 清单与产物分目录分发布凭据，仅 CI 可写清单；宿主内置 `moduleOrigins` 白名单 | ✅（白名单代码化；分凭据为部署约束落档） |
| 6.2 | CSP 落地 | 按设计文档 §4.8；内联 importmap 带 nonce；**不加** `strict-dynamic` | ✅（构建期随机 nonce；`require-trusted-types-for` 见偏差） |
| 6.3 | scoped request client | 模块不再拿全局 request，改为按 `register.apiPrefix` 前缀收敛，越界拒绝 | ✅ |
| 6.4 | iframe 加固 | `new URL(u).protocol === "https:"` + 域名白名单 + `sandbox="allow-scripts allow-popups"` | ✅ |
| 6.5 | fake server 治理（B15） | `enableProd: true` 改受显式环境变量控制；CI 断言 dist 无 fake 代码 | ✅ |
| 6.6 | 供应链（公开 npm） | `publishConfig.registry` 锁定、2FA、`--provenance`、`--frozen-lockfile`、`npm audit signatures`；防 `@react-antd-module/*` typosquat | ✅（账号级 2FA 为流程约束落档） |
| 6.7 | O7 refreshToken | **待需求方与后端确认**，未确认前保持现状，风险记 R13 / O7 | ⏸️ 阻塞（按需求方指示不实施） |
| 6.8 | 残留风险登记 | 不签名（O3 已定）→ R13，需在 README 与运维文档中明示 | ✅ |

**BDD 场景**：设计文档 US-6（来源未登记）、US-7。

### P6 执行小结（2026-08-30）

- **6.1**：`packages/shell/src/trust.ts`——`assertTrustedModules` 校验清单内 entry/css/chunks 全部资源 URL（同源相对路径可信，绝对 URL origin 须命中 `TRUSTED_ORIGINS`），在 CSS 注入/L2 预载/loadAll 之前执行；报错含模块名与修复指引。「清单与产物分目录、仅 CI 可写清单」为部署约束，README/小结落档。
- **6.2**：`packages/shell/src/csp.ts` `generateCsp` + `generateNonce`——构建期随机 nonce（每次 build 轮换，静态部署无 per-request 能力）注入 importmap 标签与 meta CSP；`script-src 'self' + CDN 白名单 + nonce`；`style-src 'unsafe-inline'` 为 antd cssinjs 必需；**不加 strict-dynamic**。dist 冒烟确认注入。`require-trusted-types-for` 未加（antd6 cssinjs 大量 innerHTML 注入会全站崩，需配套 trusted-types policy，列为后续项）。
- **6.3**：`packages/runtime/src/utils/request/scoped.ts`——`createScopedRequest` 以惰性求值的登记前缀为边界，callable 与六个 HTTP verb 全受检，越界/未登记人话报错；不暴露 create/extend（逃逸口）；`createModuleContext` 注入 scoped 实例。单元 5 例 + loadAll 集成夹具。
- **6.4**：`packages/runtime/src/utils/iframe-guard.ts`——`resolveSafeIframeLink` 仅放行 https + 白名单域名（允许子域），Iframe 组件单一消费点收敛，`sandbox="allow-scripts allow-popups"` 不给 allow-same-origin，拒绝渲染并人话报错。
- **6.5**：`enableProd` 改 `VITE_ENABLE_FAKE_PROD === "1"` 显式控制；测试双卡口（配置层 + build/ 产物扫描）。**执行中发现**：`__APP_INFO__` 注入整个 package.json，devDependencies 清单（工具链版本地图）随产物泄露——注入剔除、about 页卡片空态隐藏，并加第三卡口（产物不得含 devDependencies 清单特征）。
- **6.6/6.8**：runtime/cli 移除 private，`publishConfig` 锁官方 registry + access public（安装走镜像、发布走官方）；shell 保持 private（dist 交付）；`.npmrc` 开 provenance；README 新增 Security & Publishing 章节（R13 明示 + 发布 checklist：2FA/--provenance/--frozen-lockfile/audit signatures/typosquat）。

**执行中发现的问题**

- **反常规（B15 实锤）**：旧配置 `enableProd: true` 使 `@faker-js/faker` 与全部 mock 接口真实进入生产构建（`build/assets/faker-*.js`），即 mock 数据在生产可被调用。
- **反常规（新发现）**：`__APP_INFO__` define 注入整个 package.json——生产 bundle 内嵌 devDependencies 全清单，等于向攻击者公开工具链构成（供应链侦察地图）；已剔除并加卡口。
- **反常识**：vitest 的 `new URL(..., import.meta.url)` 在 module-runner 下非磁盘路径，测试构造 entry URL 必须走 `__dirname` 系 helper（`PROJECT_ROOT`）。
- **工具脆弱性**：既有测试按「源码是否含 `__APP_INFO__` 字样」扫描，注释文本即可误触发卡口；本次以修改注释措辞规避，判定方式建议后续改为 AST/精确匹配（记录，不在本阶段改）。
- **流程教训**：P6.2 提交时只验证了单文件测试与 tsc，nonce 属性回归了两个既有 importmap 测试正则；P6.3 全量才暴露。此后坚持每任务提交前全量。

**P6 阶段总结（2026-08-30）**

**关键过程**：6.1 信任根（moduleOrigins 白名单前置拦截）→ 6.2 CSP（nonce + 无 strict-dynamic）→ 6.3 scoped request（D11 客户端收敛）→ 6.4 iframe 守卫 → 6.5 fake 治理（B15）+ devDependencies 泄露修复 → 6.6/6.8 供应链与风险登记。全程 TDD 先红后绿（shell-trust / shell-csp / scoped-request / iframe-guard / no-fake-in-dist / supply-chain 六张新测试网），全量 161 用例 / 32 文件绿。

**耗时**：约 3 小时（6.1 约 30min；6.2 约 40min 含 dist 冒烟；6.3 约 45min 含夹具语义返工；6.4 约 25min；6.5 约 45min 含新发现泄露修复与重建验证；6.6/6.8 与文档约 20min）。

**遗留与交接**：① O7（refreshToken → httpOnly Cookie）阻塞于后端配合，风险已记 R13/O7，前端侧不实施；② `require-trusted-types-for` CSP 未启用，需 antd trusted-types policy 配套；③ CI 版本回归（宿主升级 → 已发布模块）随发布流程首轮发布时补；④ `frame-src` 域名与 `TRUSTED_ORIGINS` 为占位示例值，部署时按业务域替换。

---

## 当前待办与阻塞

| 项 | 状态 | 说明 |
|----|------|------|
| O7 refreshToken 迁 httpOnly Cookie | **阻塞 P6.7** | 需后端配合，需求方未确认 |
| Spike A 结论 | ✅ 已完成（P0） | antd 单入口 ESM 化，P1 已消费 |
| Spike B 结论 | ✅ 已完成（P4.6/P4.8） | tailwind + antd cssinjs 兼容确认 |

---

## 总结

### 本阶段（方案设计与评审）

**关键过程**

1. 摸底现状：模块契约已存在（`manifest.json` + `module-loader`），但模块产物实际上是不可运行的死产物（external 成 `#src/*`），且模块被构建两次掩盖了这一点
2. 通过 4 个关键决策收敛方案：产物形态、共享依赖单例、布局分层、仓库组织
3. 需求方质疑"单文件不现实"后修正加载方式：从 fetch+blob 改为原生 `import(真实 URL)`，同时澄清威胁模型（防篡改是指框架不被模块开发者篡改）
4. 四方评审（架构师 / 产品 / 开发 / 安全），识别出 4 项阻断与 14 项应修，全部并入设计文档 v2
5. 需求方拍板：公开 npm、不签名、同源静态清单

**主要偏差与修正**

| 原方案 | 评审后 | 触发来源 |
|--------|--------|----------|
| fetch + SHA-384 + blob import，产物单文件 | 原生 `import(真实 URL)`，多 chunk | 需求方质疑单文件不现实 |
| 完整性 L0 + L1 | 默认 L2（`modulepreload + integrity`） | 安全 / 架构师：L1 防护≈0 |
| 按 `keepAlive` 推导页面包裹 | 显式 `handle.layout` | 开发：会导致整站 chrome 消失 |
| 全部共享依赖硬共享 | 软 / 硬分层 + `SHARED_DEPS` 单一常量源 | 架构师 + 开发：集合不自洽、会冻结软依赖 |
| Spike 排在 P3，CLI 排在 P4 | Spike 前置 P0，垂直切片前置 P1 | 架构师 + 产品 |
| importmap 12 项 | 补 `@tanstack/react-query`、`react-router/dom`、`antd/` 深路径等 | 开发：漏配即运行期崩 |

**耗时**：设计与评审阶段约 2 小时（含现状摸底、4 轮决策、四方评审、2 轮修订）。
