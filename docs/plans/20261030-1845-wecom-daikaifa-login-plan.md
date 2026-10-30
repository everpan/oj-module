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

### Phase 1（connector）— 已实施，见 §11
- `GET /auth/wecom/login?corp=&agent=&env=`：UA 检测 → 企微内 OAuth2 / 外部 qrConnect / 无 corp 时引导输入企业代码。
- `GET /auth/wecom/callback?code&state`：`code→userid` → JIT → 一次性 ticket → 302 SPA（**不在 URL 里带 token**）。
- `POST /auth/wecom/ticket`（一次性 ticket 换 TokenBundle，防 token 出现在 URL）。
- `GET|POST /auth/wecom/event`：URL 验证 `echostr`、`suite_ticket`、`create_auth`、`change_auth`、`cancel_auth` 全量事件。

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

**B. 共享 13 张（schema `tenant: false` + config `tenant.shared_allow` 双声明，缺一则声明被忽略）**
```
_oj_migrations      -- oj 自建自管 DDL
sys_setting         -- D8：登录方式发现是未登录端点，此刻没有租户上下文
sys_solution_route  -- PK=path 的站点级路由/启用注册表；安装是站点操作（见 §10 偏差 1）
sys_role / sys_permission / sys_role_permission -- 框架角色目录；分配关系在 A 组
sys_rate_window     -- 登录前限速，必须全局
sys_login_throttle  -- 同上
market_history      -- 解决方案安装/升级/回滚是站点级留痕（见 §10 偏差 1）
reg_source_seq      -- 索引新鲜度水位属于站点（源码注释即「记在站点 DB」，见 §10 偏差 1）
wecom_app_profile(suite_id, corp_id, agent_id) PK 三列；env 标签；permanent_code_enc 加密列
wecom_suite_ticket(suite_id) PK；suite_ticket / expires_at
wecom_login_ticket(ticket_hash) PK；uid / owner_tenant / expires_at / used
```
> B 组 = 不受 guard 约束，**只放全局映射/凭证/框架目录，不放租户业务数据**（当前 11 A + 13 B = 24）。
> `wecom_login_ticket` 要跨「匿名回调」与「已认证换取」两段，故共享；但它**不能**声明 `tenant_id` 列——
> 共享表带 `tenant_id` 列属自相矛盾（守卫会当租户表要求上下文），故该列命名 `owner_tenant`，
> 语义仍是「这张票据属于哪个租户」，由 `ensureTenant(owner_tenant)` 在兑换时补上下文。

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

**端点表（实施后）**

| 方法 | 路径 | 匿名 | 租户来源 | 成功返回 |
|---|---|---|---|---|
| GET | `/auth/wecom/login?corp=&agent=&env=` | 是 | 参数 `corp` → `wecom_app_profile` 查表（不猜默认） | 302 到企微（OAuth2 / qrConnect） |
| GET | `/auth/wecom/callback?code&state` | 是 | `state` 里带的 corp → `ensureTenant(corp)` | 302 到 `{origin}/login?wecom_ticket=…&tenant=…` |
| POST | `/auth/wecom/ticket` | 是 | 票据行的 `owner_tenant` → `ensureTenant` | `TokenBundle`（access+refresh） |
| GET | `/auth/wecom/event?msg_signature&timestamp&nonce&echostr` | 是 | 无（套件级） | `text/plain` 原样回 `echostr` |
| POST | `/auth/wecom/event`（XML 密文） | 是 | 无（套件级） | `text/plain` `success` |

四处都在 `tenant.anonymous_paths`：302 回跳与企微服务器回调**都带不了自定义头**，租户只能服务端用
`db.asTenant()` 补（§5.3 第三层）。顺序上 `callback` 必须先 `ensureTenant` 再碰 `users`，否则守卫直接抛错。

**部署常量（config `vars:`，6 项）**

| var | 说明 |
|---|---|
| `wecom_suite_id` / `wecom_suite_secret` | 代开发模版凭据（部署级，一个部署 = 一套模版） |
| `wecom_callback_token` / `wecom_encoding_aes_key` | 回调签名 token 与 43 字符 EncodingAESKey |
| `wecom_enc_key` | `permanent_code` 落库的 AES-GCM 密钥（16/32 字节 hex 或 base64） |
| `wecom_base_url` | 连接器基址，派生两个地址：回调 URL=`<base>/event`、`redirect_uri`=`<base>/callback` |

