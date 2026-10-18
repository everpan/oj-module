# 解决方案 bundle · manifest.yaml 契约（v1.3）

> 状态：**定稿（P0/C2 交付物；v1.3 = P2 签名/信任/深检/目录增补）** · 日期：2026-10-17（v1.3 增补 2026-10-18） · 分支：`feat/lifecycle-p0` → P2 于 `feat/lifecycle-p2`
> 上游：PRD [`202610152345-solution-marketplace-framework-prd.md`](202610152345-solution-marketplace-framework-prd.md) §5.1/§5.2/§5.8/§5.9（原稿基底）· 设计 [`202610171138-solution-lifecycle-implementation-design.md`](202610171138-solution-lifecycle-implementation-design.md) §0 D4/D7/D12、§1 预检白名单、§6.3（决策修订）· spike [`202610171245-lifecycle-p0-spike-findings.md`](202610171245-lifecycle-p0-spike-findings.md)（oj 实测）· oj 上游源码 `oj/src/manifest.rs`（0.1.76 工作区 `../oj-bin`）
> 执行面：构建期 = `packages/cli/src/manifest-contract.ts`（P1-11，`ojm build --bundle` fail-fast）；安装期 = `templates/api/src/_platform/_lifecycle/steps/preflight.ts`（P1-5，可读中文 reason）。两端正则/规则**逐字一致**，由两枚夹具（`packages/cli/src/lifecycle/__tests__/fixtures/`）双端测试钉一致性（计划 §1「两运行时取舍」）。
> 规则编号 `C2-01`–`C2-33` 是契约条款的唯一引用 ID：P1-5/P1-11 测试、夹具 EXPECTED-VIOLATIONS、评审意见均按编号引用。

---

## 0. 契约定位与分层

| 维度 | 裁定 |
|---|---|
| 两层 manifest | **bundle 级 `manifest.yaml`**（tgz 内，分发与安装元信息，本文档定义）≠ **oj 模块级 `manifest.yaml`**（`api/<name>-<version>/` 内，oj 真实解析，仅 oj 原生七字段）。分层红线：bundle 字段**禁止**混入模块级文件（§3-OJ-X） |
| 唯一真源 | 本文档 = 构建器与安装器的**共同上游**。任何一端改规则必须先改本文档（含规则编号），再同步两端实现与夹具——契约先行纪律（D1） |
| 兼容底线 | bundle 契约是 oj 原生 schema 的**合法子集收紧**：凡 oj 会真实解析的字段（name/desc/version/tables/deps、模块名/版本白名单、扁平锁），契约口径必须 ⊆ oj 口径；冲突即拒装（spike S1-1.2/S1-1.3 实测 oj 拒启行为） |
| 演进方式 | append-only：新字段走 minor 增补并保持「P1 未声明字段省略合法」；不回收字段、不改既有字段语义（semver 语义见 C2-02）。**唯一明写例外**（v1.3，四方评审裁定的硬缺口）：Form B `archive.signature` 增补 `public_key` 为 P2 起必填——无公钥则验签无从执行、TOFU 无从钉定；老 Form B 缺 `public_key` = 拒装 + 迁移指引（§2.9，修订记录 v1.3 留痕） |
| 文案单一来源 | 十阶段失败文案 key（`lifecycle.stage.*`，附录 A）由本文档唯一维护，T3 状态机与 P1-13 CLI 渲染同表取用（R28/DRY） |

---

## 1. 顶层结构与必填性总览

```yaml
# ---- 身份（§2.1）----
name: …            # 必填
version: …         # 必填
title: …           # 可选
summary: …         # 必填（→ oj 模块 desc）
description: …     # 可选
icon: …            # 可选
author: …          # 可选
license: …         # 可选
homepage: …        # 可选
keywords: […]      # 可选
changelog: …       # 必填（R27 新增）

# ---- 兼容（§2.2）----
peerRuntime: …     # 可选（P1 起安装预检强制）
peerOj: …          # 可选（P1 仅声明）
peerFramework: …   # 可选（P1 仅声明）
peerPlatform: …    # 可选（P2 起强制，R23）

# ---- prefix（§2.3）----
api:               # 必填段（后端方案）
  module: …        # 可选（存在时必须 === name）
  prefix: …        # 可选（默认 /api/<name>）
  tables: […]      # 可选（存在时必须 === schema.yaml 表集）
  deps: {…}        # 可选
  anonymous: […]   # 可选
web:               # 可选段（纯后端方案可整体省略）
  route_prefix: …  # 可选（默认 /<name>）
  entry: …         # web 段存在时必填
  integrity: …     # 可选（构建器计算，安装器重算比对）
  css: […]         # 可选

# ---- RBAC（§2.5）----
permissions: […]   # 可选
roles: […]         # 可选

# ---- 路由分类（§2.6）----
routes: […]        # 可选（D4 三值）

# ---- 设置分组（§2.7）----
settings:
  groups: […]      # 可选

# ---- 冒烟探针（§2.10）----
health: …          # 可选（D14/Q-A：缺省首个非匿名路由兜底）

# ---- 分发与签名（§2.9）----
archive:           # tgz 内为占位（Form A）；CDN 聚合为真源（Form B）
  …
```

未列出的顶层键一律**拒绝**（构建期与安装期均报可读错误；防拼写漂移静默失效）。

---

## 2. 逐字段口径

约定：`<name>` = manifest 的 name 字段值代入；「双端」= 构建期（`ojm build --bundle`）与安装期（preflight）同规则执行。

### 2.1 身份

| 字段 | 类型 | 必填 | 校验规则 | 构建 | 安装 | 条款 |
|---|---|---|---|---|---|---|
| name | string | ✅ | `^[a-z][a-z0-9-]{0,63}$`；且 ∉ 保留名清单（§4.2，含 `market`，R9） | ✅ fail-fast | ✅ fail-fast | C2-01 |
| version | string | ✅ | 正则 `^(?!\\.)(?!.*\\.$)(?!.*\\.\\.)[0-9A-Za-z.-]+$`（即：字符集 `[0-9A-Za-z.-]`、无连续点、首尾非点）；等价白名单 `^[0-9A-Za-z.+-]+$`（R7）**叠加 oj 相容排除**：禁 `+`（oj validate_version 字符集无 `+`，携带即拒装）、禁 `..`（oj 硬拒）、禁 `_`（oj 虽允许，契约收紧）。语义 = semver 优先级比较（P1-1 `compareVersions`，缺段补零，`1.0`≡`1.0.0`）；比较规则与全部案例见**附录 C** | ✅ | ✅ | C2-02 |
| title | string ≤100 | ⬜ | 缺省 = name；市场卡片标题 | ✅ | ⬜（不阻断） | C2-03 |
| summary | string 1..200 | ✅ | 单行非空；**安装器写模块级 manifest 的 `desc` 即取本值**（oj 启动日志/依赖描述消费） | ✅ | ✅（非空） | C2-04 |
| description | string ≤2000 | ⬜ | 多行市场卡片正文 | ✅ | ⬜ | C2-05 |
| icon | string ≤500 | ⬜ | `^(https?:\/\/|\/)` | ✅ | ⬜ | C2-06 |
| author / license / homepage | string | ⬜ | license `^[A-Za-z0-9.\-+ ]{1,64}$`（SPDX 简化式）；homepage `^https?:\/\/` | ✅ | ⬜ | C2-07 |
| keywords | string[] ≤10 | ⬜ | 每项 `^[a-z0-9-]{1,32}$` | ✅ | ⬜ | C2-07 |
| changelog | string 或 string[] | ✅ | string 非空 ≤2000；string[] 每条非空 ≤500、≤50 条；市场卡片版本对比展示（R27） | ✅ | ⬜（P2 市场卡片消费） | C2-08 |

