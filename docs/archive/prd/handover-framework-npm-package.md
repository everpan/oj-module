# 交接手册：框架 npm 包化

> 面向新接手这项工作的开发者。
> 覆盖：要做成什么、为什么这么做、已经做到哪、每步怎么验收、哪些坑必踩。
> 最后更新：2026-08-30（**P0–P7 全部完成**；P7 为「对 P0–P6 的独立评审 + 36 项整改」，分支 `feature/pkg-p7-review-fixes`。遗留项见 §3.5「遗留」与 §8）

## 0. 五分钟上手

```bash
pnpm install

# 1) 现有整体应用（框架 + 内置 modules/ 一起构建，仍是主要交付形态）
pnpm dev
pnpm build

# 2) 「外部模块工程」链路（本项目改造的目标形态）
pnpm --filter @react-antd-module/shell build     # 先出预构建宿主
cd apps/playground && pnpm dev                   # 等价于 ram dev

# 3) 校验
pnpm test          # vitest，当前 68 例全绿（P2.7 新增 9 例）
npx tsc --noEmit   # 0 错误
pnpm lint
```

必读文档，按顺序：

| 文档 | 作用 |
|---|---|
| `docs/prd/202608291025-framework-npm-package-design.md` | **设计与决策**。D1–D12 决策表、B1–B16 阻塞点、US 场景、评审记录（含明确不采纳的方案及理由） |
| `docs/prd/202608291145-framework-npm-package-implementation-plan.md` | **分阶段实施计划 P0–P6**，含每阶段完成判据；已完成项回填了状态与执行小结 |
| `docs/prd/runtime-api-usage.md` | P1 基线：外部模块实际用到的 runtime API（P3 冻结出口的输入） |
| `docs/prd/singleton-verification.md` | 单例契约的浏览器验证步骤 |
| `docs/prd/module-development-guide.md` | 模块开发规范（早于本次改造，仍有效） |
| `packages/{runtime,shell,cli}/README.md` | 三个包各自的定位、产物、出口、构建方式 |

引用格式约定：设计文档里的 `D*` 是决策，`B*` 是现状阻塞点，`R*` 是风险，`US-*` 是 BDD 场景。下文沿用。

---

## 1. 最终目标

一句话：**外部团队只写模块，不碰框架源码。**

现状是单仓应用：框架源码在 `packages/runtime/src/`，业务模块在 `modules/`，一起构建成一个站点。目标是把框架拆成三个 npm 包，外部团队新建的工程里**框架源码文件数 = 0**：

| 包 | 形态 | 职责 |
|---|---|---|
| `@react-antd-module/runtime` | 库（`dist/runtime.js`） | 框架运行时，模块工程唯一 import 的入口 |
| `@react-antd-module/shell` | **预构建站点**（`dist/index.html + assets/*`） | 宿主：加载模块、渲染容器、通过 importmap 提供共享依赖 |
| `@react-antd-module/cli` | 命令行（`ram`） | `ram dev` 起开发服务器、`ram build` 出模块产物 |

外部工程长这样（参考 `apps/playground/`）：

```
my-modules/
├── modules/<name>/entry.ts     # 只有业务模块
├── modules.config.ts           # 声明哪些模块参与构建
└── package.json                # 三个框架包放 devDependencies
```

`ram build` 只产出模块 chunk + `modules.json`；宿主已预先部署，**模块可独立上线而宿主不重建**（D1）。

### 可度量的验收目标（来自设计文档 §1）

- 工程内框架源码文件数 = 0
- 模块产物不含 react / antd / runtime 的实现代码
- 共享依赖运行时实例数 = 1
- 新模块从创建到上线 ≤ 1 个工作日
- 模块产物体积与首屏时间相对现状不劣化

### 明确的非目标

运行期热替换整体布局（L3）、模块市场、微前端多框架共存、模块沙箱化（iframe / Worker）。

---

## 2. 关键决策与取舍

这一节是交接的核心。**不理解这些取舍，很容易把已经否决过的方案重新做一遍。**

### 2.1 用 importmap，不用 Module Federation

模块用原生 `import(真实 URL)` 加载，共享依赖由宿主 HTML 里手写的 importmap 提供（D2/D5）。

- **为什么不用 blob URL**：importmap 是 document 作用域的。跨源模块内部的裸说明符同样会被映射；相对 import 按 `import.meta.url` 解析。用真实 URL 就能白拿 code splitting 和懒加载，blob 会把这些全丢掉。
- **推论 D6**：模块产物保留正常多 chunk，不启用 `inlineDynamicImports`，**不要求单文件**。
- **不用 Module Federation**：避免引入重型运行时；复用已有的 lib 模式构建能力即可。

