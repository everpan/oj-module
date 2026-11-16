# 预构建 web 资产模块化——上游需求三视角评估与落地方案

- 日期：2026-11-16
- 来源：上游提案「ojm / oj 上游需求提案：预构建 web 资产模块化（P1–P11 + 运维三项）」；
  关联设计 `docs/superpowers/specs/2026-11-16-native-app-modules-design.md`（**尚未创建**，本方案先于设计）。
- 状态：**方案（Q1/Q6/Q7/Q8 已拍板，Q2/Q3/Q4/Q5/Q9/Q10/Q11 待确认）**。三视角（架构师 /
  工程师 / 体验工程师）独立取证评估后汇编。**P4b 已落地（0.2.93）**：壳持稳定挂载点 +
  `ctx.register.portalContainer()` + container-layout 接入 + 回归测试；其余项仍为方案，未改实现。
- **拍板记录（2026-11-16）**：Q1=①新增 `web.peers`；Q6=②容器级注入+禁写 `:root`；
  Q7=①portal 由壳持挂载点；Q8=`onUnauthorized({status,url,cause})`+`getToken()`，过渡契约取 (b)——
  genoffice 直消 `getToken()`、**跳过 `oj_token`**（Q1/Q6/Q8 依据详见 §二·补）。
- 治理立场（继承提案）：预构建是**构建方式的例外，不是治理的例外**——prebuilt 产物必须进与源码产物
  同等的契约 / 版本 / 供应链约束体系，不做二等公民。

## 〇、结论先行

三方一致结论：**14 项中 2 项已落地（P9 完整、P11 部分）、12 项待办；待办建议全做，但分 4 批 + 2 项独立评审。**
下表「实现方」列：CLI=本仓 `packages/cli`，模板=本仓 `packages/cli/templates`，runtime=本仓 `packages/runtime`，
契约=文档，genoffice=外部渲染器仓（本仓只给契约/API，消费侧不改）。

| 项 | 三方裁决 | 优先级 | 实现方 | 一句话依据 |
|---|---|---|---|---|
| P1 产物自备+资产目录 | 做 | **门禁/P0** | 契约+CLI(build/bundle)+模板(install) | 三条抹除路径属实；挂点在 `await build()` 之后 |
| P2 css 递归 | 做 | **门禁/P0** | CLI+模板+runtime | 三处顶层扫描属实；module-build 那处实为**新增**磁盘扫描 |
| P3 externals 校验 | 做 | **P0** | CLI+契约 | prebuilt 说明符面零校验；prebuilt 无构建期→校验放安装期 |
| P4a 主题命名空间 | 做（加固） | 高 | 契约+runtime+genoffice | 仅命名空间解决一半，须容器级注入 |
| P4b 弹层 portal | **已实现（0.2.93）** | 高 | runtime（壳侧已完成）+genoffice（消费待迁） | 壳持稳定挂载点+独立 z-index 栈 |
| P5 认证对接 | 做 | **门禁** | runtime+契约+genoffice | 401 裸 404 白屏+token 快照永久过期 |
| P6 tab 按路由关 | 做 | 中 | runtime+契约 | 小改动；复用 `useCurrentRoute()` 读最深 handle |
| P7a layout 文档化 | 做 | 中 | 契约 | 叶子 layout 被静默忽略，文档止重复踩坑 |
| P7b redirect 死字段 | **删**（三方一致） | 中 | runtime | 零消费+react-router 原生 Navigate 已覆盖 |
| P8 高度契约 | 做 | **门禁** | runtime+契约+genoffice | 壳已有变量，别名暴露即可 |
| P9 出厂重签 | **已落地** | — | 仅回归守卫 | prepack 闸门+`.sig` 已 v2+回归测试 |
| P10 converge 首装 | 做（1 行） | **P0** | 模板 | 鸡生蛋属实；端点补 `runBundleConverge` |
| P11 build 一致性 | **部分落地，补残口** | P1 | CLI | 构建侧已补，**收敛反馈+完整性残口仍在** |
| O1 preview 密钥指引 | 做 | 低 | CLI | 非致命横幅即可 |
| O2 bundle 完整性对账 | 做（依赖 P1） | P0 | CLI+模板 | 逐文件哈希须先有 P1 的 SRI 清单作基准 |
| O3 migrate 防逃逸 | 做（需拍板旗标） | 中 | CLI | `-c` 已补；`--module-root` 与 preview 的 `-d` 互斥待定 |

