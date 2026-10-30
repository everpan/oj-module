# 需求二：登录/账号体系支持企业微信「代开发自建应用」（多租户）— 修订 v2

> 本文档为 v2 修订版。v1 基线（`docs/plans/...` 本文件初版）经三位专家（架构师 / 高级企微开发者 /
> 微信应用产品经理）评审，并对照**上游 `oj` 源码只读评估**（`/Users/ever/git/only-js/oj-bin`）后修订。
> 关联需求一（模块多根树路由）已先行完成并合并。

## 0. 上游 `oj` 只读评估结论（证据，决定架构可行性）

评估对象：`/Users/ever/git/only-js/oj-bin`（Rust 服务，`src/bridge/`）。评估约束：本仓只调整自身，
oj 仅只读评估、不修改（见全局规则「只调整本项目，其余项目只读」）。

- **结论 A — 租户隔离不是 oj「自动」做的**（关键，推翻 v1 假设）：
  `src/bridge/guard.rs::check_tenant_raw` 的 `sql_guard` 只做**校验**——
  裸 SQL 必须显式出现 `tenant_id` 且参数数组含当前租户值才放行；
  若某表在 schema 注册里**没有 `tenant_id` 列**（`registry.get(t).is_tenant_scoped()==false`），
  则 `scoped.is_empty()` → **完全不检查 → 零隔离**。
  `X-TENANT-ID` 头只是「本请求属于哪个租户」的上下文标记，**不是**行级隔离机制。
  ⇒ **v1「复用 oj 多租户隔离」是空话**：本仓 `_platform` 表（users / sys_user_role 等）当前无
  `tenant_id` 列，必须自己加列 + 查询过滤 + 把 `sql_guard` 设为 `Deny` 才能隔离。

- **结论 B — oj 没有企微 / 代开发 connector**（关键，推翻 v1「向 oj 提上游需求」）：
  `src/bridge/` 只有 `oidc.rs`（通用 OIDC RP，RS256 sign/verify，redirect_uri 绑定租户）与
  `sso.rs`（CAS2）。**无 `wecom`/`wechat`/`daikaifa` 任何代码**。
  通用 OIDC 无法桥接代开发：企微没有 discovery / JWKS / id_token / PKCE，而是
  `suite_ticket` / `permanent_code` / `auth_corpid` / 网页授权 `code→userid` 自有协议。
  ⇒ connector 必须由**本仓**实现（不依赖、不修改 oj）。

- **结论 C — 会话下发走 302 跳转，无显式 Set-Cookie**（`src/bridge/json.rs:274` `json.redirect`
  返回 3xx + `Location`；`bootstrap.js` `op_json_redirect`）。oj 的 OIDC/SSO 回调用 302 收口。
  ⇒ 本仓 connector 自行下发 **HttpOnly session cookie** + 302 到 SPA，不用「?code 落地页读 JSON」。

- **结论 D — JIT 账号形态**（`oidc:<tenant>:<sub>`）属 oj auth 插件。**本仓复用 oj 的账号/租户
  原语**（X-TENANT-ID 上下文、账号建档钩子），但**代开发 connector 逻辑在本仓**实现并写入 X-TENANT-ID。

## 1. 架构结论（v2 修订）

| 层 | 责任 | 实现位置 |
|---|---|---|
| 上游 oj | 多租户上下文（`X-TENANT-ID` 头透传）、`sql_guard` 校验、账号/会话原语、AuthProvider 接管钩子 | oj-bin（只读，不改） |
| 本仓 connector | `/wecom/*` 专用端点（suite 事件接收 + 登录/回调 + `permanent_code` 落库 + corp→tenant 映射 + JIT 建档 + HttpOnly cookie 下发） | `packages/cli/templates/src/_platform/api/wecom/*` |
| 本仓前端 | 登录页「企业微信」入口（UA 检测）、回调落地读 cookie、代开发后台 UI | `login/web/pages/*` + 新 `_platform` 模块 |
| 本仓 schema | `_platform` 表加 `tenant_id`/`corp_id` 列 + 全量查询加 tenant 过滤 | `templates/src/_platform/api/schema.yaml` |

