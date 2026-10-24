# 解决方案 Registry（产物仓库）· 需求规格 v2.1

> **v2.1 说明（2026-10-25 用户裁定，推翻 v2 §0-1）**：**registry 本身就是一个第一方解决方案包**，
> 和别的方案一样被站点安装；它**复用宿主站点的登录与 RBAC**，装上之后该站点就**成为 registry
> 站点**（公共或私有）。v2 写的「registry 不是一个解决方案模块」是**错的**——把「模块不能自建
> 账号面」误推成「registry 不能是模块」，这两件事是分开的：模块做领域逻辑，账号面由宿主提供。
>
> **v2 说明**：v1（五专家评审合并版）经**六角色会审**（产品 / 架构师 / 开发工程师 / 高级运维 /
> Team Leader / 体验工程师）后重写。会审中 **2 份「不通过」**（产品、架构），其否决理由经复核
> **成立**，已推翻 v1 的四条核心判断：①「模块自建账号/会话/RBAC」→ 改为**宿主提供、模块消费**；
> ②「`@scope/name` 作物理名」→ 改为**物理名 slug**；③「索引在服务端生成并签名」→ 改为**分片 +
> 签名外置**；④「79 条 / 52 条 P0」→ 改为 **18 条 MVP**（合并自 v1 的 26 条）。逐条差异见 §14.3。
>
> 上游草稿（`202610242350-multi-publisher-cdn-brainstorm.md`、
> `202610250002-solution-registry-requirements-brainstorm.md`）**作废**，勿据其开工。
>
> **文档状态（2026-10-25）**：7 个阻塞项（Q1–Q6、Q12）已逐项确认，**P0-C 可开工、P0-R 可进设计**；
> 剩 5 项非阻塞待定项见 §15。

---

## 0. 结论先行

1. **registry 是一个第一方解决方案包：站点可以不装；一旦装上，该站点就成为（私有）registry 站点**。
   它**不新建账号体系**：登录、会话、`is_forbidden` 闭环、角色/权限判定、`oplog` 审计
   **全部用宿主站点现有的**（`docs/prd/solution/ARCHITECTURE.md:62-67`：解决方案「不能自建登录端点、
   不能自管 RBAC 数据」——**这是约束它怎么复用，不是禁止它存在**）。
   模块只做领域逻辑：scope 目录、包/版本、发布 token、公钥、吊销、索引编排。
   > 归因更正：v2 §0-1 把「模块不能拥有账号面」当成「registry 不能是模块」，**已作废**。
2. **装上之后站点长这样**——同一进程里多了一套「仓库功能」，不是另起一个服务：
   ```
   宿主站点（已有）                      装 registry 包之后（新增）
   ├── _platform/auth  ← 登录签发         ├── registry 领域 API
   ├── system RBAC     ← 判权/建号/审计    ├── registry 读面（索引/tgz，带缓存头）
   ├── 既有 /cdn 挂载  ← 市场取数          ├── registry 自己的包表/版本表/令牌表
   └── oplog                                └── （复用）账号、登录、权限、审计
   ```
3. **物理产物名恒为 slug**（`^[a-z][a-z0-9-]{0,63}$`），**命名空间只是 registry 侧的目录键**。
   会审给出 6 处硬证据：`bundle.ts:324` 用 `${name}-${version}.tgz` 拼路径 → `@acme/demo`
   会拼出 `dist/@acme/demo-1.0.0.tgz`（父目录不存在，直接 ENOENT）；`download.ts:44` 文件名校验
   `^[A-Z0-9][\w.-]*$` 拒 `/`；`download.ts:60` 逐字比对 `<name>-<version>.tgz`；
   `extract.ts:169` 拼 `api/${name}-${version}`；`preflight.ts:32` `NAME_RE` 禁 `@`/`/`；
   `install.ts:178` 用 `indexOf("@")` 切分。**副作用是好的**：物理名不变 ⇒ 安装侧大部分链路不动。
4. **范围必须收口：79 条需求 / 52 条 P0 不可交付**。会审实测计数（`sed -n '103,272p' … | grep -c`）
   为 79 条、其中 52 条标 P0，而 v1 §9 的「MVP」列了 50 条。v2 重定为 **18 条 MVP**（由 v1 的
   26 条合并而来），其余 26 条明列于 backlog，余者作为 MVP 条目的验收细则或已被架构前提覆盖。
5. **拆两条轨道，P0-C 可立即开工**：Team Leader 指出当前是**单租户单发布方**（谁能写 `cdn/`
   目录谁就能发），近 3 个月 803 次提交全出自同一作者、8 个方案全第一方、无 `bundles.yaml` /
   `trusted-keys.yaml` 产物。因此把**不依赖 registry 的静态仓硬化**（索引签名强制、seq 新鲜度、
   规范串 v2、yank、缓存分片、Host 头 SSRF）单列为 **P0-C**，它现在就该做，且是 registry 的地基。
6. **索引必须可分片 + 必须可缓存**。运维实测：索引恒 `no-cache` 回源（`market/api.ts:209`）导致
   出网量是包体的 **200+ 倍**（12GB/日 vs 56MB/日）；3 年 6 万版本 ≈ 37MB 索引；isolate 堆上限
   `js_heap_limit_bytes: 268435456`（256MB），v1 算出的 428MB **必然 OOM**。v2 改为
   **catalog → shard → manifest 三级 + `max-age=60, stale-while-revalidate=300`**。
7. **索引签名必须外置**：isolate **没有通用 Ed25519 签名能力**（只有 verify），服务端无法签索引。
   v2 改为「registry 产出未签索引 → CI/运维用离线 key 签 → 回传」。这同时让索引私钥可离线保管。
8. **私有 registry = 装了 registry 包的内网站点**，其读面默认走「registry 模块自己的 API」；若站点
   保留既有 `/cdn` 挂载（`templates/config.yaml:36-45` 默认就有），registry 可直接把索引与 tgz
   写进该目录，**不需要新增挂载点**。私有读面对外授权是**另一件事**（§11-5，MVP 建议先靠网络隔离）。
9. **诚实账（不粉饰）**：18 条里仍有 **3 条依赖上游或契约变更**——索引签名能力（已用外置签名绕开，
   但仍需 CI 一侧的签名命令）、`install --registry`（服务端 API 0.1.0 → 0.2.0）、私有读面鉴权
   （MVP 只做网络隔离，不做 token）。**自助注册不再是依赖项**：账号由宿主站点 `system`/LDAP/OIDC
   提供，模块零改动。

---

## 1. 定位与边界

| 项 | 说明 |
|---|---|
| 是什么 | 解决方案（Solution）的**产物仓库**：托管 tgz 与元数据、管理版本与发布权限、对外提供可分发的索引 |
| 不是什么 | 不是市场 UI（市场保留）、不是 CI、不是代码托管、不做源码编译（编译在开发者本地 `ojm build --bundle`） |
| 类比 | npmjs.org = registry；`ojm` = npm CLI；`npm publish` = `ojm publish`；`npm i` = `ojm install` |
| 部署形态 | **装进任意站点的可选方案包**：不装=普通站点；装了=私有 registry 站点（公共托管是它的开放配置）；消费方平台把 `framework.market_cdn_url` 指向它 |