### 2.2 共享依赖分「硬 / 软」两层，且必须单一常量源

被否决的方案是「20+ 依赖全部硬共享」——那会把软依赖也冻结成契约，宿主无法独立升级。

- **硬共享**（破坏即崩溃）：`react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`react-router`、`react-router/dom`、`@tanstack/react-query`、`@react-antd-module/runtime`
- **软共享**（允许版本漂移）：`antd`、`@ant-design/icons`、`@ant-design/cssinjs`、`i18next`、`react-i18next`、`dayjs`、`clsx` 等

**血的教训（B11/B12）**：设计初稿里 importmap 12 项、`SHARED_EXTERNALS` 20+ 项，两边都漏了 `@tanstack/react-query`。而 `modules/system/pages/role/index.tsx` 用了 `useQuery`，Provider 由宿主提供 —— 模块自带副本就会脱离 context 抛 "No QueryClient set"。

**所以现在只有一张表**：`packages/cli/src/shared-deps.ts`。importmap、模块构建的 `external`、CLI 版本校验三者都从它派生。新增共享依赖必须同步改三处（见 `packages/shell/README.md` 末节），漏一处就是运行期崩。

### 2.3 布局用显式 `handle.layout`，不做隐式推导

被否决的方案是「按 `keepAlive` 推导要不要套 ContainerLayout」。开发侧实锤：现状 8 个模块都把 `ContainerLayout` 挂在顶层路由且大多没声明 `keepAlive`，按 keepAlive 推导会导致**整站 header / sidebar 消失**（D9）。

因此改为显式契约 `handle.layout: "container" | "parent" | "none"`。

> ✅ **默认值已翻转（P2.7）**：迁移期默认值曾是 `container`（未声明的路由保持既有行为，否则现有 8 个模块立刻全炸）。P2.7 dogfooding（route-nest + system）验证新语义后，`resolve-layout.ts` 的默认值已按 D9 翻转为 `none`（未声明 → 直接渲染）。配套机制：模块路由由 `module-loader.getRoutes()` 出口的 `resolveRouteLayouts()` 按 `handle.layout` 统一包裹，模块不再 import 布局组件。

### 2.4 KeepAlive 必须先上移，再做布局去中心化

顺序不能反（B13 + P2 顺序约束）。原本 KeepAlive 实例在 `ContainerLayout → LayoutContent` 里，exclude 由 access store 的 `flatRouteList` 算出。若先做布局去中心化，页面一旦不套 ContainerLayout 就**完全没有缓存**。

所以 P2.1 先把 KeepAlive 抽成宿主固定层 `packages/runtime/src/layout/keep-alive-layer/`，exclude 改由 module-loader 汇总各模块 `handle.keepAlive` 得出。

**这里有个二次取舍**：KeepAlive 层只包裹**页面 outlet**，没有包在 `LayoutRoot` 的 `<Outlet/>` 外层。因为包外层会把 header / sidebar 一起缓存，切回路由时 chrome 状态错位，违背「整站 chrome 不消失」这条约束。功能目标（缓存不依赖 ContainerLayout 是否存在）已经达成。

缓存 key 必须与 `activeCacheKey`（= `pathname + search`）精确对齐，所以 exclude 计算复用了 `flattenRoutes`（key 是路由 `path`）。改这块时先看 `tests/keep-alive.test.ts`。

### 2.5 完整性档位直接上 L2，不做 L0/L1

安全与架构一致判定：L1 只保护入口 chunk，改子 chunk 即可注入任意代码，防护价值 ≈ 0，却要付 CORS 成本。所以默认 L2：所有已声明 chunk 走 `modulepreload + integrity`（D7）。`ram build` 已经在给每个 chunk 算 `sha384` 并写入 `modules.json`，懒加载 chunk 标 `lazy: true`。

### 2.6 信任根：不做签名，靠分目录 + 白名单

需求方拍板：公开 npm registry、清单托管在同源静态文件、**不实施签名**（同组织不同团队，签名收益不抵成本）。因此签名从 P6 移除，信任根退化为「CI 单一出口 + 清单与产物分目录分发布凭据 + origin 白名单」，残留风险登记为 R13（D10）。

**为什么必须分目录分凭据**：清单和 chunk 同目录同凭据时，攻击者改 chunk 后同步改 integrity 即可绕过一切校验。

### 2.7 授权边界在后端

前端只做体验性过滤，后端必须逐接口校验（D11）。现状 `requiredRoles` 全仓库从未被消费（B16），等于全员可见 —— 这是 P6 的活。

### 2.8 已明确否决的方案（不要重提）

| 建议 | 否决理由 |
|---|---|
| 第三方模块放 sandbox iframe / Worker | 与单例（D5）硬冲突，antd 主题与路由 context 全部失效。本期非目标，改用 scoped request + CSP |
| 完整性只做 L0/L1 | 等价无防护，见 2.5 |
| 20+ 依赖全部硬共享 | 宿主无法独立升级，见 2.2 |
| `create-module` 并入 cli | 保留独立包，与 `npm create` 调用约定一致 |
| 用正则解析 entry.ts 的 name/version | 单引号或模板字符串即失效（B10）。现改为 esbuild 打包后真实 `import()` |

---

## 3. 进度：做到哪了

分支策略：一个 Phase 一个分支，`feature/pkg-p{N}-*`。

| Phase | 内容 | 状态 |
|---|---|---|
| P0 | Monorepo 骨架（`src/` → `packages/runtime/src/`）+ Spike A/B | ✅ |
| Spike A | antd / react-router / react-query 单入口 ESM + importmap 验证 | ✅ Go |
| Spike B | 外部模块 Tailwind 产出与注入验证 | ✅ Go |
| P1 | 垂直切片：`ram build` / `ram dev` / shell importmap / playground | ✅ |
| **P2** | **依赖反转与语义迁移** | ✅ **全部完成（2.1–2.8）** |
| P3 | Runtime 出口收敛与冻结 | ✅（`feature/pkg-p3-runtime-api`） |
| P4 | Shell 与共享表治理 | ✅（`feature/pkg-p4-shell`） |
| P5 | 模块迁移与测试改造 | ✅（`feature/pkg-p5-migration`） |
| P6 | 安全加固 | ✅（`feature/pkg-p6-security`；O7 搁置） |
| P7 | 独立评审 + 整改（36 项确认问题，16 个任务） | ✅（`feature/pkg-p7-review-fixes`；报告与计划见 `docs/prd/202608300957-*`） |

### P2 明细

| # | 任务 | 状态 | 提交 |
|---|---|---|---|
| 2.1 | KeepAlive 上移到宿主固定层 | ✅ | `26cc3d7` |
| 2.2 | 引入 `handle.layout` 契约 | ✅ | `87bd842` |
| 2.3 | 框架内置 `NotFound` / `UnknownComponent` | ✅ | `db2d05f` |
| 2.4 | CI 卡口：禁 runtime 内出现 `#modules` | ✅ | `c283a04` |
| 2.5 | 移除主包对模块页面的 glob 收录 | ✅ | `4ed730d` |
| 2.6 | `__APP_INFO__` → `getAppInfo()` | ✅ | `a23abfa` |
| 2.7 | 先迁 1–2 个模块 dogfooding 验证语义 | ✅（route-nest + system 迁移 + 默认值翻转为 none） | `766e4c3` / `5ffa2db` |
| 2.8 | P2 TDD 验收与文档回填 | ✅（五条判据全绿） | 文档提交 |

