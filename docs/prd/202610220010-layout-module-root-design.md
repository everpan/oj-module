# 模块布局改造：`{web,api}/src/<name>` → `src/<name>/{web,api}`

> **状态**：设计定稿 v2（含五位专家评审修订）。前置依赖「模块根可配置」**已由 oj 0.1.85 落地**（`--module-root <DIR>`，见 §5），原计划的配套 PR 文档不再需要。
> **来源**：2026-10-22 讨论；v2 按 §附录 A 的评审结论修订
> **受众**：oj-module 维护者、上游 oj 维护者、方案作者
> **历史工程**：不纳入迁移范围（硬切换，不做双写过渡）

## 1. 动机

当前一个模块横跨四处：

```
api/src/<name>/**          # 后端源码
web/src/<name>/**          # 前端源码
manifest.yaml              # 方案级清单（仓库根，按 name 匹配）
web.config.ts              # 模块登记（仓库根，人工维护顺序）
```

代价：改名/搬仓要动四处且无编译期查漏；模块登记与菜单顺序两套真源；打包必须「先构全站再挑自己」；模块无法按目录切片增量构建或整目录迁仓。

目标：**一个目录 = 一个模块**。注意：v1 曾把「构建产物也按模块聚合」写进目标，v2 已据实证撤销该部分（见 §2.2）。

## 2. 目标布局

### 2.1 采纳：源码按模块聚合

```
<project>/
  config.yaml                 # oj 的 project root 锚点（见 C-4，位置从 api/ 上移）
  config/                     # 证书（由 config 路径派生）
  src/
    <name>/
      solution.yaml           # 方案契约（原仓库根 manifest.yaml；见 D2）
      api/                    # 后端源码（可缺省 = 纯前端模块）
        manifest.yaml         # oj 原生七键（模块身份真源）
        schema.yaml
        api.js / routes.js / …
        _shared/
      web/                    # 前端源码（可缺省 = 纯后端模块）
        entry.ts
        locales/
  api/dist/                   # 【不动】oj 扁平 release 根
    <name>-<version>/         #   同层兄弟目录（跨模块 import 的解析基础，见 C-7）
    manifests.yaml
    versions.json
  web/dist/                   # 【不动】站点产物（shell + modules/ + modules.json）
  dist/                       # 【建议改名 release/】方案包 <name>-<ver>.tgz + .sig
```

### 2.2 否决：产物按 `<name>/<version>/{api,web}` 聚合

v1 的 `dist/<name>/<version>/{api,web}` 会同时打断三条承重链，全部有实证：

1. **跨模块 import 被实化为版本目录相对路径**。`oj build` 把 `#/m/x` / 相对跨模块引用固化成 `../<dep>-<version>/…`，实测产物中 `../_platform-0.1.0/` 出现 39 处、`../notification-0.1.0/` 1 处。把 `wiki-0.1.3/` 搬进 `dist/wiki/0.1.3/api` 后，`../_platform-0.1.0/` 解析到不存在的路径。
2. **锁与版本目录必须同层**。`manifests.yaml` 的语义是「同层多版本共存，锁决定加载哪个」，release 模式按 `<root>/<name>-<version>/` 查找（`migrate -d`、`oj serve --api-path` 同一套判定）。分组后需要重写锁的路径模型。
3. **preview/serve 四处硬编码 flat root**：`preview.ts:62`（`apiDist = <project>/api/dist`）、`:71`（查 `manifests.yaml`）、`:86`（`oj migrate -d apiDist`）、`:92/:105`（`platform.root` 与 `--api-path`）。分组后这四个点全部指向空目录，表现为「health 200、模块 0 个」的假绿。

**结论**：模块产物聚合只作为**可选视图**——若确有「一个模块的产物在一处」的诉求，构建后生成 `dist/view/<name>/<version>/{api,web}` 的副本或符号链接，并明确标注「派生、不参与运行、可随时删除」。运行与安装永远只认扁平根。

> 注：本仓历史的 `dist/` 三义（`api/dist` 模块产物、`web/dist` 站点产物、`dist/` 方案包）仍然存在，v2 建议方案包改落 `release/`（D1），但这与本次布局改造解耦，可单独做。

## 3. 现状与硬约束

### C-1 模块发现深度：`-d` 的首层子目录才是模块

