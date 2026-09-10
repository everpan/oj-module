# Layout E2E 基线设计 —— 双环境 Playwright 套件

> 日期：2026-08-31 15:43
> 分支：`feature/layout-e2e-baseline`
> 关联：`HANDOFF.md`（playground 菜单空白未闭环）、`docs/prd/20260511-permission-design.md`

## 1. 背景与问题

当前分支（monorepo，`packages/runtime/src/layout/`）由 commit `411e353b`（旧 `src/layout/`）演化而来。逐文件 diff 证实：**layout 组件语义几乎零偏差**，仅有的 4 处语义差异均为已记录的故意变更：

| 文件 | 差异 | 性质 |
|------|------|------|
| `container-layout/index.tsx` | 包 `JSSThemeProvider` | 故意（D2 修复，HANDOFF §3） |
| `layout-content/index.tsx` | KeepAlive 上移至 `keep-alive-layer` | 架构变更，**行为等价性无 e2e 验证** |
| `layout-header/index.tsx` | 新增 `header-actions` 插槽 | 故意（P3.6） |
| `layout-menu/index.tsx` | `indexOf` → `includes` | 等价改写 |

但 `HANDOFF.md` §4 记录了未闭环现象：**`ram dev`（host.tsx 链路）浏览器实跑左侧菜单空白**，而 happy-dom 自动化全绿。根因判断：偏差不在 layout 组件，而在宿主链路的数据填充（`wholeMenus`），且该链路无浏览器级测试覆盖。

**目标**：

1. 用真实浏览器 e2e 闭环「playground 能成功运行且布局符合设计」；
2. 建立 layout（header / footer / sidebar / tabbar / menu）行为基线，为后期架构变动兜底；
3. 同一套件可在 411e353b（legacy）与当前 HEAD（playground）双环境运行，**排除数据差异**，定位并修复功能演进偏差。

## 2. 方案选型（已定：方案 A）

- **Playwright 真实浏览器 e2e**（root devDep `@playwright/test`），双环境 profile。
- 排除方案 B（vitest + happy-dom）：HANDOFF 已证伪——happy-dom 全绿但浏览器白屏，且无真实布局引擎，测不准折叠/溢出/定位。
- 排除方案 C（仅 playground 单环境）：违背「两套都可以跑」要求。

## 3. 架构

### 3.1 目录与文件

```
e2e/
├── playwright.config.ts        # 双 project：playground / legacy
├── fixtures/
│   ├── env.ts                  # 环境适配器：baseURL、是否需登录、homePath
│   └── auth.ts                 # legacy 登录 fixture（fake 后端）；playground 直通
├── layout/
│   ├── sidebar.spec.ts
│   ├── header.spec.ts
│   ├── tabbar.spec.ts
│   ├── footer.spec.ts
│   └── menu-consistency.spec.ts # 菜单 ↔ 路由数据驱动一致性
└── README.md                   # 运行方式、环境矩阵
```

**核心约束：spec 零 import 源码**。选择器只用语义定位（`header` / `aside` / `.ant-menu` / tabbar DOM / role），与目录结构、模块系统完全解耦——这是「两套都能跑」的关键。

### 3.2 双环境 profile

| profile | 目标 | 启动 | 认证 | 菜单数据 |
|---------|------|------|------|----------|
| `playground` | HEAD，`apps/playground` | `pnpm --filter @apps/playground dev`（ram dev :5174） | 免登录（D5②） | demo 模块路由 |
| `legacy` | 411e353b worktree | `pnpm dev`（vite :3333） | fake 登录（`fake/auth.fake.ts`） | 静态路由 + fake 后端动态路由 |

- `webServer` 由 playwright config 按 project 自动拉起；legacy 环境用 `git worktree add` 检出 411e353b 到 `.claude/worktrees/legacy-411e353b`（仅运行用，不入库）。
- 环境差异（baseURL / 登录 / homePath）全部收敛在 `fixtures/env.ts`，spec 不感知。

### 3.3 数据差异排除策略

菜单不写死任何条目，全部运行时派生：

1. 从 DOM 读取 `.ant-menu` 实际渲染的菜单项集合；
2. 对每个菜单项点击 → 断言路由跳转成功且内容区渲染非空；
3. 断言「菜单项 ↔ 可达路由」一致（不多不少）；
4. 断言当前路由对应菜单项高亮（`.ant-menu-item-selected` / `.ant-menu-submenu-selected`）。

如此 legacy（全量菜单）与 playground（仅 demo 菜单）共用同一 spec，数据差异被天然吸收。

## 4. 覆盖矩阵（BDD 用例）

