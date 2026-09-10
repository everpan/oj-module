# 方案 A：App 链生产形态复用 shell importmap（计划）

> 前置：`docs/prd/202608312337-511-display-parity-plan.md` 已取证——App 链生产形态
> 自 5.11 起从未工作（缺 importmap），用户报告的「样式/头像/菜单图标不显示」即此
> 形态的病状。三方案（A 复用 shell / B manualChunks 自产 / C 退役）经用户拍板选 **A**。
> 分支：`fix/app-chain-importmap`（基点 main，含 display-parity 防护与 prod-smoke）。

## 目标（SMART）

- App 链生产构建（`pnpm build` → `build/`）在 preview 下可正常登录、显示菜单/头像/
  图标/样式——`scripts/prod-smoke.mjs` 由 known-red（exit 1）转绿（exit 0）。
- 主应用与模块产物命中同一份共享依赖实例（react/antd/runtime 单例，D5/D12）。
- 不改 dev 链与 shell 链任何行为；`tests/shared-deps.test.ts` 防漂移断言保持绿。

## 现状与设计对齐

- shell 链（已验证）：`packages/shell/scripts/build.mts` 以 SHARED_DEPS 单一来源
  生成 importmap + 全部共享资产（esbuild 单入口 ESM、显式转发防 A13/A22、require
  垫片防 A23、不动点扫描补子路径、导出门禁）。模块产物裸说明符 ⊆ shell 键集合
  由 P7.9 卡口（`packages/cli/src/build.ts:275`）保证。
- App 链（本次改造对象）：`pnpm build` = `vite build`（rolldown-vite 8，主应用
  全量 bundle）+ `scripts/build-modules.ts`（模块产物）。宿主侧 importmap 注入缺失。

## 改动设计

| # | 文件 | 改动 |
|---|------|------|
| 1 | `vite.config.ts` | `build.rolldownOptions.external = isSharedDep`（相对导入 `./packages/cli/src/shared-deps`，零新依赖声明）；删除 codeSplitting 的 react/antd 组（external 后死配置，faker 组保留） |
| 2 | `scripts/inject-importmap.mts`（新） | ① 检测 `packages/shell/dist/assets` 存在，缺失则报错指引 `pnpm --filter @react-antd-module/shell build`；② 从 shell `dist/index.html` 解析 importmap（真源，天然含不动点补全的全部深路径）；③ 值前缀改写 `/assets/` → `${base}assets/`（生产 base `/react-antd-admin/`）；④ 拷贝 shell assets → `build/assets/`；⑤ 注入 `<script type="importmap">` 至 `build/index.html` head 首位（须先于任何 module script）；⑥ 门禁：`collectUnresolvedSpecifiers` + `collectDynamicRequires`（复用 `@react-antd-module/cli/esm-exports`） |
| 3 | `package.json` | `build` 管线追加 `&& tsx scripts/inject-importmap.mts` |
| 4 | `scripts/prod-smoke.mjs` | 头部 KNOWN-RED 注释更新为常规防护语义 |
| 5 | `docs/prd/202608312337-511-display-parity-plan.md` | 「遗留决策」标注 A 已落地 |

纯函数（importmap 提取、base 改写）放 `scripts/inject-importmap.mts` 导出供测试。

## 测试设计（TDD/BDD）

**单测 `tests/prod-importmap.test.ts`**（先红后绿）：

```gherkin
Feature: App 链生产 importmap 注入
  Scenario: base 前缀改写
    Given map {"antd": "/assets/antd.js"}
    When rewriteImportmapBase(map, "/react-antd-admin/")
    Then {"antd": "/react-antd-admin/assets/antd.js"}
  Scenario: shell index.html 提取 importmap
    Given 含 <script type="importmap">{"imports":{…}}</script> 的 html
    When extractImportmap(html)
    Then 返回 imports 对象；无 importmap 时抛错
  Scenario: 拷贝资产缺失检测
    Given packages/shell/dist/assets 不存在
    When 运行注入
    Then exit 非零且输出 shell build 指引
```

**端到端验收**（绿性证明）：

1. `pnpm build && pnpm preview` → `node scripts/prod-smoke.mjs` exit 0
   （S1 无模块加载失败 / S2 header 渲染 / S3 菜单节点 > 0）
2. 主应用产物抽查：无内嵌 react/antd（体积骤降佐证）、保留裸说明符
3. 双环境 e2e 回归（dev 链不受影响，防误伤）