**与上一轮口头评估的更正（诚实账）**：上一轮我说「P11 已实现、无需再做」——**不准确**。
经架构视角复核：`module-build.ts:416-417` 确已调 `restoreInstalledFaces`+`mergeInstalledModules`（构建侧已补），
但 **P11 提案的「state 记已装 → 收敛 plan=skip 不补装」残口仍在**：`bundle-converge.ts:123-126` 仅按
`state.yaml` 版本判 skip、不看 face 是否在盘；`installed-merge.ts:190` 遇 face 缺失仅告警、无重装闭环；
降级重建丢 integrity（`installed-merge.ts:75-76,90`）、`chunks` 恒空（`deploy-web.ts:185`）。
**以本方案「部分落地+补残口」为准。**

## 一、证据核实总表（基于 HEAD 84296806b / CLI·runtime 0.2.92）

| 项 | 关键证据（本次 grep/读码所得） |
|---|---|
| 全仓空白 | `grep -r 'prebuilt\|web.assets\|web.externals\|web.peers' packages/cli/src` = **0 命中** → P1/P3 完全空白 |
| P1 抹除路径 | `module-build.ts:296-297` emptyOutDir；`site-merge.ts:20` 整树 rmSync；`dev.ts:327` watch 重跑同一函数 |
| P1 打包只核 entry | `bundle.ts:348`（C2-27 仅复核 entry） |
| P2 顶层扫描 | `installed-merge.ts:87`、`deploy-web.ts:172`；测试 `deploy-smoke.spec.ts:283` 明注「assets/ 子目录不扫」；`module-build.ts:365` css 来自 Vite `emitted`（**无 readdir**） |
| P3 外部化只源码路 | `module-build.ts:327` external + `:397` assertResolvableSpecifiers；`shared-deps.ts:42-178` SHARED_DEPS |
| P4a 主题挂 documentElement | `setup-antd-theme.ts:14`（`--oo-*` 写 `:root`）、`layout-effects/index.tsx:57-64`（`html.dark`） |
| P4b 无 portal 能力 | `module-loader/types.ts:27-54` 的 `ctx.register` 无 portal；壳 overlay z-index=150 `use-layout-style/index.ts:36`、View Transition=999999999 `theme-button.tsx:24-29` |
| P5 token/401 | refresh 只写 zustand（`utils/request/refresh.ts:29`，persist `store/auth.ts:98`），**全仓无 `oj_token` 写入**；裸文案 `error-response.ts:45-46`；仓库无 `/login.html`，SPA 登录路由 `go-login.ts:12-16` |
| P6 tab | `types.ts:16-116` 无 `tab`；`layout-tabbar/index.tsx:180-202` 无条件 addTab；`use-current-route/index.ts:10-16` 已取最深 match |
| P7 layout | `resolve-layout.ts` 末段 `resolveRouteLayouts` 只包「无 Component 且有 children」的父级 |
| P7 redirect | `types.ts:5,9` 声明；runtime 全仓 grep `redirect` 命中均为 `?redirect=` 查询参（`auth-guard.tsx:257`/`get-redirect-path.ts`），无路由级消费 |
| P8 高度 | 壳**已有** `--react-antd-admin-content-height`（`constants.ts:42`），ResizeObserver 取 `<main>` 可见高写 `body`（`use-layout-style/index.ts:42-46`），`<main>` 自滚动（`layout-content/index.tsx:30,43-45`） |
| P9 已落地 | `sign.ts:10` CANON v2；`sync-bundles.mjs:100-121` prepack 拒非 v2 且 exit 1；`sync-bundles.test.ts:4` 回归；`init.ts:306` 从 `shell-dist/bundles` 取包，sig 实为 v2+registry_id |
| P10 鸡生蛋 | `factory-converge.ts:34` 只 POST converge；`api.ts:1065` converge 仅 `reconcileOf`；`runBundleConverge` 只在 `api.ts:708` GET index |
| P11 | 构建侧 `module-build.ts:416-417`（已补）；收敛残口 `bundle-converge.ts:123-126`、`installed-merge.ts:190`；丢 integrity `installed-merge.ts:75-76,90`；chunks 空 `deploy-web.ts:185` |
| O1 | `preview.ts:70-78` 四查无密钥项；密封逻辑 `init.ts:349/365`（`ENC[` 前缀判定） |
| O2 | `deploy-web.ts:156` 整树 copyTree 无逐文件哈希；integrity 只算 entry `installer.ts:386`；smoke 仅 entry+css 存在性 `smoke.ts:182-199` |
| O3 | `runOjSubcommand`（`oj-cmd.ts:24-46`）只补 `-c`；`preview.ts:92` 传 `oj migrate -c … -d apiDist` |

