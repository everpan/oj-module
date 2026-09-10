# e2e 图标/图片加载基线 + playground 图标缺失修复（计划）

> 背景：用户报告「playground 的图标未显示」。systematic-debugging 排查结论：布局图标
> （header/菜单/logo）实际正常，真正缺失的是 **①右上角头像空白** 与 **②favicon 全链缺失**。
> 本任务：修复两处根因，并为 e2e 增加图标/图片加载基线断言（I1-I3），防止架构变动后回归。

## 根因（Phase 1-3 已确认）

| # | 现象 | 根因 | 对照样板（正常链路） |
|---|------|------|----------------------|
| R1 | 右上角头像空白灰圈 | `store/user.ts` 初始 `avatar: ""`，`user-menu.tsx` 的 `<Avatar src={avatar}/>` 收到空字符串 → antd 6 判定 `src !== undefined` 走 img 分支渲染 `<img src="">` → 加载失败空白。App 链登录后 userInfo 填值无感；host 免登录链（playground/ram dev）恒空 | App 链登录态（legacy fake userInfo 返回 avatar URL） |
| R2 | 浏览器 tab 无图标 | `packages/shell/index.html` 模板无 `<link rel="icon">`；shell dist 与 `ram dev` 均无 favicon.ico | 根 `index.html:6` 引用 `/favicon.ico` + `public/favicon.ico`（App 链正常） |

## 修复方案（单点根因）

1. **R1**：`user-menu.tsx` 改 `<Avatar src={avatar || undefined} icon={<UserOutlined />} />`
   ——空串转 undefined 后 antd 6 走 icon 分支。实测仅 `|| undefined` 不够：antd 6 无 src
   且无 icon 时渲染空 `ant-avatar-string` span，视觉仍空白，须显式给默认人形图标。
   不改 store 初始值（空串是「无用户」的正确语义）。
2. **R2**：`packages/shell/index.html` 加 `<link rel="icon" href="/favicon.ico" />`（与根
   index.html 一致）；`scripts/build.mts` 把根 `public/favicon.ico` 拷入 shell dist 根；
   `packages/cli/src/dev.ts` 加「shell dist 内静态文件兜底」分支（resolve 后存在即服务，
   favicon/logo 等未来资源通用），置于 SPA fallback 之前、404 之前。

## e2e 用例（`e2e/layout/icons.spec.ts`，TDD：先写先红）

| # | 断言 | 数据驱动要点 |
|---|------|--------------|
| I1 | 图标渲染：header 内 ≥3 个 `.anticon` 且均含 `<svg>`；`.ant-menu-root` 内存在图标（`.anticon`） | 不写死图标名/数量上限 |
| I2 | 图片加载：不存在 `img[src=""]`/`img:not([src])`（R1 缺陷探针）；header 内 logo img（`img[alt="logo"]`）`naturalWidth>0`；外链 img 仅要求有 src（网络无关——legacy 假数据 avatar 是外网 URL，CI 无网不得假红） | 锚定 `img[alt="logo"]`，不依赖头像 URL |
| I3 | favicon：`link[rel~=icon]` 存在且 fetch 其 href 返回 2xx、`content-type` 为 `image/*` | href 取运行时 DOM |

## 验证

- `pnpm test:e2e`（playground 17+3 用例）与 `pnpm test:e2e:legacy` 全绿（I1-I3 双环境）；
- `pnpm test`（vitest 233）、`pnpm typecheck` 全绿；
- 重建 shell 后 `dist/index.html` 含 favicon link、`dist/favicon.ico` 存在。

## 遗留/边界

- 外网头像 URL 的实际加载成功不作 e2e 断言（网络依赖噪音），仅断言有 src。
- antd Avatar 空串行为若未来升级变化，I2 的 `img[src=""]` 探针会率先暴露。
- 仓库存量 lint 债务（约 39 error：catalog 声明、runtime/modules 多文件 style 规则）
  未在本任务处理，仅收敛了本分支触碰文件的 error（lint-staged 门禁可过）。

## 执行小结（2026-08-31）

- **流程**：建分支 `fix/e2e-icon-image-loading` → 计划文档 → TDD（icons.spec.ts
  先红：I2 空 img、I3 favicon 404；后绿）→ 三处修复（R1 user-menu、R2
  shell/index.html + build.mts + dev.ts）→ 重建 shell → 回归。
- **耗时**：根因定位与计划约 30 min；TDD 红绿循环约 20 min；修复+重建约 15 min；
  回归与 lint 收敛约 25 min；合计约 1.5 h。
- **关键过程**：
  - R1 首版修复不彻底——`src={avatar || undefined}` 消掉了空 img，但 antd 6 无 icon
    时渲染空 span，截图验证暴露后补 `icon={<UserOutlined />}`（已回写上方方案）。
  - lint 回归暴露 build.mts 存量 error（pre-commit 未覆盖的历史）：`eslint --fix` 的
    indent-binary-ops 修复在 tab 项目里产生 tab/空格混合（与 no-mixed 规则互相打架，
    fix 不收敛），改用「数组 join」重写三处 shim 拼接（输出字节等价）并手改
    `no-cond-assign` 的 while 为 for；shell 全量重建过导出完整性门禁（62 资产 0 缺失），
    playground e2e 复跑确认产物等价。
- **验证结果**：playground 全套 e2e 20/20、legacy icons 3/3（双环境 I1-I3 绿）、
  vitest 233/233、typecheck 0 错、改动文件 eslint 0 error（余 1 个既有 warning）。