**隔离靠「schema 加列 + 查询过滤 + sql_guard=Deny」，不是靠 oj 自动隔离。**

## 2. 相对 v1 的关键修订点

1. **数据隔离前置**：Phase 0 必须先把 `_platform` 的 `users` / `sys_user_role` / 其他租户绑定表加
   `tenant_id`（建议与 `corp_id` 同源），并让所有查询带 tenant 过滤；`sql_guard` 开 `Deny`。
   否则后续任何"多租户"都是假的。
2. **不做 `/oidc/*` 桥接**：改做本仓 `/wecom/*` 专用 connector（oj 通用 OIDC 桥不了代开发）。
3. **corp→tenant 时机**：授权安装时 JIT 建 `tenant` + `corp→tenant` 映射（`auth_corpid` → tenant_key）；
   终端登录时从企微回调推导 `auth_corpid` → 映射回 tenant，**早于**「取会话」。
4. **回调收口**：302 + HttpOnly session cookie（仿 oj redirect 原语），不是 `?code` 落地页读 JSON。
5. **补全 PM 指出的上线缺口**：开通入口、首次登录资料补全、绑定/解绑/停用同步、纯浏览器降级（UA 检测）。

## 3. 分阶段（重排，Phase 0 前置不可省）

### Phase 0（前置·必须，否则隔离是空话）：`_platform` 多租户 schema 化
- `schema.yaml`：`users`/`sys_user_role`/ 租户绑定表加 `tenant_id`（与 `corp_id` 同源双列或单列+映射表）。
- 全量查询加 `tenant_id` 过滤（`db.table().where("tenant_id", ...)` 走构造器，避免裸 SQL 被 `sql_guard` 拒）。
- 配置 `sql_guard: Deny`（fail-closed：漏写 tenant 的查询直接拒，不靠人工自觉）。
- 验证：故意写一条跨租户裸 SQL → 被拒（回归用例）。

### Phase 1（本仓 connector）：`/wecom/*` 端点
- `GET /wecom/login?tenant=<key>`：企微内→网页授权 `code` 跳转；外→返回授权安装/扫码链接。
- `GET /wecom/callback`：收企微 `code`/`state` → 用 `permanent_code` 换 `corp_token` → `code→userid` →
  本仓建档（`corp_id`+`userid` 作唯一键，天然按 corp 隔离；首次 JIT 建 `tenant`+映射）；
  下发 **HttpOnly cookie**（会话） + 302 `/?tenant=<key>`。
- `POST /wecom/suite/event`：接收企微定时推送的 `suite_ticket`（EncodingAESKey+token 验签）、
  `create_auth` 授权事件 → 落 `permanent_code` + 建 `corp→tenant` 映射。
- `permanent_code` / `suite_ticket` 落 `_platform` 加密存储表（复用 oj secret 体系或本仓 KV）。

### Phase 2（前端）：登录页「企业微信」入口 + 回调落地
- `login.tsx` 加「企业微信」tab（联合类型加 `"wecom"`，同 v1 4 处放宽）。
- **UA 检测**：企微内置浏览器 → 直接 `window.location.assign('/wecom/login?tenant=...')` 走网页授权；
  普通浏览器 → 展示授权安装二维码 / 扫码登录。
- 新增 `wecom-callback.tsx`：读 cookie 进 SPA（不再 `?code` 换 JSON）。
- `X-TENANT-ID` 透传（若 `runtime/src/utils/request/*` 未消费，则补拦截器）。

### Phase 3（代开发后台 MVP，服务商侧）：开通 + 管理
- **开通入口**（PM 指出的上线阻塞点）：后台生成「授权安装链接 / 二维码」+ 配置回调 URL。
- 已授权企业（corp）列表、套件 ticket 状态、permanent_code 是否已落。
- **绑定 / 解绑 / 停用同步**；首次登录**资料补全页**（企微 userid 无 display_name/email，需补）。
- 复用需求一的多根路由把它与「系统管理」并列成一级菜单。