```
$ oj build --help
  [MODULE]  目标模块名（src 首层子目录）；省略 = 全部模块
  -d, --dir <DIR>  源码目录 [default: src]
```

实测两种失败形态（oj 0.1.84，均为非零退出）：

| 输入 | 输出 |
|---|---|
| `-d src/m1`（`m1` 内有 manifest） | `oj build: 0 module(s)`，产物目录未生成 |
| `-d src`（`src/m1/api/manifest.yaml` 嵌套） | `oj build: module 'm1' missing manifest.yaml` |

第二种是本次改造的常态：`src/<name>/api` 会让 oj 在 `src/<name>/` 找 manifest，直接硬错。

### C-2 模块身份 = 目录名

位置参数 `MODULE` 语义为「首层子目录名」，且启动期强校验 `manifest.name == 目录名`。`src/<name>/api` 的模块根统一叫 `api`。

### C-3 产物形状与版本锁

`oj build` 恒产出 `<module>-<version>/` 平铺 + `manifests.yaml` + 单模块 `.tgz`；多版本共存、`gc` 清理旧版本。与 C-7 共同决定「扁平根不可分组」。

### C-4 config 位置锚定 project root，且牵连四处

oj 把 project root 锚定在 config 所在目录，相对 import 与模块解析都钳制在根内（`layout.ts:48-60` 记录了 config 进更深子目录后的实测：26 个 api 文件只剩 8 个能加载）。源码搬到 `src/` 后 config 必须上移到仓库根，**连带四处必须同改**：

| 牵连点 | 现状 | 上移后 |
|---|---|---|
| `oj.ts:52` | `projectRoot = dirname(dirname(configPath))` | 改为 config 所在目录（否则 `bin/oj`、`bin/plugins` 解析到仓库父目录） |
| `config.yaml` mounts | `api: src`、`web: ../cdn`（相对 config 目录） | `api: src`、`web: <site 产物>`；相对值全按新根重算 |
| 证书目录 | `api/config/*.pem`（`resolveCertDir`） | `<root>/config/*.pem` |
| 运行数据 | `api/db.sqlite`、`api/logs/`、`tasks/` | 相对新根，`.gitignore`（`init.ts:414`）同步 |

补充（v1 表述有误）：把 config **上移**只会扩大 root，本身不会触发越界；危险的是「源码搬走、config 留在 `api/`」——那才是源码落到 root 外。

### C-5 安装链路依赖版本段（包内布局不变）

`installer.ts:214`（`versionDir = ${sharedRoot}/${name}-${version}`）、回滚 `rename`、`gcVersions`、卸载 `remove`；`modules.json` 的 `entry = modules/<name>/<version>/entry.js`；`deploy-web.ts:140` 把包内 `staging/web/modules` 整树拷进站点 `<dist>/modules`；C2-31 要求包内 `api/<name>-<ver>/manifest.yaml` 的 name/version 与包名逐一相等（bundle.ts:179）。

### C-6 模块一侧可缺省，枚举真源不能是 `api/`

模板实测（`templates/api/src` 与 `templates/web/src`）：

- 仅后端：`_platform`、`auth`、`web`（其 `web/` 只有生成的 `__client`）
- 仅前端：`about`、`access`、`exception`、`login`、`oj-market`、`outside`、`route-nest`
- 两侧都有：`demo`、`home`、`notification`、`personal-center`、`system`

因此枚举真源 = `src/*/api/manifest.yaml ∪ src/*/web/entry.ts`，**不能**用 `src/*/solution.yaml`（方案清单只存在于「有交付物」的模块，模板里多数模块没有）。

### C-7 跨模块 import 在产物里是版本目录相对路径

```
$ grep -rho "\.\./[a-z_-]\+-[0-9][0-9.]*\/" api/dist/*/ | sort | uniq -c
  39 ../_platform-0.1.0/
   1 ../notification-0.1.0/
```

来源：`#/m/x` 别名与相对跨模块引用在 build 期「按 `dist/manifests.yaml` 锁钉版本、实化为版本目录相对路径」（devkit 手册 §5）。**产物目录一旦不互为兄弟，运行期解析即断。**

### C-8 模块别名命名空间以目录名为键