### 2.2 兼容（peer）

范围算子语法（四字段共用）：`^(>=|<=|>|<|\^|=)?<version>`（version 遵守 C2-02）。P1 语义实现集 = **精确（裸值/`=`）、`>=`、`^`**（同主版本且 ≥）；`<`/`<=` 构建期即拒（可读错误「暂不支持的范围算子」）。

| 字段 | 类型 | 必填 | P1 执行点 | P2+ 执行点 | 条款 |
|---|---|---|---|---|---|
| peerRuntime | string（范围算子语法见上） | ⬜ | **安装预检强制**：对宿主 `versions.json` 的 runtime 版本比对（P1-5 规则；loader 既有校验的安装期前置）；构建期校验语法 | 同 P1 | C2-09 |
| peerOj | string（同上） | ⬜ | 仅语法校验，不强制（声明不生效） | 对 `oj --version` 强制 | C2-10 |
| peerFramework | string（同上） | ⬜ | 仅语法校验，不强制 | 对框架版本强制 | C2-10 |
| peerPlatform | string（同上） | ⬜ | 仅语法校验，不强制 | 对 `GET /api/_platform/market/meta` 的 `apiVersion` 握手强制（R23） | C2-11 |

> 设计 §1 落点 #9 与计划 P1-5 明确 peerRuntime 属 P1 预检规则；本表按字段分别标注执行点，与「P1 阶段 peerOj/peerFramework/peerPlatform 仅声明不强制」并存。

### 2.3 prefix（PRD §5.8）

| 字段 | 必填 | 校验规则 | 构建 | 安装 | 条款 |
|---|---|---|---|---|---|
| api 段 | — | 纯前端方案（无 api 产物）可省略；省略时 §2.3/§2.4 内字段一并缺省 | ✅ | ✅ | C2-12 |
| api.module | ⬜ | 存在时必须 `=== name`（PRD §5.2「与 name 一致」）；其余值拒绝 | ✅ | ✅ | C2-12 |
| api.tables | ⬜ | string[]：每项 `^[a-z][a-z0-9_]{0,63}$`；存在时必须与 `api/src/<name>/schema.yaml` 的 tables 键集**逐一相等**（oj 冗余校验同源，不一致 fail-fast） | ✅ 对照 schema.yaml | ✅ 语法（oj 安装后冗余校验兜底） | C2-12a |
| api.deps | ⬜ | map：键匹配 C2-01 语法或 `_platform`；值 = §2.2 范围算子语法；依赖存在性由 oj serve S004 检查兜底（安装器不做存在性，避免共享根状态依赖进入纯函数校验） | ✅ 语法 | ✅ 语法 | C2-12b |
| api.prefix | ⬜ | 默认 `/api/<name>`；显式给出时须匹配 `^\/api\/[a-z][a-z0-9-]{0,63}$`，且去 `/api/` 后的首段 ∉ 保留名（§4.2）；安装期做**占用检测**（已被已装方案/框架内建占用 → 拒装并报占用者） | ✅ 语法+保留名 | ✅ 语法+保留名+占用 | C2-13 |
| web.route_prefix | ⬜ | 默认 `/<name>`；显式给出时须匹配 `^\/[a-z][a-z0-9-]{0,63}$`，首段 ∉ 保留名；安装期占用检测 | ✅ | ✅ | C2-14 |

统一性红线（PRD §5.8.1「一处命名贯穿三处」）：codegen 的 `API_PREFIX`、模块级 routes 自声明 pattern 首段、`api.prefix` 三者一致；`api.prefix` 覆盖非默认值时，`api.anonymous` 条目首段与 web.entry 路径段随之换算（PRD §5.8.3）。

### 2.4 匿名路径（api.anonymous）

| 字段 | 必填 | 校验规则 | 构建 | 安装 | 条款 |
|---|---|---|---|---|---|
| api.anonymous | string[] ⬜ | 每条：① 语法 `^[a-z0-9][a-z0-9\-_.]*(\/[a-z0-9][a-z0-9\-_.]*)*$`（挂载前缀相对、无前导斜杠、无通配符——匹配语义由 oj anonymous_paths 既有语义承担）；② **段内收敛**：首段必须 `=== <api.prefix 的模块段>`（默认即 name；R8 预检规则「前缀 ∈ `<name>/`」；`_system`/`_platform` 等段因此天然禁入）；③ **登录端点禁令**（R8/S1 纵深防御）：命中 `(?i)(?:^|\/)(?:[a-z0-9_.-]*-)?(?:login|logout|token|session|signin|signup|auth)(?:\/|$)` → 拒装；④ 本 manifest 内唯一 | ✅ ①②③④ | ✅ ①②③④ | C2-26 |

### 2.5 RBAC（PRD §5.9）

| 字段 | 必填 | 校验规则 | 构建 | 安装 | 条款 |
|---|---|---|---|---|---|
| permissions[] | ⬜ | 每项：`code` 必填 `^<name>\.[a-z0-9_]+(\.[a-z0-9_]+)*$`（**强制 `<name>.` 前缀**——框架保留命名空间 framework./system./market. 等由此不可达）；`title_key` 必填（i18n 契约 §2.8，`<name>:perm.*`）；code 本 manifest 内唯一 | ✅ | ✅ | C2-15 |
| roles[] | ⬜ | 每项：`name` 必填 `^<name>\.[a-z0-9-]{1,64}$`（写入 `sys_role.module=<name>`）；`title_key` 必填（`<name>:role.*`）；`permissions[]` 每项必须 ∈ permissions[].code（**悬空引用双端拒绝**）；name 本 manifest 内唯一 | ✅ | ✅ | C2-16 |

升级稳定性（PRD §5.9.6，非本表校验项）：注册 upsert 只加法 + 元数据覆盖，声明消失标 `deprecated`（P1-8 语义）。

### 2.6 路由分类（D4 三值）

| 字段 | 必填 | 校验规则 | 构建 | 安装 | 条款 |
|---|---|---|---|---|---|
| routes[] | ⬜ | 每项：`category` ∈ **`main \| admin \| hidden`**（D4 收敛；PRD §5.2 的 settings/personal 两值**废弃**）；`path` 必填 `^\/[a-z][a-z0-9\-_]*(\/[a-z0-9\-_]+)*$`（首段首字符为字母——与 C2-13/14 前缀语法同构，兼容连字符名 `/demo-solution`；无参数段/无通配符/无尾斜杠），本 manifest 内唯一；`order` 必填 int（**建议 ≥200**——框架项保留 <200 间隔带，设计 §3.1；越带仅构建期 lint 警告不阻断）；`title_key`：main/admin 必填、hidden 可省（`<name>:menu.*`）；`required_permission` 可选，存在时必须 ∈ permissions[].code（**R22：仅供后端深检比对，solution-routes 端点不下发、前端不做权限级菜单过滤**） | ✅ | ✅ | C2-17~21 |