### Phase 4：端到端联调 + 回归
- 真实套件凭证跑通：企微扫码 → 建 `corp+userid` 账号 → cookie → 业务 API 带 `X-TENANT-ID` 隔离。
- **跨租户泄漏回归用例**（关键）：验证 `sql_guard=Deny` 下缺 tenant 过滤的查询被拒；同 userid 跨 corp 不串号。

## 4. 待与 oj 确认的关键集成点（v2 修订）

1. **会话校验钩子**：本仓 connector 自签 HttpOnly cookie，oj 的 AuthProvider 接管是否接受外部签发
   的 cookie / 是否暴露 session 校验入口？（决定 Phase 1 收口可行性）
2. **X-TENANT-ID 写入权**：本仓 connector 确定当前 tenant 后写 `X-TENANT-ID` 头，oj 是否放行本仓写该头？
3. **corp→tenant 映射存储**：用 oj KV（oj-kv-redis）还是本仓 `_platform` 表？
   ⇒ 建议**本仓表**（corp_tenant_map），oj 只透传 `X-TENANT-ID`，不引入 oj 侧新状态。
4. **WECOM_TENANT 键**：授权安装时由后台写入 `corp_tenant_map`，登录链接带 tenant key。

## 5. 关键文件

- 前置：`packages/cli/templates/src/_platform/api/schema.yaml`（加列）、
  `auth/api/_shared/session.ts`（tenant 过滤）、`sql_guard` 配置。
- connector：`packages/cli/templates/src/_platform/api/wecom/*.ts`（新）。
- 前端：`login/web/pages/login.tsx`（加 tab）、`wecom-callback.tsx`（新）、
  `runtime/src/api/user/types.ts:15` + `runtime/src/api/rbac/types.ts:87`（加 `"wecom"`）。
- 后端：`auth` provider 接管、`issueExternal(uid)` 钩子（`auth/api/_shared/session.ts:169`）。

## 6. 范围外 / 风险

- **代开发 connector 在本仓实现**（结论 B），不修改 oj；oj 仅提供租户上下文 + sql_guard + 账号原语。
- **多租户隔离是本仓 schema 责任**（结论 A），不是 oj 自动给的；`sql_guard=Deny` 是兜底不是主力。
- 代开发「服务商」资质前提（`suite_id`/`suite_secret`/`token`/`EncodingAESKey`）由部署方提供，
  本仓只做代码骨架 + 配置位，不内置任何真实凭证。
- 跨租户回归必须进 Phase 0/4，否则隔离形同虚设。

## 7. 专家评审要点回溯（v1 → v2 已吸收）

- 架构师：隔离"靠 oj"是假象（结论 A 证实）；corp→tenant 在登录前选定；回调用 cookie 非 JSON 落地页。
- 高级企微开发者：通用 OIDC 桥不了代开发（结论 B 证实）；需专用 `/wecom/*`；userid 跨 corp 不同 → 两账号即正确隔离。
- 产品经理：缺开通入口阻塞上线；首登资料补全缺口；缺绑定/解绑/停用；缺纯浏览器降级；Phase 重排为
  connector → 代开发后台 MVP → 终端登录 → 补缺口。

---

## 8. 详细设计（待确认后实施）

### §8.1 租户键约定（先于所有阶段，定调）
- **隔离列统一叫 `tenant_id`**（而非 `corp_id`）：因为 oj `sql_guard` 只认 `tenant_id` 这一列名
  （`guard.rs::check_tenant_raw` 的 `mentions = cleaned.contains("tenant_id")`）。用别的名字 = 零隔离。
- 对企微场景，`tenant_id` 的**取值 = 该授权企业的 tenant 键**（如 `wecom:<suite_id>:<corp_id>` 或短哈希）。
  `corp_id` 仅作为业务可读字段冗余存储，不参与 sql_guard 判定。
