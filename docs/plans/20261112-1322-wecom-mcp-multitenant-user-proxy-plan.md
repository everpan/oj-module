# 企微普通模式 MCP 插件 · 多租户按用户权限代理访问 实施方案

- 状态：**方案定稿（三项决策已拍板）**；本仓零实现代码改动，`oj-bin` 全程只读、未改一行
- 目标：企微普通模式机器人挂 MCP 插件，按「每租户一张长期固定 Bearer + `X-WeCom-User-Id` → 员工临时身份 → 代理访问」走通，满足**多租户 + 按用户权限**
- 权威依据：`docs/devkit/oj-api-dev/{api-manual.md,mcp-bot-guide.md}`、企微官方 `doc_id=21652`（插件字段 / `X-WeCom-User-Id`）、`doc_id=21663`（创建方式）
- 实测依据：`/tmp/oj-loop-lab`（oj 0.1.130，进程外编排层不死锁验证，仅 S≈0 正确性）
- 硬约束：**oj 侧能力缺口只提需求、不改 `oj-bin`**；带业务规则的编排属业务，落本仓

---

## 1. 已定决策与范围

### 1.1 三项拍板（已定，不再复议）

| # | 决策 | 落地 |
|---|---|---|
| **Q-B** | 签发 Bearer 加可选有效期天数 `ttl_days`：**`0`=长期固定、`>0`=有效期天数** | §4.1 有效期契约；「长期」= 系统上限 90 天内固定 + 到期轮换，字面「永不过期」另需 §8 R6 |
| **验收口径** | `tools/list` **只列工具**（展示面不按员工个人身份），算满足「按用户权限」——权限真门在 `tools/call` 的 per-tool `admit` | §4.3 按 method 分派；`tools/list` 一律走发现身份、不做 obo |
| **Q-I** | **租户自助签发**：每租户 `admin` 签本租户 Bearer | §4.1 `service-token` 自助形态；`assertSuperAdmin`→`assertSystemAdmin`、目标租户取签名 claim |

### 1.2 范围

- 本方案交付：走通架构 + 本仓前置改造清单 + 企微侧配置 + 实施 SOP + 风险与放行门。
- 不在范围：编码、发版、上线；企微后台真机联调（属 §11 放行门）。
- 已知约束：代码库为 **1 企微 corp = 1 租户**（`config.yaml:221` `wecom_app_profile`、`tenant-admin.ts` `tenant_id=corp_id`、`_platform/schema.yaml:250-259` 绑定表主键 `[tenant_id, provider, external_sub]`）。

### 1.3 术语

- **svc Bearer / 服务凭据**：bot 页「服务凭据」签的长期 token（`roles:["bot"]`），`claims` 带 `svc/jti/scopes/tenant`，明文只显示一次。
- **obo 换签 / 受托 token**：拿 svc Bearer 调 `/api/auth/obo`，换一张代表某员工、10 分钟、带该员工真实 roles 的 token。
- **admit**：oj 服务端准入/鉴权单点，工具权限在此判；对 `/mcp` **每条**入站消息（含 `initialize`/`ping`）先跑 `admit(Some("/mcp"))`（`mcp_http.rs:366`）。
- **1a 编排层**：本方案选定的网关——一个**非 oj handler** 的独立进程，用标准 HTTP 客户端做两步出站请求与响应回写。
- **发现身份**：握手/展示类 method（`initialize`/`ping`/`tools/list`）过 `/mcp` admit 用的凭据，不做 obo。
- **`pool_size`**：并行执行 JS handler 的 actor 数上限；`/mcp` 的 `initialize`/`ping`/`tools/list` 在 Rust 侧算完不占 actor，仅 `tools/call` 落 JS actor。

---

## 2. 总体架构

### 2.1 一句话

> **租户在那张长期 Bearer 的签名 claim 里，不在 `X-WeCom-User-Id` 里。** 一张 svc Bearer 由某租户签发，token 压着 `claims.tenant`；`X-WeCom-User-Id` 只是「这个租户里的哪个员工」。`sql_guard: deny`（`config.yaml:206`）+ 强绑定（`require_signed_claim: true`，`config.yaml:259`）把绑定查询、换签、工具调用全锁在这张 Bearer 的租户内。

- **多租户** = 每租户一套（机器人 + 插件 + Bearer + 员工绑定 + 企业域名），指向**同一个编排层进程/路径**；租户由各自 Bearer 选，网关对租户零感知（`dispatch.rs:345-377`）。
- **按用户权限** = 复用现成 `exchangeObo` 换员工本人 10min 受托 token，工具权限由服务端 `admit` 单点判。
- **代理访问** = 编排层把「静态 Bearer + 身份头」翻成「obo 换签 → `/mcp` 调用」，用自身 HTTP `Response` 回写企微。

### 2.2 为什么网关必须进程外

单进程把网关写成 oj handler、内嵌 `fetch` 回 `/mcp`：handler 占 1 个 actor 等内层 `tools/call`，内层又要占第 2 个 actor，`pool_size` 个这样嵌套即全站永久瘫、断连不自愈、须重启。**1a 进程外**：编排等待发生在非 oj 进程，oj 侧每次只跑一个「换签」或「工具」叶子、跑完释放 → 无循环等待。`/tmp/oj-loop-lab` 实测（oj 0.1.130）：内嵌自环 `N≥pool_size` 7/7 全挂；进程外两步独立 HTTP 10/10 组全 200、`seq_ok` 62/62。**这是 S≈0 叶子下的正确性（不死锁）结论，不是容量/吞吐证据**，容量归 §10 K14 上线门。

进程外用标准库 HTTP 客户端与 `Response`，**不注入任何 oj 全局**（`respond()` 会包 `{code,msg,data}` 信封、`json.raw()` 固定 200，均不适用）；自带客户端超时（oj `route_timeouts` 不打断 `await fetch`、运行时无 `AbortSignal`）。