**术语白话注解**：
- **registry**：存包、存版本、存元数据的地方，对外提供索引 + tgz。
- **命名空间 / scope**：包名的归属前缀（`@acme/`），**只是 registry 的目录键**，不是文件名。
- **slug（物理名）**：真正落盘/安装/路由/权限码用的模块名，形如 `acme-demo`。
- **发布 key**：签名密钥（本地私钥 + 注册到 registry 的公钥）+ 上传凭证（token）的合称。
- **TOFU**：第一次见到陌生签名 key 时，人工核对指纹后确认。
- **yank**：把某个已发布版本标记为不可安装（保留历史，不物理删除）。

---

## 2. 形态：一个方案包 + 宿主提供的账号面

**结论**：registry 是**一个普通的第一方解决方案包**（slug 名 `registry`），且是**可选的**——
站点不装它就是个普通站点，一行 registry 代码都不跑；**装上即成为私有 registry 站点**，走既有的
`ojm install` / 市场 / file 上传三条安装路径，遵守与别的方案完全相同的 manifest 契约与生命周期。
它**不自建**账号、登录、RBAC、审计——这四样由**宿主站点**提供（这也正是方案模块必须遵守的硬纪律：
`ARCHITECTURE.md:62-67`「解决方案不能自建登录端点、自管 RBAC 数据」、`:484-488`「账号框架全局唯一；
`issueTokens` 仅内部调用」）。

| 能力 | 提供方 | 模块怎么做 | 依据 |
|---|---|---|---|
| 账号 / 密码 / 邮箱 | **宿主 `users` + `system` 后台** | 零账号表，只存 `user_id` 外键 | `ARCHITECTURE.md:485` |
| 登录 / 会话 / token 签发 | **宿主 `_platform/auth`** | 不碰 `issueTokens`，只读当前会话身份 | `:486`（D3） |
| 禁号闭环 | **宿主**（login / ldap-login / SSO 三处） | 无需处理 | 硬纪律 #2 |
| 粗粒度判权 | **宿主 RBAC**（`assertPermission`） | manifest 声明 `registry.publish` / `registry.admin` 两个权限码，handler 内调用 | `:66`、`:488` |
| scope 级归属 | **registry 业务表**（`reg_scope.owner_user` + `reg_scope_grant`） | **不是 RBAC**：不定义角色层级、不进全局判权路径，只在 handler 内做业务判断 | 避免「自管 RBAC」 |
| 审计 | **宿主 `oplog`** | 发布/吊销/yank 调 `auditOp`（内部 try/catch 不反噬业务） | 硬纪律 #5 |
| 领域数据 | **registry 模块** | scope / 包 / 版本 / token / 公钥 / 吊销 / 分片索引 | 新建 |
| 索引签名 | **CI / 运维（离线 key）** | 模块产出未签索引，签名回传后校验再发布 | isolate 无 Ed25519 签名 |
| 读面 | **模块 API**，或站点既有 `/cdn` 挂载 | 见下 | 模块不能新增 `mounts`（`manifest-contract.ts:76-100`） |

### 2.1 三态：不装 / 装 / 卸（这是本需求的形态基础）

| 状态 | 站点是什么 | 有哪些东西 |
|---|---|---|
| **不装（默认）** | 普通站点（消费方） | 无 registry 表、无 registry 路由、无额外依赖；市场照常从外部源取数 |
| **装了** | **私有 registry 站点**（同时保留原有站点能力） | + 领域 API、读面 API、包/版本/令牌/公钥/吊销表；账号与判权**仍是原来那套** |
| **卸了** | 回到普通站点 | 路由/前端/权限绑定被摘掉；**业务数据按既有口径保留**（不自动删包表） |

```
不装（普通站点）                        装上（私有 registry 站点）
_platform/auth     登录签发      →     同一套，一行不改
system RBAC        判权/建号     →     同一套，一行不改（多两个权限码 registry.publish / registry.admin）
oplog              审计          →     同一套，一行不改
/cdn 挂载（若有）   市场取数       →     同一目录，现在由 registry 写索引与 tgz
—                                →     + 领域 API / 读面 API / reg_* 表
```

- **安装方式**：market 里装、`ojm install registry-<ver>.tgz --name registry`（file 源）、或
  `ojm install registry@1`（已有源）。**自举无鸡生蛋问题**：第一个 registry 一律用 file 源装。
- **「私有」是默认语义**：装有 registry 的站点默认**只对内提供服务**（读面靠网络隔离）；
  「公开托管」只是它的一个开放配置，不是独立产品形态。
- **卸载后果必须明示**：若 `market_cdn_url` 仍指向本站 `/cdn`，卸掉后该站点的市场会变成
  「只读旧快照」（有索引、拉不到新包）。安装向导里要提示这一条。

### 2.2 三种部署形态（同一个包）

| 形态 | 站点 | 读面 | 谁在用 | 私有性靠什么 |
|---|---|---|---|---|
| **私有（默认）** | 内网站点装 registry | 站点既有 `/cdn` 挂载（无需新增）或模块 API | 企业内平台群 | 网络隔离（MVP）；源 token（P1） |
| **自供** | 同一个站点既当源又当消费方 | `/cdn` 自供（`market_cdn_url=/cdn`，`config.yaml:39-40` 已是缺省） | 单机/小团队 | 天然隔离 |
| **公开托管** | 公网站点装 registry（= 私有形态的开放配置） | 模块 API + CDN 前置 | 任意平台 | 公开只读 |

> 自供形态消解了 v1 标记的「`--registry` 与站点设置谁优先」无解项：**同一站点时两者指向同一 URL，
> `--registry` 只做一致性校验**（不一致才需要服务端契约，见 REG-R9）。

---

## 3. 角色与核心旅程（7 步 → 5 步）

| 角色 | 身份 | 主要诉求 |
|---|---|---|
| **开发者（发布方）** | 宿主站点账号（MVP 由运维在 `system` 建号或走 LDAP/OIDC） | 建 scope → 生成 key → 发布 → 看被装情况 → 下线问题版本 |
| **平台管理员（消费方）** | 站点 superadmin | 配源 → 浏览/安装 → 处理信任确认 → 回滚/禁用 |
| **registry 运维** | 宿主站点 admin / superadmin（同一套 RBAC） | 审核 scope、处理滥用、强制下线、看审计 |
| **终端用户** | 站点使用者 | 无感 |

### 开发者旅程（体验会审后压缩）

```
ojm login --registry <url>          # ① 登录（token 落 ~/.ojm/credentials.json，0600）
ojm keygen --id acme                # ② 本地生成 Ed25519（私钥不出本地）
ojm key register --registry <url>   # ③ 注册公钥（首次绑定需邮件二次确认 + 24h 冷却）
ojm publish --registry <url>        # ④ 一条命令完成：build --bundle + sign + upload
ojm unpublish @acme/demo@1.0.0      # ⑤ 下线（默认 yank）
```

