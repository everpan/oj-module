# 需求二：登录/账号体系支持企业微信「代开发自建应用」（多租户）— v3

> v3 = v2 + 第三轮专家复评审（换视角、独立取证）。复评审推翻了 v2 的核心架构（connector 充 OIDC IdP），
> 依据是 oj 源码与本仓代码的硬证据，详见 §1。v1/v2 的结论**不再作为前提引用**。

## 0. 结论速览

| 项 | v3 结论 |
|---|---|
| 会话归属 | **`_platform` 保持会话权威**（不改）。企微只是新增一种 `AuthProvider` 登录方式 |
| 租户隔离 | `tenant.enable` + `sql_guard: deny`（构造器自动注入）+ `tenant_id` 列全覆盖 21 张表 |
| 租户防伪造 | `tenant.require_signed_claim` 是平台正解，但 **`jwt.sign` 目前无法带自定义 claim**（静默丢弃）→ 上游需求 R6；未落地前用 `currentAccess()` 单点绑定做 fail-closed 兜底 |
| 代开发协议 | 服务商套件（suite）+ 每 corp 授权（permanent_code 粒度 = suite×corp），**应用维度靠 agentid** |
| 上线阻塞 | 服务商资质 / 可信域名 / 可信 IP / 回调 URL 备案 —— 代码前必须先备齐 |
| 关键前置 | Phase 0 不是「加两列」，是 21 张表的租户化 + 登录前租户来源的决策 |

## 1. 修订史：被推翻的假设与证据

> 规则：本节每条都必须有本仓或 oj 源码的 file:line 证据；不引用前两轮的论证链。

| # | 曾经的假设 | 实测事实 | 证据 | 影响 |
|---|---|---|---|---|
| A | `sql_guard` 只「校验」不「注入」，所以要全量 DAO 手加 `tenant_id` 过滤 | **构造器查询自动注入**：`db.table()` 自动加 `tenant_id`（join 进 ON、子查询递归）、insert 强制当前租户、update/delete 自动收窄、显式改 `tenant_id` 拒绝；只有**裸 SQL** 才是「查漏即拦」 | `bin/devkit/api-manual.md:2946` | Phase 0 工作量从「改几十个 DAO」降到「加列 + 清点裸 SQL」；手加过滤变冗余 |
| B | 加 `tenant_id` 列即可 | `sql_guard` 非 Off 时，**schema.yaml 声明的每张表都必须有 `tenant_id` 列**，否则 serve 启动 / `oj build` / `oj migrate` 三处 fail-fast；共享表须 `tenant: false` **且** 列进 `tenant.shared_allow`，双声明才豁免（`shared_allow` 为空 = 共享声明被忽略） | `oj-bin/src/config.rs:956-959` | 范围从 2 张表 → **21 张表**（`_platform` 14 / notification 4 / home 2 / demo 1） |
| C | oj 的 tenant 头无法与用户绑定，所以必须让 oj 当会话权威（connector 充 OIDC IdP） | **平台早已有这个机制**：`tenant.require_signed_claim`（v0.1.41），开启后 `http.tenantId` 只认验签 JWT 的 `claims.tenant`，裸头仅做一致性复核，不符 403；claim 命中时无头也放行 | `bin/devkit/api-manual.md:2907`、`oj-bin/src/config.rs:640-657` | 不需要伪装 IdP；问题变成「怎么把 tenant 放进 claim」 |
| D | 放 claim 很容易（`jwt.sign({sub, tenant})`） | **`jwt.sign` 会静默丢弃自定义字段**：Rust 侧把入参反序列化后**重建** `Claims{sub, roles, iat, exp}` 再编码，多传的键不报错也不进 token；JS 类型也只声明 `{sub, roles?}` | `oj-bin/src/bridge/crypto.rs:62-67`（struct）、`:87-121`（重建 Claims）；`bin/devkit/global.d.ts:351` | 需上游需求 **R6**（一行级改动）。在此之前只能做模块侧绑定兜底 |
| E | oj 发会话后前端就能用 | `_platform` 前端会话载体是**自己的 Bearer access_token**（`access_token → token` 存 zustand persist），不存在 cookie 会话；且全部鉴权以 `http.user.id` 当**数字 uid** 用 | `packages/runtime/src/api/user/index.ts:29-31`、`packages/runtime/src/store/auth.ts`、`access.ts:66`、`audit.ts:31`、`profile/api.ts:6` | oj JIT 账号 `oidc:<tenant>:<sub>` 的 id 不属于这个命名空间，Model B 需再造一层映射 → **架构否决** |
| F | 前端只要跳 oj 的 `/oidc/login` 就完事 | 本仓已有正规接管口：`AuthProvider`（`registerAuthProvider`）——provider 负责换凭证，runtime 统一写库 | `packages/runtime/src/store/auth.ts:36-46` | 登录方式应作为 provider 实现，不碰 oj OIDC |
| G | `(corp_id, env)` 足以区分同企业测试/正式两个应用 | 代开发授权粒度：`permanent_code` 是 **suite × corp**（同套件同企业只有一个），应用维度是 **agentid**；同 corp 装两个应用 = 同 permanent_code、同 auth_corp_id、不同 agentid | 企微协议事实（本节唯一非源码证据，见我方案 §5.3 的兑换链设计） | profile 主键应为 `(suite_id, corp_id, agent_id)`，`env` 降级为标签 |
| H | 加 `"wecom"` 改 4 处类型即可 | 还要改：登录方式发现的数据源（只读 `ldap.enabled`/`sso.enabled`）、`sys_setting` 种子、`users` 外来号前缀红线（现只认 `ldap:`/`sso:`） | `settings.ts:73-75`、`seed.sql:29-30`、`users.ts:28` | 前端类型 + 后端发现 + 种子 + 命名空间共 7 处 |