## 二、需先拍板的关键分歧（不拍板不开工）

| # | 分歧 | 选项 | 建议 |
|---|---|---|---|
| Q1 ✅已拍板 | P1 钉版声明 | ① 新增 `web.peers` ② 复用顶层四 peer 键 | **拍板=①新增 `web.peers`**（依据 §二·补 A：顶层四键是平台版本轴，与共享依赖矩阵正交；复用会逼作者把 React 塞进安装期不比对的 `peerFramework`，等于门禁失效） |
| Q2 | P1 SRI 算法 | ① sha384（现 chunks 口径 `module-build.ts:75`）② 标准 SRI sha256 | **①**，与现网一致 |
| Q3 | P11 残口范围 | ① 只补收敛反馈（face 缺失→重装）② 连 integrity/chunks 丢失一起补 | **②**，否则 SRI 仍缺基准 |
| Q4 | P7b redirect | ① 删字段 ② 实现 Navigate+Outlet | **①**（三方一致） |
| Q5 | P10 首装触发 | ① converge 端点加 1 行 ② CLI 改走 GET index | **①**（与 index 同序：先收敛后对账） |
| Q6 ✅已拍板 | P4a 主题 | ① 仅 `data-<module>-theme` 命名空间 ② 容器级注入+禁写 `:root` | **拍板=②容器级注入+禁写 `:root`**（依据 §二·补 B：主题真源挂 documentElement，命名空间挡不住 CSS 变量继承/全局 `.dark`） |
| Q7 ✅已拍板 | P4b portal | ① 壳持挂载点 ② 模块自带 | **拍板=①壳持挂载点**（模块自带脱离 antd App context 且仍互盖；壳提供 `<div data-oj-portal>` + 独立 z-index 栈） |
| Q8 ✅已拍板 | P5 回调签名 + 过渡契约 | `onUnauthorized({status,url,cause:'401'\|'refresh-failed'})` 否；过渡 (a) 壳镜像写 `oj_token` / (b) genoffice 直消 `getToken()` | **拍板=采用该签名 + 过渡取 (b) 跳过 `oj_token`**（依据 §二·补 C：本仓从不写 `oj_token`，(a) 会引入双写漂移，(b) 对称复用已有 `authProvider` 注入先例） |
| Q9 | P8 变量语义 | ① 别名暴露既有变量为 `--oj-content-height` ② 新名并存 | **①**，净内容高（不含 header/tabbar/footer），滚动归壳单一所有 |
| Q10 | O2 逐文件哈希时机 | ① 安装期同步 ② 后台校验（避 oj 2s boot 看门狗） | **②**，60MB 同步哈希会撞启动看门狗 |
| Q11 | O3 旗标 | ① `--module-root` 换掉 preview 的 `-d` ② 仅透传命令补、preview 另议 | **②**（`-c` 与 `-d` 可共存，`-d` 与 `--module-root` 互斥，需分别处理） |

