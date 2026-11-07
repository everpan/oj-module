# 市场方案默认安装（出厂即装，发布途径升级）设计

> 日期：2026-11-07　状态：已实施（T1–T5/T7 全绿，真机验收通过）　分支：`feat/market-factory-install`

## 1. 需求与背景（用户原话）

> feat: 改变策略，市场方案默认安装好，后期可以通过发布途径升级

**现状策略（Phase B T3，出厂未装）**：脚手架 init 只把随站 bundle 落位 `cdn/` + 写 `bundles.json` 意图标记，
市场 UI 保持「出厂未装」；superadmin 首次打开方案安装页/市场页时，经 index 端点 riding 收敛
（对账即服务）完成首装；失败有 10 分钟冷却；卸载有墓碑防漂移重装。

**2026-11-07 实锤缺陷链**（/tmp/ojm-vv/drill 用户实验工程，dev 形态）：

1. dev 形态（`platform.root: src`）下没有 `dist/api/versions.json`（release 构建双落点产物），
   安装预检 C2-09 fail-closed → 随站 bundle 收敛**永久拒装**（任务记录：`无法读取宿主 runtime 版本`）。
2. 目录（market_release）与 sidecar（state.yaml）双空 → 市场页/方案安装页显示「出厂未装态」。
3. 用户按页面指引执行 `pnpm ojm init ./ --yes`：cdn 落位本身成功，但 riding 收敛依旧 C2-09 失败——
   「无法补充安装包」。页面指引在 dev 形态下是死路。

**新策略**：随站第一方方案（当前即 oj-market）**默认安装好**——开箱即用、零首装仪式；
后续版本经发布途径（cdn/upload → market_release 新行）分发，站点按既有市场轨升级
（index 的 upgradable 位 + 升级安装路径，机制已存在不动）。

## 2. 设计支柱

### 支柱一：dev 形态补 C2-09 真源（versions.json）

- `ojm dev` 启动构建本地模块后，把内置宿主 `shell-dist/versions.json` 拷入
  `dist/api/versions.json`（与 release 双落点同源的第三落点；dev 形态 sharedRoot 仍解析
  `dist/api`，安装器读取路径不变）。
- 不改变 C2-09 fail-closed 语义——只是让 dev 形态的真源存在。

### 支柱二：重建合并已装方案登记（U5 根治）

- **dev**：本地模块清单生成时，从 `modules/.solutions/state.yaml` 读已装方案，其 web 面
  （`dist/web/modules/<name>/<ver>/` 仍在盘）重建 modules.json 条目并入清单
  （entry 路径按布局推导、integrity 对 entry.js 重算、css 扫描、enabled 随 sidecar）。
- **release**：`site-merge` 整树擦除后，从版本目录（`dist/api/<name>-<ver>/`，web-only 包
  = 整包含 web/ 树）把 web 面重新物化到 `dist/web/modules/`，再并入清单。
- 源码树模块与已装方案**同名冲突**时 fail-fast（双轨同名红线，沿用既有裁决），不静默覆盖。

### 支柱三：出厂安装时机（收敛不再只靠首个页面请求）

- oj-market api 模块加载后 **boot 看门狗外延迟触发**一次随站 bundle 收敛
  （setTimeout 延迟 ≥ 看门狗窗口；幂等，已对齐即全 skip），dev/release 两形态一致。
- 「对账即服务」（index 请求 riding 收敛）保留——自检与升级对账时点不变。
- 出厂未装态 UI 降级为兜底文案（收敛失败时仍可见、可手动重试），不再是常态路径。

## 3. 非目标（明确不做）

- 不改 C2-09/C2-11 fail-closed 语义；不改验签/信任状态机；不改墓碑与冷却机制。
- 不改升级路径（发布 → 目录新行 → upgradable → 升级安装）——新策略的「后期升级」即此。
- 不把 oj-market web 面并入源码树内置模块（破坏签名/升级故事）。
- init 期 CLI 侧直装（DB 注册面在 init 时不存在，注册态经运行期收敛完成——支柱三）。

## 4. BDD 验收（数据表）

| # | 场景 | 给定 | 当 | 那么 |
|---|------|------|----|------|
| A1 | dev 形态 C2-09 真源 | 全新 init 工程，`platform.root: src`，从未 build | `pnpm dev` 就绪后触发 bundle 收敛 | 安装成功；`dist/api/versions.json` 存在且含 `@oj-module/runtime` 键 |
| A2 | release 形态回归 | 既有 release 工程（双落点已有 versions.json） | 触发收敛 | 行为与现状一致（不回归） |
| B1 | dev 重建不丢登记 | 已装 oj-market 的 dev 工程 | 重启 `pnpm dev`（重建 modules.json） | 市场菜单仍在；modules.json 含 oj-market 条目；state.yaml 不变 |
| B2 | release 重建不丢登记 | 已装 oj-market 的 release 工程 | `pnpm build`（site-merge 擦除后） | dist/web 重建后市场菜单仍在（面从版本目录重物化） |
| B3 | 同名冲突 fail-fast | 源码树模块与已装方案同名 | 重建合并 | 构建失败并报双轨同名（不静默覆盖） |
| C1 | 出厂即装 | 全新 init --yes 工程 | 首次启动（dev 或 release）后数秒内 | 无需打开任何页面：oj-market 已装（state.yaml 有行、菜单可见） |
| C2 | 升级路径不变 | 出厂已装 0.2.0，发布 0.3.0 上传目录 | index 对账 | upgradable=true；升级安装后版本切换、菜单不丢 |
| C3 | 出厂未装态兜底 | 收敛失败（如包损坏） | 打开方案安装页 | 仍显示出厂未装态文案 + 重试指引（冷却观测不变） |