## 2. 架构（v3）

```
浏览器 ──登录页「企业微信」──▶ runtime AuthProvider(wecom)
                                   │ 302
                                   ▼
                        _platform /auth/wecom/login?corp=&agent=&env=
                                   │ 302 企微 OAuth2/qrConnect
                                   ▼
                        企微 ──code──▶ /auth/wecom/callback
                                   │ code→userid（corp access_token）
                                   │ JIT 建档（users: username=wecom:<userid>）
                                   │ issueExternal(uid) → TokenBundle
                                   ▼
                    302 SPA ?ticket=<一次性> ──▶ provider 取 TokenBundle 写库
                                   │
                       后续 API：Bearer access_token (+ tenant 绑定校验)
                                   ▼
                              oj  _platform 模块
                        sql_guard=deny 自动注入 tenant_id
```

| 层 | 责任 | 位置 |
|---|---|---|
| oj（只读） | 租户头/claim 注入、`sql_guard`、JWT 签发校验 | 上游，仅配置 + 需求 R6 |
| `_platform` 后端 | 企微 connector、JIT 建档、会话签发（`issueExternal`）、租户绑定 | `templates/src/_platform/api/wecom/*` |
| `_platform` schema | 21 张表租户化 + 3 张企微表 | `schema.yaml` + `migrations/0015__tenant.sql` 起 |
| 前端 | 登录页入口、AuthProvider(wecom)、回调落地、代开发后台 | `login/web/*`、`runtime/src/store/auth.ts` 扩展点 |

