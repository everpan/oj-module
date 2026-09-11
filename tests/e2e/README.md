# Layout E2E 基线

对 header / sidebar / tabbar / footer / menu 的真实浏览器（Playwright + chromium）行为基线，
供后期架构变动回归对照。设计文档：`docs/prd/202608311543-layout-e2e-baseline-design.md`。

## 双环境

| 环境 | E2E_TARGET | 端口 | 登录 | 命令 |
|------|-----------|------|------|------|
| playground（当前 HEAD） | playground（默认） | 5174 | 免登录 | `pnpm test:e2e` |
| legacy（411e353b worktree） | legacy | 3333 | fake 预填，自动提交 | `pnpm test:e2e:legacy` |

- workers=1 串行：tabbar/menu 用例有全局 UI 状态；`reuseExistingServer: false`，跑前确保 5174/3333 无残留进程（`lsof -iTCP:5174 -iTCP:3333 -sTCP:LISTEN`）。
- playground 的 `ram dev` 需要宿主/playground 产物先行构建：`pnpm --filter @oj-module/cli build:shell && pnpm --filter playground build`。

## legacy worktree 建法（一次性）

```bash
git worktree add .e2e-legacy 411e353b
pnpm --dir .e2e-legacy install
```

`.e2e-legacy/` 已 gitignore，不入库。worktree 的 `.git` 是文件，`simple-git-hooks` 的
prepare 必失败，因此 legacy webServer 命令带 `--config.verify-deps-before-run=false`
（pnpm 11 run 前的自动 install 会拖死启动）。

## 约定（审查 spec 时对照）

1. **spec 零 import 源码**：不得 import `#src/*` / `@oj-module/*`。只通过
   DOM / URL / localStorage 观测——这是「架构变动后基线仍可跑」的前提。
2. **语义选择器**：`header / aside / main / footer / .ant-menu-root / .ant-tabs-tab`；
   组件类名仅用 antd 公共类（`.ant-menu-item-selected` 等），不依赖业务类名。
3. **菜单数据驱动**：不硬编码菜单条目与索引，从 DOM 实时取（`visitEveryMenuItem` 深度
   优先遍历叶子、`openFirstMenuGroup` 只挂载首组）。菜单条目增删、夹具顺序变动不需要改 spec。
4. **手风琴适配**（`fixtures/menu.ts`）：legacy 默认 `preferences.accordion=true`（同层
   互斥、祖先保留），「全部同时展开」不可能成立 → 逐组访问；且当前路由所在组会自动展开，
   再点击反而收起 → 所有展开点击前必须 `ant-menu-submenu-open` 守卫。
5. **等待策略**：只用 `expect(...).toBeVisible()` / `waitForURL` 轮询；固定
   `waitForTimeout` 仅限动画 settle（250ms）与「点击当前路由项不导航」的 1s 探测。
6. **环境差异收敛于 `fixtures/env.ts`**：`EnvProfile`（needsAuth/homePath/allowBlankRoutes）；
   spec 内环境分支须显式注释原因（如 T2 keepalive 夹具仅 playground 具备）。

## 已知环境噪音（非缺陷）

- playground `/api/notifications` 404 → "Not Found" toast（playground 无该 mock 端点）。
- legacy `/route-nest/menu2` 无组件路由 → main 空白，属 fake 菜单数据特性（M1 以
  `allowBlankRoutes` 跳过非空断言）。
- legacy 首个 `/home` 页签 `closable:false` 常驻，页签计数断言按「起始数+实际导航数」计算。
- legacy 假菜单含指向不存在路由的演示项 → 落到内置 `/exception/404` 兜底页（M3 过滤）。

## 已知覆盖边界（基线绿 ≠ 完全对等）

- **host 链 antd 主题/地域不完全同源**：shell 的 `ConfigProvider` 固定
  `defaultAlgorithm` 且未传 locale——`html.dark`（H4 断言的）已同源，但 antd 组件
  自身的暗色算法与语言包在宿主链仍不随偏好。H3/H4 绿只保证断言的那部分行为。
- **语言偏好同步**（原 host 链缺失，审查期修复入 LayoutEffects）只覆盖 i18next 与
  `html[lang]`；dayjs/antd locale 同步仍在 App 链。
- **ram dev 的 SPA history fallback** 按 `Accept: text/html` 判定（对齐 vite dev），
  非 HTML 请求（fetch API）仍按 404 处理——这是特性不是缺陷。