双源一致（设计 §6.3，A1 已定）：`manifest.routes[].path` ↔ 模块 `entry.js` 的 `defineModule.routes` path——**安装期校验，默认 warn、可配 fail**；manifest.routes 只承担分类与菜单归属，不重复声明路由。

### 2.7 设置分组（R20/R24）

| 字段 | 必填 | 校验规则 | 构建 | 安装 | 条款 |
|---|---|---|---|---|---|
| settings.groups[] | ⬜ | 每组：`group` 必填 `^[a-z][a-z0-9-]{0,63}$` 且本 manifest 内唯一（组标识 = `sys_setting.group` 值）；`label_key` 必填 `^<name>:settings\.group\.[a-zA-Z0-9_.-]+$`（系统设置页三层嵌套的组标题，D4）；`items[]` 非空数组 | ✅ | ✅ | C2-22 |
| items[].key | ✅ | `^<name>\.[a-z0-9_-]+(\.[a-z0-9_-]+)+$` 且 **`moduleOf(key) === name`**（R24：键所有权 fail-fast，首段即 moduleOf；`framework.*`/`system.*` 等越空间污染由此拒绝）；本 manifest 内唯一 | ✅ | ✅ | C2-23 |
| items[].type | ✅ | 枚举 `string \| bool \| int \| float \| enum \| text`（值恒以字符串存 `sys_setting.value`） | ✅ | ✅ | C2-24 |
| items[].default | ⬜ | string（缺省空串） | ✅ | ⬜ | C2-24 |
| items[].options | type=enum 时必填 | string[] ≥1 项；非 enum 时省略 | ✅ | ✅ | C2-24 |
| items[].secret | ⬜ | bool（缺省 false；true 读取面掩码 `***`，对齐 `_shared/service/settings.ts` 既有列） | ✅ | ⬜ | C2-24 |
| items[].label_key | ⬜ | `^<name>:settings\.[a-zA-Z0-9_.-]+$` | ✅ | ⬜ | C2-24 |

> PRD §5.2 原稿为单 group（`settings.group/title_key/items`）；设计 §3.4 三层嵌套模型（方案设置分组 Card×N）升级为 `groups[]`，契约从新（附录 B-3）。

### 2.8 i18n key 契约（D4）

方案 i18n 以模块名为 i18next 命名空间；契约强制前缀：

| key 模式 | 用途 | 校验 | 条款 |
|---|---|---|---|
| `<name>:menu.*` | 方案页面标题（路由 title_key、菜单） | 双端语法校验；深检查值（P2） | C2-25 |
| `<name>:settings.group.*` | 系统设置页方案分组标题 | 同上 | C2-25 |
| `<name>:perm.*` / `<name>:role.*` / `<name>:settings.*` | 权限点/角色标题、设置项 label | 同上 | C2-25 |

locales 完整性：`locales/zh-CN.json` 与 `en-US.json` 必须携带 manifest 引用的**全部** key（双语齐备）；构建期对缺失 key 报错（fail-fast），安装期不重复校验文件内容（信任构建产物，深检兜底）。

### 2.9 web 产物与分发签名（PRD §5.1/§5.7，D7，R10/R27/R30）

| 字段 | 必填 | 校验规则 | 执行点 | 条款 |
|---|---|---|---|---|
| web.entry | web 段存在时 ✅ | `^modules\/<name>\/<version>\/[a-z0-9\-._\/]+\.js$`（**版本段必须 === version**；POSIX 分隔符 R30；字符集天然拒 `..`/反斜杠/绝对路径） | 构建 ✅ / 安装 ✅（extract 段对 tgz 内成品复核存在性） | C2-27 |
| web.css[] | ⬜ | 同 entry 语法，`.css$` 结尾 | 同上 | C2-27 |
| web.integrity | ⬜ | `^sha384-[A-Za-z0-9+/]{64}$`；构建器对 entry 产物计算写入；**安装器重算比对，不一致拒装**。R10 关系：P1 实现为其**子集**——无签名阶段 CDN 与安装器同信任域，计算值留痕于 modules.json；P2 验签通过后计算，承接 R10 全量语义（integrity 必须基于包内容，防 manifest 与产物错配） | 构建 ✅ / 安装（deployWeb→smoke）✅ | C2-28 |
| archive.file | Form B ✅ | `^<name>-<version>\.tgz$` | P3 publish 填充 | C2-29 |
| archive.sha256 | Form B ✅ | `^[a-f0-9]{64}$` | 安装期 verify 段 fail-closed 比对 | C2-29 |
| archive.size | Form B ✅ | 正整数（字节） | 同上 | C2-29 |
| archive.signature | P2 起 Form B ✅ | `{alg: "Ed25519", key_id: string, public_key: hex64, value: base64}`；签名原文 = 规范串 `<name>@<version>:<sha256>`（格式表见 §2.11，C2-34）；**`public_key` v1.3 起必填**（验签需要公钥；附录 B-14 为 append-only 明写例外）——老 Form B 缺 `public_key` = 拒装 + 可读迁移指引；P2 fail-closed（`crypto.verifyEd25519`，编码约束 C2-36）。**file 源签名载体 = detached 侧车 `<name>-<version>.tgz.sig`**（字段同构，C2-35），与 Form B 同源同语义——Form A 禁带 signature 的自引用悖论（B-2）由侧车消解，file 源与 CDN 源同一信任模型（G4） | P2 安装期 verify 段 | C2-29/34/35 |

**archive 两形态裁定（自引用悖论消解，附录 B-2）**：

| 形态 | 位置 | archive 段 |
|---|---|---|
| Form A（构建产物） | tgz 内 `manifest.yaml` | 可整体省略，或仅含 `file`；**禁止**携带 sha256/size/signature（对 tgz 自身摘要不可自洽） |
| Form B（发布真源） | CDN `manifests.yaml` 聚合数组内该 (name, version) 条目 | 全字段；由 P3 `ojm publish` 填充与校验 |
| detached 侧车（v1.3，G4 补裁） | 与 tgz 同目录 `<name>-<version>.tgz.sig`（CDN 分发与 file 源本地安装共用） | 仅签名四字段 + `canon`（C2-35）；file 源安装时 `ojm install` 自动探测同目录侧车随包上传，缺签即拒（fail-closed 无逃生门） |

安装器消费顺序：`bundles.yaml`（版本/文件/校验）→ Form B manifest 或 detached 侧车（签名，P2）→ tgz 内容。P1 无签名阶段 CDN 与安装器同信任域（sha256 仅防传输损坏，设计 §10 未修订说明 ①）。

**tgz 内布局（C2-30/31/32）**：

```text
<name>-<version>/                 # tgz 唯一根目录（单根 = 解压落位与守卫的最简形态）
├── manifest.yaml                 # bundle 级契约（Form A）
├── api/
│   └── <name>-<version>/         # oj 版本目录（oj build 产物原样）
│       ├── manifest.yaml         # oj 模块级（oj 真实解析）
│       ├── routes.js、schema.yaml、seed.sql?、migrations/
│       └── **/api.js             # 编译产物
└── web/
    └── modules/<name>/<version>/
        ├── entry.js
        └── *.css
```

