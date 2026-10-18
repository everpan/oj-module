# devkit 手册章节提纲 · 打包与分发 / 第一方特权面 / persona 部署引导（P0/C5）

> 状态：**提纲（P0/C5 交付物）** · 日期：2026-10-17 · 分支：`feat/lifecycle-p0`
> 上游：契约 [`202610171254-lifecycle-manifest-contract.md`](202610171254-lifecycle-manifest-contract.md)（规则编号 C2-01~33 为唯一引用 ID）· 设计 [`202610171138-solution-lifecycle-implementation-design.md`](202610171138-solution-lifecycle-implementation-design.md) §5/§6.3/D6/R26/R29 · 实施计划 [`202610171207-solution-lifecycle-implementation-plan.md`](202610171207-solution-lifecycle-implementation-plan.md)（P1-11/13/15/16、P2-D2/D5、P3-U1/U3）
> 定位：P1 阶段撰写正式 devkit 手册章节的**蓝本**——每节列「目的 / 要点 / 契约引用 / 示例位」；标「P1-xx 后补」的示例代码位允许后补，**要点本身已定稿、须写实**。行文粒度对齐 `docs/prd/ojm-api-codegen-guide.md`（表格 + 短 bullet + 排错表）。
> 落位：`docs/devkit/manual.md` 新增章节（现有 §7「构建与发布」只覆盖站点级 `ojm build`/preview，不覆盖 bundle 分发；正式编号与插入位置由 P1 正文撰写时定）。

---

## 一、章节提纲「打包与分发」

读者：解决方案作者（第三方工程形态，参照 `../oj-market` 独立仓）。旅程：写 manifest → 备目录 → 打包 → 本地装 → 发布 → 升级。

### 1.1 写 `manifest.yaml`（清单即契约）

**目的**：让作者理解 manifest.yaml 是构建器（`ojm build --bundle`）与安装器（preflight）的**共同上游**——双端同规则 fail-fast，本文档（契约）是唯一真源。

**要点**：

- 两层 manifest 分清（契约 §0）：bundle 级 `manifest.yaml`（分发与安装元信息，本节主讲）≠ oj 模块级 `manifest.yaml`（`api/<name>-<version>/` 内，oj 真实解析，作者**不手写**）。分层红线 OJ-X：bundle 字段**禁止**混入模块级文件——oj 无 `deny_unknown_fields`，未知键静默忽略 ≠ 合法，上游收紧解析即全量炸装。
- 顶层结构按契约 §1；**未列出的顶层键一律拒绝**（构建期与安装期均报可读错误，防拼写漂移静默失效）。
- 身份字段：name（C2-01，`^[a-z][a-z0-9-]{0,63}$`，保留名清单含 `market`）、version（C2-02，semver 优先级语义；禁 `+`/`_`/`..`——`+` 会被 oj 拒装，契约附录 B-1）、summary（C2-04，单行非空，安装器写模块级 `desc` 即取本值）、**changelog 必填**（C2-08，R27）；可选 title/description/icon/author/license/homepage/keywords（C2-03~07）。
- 兼容声明：peerRuntime（C2-09，**P1 安装预检强制**——对宿主 `versions.json` 比对，不符拒装并给可读原因）；peerOj/peerFramework（C2-10）、peerPlatform（C2-11）P1 仅声明不强制、P2 起生效。范围算子 P1 支持精确值/`=`/`>=`/`^`；`<`/`<=` 构建期即拒。
- prefix 一处命名贯穿三处（C2-12~14，PRD §5.8.1）：codegen `API_PREFIX`、模块 routes 自声明首段、`api.prefix` 三者一致；`api.prefix` 默认 `/api/<name>`，保留名与已占用拒用；`web.route_prefix` 默认 `/<name>`；`api.module` 存在时必须 `=== name`；`api.tables` 必须与 `schema.yaml` 表集逐一相等（C2-12a）。
- 匿名路径（C2-26）：段内收敛——每条首段必须 === 方案名（`_system`/`_platform` 天然禁入，R8）；**登录端点禁令**（login/logout/token/session/auth 等正则拒装，R8/S1 纵深防御）。手册以红线框呈现。
- RBAC（C2-15/16）：权限码强制 `<name>.` 前缀（`framework.*`/`system.*`/`market.*` 等保留命名空间不可达）；角色引用的权限码不得悬空（双端拒绝）。
- 路由分类（C2-17~21）：category 三值 `main | admin | hidden`（PRD 五值废弃，附录 B-3）；path 语法（首段首字符为字母、无参数段/通配符/尾斜杠）；`order` 建议 ≥200（框架项保留 <200 间隔带）；`title_key` main/admin 必填；`required_permission` 可选但仅后端深检比对（R22——端点不下发、前端不做权限级菜单过滤）。
- 设置分组（C2-22~24）：`settings.groups[]` 多组模型（PRD 单 group 废弃）；`items[].key` 所有权 fail-fast——`moduleOf(key) === name`（R24，禁污染 `framework.*`）；type 六枚举 `string|bool|int|float|enum|text`；`secret: true` 读取面掩码。
- i18n（C2-25，D4）：`<name>:menu.*` / `<name>:settings.group.*` / `<name>:perm.*` / `<name>:role.*`；`locales/zh-CN.json` 与 `en-US.json` 必须携带 manifest 引用的**全部** key，构建期缺 key fail-fast。
- web 产物（C2-27/28）：`web.entry` 路径 `modules/<name>/<version>/…` 且**版本段必须 === version**（POSIX 分隔符，R30）；`web.integrity` sha384 由构建器对产物计算写入、安装器重算比对（不一致拒装）。
- archive 两形态（C2-29，附录 B-2 自引用悖论）：Form A（tgz 内，可整体省略，**禁止**携带 sha256/size/signature）≠ Form B（CDN `manifests.yaml` 聚合真源，publish 填充）。
- 契约演进纪律（契约 §0/D1）：append-only，改规则必须**先改契约文档再改实现**；作者侧感知 = 升级 ojm 后构建报错变化。