```
企微普通模式机器人（平台托管模型，每租户一个）
  │ MCP 插件 POST https://<该租户企业域名>/api/wecom-bot/mcp
  │ Authorization: Bearer <本租户长期 svc token>
  │ X-WeCom-User-Id: E001827      （企业域名下企微注入；tools/call 才强制）
  │ Content-Type: application/json   Accept: application/json, text/event-stream
  ▼
1a 编排层（本仓独立进程；非 oj handler，不占 actor 池）
  │ 先只读解析入站体 method（转发用原始字节、不重序列化）：
  ├─ initialize / ping / tools/list：发现身份 → 单跳直转 /mcp（不做 obo、缺头放行）
  └─ tools/call：必须 X-WeCom-User-Id → ① POST oj /api/auth/obo（原 svc Bearer）
                                      ② POST oj /api/mcp（受托 token）
  ▼
oj /mcp（线路 B 现成，零改动）→ per-tool admit（按员工 roles）→ 工具 handler
  ▼
编排层用自身 Response(status, headers, bodyBytes) 一次性回写企微
```

`/auth/obo`、`/mcp` 在端点级 scopes 豁免表内（`dispatch.rs:290`），静态凭据的 `scopes` 不阻碍换签。

### 2.3 每租户一份清单

| 项 | 说明 |
|---|---|
| 一个普通模式机器人 + 一个 MCP 插件 | 该 corp 企微后台配置（§5） |
| 一张本租户 svc Bearer | 须先做 §4.1 自助签发改造；`claims.tenant`=本租户、`oj_svc_token` 行同租户落库 |
| 一份员工绑定 | `oj_bot_binding`：`provider="wecom"`、`external_sub`=通讯录成员账号（如 `E001827`）、`user_id`=本租户用户；CSV 导入现成（`bot.ts:218`） |
| 企业域名可达 | 插件 URL 须在该 corp 企业域名下，企微才注入 `X-WeCom-User-Id`（官方 21652）；见 §7 / §11#6 |

> 多租户 = 「N 套配置 → 1 个编排层进程」，复杂度在运营配置而非网关逻辑。URL 路径不含租户信息（路径 `/api/wecom-bot/mcp` 是**反代路径**，非 `src/app/api/**` 模板 API）。每 corp 需让**自己的企业域名**解析到编排层（CNAME/反代）；「CNAME 到反代是否仍算企业域名并注入身份头」是未验拓扑门（§11#6）。

---

## 3. 按用户权限：obo 换签 + per-tool admit

| 环节 | 事实 | 代码 |
|---|---|---|
| 换签校验 | 非 svc(40312) → jti 吊销(40311) → 绑定缺失(40310) → 员工停用(40313)，失败即拒 | `bot.ts:339-386` |
| 员工真实权限 | 受托 token 的 `roles` 实时查 `sys_user_role`，不是 svc 的 `["bot"]` | `bot.ts:388-401` |
| 静态凭据不放大权限 | svc `scopes` 不传给受托 token；判权按工具真实动词 | `api-manual §14` |
| 判权单点 | per-tool `admit` 用 `tier_of(verb)`（read/write/destructive），受托 token 按员工 roles 生效 | `dispatch.rs:292` |
| destructive 遮蔽 | `act_mask_destructive` 对受托会话拒 delete / 隐藏 destructive tool | `dispatch.rs:322-330` |
| tools/list 展示面 | 仅按 `scopes`/act_mask 裁可见性、**不进调用面**；现成设计本就非按员工 roles | `mcp_http.rs:155-169` |

> 机器人手上那张长期 Bearer 只是「我是个机器人」的入场券，不代表任何员工权限；拿 `X-WeCom-User-Id` 换成「此刻这个员工本人」的临时 token 后，能看什么改什么全由 oj 按员工角色判。**这正是硬要求「按用户权限」的落点，现成、零 oj 改动。**

跨租户隔离自动生效：拿 A 租户 Bearer + 某 `external_sub` 换签，`sql_guard` 把绑定查询锁进 A 租户；即便该账号在 B 租户也绑了人，A 查不到即 `40310`，不会串到 B；受托 token 的 `tenant` 复制自 A（`bot.ts:393-401`），后续 `/mcp` 全程在 A。`oj_bot_binding` 复合主键 `[tenant_id, provider, external_sub]` 允许不同 corp 通讯录账号撞车互不干扰。

---

## 4. 本仓前置改造（2 块）

### 4.1 `service-token` 自助签发 + 有效期契约

现状：`service-token/api.ts:36` 强制 `assertSuperAdmin()`；`:40` 取 `http.user.claims.tenant ?? "default"`；`post.schema`(`:43-53`) 无目标租户入参；`tenant-admin.ts:9-14,35-37` 明确 `superadmin` 平台级只留 `default`、每租户管理员是 `admin`。⇒ corpX 的 admin 过不了 `assertSuperAdmin`，签不出本租户 Bearer。

**改造（Q-I 自助形态，缺口 1 件）**：`assertSuperAdmin()` → `assertSystemAdmin()`（`access.ts:140-144`，含 `admin`）；目标租户继续取 `http.user.claims.tenant`（**绝不喂请求体自报**，避开 `tenant-admin.ts:26-30` 跨租户提权红线）；`bot.ts` 三处**不加** `forTenant`。强绑定下请求租户 = 调用者签名 claim（`dispatch.rs:345-363`），与 `api.ts:40` 同源 → JWT claim / insert 行 `tenant_id`（`sql_guard` 注入）/ list·revoke / obo 查 jti 四者结构性相等，无需 `forTenant`。

**有效期契约（Q-B）**：`post.schema` 加可选 `ttl_days`（整数），`issueSvcToken`（`bot.ts:115-138`）据此传 `ttl_secs`：