## 风险与验证点

| # | 风险 | 验证 |
|---|------|------|
| R1 | rolldown-vite external 与 resolve.alias 时序：`@react-antd-module/runtime` 可能被 alias 先解析为源码而非保留裸说明符 → 主应用内嵌一份 runtime，与模块的 runtime.js 双实例破坏 store 单例 | build 后 grep 产物确认裸说明符保留；冒烟登录态/菜单渲染侧面验证单例 |
| R2 | 主应用源码独有的深路径导入（shell 资产没有的）未被 importmap 覆盖 | 门禁 `collectUnresolvedSpecifiers` 抓出并 fail，逐条在 SHARED_DEPS 补登记 |
| R3 | external 后 CSS 裸说明符（如 `nprogress/nprogress.css`）解析 | shell importmap 已含 nprogress-css JS 垫片映射，冒烟覆盖 |
| R4 | 首次构建要求 shell assets 先在 | 注入脚本检测 + 指引；不做自动构建链（YAGNI） |

## 任务清单

- [x] T1 R1 时序验证：最小改动 external 后构建，检查产物裸说明符与体积
- [x] T2 单测先行（tests/prod-importmap.test.ts，红）
- [x] T3 scripts/inject-importmap.ts 实现（单测转绿）
- [x] T4 vite.config.ts external + build 管线接线
- [x] T5 端到端验收：build → preview → prod-smoke 转绿；门禁抓漏补登记
- [x] T6 双环境 e2e 回归 + lint/typecheck
- [x] T7 文档回填（本计划执行小结 + display-parity-plan 遗留决策标注）+ 提交

## 执行小结（2026-09-01）

**关键过程与两个计划外真发现：**

1. **R1 重新定性**：external 后主产物（324K，原数 MB）裸说明符全部保留，但
   `@react-antd-module/runtime` 消失——**不是 alias 时序问题**，而是架构形态：
   App 链入口就是 `packages/runtime/src/index.tsx`（bootstrap 源码本身），从无
   runtime 裸说明符 import。模块经 importmap 拿 runtime 会拿到 shell 的 lib 产物
   （`index.ts` 纯出口、无 bootstrap）→ 与宿主源码实例分裂（store/路由注册表）。
2. **runtime 单例桥**（本方案核心增量）：主应用构建加第二入口
   `input.runtime = packages/runtime/src/index.ts` + `preserveEntrySignatures:
   "exports-only"`，rolldown 生成「转发桥」entry chunk——导出面完整
   （getRoutes/loadAll/setupI18n/useAuthStore/…），实现体与宿主共享同一份实例。
   注入脚本把 importmap 的 runtime 键改指该 chunk。
   - 坑：先试 codeSplitting groups 切 runtime → chunk 导出被 tree-shake 全砍
     （rolldown 不知 importmap 消费者，导出零个），entry 签名保留才是正解。
3. **演示构建前置**：首次冒烟 S1/S2 已过但菜单 0——根因是 `/api/login` 404
   （P6.5 起 fake 默认不入生产包）。验收构建须 `VITE_ENABLE_FAKE_PROD=1`；
   prod-smoke 相应加 S0（登录失败不再被 S2 误绿）。
   注意 B15 门禁（产物无 fake）只对默认构建成立，两形态互斥是既有语义。

**验证结果：**

- prod-smoke：known-red 10 项 → **exit 0**（S0 登录/S1 无模块失败/S2 header/
  S3 菜单 7 节点）；视觉探针：菜单图标 6 svg、anticon 19、头像照片加载 ok、
  logo ok、无原始 key 文案；截图与 5.11 dev 基线肉眼同构。
- inject 门禁：116 键 importmap、裸说明符 0 未覆盖、动态 require 0 未垫、
  runtime 导出面防线（findRuntimeChunk）；注入幂等。
- 回归：vitest 245/245（含新增 9 项）；e2e 双环境 playground 22 passed /
  legacy 21 passed + 1 skipped（既有基线形态）；typecheck 干净；eslint 0 error。

**遗留**：shell assets 需先在（脚本检测 + 指引，未做自动构建链——YAGNI）；
runtime chunk 文件名带 hash，由注入脚本每次扫描解析，无稳定名需求。

**耗时**：external 验证与 R1 定性约 40 min，runtime 桥方案两轮实验约 30 min，
注入脚本 TDD 约 30 min，端到端验收（含 S0 发现）约 25 min，回归与文档约 25 min，
合计约 2.5 h。