## 5. 任务分解

1. **T1 支柱一**：`ojm dev` 物化 `dist/api/versions.json`（TDD：dev 启动产物断言）。
2. **T2 支柱二（dev 半）**：module-build 清单生成并入 sidecar 已装方案（TDD 纯函数 + 集成）。
3. **T3 支柱二（release 半）**：site-merge 后从版本目录重物化 web 面 + 并清单（TDD）。
4. **T4 支柱三**：oj-market api 模块 boot 后延迟收敛触发（TDD：假时钟断言延迟与幂等）。
5. **T5 真机演练**：/tmp/ojm-vv/drill 全新工程全链验收（A1/B1/C1 + 发布升级 C2），
   结果回填 playbook §7 与本设计「实锤记录」。
6. **T6 文档**：playbook §7.7 策略变更、devkit 速查同步；计划任务状态 + 总结。
7. **T7 退役 superadmin 安装页**（用户追加指令，2026-11-07）：出厂即装后
   `/system/solutions` 首装入口失去存在意义——页面、路由、菜单 i18n、market-entry
   纯推导层与其测试整建制退役；「出厂未装态」文案随之退役（收敛失败兜底由
   市场页自身状态位承载）。安装/升级端点（install/task/index）不动——市场页
   自身的安装/升级按钮消费它们。

## 6. 风险与裁决记录

- **延迟收敛与 2s boot 看门狗**：延迟必须落在看门狗之外；若 oj isolate 的 setTimeout 在
  boot 期被冻结，回退方案 = `ojm dev`/`ojm build` CLI 侧在后端就绪后触发一次收敛
  （需超管令牌，复杂度上移——真机演练 T5 先行验证延迟方案）。
- **release 擦除后面重物化的完整性**：版本目录缺 web 树（api-only 包）时跳过该方案并
  记警告（不 fail——属正常形态）。
- **既有「出厂未装」文档口径**（publish-walkthrough §6/§7、playbook §7.7、manual §11.3）
  随 T5/T6 统一改写为「出厂即装」。

## 7. 实锤记录（演练后回填）

**T5 真机演练（2026-11-07，/tmp/ojm-vv/drill，全新 init --yes 工程，全绿）**：

| 验收项 | 结果 |
|---|---|
| A1 dev 形态 C2-09 真源 | ✓ `pnpm dev` 后 `dist/api/versions.json` 在位（@oj-module/runtime=0.2.71），出厂对账触发成功 |
| C1 出厂即装 | ✓ 无需打开任何页面：state.yaml 落 oj-market@0.2.0（trust_state: trusted，platform.release 验签通过，免 TOFU）；modules.json 并入；index 可见 |
| B1 dev 重启 | ✓ 重建清单后 oj-market 登记仍在，收敛幂等 |
| B2 release 重建 | ✓ `pnpm build` 从版本目录重物化 web 面并并入（演练中抓并修两缺陷：① 版本目录重物化不带旁车 → 最小条目降级重建；② 旁车须持久化进版本目录根 + 重物化时随行，否则每次 build 重复降级） |
| preview | ✓ SPA 200、face 200、index installed=0.2.0、出厂对账触发 |
| C2 升级路径 | 机制未动（市场轨 upgradable + 升级安装），由单测/集成与此前演练覆盖；本次未重跑发布升级全链（声明 skipped） |

**任务状态（2026-11-07 收尾）**：T1–T5、T7 完成；T6 本文档 + playbook §7.6 策略注记 +
devkit 两文档同步完成。关键过程：设计 1h → T1 30min → T2/T3 1.5h（含两轮真机抓缺陷）
→ T4 1h（setTimeout 不可行走 CLI 触发路线）→ T7 30min → T5 演练 1.5h → T6 30min。

**总结**：本阶段把市场策略从「出厂未装 + 首装仪式」翻转为「出厂即装 + 发布升级」。
三个真机缺陷最有价值：dev 形态 C2-09 死路（用户报告牵引）、build/dev 冲掉已装方案
的根治、服务端无定时器导致的触发路线裁决。superadmin 安装页随策略退役，退役钉
防复活。

**T6 补记（2026-11-07 第二轮，用户要求「系统性改写而非只加横幅」）**：playbook 与
docs/devkit 全部「出厂未装」旧口径逐处改写——playbook：先选一条线表 Phase B 行、§1
检查点 oj-market 形态、§7.6 第二段引文（首个编排请求 riding 收敛 + 「方案安装」页
入口两处过期指引）、A 节整节翻为「出厂即装态核对」（modules.json 含 oj-market 断言
反转 + state.yaml 在位）、B 节改名「收敛路径验证」并加新定位注记（主路径已自动触发，
本节 = 纯 oj serve 形态/愈合/手工触发；needs_trust 子路径收窄为 BOOTSTRAP_KEY 被吊销
或旧工程场景）、C 节墓碑注释入口改市场页/`ojm install`、§8 汇总判据反转、§11 症状表
与 U5 行翻为「已修复（0.2.72 支柱②）」；文首「上次演练结论（第一轮）」与 §9 历史行
保留为史料，仅加「首装期口径」指引注记。devkit：manual §11.3 运维口径整段重写
（触发时点/三前提/重装入口），publish-walkthrough §6 注释、§7 速查两行（build 冲菜单、
bundle 装不上）、§7.5 尾段同步。守卫 `tests/cli/devkit-docs.test.ts` 21 例零代号通过。
耗时 ~25min。
