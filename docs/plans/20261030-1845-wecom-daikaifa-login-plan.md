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

> 本节 v2 原始待确认点，已被 §8 详细设计吸收并答复；保留供追溯。

1. **会话校验钩子** → §8.5 已定 Model B：oj 作为会话权威，connector 充 OIDC IdP，无需 oj 接受外部 cookie。
2. **X-TENANT-ID 写入权** → §8.5：tenant 由 oj 从已认证会话（`id_token.tenant`）服务端派生，前端不手带该头。
3. **corp→tenant 映射存储** ⇒ **本仓表 `wecom_app_profile`**（PK `corp_id`+`env`），oj 仅透传 `id_token.tenant`，不引入 oj 侧新状态。
4. **WECOM_TENANT 键** ⇒ 授权安装时后台写 `wecom_app_profile.tenant_key`，登录链接带 `tenant=wecom`（固定 RP 名），
   connector 按 corp+env 解出 tenant_key 写进 id_token。

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

### §8.1 租户键约定（先于所有阶段，定调）— 已确认
- **隔离列统一叫 `tenant_id`**（已确认）：因为 oj `sql_guard` 只认 `tenant_id` 这一列名
  （`guard.rs::check_tenant_raw` 的 `mentions = cleaned.contains("tenant_id")`）。用别的名字 = 零隔离。
- **同时保留 `corp_id` 作为企微业务键，并建立映射（已确认）**：
  - `tenant_id` 是隔离/判定列（sql_guard 用）；`corp_id` 是企微corp 的可读业务标识（如 `ww1234567890`）。
  - 权威映射 `corp_id ↔ tenant_id` 落在 `wecom_app_profile` 表（PK = (`corp_id`, `env`)，见 §8.2）；
    同 corp 可有多 env（测试/正式）各自 tenant。
  - 企微面相关表（如 `users`）**两列共存**：带 `tenant_id`（隔离）+ `corp_id`（可读/排查）；
    非企微表只需 `tenant_id`。
  - 对企微场景，`tenant_id` 的取值 = 该授权企业的 tenant 键（如 `wecom:<suite_id>:<corp_id>` 或短哈希），
    由 `wecom_app_profile` 生成与回查；`corp_id` 本身不参与 sql_guard 判定。
- 因此：`_platform` 所有租户绑定表都加 `tenant_id`；查询统一 `where tenant_id = ?` 且参数带当前租户
  （构造器 `db.table().where("tenant_id", tid)`，避免裸 SQL 触发 `sql_guard=Deny` 误拒）。

### §8.2 Phase 0 — 本仓多租户 schema 化（前置，不可跳过）
**DDL 增量**（`templates/src/_platform/api/schema.yaml`，按现有 migration 机制追加）：
- `users`：加 `tenant_id TEXT NOT NULL DEFAULT 'default'`；并加企微面列 `corp_id TEXT`（业务可读，可空，非企微用户为 NULL）、
  `wecom_userid TEXT`（可空）。唯一键改为 `(tenant_id, username)` 防跨租户重名撞库；
  企微登录建档唯一键为 `(tenant_id, wecom_userid)`（corp_id 仅冗余可读，不参与唯一性/隔离判定）。
- `sys_user_role`：加 `tenant_id TEXT NOT NULL DEFAULT 'default'`；唯一/外键约束补 tenant 维度。
- 新增 `wecom_app_profile`（**corp×env → 应用凭证 + 租户 映射权威**，解决「同企业配测试/正式两个应用」）：
  PK = (`corp_id`, `env`)，`env` ∈ {test, prod, ...}；列含 `suite_id`、`suite_secret_enc`(ENC)、
  `token`、`encoding_aes_key_enc`(ENC)、`tenant_key`(该 profile 用户落入的 oj 租户)、
  `permanent_code_enc`(ENC)、`auth_corp_id`、`status`(active/disabled)、`created_at`。
  → 同一 corp 可有 test/prod 两个 profile，各自独立套件凭证与各自 `tenant_key`（测试/正式数据隔离）；
  登录时按 (`corp_id`, `env`) 查 profile 取套件凭证与 `tenant_key`，JIT 建档落到对应 tenant。
  **全部为数据/配置，不含代码**：新增任意 corp 的测试或正式应用 = 写一行，无需改 oj 配置、无需重启。
- 新增 `wecom_suite_ticket`：`suite_id`(PK)、`suite_ticket`、`expires_at`。→ 企微定时推送的 ticket。
- （若首登资料补全需要）`users` 已含 `display_name/email/phone_number`，JIT 时留空，靠 Phase 3 补全页填。