> 为什么合成一个 `base_url`：原计划配 `wecom_callback_url` 单值，但 redirect_uri 也需要，两处手填必然漂移；
> 企微后台要求回调 URL **逐字一致**，改一处漏一处就会「事件收不到、登录回不来」。合成后只有一处可错。
> 密钥格式在**读配置处** fail-fast（`assertEncKey`）：oj 的 `aesGcmEncrypt` 只收 16/32 字节，
> 32 个随意字符按 base64 解出 24 字节（AES-192，不支持）——那种错会拖到 `create_auth` 回调才炸，排查成本最高。

**企微侧细节**
- `permanent_code` 每 `(suite, corp)` 一个；`agentid` 从 `get_permanent_code` 的 `auth_info.agent[]` 取，**逐 agent** 落一行。
- `corp access_token` = 用 `permanent_code` 当 corpsecret 换（与自建应用同一条 `cgi-bin/gettoken`），按 (corp, agent) 缓存，TTL = `expires_in - 300`，遇 `40001/40014/42001` 失效重取一次。
- `suite_ticket` 每 10 分钟推送，TTL 记 30 分钟；缺失/过期 → 503，**不拿过期票打企微**。
- 回调 URL 需企微后台备案 + `echostr` 验证；API 调用需**可信 IP**。
- 网页授权 `snsapi_base` 需应用**可信域名**；扫码用 qrConnect（`appid`+`agentid`）。
- 签名与解密：`sha1(sort(token,timestamp,nonce,Encrypt))` + AES-256-CBC。oj 全局 `crypto` **没有 SHA-1、没有 AES-CBC**
  （只有 `aesGcm*`），故在 `_shared/wecom/crypt.ts` 手写（见 §6 R8）。
- 明文回包必须 `content-type: text/plain`：`json.raw` 会 JSON 转义（`"echostr"` 带引号 → 企微校验失败），走 `json.stream`。
- 枚举防护：企业代码解析端点复用 `sys_login_throttle`，「未授权」与「已停用」**同码同文案**；
  `code→userid` 的各类失败（无效 code / 非本企业成员）统一 401 一句话。
- 登录票据：`randomHex(32)` 只出现一次在 302 URL，库里存 `sha256Hex`，TTL 180s，`update used=1 where used=0` 原子兑换（并发双花只可能成功一次）。

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
- **R8（非阻塞，Phase 1 已绕过）— `crypto` 补 `sha1Hex` 与 `aesCbcDecrypt`**。
  现状：oj 全局 `crypto` 只有 `sha256Hex/md5Hex/aesGcm*` 等，**无 SHA-1、无 AES-CBC**；而企微回调用
  `sha1(sort(token,timestamp,nonce,Encrypt))` 验签、`AES-256-CBC` + PKCS#7 解密（密钥=b64(EncodingAESKey+"=")，
  iv=key[0..16]）。当前在 `auth/api/_shared/wecom/crypt.ts` 手写（312 行，S-box 由 FIPS 197 公式在加载时生成，
  `tests/wecom-crypt.spec.ts` 14 例与 Node `node:crypto`/WebCrypto 逐项对齐）。
  若上游提供这两个原语，本仓可删掉整份实现（少 312 行需自证正确的密码学代码）。
  理由：同类「企业微信/钉钉/飞书回调」都是这个组合（sha1 验签 + CBC 解密），不是本项目特有需求。
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
| 上游需求 | 收敛为 R6（阻塞）/ R7（可选）/ R8（非阻塞，Phase 1 已手写绕过） |
| 未决 | 无；Phase 0 已实施（§10）、Phase 1 已实施（§11），下一步 Phase 2 前端 |

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


## 11. Phase 1 实施记录（2026-10-30）

### 11.1 落地清单

