# OIDC 接入手册

> 给谁读：要在自己的 oj 项目里启用 OIDC 的开发者。覆盖接外部 IdP（RP 角色）、用内置
> OP、多租户接线与排障。实现原理见 [oidc-implementation.md](oidc-implementation.md)，
> JS 全局签名见 [devkit/api-manual.md](devkit/api-manual.md) §6 `oidc` 行。
>
> 术语：**IdP** = 身份提供方（如 Keycloak、Auth0，或本仓内置 OP）；**RP** = 接入方，
> 即你的 oj 服务；**OP** = 本仓 sample 自带的身份提供方实现。

## 1. 前置条件

- oj ≥ 本特性版本；`plugins:` 里装配了 `oj-auth`（Bearer 守卫；OIDC 会话桥接依赖它）。
- RS256 私钥一把（PKCS#8 PEM）。生成任选：

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out config/oidc_rs256.pem
# 或复用 oj-cert（其 private.pem 即 PKCS#8）：
cargo run -p oj-cert -- gen -o config --days 365
```

- RP 角色对接的 IdP 必须支持：**authorization code flow + PKCE S256 + RS256 id_token +
  discovery**（`<issuer>/.well-known/openid-configuration`）。四者缺一不可（RP 强制 PKCE
  S256、强制验签）。

## 2. 最小可用配置

```yaml
oidc:
  issuer: "https://idp.example.com"          # 本机 OP 的对外 URL；只当 RP 时此字段仍必填（OP 侧身份）
  private_key_path: "./config/oidc_rs256.pem" # 相对 config.yaml 所在目录
  rp:                                         # tenant → 外部 IdP 注册
    default:
      issuer: "https://idp.example.com"       # IdP 的 issuer（与它 discovery 文档里的 issuer 一字不差）
      client_id: "my-app"
      client_secret: "..."
      scope: "openid profile"
```

只当 RP、不用内置 OP 时，`rp` 段配好即可，`clients` 段可以省略。`oidc:` 段缺省 =
不启用（`oidc` 全局不存在，调用报 `oidc not configured`）。

IdP 侧注册（在 IdP 的管理台上做）：

- redirect_uri 填你服务的**精确串**：`https://<host>/v1/api/oidc/callback`
  （`server.api_prefix` 非默认时替换前缀）。
- 允许的 grant：`authorization_code`；强制 PKCE S256 最好（本 RP 永远发 PKCE）。
- 签名算法 RS256。

## 3. 登录链路（RP 角色）

业务前端只需两步：

```bash
# 1) 拿 IdP 授权地址（302，Location 即 IdP authorize URL）
curl -si 'https://your.app/v1/api/oidc/login?tenant=default'
#    → 302 Location: https://idp.example.com/authorize?...code_challenge=...

# 2) 浏览器走完 IdP 登录后回跳 callback，callback 直接返回会话信封：
#    {"code":0,"msg":"ok","data":{"access_token":"...","refresh_token":"...",
#                               "expires_in":60,"user":{"id":"42","roles":[]}}}
# 之后所有业务 API 照常：Authorization: Bearer <access_token> + X-TENANT-ID 头
```

要点：

- `?tenant=` 必须是 `oidc.rp` 里的键，未知租户 400。
- `tenant` 与 `state` 一起快照进 KV（TTL 10 分钟），callback 只信快照。用户改 query
  动不了已建立的登录流。
- 登录成功后本地账号按 **`oidc:<tenant>:<sub>`** JIT 创建（JIT = 首次登录自动建行，
  不可密码登录），与本地口令账号天然隔离；`roles` 取该行 `roles` 列。
- `/oidc/*`、`/idp/**` 路径必须同时加进 **`auth.anonymous_paths` 与
  `tenant.anonymous_paths`**（浏览器跳转腿带不了 Bearer 和租户头）：