## 3. 关键决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 会话权威留在 `_platform`，不迁 oj | §1-E/F：SPA 与应用层全链路绑定 `_platform` 的 Bearer + 数字 uid；迁 oj 要再造身份映射，收益为零 |
| D2 | 企微登录 = `AuthProvider` 的一种 method | 现成接管口，不动 runtime 主流程，可回退 |
| D3 | 租户列名 `tenant_id`，同时保留 `corp_id` 业务键 | `sql_guard` 只认 `tenant_id`；`corp_id` 供运维排查 |
| D4 | 租户绑定优先 `require_signed_claim`，落地前用 `currentAccess()` 单点兜底 | 前者平台级 fail-closed；后者是现成的唯一判权咽喉，粒度可审计 |
| D5 | profile 主键 `(suite_id, corp_id, agent_id)`，`env` 只作标签 | §1-G：permanent_code 粒度是 suite×corp，agentid 才是应用 |
| D6 | 外部身份沿用 `username` 前缀约定（`wecom:<userid>`），不新开 `wecom_userid` 列 | 与 `ldap:`/`sso:` 一致（`users.ts:28`），复用现有唯一性/展示/审计路径；`corp_id` 单列冗余存储 |
| D7 | 测试环境用企微**测试企业**，不在正式 corp 内建「测试应用」冒充 | 避开可见范围/审批/数据混杂；技术上 `(suite,corp,agent)` 仍支持多应用 |

## 4. 分阶段

### Phase 0（前置，不做则隔离是空话）— 已实施，见 §10
1. `config.yaml` 加 `tenant` 段：`enable`、`header_key`、`sql_guard: deny`、`shared_allow`、
   `allow_as_tenant: true`、`anonymous_paths`。`require_signed_claim` 保持 false（等 R6）。
2. 21 张表逐张定性（§5.2 A/B 两组）。
3. 清点裸 SQL（`db.raw`/`db.sql`/字符串查询），逐条补 `tenant_id` 条件；构造器查询不动。
4. 新增迁移 `0015__tenant.sql`（+ `.pg` / `.mysql` 方言覆盖；notification/home/demo 各自序号）。
5. 回归：`templates-tenant-scope.test.ts`（schema 定性 vs config 双声明一致性）+ HTTP 探针。
6. L2 租户上下文：`tenantStore` + `headerProvider` + 登录页企业代码入口 + 默认租户回落。

### Phase 1（connector）
- `GET /auth/wecom/login?corp=&agent=&env=`：UA 检测 → 企微内 OAuth2 / 外部 qrConnect / 无 corp 时引导输入企业代码。
- `GET /auth/wecom/callback?code&state`：`code→userid` → JIT → `issueExternal(uid)` → 一次性 ticket → 302 SPA。
- `POST /auth/wecom/ticket`（一次性 ticket 换 TokenBundle，防 token 出现在 URL）。
- `GET|POST /wecom/suite/event`：URL 验证 `echostr`、`suite_ticket`、`create_auth`、`change_auth`、`cancel_auth` 全量事件。

### Phase 2（前端）
- `login.tsx` 加 tab（不硬编码三种）、`AuthProvider(wecom)`、`wecom-callback` 落地页（读 ticket 换 token）。
- `settings.ts` 登录方式发现加 `wecom.enabled`；`seed.sql` 加种子；`users.ts` 前缀红线加 `wecom:`。

### Phase 3（代开发后台）
- 开通入口（授权安装链接/二维码）、已授权企业列表、profile 状态、停用/解绑、首登资料补全。

### Phase 4（e2e + 安全回归）
- 真实套件跑通；跨租户越权、伪造 `X-TENANT-ID`、重放 ticket、停用 corp 登录、suite_ticket 过期。

## 5. 详细设计

### 5.1 租户键
- `tenant_id`：隔离列，text（`wecom:<corp_id>` 形式可读）；`corp_id`：企微业务键；`wecom:<userid>`：外部号用户名。
- 映射权威：`wecom_app_profile(suite_id, corp_id, agent_id)` → `tenant_key`。

### 5.2 DDL（migrations/0015 起）

**A. 租户化 11 张（加 `tenant_id TEXT NOT NULL DEFAULT 'default'`，受 `sql_guard` 自动注入）**
```
users              + tenant_id, + corp_id TEXT   -- 唯一键 (tenant_id, username)
sys_user_role      + tenant_id                   -- 主键仍 (user_id, role_name)：users.id 全局自增，跨租户不重复
sys_refresh_token  + tenant_id                   -- 会话必须与租户同域，否则跨租户刷新
sys_oplog          + tenant_id
notification 4 表   + tenant_id
home 2 表 / demo 1 表 + tenant_id
```