**2.4 具体做了什么**：ESLint 增加本地规则 `runtime-guard/no-modules-in-runtime`（仅作用于 `packages/runtime/src/**`，对 `import` / `export ... from` / 动态 `import()` 的 source 做 `#modules` 前缀判断），CI 新增 `.github/workflows/ci.yml` 跑 `grep -rn "#modules" packages/runtime/src && exit 1` 作为硬兜底。注意：**不能用 `no-restricted-imports`**——它底层用 minimatch，而 minimatch 默认把以 `#` 开头的 pattern 当注释忽略，导致 `#modules` 永远匹配不到（实测 `react` 能匹配、`#modules/**` 匹配不到）。测试侧对照断言已在 `tests/framework-fallback.test.ts`（全量扫描 runtime 源码），2.4 把它升级成了 lint + CI 双卡口。

**2.5 具体做了什么**：`generate-routes-from-backend.ts` 的 `import.meta.glob` 移除 `/modules/*/pages/**/*.tsx`，`pageModules` 只收录框架自身 `packages/runtime/src/pages/**`；并删除了 `getComponentPathByRoute` 中已无法命中的「modules/<name>/pages」回退分支（死代码）。模块路由由 `loadAllModules` 经各模块自身 entry glob 注册，`auth-guard` 的 `filterBackendRoutes` 已把与模块重复的后端路径剔除，所以 `generateRoutesFromBackend` 实际只处理框架路径，框架不再 glob 模块页面。`tests/module-route-priority.test.ts` 该用例已翻转为断言「不得 glob 收录 /modules/」。