| 入参 | 语义 | `ttl_secs` |
|---|---|---|
| `ttl_days = 0` / 缺省 | 长期固定 | `90 × 86400`（系统上限） |
| `ttl_days > 0` | 有效期天数 | `min(ttl_days, 90) × 86400` |

**三条硬边界（决定实现写法，oj 0.1.130）**：

1. `jwt.sign` 把任意 `ttl_secs` 静默钳到 ≤90 天（`crypto.rs:137 .min(JWT_TTL_CAP_SECS)`、`:61 cap=7_776_000`）、且须为 `u64`（`:135`）。端点应校验 `ttl_days ≤ 90`，否则 oj 静默取 90、不报错。
2. **不能把 `0` 原样当 `ttl_secs:0` 传**：`ttl_secs:0` → `exp = now`（`crypto.rs:144 exp: now+ttl`），而验签 `validate_exp=true`、leeway 0（`crypto.rs:163-165`、`plugins/oj-auth/src/lib.rs:175`）→ token 出生即过期。`0` 必须由本仓翻译成「签 90 天」，非透传。
3. 故「长期」= **90 天内固定、到期轮换 + 轮换 SOP**（明文只显一次，吊销真相源是 `oj_svc_token` 行，删行 ≤30s 全网失效 `bot.ts:140-145`）。**字面「永不过期」在 oj 0.1.130 下签不出来**：`exp` 是保留键（`crypto.rs:112`）无法不设、`jwt.sign` 是 oj isolate 全局（`:96` `#[op2] op_jwt_sign`）编排层拿不到 → 若业务坚持字面永久，走 §8 **R6 上游需求**（只提需求、不改 `oj-bin`）。

**验收**：corpX admin 登录 → 签 Bearer → JWT `claims.tenant` = `oj_svc_token` 行 `tenant_id` = 受托 token `extra.tenant` = `corpX`，`/auth/obo` 200（非 40311）；corpX Bearer + 仅 corpY 存在的 `external_sub` → `40310` 绝不串租户；`ttl_days>0` 的 token `exp-iat` = 对应秒数；revoke ≤30s `SvcGate` 失效。

> 自助形态不改 `.schema` 的**目标租户**（取签名 claim），但 Q-B 新增 `ttl_days` 入参属 `.schema` 变更 → 触发 `openapi.json ↔ __client ↔ init.test.ts` 三处同步；改 handler schema 后用**最小补丁补字段、不整文件重生成**（重生成会有 8000+ 行格式 churn）。

**D11 安全姿态**：签发长期服务凭据下放给每租户 admin 是安全姿态变更（已按 Q-I 采纳自助即确认）；影响面 `grep -rln "assertSystemAdmin" templates/src/app/api --include=*.ts | wc -l` = 18。前提：每租户已 `ensureTenantAdmin`（`tenant-admin.ts:103-133`）真有 `admin`，接入时建、须核验。

### 4.2 1a 编排层（本仓新增组件）

独立进程、放 `src/` 外、入口非 `api.ts`（确定不归 `ojm api --check` 管辖，§4.1 的 `.schema` 变更才需契约同步）。职责：解析 method → 按 §4.3 分派身份 → obo 换签（仅 `tools/call`）→ 转发 `/mcp` → 回写企微。

### 4.3 实现约束

1. **响应透传**：第 ② 步 `/mcp` 的 status 与 body 字节原样回写；仅当 oj 未设 `Content-Type`（`fail_response` 不设，`dispatch.rs:436-441`）时补 `application/json`；`202 空 body` 严格 `202 + 空 body`、不补任何头；`406/415` 的 `{code,msg,data}` 信封照回。原语 =「status+body 不变，最多补一个缺失的 Content-Type」。第 ① 步 obo 响应不适用本条。
2. **头置换**：第 ② 步 `Authorization` 按 method 分派；始终剥 `X-WeCom-User-Id` / `X-TENANT-ID` / 原静态 svc Bearer；强制 `Content-Type: application/json` + `Accept: application/json, text/event-stream`（否则 oj 硬门 415/406）；租户从 Bearer claim 推导，**不转租户头**（防 `403 tenant header does not match signed claim`，`dispatch.rs:359`）。
3. **超时**：用编排层自身 HTTP 客户端超时；不用 `AbortSignal.timeout`（运行时无）、不依赖 oj `route_timeouts`。
4. **按 method 分派身份**（`mcp_http.rs:358-369` admit 先跑、`:457-482` 才分派 method ⇒ 不能对每条先 obo、更不能对每个 method 缺头 400）：

   | method | 身份 | 缺 `X-WeCom-User-Id` |
   |---|---|---|
   | `initialize` / `ping` | 发现身份、单跳直转 `/mcp`、不做 obo | 放行（不打断握手） |
   | `tools/list` | 发现身份、单跳直转 `/mcp`、不做 obo（验收口径：只列工具、展示面不按人） | 放行 |
   | `tools/call` | **唯一强制按用户身份**：必须有头 → obo → 受托 token → `/mcp` | **fail-closed 400**（仅此 method、且不进 obo） |