砍掉的第 6/7 步：`ojm key add` 与 `ojm build` / `ojm sign` 分离——`publish` 在缺产物时
**自动打包并签名**（`--no-build` 可关闭）。会审原话：「7 步里有 2 步是工具自己能做的」。

### 平台管理员旅程

```
站点设置 framework.market_cdn_url = https://registry.example.com/api/registry/cdn
→ 市场页看到包卡片（含 license / scope / yank 标记 / 签名者）
→ 点安装 → 首次遇陌生 key：弹窗内联展示指纹 + [信任并继续]（复用同一 task_id 续装）
→ 或 CLI：ojm install @acme/demo@1.0.0 --registry <url>
```

---

## 4. 范围裁决：79 → 18

| 维度 | v1 | v2 | 依据 |
|---|---|---|---|
| 条目总数 | 79（P0 52） | **18 MVP（合并自 26 条）+ backlog 明列 26 条（P1 17 / P2 9）** | 产品会审：79 条不可交付；TL：前提尚未成熟 |
| P0 条数 | 52 | **18** | 同上 |
| 轨道 | 一条 | **P0-C（6 条，可立即开工）+ P0-R（12 条）** | TL：静态仓硬化不依赖 registry |
| Web 控制台 | P0（后降 P1） | **P1** | CLI 足以撑 MVP 作者侧 |
| 自助注册 | P0 | **P1**（依赖上游 signup） | 框架面缺口，非模块能解 |
| scope 成员 RBAC | P0/P1 | **P2** | 违反「模块不自管 RBAC」 |
| 命名空间物理形态 | `@scope/name` | **slug 物理名 + scope 目录键** | §0-2 六处证据 |

**砍掉不做的（明确写出，避免"以后再说"）**：付费/计费、组织协作与审批流、评论评分、
多 region 镜像、作者↔使用者直接通道、商标申诉通道。

---

## 5. MVP-18 需求明细与降级口径

「现状」列：♻️ 可复用 / 🆕 需新建 / 🔧 需改造。

### 5.1 P0-C：静态仓硬化（6 条，不依赖 registry，可立即开工）

| # | 需求 | 验收要点 | 现状 |
|---|---|---|---|
| **REG-CS1** | **索引签名强制** | 索引 `.sig` 缺失/不符 → `ojm market verify` 非 ok、安装前置拒装。过渡：先告警一个版本，再转硬 fail-closed，**不留开关**。取代 v1 REG-T7 | 🔧 现状缺失容忍→ok（`market/verify.ts:142-143`） |
| **REG-CS2** | **索引新鲜度（防回放/降级）** | 索引含 `seq`（单调递增）、`issued_at`、`expires_at`；客户端按源记录最大 `seq`，**回退即拒**；`latest` 单调不降。取代 v1 REG-S7 | 🆕 现状规范串只有 `index:<kind>:<sha256>`（`publish.ts:40-43`） |
| **REG-CS3** | **规范串 v2（防跨仓库重放）** | `<registry_id>:<slug>@<version>:<sha256>`；`canon` 字段**必须校验**。取代 v1 REG-T8 | 🔧 现状 `market/verify.ts:111-123` 不校验 canon |
| **REG-CS4** | **yank 通道（本地形态）** | `ojm market yank <name>@<version>` → 索引标 `yanked`；**新装拒、已装不动**、保留历史。该能力在 registry 上线前后同一套语义。取代 v1 REG-P5 | 🆕 现状 yank/硬删均无 |
| **REG-CS5** | **索引三级化 + 缓存 + 分片** | ① `catalog.yaml`（包名 → 分片号，无版本明细）；② `shards/<n>.yaml`（每片 ≤2000 版本 ≈1.2MB）；③ 缓存头 `ETag` + `Cache-Control: max-age=60, stale-while-revalidate=300`。**>2000 版本自动分片**，客户端只拉命中分片。生成器（`build-index`）与读取器（市场/verify/install）**同期切换，不保留单文件双读**。取代 v1 REG-S4/S9 | 🔧 现状单文件、`no-cache` 回源（`market/api.ts:209`） |
| **REG-CS6** | **Host 头 SSRF 修复（阻断前置）** | 删掉用请求头 `host` + `x-forwarded-proto` 补全绝对 URL 的路径，改用站点配置的 canonical origin；非法值直接报错。取代 v1 REG-C8 的前置部分 | 🔧 现有洞：`_shared/site-facade.ts:16-34` |

### 5.2 P0-R：registry 本体（12 条）