| 项 | 落点 | 说明 |
|---|---|---|
| 迁移 | `auth/api/migrations/0001__wecom.sql`（+`.mysql`/`.pg`） | 三张共享表；`.pg` 的时间列用 `BIGINT`，`.mysql` 把 TEXT 收成 VARCHAR 并把索引内联 |
| 运行时元数据 | `auth/api/schema.yaml` | 与迁移同源的三表声明，全部 `tenant: false`（见 §5.2 D9） |
| 模块清单 | `auth/api/manifest.yaml` | `tables:` 列出三表 |
| 加解密原语 | `auth/api/_shared/wecom/crypt.ts`（312 行） | SHA-1 / AES-256-CBC 解密 / PKCS#7 / base64 与 hex 互转 / 企微签名 |
| XML 取值 | `auth/api/_shared/wecom/xml.ts` | 只从**已验签解密**的明文里取字段；CDATA 与实体解码 |
| 部署常量 | `auth/api/_shared/wecom/config.ts` | 缺项一次报全；`base_url` 派生回调与 redirect；`assertEncKey` 在读配置处校验密钥尺寸 |
| 存储 | `auth/api/_shared/wecom/store.ts` | profile 增改查、suite_ticket 读写、一次性票据签发/原子兑换、`ensureTenant` |
| 凭证链 | `auth/api/_shared/wecom/client.ts` | suite_token / permanent_code / corp_token / code→userid，含缓存与 `40001` 一次重试 |
| 登录编排 | `auth/api/_shared/wecom/login.ts` | 授权 URL 双形态、state 一次性、JIT 建档、落地地址拼装 |
| 事件分发 | `auth/api/_shared/wecom/events.ts` | `suite_ticket` / `create_auth` / `change_auth` / `cancel_auth` / `reset_permanent_code` |
| 端点 | `auth/api/wecom/api.ts`（216 行，4 个 handler） | 见 §5.4 端点表；302 与 `text/plain` 不套 `respond()` 外壳 |
| 配置 | `packages/cli/templates/config.yaml` | `tenant.shared_allow` +3 表（10→13）；`tenant.anonymous_paths` / `auth.anonymous_paths` 各 +4 路径；`vars:` +6 项 |
| 登录方式发现 | `_platform/api/_shared/service/domain/settings.ts` | `listLoginMethods()` 读 `wecom.enabled`，开关开但凭据缺 → 前端会收到 400（比静默隐藏好排查） |
| 种子 | `_platform/api/seed.sql` | `sys_setting` 加 `wecom.enabled=0`（方言种子只含用户/角色，无需改） |
| 用户名红线 | `_platform/api/_shared/service/domain/users.ts` | 保留前缀 `^(?:ldap\|sso\|wecom):` |
| 用户页提示 | `system/web/pages/users/index.tsx` | `extra` 文案补 `wecom:` |
| 契约 | `openapi.json` + `auth/web/__client/*` | 4 路径 / 5 操作；`ojm api --check` 把关 |
| 回归 | `tests/wecom-crypt.spec.ts`(14) / `wecom-connector.spec.ts`(36) / `wecom-endpoints.spec.ts`(18) | 见 11.3 |
| 守门 | `packages/cli/src/__tests__/templates-tenant-scope.test.ts` | 表数量快照 21 → 24，共享表清单补三张 |

### 11.2 相对 §5.4 的五处偏差（均有证据）

**偏差 1：事件端点收敛到 `/auth/wecom/event`（原写 `/wecom/suite/event`）**
- 匿名路径是**按模块前缀**配置的（`config.yaml` 的 `auth.anonymous_paths`），事件端点若挂到别的模块前缀，就要在
  两处路径清单里各写一条，而它们必须与 `apiPrefix` 保持同步。收进 auth 后：一个前缀、一份清单、一处漏配风险。

**偏差 2：`wecom_callback_url` → `wecom_base_url`**
- 原计划单值回调 URL，但网页授权的 `redirect_uri` 是第二个地址。手填两处必然漂移，而企微后台要求回调 URL
  **逐字一致**。改为配基址、派生 `<base>/event` 与 `<base>/callback`（§5.4 部署常量表）。

**偏差 3：`wecom_login_ticket` 的租户列改名 `owner_tenant`**
- 该表是共享表（`tenant: false`），而共享表再声明 `tenant_id` 列属于自相矛盾——守卫会把它当租户表要求上下文，
  而它恰恰要在「没有租户上下文」的匿名阶段被读。`templates-tenant-scope.test.ts` 的定性快照会直接报出来。
- 语义不变：仍是「票据属于哪个租户」，兑换时 `ensureTenant(owner_tenant)` 补上下文再发会话。

**偏差 4：SHA-1 与 AES-256-CBC 手写**
- oj 全局 `crypto` 无 SHA-1、无 AES-CBC（见 §6 R8）。企微回调验签/解密绕不开，故在 `_shared/wecom/crypt.ts` 实现，
  并与 Node `node:crypto`、WebCrypto 逐字节对照（`tests/wecom-crypt.spec.ts`）。上游补齐后整份可删。

**偏差 5：`openapi.json` 手工拼装（不是整份重生成）**
- `oj openapi --module-root src` 在本仓跑不起来：`node_modules/@oj-module/runtime` 是指向仓外的符号链接，
  生成器报 `module path … escapes project root`。
