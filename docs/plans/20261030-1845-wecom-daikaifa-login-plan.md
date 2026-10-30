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

### Phase 0（前置，不做则隔离是空话）
1. `config.yaml` 加 `tenant` 段：`enable: true`、`header_key: X-TENANT-ID`、`sql_guard: deny`、
   `shared_allow: [...]`、`allow_as_tenant: true`、`anonymous_paths`（登录/回调/登录方式发现）。
   注意：开启后**所有** `{base}` 请求缺头即 400，除 `tenant.anonymous_paths` 命中；`require_signed_claim` 先保持 false（等 R6）。
2. 21 张表逐张定性：租户内数据加 `tenant_id TEXT NOT NULL DEFAULT 'default'`；真正全局的
   （`_oj_migrations`、`sys_permission`/`sys_role` 若做平台级、`market_history` 若做全局市场流水）标
   `tenant: false` **并**列进 `shared_allow`。
3. 清点裸 SQL（`db.raw`/`db.sql`/字符串查询），逐条补 `tenant_id` 条件；构造器查询不动。
4. 新增迁移 `0015__tenant.sql`（当前最新是 `0014__reg_source_seq`）。
5. 回归：跨租户裸 SQL 被拒；构造器 insert 自动落当前租户；update/delete 收窄。
6. **登录前租户来源**（§5.3 决策）先落地，否则 `sql_guard: deny` 会把登录查询打空。

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
```
users            + tenant_id TEXT NOT NULL DEFAULT 'default', + corp_id TEXT
sys_user_role    + tenant_id
sys_refresh_token+ tenant_id      -- 会话必须与租户同域，否则跨租户刷新
sys_oplog        + tenant_id
sys_setting      + tenant_id      -- 每租户独立配置（ldap/sso/wecom 开关）
sys_login_throttle / sys_rate_window + tenant_id
sys_solution_route / reg_source_seq  + tenant_id
notification 4 表 + tenant_id
home 2 表 / demo 1 表 + tenant_id
wecom_app_profile(suite_id, corp_id, agent_id)  PK 三列；env 标签；*_enc 加密列
wecom_suite_ticket(suite_id) PK；suite_ticket / expires_at
wecom_login_ticket(ticket_hash) PK；uid / tenant_id / expires_at / used  -- 一次性回调票据
```
> 21 张表的逐张定性表在实施时补进迁移文件头注释，避免「默认 default 蒙混过关」。

### 5.3 登录前租户从哪来（v2 完全缺失的阻塞点）
`tenant.enable` 后缺头即 400；本地用户登录时还不知道自己属于哪个租户，而 `localLogin` 要查 `users`。
三个可选，必须选一个写进实现：
- **L1（推荐）**：`users` 作为**共享目录表**（`tenant: false` + `shared_allow`），登录查询走 `asSystem()`；
  行内保留 `tenant_id` 仅作归属标注，登录成功后的会话绑定该值。代价：用户目录跨租户可见（与现状一致）。
- L2：登录请求显式带租户（子域 / 企业代码），`anonymous_paths` + `db.asTenant(tid)`。代价：多租户体验更重，个人用户不知道怎么填。
- L3：登录端点 `asSystem()`，其余全租户化。最简单但把「登录」变成特权路径，需审计。

### 5.4 connector
端点表（Phase 1 那张）+ 企微侧细节：
- `permanent_code` 每 `(suite, corp)` 一个；`agentid` 从 `get_permanent_code` 的 `auth_info.agent[]` 取。
- `corp access_token` 走 `suite access_token` + `permanent_code` 换，按 (corp, agent) 缓存，TTL 7200s，遇 `40001/42001` 失效重取。
- `suite_ticket` 每 10 分钟推送，落库并内存缓存；过期不得发起 API。
- 回调 URL 需企微后台备案 + `echostr` 验证；API 调用需**可信 IP**。
- 网页授权 `snsapi_base` 需应用**可信域名**；扫码用 qrConnect（`appid`+`agentid`）。

### 5.5 前端
- 登录页不再硬编码 `local|ldap|sso` 三元过滤，改为按后端 `methods` 渲染。
- `AuthProvider(wecom).login()`：跳 `/auth/wecom/login`；回调页读 `ticket` → `POST /auth/wecom/ticket` → 返回 `AuthType` 由 runtime 统一写库。
- 纯浏览器：无 corp 上下文时展示「输入企业代码」+「服务商授权安装」两条路。

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

## 9. 需确认（一个）

**Phase 0 的登录前租户方案选 L1 / L2 / L3**（§5.3）。其余按 v3 执行。