- C2-30：tgz 成员守卫 = **list→validate→extract 三步**（R1/P1-2）：绝对路径、`..` 段、symlink/hardlink（`-tvzf` 首列 `l`/`h`）一律拒绝；零解压失败（spike S1-2.2：tar 忠实还原链接，校验为安全必需）。
- C2-31：tgz 内 `api/<name>-<version>/manifest.yaml` 必须存在，且 `name ===` bundle name、`version ===` bundle version、`desc ===` bundle summary（oj 启动强校验 name==目录名，spike S1-1.3）；仅允许 oj 原生七键（§3）；**`modules.json` 不得出现在 tgz 任何位置**（PRD §5.1 硬约束：modules.json 条目由安装器在目标站点 upsert，防覆盖宿主清单）。
- C2-32：确定性 tgz（构建期专属）：固定 mtime=0、成员字典序、权限 0644/0755、无 owner 信息——同输入两次打包 sha256 相等（P1-11 验收）。

### 2.10 health（可选，D14/Q-A）

| 字段 | 必填 | 校验规则 | 构建 | 安装 | 条款 |
|---|---|---|---|---|---|
| health | ⬜ | string；值匹配 **C2-17 path 语法**，且存在 r ∈ routes[] 使值 `=== r.path` 或以 `r.path + "/"` 开头（本方案路由或其子路径）。双端校验 = 格式 + 存在于 routes[]。**冒烟语义（设计 §4.1，D14/Q-A 拍板：health 不强制）**：smoke 优先打该端点；缺省打首个非匿名路由兜底。匿名可达性由作者经 `api.anonymous` 自行声明——health 不豁免 C2-26 段内收敛规则 | ✅ | ✅ | C2-33 |

> 与 oj 的关系：oj 原生 Manifest 无 health 字段（spike S1-5.3 实测），故 health 仅存在于 bundle 级 manifest（本文档层），不进入模块级文件——与 §3 对照表相容。

### 2.11 签名与信任（P2，G3/G4/G5 裁决固化）

**规范串格式（C2-34，P2-1 逐字实现）**：

| 项 | 口径 |
|---|---|
| 函数 | `canonicalString(name, version, sha256)` |
| 拼接式（逐字） | `<name>@<version>:<sha256>`——`name` 与 `version` 取 bundle manifest 值，`sha256` = tgz 字节的 sha256（hex 小写）；三段之间仅 `@` 与 `:` 两个分隔符，**禁止自造分隔符/归一化/大小写变换** |
| 版本标记 | `canon` 字段恒 `"v1"`（规范串格式演进时递增；验签前先比对，不认识即 `sig_format`） |

**detached 侧车 `.sig` 字段表（C2-35；Form B `archive.signature` 与之同源同构）**：

| 字段 | 类型 | 校验 | 条款 |
|---|---|---|---|
| `alg` | string | 恒 `"Ed25519"`（大小写敏感；其余值 = `sig_alg`） | C2-35 |
| `key_id` | string | `<publisher>.<id>` 全小写（C2-37）；信任库比对用 | C2-35/37 |
| `public_key` | string | **必填**，`^[0-9a-f]{64}$`（Ed25519 32B raw 公钥 hex；禁 PEM/SPKI——C2-36） | C2-35/36 |
| `value` | string | 标准 base64（`^[A-Za-z0-9+/]+={0,2}$`，含 `-`/`_` 即 `sig_format`，**禁 base64url 归一**） | C2-36 |
| `canon` | string | 恒 `"v1"`（见规范串版本标记） | C2-34 |

**编码约束（C2-36，上游 `crypto.verifyEd25519` 语义）**：`value` 仅标准 base64；`public_key` 仅 32 字节 raw 的 hex（上游 `decode_key` 兼收 base64 由实现层适配，PEM/SPKI 一律拒）。**双层语义同为拒装**：格式类错误抛错（消息 `verifyEd25519: ` 前缀）→ 转 `sig_format`；验签不过返回 `false` → `tampered`。原语不可得（面未注入且运行时全局缺失）= 拒装，与 `sha256Hex` 既有口径一致（fail-closed，无静默跳过）。

**`key_id` 命名空间（C2-37）**：`<publisher>.<id>` 两段以上、全小写 `[a-z0-9-]`；**禁裸通用名**（`default`/`test`/单段无点）——防 key_id 抢注/碰撞（R9 保留名、R24 键所有权同款洞）；违反归 `sig_format`。

**TOFU 三态与信任库（C2-38，G3 双轨）**：

| 态 | 定义 | 安装行为 |
|---|---|---|
| `trusted` | `key_id` 在宿主信任库且公钥逐字一致 | 验签通过即装 |
| `unknown` | `key_id` 不在信任库（其余全合法） | 任务停 `needs_trust` 第五终态 + 展示指纹（`sha256Hex(publicKey)` 全 64 hex，UI 分组）；staging **不清场**供确认后重试；`ojm trust confirm --task` / `POST /api/_platform/market/trust {task_id}` 确认后入库 |
| `rejected` | 确认被拒 / 公钥与已绑定不一致 | 不装；`trust_bound_mismatch` 独立错误 |

信任库形态：`.solutions/trusted-keys.yaml`（`key_id → {public_key, added_at}`），原子写（D13）+ `.bak`；**首次绑定不可改**（同 `key_id` 异公钥 = `trust_bound_mismatch`；轮换 = 新增 `key_id` 共存，禁覆写）；宿主可预置第一方 key 免 TOFU（bootstrap，P2-12）；损坏 = fail-closed 可读报错。

**吊销语义（C2-39，G5）**：吊销 = 从信任库移除 `key_id`，**只阻断新装/升级，不动已装方案**（存量可用性承诺）；移除动作审计留痕（`key_id` + 指纹 + operator）。

**切换前复验口径（C2-40，D11③ 与 G5 调和）**：升级/回滚/降级 = 重新取包走**完整验签**（key 已吊销即拒，sha 与 sidecar 不符 = `tampered`）；**enable（原版本恢复）不算新装 → 放行 + 显著告警 + 审计 + 深检标 `untrusted`**；sidecar 缺 `archive` 真源（P1 时代安装）= enable 放行 +「无验签真源」告警，升级仍走完整验签。

**失败六码（附录 A.2 定义文案 key；retryable 恒 false；一律零解压零落盘）**：`sig_missing`（无 `.sig`/Form B 无 signature）/ `sig_alg`（alg 非 Ed25519）/ `sig_key`（key_id 命名空间违规、已信任但公钥不一致）/ `tampered`（验签 false）/ `unknown_key`（→ `needs_trust`）/ `sig_format`（编码违规、抛错类）。

### 2.12 市场索引扩展（IndexRow，P2，C2-41）

`GET /api/_platform/market/index` 的 IndexRow 在既有字段（name/version/archive/summary 等）上增补：

| 字段 | 类型 | 口径 | 条款 |
|---|---|---|---|
| `available[]` | string[] | CDN 可下载版本列表（回滚候选不止本站已装旧版——P1-15b 边界收口）；CDN 不可达降级为空数组 | C2-41 |
| `changelog` | string 或 string[] | 透传 manifest changelog（C2-08）供市场卡片版本对比（R27） | C2-41 |
| `trust_state` | enum | `trusted`（当前发布方 key 在信任库）/ `untrusted`（不在或已吊销，enable 告警同源）/ `absent`（无签名真源） | C2-41 |
| `publisher` | string | 发布方标识（= `key_id` 的 `<publisher>` 段；无签名省略） | C2-41 |

`operator` **不挂 IndexRow**（挂卡片行是历史动作语义错位）——回落 `market_history` 行（P1-16 已补通道）。索引本身未签名（P3-U3 索引签名）；P2 低成本加固 = `archive.file` 逐字 `<name>-<version>.tgz` + 下载后立即比 `archive.size`（P2-11）。