## 二·补、Q1 / Q6 / Q8 决策依据详解（2026-11-16 三视角评估后补；三项均已拍板）

### A. Q1 ✅拍板=①新增 web.peers——P1 钉版声明：为什么选「新增 web.peers」而非「复用顶层 peer 键」

**更正**：本方案上一版此格建议「②复用顶层四 peer 键，避免双轨」。经代码取证，**该建议错误**，
正确为「①新增 `web.peers`」。错因：把两条**语义正交**的版本轴误判成同一语义的双轨。

证据：
- 顶层四键 = `peerRuntime`/`peerOj`/`peerFramework`/`peerPlatform`（`manifest-contract.ts:93-96`），
  安装期只有 **2 个**被真正比对：`peerRuntime` 对宿主 versions.json 的 `@oj-module/runtime`
  （`preflight.ts:263-282`）、`peerPlatform` 对平台 `API_VERSION`（`:284-305`）；
  **`peerOj`/`peerFramework` 全仓仅语法校验（`manifest-contract.ts:265-266`），安装期零消费**
  （`grep peerOj|peerFramework` 在 `_lifecycle` 下 0 命中）。
- 提案要钉的是 **React / react-dom / antd 等共享 npm 依赖**的版本——这是 `SHARED_DEPS` 的 hard 集
  （`shared-deps.ts:44-64`）与宿主 `versions.json` 的 matrix（react 19.2.8、antd 6.6.1…）。
  现有 `checkSharedVersions` 只做**构建期**严格相等校验（`versions.ts:120` + `module-build.ts:243`），
  prebuilt 产物无构建期 → 缺口成立。
- **数据源已就绪，无需新通道**：安装期 `ctx.hostVersions` 由 `hostVersionsOf()` 读 `<sharedRoot>/versions.json`
  并注入（`api.ts:142-145,541,631`），其中含全部共享依赖版本。`web.peers` 只需声明模块构建时绑定的
  共享依赖版本，安装期对照该 matrix 比对即可 fail-closed。

结论：顶层四键回答「面向哪个**平台/运行时/框架版本**」，`web.peers` 回答「面向哪份**共享依赖版本矩阵**」，
两轴正交、不构成双轨；复用会逼作者把 React 版本塞进 `peerFramework`，而该键安装期根本不比对，等于门禁失效。

### B. Q6 ✅拍板=②容器级注入——P4a 主题：为什么必须容器级注入，命名空间只解决一半

证据：
- antd token 写入点 `setup-antd-theme.ts:12-15`：样式插到 `<head>`，选择器是 **`:root { … }`**。
- 暗色写入点 `layout-effects/index.tsx:57-64`：`toggleHtmlClass("dark")`，作用在 **`documentElement`**。
- `ctx.register`（`module-loader/types.ts:27-56`）已支持 authProvider/headerProvider/layout 等，
  但**无 theme/portal 注入面**——容器级注入要新增注册点，是真实工作量。

推理：
- CSS 自定义属性从 `:root` 沿 DOM 继承；`data-<module>-theme` 只是一个新选择器，**挡不住**同名变量的继承。
- 全局 `html.dark` 会触发渲染器自带的 dark 变体（`:root.dark …` / `.dark &`），与壳 antd token 双重叠加 → 串味。
- 因此 ① 只定义「谁覆盖」，没定义「值从哪来」和「谁来关全局 dark」，是三分之一方案。

结论：选 ②——壳在 container 挂载点写 `data-oj-theme` + 语义 token，渲染器只读继承变量、仅在自身 wrapper 内
override、**禁写 `:root`**，主题切换由壳订阅通知。三方一致。遗留：genoffice 侧须配合改读取方式（对外依赖）。

### C. Q8 ✅拍板=签名+(b)跳过 oj_token——P5 过渡契约：为什么「壳保持写入 oj_token」在本仓不成立