| # | 需求 | 验收要点 | 现状 |
|---|---|---|---|
| **REG-R1** | **账号：复用宿主，零新增**（负需求） | 验收 = **registry 包里不存在**账号表、注册端点、密码校验、token 签发逻辑；开发者账号由宿主 `system` 后台建（或 LDAP/OIDC）；登录/会话/禁号闭环全部走 `_platform/auth`。自助注册不属本包（若宿主将来提供 signup，registry 自动受益）。取代 v1 REG-A1/A2 | ♻️ 宿主全有，模块**不写一行** |
| **REG-R2** | **发布 token** | 账号 × scope 绑定；可设有效期；可单条吊销；**只存哈希**；token 绑定 registry origin（防跨源重放）。取代 v1 REG-K4 | 🆕 现状完全缺失 |
| **REG-R3** | **公钥注册 + 二次确认** | `ojm key register` 提交 64 hex 公钥；**首次绑定需邮件/控制台二次确认 + 24h 冷却**，期间不可用于发布；注册/启用各发一次通知。合并 v1 REG-K2 + K8（K8 是 v1 最大空洞） | 🆕 现状公钥只在安装端手工 `trust add` |
| **REG-R4** | **key 生命周期（最小集）** | 绑定**不可改**；可 `retire`（不再接受新发布）/ `revoke`（阻断新装，进集中吊销）。合并 v1 REG-K3 + K7 | 🔧 现状吊销只在站点本地，不跨站点 |
| **REG-R5** | **scope 目录 + slug 映射** | registry 目录键 `@acme/demo` ↔ **物理名 `acme-demo`**；物理名恒满足 `^[a-z][a-z0-9-]{0,63}$`；manifest 增 `registryScope` 声明归属；**同名不同 scope → 物理名冲突在发布期即拒**（提示 `acme2-demo`）。重写 v1 REG-N1/N5（不再要求全链路改造） | 🔧 现状按裸 name 归并（`market/index-builder.ts:30-52`） |
| **REG-R6** | **上传发布四查** | ① token → scope 授权；② scope 的 active key 含本签名 key；③ **包级验签**；④ 版本冲突（同 sha256 幂等放行，且**不清除** yanked/revoked）。合并 v1 REG-P1/P2/P9 | 🆕 现状 `market publish` 只写本地 `cdn/`（`market/publish.ts:132-135`） |
| **REG-R7** | **索引生成 + 外置签名** | DB 为唯一真相 + **单写者串行**（blob 无 LIST）；按分片**增量重渲染**（只重画受影响的片）；产出未签索引 → `ojm registry sign` 用离线索引私钥签 → 回传后校验公钥一致才发布到读面。取代 v1 REG-S3 | 🆕 isolate 无签名能力，必须外置 |
| **REG-R8** | **读面两种载体（不新增挂载）** | ① **模块 API**（保证可用）：`/api/registry/cdn/*` 吐索引与 tgz，带 `ETag`/缓存头/`Range`，不经 s3 预签名；② **站点既有 `/cdn` 挂载**（默认工程就有，`templates/config.yaml:36-45`）：registry 把索引与 tgz 写进该目录即纯静态，**无需运维加 mount**。两种载体文件格式完全一致，切换只改 `market_cdn_url`。**不承诺「平台零改造」**（v1 硬承诺已撤）。取代 v1 REG-S4 | 🔧 不新增 mounts（复用已有的） |
| **REG-R9** | **install 源切换** | `ojm install @acme/demo@1.0.0 --registry <url>`：CLI 把目录键归一为 `acme-demo` 再发请求；服务端 `/api/_platform/market/install` 增 `registry` 字段并**校验在站点白名单内**。**API_VERSION 0.1.0 → 0.2.0**，旧站点明确报「站点版本过低，不支持指定仓库」（**不静默降级**）。合并 v1 REG-I1/C1 | 🔧 现状请求体只有 `{name,version,source:"cdn"}`（`install.ts:245-249`） |
| **REG-R10** | **集中吊销 + fail-closed** | registry 出 `revocations.yaml`（短缓存 60s）；安装前拉取，命中即拒装；**拉取失败 = fail-closed 拒装**（同时修复现有 fail-open 先例 `installer.ts:886-891`、`:915-918`）。合并 v1 REG-I3/K7/T5 | 🆕 |
| **REG-R11** | **离线导入 + 离线回滚** | ① 离线包格式：`tgz + .sig + 索引切片 + catalog + revocations`，`ojm registry import` 导入，带 `seq` 与签名校验；② 回滚走**本地版本目录**，registry 挂也能回滚。合并 v1 REG-C9 + I6 | 🆕 回滚现状依赖 CDN 索引 |
| **REG-R12** | **CLI 自动化契约** | 退出码契约（0/1/2 三档：成功/业务失败/用法错误）；`--json` 输出；`--dry-run`；**`OJM_REGISTRY_TOKEN` 环境变量**（CI 不跑 login）；`ojm config ls --show-origin`。取代 v1 REG-C10 | 🆕 现状只有散落 `process.exitCode = 1` |

### 5.3 降级口径（取代 v1 REG-A6 + 修正 REG-I3 的矛盾）

| 通道 | 拉取失败时 | 理由 |
|---|---|---|
| **索引**（可用性通道） | 缓存期内（`stale-while-revalidate=300`）**继续装**；缓存过期才拒 | 索引是内容分发，不是安全裁决 |
| **吊销清单**（安全通道） | **fail-closed 拒装** | 吊销是安全裁决，放行即失效 |
| **回滚** | 走本地版本目录，**不拉 registry** | REG-R11 |

> 产品会审指出的 v1 自相矛盾（A6「待定」vs I3 已写死 fail-closed）由此消解：两条通道**不是同一条**。

---

## 6. 非 MVP backlog（明列 26 条：P1 17 / P2 9）

保留 v1 的完整编号以便追溯，但**不再与 MVP 混排**。触发条件写明，避免「以后再说」。

### 6.1 P1（registry 上线后第一批）

| # | 需求 | 触发条件 |
|---|---|---|
| REG-A1 | 自助注册（邮箱验证） | 上游 `_platform/auth` 提供 signup 端点（默认关）；否则运维建号足够 |
| REG-A3 | OIDC / LDAP 企业身份 | 首个企业内网部署 |
| REG-A4 | 邮箱验证与找回 | 同上 |
| REG-A2b | `ojm register` / `whoami` 完整链路 | 依赖 REG-A1 |
| REG-P10 | deprecate 弃用态（可装但告警） | 首次出现「要弃用但不忍心 yank」的场景 |
| REG-P11 | 发布后修改窗 + 版本号永不重用 | registry 上线即有政策，代码可先不做 |
| REG-I4 | 版本范围 `^1.2` / `~1.2` | 用户实际提出需求（现状精确版本够用） |
| REG-I7 | 安装侧记录来源（审计） | **建议提前到 P0-R**，见 §15 Q10 |
| REG-U1 | 包详情页 | 有 3 个以上第三方发布方 |
| REG-U2 | 作者后台 | 同上 |
| REG-U3 | 搜索 | 包数 > 50 |
| REG-U4 | 运维后台（复用 system） | 举报量起来后 |
| REG-M3 | 市场卡片来源标识 / license 展示 | **license 成本近零，建议并入 P0-R**（`manifest-contract.ts:84` 已在白名单、`:234` 已校验 SPDX） |
| REG-C4 | scope 绑定 registry（`@acme:registry=`） | 多源真实出现 |
| REG-C6 | `unpublish --hard` 物理删除 | 有恶意包处置需求 |
| REG-T6 | 版本不可变（已在 R6 内） | — |
| REG-N3 | 保留名扩项（`oj`/`ojm`/`registry`） | **成本近零，建议并入 P0-R**（`manifest-contract.ts:36` 现有 8 项） |

### 6.2 P2（明确延后）

`REG-S5` 下载统计、`REG-S6` 多 region 镜像、`REG-G2` 举报处置、`REG-G3` 配额、
`REG-M4` registry 直达页、`REG-N2` **scope 成员角色体系**（违反「模块不自管 RBAC」，要做得先改框架）、
`REG-N4` scope 移交、`REG-P6` 硬删、`REG-C5` 凭据按源分桶（取决于 §15 Q5）。

### 6.3 明确否决（不做）

| 项 | 理由 |
|---|---|
| `@scope/name` 作**物理**模块名 | 6 处硬编码断裂，见 §0-2 |
| registry **代管**发布密钥 | 代管方即可伪造任意作者签名，审计丧失不可否认性 |
| 允许**无签名**包发布 | 与 G4 硬 fail-closed 冲突 |
| 一键「全部信任」开关 | 与 G4 冲突（`trust import` 必须逐条确认） |
| scope **改名** | 改名会让锁账与路由前缀失效（npm 也只允许转让） |
| 服务端**索引内联签名** | isolate 无 Ed25519 签名能力 |
| 索引进**预签名 URL** | s3 预签名 15min 与 tgz 长缓存冲突 |

---

## 7. 非功能需求