手册 §5：`#x` 锚在本模块根（向上找最近的 `manifest.yaml`），`#/m/x` 锚在 src 根且「首段必须是模块目录名」。模块根统一叫 `api` 后，`#/api/...` 无法区分模块 → 上游必须把别名首段解析改为按 `manifest.name`（PR 需求 O7）。

### C-9 空命中必须报错

`-d <模块目录>` 命中 0 个模块时 oj 静默成功（v1 已记）。下游 CI 会表现为「构建成功、产物缺失」。PR 中要求非零退出（§6 D）。

## 4. 方案分段

### A. 布局解析

`layout.ts` 新增 `kind: "module-root"`，并新增取值函数（禁止调用方拼路径）：

```
modulesSrc → <project>/src
distDir    → <project>/web/dist        （站点产物根，语义不变）
apiDist    → <project>/api/dist        （release 根，语义不变）
moduleDir(name) → <project>/src/<name>
```

探测顺序（互斥，命中即返回）：`src/*/api/manifest.yaml` 或 `src/*/web/entry.ts` → `module-root`；否则 `web/src` → legacy `new`；否则 `web/` → `flat`；两者同时命中 → **报错**并要求显式移除其一。命中目录既无 `api/manifest.yaml` 也无 `web/entry.ts` → 报错（指出该目录两者皆不是）。

### B. 构建

- 后端：**一次调用**构建全部模块，单一输出根：
  `oj build --module-root <root>/src -c <root>/config.yaml -o api/dist --no-minify`
  禁止逐模块 `-o <tmp>`——否则每个 tmp 各有一份 `manifests.yaml`，跨模块版本锁与兄弟目录关系全部丢失。
- 前端：由 `src/<name>/web/entry.ts` 扫描得到模块列表与入口；产物仍写 `web/dist/modules/<name>/<ver>/`，`modules.json` 与 integrity 生成逻辑不变。
- 站点合并：`mergeShellSite` 根仍为 `web/dist`；清场范围必须显式排除 `api/dist`（`build.ts:546` 的 `rmSync` 只作用于站点根）。
- dev：`oj serve --module-root <root>/src`（dev 读源码树，才能保留保存即热更）；watch 根为 `src/`，必须排除 `dist/`、`node_modules`（自触发循环）。
- 增量：现有 `trigger()` 丢弃文件名、全量重建（`dev.ts:241-255`）；v2 要求按 `src/<首段>/` 过滤重建范围，否则验收钉子 4 不成立。

### C. 打包

| 现位置 | 新来源 |
|---|---|
| routes 派生 `modulesSrc/<name>/entry.ts` | `src/<name>/web/entry.ts` |
| `api/src/<name>/schema.yaml`（tables 核对） | `src/<name>/api/schema.yaml` |
| `web/src/<name>/locales`（i18n 核对） | `src/<name>/web/locales` |
| `api/dist/<name>-<ver>/` | **不变**（扁平根，C-7 决定） |
| `web/dist/modules/<name>` | **不变**（只取本模块，已修） |

包内组装结果与今天逐字节一致——这是唯一不可让步的回归（§8-1）。

### D. config 上移与 init

按 C-4 四处同改；`init.ts` 生成的 `.gitignore`、模板 config、证书路径同步。`init.ts:81-88` 目前「`bin/oj` 已存在即跳过」——新布局工程若配旧 oj 会开工即坏，必须改为先探能力（§7）。

### E. 脚手架与模板（最后做）

`init` 产新布局（注：`packages/cli/src/create-module.ts` 当前并不存在，v1 误列；脚手架入口是 `init.ts` 与仓库根 `scripts/create-module.ts`）。模板重排的机械改动量实测：

- `templates/api/src` 跨模块相对 import **41 处**（其中 23 处指向 `_platform`），模块根下移一层后引用深度全部 +1；
- `templates/api/tests` 另有 **116 处** `../src/` 需要一并改；
- `templates/api/{tests,vitest.config.ts,tsconfig.json,seed.*.sql,logs,config}` 在新树里都要重新落位（这些目录目前与 `src/` 同级）。

## 5. oj 侧需求（PR 正文见配套文档）