5. **发现身份**：默认 **D1 复用本租户静态 svc Bearer**（`svc_gate.rs:44-47` `SELECT jti FROM oj_svc_token` 是全局 jti 集、`/mcp` 在 scopes 豁免表 ⇒ svc Bearer 能过 admit；`/mcp` 仅内网、发现类只读展示面 ⇒ 不新增第 2 张凭据，保持 N 张）；若安全要求最小权限可换 **D2 单独只读发现 Bearer**（`scopes:["read"]`、与 obo 种子分离，2N 张 + 2N 套轮换）。两形态均须保证**主 obo 种子 Bearer 绝不直连 `/mcp` 的 `tools/call`**。
6. **obo 契约**：obo 200 = `{code:0,msg:"ok",data:{access_token,expires_in}}`（`respond.ts:16-22`）→ parse `data.access_token` 并校验 `code===0`，**不得把 obo 信封当 `/mcp` 响应回企微**；obo 失败码 `40310/40311/40312/40313` → HTTP 500 + `{code:4031x}`（`envelope.rs:40-55` `clamp_status`、`dispatch.rs:417` `from_u16` 越界→500）→ **必须映射、不得透传**：回企微 `HTTP 200` + JSON-RPC error `{"jsonrpc":"2.0","id":<原 id>,"error":{"code":-32000,"message":"[code=4031x] <msg>","data":{"code":4031x}}}`。透传 500 + 业务信封会破坏 MCP/JSON-RPC 帧、撞 K4 门。
7. **并发**：入口限流，`pool_size` 按峰值留余量；容量/延迟/失败路径压测移至 K14 上线门。

---

## 5. 企微侧配置（候选；K4/K3 过门后才称「最终配置」）

> 每租户一套；`<...>` 由该租户替换。

```
插件类型      : MCP
插件 URL      : https://<该租户企业域名>/api/wecom-bot/mcp   （不带尾 / 与 ?）
传输协议      : Streamable HTTP
授权方式      : Service token / API key
  位置        : Header
  参数名      : Authorization
  参数值      : Bearer <本租户 服务凭据 签发的明文>
请求头        : Content-Type: application/json
              Accept: application/json, text/event-stream   （oj 对 */* 直接 406，写死）
              （不要 X-TENANT-ID；X-WeCom-User-Id 由企微在企业域名下注入，勿手填）
可使用的成员  : 按该租户可见范围选择
```

- 若「参数值」不接受含空格的 `Bearer ` 前缀 → 退回「无需授权」+ 把 `Authorization: Bearer <token>` 放进请求头（官方措辞未保证前缀可用，属 §11#5 核验项）。
- **传输协议选 Streamable HTTP 而非 SSE**：oj `/mcp` 是 stateless 纯 JSON、无 SSE 端点。企微 MCP 客户端是否接受「无 `Mcp-Session-Id`、通知回 202 空 body、406/415 为 JSON 信封」= **K4**。
- 发现身份由编排层内部持有，不配进插件；该路径是反代路径、不含租户信息，租户由 Bearer 选。

---

## 6. `config.yaml` 配置

| 项 | 值 | 说明 |
|---|---|---|
| `server.mcp.enabled` | `true`（当前 `false`，`:49-50`） | 启用 `{base}/mcp` |
| `server.mcp.modules` | **非空 tool-tags 白名单** | `modules=None → return tools` = **缺席即全集（fail-open）**（`mcp_http.rs:137-140`）；有白名单按 tool `tags` 交集过滤、无匹配=空列表。须核验安装器锚点登记的「方案名」与被匹配 `tags` 是否同口径（`config.yaml:46-47`） |
| `server.mcp.allow_anonymous` | `true` | enabled 且未装配 auth 插件时须显式，否则 oj 启动 fail-fast（`config.yaml:48`） |
| `act_mask_destructive` | `true` | 代操作遮蔽（§3），建议开启 |

验收：起服后 `/mcp tools/list` 只列白名单工具、**且不得为全集**。

---

## 7. 安全边界与信任模型

| 项 | 事实 / 处置 |
|---|---|
| 信任来源 | MCP 插件这一跳**没有回调验签**，信任全落在「静态 svc Bearer 保密 + 企业域名下企微注入 `X-WeCom-User-Id`」 |
| 网络暴露 | 反代只暴露编排层；`/api/mcp`、`/api/auth/obo` 仅内网可达，防绕过编排层直接用静态 Bearer 调 `/mcp`（那会退回「全体用户共享静态身份」） |
| Bearer 泄露爆炸半径 | = 该租户全部已绑定员工（K5），非跨租户；配 IP 白名单（企微出口）、吊销 SOP（删行 ≤30s）、90d 轮换 |
| `X-WeCom-User-Id` 防伪 | 企微注入但编排层仍当外部输入：只在已验签 Bearer 锁定的租户内做绑定查、fail-closed 于 `tools/call` 缺头 |
| 代操作遮蔽 | `act_mask_destructive` 对受托会话拒 delete（§3） |
| 审计 | 每次换签（成败）落 `oj_obo_audit`（租户表），可按租户查（`bot.ts:64-74,251-315`） |

---

## 8. 对 oj 的需求（用户硬约束：只提需求，不改 `oj-bin`）

> 核心链路（`/auth/obo`、`/mcp`、`exchangeObo`、租户强绑定、`sql_guard`、`jwt.sign` 自定义 claim、svc 凭据管理）全部现成，**本方案对 oj 零代码改动**。本仓前置 = 2 块（§4.1 `service-token` + §4.2 编排层）。以下为条件性 / 可选上游能力，本仓不实现、逐条上报立项。

| # | 条件 | 需求 | 说明 |
|---|---|---|---|
| **R6** | 若业务坚持 Q-B「长期」= 字面永不过期 | oj 原生不过期 / 可续期 service credential，或原生 API key 形态（免 `Bearer ` 前缀） | 现行 `jwt.sign` 钉死 ≤90d + `exp` 必设（§4.1 边界 3），字面永久唯一合规出路 |
| **R5** | 仅当 K4 判企微不兼容 stateless 纯 JSON | `/mcp` 提供 SSE / 有状态会话能力 | 绑定 K4 门；触发即推翻「oj 零改动」前提，须立即上报用户并指定需求责任人 |
| **R3** | 文档准确性 | 修正 `api-manual.md:1981`「`AbortSignal.timeout` 全局已挂载」或挂载 `AbortSignal` | 实测 `ReferenceError`；1a 用自身客户端超时，不受影响 |