**查询改造**（列出须加 `tenant_id` 过滤的 DAO，实施前 `grep` 定位确切文件）：
- 用户 CRUD / 登录校验 / 角色分配 / 设置读写，全部带 `tenant_id` 过滤。
- `templates/src/_platform/api/_shared/service/domain/*.ts` 与各 `auth/api/_shared/**` 下的查询。

**配置**：`config.yaml`（或模块 manifest）设 `sql_guard: Deny`（fail-closed）。
**回归用例**：故意写一条跨租户裸 SQL（无 `tenant_id`）→ 断言被 `sql_guard` 拒（参考 `guard.rs` 测试范式）。

### §8.3 Phase 1 — 本仓 `/wecom/*` connector（OIDC IdP，多租户动态）
**位置**：在 `_platform` 模块新增 `api/wecom/` 路由组（仅 API，不挂一级菜单）。
**依赖**：企微服务端 API（`gettoken`/`getuserinfo`/`get_permanent_code` 等）。部署方提供**服务商套件**
`suite_id`/`suite_secret`/`token`/`EncodingAESKey`——**一个服务商只配一次**（provider suite），不按 corp 写死。
各 corp 的测试/正式应用以**数据**形式落在 `wecom_app_profile` 表（§8.2）。

**多租户动态性（配置即可用，不写死 IdP）**：
- oj 侧**仅一次**静态配置 `oidc.rp.wecom` → 指向本 connector（单一 IdP）。**不按 corp / 不按 env 增配 oj**。
- connector 内部 multiplex 所有 corp 与 env：企微网页授权用**服务商套件 appid**，`corpid`/`auth_corpid`
  从企微回调取回；再按 (`corp_id`, `env`) 查/建 `wecom_app_profile` 得该应用的 `tenant_key` 与凭证，
  **JIT 建档**到对应 tenant（新 corp / 新 env 首次授权即自动开通）。
- 同企业配「测试 + 正式」两个应用 = `wecom_app_profile` 两行（env=test / env=prod，各自套件凭证 +
  各自 `tenant_key`）；测试/正式数据经不同 `tenant_id` 天然隔离。
- **全部为配置/数据，零代码、零 oj 重启**：新增任意 corp 的测试或正式应用 = 写一行 `wecom_app_profile`。

| 端点 | 行为 |
|---|---|
| `GET /wecom/oidc/authorize`(oj RP 调用) | OIDC IdP 的 authorize。UA 检测：企微内置 → 302 企微网页授权（appid=**服务商套件**、`redirect_uri=connector/wecom/oidc/wechat-cb`、`state=<oidc_state>`、`scope=snsapi_base`）；非企微 → 渲染授权/扫码页。 |
| `GET /wecom/oidc/wechat-cb?code&state` | 用服务商 `corp_token`（套件 permanent_code 换）调 `user/getuserinfo` → 得 `userid` + `corpid`/`auth_corpid`；按 (`corp_id`, `env`) 查/建 `wecom_app_profile` → `tenant_key`；签发 OIDC `code` → 302 oj `/v1/api/oidc/callback?code=...&state=<oidc_state>`。 |
| `POST /wecom/oidc/token`(oj RP 调用) | 兑换 `code` → 返回 `id_token`（RS256，claims：`iss=connector`、`sub=<wecom_userid>`、`tenant=<corp tenant_key>`、`aud=<oj client>`、`exp`、`nonce`）。 |
| `GET /wecom/oidc/jwks` | connector RS256 公钥 JWKS（供 oj `op_oidc_verify(token, jwks)` 验签）。 |
| `POST /wecom/suite/event` | 收企微 `push_suite_ticket`/`create_auth`：验签解密 → 存 `suite_ticket`；`create_auth` 换 `permanent_code`+`auth_corpid` → 写/更新 `wecom_app_profile`（JIT `tenant_key`）→ 通知后台。 |

**加密存储**：`suite_secret`/`encoding_aes_key`/`permanent_code` 落 `wecom_app_profile` 的 ENC 列
（复用 oj secret 体系或本仓 KV `ENC[...]`，不落明文）。

### §8.4 Phase 2 — 前端接线
- **联合类型放宽**（4 处，同 v1）：`runtime/src/api/user/types.ts:15`、`runtime/src/api/rbac/types.ts:87`、
  `login/web/pages/login.tsx:7` + `:39` 加 `"wecom"`，走重定向分支。
