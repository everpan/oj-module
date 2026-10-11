# OIDC 实现文档（OP + RP 双角色）

> 给谁读：要读懂或改动 sample 内置 OIDC 实现的维护者。这是实现走读，讲架构、时序与
> 数据流。想在自己的项目里**接入** OIDC，请先看
> [oidc-integration.md](oidc-integration.md)；设计裁决见
> `docs/superpowers/specs/2026-09-05-sample-oidc-design.md`。
>
> 术语：**OP**（OIDC Provider）= 签发身份的一方；**RP**（Relying Party）= 消费身份、
> 把登录委托给 OP 的一方。本项目同进程同时扮演两个角色。

## 1. 总体架构

同进程双角色：`src/idp/` 是 OP（OIDC Provider，签发身份），`src/oidc/` 是 RP
（Relying Party，消费身份）。两者共享 core 注入的 `oidc` 全局（RS256 原语 + 配置态）
与 KV；会话桥接复用既有 `auth` 模块的 `issueTokens`。业务请求鉴权不变：oj-auth 插件
Bearer 守卫 + 租户头照旧，OIDC 只负责「换 token」那一跳。

```mermaid
flowchart TD
    subgraph Client["浏览器 / 调用方"]
        UA["浏览器 / curl"]
    end

    subgraph Server["oj serve（同进程）"]
        subgraph RP["RP 模块 sample/src/oidc/"]
            LOGIN["oidc/login<br/>state+nonce+PKCE"]
            CB["oidc/callback<br/>交换+验签+JIT"]
            LO["oidc/logout"]
        end
        subgraph OP["OP 模块 sample/src/idp/"]
            DISC[".well-known/openid-configuration"]
            JWKS["jwks.json"]
            AUTHZ["authorize<br/>白名单+PKCE+code"]
            ILOGIN["login<br/>bcrypt+cookie 会话"]
            TOK["token<br/>RS256 签发"]
            UI["userinfo"]
        end
        subgraph Core["core（Rust 注入）"]
            OIDCG["oidc 全局<br/>sign / verify / jwks / issuer / rp / clients"]
            RAW["json.raw<br/>裸 JSON（OP 对外端点）"]
            EXEMPT["tenant.anonymous_paths<br/>跳转腿豁免"]
        end
        KV["KV<br/>OJ-OIDC:STATE:* / OJ-OIDC:CODE:* / OJ-IDP:SESS:*"]
        USERS["users 表（_platform）"]
        SESSION["auth/_shared session.ts<br/>issueTokens + Bearer 会话"]
    end

    UA -->|"GET ?tenant=X（豁免租户头）"| LOGIN
    UA -->|"GET ?code&state（豁免）"| CB
    UA -->|"POST username/password（豁免）"| ILOGIN
    UA -->|"GET authorize（豁免）"| AUTHZ
    LOGIN -->|"fetch discovery"| DISC
    LOGIN -->|"快照"| KV
    AUTHZ -->|"code（60s 一次一用）"| KV
    ILOGIN -->|"bcrypt.verify"| USERS
    ILOGIN -->|"IDP_SESSION"| KV
    CB -->|"code+verifier 换 token"| TOK
    CB -->|"fetch jwks_uri"| JWKS
    CB -->|"verify(id_token, jwks)"| OIDCG
    CB -->|"JIT：oidc:<tenant>:<sub>"| USERS
    CB -->|"issueTokens 桥接"| SESSION
    TOK -->|"claims 签名"| OIDCG
    DISC --> RAW
    JWKS --> RAW
    TOK --> RAW
    UI --> RAW
    LOGIN -.->|"302 跳转腿免租户头"| EXEMPT
```

要点：

- **密钥不出 Rust**：私钥装配期经 `OidcState::from_section` 装入 `StableState`（构造期、
  不可变），JS 只见 sign/verify/jwks 接口面；手写脱敏 `Debug`，PEM/secret 不进日志。
- **OP 对外端点说标准协议**：discovery/jwks/token/userinfo 成功用 `json.raw` 回裸 JSON
  （RFC 6749 要求 `access_token` 是顶层字段），错误仍走 `{code,msg,data}` 信封。