### 2.13 深检报告结构（P2，C2-42）

`POST /api/_platform/solutions/verify?name=`（admin 域）返回 `VerifyReport = {ok, checks[], advise[]}`；item 统一结构：

| 字段 | 口径 |
|---|---|
| `id` | 检查项标识（`routes`/`rbac`/`settings`/`ledger`/`i18n`/`trust`） |
| `severity` | `error`（必须处理）/ `warn`（建议处理）/ `info`（说明） |
| `subject` | 差异主体（如路由 path、权限 code、设置 key——**永不包含设置值**，secret 场景同样只报 key/存在性） |
| `advise_key` | 修复建议 i18n key（`<name>:verify.<id>.<subject 归一>` 或框架 `lifecycle.verify.*`；**双语可读可行动**——「看得见但不知怎么做」即不合格） |

深检**全程不触 exec**（迁移账本走 `db.query _oj_migrations` + `journalHeadOf`，R9 纪律）；i18n 项前端执行（浏览器 i18next），本仓只下发待查 key 清单，缺执行降级「未校验」不阻断。报告落 `.solutions/verify-reports/` 时间序保留 N=10。

---

## 3. oj 原生 Manifest struct 逐字段对照表

oj 0.1.76 `oj/src/manifest.rs:7-22`（`Manifest` struct）+ `:25-47`（`validate_module`/`validate_version`）。安装后 oj 真实解析模块级 manifest 与扁平锁；任何字段冲突 = 拒装/拒启（spike S1-1 实测）。

| oj 原生 | oj 口径 | 契约侧字段 | 相容裁定 |
|---|---|---|---|
| `name: String`（必填） | `validate_module`：非空、`[A-Za-z0-9_-]` | C2-01 `name`：`^[a-z][a-z0-9-]{0,63}$` | ✅ 契约集 ⊆ oj 集（禁大写/下划线为收紧） |
| `desc: String`（必填） | 任意字符串 | C2-04 `summary`（1..200 单行）→ 安装/构建核对 `desc === summary` | ✅ 非空保证强于 oj |
| `version: String`（必填） | `validate_version`：非空、`[A-Za-z0-9._-]`、无 `..` | C2-02：`[0-9A-Za-z.-]`、无 `..`、首尾非点、禁 `+`/`_` | ✅ 契约集 ⊆ oj 集；`+` 被契约明确排除正是因 oj 拒绝（附录 B-1） |
| `config: Value`（可选） | serde 缺省 | 契约不声明；模块级文件省略 | ✅ 缺省合法 |
| `db: Option<String>`（可选） | 绑定命名库 | 契约 P1 不声明；模块级文件省略（oj 落 default 库）。如未来需要 → 契约 minor 增补 | ✅ 缺省合法（有意省略，附录 B-6） |
| `tables: Vec<String>`（可选） | 与 schema.yaml 冗余校验，不一致 fail-fast | C2-12 `api.tables`：构建期对照 `api/src/<name>/schema.yaml` 表集 | ✅ 两侧同源校验 |
| `deps: HashMap<String,String>`（可选） | 键=模块名（归属守卫+S004 存在性检查；值不被 oj 解析） | `api.deps`：键匹配 C2-01 语法或 `_platform`；值 = C2.2 范围算子语法 | ✅ oj 仅查存在性，值语义由安装器承担 |
| `validate_module`（目录名/锁键） | name 必须 == 版本目录名（S1-1.2/S1-1.3 实测拒启） | C2-30/31：tgz 根 `<name>-<version>/`、api 版本目录名 `<name>-<version>` | ✅ 由布局约束保证 |
| `manifests.yaml` 扁平锁 `BTreeMap<String,String>` | 非 map / 嵌套结构 = 解析失败拒启（R5/D12） | 契约不定义锁格式；bundle 不携带锁（安装器写 oj 原生扁平格式） | ✅ 不触碰 |

**分层红线（OJ-X）**：oj `Manifest` derive 未声明 `deny_unknown_fields`，未知键今日会被**静默忽略**——因此不得借「oj 不报错」把 bundle 字段混写进模块级 manifest.yaml（上游未来收紧解析即全量炸装）。模块级文件仅允许 oj 原生七键：`name/desc/version/config/db/tables/deps`。双端校验：构建期核对 + 安装期 extract 段复核。

---

## 4. 双端执行矩阵与保留名

### 4.1 规则 → 执行点矩阵

| 条款 | 规则摘要 | 构建期（P1-11 `validateContract`） | 安装期（P1-5 `preflight`） | 其他安装段 |
|---|---|---|---|---|
| C2-01/02 | name/version 白名单 + 保留名 | ✅ fail-fast | ✅ fail-fast | — |
| C2-03~08 | 身份可选字段 + changelog | ✅ | 仅 summary 非空 | — |
| C2-09 | peerRuntime 对宿主 versions.json | 语法 | ✅ 强制比对 | — |
| C2-10/11 | peerOj/Framework/Platform | 语法（P1） | 声明不强制（P1） | P2 meta 握手 |
| C2-12~14（含 12a/12b） | prefix 语法/保留名；api.tables 对照 schema.yaml；api.deps 语法 | ✅ | ✅ | 占用检测：preflight |
| C2-26 | anonymous 语法/段内收敛/登录禁令 | ✅ | ✅ | config 并入校验：reload 段（R18） |
| C2-15/16 | RBAC 前缀/悬空引用 | ✅ | ✅ | 注册 upsert：register 段（P1-8） |
| C2-17~21 | 路由三值/path/title_key | ✅ | ✅ | 双源一致 warn 可配 fail：registering 段（A1） |
| C2-22~24 | 设置组/键所有权 | ✅ | ✅ | 注册 upsert：register 段 |
| C2-25 | i18n key 语法 + locales 齐备 | ✅（缺 key fail-fast） | 语法 | 深检查值（P2） |
| C2-27/28 | web 路径/integrity | ✅ 语法/计算 | ✅ 语法 | integrity 重算比对：deployWeb→smoke |
| C2-29 | archive Form B / detached 侧车 | 拒绝 Form A 携带 sha256/signature；侧车字段结构（v1.3：public_key 必填） | — | sha256 比对：verify 段；验签（Form B + 侧车）：P2 verify 段（六码附录 A.2） |
| C2-34~37 | 规范串格式 / .sig 字段 / 编码约束 / key_id 命名空间 | `ojm sign` 写入侧检（P2-4） | — | 结构校验序（alg→key_id→public_key→value→规范串→信任库→验签）：P2-3 verify 段 |
| C2-38 | TOFU 三态 + 信任库 + 首次绑定不可改 | — | — | 信任库读写（P2-2）；needs_trust 终态与确认端点（P2-3） |
| C2-39 | 吊销只阻断新装/升级 | — | — | 信任库移除即吊销（P2-2）；切换前复验（P2-6） |
| C2-40 | 切换前复验口径 | — | — | 升级/回滚完整验签 + enable 放行告警（P2-6）；sidecar archive 随安装落（P2-6） |
| C2-41 | IndexRow 扩展字段 | — | — | 聚合下发（P2-11）；file 逐字 + size 比对（P2-11） |
| C2-42 | 深检报告 item 结构 | — | — | 四项检查 + 留存 N=10（P2-7/8） |
| C2-30/31 | tgz 守卫/分层核对 | ✅（打包自检） | — | list→validate→extract + 成品核对：extract 段 |
| C2-32 | 确定性 tgz | ✅（专属） | — | — |
| C2-33 | health 可选：path 格式 + 存在于 routes[] | ✅ | ✅ | smoke 优先探针；缺省首个非匿名路由兜底（D14/Q-A） |

