# overlay 物化逐过程执行追踪（2026-11-21 22:50）

> 追踪方式：Explore 代理全仓扫描 + 人工抽查核验（backfillOverlay 调用方、C2-31 禁入、
> deployWeb dbSeq 门控、migrate_on_start 四条关键断言均经 grep/读码二次确认）。
> 结论修正了两条流行认知，见 §3 问题记录。

## 1. 十条独立过程的执行链

### 1.1 仓库根 `pnpm dev`（vite dev server）

- 入口：`package.json` scripts.dev = `vite --host` → `vite.config.ts`（纯 vite，无 overlay 概念）。
- 清单：DEV 形态 `import("#manifest.json")`（`packages/runtime/src/index.tsx:82-84`），alias 解析到
  仓库根 `manifest.json`，entry 全部指向 `/web/<name>/entry.ts` **源码树**。
- 加载：`loadAll(manifest)`（`packages/runtime/src/module-loader/index.ts:198-199`，按 `enabled !== false` 过滤后裸 import entry）。
- **modules.json / sidecar / DB / overlay 均不出现**。此链路的「启停」= 编辑 manifest.json 的 enabled 字段（开发者自己改文件）。

### 1.2 仓库根 `pnpm preview`

- `vite preview` 服务 `vite build` 产物；生产形态清单 = fetch `${siteBase}module-manifest.json`
  （`index.tsx:90-94`，由 `scripts/build-modules.ts:101` 产出）。
- 同样无 modules.json、无 overlay、无 DB。

### 1.3 `ojm dev`（站点工程）

- `dev.ts:69` devServer → 启动前先跑一轮 `buildModules`（`dev.ts:76,86-87`）。
- 构建链：`module-build.ts:225` buildModules → `:416` restoreInstalledFaces（release 擦除后从版本目录拷回 face）→ `:417` mergeInstalledModules → `:419` 写 `<dist>/modules.json`。
- overlay 行来源（**构建面，纯盘侧，零 DB**）：
  - `installed-merge.ts:27-53` 读 sidecar `modules/.solutions/state.yaml`；
  - `installed-merge.ts:62-84` assertOverlayCacheFresh 用 `overlay-cache.json` 的 db_seq 做离线 fail-stale 仲裁；
  - `installed-merge.ts:229-258` 逐条读 face 旁车 `.ojm-module.json` 组装 OverlayEntry[]；
  - `installed-merge.ts:259` 调 materialize 纯函数。
- modules.json 写者 = **buildModules**；随后 `dev.ts:183-185` createStaticHandler 从 localDist 直读返回（`static-handler.ts:111-120`），纯文件。
- 运行面：`ojm dev` 起的 oj 后端带 config.yaml 时 `migrate_on_start: auto`
  （`templates/config.yaml:35`）→ **启动即应用 0010 迁移，dev 库有 overlay 表**；
  生命周期 API（install/setEnabled/uninstall）在 isolate 内走 DB 写 + siteMaterialize（见 1.5/1.8）。
- 无 config.yaml 的前端-only 工程：不起后端、无 DB → 运行面全走 legacy 直写。

### 1.4 `ojm build`（含 `--bundle`）

- 普通 build：`cli.ts:154-155` buildBackend + buildModules({mergeSite:true}) → 同 1.3 构建链
  （mergeSite 时先 mergeShellSite 擦除 dist，restoreInstalledFaces 的整树拷回在此真正生效）。
  overlay 行来源同 1.3（sidecar + face 旁车 + overlay-cache.json），**不读 DB**。
- `--bundle`：`bundle.ts:378` buildBundle → **不调用 buildModules**（`bundle.ts:324-325`，
  「作者先 oj build，本命令只校验与组装」）；web 段只拷本方案 `modules/<name>` 一棵（`:348-349`）。
- **modules.json 禁入包**：C2-31 红线（`bundle.ts:29`）+ assertNoForbiddenMembers（`:356,560-575`，
  `modules.json` 与 `overlay-cache.json` 双名同拒）。bundle 产物里没有 modules.json。