**2.6 具体做了什么**：新增 `getAppInfo()`（类型 `AppInfo`，见 `packages/runtime/src/types/app-info.ts`），随 runtime 主入口导出；框架内部唯一读取全局 `__APP_INFO__` 的位置收敛到 `utils/get-app-info`。消费点已全部迁移——框架侧 `get-app-namespace` 与模块侧 `modules/about` 的 `constants.ts` / `index.tsx`（4 处）改用 `getAppInfo()`。模块经 `#src/utils/get-app-info` 引入，不再依赖 Vite `define` 注入的全局，B9 解除。vite.config 的 `define` 仍保留（供框架内部 `getAppInfo` 读取）。新增 `tests/app-info-api.test.ts` 断言模块零 `__APP_INFO__` 引用。

### P2 的完成判据

1. `grep -rn "#modules" packages/runtime/src` 无输出
2. 缓存行为不回退（路由级 KeepAlive 仍生效，`keepAlive: false` 仍被排除）
3. 整站 chrome 不消失（header / sidebar 正常）
4. 路由优先级断言更新且通过
5. `pnpm test` / `npx tsc --noEmit` / 完整 `vite build` 全绿

### 3.5 任务清单与验收状态（给接手者一眼对账）

> 下表是「做了什么 / 怎么算做完 / 现在到底过没过」的一页速查。验收命令中的路径一律走设计文档与本文约定，勿硬编码。

#### 已完成（代码验证通过）

| 任务 | 验收条件（怎么算做完） | 验收状态 | 提交 |
|---|---|---|---|
| P0 Monorepo 骨架 | `pnpm dev/build/test/typecheck/lint` 行为与迁移前一致；`src`→`packages/runtime/src` | ✅ 通过 | `26cc3d7` 之前 |
| Spike A | antd / react-router / react-query 单入口 ESM + importmap 验证通过 | ✅ | — |
| Spike B | 外部模块 Tailwind 产物与注入验证通过 | ✅ | — |
| P1 垂直切片 | `tests/vertical-slice.test.ts` + `tests/cli-build.test.ts` 通过；`ram build/dev` HTTP 冒烟 200 | ✅ | `db2d05f` 之前 |
| P2.1 KeepAlive 上移 | `tests/keep-alive.test.ts` 通过；缓存 key 与 `activeCacheKey` 对齐；切路由 chrome 不消失 | ✅ | `26cc3d7` |
| P2.2 `handle.layout` 契约 | `tests/resolve-layout.test.ts` 通过；未声明路由默认 `container`，行为不变 | ✅ | `87bd842` |
| P2.3 内置兜底页 | `tests/framework-fallback.test.ts` 5 例通过；runtime 源码全量无 `#modules/exception`；full vitest 57；`tsc --noEmit` 0；完整 `vite build` 通过 | ✅ | `db2d05f` |
| P2.4 `#modules` 卡口 | eslint 规则 + CI grep 双卡口就位；`grep -rn "#modules" packages/runtime/src` 无输出；探针（静态+动态 import）均被拦截 | ✅ | `c283a04` |
| P2.5 去模块 glob | `tests/module-route-priority.test.ts` 断言翻转为「不得收录 /modules/」并过；runtime 不再 glob 模块页面；full vitest 57；根 `pnpm run build` 8 模块独立构建通过 | ✅ | `4ed730d` |
| P2.6 `getAppInfo()` | `tests/app-info-api.test.ts` 2 例通过；模块源码零 `__APP_INFO__` 直接引用；runtime 入口导出 `getAppInfo`；full vitest 59；`tsc --noEmit` 0；build 通过 | ✅ 通过 | `a23abfa` |
| P2.7 模块布局解耦 dogfooding | `resolveRouteLayouts` 按 `handle.layout` 注入布局；route-nest/system 零 layout import 且产物无 `#src/layout`；默认值按 D9 翻转为 `none`；full vitest 68；`tsc --noEmit` 0；build 通过 | ✅ 通过 | `766e4c3` / `5ffa2db` |
| P2.8 P2 验收 | §3 P2 完成判据 5 条全绿；本文与计划文档同步更新 | ✅ 通过 | 文档提交 |

#### P3–P6（全部完成，2026-08-30）

各任务逐项的小结、问题分类与耗时记录在计划文档对应阶段章节，此处只列验收锚点：