**B. 共享 10 张（schema `tenant: false` + config `tenant.shared_allow` 双声明，缺一则声明被忽略）**
```
_oj_migrations      -- oj 自建自管 DDL
sys_setting         -- D8：登录方式发现是未登录端点，此刻没有租户上下文
sys_solution_route  -- PK=path 的站点级路由/启用注册表；安装是站点操作（见 §10 偏差 1）
sys_role / sys_permission / sys_role_permission -- 框架角色目录；分配关系在 A 组
sys_rate_window     -- 登录前限速，必须全局
sys_login_throttle  -- 同上
market_history      -- 解决方案安装/升级/回滚是站点级留痕（见 §10 偏差 1）
reg_source_seq      -- 索引新鲜度水位属于站点（源码注释即「记在站点 DB」，见 §10 偏差 1）
wecom_app_profile(suite_id, corp_id, agent_id) PK 三列；env 标签；*_enc 加密列
wecom_suite_ticket(suite_id) PK；suite_ticket / expires_at
wecom_login_ticket(ticket_hash) PK；uid / tenant_id / expires_at / used
```
> 企微三表随 Phase 1 落地，未落地前不计入 21 张（当前 11 A + 10 B = 21）。
> B 组 = 不受 guard 约束，**只放全局映射/凭证/框架目录，不放租户业务数据**。
> `wecom_login_ticket` 存 `tenant_id` 是因为它要跨「匿名回调」与「已认证换取」两段，不是租户业务表。

> 21 张表的逐张定性表写进迁移文件头注释，避免「一律 default 蒙混过关」。判据：**该表是否可能在无租户上下文时被访问**。

### 5.3 登录前租户来源 — 已定 L2（登录带租户）

**为什么必须显式决策**：`tenant.enable` 后 `{base}` 请求缺头即 400；`sql_guard: deny` 下匿名请求查租户表会直接抛错
（`oj-bin/src/bridge/query.rs:1345-1355`：`require tenant context (missing tenant header)`）。而登录前恰恰没有租户上下文。

**L2 落地形态（四层各有出处）**

| 层 | 做法 | 依据 |
|---|---|---|
| 租户来源 | `?tenant=<企业代码>` URL 参数 → 持久化 → 缺省回落部署默认租户；多租户且无参数时登录页显示「企业代码」输入框 | 产品决定 |
| 请求头注入 | `_platform` web 入口注册 `ctx.register.headerProvider(() => tenant ? { "X-TENANT-ID": tenant } : {})` | **框架已有接缝**：`runtime/src/utils/request/index.ts:44-50` 逐请求合并 provider 返回的头；`store/header-provider.ts:1-8` 注释明写「租户等」「登录前 guard 请求无租户头」的时序容忍 |
| 服务端取租户 | XHR 登录：头已在 → `http.tenantId` 有值 → 构造器自动注入，**不需要** `asTenant`；302 跳转（企微回调，浏览器带不了自定义头）：端点进 `tenant.anonymous_paths`，用 `db.asTenant(serverDerivedTenant)` 补身份 | `bin/devkit/api-manual.md:2969-2977`（`asTenant` 三条件：`allow_as_tenant` + 匿名 + id 非空，且「已带头/已设过 → 抛错」） |
| 认证后 | 前端继续带 `X-TENANT-ID`，服务端比对「头值 == 该用户行 `tenant_id`」，不符 403（R6 落地后改由 `require_signed_claim` 在 oj 层拦） | §5.6 / §6 |

**配套决策**
- **D8：`sys_setting` 共享（`tenant: false` + `shared_allow`）**。理由：登录方式发现 `/system/login-methods` 是
  未登录端点（`settings.ts:73-75` 读 `ldap.enabled`/`sso.enabled`），首次访问时还没有租户头，若该表租户化则必定抛错；
  且这些开关是部署级语义，不是每 corp 语义。