- 因此：`_platform` 所有租户绑定表都加 `tenant_id`；查询统一 `where tenant_id = ?` 且参数带当前租户
  （构造器 `db.table().where("tenant_id", tid)`，避免裸 SQL 触发 `sql_guard=Deny` 误拒）。

### §8.2 Phase 0 — 本仓多租户 schema 化（前置，不可跳过）
**DDL 增量**（`templates/src/_platform/api/schema.yaml`，按现有 migration 机制追加）：
- `users`：加 `tenant_id TEXT NOT NULL DEFAULT 'default'`；唯一键改为 `(tenant_id, username)` 防跨租户重名撞库。
- `sys_user_role`：加 `tenant_id TEXT NOT NULL DEFAULT 'default'`；唯一/外键约束补 tenant 维度。
- 新增 `corp_tenant_map`：`corp_id`(PK)、`tenant_key`(UNIQUE)、`suite_id`、`permanent_code_enc`(ENC)、
  `auth_corp_id`、`status`(active/disabled)、`created_at`。→ corp→tenant 映射 + permanent_code 落库。
- 新增 `wecom_suite_ticket`：`suite_id`(PK)、`suite_ticket`、`expires_at`。→ 企微定时推送的 ticket。
- （若首登资料补全需要）`users` 已含 `display_name/email/phone_number`，JIT 时留空，靠 Phase 3 补全页填。

**查询改造**（列出须加 `tenant_id` 过滤的 DAO，实施前 `grep` 定位确切文件）：
- 用户 CRUD / 登录校验 / 角色分配 / 设置读写，全部带 `tenant_id` 过滤。
- `templates/src/_platform/api/_shared/service/domain/*.ts` 与各 `auth/api/_shared/**` 下的查询。

**配置**：`config.yaml`（或模块 manifest）设 `sql_guard: Deny`（fail-closed）。
**回归用例**：故意写一条跨租户裸 SQL（无 `tenant_id`）→ 断言被 `sql_guard` 拒（参考 `guard.rs` 测试范式）。

### §8.3 Phase 1 — 本仓 `/wecom/*` connector
**位置**：在 `_platform` 模块新增 `api/wecom/` 路由组（沿用模块路由机制，一级菜单不挂此组，仅 API）。
**依赖**：企微服务端 API（`gettoken`/`getuserinfo`/`get_permanent_code` 等），部署方提供
`suite_id`/`suite_secret`/`token`/`EncodingAESKey`（配置位，不内置真实凭证）。

| 端点 | 行为 |
|---|---|
| `GET /wecom/login?tenant=<key>` | UA 检测：企微内置浏览器 → 302 到企微网页授权 `https://open.weixin.qq.com/connect/oauth2/authorize?appid=<corp_id>&redirect_uri=<enc(callback)>&response_type=code&scope=snsapi_base&state=<tenant_key>#wechat_redirect`；普通浏览器 → 302 到授权安装页 / 返回扫码数据。 |
| `GET /wecom/callback?code&state` | 用 corp 的 `corp_token`（由 `suite permanent_code` 换）调 `user/getuserinfo` 拿 `userid` → 以 `(tenant_id=state, wecom_userid=userid)` 唯一键 JIT 建档（复用 `issueExternal(uid)` 钩子）→ 下发 **HttpOnly session cookie**（沿用 `_platform` 现有会话形态，非 oj 会话）→ 302 `/?tenant=<key>`。 |
| `POST /wecom/suite/event` | 收企微 `push_suite_ticket` / `create_auth`：先用 `token`+`EncodingAESKey` AES-256-CBC 验签解密 → 存 `suite_ticket`；`create_auth` 拿 `auth_code` → 换 `permanent_code`+`auth_corpid` → 写 `corp_tenant_map`（JIT `tenant_key`）→ 通知后台。 |

**加密存储**：`permanent_code` / `suite_ticket` 落 `corp_tenant_map` / `wecom_suite_ticket` 的 ENC 列
（复用 oj secret 体系或本仓 KV `ENC[...]`，密钥走 `config` ENC 机制，不落明文）。