| # | 需求 | 理由 | 状态（oj 0.1.85） |
|---|---|---|---|
| O1 | `--module-root <DIR>`：取**源码树根**，在其子树内递归找 `manifest.yaml` | C-1 | 已实现（**不是 glob**，与 `-d`/`--api-path` 互斥） |
| O2 | 模块身份以 `manifest.name` 为准，放宽目录名强校验 | C-2 | 已实现（发现期白名单 `[A-Za-z0-9_-]`） |
| O3 | `build` / `serve` / `migrate` / `schema` / `test` / `openapi` / `exec` 共用同一 resolver | 只改 build 会出现「能构建、`schema diff` 0 模块」 | 已实现（同口径离线解析器） |
| O4 | 产物默认仍 `<name>-<version>/` 平铺，多模块共用单一 `-o` | C-3、C-7 | 已实现 |
| O5 | `manifests.yaml` 锁、多版本、gc 语义不动 | C-5 | 未动 |
| O6 | 全部 opt-in，`-d src` 行为逐字节不变 | 兼容承诺 | 已实现 |
| O7 | `#/m/x` 别名首段按 `manifest.name` 解析（非目录名） | C-8，否则跨模块别名全撞 | 已实现（另新增 manifest `prefix` 自定义 URL 前缀，缺省 = name） |
| O8 | 发现 0 个模块 → 非零退出 + 可读文案 | C-9 | 已实现（`no manifest.yaml under module root …`） |

> **落地修正**：设计初期假设 `--module-root` 是 glob 旗标、可与 `-d src` 并存。v0.1.85 实际语义是「源码树根目录」，递归发现且在首个 `manifest.yaml` 处停（不深入、跳过 `node_modules`/点目录、不跟随符号链接），并与 `-d`/`--api-path` **互斥**（clap `conflicts_with`，同时给 exit 2）。本仓代码与文档均按此语义实现：`layout.moduleRoot = <project>/src`，构建时 `["--module-root", moduleRoot]` 与 `["-d", apiSrc]` **二选一**。

**明确不要**：不要 oj 认识 `web/`；不要 oj 产出 `{web,api}` 外层；不要 oj 改版本目录语义。

## 6. ojm 变更面清单（按评审补全）

| 文件 | 改动 |
|---|---|
| `packages/cli/src/layout.ts` | `module-root` kind、取值函数、互斥探测 |
| `packages/cli/src/build.ts` | 单一 `-o`、`--module-root`、entry 扫描、站点根清场边界 |
| `packages/cli/src/dev.ts` | watch 根/排除、按模块增量、`--api-path src` |
| `packages/cli/src/oj.ts` | **projectRoot 推导**（config 上移，C-4） |
| `packages/cli/src/preview.ts` / `preview-config.ts` | `siteDir`、`apiDist`、`platform.root` |
| `packages/cli/src/static-handler.ts` | `/modules/*`、`/modules.json` 的 localDist 映射 |
| `packages/cli/src/bundle.ts` | routes/schema/locales 三处取值；默认 `out` 仍是 `dist`（D1） |
| `packages/cli/src/contract/check.ts`、`contract/run.ts` | `web/src/<m>/__client` → `src/<m>/web/__client` |
| `packages/cli/src/init.ts` | 新布局产出、`bin/oj` 能力探测、`.gitignore`（`api/dist`/`api/config.yaml` 等） |
| `packages/cli/src/market/*` | `scan`/`fixture`/`walkthrough`（`api/dist` 兄弟目录假设）与 `bootstrap` 的 `root: dist` |
| `packages/cli/src/usage.ts` | 帮助文案里的路径示例 |
| `packages/cli/templates/**` | 7 模块重排、`_shared` 深度、config 上移、tests 路径 |
| `packages/cli/vendor/host-versions.json` | 由同步脚本重生成 |

**不动**：包内 §2.9、C2-27、C2-31、integrity、安装器实现、`api/dist` 扁平根、`web/dist` 站点根。

## 7. 契约与兼容

- **双布局共存**：`module-root` 与 `new` 并存一个发布周期；同时命中 → 报错。
- **版本闸门必须是「双探」**：
  1. 现场版本：`probeOjVersion`（`info.ts:40-47`，`oj -V` → `oj 0.1.85`）——不能只读 `bin/.oj-version` 标记（`info.ts:159` 现状），因为 `vendor.ts:143` 允许手改 `bin/oj`，标记会漂移。
  2. 能力探针：`oj build --help` 是否含整词 `--module-root`，结果按二进制 `size:mtime` 指纹缓存 `bin/.oj-caps`（`oj-caps.ts`）。理由：`vendor.ts:102-110` 已证明「`-V` 正常但能力缺失」真实存在——本仓 `bin/oj` 目前就是 0.1.84（`build --help` 无此旗标）。
  3. 不满足 → 在 `build/dev/preview/init` 入口 fail-fast，文案含现场 `oj -V`、`ojm vendor <tag>` 处置与缓存路径；**禁止回落旧布局**。