- **D9：企微三表共享**（`wecom_app_profile` / `wecom_suite_ticket` / `wecom_login_ticket`）。理由：前者本身就是
  corp→tenant 的映射权威，查它的时候必然还没有 tenant 上下文；后两者按 suite 全局唯一。共享 = 不受 guard 约束，
  故这三张表**只放凭证与映射，不放任何租户业务数据**，读取面收敛到 connector。
- **D10：企业代码 = `corp_id`**（如 `ww1234...`），不是内部 `tenant_key`。客户能从上企微后台看到 corp_id，
  也能由服务商后台生成带码的专属登录链接；`tenant_key` 不出现在 URL 里。
- **单租户部署**（绝大多数现状）：默认租户 `default`，登录页不显示企业代码，provider 恒注默认值，UX 与今天一致。
- **枚举风险**：企业代码解析端点须限频（复用 `sys_login_throttle`），不返回企业列表，错误文案不区分「无此企业」与「已停用」。

**放弃的方案与原因**（记录备查）
- **L1（`users` 共享表）**：22 处 `users` 查询里 3 处 list 需手加过滤、5 处用户名唯一性语义要重定义；
  且最敏感的表失去自动注入保护，最坏失效是静默跨租户读用户目录。
- **L3（登录端点 `asSystem()`）**：`asSystem` 是**请求级**开关（`oj-bin/src/bridge/guard.rs:404`：
  `if guard == Off || system { return Ok(()) }`），登录 handler 内后续任何查询一并放行；全仓现为 0 处使用，
  且 devkit 文档标注「业务 handler 禁用」。L1/L3 还都要求用户名全局唯一，与「同 corp 内各自有 admin」冲突。

### 5.4 connector
端点表（Phase 1 那张）+ 企微侧细节：
- `permanent_code` 每 `(suite, corp)` 一个；`agentid` 从 `get_permanent_code` 的 `auth_info.agent[]` 取。
- `corp access_token` 走 `suite access_token` + `permanent_code` 换，按 (corp, agent) 缓存，TTL 7200s，遇 `40001/42001` 失效重取。
- `suite_ticket` 每 10 分钟推送，落库并内存缓存；过期不得发起 API。
- 回调 URL 需企微后台备案 + `echostr` 验证；API 调用需**可信 IP**。
- 网页授权 `snsapi_base` 需应用**可信域名**；扫码用 qrConnect（`appid`+`agentid`）。

### 5.5 前端
- **租户上下文**：新增 `tenantStore`（persist）：来源优先级 `?tenant=` URL 参数 → 本地持久化 → 部署默认值。
  在 `_platform` web 入口注册 `ctx.register.headerProvider(() => ({ "X-TENANT-ID": tenantStore.getState().tenant }))`。
  `runtime/src/utils/request/index.ts:44-50` 会在 token/语言之后逐请求合并（同名头以 provider 为准）。
- 登录页不再硬编码 `local|ldap|sso` 三元过滤，改为按后端 `methods` 渲染；多租户且无 `?tenant=` 时显示「企业代码」输入框。
- `AuthProvider(wecom).login()`：跳 `/auth/wecom/login`；回调页读 `ticket` → `POST /auth/wecom/ticket` → 返回 `AuthType` 由 runtime 统一写库。
- 纯浏览器：无 corp 上下文时展示「输入企业代码」+「服务商授权安装」两条路。
- 登出/切换租户必须清 `tenantStore` 与 token（否则下一个用户会带着上一个租户的头）。

### 5.6 代开发后台
开通入口、企业列表、profile 状态、停用/解绑、首登资料补全（`display_name` 空则强制补全，沿用 `must_change` 类似机制）。