| 域 | 需求 | 量化依据 |
|---|---|---|
| **索引体积** | 单条 Form B manifest ≈535–684B；驱动体积的是**版本数**不是包数。**每片 ≤2000 版本（≈1.2MB）**，超出自动分片 | 会审实测 |
| **索引出网** | 现状 12GB/日 vs 包体 56MB/日（**200+ 倍**）。v2 目标：索引出网 ≤ 包体 5 倍（靠 `max-age=60` + 分片 + ETag 304） | SRE 实测 |
| **isolate 内存** | 上限 256MB（`js_heap_limit_bytes: 268435456`）；**任何单次索引构建的中间对象必须 <100MB**。分片后单片 1.2MB 安全；v1 的「全量 37MB → 428MB 堆」路线**禁止** | 上游配置 + v1 复核 |
| **索引新鲜度** | yank 生效 ≤60s（TTL）+ CDN purge 兜底；`seq` 回退即拒 | 与 REG-CS2/CS5 配套 |
| **安全** | 私钥**不出托管边界**（本地 / HSM / KMS）；CI 用短时效子密钥；token 只存哈希、默认短时效、可按 scope 授权；上传全链路审计；验签**硬 fail-closed 不留开关**（G4） | 供应链会审 |
| **可用性** | **不承诺「registry 挂了不影响安装」**（v1 判断错误）：索引在缓存窗口内可装，缓存过期即拒；**回滚走本地，不受影响** | `market/api.ts:209` 恒回源 |
| **兼容** | 物理名 slug 不变 ⇒ 安装/解包/路由/权限码链路**零改造**；契约变更只有 `install` 的 `registry` 字段（0.1.0→0.2.0） | REG-R5/R9 |
| **合规** | 包内容不作安全背书（明示）；保留处置与删除通道 | 现有 `BOUNDARY` 文案 |

---

## 8. 关键架构决策（v2 修订）

### 决策 1（再重写）：registry 形态 = 一个方案包，账号面由宿主给

| 选项 | 做法 | 结论 |
|---|---|---|
| **A. 第一方方案包，装进任意站点**（用户裁定 2026-10-25） | 账号/登录/RBAC/审计用宿主；领域逻辑做模块；装上即成 registry 站点 | **推荐**（§2） |
| B. 独立后端服务（非 oj 栈） | 全部自写 | 不推荐：账号/权限/审计/存储全部重写 |
| C. 并入 `_platform` 随每个平台下发 | 每个平台都带仓库能力 | 不推荐：平台是消费方不是仓库 |
| ~~D. 纯解决方案模块自给账号~~ | v1 方案 | **否决**：违反 `ARCHITECTURE.md:62-67` 硬纪律 |

> A vs B 的真实差额：A 省掉「账号体系 + 会话 + RBAC + 审计 + 对象存储接入」五块。这五块在 A 下
> **由宿主站点直接给**（模块零代码），在 B 下必须另写一遍。所以差额成立，来源是**「寄生在宿主
> 站点上」**——而「寄生」正是「做成方案包」的同义词（v2 曾把这条归因写反，v2.1 已更正）。
>
> **可选性**：站点**可以不装** registry——不装的站点完全不受影响（无 registry 表、无 registry 路由、
> 无额外依赖）。**装了就是私有 registry 站点，卸了即恢复普通站点**（业务数据按既有口径保留）。

### 决策 2：命名空间模型（推翻 v1）

| 选项 | 形态 | 结论 |
|---|---|---|
| **A. slug 物理名 + scope 目录键** | 目录 `@acme/demo` ↔ 物理 `acme-demo` | **推荐**：物理链路零改造，冲突在发布期暴露 |
| B. `@scope/name` 作物理名 | v1 方案 | **否决**：6 处硬编码断裂 |

### 决策 3：签名 key 与上传 token 分离

| 选项 | 语义 | 风险 | 结论 |
|---|---|---|---|
| **A. 分离 + 新 key 二次确认** | key 证明「谁签的」，token 证明「谁有权发」 | 需管理两套凭证 | **推荐**（REG-R2/R3） |
| B. 只靠签名 key | 现状隐式做法 | 私钥泄露 = 发布权泄露 | 否决 |
| C. 分离但新 key 免确认 | 看似省事 | **偷到 token 就能注册新 key 再签包 → 分离收益归零** | 否决（v1 最大空洞） |

### 决策 4：索引签名归属与执行位置

签名**归属** registry（不是发布方）——索引是仓库的目录声明。但**执行位置在服务外**（CI/运维），
因为 isolate 无签名能力。私钥可离线保管，反而是安全增益。

---

## 9. 数据模型（registry 模块自有表）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `reg_scope` | `id`, `name`(唯一), `owner_user`, `created_at`, `reserved` | 目录键 `@acme` |
| `reg_scope_grant` | `scope_id`, `user_id`, `can_publish`(0/1) | **不是 RBAC**：单一布尔授权，不写框架 RBAC 表、无角色层级、不进全局判权路径 |
| `reg_package` | `id`, `scope_id`, `slug`(唯一，物理名), `name`, `created_at` | `slug` 与 `name` 的映射在此落死 |
| `reg_version` | `id`, `package_id`, `version`, `sha256`, `size`, `blob_key`, `sig_blob_key`, `key_id`, `token_id`, `state`(published/yanked), `dist_tags`, `published_by`, `published_at`, `yanked_at`, `yanked_by` | **不可变**；`token_id` 供凭证失窃时枚举受影响版本 |
| `reg_publish_key` | `id`, `scope_id`, `key_id`, `public_key`(64hex), `fingerprint`, `state`(pending/active/retired/revoked), `confirmed_at`, `not_before`, `created_by` | `pending` 即 24h 冷却态 |
| `reg_token` | `id`, `user_id`, `scope_id`, `token_hash`, `origin`, `expires_at`, `revoked_at`, `last_used_at` | 只存哈希 |
| `reg_revocation` | `key_id`/`package`/`version`, `reason`, `severity`(retire/malicious), `seq`, `at` | 导出 `revocations.yaml` |
| `reg_index_key` | `key_id`, `public_key`, `state`(active/rotating/retired), `not_before`, `not_after` | 支持新旧双 key 过渡 |
| `reg_shard` | `shard_id`, `seq`, `version_count`, `rendered_at` | 分片状态，供增量重渲染 |

> 账号（`users`）、角色绑定、审计（`oplog`）**复用框架**，不重建（§2）。
> `latest_version` **不落库**，由版本表按 semver 派生（避免与 yank 打架）。

---

## 10. API 与 CLI

### 10.1 registry 模块 API

| 域 | 端点 | 说明 |
|---|---|---|
| key | `POST /keys`（提交待确认）、`POST /keys/:id/confirm`、`POST /keys/:id/retire`、`POST /keys/:id/revoke` | 公钥生命周期 |
| token | `POST /tokens`、`GET /tokens`、`DELETE /tokens/:id` | 上传凭证 |
| scope | `POST /scopes`、`GET /scopes/:name`、`PUT /scopes/:name/acl` | 目录与授权（布尔） |
| 发布 | `POST /packages/:scope/:name`（multipart：tgz + sig）、`POST /packages/:scope/:name/:version/yank` | 上传与下线 |
| 读面 | `GET /cdn/catalog.yaml`、`GET /cdn/shards/<n>.yaml`、`GET /cdn/revocations.yaml`、`GET /cdn/files/<slug>-<version>.tgz` | 带 `ETag` + 缓存头 |
| 索引签名 | `POST /index/unsigned`（导出）、`POST /index/signature`（回传） | 外置签名通道 |
| 查询 | `GET /packages/:scope/:name`、`GET /search?q=` | 控制台/市场取数 |