### §8.4 Phase 2 — 前端接线
- **联合类型放宽**（4 处，同 v1）：`runtime/src/api/user/types.ts:15`、`runtime/src/api/rbac/types.ts:87`、
  `login/web/pages/login.tsx:7` + `:39` 加 `"wecom"`，走重定向分支。
- **登录页新增「企业微信」tab**（`login/web/pages/login.tsx`）：点击 → UA 检测后
  `window.location.assign('/wecom/login?tenant=<key>')`；`tenant` 取自 `fetchLoginMethods` 发现或 `web.config.ts`。
- **新增 `wecom-callback.tsx`**：不再 `?code` 换 JSON，改为读 HttpOnly cookie 进 SPA（`useAuthStore` 写 token/tenant），
  `navigate(getRedirectPath(search))`。
- **`X-TENANT-ID` 透传**：`runtime/src/utils/request/*` 若未消费则补拦截器，从会话 `tenant` 取并随每个 oj API 请求带出
  （这是 oj `sql_guard` 拿租户的来源，见 §8.5）。
- **UA 检测工具**：`isWeChatBrowser()`（UA 含 `micromessenger`）。

### §8.5 已澄清的"待确认点"（无需改 oj）
- **原待确认点 1/2（oj 是否接受外部 cookie / 是否暴露 session 校验）**：**无需改 oj**。
  本仓 connector 下发的是 `_platform` 自己的 session cookie（沿用现有 JWT sub + refresh 形态）；
  oj 只需要在 **`_platform`→oj 的 API 请求上收到 `X-TENANT-ID` 头**即可（`guard.rs` 从 `rs.req.tenant_id` 读取，
  该值由 oj 从入站 HTTP 请求的 `X-TENANT-ID` 头填入）。前端在每个 oj API 调用带 `X-TENANT-ID` = 会话里的 `tenant` 即可。
  ⇒ 整条链路**零 oj 改动**，与全局规则「只调整本项目，其余项目只读」一致。
- **原待确认点 3（corp→tenant 映射存储）**：落本仓 `corp_tenant_map` 表（§8.2），oj 仅透传 `X-TENANT-ID`。
- **原待确认点 4（WECOM_TENANT 键）**：授权安装时后台写 `corp_tenant_map.tenant_key`，登录链接带该 key。

### §8.6 Phase 3 — 代开发后台 MVP（服务商侧）
- **开通入口**（PM 指出的上线阻塞点）：后台生成「授权安装链接 / 二维码」
  （第三方授权安装：`https://work.weixin.qq.com/wework_admin/frame_for_third?...` 或套件授权页），
  并配置回调 URL（`/wecom/suite/event`）。
- 已授权企业（corp）列表、套件 ticket 状态、permanent_code 是否已落。
- **绑定 / 解绑 / 停用同步**：改 `corp_tenant_map.status`；停用后该 corp 登录拒。
- **首次登录资料补全页**：JIT 建档 `display_name/email` 为空时，登录后跳补全页。
- 复用需求一多根路由，与「系统管理」并列成一级菜单。

### §8.7 Phase 4 — 端到端联调 + 回归
- 真实套件凭证跑通：企微扫码 → 建 `(tenant_id, wecom_userid)` 账号 → cookie → 业务 API 带 `X-TENANT-ID` 隔离。
- **跨租户泄漏回归**（关键）：验证 `sql_guard=Deny` 下缺 `tenant_id` 过滤的查询被拒；同 `userid` 跨 corp 不串号
  （两个 corp 各有独立 `tenant_id`，建档互不可见）。
- `pnpm test:cli` + `pnpm --filter @oj-module/core test` 全绿；`LoginInfo.method` 联合类型收窄处单测。

### §8.8 实施顺序建议（最小可验）
Phase 0（schema+sql_guard+回归）→ Phase 1（connector 骨架 + corp_tenant_map）→ Phase 2（前端 tab+callback）→
Phase 1 补全 suite 事件 → Phase 3（后台）→ Phase 4（e2e）。每阶段独立可验、可回退。