**示例位**：完整 manifest.yaml 注释版——以 `packages/cli/src/lifecycle/__tests__/fixtures/fixture-valid/` 为蓝本改写（P1-11 后补）。

### 1.2 目录布局

**目的**：工程源码布局与 tgz 内布局的对应关系一眼可查。

**要点**：

- 工程源码布局：以 P1-15 脚手架（`../oj-market`，对齐 `apps/playground-oj` 形态）为准——**脚手架定稿后回填本节**（提纲期唯一开放项，不虚构路径）。
- tgz 内布局（契约 §2.9）：单根 `<name>-<version>/`；`api/<name>-<version>/` 为 oj build 产物原样（模块级 manifest 仅 oj 原生七键，且 name/version/desc 与 bundle 逐一相等，C2-31）；`web/modules/<name>/<version>/` 放 entry.js 与 css。
- tgz 内**禁携 `modules.json`**（C2-31）——该文件由安装器在目标站点 upsert，携带即可能覆盖宿主清单。
- 确定性 tgz（C2-32）：固定 mtime=0、成员字典序、权限 0644/0755、无 owner 信息——同输入两次打包 sha256 相等（可复现构建，发布留痕与校验的基础）。

**示例位**：tgz 树 ↔ 源码树对照图（P1-11 后补）。

### 1.3 `ojm build --bundle`

**目的**：一条命令从工程产出可安装 tgz + sha256。

**要点**：

- 命令形态：`ojm build --bundle [--out dist/]` → `<name>-<version>.tgz` + sha256（P1-11）。
- **构建即校验**：`validateContract` 全量执行 C2 规则，fail-fast，报错清单逐条带编号可读——先于打包发生，坏清单出不了包。
- 校验范围含打包自检：tgz 成员守卫（C2-30）、分层核对（C2-31）、确定性（C2-32）均为构建期专属执行点（契约 §4.1 矩阵）。
- 与既有命令的关系：`ojm build`（站点级，manual §7）≠ `ojm build --bundle`（方案分发产物）；bundle 内 api 部分即 `oj build` 产物原样。
- **三个 build 辨析（2026-10-17 上游 oj 0.1.77 对账定版，手册必须原样收录）**：上游 `oj build --bundle` 产出的是**空前缀、dist 根内容**的 tarball（manifests.yaml + `<module>-<version>/`），用途是 `mounts[].api` **远程挂载源**（装配期拉取入内容寻址缓存 `<cache>/<sha256>/`，声明 sha256 为完整性锚）；本节 `ojm build --bundle` 产出的是**市场安装器消费的方案包 tgz**（单根 `<name>-<version>/` + manifest.yaml 契约全量双端校验 + 确定性 sha256）。两者**互不可替代**：远程挂载源不含契约清单与分层布局，方案包不能当挂载源；反向亦然。手搓打包的坑（上游明示）：`tar czf x.tgz dist` 多套一层 `dist/`，解压落 `<cache>/<sha256>/dist/...` 非法 dist 根——要么 `cd dist && tar czf ../x.tgz <module>-<version>/`，要么直接 `ojm build --bundle` 别手搓；per-module `*.tgz`（根是版本目录非 dist 根）同样不能当远程源。
- 双端一致性由夹具钉死：`fixture-valid`/`fixture-invalid` 是构建器与安装器两份实现的唯一共同真源，规则漂移即 CI 红（契约 §5）。

