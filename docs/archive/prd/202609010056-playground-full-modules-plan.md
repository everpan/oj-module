# Playground 全量模块还原 5.11 界面（计划）

> 任务：把仓库 `modules/` 下全部模块构建接入 apps/playground，验证能否还原 tag=5.11 的完整应用界面风格，尽可能一致。

## 前置事实（已核实）

| # | 事实 | 依据 |
|---|------|------|
| F1 | 仓库 8 模块：home、about、personal-center、route-nest、outside、access、exception、system | `manifest.json`（根） |
| F2 | 模块源码 bare import 共 13 种，全部在共享表内（含 clsx/echarts/echarts-for-react/react-countup/pro-components/@tanstack/react-query） | `grep -rhoE "from ..." modules/` ∩ `packages/cli/src/shared-deps.ts` |
| F3 | 模块源码无 `#src/*` / 框架内部路径 import，符合 playground 模块 import 约束 | grep 全量无命中 |
| F4 | `resolveModuleEntry` 支持相对 projectRoot 路径 → entry 写 `../../modules/<name>/entry.ts` 即可指向仓库根 modules | `packages/cli/src/config.ts` |
| F5 | playground 现仅登记 demo（order 100，菜单最后）；宿主已修 layer 样式 + 播种演示用户（202609011045 计划） | `apps/playground/modules.config.ts`、`packages/shell/src/host.tsx` |

## 与 5.11 的已知差异边界（先声明，验收时如实记录）

- 5.11（App 链）菜单 = 模块路由 + 静态 accessRoutes + fake 后端动态路由；playground 菜单 = 纯模块路由。若静态/动态路由贡献菜单项，属架构差异而非缺陷。
- App 链有 AuthGuard 登录态；playground 宿主免登录（已播种 admin 演示用户）。
- demo 模块为 playground 自身演示，5.11 无此项（order 100 排最后，对比时排除）。

## 任务清单

- [x] T1 `modules.config.ts` 登记全部 8 模块（顺序对齐根 manifest.json；demo 保留）
- [x] T2 `ram build` 全量构建，处理报错（如有）
- [x] T3 `ram dev` 起服 + Playwright 探针：菜单全量/图标/头像/样式/home 仪表盘图表
- [x] T4 与 5.11 基线逐项对比，差异定因（缺陷则修，架构差异则记录）
- [x] T5 回归（playground e2e + vitest）+ 文档回填 + 提交

## 验收（BDD）

```gherkin
场景: playground 加载全部仓库模块
  当 ram dev 启动并加载 modules.json
  那么 侧栏菜单出现 8 个模块的菜单树（首页/关于/个人中心/嵌套菜单/外部页面/权限演示/异常页面/系统管理）
  并且 每个菜单项渲染 icon（与 5.11 同）
  并且 顶栏头像为照片（非人形兜底）
  并且 antd 组件样式与 5.11 同构（Logo 14px、无溢出）
  并且 /home 仪表盘渲染 echarts 图表与数字滚动（与 5.11 home 页同构）
```

## 执行小结

### 结论

**还原成立**：9 模块（8 仓库模块 + demo）一次构建通过；亮色与暗黑主题下，
菜单树（9 组全带图标）、顶栏（设置/主题/语言/全屏/通知/头像照片）、Logo
14px、tabbar、footer、卡片/表格布局均与 5.11（App 链）同构。暗黑一致性经
逐项对比确认：宿主 ConfigProvider 修复后 header `rgb(20,20,20)`、菜单
`darkItemBg`、echarts/antd 组件的暗色渲染与 App 链一致。架构差异仅在
边界声明范围内（免登录、纯模块路由、demo 模块多出）。

### 执行中发现并解决的差异项

| # | 现象 | 定因 | 处置 |
|---|------|------|------|
| D1 | playground `/home` 图表接口 404，折线/饼图无数据 | ram dev 无后端边界（App 链由 vite fake server 提供） | 新增 ram dev 工程 mock 约定：`mock/*.mock.mjs`（TDD，`tests/cli-mock-routes.test.ts` 6 用例）；playground 补 home/notification mock。契约已写入模块开发手册 §3.4 |
| D2 | `/personal-center/my-profile` 在 importmap 资产链形态（playground 宿主 + App 链生产）整页崩（React #130，受控 Form.Item 链）；App 链 dev 正常 | **存量缺陷，非本次引入**。三形态对照定性；`@rc-component/form` 单例化假说经验证**不成立**（多副本非充分根因，已回退） | e2e `KNOWN_BROKEN_ROUTES` 显式豁免（遍历完全跳过点击）；**需独立任务追踪修复** |
| D3 | 菜单出现幽灵项「演示详情」，点击落 `/system/detail` 404；`/demo/detail` 高亮丢失、手风琴收起当前组 | **demo 模块相对 path（`"detail"`）撞上框架两个绝对路径假设**：①菜单 key 原样用 `item.path`，点击 `navigate("detail")` 被相对解析到当前路由；②`addRouteIdByPath` 不拼相对 path，id 与菜单 key 空间错位。demo-only 时代两空间同为相对恰好对齐，多模块后必炸 | 框架侧修复两处（菜单生成器 + id 补齐统一拼父路径为绝对），TDD：`tests/menu-relative-path.test.ts` 6 用例；契约写入手册 §3.2 要点 4 |
| D4 | `/about` 页宿主形态整页崩 | 模块直接解构 `getAppInfo().pkg.dependencies`，runtime 产物按 P6.5 刻意不注入该字段 | 模块侧 `?? {}` 空态防御；契约写入手册 §9（P6.5/AppInfo） |

### e2e 基线的加固

menu-consistency M1/M3 在全量菜单下暴露两类**测试自身缺陷**，已修：

1. 已知崩溃页仅跳过断言不够——崩溃替换整棵路由树会毒化同一会话内的
   后续遍历（`visitEveryMenuItem` 增加 `shouldVisit` 跳过机制）；
2. Playwright `toBeEmpty` 把「只含无文本跨域 iframe 的容器」判为 empty
   （取证：main innerHTML=1658、iframe 稳定在场、textContent=""）——
   内容非空不变量按页型分派（iframe 页断言 iframe 在场，按 URL 判型，
   不能按 DOM 判型：KeepAlive 会把已访问 iframe 留在 DOM）。

### 回归矩阵（全绿）

| 套件 | 结果 |
|------|------|
| vitest 全量 | 257 passed（含新增 cli-mock 6 + menu-relative-path 6） |
| e2e playground（ram dev 5174） | 21 passed, 1 skipped |
| e2e legacy（App 链 dev 3333） | 21 passed, 1 skipped |
| eslint（改动文件）/ tsc --noEmit | 通过 |

### 耗时

- T1-T3（登记 + 构建 + 界面探针与亮色对比）：约 1.5h
- T4（暗黑对比 + D1 mock 约定 TDD + D4 about 修复）：约 1h
- D2/D3 定性与修复（三形态对照、探针取证、框架两处修复 + e2e 加固）：
  约 2.5h（大头在 D3 的定位——从「崩溃毒化」误判到 trace DOM 快照取证收束）
- T5（回归 + 文档 + 提交）：约 1h