证据：
- 本仓存储键 `getAppNamespace("access-token")`（`store/auth.ts:98`），实际形态
  `{namespace}-{version}-{env}-access-token`（`get-app-namespace/index.ts:15-24`）——**不是** `oj_token`。
- `refresh` 只更新 zustand store（`utils/request/refresh.ts:29` `useAuthStore.setState`），**不写** `localStorage.oj_token`。
- 全仓（含 docs、shell、dist，排除 node_modules/.git）grep `oj_token`：**实现代码 0 命中**；
  仅本方案文档与一份 oj-bin ld-linux 归档文档提及（与 token 无关）。
- 现有 lifecycle 已具备部分 P5 形态：`ctx.register.authProvider`（`module-loader/types.ts:37`）、
  401→refresh→`goLogin()`（`request/index.ts:102-123`，跳 SPA `${base}login` 而非 `/login.html`，`go-login.ts:13-16`）。

推理：
- 「渲染器惰性读 `localStorage.oj_token` + 壳保持写入」的前提是**壳真的写** `oj_token`——本仓从不写，
  该键恒为空/陈旧。这条过渡契约从落地第一天就是坏的，风险窗口不是「有限过渡期」而是**永远**。
- 401→`location.href=/login.html` 的裸 404 在本仓也不会发生（壳跳 SPA login 路由）；该痛点属于 genoffice 侧桥接，
  本仓职责是提供正确的**回调签名 + token getter**。

结论：`onUnauthorized({status,url,cause})` + `getToken()` / token 订阅面照做（本仓 runtime + 契约）；
**过渡契约须重定**：要么 (a) 本仓在 token 写入/轮换/登出三处镜像维护 `oj_token`（一次性垫片，P5 落地即删），
要么 (b) genoffice 侧直接改为消费 `getToken()`，彻底跳过 `oj_token`。倾向 (b)——避免双写漂移，且本仓已有
`authProvider` 注入先例可对称复用。**此项为发布门禁，Q8 已拍板，P5 可开工（genoffice 侧须同步改桥接）。**

## 三、分阶段落地计划（工程视角，按依赖排序）

### 波 1：无依赖，可并行（P10、P6、P7b、O1、O3、P7a 文档）
- **P10**：`api.ts:1065` 的 `await reconcileOf(env)` **前**插 `await runBundleConverge(env)`，与 `indexBody:708` 同序。
  回归：`templates/tests/lifecycle/market-api.spec.ts`。
- **P6**：`runtime/types.ts` 加 `tab?: boolean`；`layout-tabbar/index.tsx:184` 在 `addTab` 前 gate（建议 gate 整个
  `setActiveKey+addTab` 块，避免 activeKey 指向幽灵键；`:162` 的默认 tab effect 同样 gate）。复用
  `use-current-route/index.ts:10-16` 取最深 handle。回归：`tests/runtime/tabs-store.test.ts`（行为修复，需 e2e）。
- **P7b**：删 `types.ts:5,9` 的 `redirect`；`resolve-layout.ts:61-67` 补 layout 文档（P7a）。单测够。
- **O1**：`preview.ts:70-78` 四查后加非致命横幅——config 的 `auth.jwt_secret` 无 `ENC[` 前缀即提示重封三步。单测够。
- **O3**：`oj-cmd.ts:24-46` 透传补 `--module-root <project>/src`；preview 的 `migrate -d` 路径按 Q11 单独处理。
  回归：`tests/cli/preview.test.ts`（行为修复，需 e2e）。

### 波 2：P1 契约冻结 + 构建侧（P1、P2、P11 残口）
- **P1 契约**：`manifest-contract.ts:349-376` 加 `web.prebuilt`/`web.assets`/`web.peers` 校验（Q1 已拍板新增
  `web.peers`；SRI 算法按 Q2 待确认，暂用 sha384）；
  `module-build.ts:54-73` 同处解析 YAML；`assets` 限版本目录内相对路径、禁 `..`。