| Phase | 验收锚点（测试卡口即验收） | 状态 |
|---|---|---|
| P3 出口冻结 | `tests/runtime-exports.test.ts`（出口白名单）+ playground 独立 tsc 自证（`tests/playground-package-tsc.test.ts`）；`private: true` 已取消，peerDeps 25 包与共享表互锁 | ✅ |
| P4 共享表治理 | `tests/shared-deps.test.ts` + `tests/shell-importmap.test.ts` + `tests/version-gate.test.ts`（D12 严格相等）；importmap/shell 表全部由 `SHARED_DEPS` 单一来源生成，四张手写清单归一 | ✅ |
| P5 模块迁移 | `tests/module-bootstrap.test.ts`（清单消费仅入口，O5/B7）+ `tests/manifest-merge.test.ts`（R12）+ `tests/module-required-roles.test.ts`（B16）+ `tests/shell-integrity.test.ts`（L2）；手册重写 `docs/prd/module-development-guide.md` | ✅ |
| P6 安全加固 | `tests/shell-trust.test.ts`（moduleOrigins）+ `tests/shell-csp.test.ts`（nonce CSP，无 strict-dynamic）+ `tests/scoped-request.test.ts`（D11）+ `tests/iframe-guard.test.ts` + `tests/no-fake-in-dist.test.ts`（B15）+ `tests/supply-chain.test.ts`（P6.6/6.8） | ✅ |

收尾全量：161 用例 / 32 文件绿，`tsc --noEmit` 0 错误，`pnpm run build` 通过。

#### 遗留（待接手）

| 项 | 说明 |
|---|---|
| O7 refreshToken → httpOnly Cookie | 需后端配合，需求方未确认，前端侧不实施；风险已记 R13/O7，README 有明示 |
| `require-trusted-types-for` CSP 未启用 | antd6 cssinjs 大量 innerHTML 注入，直接加会全站崩，需配套 trusted-types policy |
| CI 版本回归（宿主升级 → 已发布模块） | 随首轮真实发布补进发布流程 |
| `frame-src` 与 `TRUSTED_ORIGINS` 占位值 | 当前为设计示例域，部署时按业务域替换并重建 shell |
| 真 HMR（vite middleware dev server） | `ram dev` 现为构建 + watch + 手动刷新；P4/P5 偏差记录延续 |

---

## 4. 已完成阶段的成果与验收记录

### P0：Monorepo 骨架

`git mv src packages/runtime/src`，此阶段**不改变任何运行时行为**。
判据：`pnpm dev` / `build` / `test` / `typecheck` / `lint` 行为与迁移前一致。

踩过的两个坑写在计划文档里，值得单独记住：

- **A11 · 子包 package.json 会截断父包的 `imports` 解析**（触发了 2 次构建失败）。Node 的 subpath imports 只查**最近的** package.json，**不向上回溯**。所以 `packages/runtime/package.json` 必须自己声明完整的 `imports`（`#src/*` / `#modules/*` / `#manifest.json`）。**凡是被 Node 侧加载的文件（jiti / tsx / 脚本），其 `#` 说明符都要由最近的 package.json 兜住 —— Vite alias 和 tsconfig paths 都救不了。**
- **A12 · 根相对字面量不会被 alias 改写**：`index.html` 的 `src="/src/index.tsx"`、`import.meta.glob("/src/pages/**")`、`FileSystemIconLoader("./src/icons/svg")` 这些都得手改。改错了 Vite 照样启动，只是页面 404 或路由空白。

### P1：垂直切片

打通「外部工程只写模块」的最小闭环：

- `apps/playground/` 模拟外部工程，只有 `modules/demo/` + `modules.config.ts` + `package.json`
  （计划文档 1.1 里还列了 `vite.config.ts`，实测**不需要** —— 构建完全由 `ram build` 驱动，外部工程无需自备 vite 配置）
- `packages/cli`：`ram build`（lib 模式多 chunk + `modules.json` + sha384）、`ram dev`（宿主代理 + watch 重建）
- `packages/shell`：15 个共享依赖各自打成单入口 ESM，加上从 runtime 拷来的 `runtime.js`，共 **16 条 importmap 映射** + 宿主应用
- 基线文档 `runtime-api-usage.md`：playground 实际只用到 `defineModule` + `BasicContent`

验收：`tests/vertical-slice.test.ts` + `tests/cli-build.test.ts` 断言产物不含共享依赖实现代码、无 blob import、`modules.json` 字段完整；`ram dev` HTTP 冒烟 200。

> ⚠️ **纠正一处文档错误**：P1 计划里 1.4 的验收写的是「`__REACT_INSTANCE_COUNT__ === 1`」。**React 19 的 dev build 并不暴露这个全局**（已在 `node_modules/react/cjs/react.development.js` 中 grep 确认）。它只是「单例」这个意图的绰号。真实可执行的验证方法见 `singleton-verification.md`：① 同一 URL import 两次比较引用同一性；② React DevTools 的多副本告警；③ 可选地由宿主自己维护一个 dev-only 计数器。