> 读面端点**不叫** `/cdn/*` 顶层路径——模块路由只能挂 `/api/<prefix>`；运维若在站点配置
> `/cdn` 静态挂载，则同一份文件走纯静态。**两种形态文件格式完全一致**。

### 10.2 CLI

| 命令 | 状态 | 说明 |
|---|---|---|
| `ojm login/logout/whoami` | 🆕 | registry 账号链路；token 落 `~/.ojm/credentials.json`（0600） |
| `ojm keygen` | ♻️ 已有 | 本地密钥对（`usage.ts:296-308`） |
| `ojm key register\|ls\|retire\|revoke` | 🆕 | 公钥生命周期；**`add` 改 `register`** 与站点侧 `ojm trust *` 消歧 |
| `ojm token new\|ls\|revoke` | 🆕 | 上传凭证 |
| `ojm publish [dir]` | 🔧 改造 | 语义从「写本地目录」改为「build+sign+上传」；`--no-build` 跳过自动打包 |
| `ojm unpublish @scope/name[@version] [--hard]` | 🆕 | 默认 yank；`--hard` 属 P1 |
| `ojm install @scope/name[@version]` | 🔧 改造 | 目录键归一为 slug 再发请求（REG-R9） |
| `ojm uninstall <slug>` | ♻️ 已有 | **不接 `--registry`**：卸载是站点侧操作，不涉及源（见 §15 Q7） |
| `ojm view` / `ojm search` | 🆕 | 只读查询 |
| `ojm trust import <url>` | 🆕 | 批量导入信任锚（逐条确认） |
| `ojm registry sign` | 🆕 | 索引外置签名（CI 用） |

> 两组 key 命令方向相反：`ojm key *`（作者侧，管自己的公钥，作用于 registry）与
> `ojm trust *`（平台侧，管本站点信谁，作用于 `.solutions/trusted-keys.yaml`）。
> **选项互斥 fail-fast**：`key *` 必给 `--registry`，`trust *` 必给站点寻址，缺/混即报错。

### 10.3 源解析（修正 v1 §7.2）

| 命令族 | 解析顺序 |
|---|---|
| **作者侧**（publish / unpublish / view / search / login / key / token） | `--registry` > `.ojmrc` > `~/.ojm/config.json` > 缺省源 |
| **消费侧**（install） | `--registry` → **必须命中站点白名单**，否则 403 并给出「请在站点设置添加该源」；未给则用站点 `framework.market_cdn_url` |
| **站点侧**（uninstall / enable / disable / trust） | 不认 `--registry`；沿用 `--url` / `OJM_URL` |

附加规则：
- **执行日志必须打印最终生效的源 + 来源级别**（避免静默漂移到别的仓库）。
- `.ojmrc` 可入库 ⇒ **工程级值必须落在站点白名单内**，用户级白名单是不可被工程级放宽的下界。
- 凭据按 registry origin 分桶；CI 用 `OJM_REGISTRY_TOKEN`。

---

## 11. 开放问题

1. **公共托管 vs 私有部署优先？** 影响多租户隔离强度与配额策略（不影响 MVP 编码）。
2. **scope 抢注与申诉**：先到先得 + 保留名之外，是否需要商标/实名通道？（P2）
3. **包体上限**：tgz 上限多少（建议 50MB）？超出拒绝还是分片？（P0 护栏，需数字）
4. **平台展示层是否多源聚合**？还是只展示「主源」？（取决于 §15 Q3 白名单形式）
5. **私有 registry 的读面怎么授权？** 三档：① **网络隔离**（HTTP 层完全公开，只靠内网可达性；
   MVP 建议）② **源 token**（消费方站点配置 token，服务端 fetch 时带 `Authorization`——需改市场取数）
   ③ **mTLS / IP allowlist**（运维层解决）。③最省代码、②最可控、①最省事但不防内网横向。

---

## 12. 分期路线

| 阶段 | 范围 | 产出 | 是否可独立开工 |
|---|---|---|---|
| **P0-C（6 条）** | REG-CS1~CS6 | 索引签名强制、防回放、防跨仓重放、yank、三级化+缓存、Host 头修复 | **已确认，可立即开工** |
| **P0-R（12 条）** | REG-R1~R12 | 能发、能撤、能装、能离线回滚、能切源且源受控 | 形态/命名/契约/范围已定，可进详细设计 |
| **P1** | §6.1 十七条 | 自助注册、控制台、弃用态、版本范围 | — |
| **P2** | §6.2 | 统计、镜像、治理、组织协作 | — |

---

## 13. 复核清单（v2 新增/复验项，均给出可复现位置）

- [x] **模块不能自建登录/RBAC**：`ARCHITECTURE.md:62-67`、`:484-488`（v2 §2 的地基）
- [x] **顶层键白名单无 `mounts`**：`packages/cli/src/manifest-contract.ts:76-100`
- [x] **保留名 8 项，不含 `oj`/`ojm`/`registry`**：`manifest-contract.ts:36`
- [x] **license 已在白名单且校验 SPDX**：`manifest-contract.ts:84`、`:234-235` → 展示成本近零
- [x] **产物名拼路径含 `/` 会 ENOENT**：`packages/cli/src/bundle.ts:324`
- [x] **文件名安全形态拒 `/`**：`_lifecycle/steps/download.ts:44`、`:60-62`
- [x] **解包拼 `api/${name}-${version}`**：`_lifecycle/steps/extract.ts:169`
- [x] **`NAME_RE` 禁 `@`/`/`**：`_lifecycle/steps/preflight.ts:32`
- [x] **`parseTarget` 按首个 `@` 切分 → scope 直接报错**：`packages/cli/src/install.ts:178-181`
- [x] **install 请求体只有 `{name,version,source}`**：`install.ts:245-249` → `--registry` 是契约变更
- [x] **`API_VERSION="0.1.0"`**：`market/api.ts:40`；peerPlatform 强制比对见 `preflight.ts:223-236`
- [x] **索引恒 `no-cache` 回源**：`market/api.ts:209`；503 分支 `:490`、`:600`
- [x] **上传整包入内存**：`market/api.ts:361-367`
- [x] **归并按裸 name**：`market/index-builder.ts:30-52`；`compareVersion` 只比数值段 `:63-76`
- [x] **索引签名缺失容忍 → ok**：`market/verify.ts:142-143`；内嵌公钥自洽 `:120`、`:145`
- [x] **凭据只走内存不落盘**：`packages/cli/src/site.ts:3`、`:56`；`usage.ts:63`
- [x] **Host 头补全相对 URL（现有 SSRF 洞）**：`_platform/api/_shared/site-facade.ts:16-34`
- [x] **TOFU 已有「确认后续装同一 task」的先例**：`oj-market/web/components/InstallDialog.tsx:91-101`
- [x] **CDN 缓存头现状只有 ETag**：`templates/cdn/README.md:43`
- [x] **需求计数（可复现）**：`sed -n '103,272p' <v1> | grep -c '^| \**REG-'` = **79**；
      叠加 `| grep -c P0` = **52**