- **P1 拷贝挂点**：`buildModules` 每模块循环内，`await build()`（`:342`）与 require 门禁（`:347-359`）之后、
  `emitted` 汇总（`:361`）之前，按 `web.prebuilt` 把 `src/<name>/web/<assetsDir>` 拷入 `moduleOutDir`（`:267`）。
  理由：`emptyOutDir`（`:297`）在 build 前清→拷贝必在 build 后；`mergeShellSite` 的 rmSync（`:240` 前于循环）→
  build 后拷贝自然躲过；dev watch（`dev.ts:327`）重跑同函数→同序。挂 build 前或 mergeSite 里都会被抹。
- **P2**：`installed-merge.ts:86`、`deploy-web.ts:172` 改递归；`module-build.ts:365` **新增**磁盘递归扫描
  （prebuilt assets 不在 Vite emitted 中）。递归后 POSIX 子路径归一（`deploy-web.ts:61`/`installed-merge.ts:164`）
  → Set 去重 → 排序；过滤 `.ojm-module.json`/`.map`/`node_modules`。
- **P11 残口**：按 Q3 补——收敛 plan 增「face 是否在盘」判据（face 缺失不 skip、走重装）；
  `installed-merge.ts:75-76,90` 降级重建保留 integrity；`deploy-web.ts:185` chunks 落盘。
- 回归：P1 资产在 build/dev watch 后存续（e2e 必补）；P2 用 `installed-merge.test.ts`+`deploy-smoke.spec.ts:283`。

### 波 3：依赖 P1 的分流（P3、O2）
- **P3 双轨**：源码编译路保留 `assertResolvableSpecifiers:397`+`external:327`；prebuilt 无构建期，
  校验放**安装期**（`deploy-web.ts` preflight 对 `web.externals` 逐项比宿主 importmap，缺键 fail-closed），
  构建期仅把 externals 写入侧车、不校验。单放一处必漏。
- **O2**：`deploy-web.ts:128-141` 落盘后按 P1 SRI 清单逐文件 hash 复核（按 Q10 后台化），
  `smoke.ts:182-199` 增逐文件校验；无清单退化为 smoke 指引。单测+spec。

### 波 4：对接契约（P4a、P4b、P5、P8）
- **P4a（Q6 已拍板，可开工）**：壳在 container 挂载点写 `data-oj-theme`+语义 token，渲染器只读继承变量、
  仅 wrapper override、禁写 `:root`（现 `setup-antd-theme.ts:14`/`layout-effects:57-64` 都挂 documentElement，
  命名空间挡不住串味）。
- **P4b（Q7 已拍板，已于 0.2.93 实现）**：`ctx.register` 加 `portalContainer(): HTMLElement`（壳持挂载点，
  非模块自带），由 container layout 提供固定 `<div data-oj-portal>`；模块层独立 z-index 栈且避开壳
  overlay(150) 与 View Transition(999999999) 窗口。
  - 实现落点：`runtime/src/module-loader/portal-container.ts`（稳定节点 + `mountPortalContainer`）、
    `module-loader/types.ts`（`register.portalContainer` 类型）、`module-loader/index.ts`（ctx 注入，
    `createModuleContext` 已导出供回归测试）、`layout/container-layout/index.tsx`（section ref 接入/摘除）。
  - 回归：`tests/runtime/portal-container.test.tsx`（4 例，稳定节点/幂等 mounting/ctx 注入/布局挂载卸载）。
  - 对其他模块零影响：纯追加消费面，portal 进来的节点随模块组件卸载由 React 自动回收，
    **不做全局清空**（否则误删其他模块节点）。genoffice 侧仍需主动把 portal 目标改为 `portalContainer()`（§五）。
- **P5（Q8 已拍板，可开工）**：`installWebBridge` 增 `onUnauthorized({status,url,cause})`+`getToken()` getter；
  壳用 SPA `go-login.ts:12-16` 路由而非 `/login.html`，保留 next；错误态 `error-response.ts:45-46` 改人话文案+i18n；
  **过渡取 (b)：genoffice 直消 `getToken()`、跳过 `oj_token`，本仓不镜像写**。