**示例位**：一次构建的终端输出（含典型违规报错样例，逐条对应 C2 编号）（P1-11 后补）。

### 1.4 本地验证（tgz → 装进站点）

**目的**：发布前在本地站点完成安装闭环验证。

**要点**：

- `ojm install <file.tgz|name[@version]>`（P1-13 瘦客户端）：登录 → `POST /api/_platform/market/install` → 轮询 task（800ms）→ 终态打印；失败输出 `lifecycle.stage.*` 双语 reason + hint + retryable（契约附录 A 十阶段文案表）。
- 作者如何读失败（D11 失败语义三分）：锁写入前失败（preflight→extracting）= 清场重跑、零副作用，改了重装即可；migrating 失败=锁写入前段（DB 零副作用；目录与 staging 保留供重试，见设计 D11 行尾特则），迁移失败后**锁保持指向旧版**（账本去重保证重试幂等）；锁写入后失败（registering→smoke）= 方案已生效/部分生效，按指引先禁用或回滚，修复后显式重装；升级/降级切换前对目标版本复验（D11③）。
- 安装成功判据（验收对齐）：不重启出现菜单/路由（AC-P1-1）；带迁移模块 release 重启不拒启（AC-P1-2）；同版本重装 no-op（AC-P1-3）。
- `ojm enable/disable <name>`：锁摘除 + sidecar + `sys_solution_route.enabled` + `modules.json.enabled` 四处同写（D12）。
- 本地静态分发源（D7）：任意 oj 工程 `mounts` 加一行 `web:` 指向**独立分发目录**——严禁指向 `api/modules/` 或其父级（R13 泄漏红线）；索引 `bundles.yaml`/`manifests.yaml` 必须 `Cache-Control: no-cache`，tgz 内容寻址可长缓存（R15）。配好后即可 `ojm install name@version` 走真实下载/校验链。

**示例位**：本地 tgz 安装全程操作记录（含一次失败与文案解读）（P1-13 后补）。

### 1.5 发布

**目的**：从「本地文件」到「可被 `ojm install name@version` 消费的分发源」。

**要点**：

- **P1 手册版本（先交付）——本地 tgz 流程**：file 模式安装 + 本地静态分发目录（§1.4）+ `bundles.yaml`/`manifests.yaml` 手工维护要点（P3 `ojm publish` 落地前的过渡口径）。
- 信任域声明（设计 §10①）：P1 无签名阶段，CDN 与安装器同信任域，sha256 仅防传输损坏**不防投毒**——验证过的分发源之外不得用于不受控分发；P2 验签上线前这是硬边界。
- **P2 起补**：签名链（Ed25519，`archive.signature`，签名原文 `<name>@<version>:<sha256>`，C2-29）；TOFU 指纹确认（CLI 侧交互 + 审计留痕）；验收口径「未签名装不上、签名不符不落盘」。
- **P3 起补**：`ojm publish`（P3-U3：填充 Form B archive 段 + 重算 `bundles.yaml`/`manifests.yaml` 索引 + no-cache 头）；安装器消费顺序 `bundles.yaml`（版本/文件/校验）→ Form B manifest（P2 签名）→ tgz 内容（契约 §2.9）。
- GC 提示：保留 N=3 按安装时间序（D14/R25，非 semver 序）——发布方无需自行精简旧版本，回滚依赖旧目录在站内。

**示例位**：publish 命令与索引产物样例（P3-U3 后补）。

### 1.6 版本升级与 changelog 约定

**目的**：升级路径、数据安全边界与市场卡片信息维护。

**要点**：