> R5 触发人 = K4 真企微验证执行人；所有 R 项按「若 oj 需要变动，则提出需求」只提不改。

---

## 9. 实施清单（SOP）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 放行门** | K4/K3 真企微验证（§11 逐条）+ §6 配置核验 | 逐条勾完、未过不进上线；不过则 R5 升 P0 |
| **P1 配置** | §6 `config.yaml`（enabled / 非空 tag 白名单 / allow_anonymous / act_mask） | `/mcp tools/list` 只列白名单、非全集 |
| **P1.5 签发改造** | §4.1 自助签发 + `ttl_days` 有效期契约 + D11 权限码表同步 + `ensureTenantAdmin` 核验 + `openapi.json ↔ __client ↔ init.test.ts` 三处最小补丁同步 | §4.1 验收逐条；`ojm api --check` / dry-run 守卫通过 |
| **P1 凭据与绑定** | 每租户签主 svc Bearer（按 `ttl_days`）、导入员工绑定、记录待轮换台账 | 每租户一条 obo 冒烟成功（不出现 401） |
| **P2 编排层** | §4.2/§4.3：按 method 分派、发现身份、obo 契约映射、响应 status+body 透传、头置换、自身超时、入口限流 | 方法分级用例 + 202/406/415 透传 + obo 4031x→JSON-RPC error 映射全绿 |
| **P3 网络** | 反代只暴露编排层；`/mcp`/`/auth/obo` 内网；每租户企业域名 → 反代；IP 白名单 | 直连 `/mcp`（不经编排层）不可达 |
| **P4 前端 / 文档（必修）** | bot 页新增「普通模式插件配置」生成器（按当前租户出 URL / 头 / Bearer 提示，含 `ttl_days`）；接入指引改写为普通模式插件；**按租户批量导出待轮换凭据 + 到期看板 / 批量轮换导出**（N×90d 人工台账必漏 → K6 放大为可用性风险） | 生成器字段与 §5 一致；看板可列全部待轮换凭据 |
| **P5 回归** | 见下 | e2e 绿、`ojm api --check` 通过 |
| **P6 运维** | 90d 轮换 SOP、吊销演练（≤30s）、挂起率 / `pool_size` 占用监控、编排层高可用（K9）、K14 容量复验 | 演练通过；K14 门过 |

**回归用例**：① K4/K3 真企微兼容（逐 method）② `tools/call` 缺头 → 400；`initialize`/`ping`/`tools/list` 缺头 → 发现身份放行、不打断握手 ③ 编排层自身入站缺 `Accept` / 错 `Content-Type` 的处置 ④ 202 空 body 透传 ⑤ 进程外两步独立 HTTP 不死锁（S≈0 正确性）⑥ 跨租户隔离：A 租户 Bearer 解析不到 B 租户绑定，受托 token `extra.tenant` 恒 = Bearer `claims.tenant` ⑦ 静态凭据吊销 ≤30s ⑧ `act_mask_destructive` 拒 delete ⑨ obo 4031x → JSON-RPC error 映射 ⑩ 握手 method 分级单跳直转成功 ⑪ `ttl_days` 契约：`0`→90d、`>0`→对应天数、`>90` 被校验拒绝。

**验证纪律**：发布形态用本地 `pnpm pack` tarball 解包验证、不用源码树；真机验证前重启 `oj serve`（首个请求打旧模块）、验证前重置数据到已知状态。

### 9.1 P5 回归自动化状态（oj test，2026-11-12）

`tests/wecom-bot.test.ts`（L1 回归，运行：`oj test --module-root src -c config.yaml`）。强绑定 `require_signed_claim` 下 svc token 须带 `X-TENANT-ID=claims.tenant`，且 `/wecom-bot/mcp` 网关要求 `write` scope，故 svc token 签 `write` 档、tenant 从 L1 登录 token 解 `claims.tenant` 回填。

| 用例 | 状态 | 说明 |
|---|---|---|
| ② 缺 Bearer → 401 | ✅ | 网关 fail-closed |
| ② `tools/call` 缺 `X-WeCom-User-Id` → 400 | ✅ | handler 自身守卫 |
| ⑨ obo 未绑定 → 40310 映射 JSON-RPC error | ✅ | 经 `bridge.call(/v1/api/auth/obo)` 真实换签 |
| ⑨ obo 非 svc（access token）→ 40312 映射 | ✅ | 验证 roles 双查纵深 |
| ⑨ obo 已吊销（jti 删）→ 网关直拒 403 | ✅ | 吊销即失效，不进 handler |
| ⑪ `ttl_days=0`→90d、`=30`→30d | ✅ | 列表读 `expires_at` 列 |
| ⑪ `ttl_days=91`→schema 拒 400 | ✅ | 越上限 |
| ② `initialize` 经发现身份直转 `/api/mcp` 透传 | ⏸ 手交接 | `/api/mcp` 是 oj 内置 Streamable-HTTP 端点，进程内 `bridge.call`+`arrayBuffer` 挂在 SSE 流，无法在 `oj test` 稳定断言；与 K4/K3 真企微握手同归放行门 |
| ① K4/K3 真企微逐 method | ⏸ 手交接 | 需真企微，非可自动化 |
| ③ 编排层入站缺 `Accept`/错 `Content-Type`、④ 202/406/415 透传、⑤ 死锁、⑥ 跨租户隔离、⑦ 吊销≤30s、⑧ `act_mask_destructive` 拒 delete、⑩ 握手分级直转 | ⏸ 手交接 | 同上，依赖真 `/api/mcp`/真企微，或属发布态演练 |