### 1.5 oj-market 安装（deploying_web stage）

- 入口：`templates/src/oj-market/api/api.ts:532`（市场目录）/ `:623`（本地归档）→
  `runInstall`（`installer.ts:662`），stage 机 `installer.ts:571-581`。
- overlay 全在 **deploying_web**（`installer.ts:370-432`）：
  1. `installer.ts:399` readOverlayDbSeq() 探测 DB（`overlay.ts:72-80`，globalThis.db，fail-open → null）；
  2. `installer.ts:400` deployWeb({writeManifest: dbSeq===null})：拷 web 树 → face 旁车落盘
     （`deploy-web.ts:226-236`）；legacy 模式（dbSeq=null）走 upsertModulesJson 直写清单（`deploy-web.ts:75-107`）；
  3. DB 可达：`installer.ts:408-416` upsertOverlayRow（先 enabled=0，face_ref=版本目录引用）→
     `:417` swapEnabledVersion（原子换版，部分唯一索引兜底）→ `:426` siteMaterialize：
     - 行来源 = readOverlayRows()（fail-open []）+ face 旁车 readFaceManifest + 基线 = 当前 modules.json 读盘；
     - 同名多行仲裁（启用行优先，皆停取最大 seq）`site-materialize.ts:232-255`；
     - 写者 = siteMaterialize（atomicWriteText `:281-283`，内容零变化不写）→ healSidecarFromOverlay 回写 sidecar → writeOverlayCache 落 db_seq；
  4. DB 不可达：deployWeb legacy 直写，overlay 表零接触。
- **录入 DB 的内容来自 sidecar 登记 + face 旁车 + 包内 manifest.yaml/web 产物树，不来自包内 modules.json**（包内根本不允许有）。

### 1.6 运行时宿主（Rust oj serve / cli static handler）

- 浏览器：`shell/src/host.tsx:321` fetch `${base}modules.json` → resolveModuleUrls → loader 消费。
- 服务端：纯存在式文件解析（`static-handler.ts:105-227`），**只读文件，零 DB 接触**。

### 1.7 catch-up（reconcileOf）

- 定义 `api.ts:357-394`；内先调 catchUpSiteModules（`site-materialize.ts:303-335`：cache.db_seq < DB seq
  或 fail_count>0 → 重跑物化；连续失败 5 次告警；独立 try/catch 静默）。
- 调用方仅两处：`api.ts:726` GET index（市场页刷新）、`api.ts:1080` POST converge（ojm dev/preview 出厂收敛）。
- install/uninstall/setEnabled **不经 reconcileOf**——各自 stage 直接调 siteMaterialize，崩溃窗留待
  市场页刷新 / converge / verify --repair（`installer.ts:1157-1161`）收敛。

### 1.8 setEnabled / uninstall / compensate 写序

- setEnabled（`installer.ts:1351-1397`）：① 锁 → ② sidecar → ③ sys_solution_route.enabled →
  ④ readOverlayDbSeq → **先写 DB**（upsertOverlayRow `:1366`）→ **后写文件**（siteMaterialize `:1373`）。
  物化失败 → 返回「catch-up 将自愈」。DB 不可达 → legacy 直写清单 enabled。
- uninstall（`uninstall.ts:354-381`）：sidecar 删 → readOverlayDbSeq → DB softDeleteOverlayRows（`:359`，**软删：只置 enabled=0 不删行**，审计保留可重装）→
  siteMaterialize({omitNames})（`:360`）。DB 不可达 → legacy filter 直写。
- compensate（`compensate.ts:130-151`）：DB 可达 → softDeleteOverlayRows + siteMaterialize(omitNames)；
  否则 legacy removeModulesJsonEntry。

### 1.9 离线构建 fail-stale

- `installed-merge.ts:62-84` assertOverlayCacheFresh：sidecar 任一条目 overlaySeq 缺失或 < cache.db_seq
  → console.error + throw，**拒写 modules.json，构建失败**。唯一调用点 `installed-merge.ts:227`。