### P2.1 / P2.2 / P2.3

- **2.1**：`keep-alive.ts` 提供纯函数 `collectKeepAliveExcludes` / `collectAllRoutePaths`，module-loader 暴露 `getKeepAliveExcludeKeys` / `getAllRoutePathKeys`；`LayoutContent` 不再依赖 access store 的 `flatRouteList`。测试 `tests/keep-alive.test.ts`。
- **2.2**：`RouteMeta` 加 `layout` 字段 + `resolveLayoutComponent()`。测试 `tests/resolve-layout.test.ts`。行为保持不变（默认 container）。
- **2.3**：新增 `components/not-found` 与 `components/unknown-component`，`fallback.ts` 与 `generate-routes-from-backend.ts` 不再 import `#modules/exception`；框架自带 `locales/{zh-CN,en-US}/exception.json`；exception 模块降级为可选覆盖（只保留演示路由，全部相对引用）。测试 `tests/framework-fallback.test.ts`。

  顺带修掉一个隐性 bug：`components/page-error` 一直引用 `t("exception.pageErrorTitle")`，但该文案此前只存在于 exception **模块**的 namespace（`exception:pageErrorTitle`）里，实际取不到值。现在由框架 locale 提供。

  同时删掉了 P1 遗留的两个手写 `modules/exception/pages/*/index.d.ts` —— 它们当初只是为了让框架能跨目录引用模块页面，反向依赖切断后已无意义。

---

## 5. P3–P6 各阶段做了什么（全部已完成）

### P3：Runtime 出口收敛与冻结

基于 `runtime-api-usage.md` 定出口白名单；把模块里的 `#src/*` 说明符改成 `@react-antd-module/runtime`；图标契约统一为 `ReactNode`（现在是混合契约，部分模块仍传字符串，B6）；出 d.ts 并取消 `private: true`。

工作量随进度漂移，动手前重新量一次：

```bash
grep -rhoE '"#src/[a-z0-9/-]+"' modules/ | sort -u | wc -l   # 不同说明符数：23（2026-08-29）
grep -rhE  '"#src/' modules/ | wc -l                         # import 条数：83
grep -rlE  '"#src/' modules/ | wc -l                         # 涉及文件数：28
```

（设计文档 §3 记的是 23 / 86 / 29，为 P0 前的快照。）

**~~已探明的具体阻碍~~（P3 起步已解除）**：tsc 声明阶段的 3 处报错（`layout-menu/style.ts` / `layout-tabbar/style.ts` 的 TS2883、`locales/helper.ts` 未导出 `LanguageModule` 导致的 TS4023）已在 `feature/pkg-p3-runtime-api` 分支修复，`dist/` 声明树可完整产出。修法与原处方（显式引用 jss `Classes`）有偏差——实际用结构化 `Record<C, string>` 标注，原因见计划文档 P3.5 小结。

### P4：Shell 与共享表治理

importmap 自动生成（不再手写）、dev 体验三件套（`jsx-dev-runtime` 映射 / react-refresh preamble / sourcemap）、`ram info` 版本矩阵、版本严格相等校验（D12）。

**D12 为什么必须严格相等而非 semver 范围**：类型来自 `node_modules`，实现来自 shell 的 `dist`。两者可以差 N 个 minor，结果类型全绿而运行期炸。

### P5：模块迁移与测试改造（已完成）

8 个模块全部迁到新语义（布局部分在 P3.2 前跑完成）；O5 的落地方式是**守卫链路下线**：`manifest.json` 加载上移到 `index.tsx` 启动期，守卫只消费 `getRoutes()`，加载失败显示人话错误页（B7）。手册已重写为外部团队视角：`docs/prd/module-development-guide.md`。

### P6：安全加固（已完成）

信任根（`moduleOrigins` 白名单）、CSP（构建期随机 nonce 保护内联 importmap，不加 strict-dynamic）、scoped request client（模块按 `register.apiPrefix` 前缀收敛，越界拒绝）、iframe 加固（https + 域名白名单 + sandbox）、fake server 治理（B15，`enableProd` 改 `VITE_ENABLE_FAKE_PROD` 显式控制 + 产物扫描卡口）、供应链（发布锁官方源 / provenance / README checklist / R13 明示）。

执行中发现并修复的新问题：`__APP_INFO__` 曾把整个 package.json（含 devDependencies 清单）打进产物，属供应链侦察信息泄露——已剔除注入并加卡口。

**O7 搁置（需求方指示）**：refreshToken 迁到 httpOnly Cookie 需要后端配合。在此之前，风险是「同组织内的模块可读取 localStorage 里的 refreshToken」，由组织内信任模型承担，已记 R13/O7。

