# Playground 形态显示差异调查与修复（计划）

> 用户报告：apps/playground 未见头像/菜单图标、样式与 tag=5.11 差异大。逐项取证定因。

## 差异项定因（取证证据）

| # | 病状 | 定性 | 根因 |
|---|------|------|------|
| 1 | 侧栏 Logo/标题巨大溢出（38px、裁切截断、logo 挤压） | **缺陷** | shell host 的 `<StyleProvider hashPriority="high">` 未开 `layer`：antd 规则 UNLAYERED，`h1.css-viwxw0.ant-typography → var(--ant-font-size-heading-1)`（38px，特异性 0,2,1）压过 tailwind `text-sm`（0,1,0）。App 链 `app.tsx:110 <StyleProvider layer>` 样式入 `@layer antd`（低优先级）→ tailwind 覆盖生效 → 14px。CDP getMatchedStylesForNode 双形态对比 + layer 归属遍历实锤 |
| 2 | 菜单图标缺失（仅首项有） | 配置使然 | `apps/playground/modules/demo/entry.ts` 子路由（detail/about）未声明 `handle.icon`；父路由 icon 正常渲染 |
| 3 | 头像为 UserIcon 人形兜底（非照片） | **已修复** | shell host 免登录设计（无 AuthGuard），`useUserStore` 恒空 → avatar 空兜底。修复：host.tsx 播种演示用户（与 App 链 fake 数据一致：Admin/照片 URL/roles），保持两链显示同构 |
| 4 | 菜单仅 demo 模块 3 项 | 设计使然 | `modules.config.ts` 仅登记 demo 模块（外部模块工程模拟） |
| 5 | `/api/notifications` 404 | 已知噪音 | ram dev 无 fake API；通知组件已有 `Array.isArray` 守卫不崩（E2E_VERIFICATION.md 缺陷 4） |

## 修复设计

| # | 文件 | 改动 |
|---|------|------|
| 1 | `packages/shell/src/host.tsx` | `<StyleProvider hashPriority="high">` → `<StyleProvider layer hashPriority="high">`（与 App 链 antd 样式层策略对齐；最小 diff 不动 hashPriority） |
| 2 | `apps/playground/modules/demo/entry.ts` | 子路由 detail/about 补 `handle.icon`（演示完整性） |

风险：antd 样式进入 layer 后与模块 CSS layer 顺序（A19/R16：模块 CSS 必含 theme 层）
交互变化 → 重建 shell 后跑 playground e2e 全量回归 + 截图对比。

## 任务清单

- [x] T1 五病状取证定因（CDP 命中规则/layer 归属/变量值对照）
- [x] T2 host.tsx 加 layer + 重建 shell + ram dev 探针复验（38px → 14px）
- [x] T3 demo 模块子路由补 icon
- [x] T4 e2e 双环境回归 + lint
- [x] T5 文档回填 + 提交

## 执行小结（2026-09-01）

**取证路径**：探针采集（几何/字体/图标/头像）→ 排除 shell 产物过期假说（mtime/git
同步）→ H1 class 疑缺 → 完整 class 证伪（此前 slice 截断误导）→ CDP
getMatchedStylesForNode 拿两形态真实命中规则 → 规则集同构、变量值相同（38px）
但 computed 不同 → 遍历 CSSOM layer 归属定案：**App 链 antd 规则入 `@layer antd`，
playground 宿主形态 UNLAYERED**。变量探针（.text-sm 生效于新元素却不生效于 H1）
是打破「特异性」常规推理的关键一步。

**修复验证**：`<StyleProvider layer hashPriority="high">`（host.tsx 一词改动）+
重建 shell → ram dev 复验：H1 38px→**14px**（宽度 121px 与 main dev 同值）、
菜单图标 1→3（demo 子路由补 icon）、布局截图与 App 链形态肉眼同构。
追加：host.tsx 播种演示用户 → playground 头像照片显示（差异项 3 闭环）。

**回归**：playground e2e 22 passed / legacy 21 passed + 1 skipped；vitest
245/245；typecheck 干净。

**耗时**：取证与根因定位约 50 min（含两次假说修正），修复与验证约 25 min，
回归与文档约 20 min，合计约 1.6 h。