- **登录页新增「企业微信」tab**（`login/web/pages/login.tsx`）：点击 → UA 检测后
  `window.location.assign('/v1/api/oidc/login?tenant=wecom[&env=test]')`（走 oj OIDC RP → connector IdP，
  见 §8.5）；`tenant=wecom` 为固定 RP 名，`env` 选测试/正式。
- **环境选择（测试/正式）**：登录入口带 `env`（默认 `prod`；测试用 `test`），随登录 URL 传入；
  connector 据 (`corp_id`, `env`) 选 `wecom_app_profile`，落到对应 tenant（测试/正式数据隔离）。
  `env` 透传机制依赖 oj `/oidc/login` 是否转发自定义参数至 IdP authorize（见 §8.9 R5）。
- **新增 `wecom-callback.tsx`**：oj 完成 OIDC 回调后下发 **oj 会话 cookie**（Model B，会话由 oj 签发）；
  前端读 oj 会话进 SPA（`useAuthStore` 写 user/tenant），`navigate(getRedirectPath(search))`。
- **不再手动带 `X-TENANT-ID`**：Model B 下 tenant 由 oj 从已认证会话（`id_token.tenant`）服务端派生，
  oj 自行注入 `req.tenant_id` 供 `sql_guard` 使用（见 §8.5）；前端只持 oj 会话 cookie，不自行声明租户。
- **UA 检测工具**：`isWeChatBrowser()`（UA 含 `micromessenger`）。

### §8.5 会话归属（已确认：Model B，oj 为会话权威）
**安全前提（已核实 oj 源码）**：oj 的 `req.tenant_id` 来自客户端 `X-TENANT-ID` 头（`http.rs:40`），
与 `req.user`（已验签主体）**不绑定**；`sql_guard` 只校验查询含 `tenant_id` 且参数带该值，**不验证用户是否属于该租户**
（`guard.rs::check_tenant_raw` 比对的是 header 值，非认证主体）。⇒ **绝不能让客户端自选 tenant**；
正确模型：tenant 必须由 oj **已认证的会话**派生，oj 把 tenant 绑进 `req.user`（服务端派生，伪造无效）。

**选定 Model B：oj 作为会话权威**（非 `_platform` 自管会话）。落地形态——本仓 connector 充当 oj 既有 OIDC RP 的 **IdP**，
oj 配置 `oidc.rp.wecom` 即可，**零改 oj 代码**：

1. connector 实现 OIDC IdP 端点：`/.well-known/openid-configuration`、`/wecom/oidc/authorize`、
   `/wecom/oidc/token`、`/wecom/oidc/jwks`（RS256 密钥自管，JWKS 对外）。
2. 企微验证链：浏览器 → oj `/v1/api/oidc/login?tenant=wecom` → oj 重定向到 connector `authorize`
   → connector 走企微网页授权拿 `userid`（`code`→`corp_token`→`getuserinfo`）→ connector 签发 `id_token`
   （RS256，claims：`iss=connector`、`sub=<wecom_userid>`、`tenant=<corp tenant_key>`、`aud=<oj client>`、`exp`、`nonce`）
   → oj `/oidc/callback` 用 connector JWKS 验签（`op_oidc_verify(token, jwks)`，`oidc.rs:201` 已支持外部 JWKS）
   → JIT `oidc:<tenant>:<sub>` → oj 发会话 cookie + 把 `tenant` 绑进 `req.user`。
3. **证据支撑**：`oidc.rp.<tenant>` 配 `issuer/client_id/client_secret`（`oidc.rs:254`）；
   `op_oidc_verify(token, jwks?)` 支持外部 JWKS（`oidc.rs:201`）；id_token 可带 `tenant` 声明且 JIT 键为
   `oidc:<tenant>:<sub>`（`oidc.rs:365` 测试断言）。
4. **效果**：会话由 oj 签发与校验，tenant 来自 oj 验签后的 `id_token.tenant`（服务端派生，客户端不可伪造），
   跨租户伪造在 oj 层根绝；本仓只实现 connector IdP + 前端接线 + §8.2 schema。

> 注：本仓仅实现「connector 作为 IdP + 前端 + schema」；oj 侧仅做**配置**（`oidc.rp.wecom`）。若 oj 既有 RP
> 对自定义 IdP / id_token.tenant 取租户的支持存在缺口，按 §8.9 提出的**上游需求**推进（只读评估不在此实现 oj）。

- **原待确认点 3（corp→tenant 映射存储）**：落本仓 `wecom_app_profile` 表（§8.2）；oj 侧由 `id_token.tenant` 透传，
  不在 oj 落新状态。
