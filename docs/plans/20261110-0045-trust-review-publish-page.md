# 信任审核落到发布管理页（round 2：审核入口可主动发现）

日期：2026-11-10 00:50 · 分支：`feat/ojm-trust-review-publish-page`（基线 `feat/ojm`，含 round 1）

## 需求（对 round 1 的修正）

round 1 把审核入口写成「superadmin 对同一方案点安装，在待信任确认弹窗通过」——**不对**：
方案首装未成功，让审核人去触发一次新安装才能审批是倒置的。正确形态：
**待确认指纹作为审核项出现在 superadmin 视图下的「方案市场 → 发布管理」页**，超管在
信任审核列表里直接点「确认指纹」。

## 方案

- 服务端：`GET /api/oj-market/trust/review`（superadmin）——`readTasks(taskDir)` 过滤
  `status === "needs_trust"` 且带 trust 三元组的任务，返回
  `{task_id, name, version, key_id, fingerprint, started_at}`（按 started_at 倒序）。
  审批动作复用现成 `POST /market/trust {task_id}`（混淆代理防线不动）。
- 客户端：`MarketClient` 增 `trustReview()`；defaultClient 委托生成 `__client`
  （契约 `.schema`/`.response` 挂在 api.ts，`ojm api` 重新生成）；内存 fake 同步。
- UI：发布管理页（`web/publish/pages/index.tsx`）凭证表下方新增「信任审核」区
  （新组件 `pages/trust-review.tsx`）：Table（方案/版本/发布方 key/指纹/操作）+ 行内
  「确认信任」按钮（点击即 `client.trust(task_id)`，成功后刷新列表）。
  可见性由服务端决定：GET 403 → 整个区不渲染（同凭证表 owner_tenant 先例，前端不判权）。
- 提示语更新（CLI renderOutcome/unknown_key hint、verify.ts message、failure-playbook）
  与 round 1 文档全部把「对同一方案点安装」口径改为「方案市场 → 发布管理 → 信任审核」。
  InstallDialog 弹窗确认能力保留（超管亲自安装时的等价快捷路径），locale 不动。

## 任务（TDD）

- [x] T1 测试先红：market-api.spec.ts `GET /market/trust/review` 两例（超管见三元组/done 被过滤
  倒序、非超管 403）；web 新 `TrustReviewSection.test.tsx` 两例（渲染+确认刷新、403 不渲染）
- [x] T2 服务端端点 + 契约声明 + `ojm api` 重生成 __client + 客户端三件套（types/client/defaultClient/fake）
- [x] T3 UI 组件 `trust-review.tsx` + 发布管理页接线 + 双语 locale（可见性 403 隐藏，服务端判权）
- [x] T4 提示语与文档口径修正为「方案市场 → 发布管理 → 信任审核」（代码 4 处 + 文档 9 份，
  devkit 镜像已重新同步）
- [x] T5 门禁全绿：根 1015 ✓ / templates 1219 ✓ / cli 678 ✓ / 契约漂移守卫 2 ✓ /
  eslint 0 / 根 tsc 0 / templates tsc 0

## 问题记录

- **反常识①**：模板 openapi.json 的权威再生命令是
  `oj openapi -c config.yaml --module-root src -b /api -o openapi.json`（cwd=templates）。
  不带 `-c config.yaml` 时扫描落到 dist 产物（x-oj-file 变成 `_platform-0.1.0/...api.js`，
  且 dist 未重建时新端点不进 openapi）。生成器输出 2 空格缩进，committed 文件经
  `eslint --fix`（tabs）——正确姿势是「生成 + eslint --fix」两步，缺一不可。
- **反常识②**：模板内 vitest（`packages/cli/templates/vitest.config.ts`）只收
  `tests/**/*.spec.ts`；web 组件测试（`src/**/__tests__/*.test.tsx`）归工程根 vitest 收。
- **发现③**：组件测试 render 辅助原本无 QueryClientProvider——既有组件测试不依赖
  react-query；信任审核区依赖，已在 render.tsx 补上（对既有测试零影响）。

## 总结

关键过程：round 1 交付后被需求方指正审核入口（「对同一方案点安装」倒置）→ 定界
「发布管理页信任审核区」→ TDD：服务端 `GET /market/trust/review`（复用 readTasks +
needs_trust 过滤）+ MarketClient.trustReview + 审核区组件（403 整区不渲染）→
openapi/client/routes.js 三重产物再生成（oj openapi → eslint --fix → ojm api → ojm build）
→ 代码与文档口径全面改「方案市场 → 发布管理 → 信任审核」。耗时约 30 分钟（0045–0145）。

未触达（有意裁剪）：InstallDialog 弹窗确认能力保留为超管亲自安装时的等价快捷路径；
`ojm trust confirm` 命令本体不动（运维旁路）；服务端审批动作零新增（复用
POST /market/trust {task_id}，混淆代理防线原样）；驳回/过期清理语义未做
（needs_trust 任务本就 TASK_KEEP=10 轮转过期）。