### 4.2 保留名清单（C2-01/13/14 共用）

`_platform` / `system` / `auth` / `market` / `framework` / `health` / `plugins` / `_system`（PRD §5.8.2；`market` 经 R9 恢复保留——第三方取名 `market` 可自 declare `market.*` 抢注编排面）。适用于：name、`api.prefix` 模块段、`web.route_prefix` 首段。`_platform`/`_system` 因 name 正则首字母限制不可达，保留列出以覆盖 prefix 覆盖场景。

---

## 5. 测试夹具（双端唯一真源）

位置：`packages/cli/src/lifecycle/__tests__/fixtures/`（清单与双端测试约定见该目录 `README.md`）。

| 夹具 | 期望 | 覆盖 |
|---|---|---|
| `fixture-valid/` | 双端零违规 | 契约全部字段（§1 全键出现且合法；含 D4 三类路由、enum/secret 设置项、多组 settings、空 migrations 目录、archive Form A 仅 file） |
| `fixture-invalid/` | 七码齐报：C2-01/02/16/17/22/23/26 | 每码一条内在违规，逐条对照 `fixture-invalid/EXPECTED-VIOLATIONS.md` |
| `sig/`（v1.3，P2-0） | 签名链三态：已签过 / 篡改拒 / 未知 key | `demo-solution-0.2.0.tgz` 共用包体 + `.sig`（TRUSTED_KEY）/ `.bad.sig`（value 篡改）/ `.unknown.sig`（UNKNOWN_KEY）；由 `sig/gen-signed-fixtures.mjs` 确定性再生（seed 派生测试 key，私钥不入仓）；CLI 面 `sig-fixtures.test.ts` 与 templates 面 `tests/lifecycle/sig-fixtures.spec.ts` 双端断言「规范串逐字 + 指纹值 + 验签结果」；P2-3 isolate 六码/TOFU 以同组夹具为锚 |

规则演进纪律：改任一端正则前必须先改本文档对应条款 → 同步夹具 → 双端测试全绿（夹具是两份实现唯一共同真源，计划 §1「DRY 于夹具而非运行时」）。

---

## 附录 A · 十阶段失败文案 key 全表（`lifecycle.stage.*`，R28）

key 骨架：`lifecycle.stage.<stage>.reason` / `.hint` / `.retryable`；宿主为框架 locales（`lifecycle` 命名空间，方案不携带）。`reason`=可读失败原因，`hint`=可操作指引，`retryable`=重试标注文案（全局两值，全 stage 共用：zh「本次失败可重试」/「本次失败不可自动重试」；en「This failure is retryable」/「This failure is not retryable」）。运行期 `TaskRecord.error.retryable` 为布尔，UI 标注文案取 `.retryable` key。

stage 名 = 安装状态机 `InstallStage`（lifecycle 设计 §10.2）逐字；`lock_commit` 为 P1-10 内部 stage 的**扩展组**（D11①锁前语义收尾，附录 B-5）；`audit` 失败仅记日志，不设 key。

| stage | zh-CN reason | zh-CN hint | retryable 默认 |
|---|---|---|---|
| preflight | 预检未通过：{detail}（保留名/占用/白名单/键所有权/兼容不符） | 请修正方案清单或释放占用的名称与前缀后重新安装 | ✗ |
| downloading | 下载失败：无法从分发源获取 {file} | 请检查网络与市场地址（框架设置 → 市场源），稍后重试 | ✓ |
| verifying | 校验失败：{file} 摘要与索引不符 | 分发包可能损坏，请重试下载；持续失败请联系发布方 | ✓ |
| extracting | 解压失败：包内容未通过安全校验（{detail}） | 安装已终止且零落盘；若反复出现，请勿使用该分发包并联系发布方 | ✓ |
| migrating | 数据库迁移失败：{detail} | 数据已保留原状，请修复后重试；必要时回退到上一版本 | ✓ |
| lock_commit | 生效切换失败：写入模块锁未通过读回校验 | 存在并发构建或安装，请稍后重试 | ✓ |
| registering | 注册失败：{detail}（路由/设置/RBAC） | 请重试；多次失败请检查站点数据库状态 | ✓ |
| deploying_web | 前端落位失败：{detail}（modules.json / 产物写入） | 请重试；方案已部分生效，若持续失败请禁用该方案 | ✓ |
| reloading | 热更失败：配置未生效（{detail}） | 站点仍在使用旧配置服务，请稍后重试或联系运维 | ✓ |
| smoke | 冒烟检查未通过：{detail} | 方案已部分生效，请按详情排查；可先禁用该方案恢复原状 | ✗ |
| done | 安装完成：{name} {version} | 刷新页面即可使用新方案 | — |

双语要求：每个 key 必须同时具备 zh-CN 与 en-US 值（T3 文案模板与 P1-13 CLI 渲染同表取用，缺失即测试红）。

### A.2 verifying 段签名失败六码（v1.3，P2；双语值由 P2-5 落 templates locales，缺失即测试红，同 C2-25 纪律）

文案 key 骨架：`lifecycle.stage.verifying.<code>`（reason/hint 同 §A 骨架）。retryable 恒 `false`；六码一律**零解压零落盘**（verify 段先于 extracting）。

| code | 触发条件（逐字） | 文案 key | 附加语义 |
|---|---|---|---|
| `sig_missing` | 无 detached `.sig` 且 Form B 无 `signature`（G4 硬 fail-closed，无逃生门开关） | `lifecycle.stage.verifying.sig_missing` | — |
| `sig_alg` | `alg` 非恒 `"Ed25519"`（大小写敏感） | `…verifying.sig_alg` | — |
| `sig_key` | `key_id` 命名空间违规（C2-37）；或已信任但公钥与信任库绑定不一致 | `…verifying.sig_key` | 后者同 `trust_bound_mismatch` 族 |
| `tampered` | `verifyEd25519` 返回 `false`（包体/key/value 任一不符） | `…verifying.tampered` | 与 sha256 比对失败（既有 `verifying` reason）分流 |
| `unknown_key` | `key_id` 不在信任库（其余全合法） | `…verifying.unknown_key` | → 任务终态 `needs_trust` + `TaskRecord.trust{key_id,fingerprint}`；staging 不清场 |
| `sig_format` | 编码违规：`public_key` 非 64hex、`value` 非标准 base64（含 `-`/`_`）、`canon` 非 `v1`；或 `verifyEd25519` 抛错（`verifyEd25519: ` 前缀，isolate 内 try/catch 转码） | `…verifying.sig_format` | 抛错与返回 false 同拒装但分码（双层语义） |

---

## 附录 B · 问题记录（编码/定稿过程中发现，按类归档）