- **原待确认点 4（WECOM_TENANT 键）**：授权安装时后台写 `wecom_app_profile.tenant_key`，登录链接带 `tenant=wecom`
  （固定 RP 名），connector 内部按 corp+env 解出 `tenant_key` 写进 id_token。

### §8.6 Phase 3 — 代开发后台 MVP（服务商侧）
- **开通入口**（PM 指出的上线阻塞点）：后台生成「授权安装链接 / 二维码」
  （第三方授权安装：`https://work.weixin.qq.com/wework_admin/frame_for_third?...` 或套件授权页），
  并配置回调 URL（`/wecom/suite/event`）。
- 已授权企业（corp）列表、套件 ticket 状态、permanent_code 是否已落。
- **绑定 / 解绑 / 停用同步**：改 `wecom_app_profile.status`；停用后该 corp+env 登录拒。
- **首次登录资料补全页**：JIT 建档 `display_name/email` 为空时，登录后跳补全页。
- 复用需求一多根路由，与「系统管理」并列成一级菜单。

### §8.7 Phase 4 — 端到端联调 + 回归
- 真实套件凭证跑通：企微扫码 → connector 验 userid → oj 发会话（含 `id_token.tenant`）→ 业务请求由 oj 会话派生 `tenant_id` 隔离（无需前端手带 `X-TENANT-ID`）。
- **跨租户泄漏回归**（关键）：验证 `sql_guard=Deny` 下缺 `tenant_id` 过滤的查询被拒；同 `userid` 跨 corp 不串号
  （两个 corp 各有独立 `tenant_id`，建档互不可见）。
- `pnpm test:cli` + `pnpm --filter @oj-module/core test` 全绿；`LoginInfo.method` 联合类型收窄处单测。

### §8.8 实施顺序建议（最小可验）
Phase 0（schema+sql_guard+回归）→ Phase 1（connector 骨架 + wecom_app_profile）→ Phase 2（前端 tab+callback）→
Phase 1 补全 suite 事件 → Phase 3（后台）→ Phase 4（e2e）。每阶段独立可验、可回退。

### §8.9 上游 oj 需求（以合理性提出，只读不实现）
以下为 Model B 成立所需、且当前只读评估**未完全确认**的 oj 行为。若 oj 已支持则为零改动；
若不支持，按「只读评估不实现 oj」的原则，以**上游需求 / PR** 形式提出（理由已附），由 oj 仓库落地。

- **R1 — OIDC RP 须支持自定义 / 静态 IdP（经 discovery 或静态 JWKS）**。
  理由：connector 作为 IdP 需 oj 经 `<issuer>/.well-known/openid-configuration` 取 JWKS 并交换 code。
  证据：`oidc.rp.<tenant>` 已带 `issuer`（`oidc.rs:254`），`oidc.verify` 已支持外部 JWKS（`oidc.rs:201`）
  → 大概率已支持；需确认 discovery 拉取路径与缓存策略（连接器 RS256 公钥轮换时能否热更）。
- **R2 — `/oidc/callback` 须从 `id_token.tenant` 取租户绑定 JIT 键**，而非仅用 `clients.<id>.tenant`。
  理由：企微按 corp×env 分租户，tenant 必须来自每次登录的 id_token 声明；若只认 client 固定 tenant，多 corp / 多 env 无法隔离。
  证据：测试 id_token 含 `tenant` 声明（`oidc.rs:365`）→ 需确认 callback 实际读取该声明作 JIT 键。
- **R3 — JIT 账号 `oidc:<tenant>:<sub>` 的 sub 唯一性**：企微 `userid` 在单 corp 内唯一，跨 corp / 跨 env 因 `tenant` 不同天然隔离；确认无全局 sub 冲突即可。
- **R4（兜底）— 若 R1 / R2 不支持**：提 oj 扩展 `POST /v1/api/oidc/external`（或等价），接受**服务端验签的断言**
  （由配置的受信密钥签名，claims 含 `sub`+`tenant`），直接为已验证外部身份发 oj 会话。
  理由：这是「外部身份 → oj 会话」的最小受信口子，比把 connector 伪装成 OIDC IdP 更直白；但优先 R1 / R2（复用既有 RP）。
- **R5 — `/oidc/login` 须支持转发自定义参数至 IdP authorize**（如 `env=test`）。
  理由：同企业测试 / 正式两个应用需经登录入口把 `env` 透传到 connector，以选 `wecom_app_profile`。
  证据：未见于只读评估（oj 的 `/oidc/login` 参数透传行为待确认）；若不支持，可改以「登录前先写 `env` 到 cookie / 会话、
  connector 回调时读取」规避，或在 R4 扩展中一并纳入。