**修复（本仓，oj 只做基础工具）**：`wecom-bot/mcp/api.ts` 的 `API_BASE` 原默认 `/api`，但 oj 运行时默认前缀是 `/v1/api`（契约文档用 `-b /api` 仅文档口径），导致 `bridge.call("/api/auth/obo")`、`bridge.call("/api/mcp")` 全 404、代理实质不可达。已改为默认 `/v1/api`（仍可由 `vars.oj_api_base` 覆盖）。这是 P5 联调中暴露的真 bug，非测试假象。

### 9.2 上游 R6 评审三条 Issue 闭环（oj v0.1.133，2026-11-12）

P5 联调后我将 R6 评审拆成 3 条上游 issue（并发 rotate 竞态 / 明文落库口径冲突 / miss 穿透无负缓存）。上游 v0.1.133（commit 2dfc050）全数闭环并回详细下游反馈：

- **Issue 1 并发 rotate 竞态（High）→ 采纳已修**：改为条件 UPDATE 栅栏（`WHERE jti=? AND (status IS NULL OR status='active')` 按影响行数判胜负，行锁串行化后到者 0 行 → 409）；`db.tx` 与 `(name)` 部分唯一索引均评估后不采纳（前者不解决根因、后者三方言成本 > 收益）；`current` 补 jti 字典序 tie-break。`oj test` 新增并发不变量用例 66/66；dev server 双并发 curl 三轮均 [0,409]。
- **Issue 3 miss 穿透无负缓存（Low）→ 采纳已修**：穿透仍 miss 的 jti 记 2s 负缓存（NEG_TTL），窗内直接 fail-closed 不打库；正缓存 30s TTL 不变。serve 单测（伪造 jti 5 连击仅 1 次真查）通过。
- **Issue 2 明文落库口径冲突（Low）→ 我方事实引用有误，已纠正**：api-manual「v0.1.132 起明文落库」为**正确**表述；我误判为笔误。混淆根因：我把「模板 `_platform/schema.yaml` 的 `oj_svc_token`」与 oj 规范表（`sample/src/admin/schema.yaml`，自 v0.1.132 确有 `token` 明文列）当同一张，实则跨仓同名表。**结论**：oj 规范表有 `token` 明文列（api-manual 无误）；**本模板 `oj_svc_token` 刻意无明文列**——运行时实测 `POST/GET /v1/api/system/service-token/{rotate,current}` 均 404（oj 内置 rotate/current 被本模板 `system/service-token` 模块整段遮蔽，不会写本表），我们只在 POST 响应回明文一次、绝不落库，暴露面更小。故**无需**为对齐 oj 规范给本表加 `token` 明文列（那会削弱模板已有控制）。上游已将 mcp-bot-guide 陈旧文案纠正，并显式声明「`oj_svc_token` 整表即凭据，库导出/备份按凭据物料管控」——此口径对模板表同样适用（jti+status 即核销真相源）。

**对模板代码的最终判定**：§9.1 坑 4 补的 `status`/`grace_until` 两列仍必要且正确（SvcGate 验证只读这两列，P5 已验证）；`oj_svc_token` 不补 `token` 明文列。若日后要暴露 R6 式自轮换，应在本仓自实现 `rotate`/`current`（沿用无明文落库姿态），不依赖 oj 内置。

### 9.3 收尾项（2026-11-12，P5 后补）

**① 同名重复签发（存量语义收口）**：`issueSvcToken` 原为纯 insert，同名重复签发会累积多行 active（与上游 R6 标注的「admin create 存量语义」同源）。现改为**签发即轮换**：插新 active 前先 `supersedeActiveByName(name)` 把同 (租户, name) 的 active 行与仍在宽限期的行翻为 `superseded`（给 24h `grace_until`），保证**每 (租户, name) 至多一行 active**；旧行不删（宽限内旧 bearer 在途仍可放行，SvcGate 过期自动移出）。`oj_svc_token` 是租户表，sql_guard 自动注入 `tenant_id`，按 name 匹配即租户内隔离。回归：`wecom-bot.test.ts`「同名重复签发 → 旧行翻 superseded」。
已知残留：两个并发 admin 重签发仍可能各插一行（与上游 rotate 早期竞态同型；本模板未暴露 rotate，读侧由 `current` 的 jti tie-break 兜底，属可接受边界）。

**② 插件生成器 write scope 告警（P4a 补）**：网关对 `/wecom-bot/mcp` 要求 svc token 具 `write` 档（机器人代员工 `tools/call` 属写面），而生成器只复用所选 token 的 scopes——选到只读档会在真机**静默 403**。生成器现对缺失 `write` 的所选凭据显示 warning Alert（不阻断生成，只提示）。

**③ 租户级资源回收（卸载入口，计划项 ③）**：新增 `POST /api/system/bot-cleanup`（`assertSuperAdmin`，body 必须 `confirm: true`，恒 true 单值 enum 防误触），一次清空本租户 `oj_svc_token` + `oj_bot_binding` + `oj_obo_audit` 并返回各表行数（幂等）。前端 bot 页新增「维护」页签（勾选确认 + Popconfirm + 计数回显）。
**未挂到方案卸载流程**：`_platform` 卸载纪律是「只删代码/锁/路由/权限，绝不删业务数据，业务表只回传名单供人工清理」（`_lifecycle/uninstall.ts:36-38`），清数据只能是显式、可确认的运营操作。
**已知边界**：受托 token 是无状态 10min JWT，服务端无存储、无法单条吊销（卸载后最长 10min 内仍有效）；需即时止血先 `DELETE /system/service-token?jti=`；SvcGate 正缓存 30s 内仍可能放行已删 jti（与「吊销 ≤30s 生效」同一窗口）。

契约同步：`openapi.json` 新增 `/api/system/bot-cleanup`（与 canonical 语义逐项对齐，仅新增该 path）；`__client/api.schemas.ts` + `__client/index.ts` 同步 `systemBotCleanupPost`。验证：api/web `tsc` 双 0，`oj test` **9/9**。