### P7：独立评审与整改（已完成）

对 P0–P6 全貌做了一次独立 code review（5 个并行评审维度 + 逐项置信度打分），确认 36 项问题，归档于 `docs/prd/202608300957-review-report-framework-npm-package.md`；整改计划与逐项判据在 `docs/prd/202608300957-p7-review-remediation-plan.md`（16 个任务全部完成）。

核心结论：**22/22 确认问题中 9 项的根因是「文档/注释承诺了但实现漂移」**——peerRuntime 校验只有类型没有执行、requiredPermissions 声明了没人消费、设计文档声称的「深路径报错」「ram info/merge」并不存在。整改方向因此不是逐条打补丁，而是给每条承诺补测试卡口：

- 安全：信任 URL 归一化堵 `//evil.com`、`\`、blob: 绕过（S1）；scoped client 段边界匹配 + 归一化 + 剥离单次请求 `prefix` 覆盖（S2，token 外泄通道）；iframe 白名单与 CSP/modules 三方一致性测试卡口（S4）。
- 契约闭环：peerRuntime 真实 semver 校验（最小实现 `satisfiesSemver`）、依赖缺失 `status: "missing-deps"` 半加载杜绝、requiredPermissions 落地、shell 清单 `toLoaderManifest` 全字段透传（F1/F2 被裁剪）、shell 包转 npm 发布（**翻转 P6.6 的 private 决策**，F5）。
- 工具补齐：`ram info` / `ram merge` 真实落地（P7.11/P7.15）；entry 并入 chunks[] 完整性链路（P7.3）；深路径裸说明符构建期报错（P7.9）。
- 新决策 D-P7-1/2/3：create-module 不并入 CLI（playground 复制降级）；动态 import 无法携带 integrity（浏览器限制）写回设计文档；CSP 静态 nonce 保留。

**接手者注意**：凡在设计文档/手册里读到的行为承诺，应能在 `tests/` 找到对应卡口；找不到即视为漂移嫌疑（P7 的教训）。

---

## 6. 工程约定与雷区

### 提交与校验

- 有 `simple-git-hooks` + `lint-staged` 预提交钩子（`eslint --fix`）。
- **commitlint 有 `subject-case` 规则**：subject 里的拉丁词必须小写。写 `feat: KeepAlive ...` 会被拒，得写 `keepAlive`。
- **不要在 `package.json` 的 `scripts` 里用 `npx <pkg>`**：`pnpm run` 会把 pnpm 的全局 bin 目录前置到 PATH，那里可能存在一个 2021 年的独立 `npx` 包遮蔽 npm 自带的那个，需要联网拉包时会以 `cb.apply is not a function` 挂掉。工具一律声明为 devDependency 并直接写 bin 名（`tsx scripts/foo.ts`），pnpm 会把 `node_modules/.bin` 排在最前。
  （`simple-git-hooks` 配置里的 `npx lint-staged` / `npx commitlint` 走的不是 `pnpm run`，目前工作正常，未做改动。）

### `.gitignore` 与预置产物

`dist/` 是 ignore 规则，但 `packages/shell/dist/` 和 `packages/runtime/dist/` 是**随仓库分发的预置产物**，靠 negation 白名单显式放行：

```
dist/
!packages/shell/dist/
!packages/shell/dist/**
!packages/runtime/dist/
!packages/runtime/dist/**
```

**两个坑**：

1. `dist/` 规则会**静默忽略**已被 tracked 的文件改动，`git add` 会直接报 "ignored by .gitignore"。正确做法是加 negation 白名单，不要 `git add -f` 硬塞。
2. 同样的原因会让 `lint-staged` 报 "Failed to stage changes from tasks" —— 它 fix 完文件后重新 stage 时被 ignore 规则挡住。
3. 改了 runtime / shell 源码后**必须重新构建并提交产物**，否则外部工程拿到的是旧实现。

### 失败的 `tsc -p tsconfig.dts.json` 会留垃圾

d.ts 生成失败时仍会写出一部分声明文件到 `packages/runtime/dist/`（`api/`、`components/`、`index.d.ts` …）。由于上面的 negation 白名单，这些残留会出现在 `git status` 里。**别提交**，删干净只留 `runtime.js`。

### 测试

- `pnpm test` 跑 vitest，环境 happy-dom，setup 在 `packages/runtime/src/setupTests.ts`。
- 测试里的路径**一律**从 `tests/helpers/paths.ts` 取（`RUNTIME_DIR` / `MODULES_DIR` / `SHELL_DIST_DIR` …），不要硬编码 —— 目录结构在 P0 已经动过一次，后续还会动。
- 收尾时 vitest 会打印 "close timed out / something prevents Vite server from exiting"。**这是既有噪音，不是失败**，看 `Test Files N passed` 那行。

### 改动前先看的测试

| 你要改 | 先看 |
|---|---|
| KeepAlive / 缓存 key | `tests/keep-alive.test.ts` |
| 布局语义 | `tests/resolve-layout.test.ts` |
| 框架↔模块依赖方向 | `tests/framework-fallback.test.ts` |
| 路由优先级 / glob 收录 | `tests/module-route-priority.test.ts` |
| CLI 产物契约 | `tests/cli-build.test.ts`、`tests/vertical-slice.test.ts` |
| 共享依赖表 / importmap / 版本门禁 | `tests/shared-deps.test.ts`、`tests/shell-importmap.test.ts`、`tests/version-gate.test.ts` |
| 清单加载与错误契约 | `tests/module-bootstrap.test.ts`、`tests/manifest-merge.test.ts` |
| 模块角色 / 布局插槽 | `tests/module-required-roles.test.ts`、`tests/runtime-slots.test.ts` |
| shell 完整性 / 信任根 / CSP | `tests/shell-integrity.test.ts`、`tests/shell-trust.test.ts`、`tests/shell-csp.test.ts` |
| scoped request / iframe 守卫 | `tests/scoped-request.test.ts`、`tests/iframe-guard.test.ts` |
| fake 门禁 / 供应链 | `tests/no-fake-in-dist.test.ts`、`tests/supply-chain.test.ts` |
| peerRuntime / missing-deps / requiredPermissions | `tests/p7-module-contracts.test.ts` |
| iframe 白名单 ↔ CSP ↔ 模块用法一致性 | `tests/iframe-whitelist-consistency.test.ts` |
| shell 清单透传 / create-module 模板 / 异常页兜底 | `tests/shell-manifest-passthrough.test.ts`、`tests/create-module-template.test.ts`、`tests/exception-fallback.test.ts` |
| 模块 i18n 规范 | `tests/module-i18n-consistency.test.ts` |
| 目录结构 | `tests/monorepo-layout.test.ts`、`tests/playground-structure.test.ts` |

---

## 7. 工作方式（沿用即可）

1. **一个 Phase 一个分支**，一个任务一个提交。
2. **测试先行**：先写会失败的断言，再实现。P2.3 就是先写 `framework-fallback.test.ts`（4 例失败），再补组件和 locale。
3. **每个任务收尾跑全套**：`npx tsc --noEmit` → `pnpm test` → 相关构建（runtime lib / shell / 完整 app）。
4. **完成后回填计划文档**：更新任务表状态与提交号，必要时补一段「执行小结」记录取舍。执行中发现设计文档与实现不一致（比如 D9 的默认值、`__REACT_INSTANCE_COUNT__`）要**在文档里改正并说明**，不要让文档继续说错话。
5. 遇到设计文档没覆盖的岔路，先翻 §10 评审记录看是不是已经否决过的方案。

---

## 8. 接手清单（按此顺序，给下一棒）

> 当前状态：**P0–P7 全部完成**。P7 整改在 `feature/pkg-p7-review-fixes` 分支（3 个代码提交 + 文档提交）。收尾全量 209 用例绿，tsc 0 错误，完整构建通过。

1. **对照遗留表**（§3.5「遗留」）按需处理：O7 等后端确认；`TRUSTED_ORIGINS` / `frame-src` 部署时替换占位域名（`packages/shell/src/trust.ts` / `src/csp.ts`，改后重建 shell）。
2. **首次真实发布时**：按 README「Security & Publishing」checklist 走（2FA、`--provenance`、`--frozen-lockfile`），并把 CI 版本回归（宿主升级 → 已发布模块）补进发布流程。
3. **排障提醒**：模块加载失败看启动期人话错误页（B7）；模块路由/菜单整体缺失先查 `requiredRoles`（B16，注入前过滤）与清单 `enabled`；单模块 `status: "error"` 不影响其余模块。
4. **外部团队入口文档**是 `docs/prd/module-development-guide.md`（P5.6 重写）；框架侧改共享依赖须走 `packages/cli/src/shared-deps.ts` 单一来源，drift-prevention 测试会先红。
5. 各阶段逐任务的小结、问题分类（反常规/反常识/与业界不符）与耗时都在计划文档对应 Phase 章节，勿在本文重复。

**最小验证回路（任何改动后都跑）**：`npx tsc --noEmit` → `pnpm test` → 相关构建（runtime lib / shell / 完整 app）。测试里的路径从 `tests/helpers/paths.ts` 取，别硬编码。
