# 修复：关闭 tab 未真实关闭（幽灵 tab 回归）

- 日期：2026-10-23 18:38
- 分支：fix/tab-close-ghost-tab（基线 feat/ojm）
- 状态：已完成

## 需求

用户报告：template 中关闭 tab 标签，**被关 tab 未从 tab 栏消失**（幽灵 tab），
只是激活了前一个 tab。修复关闭当前激活 tab 的行为：tab 真实移除，回退 tab 激活。

## 根因（已完成 Phase 1 调查）

`packages/runtime/src/layout/layout-tabbar/index.tsx` 的「监听路由变化」effect
（约 180 行）依赖数组为 `[location, currentRoute, setActiveKey, addTab, activeKey]`。
其中 `activeKey` 是 commit `1e453baf`（"chore: pnpm lint 79 warnings 清零"）为消除
`react-hooks/exhaustive-deps` 警告**加进去的**（`git log -L` 实证）。

关闭激活 tab X（location=/x，回退 tab Y）后的事件流：

1. `removeTab(X)` → zustand set（sync lane）：openTabs 删 X、activeKey=Y。
2. effect#1（依赖仅 `[activeKey]`）：activeFullPath(/y) ≠ location(/x) → `navigate(/y)`。
   react-router 7.18 对导航 setState 包 `startTransition`（低优先级 lane）。
3. 同一次 commit 中「监听路由变化」effect 因 `activeKey` 入依赖也执行：
   location 仍是 /x ≠ Y → **setActiveKey(/x) + addTab(/x) 把 X 又加回来**（sync lane，
   抢占 transition）。
4. sync 更新先渲染：location=/x、activeKey=/x，effect#1 判定路径相等不再导航；
   此后 transition 落地 location=/y，activeKey 已被拉回 → 最终 **X 留在 openTabs，
   Y 处于激活态**——正是用户看到的"未真实关闭 + 激活前一个"。

即：lint 清零改动把"仅 location 变化时同步"的 effect 变成了"activeKey 变化也触发"，
与 effect#1 的兜底导航互相打架。**store 层（guardAndClose）逻辑无误**，
纯组件 effect 依赖回归。修法是恢复 1e453baf 之前的设计：依赖数组去掉 `activeKey`，
加带注释的 `eslint-disable-next-line react-hooks/exhaustive-deps`
（与 effect#1 同款处置，代码内已读 `activeKey` 仅作去重 guard）。

## BDD 用例（组件级 RED 测试）

文件：`tests/runtime/tabbar-close.test.tsx`（happy-dom + @testing-library/react）。

- **场景 1（本缺陷回归）**：given openTabs=[/home, /a, /b]、activeKey=/b、
  location=/b；when 点击 /b 的关闭按钮并等待导航落地；
  then openTabs **不含 /b**，activeKey=/a。
- **场景 2（保真）**：given 同上但激活 /b；when 关闭 /a（非激活）；
  then openTabs 不含 /a，activeKey 仍为 /b。
- **场景 3（首页保护保真）**：when 尝试关闭 /home；
  then /home 仍在 openTabs（既有 store 守卫，组件层不回归）。

场景 1 在当前代码下必红（/b 被 re-add 回来）；修复后转绿，场景 2/3 全程绿。

## 任务

- [x] 计划文档（本文）
- [x] RED：场景 1 红、2/3 绿
- [x] 修复：effect 依赖去掉 activeKey + disable 注释
- [x] 全量回归：pnpm test（830 绿）/ typecheck 0 error / lint 0 问题
- [x] 收尾（计划状态+问题记录+总结，合回 feat/ojm --no-ff，删分支）

## 问题记录

1. **反常规：lint 清零引入功能回归**。1e453baf 为消 `exhaustive-deps` 警告往
   effect 依赖加 `activeKey`，语义从"路由变化同步"变为"激活态变化也执行"，
   与兜底导航 effect 冲突产生幽灵 tab。教训：该警告在"有意依赖快照"的
   effect 上应走注释豁免，而不是补依赖。