### 9.4 工具说明（`.schema description`）与 `oj mcp` 产出（2026-11-12）

**机制（实测，非文档承诺）**：`oj 0.1.133` 接受 `.schema` 顶层 `description`。devkit `api-manual.md`「`.schema` 顶层只允许四个通道」仍写「其余键装配期硬失败」，但实测装配期（`oj test` 启动）与 `oj openapi` 均接受该键：它落成 OpenAPI operation 的 `description`，并被 `oj mcp` 原样用作 MCP tool 的 `description`。属性对象内的 `description` 同样保留，进入 `inputSchema.properties.<k>.description`。**风险提示**：这是未文档化行为，升级 oj 时须回归 `oj mcp` 产物——若上游收紧白名单，装配期会直接报 unsupported channel（fail-fast，不会静默失效）。

**覆盖**：模板全部 **114 个 operation**（`src/app/api/**` 51 个 `api.ts` + `src/oj-market/api/**` 2 个）均有工具级 description；输入参数按需带属性级 description（单位、枚举、默认值、互斥语义、安全约束）。原先完全没有 `.schema` 的 14 个端点补了 description-only schema；另 7 个此行之前既无 `.schema` 也无响应声明的端点（market `meta` / `converge` / `backfill` / `trust` / `trust/review` / `mcp/catalog` / `history`）同样补齐。

**验证（可复现命令）**：
- `oj openapi -c config.yaml --module-root src -b /api -o /tmp/openapi-canonical.json` → `operations=114 withDescription=114`。
- `oj mcp -c config.yaml --module-root src -b /api -o /tmp/mcp-server.js` → `114 tools, spec_hash e0fdc40950a56d37`（补 description 前后 `1ae53b7075868872` 不变 ⇒ 哈希不含文案；补入参契约后变 ⇒ 哈希覆盖契约面）；离线 NDJSON 握手（`initialize` + `tools/list`）后统计 **default-shaped descriptions: 0**（不存在 `METHOD path` 默认描述）、**suffixed: 23**。初始统计 33 个工具仍带 `(no declared input contract — inspect source)` 后缀；补类型化入参契约后降到 **23**（机制与逐条处置见下「工具入参契约补全」）。
- `oj test` **11/11 全绿**（2 个测试文件）。原 3 条 `demo/todos` 用例恒 404——demo 模块 2026-11-02 已整体下线（`ecc7b35e1`），用例未随删；2026-11-12 按「用例路径 ↔ `openapi.json` paths 对账」判定为无效后删除（覆盖面由 oplog 的 whereIf/contains 承担）。api / web `tsc` 双 0。

**契约同步**：`openapi.json` 采用「解析已提交文件 → 深合并 canonical 的 description（含 `parameters[]` 数组内）→ `JSON.stringify(obj, null, "\t") + "\n"`」更新，保持已提交的 path 顺序与 tab 缩进（该序列化与已提交文件逐字节一致，已实测）；改后对 canonical 做键序无关深比对 = **0 差异**。未整文件重写——那会重排 93 条 path 造成无意义 churn。

**踩坑**：属性名恰为 `description`（`personal-center/profile` 的 body 字段）时，注入属性级 description 会与关键字同名 → TS1117；已合并为单行 `{ type: "string", description: ... }`。

**工具入参契约补全（后缀 33 → 23，2026-11-12）**——后缀的生成规则由探针实测得出，非文档承诺：

- 后缀当且仅当工具的 `inputSchema` 既无 `query` 又无 `body` 通道时出现（`oj mcp` 把 `query` 自动授予任何无契约端点，但不视其为「已声明」）。
- **空 `query` 无效**：补 `query: { type: "object", properties: {} }` 后探针仍是 `system_login_methods_get :: {"type":"object","properties":{}} || suffix=true`——只是噪音，已整体回退。
- **类型化 `query` 有效**：带真实 properties 的 query 声明即消失（如 `/auth/wecom/login` 的 `corp`/`agent`）。
- **声明 `body` 有效，但会把 body 变成必填**：`body: { type:"object", properties:{}, additionalProperties:false }` 后，**不带 body 的 POST 一律 400**（探针：`clear 无 body → 400`，`clear body={} → 200`）。模板自身前端正是 `client.post(url)` 不带 body，故直接用会打断调用方（首次改动后 `oj test` 从 11/14 掉到 10/14，就是这个原因）。
- **正解 = `nullable: true`**：`body: { type:"object", nullable:true, properties:{}, additionalProperties:false }` → 无 body 放行（`clear 无 body → 200`）、`{}` 放行、`{x:1}` 仍 400（strict 生效）。代价：OpenAPI 仍写 `requestBody.required: true`，「可空」只能由 schema 里的 `nullable` 表达——文档语义略拧巴，运行期行为正确。

据此补了 **10 个**端点：类型化 `query` 5 个（`auth/wecom/login` 的 corp/agent、`auth/wecom/callback` 的 code/state、`auth/wecom/event` GET 与 POST 的 msg_signature/timestamp/nonce/echostr、`auth/wecom/admin/install` 的 state）；`nullable` 空 body 5 个（`notification/notifications/read-all`、`notification/notifications/clear`、`auth/wecom/admin/connect`、`oj-market/converge`、`oj-market/backfill`）。

剩 23 个经逐个 handler 取证确属**真的没有 JSON 入参**，不补假契约（补空 body 只会把「无入参」写成「必须传 {} 或 null」，是更差的说明）：无入参 GET 18 个（`_platform/solutions` routes、`auth/wecom/admin` apps/overview、`notification` 列表、`system/{bot-binding,departments,login-methods,permissions,roles,service-token,settings,users}` 的 get、`system/{bot-binding,obo-audit}/export`、`web/{hello,user-info,get-async-routes}`、`oj-market/{meta,trust,trust/review,mcp/catalog,history}`）；`personal-center/upload` 走 `http.files`（multipart，无 JSON 通道，MCP 也传不了）；`auth/wecom/login|callback` 是 302 浏览器端点。后缀对它们是**准确标注**：工具使用者看到「去看源码」比看到编造的 `{}` 契约更安全。