### 5.7 安全回归清单
1. 伪造 `X-TENANT-ID` → 403（R6 后由 oj 拦；之前由 `currentAccess()` 拦）。
2. 跨租户裸 SQL → 被 `sql_guard: deny` 拒。
3. 构造器 insert 未显式给 `tenant_id` → 自动落当前租户（且伪造值被拒）。
4. 同 userid 跨 corp → 两条 `users` 行，互不可见。
5. ticket 重放 → 401；过期 → 401；已停用 corp → 拒绝登录。
6. `sys_refresh_token` 跨租户刷新 → 拒。

## 6. 上游 oj 需求（以合理性提出，只读不实现）

- **R6（阻塞级）— `jwt.sign` 支持自定义 claims**。
  现状：`Claims{sub,roles,iat,exp}` 固定，多传字段**静默丢弃**（`crypto.rs:62-67`、`:87-121`）。
  需求：payload 增加可选 `claims`/至少 `tenant`，编入 token 且 `jwt.verify` 回读；`http.user.claims.tenant` 可用。
  理由：这是 `tenant.require_signed_claim`（已存在的平台机制）唯一的缺口；补上后多租户绑定在 oj 层 fail-closed，
  下游模块不需要各自造绑定中间件。改动面：`Claims` 增字段 + `op_jwt_sign` 透传 + `op_jwt_verify` 返回，向后兼容。
- **R7（可选）— `jwt.verify` 返回完整 claims**，供模块侧自校验（当前只回 `sub/roles/iat/exp`）。
- 已确认**不需要**的需求（v2 曾提，现撤销）：R1 自定义 IdP、R2 id_token 取租户、R3 sub 唯一性、R4 `/oidc/external`、R5 `env` 透传——因为不再走 OIDC IdP 路线。

## 7. 上线前提（服务商侧 checklist）

1. 服务商资质、第三方应用（suite）创建，拿到 `suite_id/suite_secret/EncodingAESKey/token`。
2. 应用可信域名（网页授权）、登录回调 URL、指令回调 URL 备案。
3. 可信 IP 白名单（服务商调企微 API 的出口 IP）。
4. 测试企业用于联调（D7）。
5. 数据合规：`permanent_code` = 全 corp 数据权限，必须加密存储 + 最小读取面 + 审计；userid 按最小必要落库。

## 8. 风险 / 范围外

- R6 未落地期间，租户绑定是「模块侧单点校验」，强度低于平台级；必须显式记录为临时态。
- 21 张表租户化的迁移风险：存量数据 `default` 租户，**不做**自动归户；升级后由管理端显式分配。
- 代开发 connector 在本仓实现，oj 只配置，符合「只调整本项目，其余项目只读」。

## 9. 决策状态

| 项 | 状态 |
|---|---|
| 登录前租户来源 | **已定 L2**（§5.3），含 D8/D9/D10 |
| 会话归属 | 已定 Model C：`_platform` 会话权威（§1-E/F） |
| 租户隔离机制 | 已定：`tenant.enable` + `sql_guard: deny` + R6 |
| 上游需求 | 收敛为 R6（阻塞）/ R7（可选） |
| 未决 | 无；Phase 0 已实施（§10），下一步 Phase 1 connector |

## 10. Phase 0 实施记录（2026-10-30）

### 10.1 落地清单

| 项 | 落点 |
|---|---|
| config `tenant` 段 | `packages/cli/templates/config.yaml`（enable / header_key / sql_guard:deny / shared_allow 10 项 / allow_as_tenant / anonymous_paths / require_signed_claim:false） |
| schema 定性 | `_platform`：users(+tenant_id,+corp_id)、sys_oplog、sys_user_role、sys_refresh_token 加列；sys_setting、sys_solution_route、sys_role、sys_permission、sys_role_permission、sys_rate_window、sys_login_throttle、market_history、reg_source_seq、_oj_migrations 标 `tenant: false`。notification 4 表 / home 2 表 / demo.todos 加 `tenant_id` |
| 迁移 | `_platform/0015__tenant.sql`（+`.pg`/`.mysql`）、`notification/0005__tenant`、`home/0002__tenant`、`demo/0002__tenant` |
| 裸 SQL | `notification/_shared/notify.ts` 两处 `INSERT..SELECT` 显式写 `tenant_id` 并把当前租户当绑定参数（守卫 deny 下缺一即拒）；`paged()` 补红线注释 |
| 前端 L2 | 新增 `login/web/store/tenant.ts`（`?tenant=` → 持久化 → `default`）；`login/web/entry.ts` onInit 注册 `headerProvider` 并订阅登出清租户；登录页折叠式「企业代码」入口（单租户 UX 不变） |
| 回归 | `packages/cli/src/__tests__/templates-tenant-scope.test.ts`（4 例：config 门禁 / 二选一定性 / shared_allow 无拼写错 / 21 表 A-B 快照） |