| # | 分类 | 问题 | 处置 |
|---|---|---|---|
| B-1 | 与业界/上游不符 | 简报与 R7 的 version 白名单 `^[0-9A-Za-z.+-]+$` 含 `+`（semver build metadata），但 oj `validate_version` 字符集为 `[A-Za-z0-9._-]`——`+` 版本过构建器、必被 oj 拒装，双端不一致 | 契约叠加 oj 相容排除（禁 `+`，C2-02）；正则收敛为 `[0-9A-Za-z.-]` + 无 `..` + 首尾非点 |
| B-2 | 反常识（自引用悖论） | PRD §5.2 把 `archive.sha256`（tgz 自身摘要）写在 tgz 内的 manifest 里，数学上不可自洽 | 定义 Form A（tgz 内占位，禁 sha256/signature）/ Form B（CDN 聚合真源）两形态（C2-29）；publish 时填充 |
| B-3 | 上游演化 | PRD §5.2 routes category 五值（main/admin/settings/personal/hidden）与 D4 三值冲突；settings 单 group 与设计 §3.4 Card×N 冲突 | 契约从新：category ∈ 三值（C2-17）；`settings.groups[]`（C2-22） |
| B-4 | 上游事实 | oj `Manifest` 无 `deny_unknown_fields`，未知键静默忽略——「oj 不报错」不可作为 bundle 字段混入模块级 manifest 的依据 | 分层红线 OJ-X：模块级仅 oj 原生七键，双端核对（§3） |
| B-5 | 语义空缺 | P1-10 内部 stage `lockCommit` 在十阶段 `InstallStage` 无对应文案 key；`audit` 失败不可见 | 附录 A 增 `lock_commit` 扩展组（D11①锁前语义）；audit 失败仅日志（不设 key） |
| B-6 | 有意省略 | oj `db`（命名库绑定）、`config` 字段契约未承接 | P1 无使用场景，省略保持兼容（§3 对照表留痕）；需要时走 minor 增补 |
| B-7 | 上游事实 | `sys_setting.type` 为自由字符串（`settings.ts` 直读），渲染端未按 type 分派 | 契约枚举 `{string,bool,int,float,enum,text}` 为双端校验集（C2-24）；渲染端 P1-14 对齐 |
| B-8 | 平台缺面（P1-13 真机实测） | oj isolate 无 `structuredClone`——state.ts 快照读用它，真机 500 | 手写逐条目浅拷贝 `snapshot()` 单点替换（`_lifecycle/state.ts`） |
| B-9 | 平台缺面（P1-13 真机实测） | oj `fs` 全局面缺 `copyFile`；目录列举叫 `readDir` 且形状为 `AsyncIterable<DirEntry>`（非 `string[]`）；`crypto` 无 `randomUUID`（仅 `randomHex`）——FsFace/crypto 增补面三处不对齐 | `atomic.ts` 单点适配：`fsFace()` 探测注入面即 passthrough，否则补 copyFile（字节中转）/ readdir（迭代收集）；`randomId()` 有 randomUUID 用之否则 randomHex(16)。copyFile 中转的 V8 常驻峰值 = 文件大小，sqlite 备份上 GB 须上游补原生 copy |
| B-10 | 反常规（布局消费点缺失，P1-13 真机实测） | 契约 §2.9 规定 bundle tgz 为 `<name>-<version>/` 单根，但安装器全链消费**扁平** staging（verifyTarget/deployWeb 读 `${staging}/manifest.yaml`、lockCommit 整目录 rename）——测试 stub 一直写扁平布局掩盖了此断裂；且 market file 源预解包（manifestOfUpload）先归平一次后，安装器 extracting 二次解压再归平会 `rename` 撞上次产物（ENOTEMPTY） | `flattenBundleRoot()`（`steps/extract.ts`）：顶层「含 manifest.yaml 的目录」= 包根，内容上提一层；幂等，碰撞先清后搬（staging 为安装器私有暂存）；market file 源 Form A 无 sha256，上传时点补算注入 archive（verify 复核同批字节，R10 语义保持） |
| B-11 | 跨层断裂（P1-13 真机实测；**P1-13b 已解，真机 done**） | `oj migrate` 解析版本目录根 `manifest.yaml` 要求 oj 原生 `desc` 字段，而 C2 §1 顶层键白名单拒绝 `desc`——C2-04「summary → oj 模块 desc」的映射**无任何消费点**（bundle 直拷方案清单原文），任何合法 C2 包在 migrate 段必 fail；连带：模板站点 `marketEnv` 缺 `hostVersions` 接线（任何声明 peerRuntime 的包 C2-09 fail-closed）、`oj migrate -d` 需指向含迁移树的服务目录而安装器暂存目录对 migrate 不可见 | 三项全接线并真机实证（oj 0.1.78）：①原生清单 desc 映射——bundle 组装期合成原生 `manifest.yaml`（`summary → desc`，verify-only 复核 C2-31，模块源清单不动）；②hostVersions 接线——`versionsJsonPathOf(modulesJsonPath)` = 同目录 `dist/versions.json`，`hostVersionsOf` 注入缺省（不可得 → undefined 仍 fail-closed）；③migrate 暂存布局——`modules/.staging-migrate` 服务目录（release 形态迁移树 + 原生 manifest + schema.yaml），`oj migrate -d` 指向它。真机冒烟：fixture-valid 带迁移包 `ojm install` 终态 **done** 且 `appliedSeq > 0`（`captureMigrateExec` 落任务记录），enable/disable 复验无回归 |

| B-12 | 反常规（oj fs 缺失目标语义，P1-13b 真机实测 0.1.78） | Node 语义 `fs.readFile(missing)` 抛 `ENOENT`（带 `.code`）、`fs.remove(missing, {force:true})` 静默成功；oj isolate 实测两者都抛 `TypeError: invalid_argument`（**无 `.code`**）——所有 `code === "ENOENT"` 嗅探在真机必失效（首装读锁、残留清场、modules.json 冷读三处当场炸过） | `atomic.ts` 单点 `isMissingPath(e)`：`code === "ENOENT" 或 TypeError "invalid_argument"` 双判；三处消费点收敛到它（lock 读写、migrate 残留先清、deploy-web modules.json upsert），回归用例以 oj 形状错误桩钉住 |
| B-13 | 平台缺面（P1-13b 真机实测） | oj isolate `crypto` 无 `sha384`（仅有 sha256Hex/md5Hex/aesGcm/verifyEd25519），而契约 C2-28 `web.integrity` 钉死 `sha384-<base64>`（ojm build 于 Node 侧写入），安装器 verifying/deploying 两段同算法重算比对在真机无处落脚 | 过渡实现 `sha384.ts`（纯 JS SHA-512 核截断 48 字节，hi/lo 双 Uint32，K/IV 由 FIPS 180-4 定义式推导），文件头标注「上游 crypto.sha384 原语落地后替换」；标准向量（FIPS 官方样例 + node:crypto 交叉）全过；上游需求已录入 oj-bin feature requests（sha384 原语） |
| B-14 | 契约缺口（四方评审 2026-10-18 阻塞项） | ① Form B `archive.signature` 原口径只有 `key_id`+`value`、**无公钥**——验签无 key 可用、TOFU 无公钥可钉，签名链整条落不了地；② Form A 禁带 signature（B-2 自引用悖论）使 file 源（本地 tgz，P1 全部真机验证/教学主路径/市场自举都走它）在 G4 硬 fail-closed 下**永远拿不到签名**，会被一刀切死 | ① `public_key`（hex64）列为 P2 起必填——**append-only 的明写例外**（§0 演进方式留痕），老 Form B 缺 public_key = 拒装 + 迁移指引；② 签名载体统一为 **detached 侧车 `<name>-<version>.tgz.sig`**（G4 补裁，待用户追认），与 Form B 同源同语义，`ojm install` 自动探测同目录侧车随包上传——file 源与 CDN 源同一信任模型 |