2. **react-router 导航是 transition lane**：zustand 的同步 set 会抢占未落地的
   导航，两 effect 必须职责正交（一个管"路由→tab 同步"，一个管"tab→路由兜底"），
   不能互相触发。
3. **环境观察**：根 `pnpm typecheck`（tsc 默认堆）在本机 OOM（exit 134），
   `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` 通过（build 脚本同款
   堆配置）。非本次改动引入。
4. **测试基建两个坑**（已处置，写入测试注释）：react-router v7 的 `useMatches`
   要求 data router，组件路由的 MemoryRouter 直接抛错——须用
   `createMemoryRouter` + `RouterProvider`；antd Tabs 在 happy-dom 下渲染正常，
   关闭按钮为 `.ant-tabs-tab-remove`。

## 总结

- 状态：已完成（2026-10-23 19:00 收尾）。改动一处 effect 依赖数组（-1 token）
  + 新增组件级回归测试 `tests/runtime/tabbar-close.test.tsx`（3 用例）。
- 关键过程：Phase 1 读全关闭链路（store 无罪）→ `git log -L` 定位 1e453baf 的
  依赖回归 → react-router 7.18 源码确认导航走 startTransition → 按 lane 优先级
  推演复现"幽灵 tab" → RED（场景 1 红 2/3 绿）→ 移除依赖 + 注释豁免 → 全绿。
  全程约 25 分钟，其中测试基建排障（data router / 导入大小写）约 10 分钟。
- 教训沉淀：lint 清零提交触碰 effect 依赖务必跑组件级行为验证——
  exhaustive-deps 在"有意快照"场景应注释豁免而非补依赖。

## 后续：21 时许复报「仓内 template 仍现症状」的归因与 template 路径真浏览器复验

**复报归因（两因叠加，均非代码缺口）**：

1. **端口混淆（主因）**：5174 当时被 oj-wiki 的 dev server 占用（其锁
   `@oj-module/cli@0.2.25` 发布版=修复前代码；0.2.26 未发布，下游升不上来）。
   用户启动模板 dev 被顺延到 5175（其启动日志「端口 5174 已被占用，改用 5175」
   为证）；若浏览器访问 `localhost:5174`，实击 oj-wiki 旧版——症状（关激活 tab
   只激活前一个、再点一次才关）与幽灵回归完全吻合。**若地址栏是 5174，则 template
   侧从未被测到**。
2. **测量假象（复现脚本自身）**：初轮脚本用全局 `.ant-tabs-tab` 计数，把角色权限
   页面自带的内部 Tabs（角色/权限点）误计进 shell 页签栏，出现「5 页签/2 激活」
   假异常；选择器收紧到第一个 `.ant-tabs`（shell 页签栏）后消失。

**template 路径真浏览器复验**（清洁环境：仅模板 dev 一个服务占 5174；登录后经
「系统管理」子菜单点 用户管理/角色权限/操作日志 开 4 页签，点激活页签「操作日志」的 ×）：

- 浏览器实载 `/assets/runtime.js` 的响应体核验 = **修复版**（effect B 依赖数组无
  `activeKey`；宿主来自 CLI 内置 shell-dist，dev 期 hostRoots 钉死，本地 dist/web 只供模块）；
- 连跑 5 轮全部**立即关闭**（4→3 页签），回退激活「角色权限」，URL 跳 `/system/roles`，
  sessionStorage 精确剩 3 键；50ms 粒度采样无幽灵重加。

**结论**：修复对 template 路径（ojm dev + 模块客户端导航 + 页面内部 Tabs 并存）
确定性生效，无需新代码改动。

**附带发现（已处置/备案）**：

1. （已处置）`tests/e2e/fixtures/enter-template-app.ts` 的 `DB_PATH` 仍指旧布局
   `api/db.sqlite`，真库已随新布局搬到工程根（与 config.yaml 同级）——templates
   e2e 的 admin 夹具归一会静默打空；本次改为根 `db.sqlite` 并实跑验证。
2. （备案）`listenOnFreePort` 每次重试新注册 `once('error')` 却不摘旧的（监听器
   泄漏），需"成功监听后又发生 error 事件"才触发，暂无复现路径。