- **豁免面最小**：`tenant.anonymous_paths` 只豁免「缺失租户头的 400」，且只列跳转腿路径
  （`/oidc/*`、`/idp/**`。discovery 挂在 `/idp/.well-known/openid-configuration`，比 `/idp/*`
  深一层，故 OP 面用 `**`）；带有效租户头的请求照常注入 `http.tenantId`。
  匹配为通配四形态（字面 / 尾 `/*` 一层 / `*` 单段 / `**` 跨段）。**语义收紧只发生在 auth 侧**
  （v0.1.20 把 oj-auth 的尾 `/*` 从任意深度改为严格一层）；租户侧自引入起即为严格一层，
  故启动期迁移 WARN 只针对 `auth.anonymous_paths`（见 `docs/devkit/scenarios.md` 场景 5）。

## 2. 全链时序图

```mermaid
sequenceDiagram
    autonumber
    actor UA as 浏览器/调用方
    participant RP as RP oidc/*
    participant KV as KV
    participant OP as OP idp/*
    participant DB as users 表
    participant Core as oidc 全局(Rust)

    UA->>RP: GET /oidc/login?tenant=default
    RP->>KV: state -> {tenant,nonce,verifier,IdP 快照} (TTL 600s)
    RP->>OP: fetch /.well-known/openid-configuration
    OP-->>RP: discovery（裸 JSON）
    RP-->>UA: 302 authorize_url?...code_challenge=S256(nonce,state)

    UA->>OP: GET /idp/authorize?...
    OP-->>UA: 401 login required（无 cookie 会话）
    UA->>OP: POST /idp/login {username,password}
    OP->>DB: select + bcrypt.verify
    OP-->>UA: Set-Cookie IDP_SESSION（KV TTL=refresh 时长）
    UA->>OP: GET /idp/authorize（带 cookie）
    OP->>KV: code -> {client_id,redirect_uri,state,nonce,challenge,uid,tenant} (TTL 60s)
    OP-->>UA: 302 redirect_uri?code&state

    UA->>RP: GET /oidc/callback?code&state
    RP->>KV: 取 state 并立即删除（一次一用）
    RP->>OP: POST /idp/token（code+verifier+凭证，form）
    OP->>KV: 取 code 并立即删除（一次一用）
    OP->>Core: 校验 PKCE/redirect_uri/client 绑定
    OP->>Core: oidc.sign({iss,sub,aud,iat,exp,nonce,tenant}) ×2
    OP-->>RP: access_token + id_token（裸 JSON）
    RP->>OP: fetch jwks_uri
    OP-->>RP: JWKS
    RP->>Core: oidc.verify(id_token, jwks)（RS256/kid/exp/nonce/iss/aud）
    RP->>DB: JIT：username = oidc:<tenant>:<sub>，无则插入（'!oidc' 占位不可登录）
    RP->>UA: 200 信封 issueTokens()（access/refresh HS256 桥接会话）

    UA->>RP: 重放 callback?code&state
    RP->>KV: state 已删除
    RP-->>UA: 401 invalid or expired state
```

（JIT = Just-In-Time 建号：首次登录成功时自动在本地 users 表插入一行。）

安全闸门与失效路径：

| 闸门 | 失败返回 |
|---|---|
| authorize：client_id/redirect_uri 白名单不命中 | 400（**绝不重定向**） |
| authorize：response_type ≠ code / scope 无 openid / PKCE 非 S256 | 400 |
| authorize / token：会话或 code 无效、过期、已用 | 401 |
| callback：state 无效/过期/重放 | 401 |
| callback：jwks 拉取失败 | 502（**不回落本地验签**） |
| callback：id_token 验签失败 / nonce、iss、aud 与快照不符 | 401 |
| token：code 归属 client 与凭证不符 | 401（RFC 6749 §4.1.3） |

## 3. 多租户数据流