- 变通验证：把模板整份复制到 `/tmp` 并把 runtime 实体拷贝进去 → 生成成功（50 路径 / 73 576 字节），
  但那条路径产出两处失真：`x-oj-file` 前缀带上 `api/`（`auth/api/wecom/api.ts`），且相邻路径条目的 `x-oj-file` 丢失。
- 故只把新增的 4 路径 / 5 操作按生成器顺序插入提交版 `openapi.json`，`x-oj-file` 手改为 `auth/wecom/api.ts`；
  随后 `ojm api` 重生成 `__client`、`ojm build` 重生成 `dist/api/routes.js`，`ojm api --check` 双向对账通过。

### 11.3 实测证据

**单测（模板仓 `pnpm exec vitest run`）**：38 文件 / 756 通过。其中三份企微专项：

| 文件 | 例数 | 覆盖的「会静默出错」点 |
|---|---|---|
| `wecom-crypt.spec.ts` | 14 | SHA-1 对 OpenSSL、AES-CBC 对 WebCrypto、签名排序、`random\|len\|msg\|receiveid` 解析与 receiveid 不符即拒 |
| `wecom-connector.spec.ts` | 36 | profile 三种拒绝同码同文案、多应用未指定 agent、suite_ticket 过期不发请求、票据单次兑换/过期/清理、`ensureTenant` 两分支、JIT 幂等与唯一约束撞车、缓存 TTL 与 `40001` 重试、三类事件落库与解绑清会话、授权 URL 双形态、state 取即删、密钥格式 fail-fast |
| `wecom-endpoints.spec.ts` | 18 | 缺 vars 一次报全、缺 corp、未知 corp、企微内/浏览器两条 302、双应用无 agent、happy path 302 且 URL 无 token、state 重放、非成员 401 不留半截账号、票据兑换、复用 401、租户不符 403、`echostr` 回显、错签名、`suite_ticket` 事件、缺 Encrypt、外来 receiveid |

**真实实例（本地 oj 0.1.110，sqlite，`oj serve` 于 18778 + 迁移后的 dist/api）**：

| 用例 | 结果 |
|---|---|
| `GET /auth/wecom/login` 缺 `corp` | 400，引导去登录页填企业代码 |
| `GET /auth/wecom/login?corp=ww_unknown` | 400 `企业代码无效或应用未开通`（与「已停用」同文案） |
| `POST /auth/wecom/ticket` 伪造票据 | 401 |
| `GET /auth/wecom/event` 错签名 | 400 `回调签名校验失败` |
| 登录端点带伪造 `X-TENANT-ID` | 400（匿名路径不接受外部注入的租户头） |
| `GET /auth/wecom/event` 真实签名 `echostr` | **200，`text/plain` 回显 `echo_probe_42`**（未 JSON 转义） |
| `POST /auth/wecom/event` 真实签名 + 加密的 `suite_ticket` | **200 `success`**，且 `wecom_suite_ticket` 落行、`expires_at = now + 1800` |

### 11.4 验证与未跑项

- 已绿：`pnpm test:cli`（580 passed / 1 skipped）、`@oj-module/core`（32 passed）、模板 `vitest`（756 passed）、
  `tsc -p src/tsconfig.json`、模板 `typecheck`、`ojm build`、`ojm api --check`（0 error / 0 warn）、eslint。
- **未跑**：`tests/e2e/templates`（playwright）。端口 5174 / 9778 仍被其他工程常驻占用（同 §10.4）；
  Phase 1 是纯服务端，已用上表真实实例探针覆盖同等语义，Phase 4 再补浏览器链路。

### 11.5 交给 Phase 2 的接口事实（前端按此实现，不要猜）

- 授权入口：`GET /auth/wecom/login?corp=<企业代码>&agent=<可选>&env=<可选>`，**返回 302**，前端用
  `window.location.assign` 而不是 XHR（XHR 会拿到 opaque redirect）。
- 回调落点：`{origin}/login?wecom_ticket=<ticket>&tenant=<企业代码>`；页面要先写 `tenantStore`（否则换票时
  `ensureTenant` 判 403），再 `POST /auth/wecom/ticket {ticket}` 取 `TokenBundle`（与 `local`/`ldap` 同结构）。