### 10.2 相对 §5.2 的两处偏差（有证据）

**偏差 1：三张表改归 B 组（原计划 A 组）**
- `sys_solution_route`：PK = `path`，读法是 `where module = ?` 的站点级路由/启用注册表，安装/卸载/启停都是站点操作（`solutions/api.ts:92`、`uninstall.ts:178`、`installer.ts:1083`）。若按租户化，`path` 主键下各租户只会看到自己那几行，而安装只发生一次 → 菜单为空。
- `market_history`：解决方案安装的站点级留痕，装一次全站生效。
- `reg_source_seq`：源码注释即写明「记在**站点** DB，受害者是站点」（`_lifecycle/source-seq.ts:3`），租户化会让防回放水位分裂。
- 结果：A 11 / B 10（原写 12/9）。

**偏差 2：`tenant.anonymous_paths` 只留 `/system/login-methods`**
- 原计划把 `/auth/login|ldap-login|refresh|logout` 也列进去。实测：列进去后，缺头请求被标为「匿名」放行到 handler，随后构造器查 `users` 触发守卫 → **500 `tenant guard: table(s) ["users"] require tenant context`**。
- 这些端点由前端 `headerProvider` 每请求注头（单租户恒 `default`），本就不该匿名；移出后缺头直接得 **400 `missing tenant header: X-TENANT-ID`**（语义正确、可观测）。
- `/auth/wecom/**` 在 Phase 1 落地时再加（那是真带不了头的 302 回跳）。

### 10.3 实测证据（本地 oj 0.1.110 + 迁移后的 dev 库）

| 用例 | 结果 |
|---|---|
| `POST /auth/login` 无 `X-TENANT-ID` | 400 `missing tenant header: X-TENANT-ID` |
| `POST /auth/login` 带 `X-TENANT-ID: default` | 200（SQL trace：`SELECT … FROM users WHERE username = ? AND users.tenant_id = ?`） |
| 同账号带 `X-TENANT-ID: acme` | 401 `invalid credentials`（跨租户查不到用户 → 隔离生效） |
| `GET /system/login-methods` 无头 | 200（共享表 `sys_setting`，无需租户） |
| `POST /notification/notifications/read-all` | 200；裸 SQL trace 为 `INSERT OR IGNORE INTO … (tenant_id, …) SELECT tenant_id, id, ?, ? FROM notifications_broadcast WHERE tenant_id = ?`，守卫放行 |
| 构造器写 | `INSERT INTO sys_refresh_token (…, tenant_id) VALUES (…)` 自动落当前租户 |

### 10.4 验证与未跑项

- 已绿：`pnpm test:cli`（580 passed）、`@oj-module/core`（32 passed）、templates `typecheck` + `typecheck:api`、`ojm build`、eslint。
- **未跑**：`tests/e2e/templates`（playwright）。本机 5174 与 9778 已被其他工程（oj-dbx / oj-bin）常驻占用，`ojm dev` 无法按配置端口启动，起不来就无从复用。待占用释放后补跑；API 层已用上表探针覆盖同等语义。
- 迁移已在本机 dev 库执行成功：`migrate: _platform 2 applied / demo 1 / home 1 / notification 1`（0014→0015）。