- **发布顺序**：oj 必须先发版（**0.1.85 已发布**）并把 `MIN_OJ_VERSION`（`vendor.ts:39`）抬到 `0.1.85`，`publish-packages.mjs` 增加「`@oj-bin/oj` latest >= MIN」断言；否则用户升级 ojm 后仍是旧 oj，全线失败。
- **失败模式**（逐条可读文案）：版本过低；模块目录两者皆非；`solution.yaml` 与 `api/manifest.yaml` 的 name 不一致；`api/dist/<name>-<ver>/` 缺失而清单声明 api 段；`api/dist/modules.json` 出现（构建污染）。

## 8. 验收钉子（按评审改写）

1. **确定性**：同一布局连续两次构建，方案包 `sha256` 相等（`deterministic-tar` 已固定 mtime/uid/路径排序）。
2. **跨布局等价**：旧布局与新布局各构建一次，比较 **tar 成员集合 + `manifest.yaml` 字段 + `routes.js` 路由表**；**不断言 sha256 相等**——源码树搬迁必然改变 `_shared` 相对深度与生成物内容，强断言不可满足。
3. **安装回归**：用本次构建的 tgz 在隔离站点试装（`ojm market trial` 走 fixture，需另接「真实 tgz + health 200 + WS 握手」的脚本），并补 upgrade / uninstall / 双版本共存 / gc 四条。
4. **dev 增量**：断言重建范围（产物文件集合或 mtime），不断言日志文本；web 与 api 各一条。
5. **互斥与漏模块**：`web/src` + `src/*/api` 并存 → 报错；`src/<n>/api/manifest.yaml` 存在但模块未进入构建 → 报错（不得静默漏）。
6. **闸门**：注入假 probe 的单测覆盖「版本够但能力缺」「版本不够」两条；不依赖真的装旧版 oj。

## 9. 迁移顺序

1. **oj 发版（O1–O8）已完成（0.1.85）**：把 `MIN_OJ_VERSION` 抬到 `0.1.85`，发布脚本加断言
2. 布局解析 + 双布局探测（纯只读，可先合并）
3. 构建/打包切源 + config 上移（依赖 1）
4. dev / preview / contract / init
5. 模板重排（最后，避免污染前几段验证信号）
6. 移除 legacy 探测（下一大版本）

**退路（已不需要）**：曾准备「若 oj 只接受显式映射 `--module <name>=<dir>`」的过渡方案，以及「构建期物化 `src/<n>/api → .ojm-stage/<n>/`」的 Plan B。v0.1.85 直接满足了 O1、O3、O7，两条退路均未启用。

## 10. 待定决策

| # | 议题 | v2 结论 | 影响 |
|---|---|---|---|
| D1 | 产物是否按模块聚合 | **否决**（§2.2）；如需视图，生成不参与运行的 `dist/view/` 副本 | 省掉锁/解析/预览三处重写 |
| D2 | 方案清单文件名 | 倾向 `solution.yaml`；过渡期双读 + 弃用告警（`bundle.ts:35`、`market/scan.ts:55`、`market/fixture.ts:130` 均读 `manifest.yaml`） | 改名是硬切换，需双读 |
| D3 | `web.config.ts` 是否退化为扫描 | **已定（2026-10-22）**：扫描 + 可选覆盖。清单 = `src/*/web/entry.ts`（字典序）；`web.config.ts` 只保留 `baseUrl`/`siteBase`/`htmlTransform`，`modules` 若存在则「显式顺序排前 + 未登记的按字典序追加」（**并集**，不是替换）；`enabled:false` 仍生效；登记了不存在的前端入口 → 报错。不特判 `home` 置首（顺序只影响 modules.json 数组序，菜单顺序另有 `handle.order`）。实现：`config.ts` 的 `mergeModuleList` | `config.ts` 缺 modules 不再抛（仅历史布局用 `assertModuleList` 保留旧校验） |
| D4 | config.yaml 落点 | **仓库根**，四处连带见 C-4 | 一次性 |