---

## 14. 六角色会审记录

**方式**：六个**互不重合**的角色独立出评——要求 ①**只读**、②**禁止引用既有结论**、③**必须自行到
仓库取证并给 `文件:行号`**、④禁止照抄 v1 的评审记录。随后由本文做**第二轮交叉质辩**：
冲突项逐条裁决，无法裁决的上报 §15。

### 14.1 六方结论

| 角色 | 结论 | 最关键发现 |
|---|---|---|
| **产品经理** | **不通过** | 实为 **79 条 / 52 条 P0**（v1 §9 MVP 列 50 条）不可交付；REG-A6「待定」与 REG-I3 已写死 fail-closed **自相矛盾**；缺 **license 展示**（已有 SPDX 校验，成本近零）、作者↔使用者通道、企业审批流；建议砍到 15 条 |
| **架构师** | **不通过** | ①**账号面越界**：解决方案不能自建登录/RBAC（`ARCHITECTURE.md:62-67`/`:484-488`）→ REG-A1/A2/N2 落不进模块，而 v1 §5 决策 1 把「账号/会话/RBAC」算作模块收益 = **论证自相矛盾**；②读面非静态（s3 302 预签名、模块无 `mounts`）；③**索引生成跑不动**（isolate 无 Ed25519 签名、256MB 堆 vs 428MB）；④`@scope/name` 撞碎物理身份 → 改 **slug**。（记录原话；v2.1 限定为「**账号类条目不属模块**」，registry 本体仍是模块） |
| **开发工程师** | 有条件通过 | 3 条**无法实现**：①scope 与产物命名硬冲突（`bundle.ts:324`）；②registry **不能自供 `/cdn`**（无 mounts）；③`install --registry` 是**服务端契约变更**（`API_VERSION=0.1.0`，旧站点会静默忽略）。K8/S7/C5 三者互锁；I3 fail-closed 与 T2 缓存期矛盾 |
| **高级运维** | 有条件通过 | **索引出网量是包体的 200+ 倍**（12GB/日 vs 56MB/日）；3 年 6 万版本 → 37MB 索引 → 428MB 堆（上限 256MB）；6 项阻塞：无 metrics、索引 P1 但会 OOM、单写者无部署约束、下载无超时/重试、备份无流程、轮换无运维流程 |
| **Team Leader** | 有条件通过，**认为现在不该立项** | 现状是**单租户单发布方**（谁能写 `cdn/` 谁就能发）；近 3 个月 803 次提交同一作者、8 个方案全第一方、无 `bundles.yaml`/`trusted-keys.yaml` 产物 → **需求前提尚未出现**；建议拆 **P0-C（静态仓硬化，立即做）+ P0-R（等第二个真实发布方）** |
| **体验工程师** | 有条件通过 | 首用 **7 步偏多**（可压到 5 步：publish 自动打包签名）；**login token 不落盘 → 登录等于没作用**（A2/C5/Q12 三处矛盾）；**纯 CLI 走不通注册**（auth 只有 login/refresh/logout）；TOFU 应内联 y/N + 自动续装（`InstallDialog.tsx:91-101` 已做到）；`install` 轮询 30 分钟无输出 |

### 14.2 交叉质辩：12 项冲突裁决

| # | 争议 | 甲方 | 乙方 | 裁决 | 依据 |
|---|---|---|---|---|---|
| **Y1** | registry 能不能做成「一个解决方案模块」 | v1 §5 决策 1：复用账号/会话/RBAC | 架构师：账号面越界，模块无权 | **会审裁「不做成模块」→ 用户 2026-10-25 推翻**：模块**可以**是模块，只是**账号面必须由宿主给**。v2 把「不能自建账号」误推成「不能是模块」，v2.1 已更正（§2） | `ARCHITECTURE.md:62-67`、`:484-488`；用户裁定 |
| **Y2** | `@scope/name` 作物理名 | v1 Q9：对齐 npm | 架构师 + 开发：物理身份全链路锚 `name` | **采纳乙方：slug 物理名**。目录键仍可 `@acme/demo`，映射进 `reg_package.slug` | 6 处硬编码（§13） |
| **Y3** | 索引在服务端生成并签名 | v1 REG-S3 | 架构师：isolate 无签名 + 堆 256MB | **采纳乙方**：分片生成（服务端）+ **签名外置**（CI）。REG-R7 | 上游能力缺位 |
| **Y4** | 读面是纯静态 CDN | v1 REG-S4「平台零改造」 | 架构师 + 开发：模块不能加 mounts；s3 预签名与长缓存冲突 | **采纳乙方**：默认模块 API 形态，静态挂载变成可选；**撤掉「零改造」硬承诺**。REG-R8 | `manifest-contract.ts:76-100` |
| **Y5** | 索引恒 `no-cache` | 现状实现 | SRE：出网 200 倍、yank 时效 vs 可用性 | **采纳乙方**：分片 + `max-age=60` + `stale-while-revalidate`。REG-CS5 | 实测 12GB/日 |
| **Y6** | `install --registry` 零成本 | v1 REG-C1 | 开发：服务端契约变更，旧站点静默忽略 | **采纳乙方**：API 0.1.0→0.2.0，旧站点**明确报错不降级**。REG-R9 | `install.ts:245-249`、`market/api.ts:40` |
| **Y7** | 79 条全量交付 | v1 §3 | 产品：不可交付，砍到 15 | **部分采纳**：砍到 **18**（含 P0-C 6 条，产品原方案没算硬化项） | 计数 79/52 |
| **Y8** | 现在是否立项 | 用户：要做 registry | TL：单发布方，前提未成熟 | **折中采纳**：P0-C 立即开工（不需立项），P0-R 随拍板启动 | §12 |
| **Y9** | A6「待定」vs I3 fail-closed | v1 REG-A6 | 产品：自相矛盾 | **采纳乙方**：拆成两条通道（索引可用性 / 吊销安全性），§5.3 | 通道语义不同 |
| **Y10** | 凭据是否落盘 | v1 X5/Q12：建议只走环境变量 | 体验：login 不落盘 = 登录无意义 | **采纳乙方**：落 `~/.ojm/credentials.json`（0600），并说明这是**发布凭据**、站点口令仍不落盘。REG-C5 升 P0 | `site.ts:3` 只约束站点口令 |
| **Y11** | TOFU 交互形态 | v1：两步交互 | 体验：应内联 y/N + 自动续装 | **采纳乙方**：复用同一 `task_id` 续装 | `InstallDialog.tsx:91-101` |
| **Y12** | 首用步数 | v1 旅程 7 步 | 体验：压到 5 步 | **采纳乙方**：`publish` 自动打包 + 签名 | §3 |

### 14.3 v1 → v2 修订表（快速 diff）