```mermaid
flowchart LR
    Q["GET /oidc/login?tenant=acme"] --> LOOK["oidc.rp[acme]<br/>（config 段，未知 -> 400）"]
    LOOK --> SNAP["state 快照绑定 IdP 配置<br/>（callback 只信快照，不信 query）"]
    SNAP --> IDP["按 issuer 对接该租户的 IdP<br/>（通用 discovery）"]
    IDP --> TOK2["id_token.tenant =<br/>clients.<client>.tenant"]
    TOK2 --> JIT["JIT 本地行 username=<br/>oidc:acme:<sub>（租户隔离）"]
    JIT --> API["业务请求：X-TENANT-ID 头恢复强制<br/>租户隔离沿用既有语义"]
```

- **RP 侧**：tenant 决定用哪个 IdP。tenant 从 query 进入豁免路由，建 state 时快照进 KV，
  后续只信快照。query 无法劫持已建立的登录流。
- **OP 侧**：tenant 来自 client 注册（`oidc.clients.<id>.tenant`），随 code 进入
  id_token/access_token claims。
- **豁免边界**：只有跳转腿豁免；登录后的业务请求照常强制 `X-TENANT-ID`，与全站语义一致。

## 4. 组件与文件清单

| 组件 | 文件 | 职责 |
|---|---|---|
| 配置段 | `src/config.rs` | `OidcSection{issuer, private_key_path, rp, clients}` + `TenantCfg.anonymous_paths` |
| 状态 | `src/bridge/oidc.rs` | `OidcState`：PKCS#8 装载、kid（sha256(b64u(n)) 前 16 hex）、JWKS、rp/clients 透出；`from_section` fail-fast |
| ops | `src/bridge/oidc.rs` | `op_oidc_sign`（RS256+kid header）/ `op_oidc_verify`（本机或 jwks 按 kid，锁 RS256，leeway 0）/ `op_oidc_info` |
| 裸 JSON | `src/bridge/json.rs` | `json.raw(data)`——200 裸 JSON，默认 content-type，`json.header` 可覆盖 |
| 全局挂载 | `src/bridge/bootstrap.js` | `oidc` 全局（sign/verify/jwks/issuer/rp/clients）；ASCII 纪律 |
| 装配 | `oj/src/app.rs` | `cfg.oidc → OidcState::from_section → Extras.oidc/StableState`（构造期，fail-fast） |
| 租户豁免 | `serve/src/lib.rs` | `Pipeline.tenant_anon` + `path_matches`（字面 / `/*` 一层 / `*` 单段 / `**` 跨段）；run 闭包豁免缺失头 400 并置 `RequestInfo.anonymous` |
| OP | `sample/src/idp/` | discovery / jwks.json / authorize / login / token / userinfo（六端点） |
| RP | `sample/src/oidc/` | login / callback / logout（三端点） |
| 共享工具 | `sample/src/auth/_shared/util.ts` | redirect / nowSecs / b64uFromHex / parseForm / parseCookies（构建顺序 auth 最先） |
| 测试 | `sample/tests/oidc.test.ts` | L1：39 用例（进程内） |
| 测试 | `oj/tests/oidc_e2e.rs` | 真 TCP 全链 e2e。**独立测试目标**：oj-auth 插件 `static GUARD: OnceLock` 进程级只认首次 init，与 e2e.rs 共进程会互染 |

## 5. 已知边界（刻意不做的）

- OP sub = `users.id` 字符串；自举登录 JIT 出 `oidc:default:<id>` 本地行，与原 demo 行
  **不合并**（外部 IdP 语义下 sub 本就 opaque）。
- 不支持：consent 页（登录即同意）、refresh_token / client_credentials grant、
  OP end_session、JWKS 轮换运维（kid 机制已就位，轮换是配置问题）。
- code/state 的消费是 get→del 非原子（重放必落空；并发窗口由 PKCE/state 绑定兜底；
  redis 后端可换 GETDEL）。secret/PKCE 比较非常量时间（demo 范围）。
- `client_secret` 明文存 config（与 `auth.jwt_secret` 同信任级），经 `oidc.rp/clients`
  可读——handler JS 与 jwt_secret 同级受信。