- version 语义 = semver 优先级比较，缺段补零（`1.0` ≡ `1.0.0`，C2-02）；同名同版本重装 = no-op（AC-P1-3）。升级与降级 = 同命令不同 version（D8）；降级受迁移差异校验约束（迁移无差异才放行——正式出处 R12；D11③ 是另一件事，指切换前对目标版本 sha256 复验，两码事；~~down 迁移增强见 OJ-9~~ **OJ-9 终裁不采纳（前向-only）**——含破坏性 DDL 的升级请作者提供补偿迁移，回退预览用 `oj migrate --format json` 读账本人工决策）。
- **changelog 必填**（C2-08，R27）：string ≤2000 或 string[]（≤50 条、每条 ≤500）——市场卡片版本对比展示；建议每条对应一个用户可感知变更，不写「修复若干问题」式空条目。
- 数据库走 `migrations/` 增量：**迁移成功后才落锁**（D11/R2 修订）；迁移失败保持锁指向不变 + 账本对账自愈（回指旧版并隔离新目录）；回滚前校验目标版本 max seq ≥ 账本 head，否则禁止回滚转人工。**作者侧规模约束（oj 0.1.78 文档化）**：安装器经 `exec` 跑 `oj migrate`，平台硬上限 `timeoutMs ≤ 600_000`（10 min）、输出 10 MiB——单次迁移必须 10 min 内完成，超限请作者分块（多个顺序迁移文件）；含破坏性 DDL 的升级另见上行补偿迁移口径。
- 注册只加法 + 元数据覆盖：RBAC/路由/设置注册 upsert，声明消失标 `deprecated`（PRD §5.9.6，P1-8）——删声明不删数据；手册写明「禁用 ≠ 卸载 ≠ 清除」三态。
- 宿主升级兼容：宿主 runtime 升级后若方案 `peerRuntime` 不再满足，下次安装/升级预检拒装并给可读原因（C2-09）——手册提示作者关注宿主 `versions.json` 变更。

**示例位**：changelog 写法好坏对照（P1 后补）。

### 1.7 签名与信任（P2 起，契约 v1.3 §2.11；正式手册章节随 P2-14 展开）

**目的**：作者侧「生成 key → 签名 → 发布」全流程；宿主侧「信任库 → TOFU → 吊销」运维模型。

**要点（骨架）**：

- **发布方流程**：`ojm keygen [--id <publisher.id>]`（Ed25519 新生成——站点既有 RSA cert 对/X25519 secrets 对**不可复用**：算法不符、per-site、已暴露；私钥落 `~/.ojm/keys/<id>` 永不出该目录）→ `ojm build --bundle` 出包 → `ojm sign <tgz> [--key <pem>] [--check]` 写同目录 detached 侧车 `<name>-<version>.tgz.sig`（`alg`/`key_id`/`public_key`/`value`/`canon`）→ 分发 tgz + 侧车（CDN 与 file 源同一信任模型）。
- **签名原文**：规范串 `<name>@<version>:<sha256>`（C2-34，逐字；`canon="v1"`）；编码约束 C2-36（value 仅标准 base64、public_key 仅 32B raw hex）。
- **宿主验签硬边界（G4）**：未签名/签名不符/格式错一律拒装零落盘，无 `solution_allow_unsigned` 类开关；失败六码（附录 A.2）双语文案 + `retryable=false`。
- **TOFU 双轨（G3）**：宿主信任库 `.solutions/trusted-keys.yaml`（key_id→公钥，可预置第一方 bootstrap key 免 TOFU）；未知 key_id 首次装停 `needs_trust` 终态 → CLI/市场页展示指纹（sha256Hex(publicKey) 全 64）人确认 → 入库审计。**首次绑定不可改**（同 key_id 异公钥拒；轮换 = 新增 key_id）。
- **吊销（G5）**：`ojm trust revoke <key_id>` = 移出信任库，只阻断新装/升级、不动已装方案；启用（enable）放行 + 告警 + 深检标 `untrusted`。
- **切换前复验（C2-40）**：升级/回滚/降级重新取包完整验签；吊销 key 签的新包升级即拒。

**示例位**：keygen→sign→install 全链实录（P2-16 真机走查后补）。

---

## 二、章节提纲「第一方特权面不可复制」（R29）

**目的**：防「市场即样例」（D2）被第三方照抄——`oj-market` 独立仓天然对齐第三方作者形态，但它消费的编排面是**第一方特权**；第三方照抄半失效，手册必须讲清边界与正确接入面。

**要点**：