### 4.1 Sidebar

| # | Given | When | Then |
|---|-------|------|------|
| S1 | 已进入主界面 | 加载完成 | `aside` 可见，`.ant-menu-item` 数量 > 0（闭环 HANDOFF 菜单空白） |
| S2 | 侧栏展开 | 点击折叠触发器 | 侧栏收起为 `sideCollapsedWidth`，菜单文字隐藏图标保留 |
| S3 | 侧栏收起 | 再次点击触发器 | 侧栏恢复展开 |
| S4 | 处于某子路由 | 观察菜单 | 当前路由对应菜单项高亮，父级 submenu 展开 |
| S5 | 多级菜单 | 点击 submenu | 子菜单展开/收起，不触发跳转 |

### 4.2 Header

| # | Given | When | Then |
|---|-------|------|------|
| H1 | 主界面 | 加载完成 | `header` 可见，含 logo、折叠触发器、用户菜单 |
| H2 | 默认侧栏导航 | 观察 header 左区 | 渲染面包屑且与当前路由层级一致 |
| H3 | 主界面 | 切换语言按钮 | 菜单/界面文案切换语言 |
| H4 | 主界面 | 切换主题按钮 | `html`/`body` dark 类名或主题变量变化 |

### 4.3 Tabbar

| # | Given | When | Then |
|---|-------|------|------|
| T1 | 打开页面 A | 经菜单打开页面 B | tabbar 出现 A、B 两个页签，B 激活 |
| T2 | A 页有输入态 | 切到 B 再切回 A | A 的输入态保留（keepalive 命中——**验证 layout-content KeepAlive 上移的行为等价性**） |
| T3 | 多页签 | 关闭非激活页签 | 页签消失，激活态不变 |
| T4 | 多页签 | 关闭激活页签 | 跳转到最后一个剩余页签（或按 tabs store 规则） |
| T5 | 多页签 | 右键/下拉「关闭其他」 | 仅剩当前页签 |

### 4.4 Footer

| # | Given | When | Then |
|---|-------|------|------|
| F1 | 默认偏好 footerEnable | 加载完成 | footer 可见性与偏好一致（从偏好面板切换后断言 DOM 同步） |

### 4.5 Menu ↔ Route 一致性（数据驱动核心）

| # | Given | When | Then |
|---|-------|------|------|
| M1 | 菜单已渲染 | 提取全部 `.ant-menu-item` | 每项可点击并到达对应路由，内容区非空 |
| M2 | 任一菜单路由 | 直接 URL 访问 | 菜单对应项高亮，无 404 |

## 5. 偏差定位与修复流程

1. 套件在 `legacy` 环境跑通（基线成立——411e353b 即设计）；
2. 同一套件在 `playground` 环境运行；
3. **legacy 绿 / playground 红** = 功能演进偏差点 → 修复至双绿（首选修复 playground 侧，除非证明 legacy 行为本身是 bug）；
4. 双绿后套件即长期基线，纳入 `pnpm test:e2e`（与 vitest 分离）。

## 6. 错误处理与边界

- **dev 端口残留**（HANDOFF §8 坑）：playwright `webServer.reuseExistingServer: false`，启动前检测端口占用并失败提示，不静默顺延。
- **legacy 登录**：经 UI 表单登录（fake 后端账号见 `fake/auth.fake.ts`），不走 token 注入——登录本身也是行为的一部分；但登录页断言不属于本套件范围（仅作为 fixture 前置）。
- **动画/过渡**：所有断言用 `expect(...).toBeVisible()` 轮询而非固定 sleep；折叠宽度等数值断言读取运行时计算样式，不硬编码像素（偏好可调）。
- **H2/H3 风险**（HANDOFF §4）：若 playground 菜单空白根因是偏好默认收起或 host 链路数据未填充，S1/M1 会在真实浏览器直接暴露，随即按 §5 修复。

## 7. 测试策略小结

- 本套件为**浏览器级行为基线**，与现有 vitest（happy-dom 单元/集成）互补不替代；
- spec 与源码零耦合，架构再迁移（目录变动、包拆分）无需改测试；
- 已知留白（YAGNI，后续按需再加）：mobile 抽屉菜单、mixed/two-column 导航模式、视觉回归截图、CI 接入。

## 8. 实施步骤（计划另出）

1. 本设计评审通过 → 2. `writing-plans` 出实施计划 → 3. Playwright 骨架 + legacy 环境跑通 → 4. 逐 spec TDD → 5. playground 环境跑通并修复偏差 → 6. 文档回写（HANDOFF 闭环、计划总结）。