- **P8（待 Q9 拍板）**：把既有 `--react-antd-admin-content-height`（`constants.ts:42`）别名暴露为
  `--oj-content-height`（净内容高、不含 header/tabbar/footer、滚动归壳）；渲染器根节点 `height:100%` 消费替代 100vh。

### 独立评审（不阻塞上述批次）
- **P7b**：已按 Q4 建议删 `redirect`，但涉及字段删除，单独评审后进入波 1。
  （P4b 的 Q7 已拍板=壳持挂载点，已并入波 4，不再属独立评审。）

## 四、风险矩阵

| 风险 | 等级 | 缓解 |
|---|---|---|
| P1 挂点顺序错→资产被抹 | 高 | 严格按波 2 挂点；e2e 覆盖 build + dev watch 两种形态 |
| P1 双轨钉版/双份 peer | 中 | Q1 已拍板新增 `web.peers`（独立轴），与顶层四键分工明确，不算双轨 |
| P2 同名 css 落不同子目录重复注入 | 中 | 递归后归一+Set 去重+排序 |
| P3 prebuilt 校验点漏置 | 中 | 构建期写侧车+安装期 fail-closed，双轨缺一不可 |
| P11 只补构建侧、收敛仍 skip | 高 | Q3 选②，把 face 在盘纳入 plan 判据 |
| O2 60MB 同步哈希撞 2s 看门狗 | 高 | Q10 选②后台校验；缺省退 smoke 指引 |
| P5 过渡期 token 无人写→窗口=永远 | 高 | Q8 已拍板 (b) 跳过 `oj_token`，genoffice 直消 `getToken()`，从契约上消除该风险；门禁级验收 |
| P4a 命名空间挡不住 CSS 变量继承 | 中 | Q6 选②容器级注入+禁写 `:root` |
| O3 `-d` 与 `--module-root` 互斥 | 中 | Q11 分路径处理；e2e 覆盖 preview 与透传两路 |
| canon 升 v3 忘同步闸门 | 低 | P9 回归测试随 canon 常量维护 |

## 五、对外依赖清单（genoffice 侧，本仓不改）

- P4a：渲染器改读容器注入 token、仅 wrapper override、禁写 `:root`。
- P4b：渲染器 portal 目标改为壳提供的 `portalContainer()`，z-index 入独立栈。
- P5：桥接 401 走 `onUnauthorized` 回调；token 改 `getToken()`；惰性读 `oj_token` 过渡逻辑按 Q8 替换。
- P8：渲染器根节点 `height:100%` 消费 `--oj-content-height`，滚动交壳。

## 六、待用户确认清单（拍板项）

1. **✅ 已拍板（2026-11-16，按建议采纳）**：**Q1**=①新增 `web.peers`；**Q6**=②容器级注入+禁写 `:root`；
   **Q7**=①portal 由壳持挂载点；**Q8**=`onUnauthorized`+`getToken()`，过渡取 (b) 跳过 `oj_token`
   （Q1/Q6/Q8 依据见 §二·补 A/B/C）。对应的波 2（P1 契约）与波 4（P4a/P4b/P5）**已解冻可开工**。
2. **仍待确认**：Q2（SRI 算法）、Q3（P11 残口范围）、Q4（redirect 删/留，阻塞 P7b）、Q5（P10 触发点）、
   Q9（高度变量语义，阻塞 P8）、Q10（O2 哈希时机）、Q11（O3 旗标）。
3. **是否同意分 4 波 + 2 项独立评审的批次划分**？还是要求一次性全量提交上游？
4. **交付物形态**：本方案文档是否即作为「待提交上游」的提案附件，还是另需按上游模板重排为 R 系列需求单
   （参照 `docs/prd/202611101330-oj-mcp-upstream-requirements.md`）？
5. **设计文档** `docs/superpowers/specs/2026-11-16-native-app-modules-design.md` 尚未创建——是否需要本方案拍板后补建？
6. **分工确认**：波 4 的 genoffice 侧改动是否由对方仓承担、本仓只出契约/API？