---

## 附录 C · 版本比较规则与案例（`compareVersions`，C2-02）

> **真源声明**：实现 [`packages/cli/templates/api/src/_platform/_lifecycle/semver.ts`](../../../packages/cli/templates/api/src/_platform/_lifecycle/semver.ts)（P1-1，R25）与其 spec [`packages/cli/templates/api/tests/lifecycle/semver.spec.ts`](../../../packages/cli/templates/api/tests/lifecycle/semver.spec.ts) 为唯一真源，本附录为镜像；**改实现必须同步本表并跑 spec**。C2-02 的 `version` 字段语义 = 本附录（§2.2 peer 四字段的 version 部分遵守 C2-02，随之适用）；下游消费方：P1-10 升降级判定、P3 GC。

### C.1 比较规则（逐条对照实现，含容错口径）

纯字符串解析、无依赖。`compareVersions(a, b)` 返回 `-1 | 0 | 1`（a<b / 相等 / a>b）。规则编号 C-1~C-10 供引用。

| # | 规则 | 实现口径 |
|---|---|---|
| C-1 | 数字段按**数值**比较，非字典序 | 逐段 `Number.parseInt` 后相减；`0.1.10 > 0.1.9`、`2.0.0 < 10.0.0` |
| C-2 | 段数不等，缺省段补 0 | 对齐至较长方、缺段按 0（`?? 0`）；`1.0 ≡ 1.0.0 ≡ 1.0.0.0`（安装器容错口径） |
| C-3 | prerelease 以**首个** `-` 切分，多连字符整体保留 | `indexOf("-")`：首个 `-` 前为核心版本，其后整体为标识符串再按 `.` 切分。**实现口径**：连字符不是标识符分隔符（与 semver 2.0.0 不同）——`1.0.0-alpha-x` 的 `alpha-x` 是**单个**字母标识符，不会被拆成 `alpha`+`x`；spec 钉死「不得截断静默判等」 |
| C-4 | 全数字标识符按**数值**比较 | `/^\d+$/` 全串判定后 `parseInt`；`alpha.2 < alpha.10`、`alpha.9 < alpha.10`。**实现口径**：前导零归一（`01`≡`1`） |
| C-5 | 字母标识符按字典序 | JS 字符串 `<`（UTF-16 码元逐字符）；`alpha < beta` |
| C-6 | 数字标识符 < 字母标识符 | `1 < alpha` |
| C-7 | 前缀相等时，标识符多者大（短者小） | 逐个比较、短方耗尽即判负；`alpha < alpha.1` |
| C-8 | 无 prerelease > 有 prerelease | 双方均无 prerelease 才可能相等；`1.0.0-alpha < 1.0.0` |
| C-9 | 非数字段**静默归零**（容错，不抛错） | `Number.parseInt(seg, 10) \|\| 0`（实现注释：`"1.0.x"` 的 `"x"` 归 0）。**实现口径连带效应**：数字前缀段截取前缀数值（`"2abc"`→`2`）、前导零归一（`"01"`≡`"1"`）——均为实现行为，非 semver 规范；C2-02 白名单已把绝大多数此类输入挡在校验层 |
| C-10 | `+build`（build metadata）不支持 | 实现无任何 `+` 解析；C2-02 白名单本就排除 `+`（附录 B-1，oj 拒装），契约内合法版本不含 `+`，比较器无需支持 |

### C.2 案例表（semver.spec.ts 16 组断言逐条镜像）

| # | a | b | 期望 | 理由（对应规则） |
|---|---|---|---|---|
| 1 | `0.1.10` | `0.1.9` | 1 | 数字段数值比较，非字典序（C-1） |
| 2 | `0.1.9` | `0.1.10` | -1 | 同上，反向（C-1） |
| 3 | `2.0.0` | `10.0.0` | -1 | 主版本数值比较：2 < 10，字典序会误判（C-1） |
| 4 | `1.0.0` | `1.0.0` | 0 | 完全相等（C-1/C-8） |
| 5 | `1.0` | `1.0.0` | 0 | 段数不等缺省补 0（C-2） |
| 6 | `1.0.0` | `1.0.0.0` | 0 | 段数不等缺省补 0（C-2） |
| 7 | `1` | `1.0.0` | 0 | 段数不等缺省补 0（C-2） |
| 8 | `1.0.0-alpha` | `1.0.0` | -1 | 有 prerelease < 无 prerelease（C-8） |
| 9 | `1.0.0` | `1.0.0-alpha` | 1 | 无 prerelease > 有 prerelease（C-8） |
| 10 | `1.0.0-alpha.2` | `1.0.0-alpha.10` | -1 | 数字标识符按数值：2 < 10（C-4） |
| 11 | `1.0.0-alpha` | `1.0.0-beta` | -1 | 字母标识符字典序（C-5） |
| 12 | `1.0.0-1` | `1.0.0-alpha` | -1 | 数字 < 字母（C-6） |
| 13 | `1.0.0-alpha` | `1.0.0-alpha.1` | -1 | 前缀相等，标识符多者大（C-7） |
| 14 | `1.0.0-alpha.9` | `1.0.0-alpha.10` | -1 | 标识符内部数字段仍按数值（C-4） |
| 15 | `1.0.0-alpha-beta` | `1.0.0-alpha` | 1 | 首个 `-` 后整体为标识符串：`alpha-beta` 是单个字母标识符，字典序 `alpha < alpha-beta`（C-3/C-5） |
| 16 | `1.0.0-alpha-beta` | `1.0.0-alpha.2` | 1 | 首标识符 `alpha-beta` vs `alpha` 字典序即分出，不截断静默判等（C-3/C-5） |

## 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-17 | v1.0 | C2 定稿：PRD §5.2 为底 + D4/R7/R8/R9/R24/R27/R28 修订 + changelog 增补 + oj 相容对照 + 双端执行矩阵 + 夹具两枚 |
| 2026-10-17 | v1.1 | 增补 C2-33 health 可选字段（D14/Q-A：冒烟优先 health、缺省首个非匿名路由兜底）+ §1 顶层键/§4.1 矩阵同步 + fixture-valid 覆盖样例 |
| 2026-10-17 | v1.2 | 增补附录 C「版本比较规则与案例（compareVersions）」：规则 C-1~C-10 逐条对照 semver.ts 实现（含容错/实现口径标注）+ spec 16 组断言案例表镜像；C2-02 语义指向附录 C（P1-1b） |
| 2026-10-18 | v1.3 | P2 增补（G3/G4/G5 裁决固化）：§2.11 签名与信任（C2-34 规范串格式 / C2-35 detached 侧车 `.sig` / C2-36 编码约束含 verifyEd25519 双层语义 / C2-37 key_id 命名空间 / C2-38 TOFU 三态与信任库含首次绑定不可改 / C2-39 吊销 / C2-40 切换前复验）；§2.12 IndexRow 扩展（C2-41：available/changelog/trust_state/publisher，operator 回落 history 行）；§2.13 深检报告 item 结构（C2-42）；附录 A.2 六码文案表（P2-5 落双语值）；B-14 记录 `public_key` 必填的 append-only 明写例外与 detached 载体裁决；夹具增 `sig/` 签名链三枚（P2-0） |
