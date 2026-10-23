# 修复：playground-e2e 满负荷偶发假红（重定向 vs keepalive 缓存竞态）

- 日期：2026-10-23 19:05
- 分支：fix/playground-e2e-flake（基线 feat/ojm）
- 状态：已完成

## 需求

`pnpm test` 全量下 `tests/playground/playground-e2e.test.tsx` 偶发失败
（单跑绿、满负荷 ~40% 红，失败耗时 18–23s 撞满 waitFor 15s 超时）。
消除该假红。

## 根因（Phase 1 调查）

失败断言：`切回 demo` 步骤 `expect(router.state.location.pathname).toBe("/demo")`。

demo 模块（apps/playground）的 /demo index 子路由是
`<Navigate replace to="/demo/todos">`（entry.ts 声明的直达重定向），且 todos 页
`keepAlive: true`。测试流程：首次 navigate("/demo") → 重定向到 /demo/todos、
页面进 keepalive 缓存 → 离开 → **二次** navigate("/demo")。此时两条路径都合法：

1. **缓存未命中路径**：落到 /demo → index 的 Navigate 生效 → 二次重定向到
   /demo/todos（pathname 终态 /demo/todos）；
2. **缓存命中路径**（happy-dom 不派发 transitionend，走 keepalive 兜底定时器）：
   直出缓存页、旁路 index 的 Navigate → pathname 停在 /demo。

原断言钉死 `/demo`，方向 1 先提交即假红；改为钉死 `/demo/todos` 后方向 2 即假红
（实测 4/5 红）。两个方向的出现比例随 CPU 负荷漂移——这就是"单跑绿、满负荷红、
失败时长 ≈ waitFor 超时"的完整机理。

**测试断言错了，不是产品错了**：「模块路由可切回并重新渲染」是本用例的验证目标，
两种 pathname 终态都满足它；页面内容（.ant-card + 模块加载成功文案）才是稳定
可锁的信号。

## 修复

断言改为终态集合：`["/demo", "/demo/todos"]` 包含 pathname，附注释说明两路径
成因。下方既有的 `.ant-card` 内容断言不动。

## 验证

- 修复前：全量 5 跑 4 红（含单跑隔离也红，钉 /demo/todos 后）。
- 修复后：单跑绿 + 全量 **6 连绿**（830 passed | 1 skipped × 6）。

## 问题记录

1. **反常识：假红方向会随断言而"翻转"**。同一竞态，断言 `/demo` 时红在"重定向
   先提交"，断言 `/demo/todos` 时红在"缓存命中旁路重定向"。排查此类 flake 时
   先确认断言钉的是不是竞态 transient 状态，而不是急着改产品代码。
2. **keepalive 缓存命中会旁路 index 路由的 `<Navigate>`**（happy-dom 下经
   兜底定时器路径可复现）。若真实浏览器也如此（缓存命中时直达父路由不重定向），
   属框架层行为疑点——本测试不覆盖该判定，留待 keepalive 层专项验证。
3. 每次全量跑约 40–60s；验证 flake 修复需要多连跑统计，不能单跑绿即收工。

## 总结

- 状态：已完成（2026-10-23 19:20 收尾）。改动 1 处断言 + 注释，无产品代码变更。
- 关键过程：复现捕获（循环全量跑到红并留完整日志）→ 失败 dump 的 title
  （待办列表 vs 演示模块）指向 index 重定向 → 读 entry 确认 Navigate 声明 →
  keepalive 缓存路径解释双向假红 → 断言收敛为终态集合 → 6 连绿验证。
  全程约 20 分钟，其中复现与统计约 12 分钟。