- overlay-cache.json 的 db_seq 由运行面每次在线物化时刷新（`site-materialize.ts:285`）。

### 1.10 dev 环境 db 不存在时的实际生效来源

- fail-open：`overlay.ts:49-51` globalThis.db undefined → 各函数 try/catch 吞 TypeError →
  readOverlayRows 返 []、readOverlayDbSeq 返 null。
- 此时实际生效的 overlay 来源 = ① 构建面 sidecar（ojm dev 启动前的 mergeInstalledModules，
  启停掩码/已装方案条目进清单）+ ② 运行面 legacy 直写（setEnabled/uninstall/deployWeb 的
  upsertModulesJson 读-改-写）。DB 表与 overlay-cache.json 的 db_seq 不参与。

## 2. 过程 × 数据源矩阵

| 过程 | DB readOverlayRows | sidecar state.yaml | overlay-cache.json | 包内 modules.json | face 旁车 | modules.json 写者 | DB 不可达 |
|---|---|---|---|---|---|---|---|
| 根 pnpm dev | — | — | — | — | — | 无（源码树 manifest） | 无 DB 概念 |
| 根 pnpm preview | — | — | — | — | — | 无（module-manifest.json） | 无 DB 概念 |
| ojm dev 构建期 | 不读 | 读 | 读（fail-stale） | 不涉及 | 读+回写 | buildModules | stale 即构建失败 |
| ojm build / --bundle | 不读 | 读 | 读 | --bundle 禁入包 | 读+回写 | buildModules | 同左 |
| market 安装 | 读（探测+物化） | 物化后 heal | 物化后写 db_seq | 无人读（C2-31） | 读+写 | siteMaterialize / legacy upsert | legacy 直写 |
| 运行时宿主 | 无 | 无 | 无 | 无 | 无 | 无（只读静态） | 无 DB 接触 |
| catch-up（index/converge） | 读 | heal 回写 | 读+写 | 无 | 读 | 滞后时 siteMaterialize | 静默不动作 |
| setEnabled/uninstall/compensate | 先写后读 | 写 | 物化后写 | 无 | 读 | siteMaterialize / legacy 直写 | legacy 直写 |
| 离线 fail-stale | 不读 | 读（overlaySeq 比对） | 读（db_seq 真源） | 无 | 无 | 拒写 throw | 即断网场景 |
| dev 无 db | fail-open | **生效来源①** | 不参与 | 无 | 读 | 构建期 buildModules + legacy 直写 | 表整体旁路 |

## 3. 问题记录（本次追踪新发现，已同步主文档 §7）

| 分类 | 内容 |
|---|---|
| 与业界不符 | **「安装读包内 modules.json 录库」的流行认知不成立**：C2-31 明文禁 modules.json 入 bundle，安装侧全链无读它的分支；录库内容是安装器自己从包内 manifest.yaml/web 产物 + face 旁车组装的。bundle 里的 modules.json 只能来自绕过红线的手工打包，属于事故面而非数据面 |
| 落地缺口 | **backfillOverlay（含 legacy modules.json enabled=false → overlay 的第三路）无生产调用方**——Phase 2 只交付了函数 + spec，调用方（升级路径）未接线。影响：老站点升级到新模板后，若不做一次性迁移脚本，老清单里的 builtin 停用状态不进 DB（构建面靠 sidecar 掩码兜住清单层，但 DB 面是空的）。接线点建议：首次 readOverlayDbSeq 成功且表空时，或 ojm migrate 后的一次性命令 |
| 反常识 | 根 `pnpm dev`/`pnpm preview`（admin/playground 自身）**完全在 overlay 体系之外**——它们消费源码树 manifest.json / module-manifest.json；overlay 只存在于「站点工程」（ojm dev/build + oj 宿主）这一层 |
| 澄清 | `ojm dev` 并非「本地文件优先 + DB 兜底」的双轨读取——构建面**只读盘**（sidecar + face 旁车 + overlay-cache.json），DB 只在运行面（isolate 生命周期 API）参与；两边靠 overlay-cache.json 的 db_seq 做离线仲裁衔接 |