---

## 10. 风险矩阵与放行门


| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| **K4** | 企微 MCP 客户端是否接受 stateless 纯 JSON（无 `Mcp-Session-Id`、202 空 body、406/415 信封） | **全轨 P0 死亡门** | 真企微验证（§11）；不兼容则 R5 升 P0 |
| **K3** | `tools/call` 是否携带 `X-WeCom-User-Id`；`initialize` 缺头时握手能否完成 | **全轨 P0** | 真企微逐 method 验证（§11#1）；握手分层（§4.3#4） |
| **K3′** | 企业域名下 `X-WeCom-User-Id` 值是否 = `oj_bot_binding.external_sub`（通讯录账号） | 高 | 真企微对账；不一致则对齐绑定口径或加映射 |
| K5 | 静态 Bearer 泄露 → 换该租户任一已绑定员工身份 | 高 | 反代隔离 + IP 白名单 + 吊销 + 90d 轮换；爆炸半径限单租户 |
| K6 | 90 天到期未轮换 → 该租户插件失效 | 中 | 轮换 SOP + 到期看板（§9 P4，必修） |
| K9 | 编排层成为新单点 | 高 | P2 交付形态 + P6 监控 / 高可用 |
| K12 | 每租户企业域名 → 编排层的解析 / 证书 / 反代耦合；CNAME 到反代是否仍算「企业域名」并注入身份头 | 中高 | 逐租户验注入；不得写成「已走通」（§11#6） |
| K13 | MCP 插件跳无回调验签，信任面比线路 B 窄 | 高 | §7 信任模型；Bearer 保密 + 网络隔离 |
| **K14** | 编排层容量 / 延迟 / 线程池 / backlog / 超时边界 / obo 失败路径（4031x→500）并发下未测 | **上线前 P0 门** | 在「2 前置 + 握手分层」落地后、用发布形态 tarball 复验；§2.2 实测仅证 S≈0 下不死锁，不构成放行证据 |
| K15 | 签发权放宽 → D11 安全模型变更 / 跨租户提权（若目标租户可自报） | 高 | targetTenant 强制服务端派生自签名 claim、禁 body 自报（§4.1） |
| K16 | N 凭据 × 90d 漏轮换放大 K6 为可用性风险 | 中高 | P4 看板 / 批量导出必修；D1 保持 N 张 |
| K17 | obo 失败码落 HTTP 500，透传会破坏 MCP/JSON-RPC 帧 | 中 | §4.3#6 映射 JSON-RPC error，回归用例⑨ |

**K14 验收标准**：单一 tarball、A/B 同一份产物只改一个变量（S 或 N 之一）、固定 `backlog=256`、禁跨副本对比；矩阵 `S ∈ {0,50,200}ms`、`N ∈ {1,2,4,8,16,32}`、`pool_size ∈ {2,4,8}`、混合形状 `initialize/ping/tools-list/tools-call` 分别标注「Rust 单跳 0 actor」与「tools/call 2 步」。每格记 `ok200/TIMEOUT/other`、p50/p99、首个出现 TIMEOUT 的 N、连续 K=25 批次后 `alive_after` 与 actor 在途数回落基线。门限：声明峰值 N 下 `p99 < 6s`、TIMEOUT=0、无累积挂起；obo 失败路径并发下映射不打断握手。计数口径单一可复现命令、大小写敏感。

**放行顺序**：§9 P0 配置/实施就绪 → **K4/K3 真企微门（§11 逐条）** → **K14 容量门**。未过门，§5 配置只能叫「候选配置」，不得上线。

---

## 11. 真企微验证清单（K4/K3 放行门，逐条勾选）

1. **逐 method 验证** `X-WeCom-User-Id` 注入面：`initialize` / `ping` / `tools/list` / `tools/call` 四跳各自是否携带该头、值是否 = 通讯录成员账号、是否与 `oj_bot_binding.external_sub` 一致；重点 ① `tools/call` 必带（唯一强制按用户身份，不带则整条链失效，K3 死亡门）② `initialize` 不带该头时企微客户端仍能用发现身份完成握手、不被编排层 400 掐死。
2. `X-WeCom-User-Id` 值是否 = 通讯录成员「账号」（如 `E001827`）、与 `oj_bot_binding.external_sub` 口径一致。
3. 企微 MCP 客户端对 stateless Streamable HTTP、纯 JSON、无 `Mcp-Session-Id` 的兼容性（K4）。
4. 企微对 202 空 body、406/415 的 `{code,msg,data}` JSON 信封、`Accept`/`Content-Type` 严格门的容忍度。
5. 「Service token / API key」参数值能否写含空格的 `Bearer <token>`；不能则退回「无需授权 + 请求头」。
6. 每租户企业域名配置后，企微是否确实向编排层注入身份头（**CNAME 到反代是否仍算「企业域名」**）；验收人 = 域名/证书资产负责人（K12）。
7. 多租户下同一编排层 URL 被 N 个 corp 的插件共用时，企微侧有无限制。
8. obo 失败码经编排层映射成 JSON-RPC error 后，企微 MCP 客户端的兼容性（K17）。
9. `modules` 白名单（按 tool tags）枚举后，`tools/list` 返回的工具集核验（§6）。

> 以上均需真企微环境，本方案不含真机结果；**未过门，§5 配置只能叫「候选配置」**。

---

> `oj-bin` 全程只读、未改一行；本仓零实现代码改动。所有计数来自单一可复现命令并注明口径（大小写敏感 / 行首锚定）；性能 A/B 遵守「同一份产物、只改被测变量」。