- 票据 180 秒有效、只能用一次；失败一律 401，前端提示「登录已过期，请重新从企业微信进入」。
- 登录方式列表已含 `wecom`（受 `sys_setting.wecom.enabled` 控制），登录页不该再硬编码 `local|ldap|sso` 三元。

## 12. Phase 2 实施记录（2026-10-30）

### 12.1 落地清单

| 项 | 落点 | 说明 |
|---|---|---|
| 载荷契约 | `packages/runtime/src/api/user/types.ts` | `LoginInfo.method` 增 `wecom`，新增可选 `ticket`（一次性票据，口令留空）；只扩可选字段，旧调用点零改动 |
| 认证 provider | `login/web/auth-provider.ts` | `login`：wecom 走 `POST auth/wecom/ticket`，其余原样委托 `fetchLogin`；`logout`/`getUserInfo` 委托 `fetchLogout`/`fetchUserInfo` |
| 注册 | `login/web/entry.ts` | `onInit` 里 `ctx.register.authProvider(...)`，与 `headerProvider` 同一处（登录动作之前） |
| 登录页 | `login/web/pages/login.tsx` | 方式注册表 `KNOWN_METHODS` 驱动 tab；新增企微面板（企业代码 + 整页跳转）；落地换票 effect（只跑一次） |
| 纯逻辑 | `login/web/wecom.ts` | `parseWecomLanding` / `wecomAuthorizePath`，零依赖便于 node 侧回归 |
| 文案 | `login/web/locales/*`、`system/web/locales/*` | `login:method.wecom*`、`system:loginMethodsPage.methodWecom`、`system:setting.wecom_enabled` |
| 设置页 | `system/web/pages/login-methods/index.tsx` | `METHOD_KEY` 增 `wecom` |
| 回归 | `tests/wecom-landing.spec.ts`（9 例） | 落地参数解析的四种形态、redirect 不被吞、授权入口缺 corp 仍跳且做 URL 编码 |

### 12.2 三个非显然决定

**决定 1：用 `authProvider` 而不是在页面里 `useAuthStore.setState`**
- `useAuthStore.login()` 只有两条路：provider 或内置 `auth/login`。企微拿到的是**票据**不是口令，走不了内置路；
  而 token 的写入/持久化/后续 guard 拉用户信息必须只有**一个**入口（runtime 注释：两套写入路径会让状态不可推理）。
- 代价是 provider 是**全量接管**，故其余方式一律原样委托内置函数（`fetchLogin/fetchLogout/fetchUserInfo`），
  行为与未注册时逐字节一致；将来 runtime 改默认链，模板不需要跟着改。
- 曾评估「直接改 runtime `fetchLogin` 里加一条 wecom 分支」：会让框架耦合某个 IdP 厂商，
  而 provider 接缝正是为这类扩展准备的（§5.5 的方案也是 provider）。

**决定 2：企微面板不写 `tenantStore`，只有服务端回跳带的 `tenant` 才写**
- 企业代码是**未经验证的输入**：写进 store 后，用户若取消授权再改用口令登录，会带着一个不存在的租户头，
  表现为「密码明明对却 401」。故发起授权只把 corp 拼进 URL，租户由后端 302 回跳时的 `?tenant=` 落定
  （`bootstrapTenant()` 在 `onInit` 已处理，落地 effect 里再显式设一次是为了不依赖加载顺序）。

**决定 3：落地换票用 ref 守卫，只发一次**
- 票据单次有效：React 18 的 effect 双调用/用户刷新页面都会触发第二次 POST，结果是把真正的错误盖成
  「登录票据无效或已使用」。第二次直接不发，让用户看到第一次的真实原因。

### 12.3 附改（顺带修的一个真 bug）

- `ssoLogin()` 由 `window.location.assign("/auth/sso")` 改为 `withSiteBase("/auth/sso")`。
  子路径部署（`window.__OJ_BASE__ = "/oj/"`）下，原写法会把用户跳到宿主机根的 `/auth/sso`（404）。
  wecom 入口一开始就用 `withSiteBase`，两处保持一致。

### 12.4 验证

- 已绿：模板 `vitest`（39 文件 / **765** 通过，含新增 9 例）、模板 `typecheck`（`tsc --noEmit -p tsconfig.json`）、
  `ojm build`（login / system 等模块均重建成功）、eslint（0 error 0 warning）。
- 未跑：`tests/e2e/templates`（playwright，端口占用同 §10.4/§11.4）。前端链路的真机验证顺延到 Phase 4：
  需要一条真实套件 + 测试企业，才能在企微内完成一次 OAuth2 回跳。
