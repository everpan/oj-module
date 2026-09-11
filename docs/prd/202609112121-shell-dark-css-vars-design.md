# 修复：shell 宿主链暗黑模式下 `--oo-*` 变量缺失（footer 白色）

- 日期：2026-09-11 21:21
- 状态：已确认（用户报告：`packages/runtime/src/layout/layout-footer/` 暗黑模式下显示为白色）
- 关联：[[202609112006-init-template-personal-center-design]]（P4 的 `window.$message` 在宿主链同样缺失，本修复一并治愈）

## 1. 问题定位

**症状**：ojm 宿主链（playground-oj / init 工程）切暗黑后，footer 显示为白色。

**根因**：Tailwind 语义色工具类（`bg-colorBgContainer` / `text-colorTextSecondary` …）编译为 `var(--oo-*)`，而 `--oo-*` 变量**只**由 runtime 内部组件 `components/antd-app`（`setupAntdThemeTokensToHtml` 写入 `:root`）负责同步（`packages/runtime/src/components/antd-app/index.tsx:20`）。

但宿主链 `packages/cli/shell/src/host.tsx` 用的是 **antd 原生 `App`**（`import { App as AntdApp } from "antd"`，host.tsx:31），从未渲染 runtime 的 `AntdApp` —— 整条宿主链没人写 `--oo-*`。亮色模式下 `var(--oo-colorBgContainer)` 落空 → transparent → 白色 body 透出，恰好与预期同色，无人察觉；暗黑模式侧栏/顶栏走 `dark:` 变体正常变暗，footer 依旧透白，对比暴露。

**连带缺陷**：runtime `AntdApp` 内的 `StaticAntd`（`window.$message/$modal/$notification`）在宿主链同样缺失——上阶段刚给模板 `env.d.ts` 补的 `$message` 声明，运行时实为 `undefined`。

## 2. 决策表

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| F1 | 修复位置 | runtime 主入口导出 `AntdApp`；shell `host.tsx` 改用它替换 antd 原生 `App` | 变量同步逻辑已存在且经 App 链验证，不在宿主侧复制第二份（DRY）；导出面 +1 需过 P3.1 冻结测试 |
| F2 | StaticAntd 一并引入宿主链 | 是（runtime `AntdApp` 内置） | 顺手治愈 `$message` 缺失；行为与 App 链对齐（两链同构原则） |
| F3 | 变量命名/机制 | 不动（继续 `:root` + `#antd-theme-tokens` style 标签） | 现有机制已响应 ConfigProvider 主题切换（`useEffect([antdTokens])`） |

## 3. 用户故事与用例（BDD）

### US-1 暗黑模式 footer 不再白色

```gherkin
Given 宿主链（shell host.tsx）渲染的页面
When 偏好切换为暗黑模式
Then footer 的 bg-colorBgContainer 解析到 --oo-colorBgContainer（暗色值）
And text-colorTextSecondary 解析到 --oo-colorTextSecondary
```

### US-2 AntdApp 主题变量同步（runtime 行为测试）

```gherkin
Given ConfigProvider 使用 darkAlgorithm 渲染 runtime AntdApp
Then document 出现 style#antd-theme-tokens
And 其内容含 --oo-colorBgContainer 且为暗色 RGB 通道值
And 亮色 algorithm 下同一变量为亮色值（变量随主题切换）
```

### US-3 宿主静态能力对齐

```gherkin
Given 宿主链渲染 runtime AntdApp
Then window.$message / $modal / $notification 已挂载（StaticAntd）
```

### US-4 宿主源码契约

```gherkin
Given shell src/host.tsx
Then 从 @oj-module/runtime 导入 AntdApp
And 不再从 antd 导入 App
```

## 4. 验证计划

- 先红：`tests/runtime/antd-app-css-vars.test.tsx`（US-2/3）+ `tests/shell/shell-antd-app.test.ts`（US-4）在修复前失败
- 实现后：上述转绿；P3.1 出口冻结测试补 `AntdApp` 断言；全量测试 + lint + typecheck
- 重建 shell-dist，playground-oj 起 dev 肉眼验证暗黑模式 footer

## 5. 问题记录

| # | 问题 | 分类 | 处置 |
|---|------|------|------|
| P1 | 亮色模式下变量缺失不可见（透明≈白），缺陷潜伏至暗黑模式才暴露 | 反常识 | 本修复；行为测试钉住变量值本身而非视觉 |
| P2 | 同一语义（`App` 包裹 + 变量同步 + 静态函数）存在 runtime 版与 antd 原生版两个 `App`，宿主选错 | 命名歧义 | F1 统一用 runtime 版；US-4 源码断言防回退 |

## 6. 总结

- 关键过程：从 footer 组件（自身无背景）沿引用链追到 `--oo-*` 变量唯一写入点 `components/antd-app` → 发现 shell `host.tsx` 用 antd 原生 `App` 替代 runtime `AntdApp`，宿主链从未写入变量（亮色下透明≈白不可见，暗黑暴露）→ 文档定案（F1–F3）→ TDD 先红（3 例：主入口导出、宿主源码契约×2）→ runtime 导出 `AntdApp` + host 换用 + cli stub 同步 + P3.1 冻结测试补断言 → 重建 shell-dist（host 包已引用 runtime 的 AntdApp）。
- 连带治愈：宿主链 `window.$message/$modal/$notification` 挂载（StaticAntd 随 AntdApp 进入宿主链），与上一阶段模板 `env.d.ts` 的 `$message` 声明闭环。
- 验证：`tests/runtime/antd-app-css-vars.test.tsx` 3 例 + `tests/shell/shell-antd-app.test.ts` 2 例绿；全量 91 文件 568 例过；lint 0 error；typecheck 0 error。
- 耗时：约 35 分钟（21:21–21:56）。