```yaml
auth:
  anonymous_paths:
    - "/oidc/*"                 # login/callback/logout：尾段一层，够用
    - "/idp/**"                 # authorize/token/userinfo 一层，
                                #   而 discovery 在 /idp/.well-known/openid-configuration（两层）
tenant:
  enable: true
  anonymous_paths:          # 与 auth 的同名机制同形：字面 / `/*` 一层 / `*` 单段 / `**` 跨段
    - "/oidc/*"
    - "/idp/**"
```

> **为什么 `/idp` 用 `**` 而不是 `/*`**：尾 `/*` 是**严格一层**，而
> `/idp/.well-known/openid-configuration` 是两层。写 `/*` 会让 discovery 被守卫拦下。
> 注意这条收紧**只发生在 `auth.anonymous_paths`**（oj-auth 侧旧实现是任意深度）；
> `tenant.anonymous_paths` 自引入起就是严格一层，所以那里写 `/*` 与 `**` 的差别只在于
> 「要不要覆盖更深路径」，不涉及迁移。
>
> 装配期只对 **auth 列表**打迁移 WARN：`/idp/*` 这类旧式前缀条目若确实丢了面（discovery
> 比它深）就会被点名（v0.1.23 起还要满足「旧式前缀形态 + 确会丢面」两个条件）；确属
> 「有意一层」时写 `- { path: "/idp/*", one_layer: true }` 消音。
> `sample/config.yaml` 走的是**更窄**的三条 + `one_layer`（豁免面最小），本文的 `/idp/**`
> 是等价但更省事的写法。两者都不告警，按你的安全偏好选一个即可。

## 4. 用内置 OP（自己当身份源）

在 `oidc:` 段再加 `clients`（OP 侧 client 白名单），并把要自举的租户的 `rp.<tenant>.issuer`
指向本机 OP：

```yaml
oidc:
  issuer: "http://localhost:9778/v1/api/idp"   # OP 对外身份（必须与实际可达地址一致）
  private_key_path: "./config/oidc_rs256.pem"
  clients:                                      # OP 侧：谁可以来登录
    sample-rp:
      secret: "rp-secret"
      redirect_uris:                            # 精确串白名单；不在表内绝不重定向
        - "http://localhost:9778/v1/api/oidc/callback"
      tenant: "default"                         # 该 client 登录成功后 id_token.tenant 的值
  rp:
    default:                                    # 指向自己 = 自举演示
      issuer: "http://localhost:9778/v1/api/idp"
      client_id: "sample-rp"
      client_secret: "rp-secret"
      scope: "openid profile"
```

OP 端点一览（对外标准协议，成功响应为裸 JSON）：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/api/idp/.well-known/openid-configuration` | GET | discovery（勿硬编码下游地址，走发现） |
| `/v1/api/idp/jwks.json` | GET | 验签公钥（RS256，kid） |
| `/v1/api/idp/authorize` | GET | 无 OP 会话 → 401 `login required`（先 POST login 持 cookie 重来） |
| `/v1/api/idp/login` | POST | `{username,password}` → `Set-Cookie: IDP_SESSION`（users 表 + bcrypt） |
| `/v1/api/idp/token` | POST | form：`grant_type=authorization_code&code&client_id&client_secret&redirect_uri&code_verifier` |
| `/v1/api/idp/userinfo` | GET | `Authorization: Bearer <access_token>` → `{sub, tenant}` |

OP 的登录用户 = 本库 `users` 表（bcrypt）。给用户开号即插一行（`INSERT OR IGNORE INTO
users (username, password_hash, roles) VALUES (?, '<bcrypt hash>', '[]')`）。

## 5. 多租户接线

| 位置 | 配置 | 语义 |
|---|---|---|
| RP（接谁的 IdP） | `oidc.rp.<tenant>` | tenant → IdP issuer/凭证；`/oidc/login?tenant=<键>` 选用 |
| OP（谁可以登录） | `oidc.clients.<id>.tenant` | 该 client 的登录会签发到哪个租户（id_token.tenant） |
| 跳转腿豁免 | `tenant.anonymous_paths` | 浏览器 302 带不了租户头；列表外照常 400 |
| 业务隔离 | `X-TENANT-ID` 头 | 登录后恢复全站强制；行级过滤仍由业务 SQL 自理（框架不自动改写） |

一个 users 表服务多租户时，本地账号名 `oidc:<tenant>:<sub>` 已按租户隔离。**不要**把
两个不同信任级的 IdP 指向同一租户键。

## 6. 会话与登出

- callback 返回的 `access_token/refresh_token` 就是既有 `auth` 会话（HS256 + KV 轮换，
  时长取 `auth.access_token_duration/refresh_token_duration`）。**后续鉴权、refresh、
  logout 与本地登录完全同构**，前端无感。
- OP 侧会话（`IDP_SESSION` cookie）独立存在，只用于 authorize 免重复输密码；Path 限定
  `/…/idp`，HttpOnly + SameSite=Lax。
- `POST /v1/api/oidc/logout`（body `{refresh_token}`）等价 `auth/logout`。

## 7. 排障表

| 症状 | 原因 / 处置 |
|---|---|
| `oidc not configured` | config 没有 `oidc:` 段（或 `oj build` 产物未带新二进制）；段存在但 `issuer`/`private_key_path` 为空 → 启动即报错退出 |
| 启动报 `oidc private key … parse pkcs8 pem` | 私钥不是 PKCS#8 PEM（`BEGIN PRIVATE KEY`）；用 §1 命令重新生成 |
| `/oidc/login` → 400 `unknown tenant` | `?tenant=` 不在 `oidc.rp` 键里 |
| `/oidc/login` → 502 `discovery failed` | IdP 不可达 / issuer 写错 / IdP 无 discovery 端点；`curl <issuer>/.well-known/openid-configuration` 自查 |
| `/oidc/callback` → 502 `jwks fetch failed` | jwks_uri 拉取失败（IdP 抖动）；**不会**静默回落本机验签，重试即可 |
| `/oidc/callback` → 401 `id_token verification failed` | RS256/kid 不匹配（IdP 轮了密钥）或 token 被篡改 |
| `/oidc/callback` → 401 `id_token claims mismatch` | nonce/iss/aud 与快照不符：多为 issuer 大小写/尾斜杠不一致 |
| `/oidc/callback` → 401 `invalid or expired state` | state 已用或超 10 分钟；回 `/oidc/login` 重新起流程 |
| authorize → 400 `redirect_uri not registered` | 跳转地址不在 `oidc.clients.<id>.redirect_uris` 精确表内（scheme/host/端口/路径全都要一致） |
| authorize → 401 `login required` | 正常：先 `POST /idp/login` 拿 IDP_SESSION cookie 再访问 authorize |
| 登录后业务 API 400 `missing tenant header` | 正常：跳转腿豁免不覆盖业务请求；客户端把 `X-TENANT-ID` 带上 |
| e2e/测试里 `/oidc/*` 意外 401 | oj-auth 插件 `static GUARD` 进程级只认首次 init 的匿名表——同进程多服务器测试请把用例放进独立测试目标（参考 `oj/tests/oidc_e2e.rs`） |

## 8. 安全清单（上线前自查）

- [ ] `redirect_uris` 精确串（无通配、无 query）；白名单外绝不发生 302
- [ ] PKCE S256 强制（RP 已强制；IdP 侧也开）
- [ ] `client_secret` 不进前端/日志；轮换时 `rp` 与 IdP 两侧同步
- [ ] 生产 IdP 走 HTTPS（issuer 与 discovery 返回值逐字一致）
- [ ] `auth.anonymous_paths` 与 `tenant.anonymous_paths` 只列跳转腿路径（本文 §3 用 `/idp/**`
      两条；`sample/config.yaml` 用 `/idp/* + one_layer` 三条——都是合法窄面），不加业务路径
- [ ] 私钥文件权限收紧（600）；`config/` 不进镜像分发
- [ ] 已知晓：demo 私钥 `sample/config/oidc_rs256.pem` 仅供演示，勿用于生产