| v1 位置 | v1 写法 | v2 改为 |
|---|---|---|
| §0-1（v2） | 「registry 不是一个解决方案模块，而是专用站点 + 三段归属」 | **v2.1 推翻**：它是可选方案包，装上即成私有 registry 站点，账号面用宿主（§2） |
| §5 决策 1（v2） | 专用 oj 站点 | **第一方方案包，装进任意站点**（§8 决策 1） |
| §3.2 REG-N5 | `@scope/name` 全链路破坏性改造 | **slug 物理名 + 目录键映射**（REG-R5） |
| §3.5 REG-S3 | 服务端生成并签名（单写者） | **分片增量生成 + 签名外置**（REG-R7） |
| §3.5 REG-S4 | 纯静态 CDN，平台零改造 | **模块 API 默认 + 静态挂载可选**（REG-R8） |
| §3.5 REG-S9 | 分片 P1，>2MB 再分片 | **P0，按 2000 版本/片**（REG-CS5） |
| §3.1 REG-A1/A2 | 模块内自助注册 + 登录 | **运维建号起步，注册 P1 待上游**（REG-R1） |
| §3.2 REG-N2 | scope 成员复刻 RBAC 角色 | **P2**；MVP 用 `reg_scope_grant` 布尔授权（业务表，不碰 RBAC） |
| §3.6 REG-I3 / §3.1 A6 | fail-closed 与「待定」并存 | **拆两通道**（§5.3） |
| §3.10 REG-C5 | 待裁决，建议不落盘 | **落盘 0600，P0**（Y10） |
| §9 分期 | MVP 50 条 | **P0-C 6 + P0-R 12 = 18** |
| §12 Q1~Q16 | 16 项 | **11 项**（§15：已被会审裁决的移出，未决的保留） |

### 14.4 未采纳意见（含理由）

| 意见 | 出处 | 未采纳理由 |
|---|---|---|
| 「**现在彻底不立项**」 | TL | 用户已明确要做；折中为「P0-C 立即做 + P0-R 待拍板」，既不在前提不足时铺开，也不搁置硬化 |
| 「砍到 **15 条**」 | 产品 | 15 条装不下「能发 + 能撤 + 能装 + 能离线回滚」四件事；取 18 条（多出的 3 条是 P0-C 的硬性命门） |
| 「企业审批流 / 作者↔使用者通道」 | 产品 | 无真实需求方，且审批流会引入组织模型（P2） |
| 「REG-U1/U2 回 P0」 | 产品 | CLI 足以撑 MVP 作者侧，控制台成本被低估（沿用 v1 判断） |
| 「`ojm key` 改名 `publish-key`」 | 体验（次要） | 与 `publish` 同前缀更易混；用 `register` 子命令 + 选项互斥已足够 |
| 「`uninstall` 也接 `--registry`」 | 用户原话「等类似 npm」 | 卸载不涉及源，接一个无意义 flag 是坏手感；**列为 §15 Q7 请你确认** |

---

## 15. 拍板记录（12 项：7 项已确认 / 5 项待定）

> **2026-10-25 用户逐项确认了 7 个阻塞项**（Q1–Q6、Q12），全部按建议通过。
> 剩余 5 项（Q7–Q11）**不阻塞开工**，可在 P0-C 执行期间定。
> 本文仍是需求，不是执行计划；进设计前不改既有行为。

| # | 待确认项 | 选项 | 结论 | 状态 |
|---|---|---|---|---|
| **Q1** | **registry 形态**：可选的第一方方案包，装上即成私有 registry 站点，账号/登录/RBAC 全用宿主 | 方案包 / 框架内置 / 独立后端 | **方案包形态**（§2） | ✅ 确认 |
| **Q2** | **物理产物名** | slug / slug+`@scope` 输入别名 / `@scope/name` 物理名 | **slug 物理名**（`acme-demo`），scope 只作 registry 目录键（REG-R5） | ✅ 确认 |
| **Q3** | **`install --registry` 契约升级** | 升级 0.1.0→0.2.0 且旧站点硬报错 / 不升级 / 旧站点静默降级 | **升级 + 硬报错**；源必须命中站点白名单（REG-R9） | ✅ 确认 |
| **Q4** | **P0-C 是否先独立开工** | 先做 / 同期 / 不做 | **先做 P0-C**（6 条，含修 Host 头 SSRF 现有洞） | ✅ 确认 |
| **Q5** | **发布凭据落盘** | `~/.ojm/credentials.json`(0600) / 只走环境变量 | **落盘 0600**，按 registry origin 分桶；站点口令仍只走内存 | ✅ 确认 |
| **Q6** | **MVP 范围** | 18 条 / 砍到 12 / 扩到 21 | **18 条**（P0-C 6 + P0-R 12），其余明列 26 条进 backlog | ✅ 确认 |
| **Q12** | **私有读面授权** | 网络隔离 / 源 token / mTLS | **网络隔离**（MVP 零代码）；源 token 排 P1 | ✅ 确认 |
| **Q7** | **`uninstall` 是否接 `--registry`** | 不接 / 接上但忽略 | 建议不接，帮助文本说明「卸载不涉及仓库」 | 待定（不阻塞） |
| **Q8** | **索引缓存 TTL** | 60s / 更短（需 purge API）/ 更长 | 建议 60s + purge 兜底 | 待定（不阻塞） |
| **Q9** | **G5「不动已装」是否对恶意开例外** | 维持 / 开例外（自动禁用 + 告警） | 建议开例外；属既有期门裁决变更 | 待定（不阻塞） |
| **Q10** | **REG-I7 与 license 展示推进 P0-R** | 推进 / 维持 P1 | 建议推进（成本近零） | 待定（不阻塞） |
| **Q11** | **既有 `--url` 改名 `--site`** | 保留 / 改名 / 并入配置移除 | 建议改名；牵动 5 个命令，可独立做 | 待定（不阻塞） |

### 15.1 确认后解锁的事

- **P0-C 可以开工**（REG-CS1~CS6）。其中 **REG-CS6（Host 头 SSRF）是现有安全洞，与 registry 无关**，
  优先级可单独提前。
- **P0-R 可以进详细设计**（不再是悬空需求）：形态、命名、契约、范围四项已定，剩余的是实现细节。
- **仍不动的**：Q7–Q11 未定项涉及的 `uninstall` 帮助文本、缓存 TTL 常量、G5 例外、`--url` 改名、
  license 展示，都**不阻塞** P0-C，等确认后再改。

## 附：本文与上游文档的关系

| 文档 | 状态 |
|---|---|
| 本文 `202610250010-solution-registry-requirements.md` | **权威（v2）** |
| `202610242350-multi-publisher-cdn-brainstorm.md` | 作废（信任部分已折叠进 §5.3 / REG-R10 / REG-CS1~CS3） |
| `202610250002-solution-registry-requirements-brainstorm.md` | 作废（功能面已被 §5/§6 取代） |
| `docs/prd/solution/ARCHITECTURE.md` | **上位约束**（§2 的「宿主提供账号面」依据其 §2.1 与 §11.1） |