## 附录 A 专家评审与修订（2026-10-22）

五位评审视角：架构契约 / 构建工具链 / 安装运行时 / 前端体验 / 测试发布迁移。以下为裁决（全部经代码或实测复核）。

| # | 评审意见 | 裁决 | 落点 |
|---|---|---|---|
| 1 | 产物按模块聚合会断跨模块 import（产物实测 39+1 处 `../<mod>-<ver>/`） | **采纳（BLOCKING）** | §2.2、C-7；撤销 v1 的聚合目标 |
| 2 | `#/m/x` 以目录名为键，统一叫 `api` 后别名全撞 | **采纳（BLOCKING）** | C-8、O7 |
| 3 | config 上移砸 `oj.ts:52` 的 projectRoot 推导与 `mounts: api: src`、证书、db 路径 | **采纳（BLOCKING）** | C-4、§4D、§6 |
| 4 | 逐模块 `-o <tmp>` 会各写一份 `manifests.yaml`，锁与兄弟目录丢失 | **采纳（BLOCKING）** | §4B「单一输出根」 |
| 5 | preview/serve/migrate 四处硬编码 `api/dist` 扁平根 | **采纳（BLOCKING）** | §2.2-3、C-9 相邻约束 |
| 6 | 版本闸门只读 `bin/.oj-version`，build 无闸门；且「版本够、能力缺」真实存在 | **采纳（BLOCKING）** | §7「双探」 |
| 7 | 发布顺序倒置：oj 未发版时 ojm 升 MIN 会让 init/vendor 全线失败 | **采纳（BLOCKING）** | §7、§9-1 |
| 8 | `init.ts:81-88` 见 `bin/oj` 即跳过，新布局配旧 oj 开工即坏 | **采纳（BLOCKING）** | §4D、§7 |
| 9 | 枚举真源写错：模板多模块无 `solution.yaml`；纯前端模块清单不准 | **采纳（BLOCKING）** | C-6（改为 `api/manifest.yaml ∪ web/entry.ts`，附实测分类） |
| 10 | 复现脚本假定了一个当时尚不存在的 `--module-root`，且把嵌套错误的形态写错 | **采纳（BLOCKING）** | 实测口径：嵌套 = `module 'm1' missing manifest.yaml` 非零退出；`-d <模块目录>` = 0 module。0.1.85 落地后 `--module-root` 取源码树根，与 `-d` 互斥（§5） |
| 11 | 跨布局 sha256 等价不可满足 | **采纳（IMPORTANT）** | §8-1/§8-2 拆分 |
| 12 | `trial-real` 不在本仓，`ojm market trial` 只装 fixture、无 health/WS 断言 | **采纳（IMPORTANT）** | §8-3 改写 |
| 13 | 变更面漏 `oj.ts`、`contract/check.ts:284`、`contract/run.ts:87`、`dev.ts:97`、`usage.ts`、`init.ts:414`、`market/walkthrough.ts:157` | **采纳（IMPORTANT）** | §6 补全 |
| 14 | `create-module.ts` 不在 cli 内（脚手架入口是 `init.ts` 与 scripts/） | **采纳（MINOR）** | §4E |
| 15 | v1「config 进子目录会越界」表述因果倒置 | **采纳（MINOR）** | C-4 补充说明 |
| 16 | 双布局共存一个周期会腐烂（legacy 仅靠单测） | **采纳（IMPORTANT）** | §9 保留 legacy fixture + CI job + 弃用告警 |
| 17 | 建议加「模块视图」目录 `dist/view/` 满足「产物在一处」的直觉 | **部分采纳** | §2.2 末段：视图可生成，但不参与运行 |
| 18 | `manifest.yaml` 改名会打断存量方案仓 `--bundle` | **采纳（IMPORTANT）** | D2 改为双读 + 告警 |
| 19 | `deployWeb` 整树拷贝无白名单，手写/篡改包仍可塞别的模块 | **部分采纳** | 记为安装侧独立加固项（不在本改造范围，另开 PR） |
| 20 | 建议保留 `api/dist` 扁平根 | **采纳（BLOCKING）** | §2.1、§2.2、§4B/C |