- 切分事实（设计 §5.1/D5/D10）：`/api/_platform/market/*` 端点族（meta/index/install/task；verify 见 P2 深检）与十阶段状态机归 `_platform` 特权模块——依赖 `exec.run`、共享根 FS、`reloadConfig`，普通方案经 RBAC 隔离**拿不到**。
- 端点门（R9）：`assertSuperAdmin` 独占 + module=market 已安装启用双重校验；例外仅 `GET .../meta`（登录即可，供 peerPlatform 握手，P1-12）。
- `market` 是保留名（契约 §4.2，R9）：第三方取名 `market`（C2-01）或自 declare `market.*` 权限码（C2-15 前缀规则）均被拒——抢注编排面在契约层即不可达。
- **误用的失效形态（写实）**：第三方页面照抄 oj-market 的编排调用 → superadmin 登录下「看起来能用」（功能假活），admin/普通管理员一律 403——功能静默降级为仅超管可用，且第三方无法修复（门不在权限码层）。权限码不构成门：admin 超集链恒通过一切权限码（R9），`market.install` 权限码已废弃（D14）。
- 正确接入面清单：manifest 契约（路由分类/权限/角色/设置分组/匿名路径，§一 1.1）+ `sys_setting` 键所有权（R24）+ i18n 命名空间（D4）；需要界面就声明 `admin`/`main` 路由进菜单，需要持久化就声明表与设置项——一切经契约，不直呼特权端点。
- 前端显隐与硬执行的分界：`market.view`/`market.verify` 仅市场页前端显隐用（初始绑定 admin+superadmin，D14）；方案菜单权限靠后端 403 硬执行，前端不做权限级菜单过滤（R22）。
- 样例义务：oj-market 对 `_platform` 调用处带「第一方专用」显式注记（R29，代码注释由 P1-15 承接）；手册负责讲清「为什么抄了会半失效」——本节即该解释的正式落点。

**示例位**：误用失效复现步骤（superadmin 可用 / admin 403 对照表）（P1-12 后补）。

---

## 三、persona 部署引导（D6）

**目的**：一页流讲清「谁在什么时候用哪个入口」——运维 CLI 引导装 market，此后 admin 经市场 UI 接管日常；避免「CLI 是永久唯一入口」的旅程断裂（R26）。

**角色分工表**：

| 阶段 | persona | 入口 | 动作 |
|---|---|---|---|
| 首次接入（market 未装） | 运维 | CLI | `ojm install market`（P2-D5 引导装 market 本身）；P1 期间无市场 UI，**一切方案安装都走 CLI**（P1-13） |
| 常态（market 已装） | admin（持 `market.view`/`market.verify` 显隐） | 市场 UI | 安装/升级/回滚/禁用/深检全走市场页；编排端点 superadmin 独占（R9）——页面动作按 R9 门控 |
| market 自身升级 | 运维 | CLI | 市场卡片按钮显示「经 CLI 升级」提示（P2-D2）；CLI 装新版后页面刷新即得 |
| 卸载 | superadmin | 市场 UI | 影响面预检（受影响角色/用户数）→ 二次确认（P3-U1） |

**要点**：

- 为什么运维先行：引导期无 UI 可用（先有 market 才有市场页），且 CLI 是瘦客户端——登录 → 触发编排端点 → 流式展示进度，零安装逻辑（D6）；编排端点 superadmin 独占（R9）。
- **占位引导卡文案要点**（R26，P1-16 交付，框架管理区渲染，仅 market 未安装时出现）：
  1. 现状说明：「市场方案未安装，暂无法使用市场功能」（不给死白屏、不给报错感）。
  2. 动作指引：指向运维角色——「请运维执行 `ojm install market`」，附对分发源/版本的前置要求。
  3. 文档入口：链接到本手册 persona 章节与「打包与分发」章节。
  4. 双语：文案 zh-CN/en-US 双语齐备（对齐框架 locales 惯例，D4 精神）。
- 权限可见性：引导卡面向能进入管理区的角色；`market.view/verify` 仅决定市场页入口显隐（D14 初始绑定 admin+superadmin）。

**示例位**：占位卡视觉稿与文案全文（P1-16 后补）。

---

## 附：章节 ↔ 契约/决策引用速查

| 章节 | 主引条款 |
|---|---|
| 1.1 manifest 编写 | C2-01~29 全量 + OJ-X + 保留名 §4.2 + 附录 B-1/B-2/B-3 + D1/R7/R8/R22/R24/R27 |
| 1.2 目录布局 | C2-30/31/32 + §2.9 tgz 布局 + P1-15（源码布局开放项） |
| 1.3 build --bundle | P1-11 + C2 双端执行矩阵（契约 §4.1）+ 夹具 §5 |
| 1.4 本地验证 | P1-12/13 + 附录 A 十阶段文案 + D11 三分 + D7/R13/R15 + AC-P1-1/2/3 |
| 1.5 发布 | C2-29 Form A/B + P3-U3 + P2 签名链 + 设计 §10① |
| 1.6 升级与 changelog | C2-02/08 + D8/D11/R2 + PRD §5.9.6 + C2-09 |
| 二 特权面 | R29/R9/D2/D5/D10/D14 + C2-01/15 + R22/R24 + §5.1 |
| 三 persona | D6/R26/D14/R9 + P1-13/16 + P2-D2/D5 + P3-U1 |
