# 场景速查（照抄就能跑）

这里是 `api-manual.md` 的配套场景集：不讲概念，只给「什么时候用 / 配置怎么写 /
代码怎么写 / 怎么验证 / 常见坑」。每段代码都能直接抄进业务项目。

> 建议先按 `api-manual.md` §1 快速开始跑通 Hello World，再回来按场景抄。
> 每个场景都标了对应的手册章节，想深挖就跳过去。

| 场景 | 一句话 | 相关章节 |
|---|---|---|
| [1](#场景-1公开分享页要按租户读数据) | 链接里带 token，匿名访问但数据必须按租户隔离（`anonymous_paths` + `allow_as_tenant` + `db.asTenant`） | §6 db / §8 鉴权与多租户 |
| [2](#场景-2spa-深链刷新与每页-seo-标题) | 前端单页应用，刷新 `/space/7` 不 404，且每个路由有自己的 `<title>` | §10 配置 / §12 运维 |
| [3](#场景-3测试不脏开发库) | `oj test` 默认落 `db.test`，测试数据不污染开发库 | §9 测试 |
| [4](#场景-4列表分页与-limit-陷阱) | 「怎么只返回了 100 条」——LIMIT 策略可配 + 截断可观测 | §3 数据层 / §6 db |
| [5](#场景-5匿名路径怎么写) | `anonymous_paths` 的四种通配形态 + v0.1.20 收紧（**仅 auth 侧**）与 `one_layer` 消音 | §8 鉴权与多租户 |
| [6](#场景-6多库项目按库迁移与对账) | config 多了命名库：`oj migrate/fixture/schema diff --db <name>` 逐库跑（v0.1.21） | §3 数据层 / §10 db |
| [7](#场景-7雪花-id大整数的生成与回写) | 取号优先 `db.nextSeq(name)`（v0.1.24，原子）；雪花 id 读出是字符串，`Number()` 会静默坍缩 → 主键 dup 500 | §6 大整数与 i64 |
| [8](#场景-8302-重定向到-blob-预签名-url) | 权限校验后 302 到 `blob.url()` 预签名 URL，浏览器两跳直取对象（`json.redirect`，v0.1.26） | §6 json / §7 响应信封 |
| [9](#场景-9路径参数路由_name_-目录-vs-route) | 路径里带参数：`_name_` 目录 vs `.route`（v0.1.27） | §4 编写 api.ts |
| [10](#场景-10池化长任务--cronv0128) | 池化长任务 + cron：三钩子任务文件 + crontab.yaml + 管理 API（v0.1.28） | §6 池化任务与 cron |
| [11](#场景-11ldapad-登录鉴证v0128v0154-起调用面迁移-axisldap) | LDAP/AD 登录鉴证或目录查询（v0.1.54 起 `axis("ldap").bind/search/...`，filter 用户输入须转义，v0.1.28） | §6 ldap / §8 鉴权 |
| [12](#场景-12一次性数据修复脚本oj-execv0129) | `oj exec` 直接跑 ts/js：一次性数据修复/对账/批处理，完整后端全局 + 输出通道分离（console.log 原样 stdout，v0.1.29/v0.1.55）；**v0.1.60 起无需 config 静默回落 + `-e`/REPL 单表达式回显** | §11 `oj exec` |
| [13](#场景-13大文件直传绕开-10mb30s-v0130) | office 大附件 >10MB / 上传+处理超 30s：`blob.uploadUrl` 预签名（s3）或 `PUT {base}/blob/{key}` 直传路由（local）（v0.1.30） | §6 blob |
| [14](#场景-14浏览器登录cookie-会话--csrf-v0130) | 浏览器表单登录：HttpOnly `oj_sess` + CSRF 双提交；WS 握手同守卫（v0.1.30） | §8 鉴权 |
| [15](#场景-15ws-房间广播presence-v0130) | 同房间成员互发消息/在线人数：`ws.join` / `ws.broadcast` / `ws.roomSize`（v0.1.30） | §6 ws |
| [16](#场景-16带-exports-的包与-pnpm-布局v0130) | 现代 npm 包（`exports` 条件导出）与 pnpm 安装的解析约定；CJS 相对 require（v0.1.30） | §5 导入解析 |
| [17](#场景-17wasm-引擎包进-oj-runtimev0130) | wasm-bindgen 类引擎包（PDF/字体/shaping）的加载前置检查清单（v0.1.30） | §6 crypto |
| [18](#场景-18config-里的密码不落明文v0133) | config 里的密码/密钥不落明文——`secrets:` 段 + `oj secret keygen/seal/open`（X25519 信封，v0.1.33） | §10 配置 / 凭据密封专题 |
| [19](#场景-19一份配置多源资源按需选源v0134) | `config` 同时声明多套 db/redis/blob/es/broker/kafka/rabbit，`oj test`/`oj exec` 用 `--<key> <profile>` 选默认源（v0.1.34） | §9 测试 / §11 `oj exec` / §10 配置 |
| [20](#场景-20流式响应-sse-实时推送v0135) | 导出大 CSV / 实时推送——`json.stream` / `json.sse` 绕过信封、心跳保活（v0.1.35） | §6 json / §7 响应信封 |
| [21](#场景-21前端跨域调用-oj-apicorsv0135) | 浏览器跨域 `fetch` oj API——`server.cors` 段（段存在即启用，`credentials` 需显式 `origins`，v0.1.35） | §10 配置 / §8 鉴权 |
| [22](#场景-22应用层-aes-gcm-字段加密v0135) | 应用层 AES-GCM 字段加密——`crypto.aesGcmEncrypt` / `aesGcmDecrypt`（仅 AES-128/256，密钥自管，v0.1.35） | §6 crypto |
| [27](#场景-27泛型轴插件调用axisnamev0154) | 泛型轴插件调用——`axis(name).op(...)`（v0.1.54；泛型轴零 ABI 变更，含 oj-ldap 迁移版调用面） | §6 axis(name) / §10 plugins |

---

## 场景 1：公开分享页要按租户读数据

**什么时候用**：你要做一个「分享链接」页面——收件人点开链接就能看，不用登录。
浏览器直接打开链接，带不了自定义请求头，所以请求是「匿名」的（没带 `X-TENANT-ID`）。
但系统是多租户的：每个客户（租户）的数据互相隔离。匿名不等于能随便看，
**数据仍必须按租户隔离**。

**红线先说**：租户 id **必须服务端派生**（从 token 查表得到），**绝不能**直接读 URL 上的
`?tenant=xxx` —— 那等于把租户开关交给调用方，防护形同虚设。

### ① 配置

```yaml
tenant:
  enable: true
  sql_guard: "deny"
  allow_as_tenant: true          # 默认 false：不给这个开关，db.asTenant 一律抛错
  anonymous_paths:
    - "/share/**"                # 免租户头的路径（去 API 前缀）：/share 及其下任意层
  shared_allow: [share_link]     # ② 分享 token 表是共享表（无 tenant_id）
```

```yaml
# src/share/schema.yaml
tables:
  share_link:                    # ① 共享表：schema 显式声明 + config.shared_allow 双声明
    tenant: false
    pk: token
    columns:
      token:     { type: text, null: false }
      tenant_id: { type: text, null: false }   # 它指向某租户，但自身不属于任何租户
```

> 共享表**必须两步都做**：`schema.yaml` 的 `tenant: false` + `config.yaml` 的
> `shared_allow`。只做一步会被当作受租户约束的表，启动时还会打 warn。

### ② handler

```ts
// src/share/detail/api.ts —— GET {base}/share/detail/{token}
export const get = async () => {
  const token = http.param("token", "");
  if (!token) return json.fail(400, "token required");

  // 第 1 步：用共享表把 token 换成租户（此时还没有租户身份，查共享表不违规）
  const links = await db.table("share_link")
    .select(["tenant_id"])
    .where({ field: "token", op: "eq", value: token })
    .all();
  if (!links.length) return json.fail(404, "link not found");

  // 第 2 步：声明身份。此后所有查询仍自动注入 tenant_id 条件，只是值来自这里。
  const scoped = db.asTenant(String(links[0].tenant_id));
  const rows = await scoped.table("order")
    .select(["id", "item"])
    .orderBy([{ field: "id", dir: "desc" }])
    .limit(20)
    .all();

  json.ok(rows);
};
get.route = "{token}";
export default { get };
```

要点：

- `db.asTenant(id)` 返回的实例与 `db` 同面（`table/query/exec/tx` 全都有），链式写下去即可。
- 声明后 `http.tenantId` 也会变成该值，日志/审计能看到真实生效的租户。
- **请求级、只能设一次**：同一个请求里第二次调用会抛错（防 handler 中途换身份）。
- 与 `db.asSystem()` 的区别：`asSystem` 是**完全关掉**租户防护（跨租户对账/报表用），
  `asTenant` 是**补上身份**、防护照旧。公开页要的是后者。

### ③ 验证

```bash
curl -s http://localhost:9778/v1/api/share/detail/abc123 | head -c 200
```

### ④ 常见坑

| 报错 | 原因 | 怎么办 |
|---|---|---|
| `db.asTenant is disabled: set tenant.allow_as_tenant=true ...` | 总开关没开 | `tenant.allow_as_tenant: true` |
| `db.asTenant is only allowed on anonymous requests ...` | 请求带了租户头，或路径没命中 `anonymous_paths` | 路径写进 `anonymous_paths`（注意是**去 API 前缀**后的路径）；确认没带 `X-TENANT-ID` |
| `db.asTenant: id must not be empty` | 查表没查到、传了空串 | 先判断查询结果再声明 |
| 400 缺租户头 | `anonymous_paths` 没命中，请求在进 handler 前就被拦了 | 检查通配形态（见[场景 5](#场景-5匿名路径怎么写)） |
| `raw sql lacks tenant_id on [order]` | 绕过构造器写了裸 SQL | 优先用 `db.table()`；裸 SQL 必须显式带 `tenant_id = ?` |

---

## 场景 2：SPA 深链刷新与每页 SEO 标题

**什么时候用**：前端是单页应用（SPA，Vue/React 那种整页不刷新、由 JS 切换页面的应用），
产物放 `dist/`。用户直接打开或刷新 `/space/7` 这种深链时，服务端并没有这个文件，
不能回 404——要回落到 `index.html`，交给前端路由接管。同时希望每个路由有自己的
`<title>` / description / og 标签，给搜索引擎和分享预览用。注意爬虫不执行 JS，
靠前端 JS 改标题它们看不到，所以这些标签得由服务端写进 HTML。

### ① 配置

```yaml
mounts:
  - prefix: "/v1/api"          # api 挂载：这个前缀下的 404 不会被回落吞掉（见坑 1）
    api: "src"
  - prefix: "/"                # web 挂载：静态站点根（相对 config 文件目录）
    web: "dist"
    spa: true                  # 默认 false：不显式打开就没有深链回落
server:
  html_meta: "__meta"          # 默认关闭：开启后按请求路径读 __meta/<path>.json 注入
```

### ② 产物布局

```
dist/
├── index.html                 # 前端产物（必须含 </head>，注入点在这里）
├── assets/app.js
└── __meta/                    # 元信息目录：**不对外公开**（直接访问返回 404）
    ├── index.json             # 对应 /（首页）
    ├── space/
    │   ├── 7.json             # 对应 /space/7
    │   └── 9.json
    └── about.json             # 对应 /about
```

`__meta/<path>.json` 支持的键（**只注入标签，绝不注入脚本**）：

| 键 | 产出 |
|---|---|
| `title` | `<title>…</title>` |
| `description` | `<meta name="description" content="…">` |
| `canonical` | `<link rel="canonical" href="…">` |
| `og:*` | `<meta property="og:…" content="…">` |
| `twitter:*` | `<meta name="twitter:…" content="…">` |

```json
{
  "title": "7 号工作区",
  "description": "7 号工作区的公开看板",
  "canonical": "https://example.com/space/7",
  "og:title": "7 号工作区",
  "og:image": "https://example.com/og/7.png",
  "twitter:card": "summary_large_image"
}
```

> `__meta/` 下的 JSON 由**构建期/离线脚本**生成（前端构建产物的一部分），oj 不做 SSR。
> 值里出现 `<` / `"` 会被 HTML 转义，不必手工处理。

### ③ 按数据注入（公开分享页 / issue 标题，v0.1.25）

`__meta/*.json` 是**构建期**产物，只能覆盖事先就知道的路由。像 `/issues/<动态 id>` 这种标题
来自数据库的页面，用 `html_meta_handler` 指一个**普通 GET handler**：

```yaml
mounts:
  - prefix: "/"
    web: "dist"
    spa: true
server:
  html_meta_handler: "/v1/api/html-meta"   # 必须命中一个 GET 路由，否则启动即报错
  html_cache_control: "no-cache"           # 壳随路由而异 → 别让中间层盲缓存（只管 HTML）
```

```ts
// src/html-meta/api.ts —— 路由 /v1/api/html-meta/（内部派发，无需进 anonymous_paths）
export default {
  async get() {
    const path = decodeURIComponent(String(http.query.path ?? ""));   // 原始请求路径
    const id = path.startsWith("/issues/") ? path.slice("/issues/".length) : "";
    const rows = id
      ? await db.table("issues").select(["name"])
          .where({ field: "id", op: "eq", value: id }).limit(1).all()
      : [];
    const name = rows.length > 0 ? String(rows[0].name) : "Issue";
    json.ok({
      title: `${name} · Acme`,
      "og:title": name,
      "og:type": "article",
      cache_control: "public, max-age=60",   // 保留键 → 本响应的 Cache-Control（优先级最高）
    });
  },
};
```

要点：

- 送 HTML 前**内部派发**该 handler（HTTP 动词恒 GET）；**`http.query.path` 是已剥命中
  web 挂载前缀的站点内路径**（挂载 `prefix: "/site"` 时 `/site/issues/7` → `/issues/7`），仍是
  percent-encoded，需要明文自己 `decodeURIComponent`；
- 返回的键与 `__meta/*.json` **同一白名单**（`title` / `description` / `canonical` /
  `og:*` / `twitter:*`，值一律转义、不注入脚本）；静态 JSON 打底、动态**按 key 覆盖**；
- **注入是替换而非追加**：head 里同名的旧标签（壳里写死的 `<title>App</title>`、默认
  description/og）会先被摘掉再放新的。不这样的话，浏览器与爬虫只认第一个，注入等于没注入；
- **handler 恒以匿名身份运行**：不经前置守卫（页面请求带不了 `Authorization`），
  **租户头/请求头/请求体一律不传递**（`http.tenantId` 恒 `null`）。要按租户取数就
  **从 URL 派生 id → `await db.asTenant(id)`**（需 `tenant.allow_as_tenant: true`，见场景 1）。
  该 handler **不需要**写进 `anonymous_paths`（外部直接访问该路径时仍受守卫约束）；
- **fail-open**：handler 报错 / 超时 / 非 2xx / 非 JSON / 信封 `code != 0` → 打 WARN，页面
  按静态结果照常送出（宁可少几个 meta，不可整页挂）；装配期则 fail-fast（路径没命中 GET
  路由即拒启）；
- 每次 HTML 请求都会派发一次（无缓存层），超时按 `server.timeout`（默认 30s）。所以 handler
  只做**轻查询**，并用返回的 `cache_control` 让中间层替你挡住重复请求。meta 若随身份/租户而异，
  **禁用 `public`**（共享 CDN 会把 A 的标题发给 B）。

> **只挂缓存头、不做注入**：单配 `html_cache_control: "no-cache"` 即可（三键彼此独立，
> 不需要同时开 `html_meta*`）。

> **生产形态**：注入只在 **oj 自己送静态文件**时生效。若生产由 nginx/Caddy/对象存储直出 SPA，
> 要么让站点走 oj 托管（web 挂载），要么在反代层做同样的事。

顺手一提：邮件里要拼的站点基址这类**部署期常量**，写 config 顶层 `vars:` 段，handler 里
`vars.get()` 读（同步；只有声明过的键可读，未声明恒 `null`；平台不读 OS env）：

```yaml
vars:
  WEB_URL: "https://app.example.com"
```

```ts
const web = vars.get("WEB_URL") ?? "http://localhost:3000";
json.ok({ reset_link: `${web}/reset-password?token=${token}` });
```

### ④ 验证

```bash
curl -s http://localhost:9778/space/7 | grep -o '<title>[^<]*</title>'
# <title>7 号工作区</title>
curl -sI http://localhost:9778/__meta/space/7.json | head -1   # 404（元信息不公开）
# 动态 meta（爬虫视角：不执行 JS 也能看到按数据注入的标签）
curl -s -H 'Accept: text/html' http://localhost:9778/issues/abc | grep -i 'og:title'
# <meta property="og:title" content="修复登录超时">
```

### ⑤ 常见坑

| 现象 | 原因 |
|---|---|
| 深链仍然 404 | web 挂载忘了 `spa: true`（默认关） |
| 拼错的 API 路径返回 200 + 首页 HTML | 不会：`/v1/api` 前缀下的路径**不参与回落**，该 404 还是 404 |
| 某个前端路由没回落 | 路径带扩展名（如 `/space/7.json`）——带扩展名视为资源请求，不回落 |
| `curl -X POST` 不回落 | 只有 `GET` / `HEAD` 回落 |
| 没看到注入 | `dist/index.html` 里没有 `</head>`；或 meta 文件路径不对（`/space/7` → `__meta/space/7.json`，末段先 `set_extension("json")`）；或 Accept 头声明只要别的类型 |
| 首页没有 title | 缺 `__meta/index.json`（`/` 与目录首页都映射到 `index.json`） |
| 动态 handler 配了但没生效（日志有 `warn: html_meta_handler`） | 看 WARN 内容：handler 返回非 2xx / 超时 / 返回的不是 JSON 对象 / 信封 `code != 0` —— 注入面坏了会 fail-open 到静态结果 |
| handler 里 `db.asTenant` 抛错 | 派发是**匿名**的（`http.tenantId` 恒 null，且不看租户头）——需 `tenant.allow_as_tenant: true`，且 id 必须由 URL 派生（见场景 1） |
| 注入的 title 没生效（还是壳里那个） | 不会：同名旧标签会被摘掉。若真出现，检查壳的 `<title>` 是否写在了 `</head>` 之外，或 head 里是不是 `<script>` 里拼出来的（脚本内容不参与替换） |
| title 注入对了但 `og:*` 没变 | 动态返回里没给该 key（静态 JSON 打底，按 key 合并）——或值不是字符串（非字符串键一律忽略） |
| 生产环境的预览卡片还是旧标题 | oj 只在**自己送静态文件**时注入；nginx/Caddy/对象存储直出 SPA 时不生效（见上「生产形态」） |
| 启动直接报 `server.html_meta_handler: "…" 不在路由表` | 配置的路径没有对应 GET 路由（常见：漏了尾斜杠以外的真实路径、或该路径只有 POST） |
| `vars.get("X")` 恒 `null` | `X` 没写进 config 的 `vars:` 段（fail-closed；平台不读 OS env） |

---

## 场景 3：测试不脏开发库

**什么时候用**：`oj test` 会连真实数据库跑测试。如果落在开发库上，测试会读到非种子数据，
甚至写坏开发库。给它单独声明一个测试库就行。

### ① 配置

```yaml
db:
  default: "sqlite://db.sqlite"        # 开发/运行库
  test:    "sqlite://db_test.sqlite"   # ★ 测试库：声明了它，oj test 自动用它
```

### ② 运行

```bash
./bin/oj test -c sample/config.yaml -d sample/src
# stderr: oj test: using db "test"（migrate / seed / fixtures 一并跟随）

./bin/oj test -c sample/config.yaml -d sample/src --db ci_scratch   # 指定别的库（须在 db 段声明）
./bin/oj test -c sample/config.yaml -d sample/src --anonymous       # 以匿名身份跑（测公开面）
```

- 建表、seed、fixtures、以及 handler 里的 `db` **全部**跟着走，不会出现「表建在 A 库、
  查询打 B 库」。
- 没配 `db.test` 也没给 `--db` → 打一条 WARN 后继续用 `default`（不静默）。

### ③ 测一个公开面 handler

```ts
// tests/share.test.ts（`oj test --anonymous` 下运行）
describe("share", () => {
  it("匿名请求声明租户后只读到本租户数据", async () => {
    // 不开 --anonymous 时，这条请求在鉴权/租户管线就被拦下（400/401）
    const r = await client.get("/share/detail/abc123");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).code).toBe(0);
  });
});
```

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| 测试读到一堆陌生数据 | 没配 `db.test`，跑在 `default` 上（看启动那行 `oj test: using db ...`） |
| `--db foo` 启动报错 | `foo` 没在 config `db:` 段声明（键即库名） |
| 公开面用例仍 400/401 | 忘了 `--anonymous`；或 config 没开 `tenant.allow_as_tenant` |

---

## 场景 4：列表分页与 LIMIT 陷阱

**什么时候用**：接口返回列表，客户端抱怨「明明有 300 条只回来 100 条」。
这不是 bug，是平台的默认保护：不写 `limit()` 就按 `default_limit` 截断。

### ① 默认行为

- 顶层 `select` **没写** `limit()` → 自动补 `db_query.default_limit`（默认 **100**）。
- 顶层 `select` **写了** `limit(n)` → 生效，并被 clamp 到 `db_query.max_limit`
  （默认 **1000**，硬顶 100000）。
- **嵌套/子查询不隐式截断**（只影响顶层）。

### ② 调整策略

```yaml
db_query:                # 注意：不能写进 db: 段（db 是 name→DSN 的 map）
  default_limit: 200     # 未给 limit 时的隐式上限
  max_limit: 2000        # 显式 limit 的 clamp 上界
```

配置错了**启动即报错**（不给静默回落）：`db_query.default_limit must be >= 1`、
`db_query.max_limit 200000 exceeds hard cap 100000`、`db_query.default_limit 30 > max_limit 20`。
键名写错（比如写成 `default`）同样会报错——不会静默用默认值。

### ③ 让客户端知道「可能被截断了」

当返回行数 ≥ 生效上限时，响应会带一个头：

```bash
curl -is 'http://localhost:9778/v1/api/order/list/' | grep -i x-oj-row-limit
# X-OJ-Row-Limit: 100
```

看到这个头 = **可能还有更多**（正好等于上限时无法区分「正好这么多」和「被截断」）。
正确做法是显式分页，别依赖默认值：

```ts
const page = Number(http.param("page", 1));      // 页码从 1 开始
const size = Math.min(Number(http.param("size", 50)), 200);
const rows = await db.table("order")
  .select(["id", "item"])
  .orderBy([{ field: "id", dir: "desc" }])       // 分页必须有稳定排序！
  .limit(size)
  .offset((page - 1) * size)
  .all();
json.ok({ page, size, rows });
```

> 分页少了 `orderBy` 会翻页重复/漏行（SQL 不保证无序结果的行序稳定）。

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| 只返回 100 条 | 没写 `limit()`，吃了 `default_limit`；看 `X-OJ-Row-Limit` 头确认 |
| 写了 `limit(5000)` 只回来 1000 条 | 被 `max_limit` clamp（响应头同样会提示） |
| 配置了 `db_query` 但不生效 | 键名拼错（会启动报错，不是静默）、或写进了 `db:` 段 |
| `toSQL()` 里没有 LIMIT 文本 | LIMIT/OFFSET 是**绑定参数**，看 `params` 数组而不是 SQL 字符串 |

---

## 场景 5：匿名路径怎么写

**什么时候用**：有些路径要免鉴权——`tenant.anonymous_paths` 免租户头，
`auth.anonymous_paths` 免 Bearer。典型场景是 OIDC 跳转腿：OIDC 是「跳到第三方登录页
再跳回来」的单点登录流程，浏览器发起的 302 跳转带不了自定义头，也带不了 Authorization。

### ① 四种通配形态

路径写的是**去掉 API 前缀**后的部分（`/v1/api/health` → `/health`）。

| 写法 | 含义 | 命中 | 不命中 |
|---|---|---|---|
| `/health` | 字面全等 | `/health` | `/health/x` |
| `/public/*` | 严格**一层** | `/public/a` | `/public/a/b` |
| `/idp/**` | **跨任意层** | `/idp`、`/idp/a`、`/idp/a/b/c` | — |
| `/report/*/export` | 中段 `*` 恰好一段 | `/report/7/export` | `/report/a/b/export` |

```yaml
tenant:
  anonymous_paths:      # 免租户头；命中且没带租户头 ⇒ 该请求为「匿名请求」
    - "/health"
    - "/idp/**"
auth:
  anonymous_paths:      # 免 Bearer
    - "/health"
    - "/auth/login"
    - "/idp/**"
```

> 两条列表是**独立的**：OIDC 回调这种「浏览器跳转腿」通常**两个都要加**，
> 只加一个仍会被另一道守卫拦下。

### ② v0.1.20 的行为变更（只需检查 `auth.anonymous_paths`）

尾 `/*` 以前在 **oj-auth 侧**被当作「任意层前缀」，v0.1.20 起收紧为严格一层（与 server 侧
对齐）。**`tenant.anonymous_paths` 自引入起就是严格一层**，那次收紧没碰它，所以启动期迁移
WARN **只针对 `auth.anonymous_paths`**（v0.1.23 订正）。

对 auth 列表，**两个条件同时成立才打**，否则静默：

1. **旧式前缀形态**：只有尾段那一个 `*`，其余段全是字面量（`/idp/*`、`/users/me/accounts/*`）。
   旧实现是「砍掉尾 `*` 再 `starts_with`」，只有这种形态当时能命中真实请求——含中段 `*` 的
   结构条目（`/public/anchor/*/issues/*`）那时根本匹配不上，是 v0.1.20 之后刻意写的形状。
2. 该条目**确实丢了面**：存在一条已注册路由比严格一层更深（`**` 只多出「零层」不算）。

```
warn: auth.anonymous_paths 的 1 条尾 "/*" 条目 ["/idp/*"]：改写为 "…/**" 会多命中已注册路由
（自 v0.1.20 起尾 "/*" 已是严格一层）；需要多层就改 "…/**"，
确属「有意一层」则写 `{ path: …, one_layer: true }` 消音
```

- 你依赖它匹配更深路径（如 `/idp/.well-known/openid-configuration`）→ 改成 `/idp/**`，
  或把深路径单独列出来。这类条目**每次启动都会告警**，直到改掉。
- 你的路径本来就只有一层、且没有更深路由（如 `/auth/oidc/*`）→ **无需改动**，也不会再告警。
- 只有模块根路由（`/user/account` + 条目 `/user/account/*`）→ **不告警**：旧语义也没覆盖裸
  根路径，不存在「丢面」。
- 你写的是**结构条目**（中段带 `*`，如 `/public/anchor/*/issues/*`）→ 不按旧前缀看待，
  **不告警**（`**` 会把更深的层级一并纳入，不是你要的形状）。
- 如果你**明知**会多命中仍要严格一层 → 标 `one_layer: true` 显式确认，永久消音：

```yaml
auth:
  anonymous_paths:
    - /auth/login
    - { path: "/idp/*", one_layer: true }   # 明知 ** 更宽，就要一层（discovery 另行单列）
```

> `one_layer` 只对末段为 `*` 的条目有意义：标在别的条目上装配期直接报错。对象形态只认
> `path` 与 `one_layer` 两个键，**键名写错会报错**（不再静默失配）。`tenant.` 段同样接受该
> 形态，但那里不告警，标记等于备注。

### ③ 验证

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9778/v1/api/health          # 200（匿名命中）
curl -s http://localhost:9778/v1/api/order/list/                                       # 400 缺租户头（未命中豁免）
curl -s -H 'X-TENANT-ID: acme' http://localhost:9778/v1/api/order/list/                # 200
```

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| 豁免没生效 | 路径写成了**带前缀**的 `/v1/api/xxx`——应写去前缀后的 `/xxx` |
| 深路径仍 400/401 | 尾 `/*` 只匹配一层，改 `/x/**` 或逐条列出 |
| 启动 WARN 反复点名某条 `/*` | **只可能来自 `auth.anonymous_paths`**：该条是旧式前缀形态且**确实丢了面**（有更深的已注册路由）——按提示改 `/x/**` 或把深路径单列；确属有意一层就标 `{ path: …, one_layer: true }` 消音。`tenant.` 段不会因此告警 |
| 装配期报 `标了 one_layer，但末段不是 "*"` | 标记只对末段为 `*` 的条目有意义（`/x/*`、`/x/*/` 都算），去掉或补上通配 |
| 对象形态报 `只认 path 与 one_layer 两个键` | 键名拼错（如 `one_layr`）——报错会指到出错条目的行号与下标 |
| 加了租户豁免但还 401 | 两条列表独立：`auth.anonymous_paths` 也得加 |
| WS 路由想加进列表 | 不用加：`ws.ts` 是真实路由，天然不过前置管线 |

---

## 场景 6：多库项目按库迁移与对账

**什么时候用**：config `db:` 段声明了 `default` 之外的命名库（`analytics` / `warehouse`…），
或者不同模块各自绑了不同的库。迁移（`oj migrate`）是把 schema 变更刷进数据库并记账的操作，
**每个库都要有自己的账本与表**——A 库迁过了不等于 B 库迁过，一个都不能漏。

### ① 配置

```yaml
# config.yaml
db:
  default:   "sqlite://db.sqlite"
  analytics: "sqlite://analytics.sqlite"
```

```yaml
# src/order/manifest.yaml
name: order
desc: 订单
version: 0.1.0
db: analytics        # ★ 该模块里字面 db.* 的调用落到 analytics（运行期路由）
```

### ② 运行

```bash
# 所有模块都在 default：逐库各跑一遍
./bin/oj migrate -c config.yaml -d dist                     # → db "default"
./bin/oj migrate -c config.yaml -d dist --db analytics      # → db "analytics"

# 模块绑了不同库（上面 manifest.db: analytics）：必须带 --module 逐组合跑
./bin/oj migrate -c config.yaml -d dist --db default   --module user
./bin/oj migrate -c config.yaml -d dist --db analytics --module order

# 演示数据与漂移门禁同旗标，也要逐库跑
./bin/oj test fixture -c config.yaml -d src --db analytics --module order
./bin/oj schema diff -c config.yaml -d dist --db analytics
```

- `--db <name>` 的 `name` **就是 config `db:` 段的键**，缺省 `default`。
- 账本 `_oj_migrations`、`schema.yaml` 收敛、`--baseline` 都**各库独立**：
  A 库迁过了不等于 B 库迁过。
- `oj migrate` 收尾行会打印目标库（`… → db "analytics"`），多库跑批时用它核对。

### ③ 验证

```bash
./bin/oj schema diff -c config.yaml -d dist --db default      # in sync（或列出漂移）
./bin/oj schema diff -c config.yaml -d dist --db analytics    # 逐库都要看
./bin/oj migrate -c config.yaml -d dist --db analytics --module order   # 重跑幂等，0 applied
```

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| `--db "x" not declared in config (db keys: […])` | 库名不在 `db:` 段（拼错/漏配）。工具**故意不回落** `default`——否则迁移会打在开发库上 |
| 某个库启动后报 M004（账本落后） | 那个库没跑 `oj migrate --db <name>`：多库不会自动连带 |
| `--db analytics` 把没绑 analytics 的模块的表也建进了 analytics | `--db` 是**整轮**目标库，不读模块级 `manifest.yaml` 的 `db:` 绑定——这种项目要配 `--module` 逐组合跑（见 ②） |
| `--db analytics` 报了别的库连不上的错 | 深瘦身装配会打开 config 里**所有** `db:` 连接；任一 DSN 打不开即失败，与 `--db` 指向哪个库无关 |
| 想用 `oj serve --db` 切库 | 没有这个旗标：运行期按模块 `manifest.db` 路由，`serve` 恒以 `default` 为基库 |

> 机制与边界详见仓库 `docs/migration.md` §3.8、`docs/db-guide.md` §1.1。

---

## 场景 7：雪花 id（大整数）的生成与回写

**什么时候用**：主键是雪花 id（snowflake，分布式系统常用的 64 位 id），或自增 id 已涨过
`2^53-1`（≈9.0e15）。此时 `db.query` 读出来的值**不是 number 而是十进制字符串**，
`Number()` 一转就静默算错——这是真实出过的线上事故（U38），别踩第二次。

### ① 配置 / 建表

```sql
CREATE TABLE seq (id bigint PRIMARY KEY, note text);
INSERT INTO seq VALUES (4886674138783273204, 'seed');   -- 一个雪花量级起点
```

### ② 首选：平台序列（v0.1.24）

新代码**直接用 `db.nextSeq(name)`** —— 单语句原子取号，并发下不会重号，也不需要你自己拿行锁：

```ts
const id = await db.nextSeq("issue_no");   // 1, 2, 3…；>2^53-1 时给十进制字符串
```

平台表 `_oj_sequences` 首次使用**自动建**（平台命名空间，业务不要手工读写/迁移）；在 `db.tx`
内调用会搭车同一连接。序列值不随调用方事务回滚而回退（按「只增不复用」理解）。

### ③ 自己维护业务序列表时（`max+1` 的最小改写）

```ts
// ✗ 事故写法：Number() 把超界整数压到 f64 网格 → +1 被吸收 → 下次分配算同一个值 → dup 500
const bad = Number((await db.query("select max(id) as m from seq"))[0].m) + 1;

// ✅ 范式：读出来是字符串，转 bigint 做精确算术，结果直接回写
const rows = await db.query("select max(id) as m from seq");
const next = toBigInt(rows[0]?.m ?? "0") + 1n;      // bigint；空表用 "0"
await db.exec("insert into seq (id, note) values (?, ?)", [next, "auto"]);
json.ok({ id: next });                               // 出线是 "4886674138783273205"（字符串）
```

按 id 查也同理（**不要**回传字符串）：

```ts
await db.query("select note from seq where id = ?", [toBigInt(idFromClient)]);  // ✅
await db.query("select note from seq where id = ?", [idFromClient]);            // ✗ PG: bigint = text
```

### ④ 验证

```ts
// 连续两次分配必须各自推进（并把"旧写法会坍缩"钉死）
const m = toBigInt((await db.query("select max(id) as m from seq"))[0].m);
const collapsed = Number(m.toString()) + 1;
expect(collapsed === Number(m)).toBe(true);          // +1 被 f64 吸收
expect(toBigInt(m.toString()) + 1n === m + 1n).toBe(true);   // BigInt 精确
```

### ⑤ 常见坑

| 现象 | 原因 |
|---|---|
| 主键 `duplicate key`，被撞的值末几位是 0 | `Number(max)+1` 算出的是 f64 网格值（不是 max+1），入过库后下次再算同一个值 |
| `toBigInt: … is not a safe integer` | 传进去的已是 `Number(...)` 的产物——传 DB 原样给出的字符串 |
| PG: `column "id" is of type bigint but expression is of type text` | 回写用了字符串——用 `toBigInt()`（字符串是文本意图，平台不做启发式转换） |
| PG: `operator does not exist: bigint = text` | `where id = ?` 传了字符串——同上 |
| `unsupported type`（`es`/`bus`/`mq`/`jwt`/`ws.sess.state`） | bigint 跨了不容忍的边界——先 `String(v)`（`json.*` / `log` / `mail` 已容忍） |
| 并发下仍然分配出重复序号 | `max+1` 本身有竞态——改用 `db.nextSeq(name)`（v0.1.24，单语句原子） |
| 同一条 SQL 混用字符串/数字参数后报 `invalid byte sequence … 0x00` | **v0.1.24 起平台自动按参数形态分缓存键，无需再规避**；若仍出现，检查 PG 插件是否随宿主重建 |
| `db param: u64 value … is not supported on this path` | 在 PG/SQLite 上用了 `toUBigInt()`——它们的 bigint 是 i64；改存 text 或换 MySQL `BIGINT UNSIGNED` |
| MySQL: `column 'x' has MySQL type 'DECIMAL' … does not decode yet` | 读侧不支持该列类型（`DECIMAL`/`JSON`/时间/`BIT`/`GEOMETRY`）——**报错而非静默给 `null`**；在 SQL 里 `cast(x as char) as x`，别用 `select *`。`BOOLEAN`/`TINYINT(1)` 读出是 `1`/`0` |

> 完整契约（值域分流表、接受/拒绝矩阵、u64 与已知债）见仓库 `docs/numeric-limits.md`。

## 场景 8：开发期追踪 SQL 执行情况与性能（v0.1.51）

dev 模式（无 `dist/manifests.yaml`）默认开启 SQL 追踪，无需任何配置即可看每条 SQL 跑了什么、跑了多久。

### ① 直接看日志

dev 启动后，每条 SQL 打 `target="oj::sql"` 的结构化日志（含 `sql` / `db` / `ms` / `rows` / `tx` / `src` / `status`），stderr 里直接定位慢查询与失败 SQL：

```
SQL trace sql="select * from account where id = ?" db=default ms=1.23 rows=1 tx=false src=anon status=ok
```

### ② 在 handler 里取本请求画像

```ts
const rows = await db.query("select * from account where id = ?", [id]);
const prof = db.sqlProfile();
// { count, totalMs, slow:[{sql,ms,db}], byDb:{default:{count,ms}}, events:[{sql,params,db,inTx,source,ms,rows,ok,error}] }
log.info(`ran ${prof.count} SQL in ${prof.totalMs.toFixed(1)}ms`);
```

### ③ 裸 curl 看 dev 信封 `_sql`

dev 追踪开启且本请求有 SQL 事件时，标准信封自动追加 `_sql` 字段（= 画像快照），无需改动 handler：

```json
{ "code": 0, "msg": "ok", "data": [...], "_sql": { "count": 3, "totalMs": 2.1, "byDb": {...}, "events": [...] } }
```

### ④ 配置（release 强制开 / 关脱敏）

```yaml
db_trace:
  enabled: true        # 缺省 = dev 自动开 / release 自动关；可强制
  redact_params: true  # 默认 true：日志/画像里 params 只记「参数个数」，不记值（防密码/手机号泄漏）
  slow_ms: 0           # 慢查询阈值(ms)，仅过滤日志与 slow 列表；0 = 全记
  to_log: true         # 是否写 dev 日志
```

### ⑤ 常见坑

| 现象 | 原因 |
|---|---|
| 生产看不到 SQL / 信封无 `_sql` | 追踪 release 默认关——加 `db_trace.enabled: true` |
| `params` 是 `"3 params"` 看不到值 | `redact_params: true` 防泄漏；本地排障设 `false` 打开明文，**切勿在生产开** |
| `db.sqlProfile()` 返回 `{}` | 追踪未开；且画像按请求重置，需在同一个请求内调用 |

---

## 场景 8：302 重定向到 blob 预签名 URL

**什么时候用**：浏览器要直接打开/下载存在对象存储（S3）里的文件（头像、附件、导出报表），
而 bucket 是私有的。不能把永久链接发给前端，也不想让 oj 代理整份字节流（占连接、双倍流量）。
正解：业务路由**先校验权限**，再 302 跳转到 `blob.url()` 给出的**预签名 URL**——
就是带临时签名、过一会儿就失效的直链。浏览器自动跟跳，两跳直取对象，流量不过 oj。

### ① handler

```ts
// src/download/api.ts —— 目录镜像路由：GET {base}/download/
export async function get(): Promise<void> {
  const key = String(http.param("key", ""));
  if (!key) { json.fail(400, "key required"); return; }
  // …权限校验在这里（登录态 / 租户 / 文件归属）——通过后才允许拿签名 URL，
  // 否则等于任何人签出任何人的文件（越权下载）。
  json.redirect.found(await blob.url(key)); // 302 + Location: <AWS4 预签名串>
}
```

### ② 验证

```sh
curl -i 'http://localhost:9778/v1/api/download/?key=a/b.png'
# HTTP/1.1 302 Found
# location: http://127.0.0.1:9000/…/a%2Fb.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&…
# content-type: text/html; charset=utf-8
#
# <a href="http://127.0.0.1:9000/…">Found</a>.   ← RFC 9110 §15.4 注记；浏览器自动跟跳时忽略它
curl -i '<location 值>'   # 第二跳：200，字节数 = 对象大小
```

### ③ 常见坑

| 现象 | 原因 |
|---|---|
| 用 `json.header("Location", …)` + `json.fail(302, …)` 拼 | 能跑通但 body 是**失败信封**（非标准形态）。用 `json.redirect`（v0.1.26）：3xx + `Location` + 标准注记，HEAD 请求 body 为空 |
| 想让客户端改用 GET 再取（如 POST 提交后跳转） | `json.redirect.seeOther(url)`（303）；要保持原方法/请求体用 `temporaryRedirect`（307） |
| 资源永久换了域名/路径 | `movedPermanently`（301）或 `permanentRedirect`（308，方法保持）——SEO 权重会转移 |
| 测出来是 200 且 body 是 HTML | 客户端自动跟随了跳转。curl 加 `-i`（或 `--max-redirs 0`），代码里关跟随，断言**第一跳**的 302 + `location` |
| 传了 code 但不是 3xx（如 `json.redirect(url, 200)`） | op 层一律回落 302——原语杜绝「200 + Location」畸形响应 |

---

## 场景 9：路径参数路由——`_name_` 目录 vs `.route`

**什么时候用**：路由里要带参数（`/user/42` 里的 42）。oj 有两种写法：目录名写成 `_id_`，
或在 handler 上挂 `get.route = "{id}"`。本篇讲两者怎么写、怎么组合。

### ① 路由文件

src 下 `user/_id_/api.ts`：

```ts
function get() {
  json.ok({ id: http.param("id") });
}
export default { get };
```

URL：`/v1/api/user/42` → `{ id: "42" }`。目录段 `_id_`（首尾各一个下划线）即声明
参数，避免 `{}` 进文件路径；深层同理：`user/_id_/item/_sku_/api.ts` →
`/user/{id}/item/{sku}`。

### ② 与 .route 组合

`_id_/api.ts` 内 `get.route = "{sub}"` → `/user/{id}/{sub}`。`.route` 值本身用
matchit 语法（`{name}`）；`_name_` 写进 `.route` 是**字面段**（dev/build 会打 warn）。

### ③ 验证

```bash
curl http://localhost:9778/v1/api/user/42
# → {"code":0,"msg":"ok","data":{"id":"42"}}
```

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| `__x__`/`_a{b}_` 目录没变成参数 | 谓词是整段 `_name_` 且内部名不以 `_` 开头/结尾、不含 `{}`——这两种形态保持字面 |
| 同层 `_aa_/` 与 `_bb_/` 只有一个生效 | 同位异名参数是结构性冲突，后者启动丢弃并告警（与 `.route` 同规则） |
| URL 里写 `_id_` 返回了 `"_id_"` 当 id | 转换后没有静态 `_id_` 路由，`{id}` 把 `_id_` 当实参吃掉 |
| `oj build` 报 `invalid route pattern` | 构建期 pattern 试插校验（v0.1.27）——如 `.route = "{id}.json"`（参数段混字面）在 build 期就失败，不再等到部署启动 |

---

## 场景 10：池化长任务 + cron（v0.1.28）

> 何时用我：写一个每轮被驱动的心跳/对账任务，或按 crontab（cron 时间表，「分 时 日 月 周」
> 五字段）定时跑一段 JS。需要长轮询（一次等几秒以上）的 MQ 消费 → 仍用 §6 的 TLA 写法
> （top-level await：任务文件顶层直接 await，脚本从上往下自己跑）。

### ① 任务文件（命名导出三钩子）

`src/tasks/task_watch.ts`（导出 `loop_body` 即自动走池化，与存量 TLA 任务共存）：

```ts
export async function setup() {
  log.info("watch connected");
}
export async function loop_body() {
  // 每轮被 worker 调用一次；单轮须 < tasks.pool.loop_body_timeout_ms（默认 5s）
  const n = (await kv.get("watch:last")) ?? "0";
  await kv.set("watch:last", String(Number(n) + 1));
}
export async function teardown() {
  log.info("watch down");
}
```

不需要 `tasks.stopping()` 轮询与 `tasks.sleep()`：返回即一轮结束；每轮之间框架按
`tasks.pool.interval_ms`（默认 100ms）sleep 再调下一轮（防空转）；停机时先跑
`teardown` 再退出（teardown 尽力而为，超时不保证跑完）。

### ② cron 清单（脚本式任务）

`src/tasks/task/crontab.yaml`（`tasks.crontab` 配置，默认即此路径；文件与条目路径
都相对 `tasks.dir`）：

```yaml
# 分 时 日 月 周  任务文件（相对 tasks.dir）
*/5 * * * *  ./jobs/report.ts   # 每 5 分钟跑一次 report.ts
30 2 * * 1   ./jobs/backup.ts   # 每周一 02:30
```

cron 文件**不是三钩子任务**——到点整模块跑一次（顶层 await 即执行体，如
`export {}; await kv.set("report:runs", …)`），跑完释放 Worker。命名用普通文件名
（`jobs/report.ts`）：用 `task_*.ts` 会被扫描器同时收编成长任务，同名拒启。
5 字段自研解析（`*/n`、列表、区间；周字段 7=周日）。坏行启动 fail-fast（报错带
`:行号:`）。cron 任务的启停/改表达式走管理面 `enable`/`disable`/`PATCH {cron}`，
**不要**对 cron 任务用 `/start`（400）。

### ③ 管理 API（鉴权/租户头与业务路由同语义）

```bash
BASE=http://localhost:9778/v1/api
curl -H "Authorization: Bearer $TOKEN" "$BASE/tasks"                 # 清单 ?type=long|cron
curl -X POST -H "Authorization: Bearer $TOKEN" "$BASE/tasks/watch/stop"
curl -X POST -H "Authorization: Bearer $TOKEN" "$BASE/tasks/report/run-once"  # 仅 cron
curl -H "Authorization: Bearer $TOKEN" "$BASE/tasks/watch/logs?limit=20"
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
     -d '{"cron":"*/10 * * * *"}' "$BASE/tasks/report"              # 仅接受 {enabled, cron}
```

事件信封 `{eventId, eventType, timestamp, payload}`；内存池 = JSONL 日志
（`tasks.event_log.path`，超 `max_mb` 轮转）+ 1000 条环形缓冲，`logs` 端点读环形缓冲。

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| 跑几轮就 `failed` 再重连 | 单轮 `loop_body` 超 5s 看门狗 → teardown + failed 退避——长轮询任务别用池化 |
| `tasks.stopping()` 在池化任务里恒 false | 池化由 worker 逐轮驱动，无停机轮询语义；要阻塞等待的任务用 TLA 模式 |
| 改 `loop_body` 没生效 | 任务无热重载——管理面 `POST {base}/tasks/{name}/reload` 重连单个任务，或重启进程 |
| `start`/`stop` 对 cron 报 400 | 跨 kind 命令被拒：cron 用 `enable`/`disable`，long 用 `start`/`stop` |
| `run-once` 报 400/409/503 | 对 long 任务报 400（run-once 仅 cron）；任务正在运行 409；本实例无任务池 503（纯 TLA 部署） |
| 任务池 CPU 高 / `runCount` 涨得快 | 轮率由 `tasks.pool.interval_ms` 决定（默认 100ms≈10 轮/s/任务，`0` = 不限制）。实测无节奏 4 任务聚合 24.8 万轮/s、CPU 134%（多核空转）。需要更快先算写放大（轮率 × 每轮 kv/db/日志 IO），并把每轮做成增量（kv 存游标），别全量扫 |
| crontab 改完没反应 | cron 表达式经 `PATCH {base}/tasks/{name}` 改的是注册表；文件仍是重启后的事实源 |

---

## 场景 11：LDAP/AD 登录鉴证（v0.1.28；v0.1.54 起调用面迁移 `axis("ldap")`）

> 何时抄我：登录要校验公司 AD/OpenLDAP 账号；或要按目录分组/属性做授权。
> v0.1.54 起 oj-ldap 是泛型轴插件——JS 调用面为 `axis("ldap").<op>(...)`
> （实例选单经末位 opts 的 `key`）；旧的 `ldap.*`/`LDAP(name)` 类型化全局是遗留
> 双轨面，装配迁移版插件后报 `ldap not configured`。

### ① 配置（config.yaml）

```yaml
ldap:
  default:
    url: ldaps://dc.example.com:636
    bind_dn: cn=svc-oj,ou=service,dc=example,dc=com   # 服务账号：search 前置绑定
    bind_pw: "change-me"
    timeout_ms: 5000
```

装插件：`cargo xtask plugin ldap`（产物 `bin/plugins/<triple>/libldap.dylib`）。
`bind_dn`/`bind_pw` 成对；都不配 = 匿名 search（多数目录拒绝）。

### ② handler：用户名 → DN → bind 鉴证

```ts
// src/user/login/api.ts
const LDAP_FILTER_ESCAPES: Record<string, string> = {
  "\": "\5c", "*": "\2a", "(": "\28", ")": "\29", "\0": "\00",
};
const esc = (s: string) => s.replace(/[\\*()\0]/g, (c) => LDAP_FILTER_ESCAPES[c]);

export default {
  async post() {
    const { username, password } = http.body();
    if (typeof username !== "string" || typeof password !== "string")
      return json.fail(400, "bad request");
    // 1) 查 DN（filter 注入先转义）
    const found = await axis("ldap").search("ou=users,dc=example,dc=com", {
      filter: `(uid=${esc(username)})`,
      attrs: ["uid", "memberOf"],
    });
    // 2) 找不到 / 多命中一律按凭据错处理（不泄露用户存在性）
    if (found.length !== 1) return json.fail(401, "invalid credentials");
    // 3) 用目录凭据绑定；false = 密码错（不抛）
    const ok = await axis("ldap").bind(found[0].dn, password);
    if (!ok) return json.fail(401, "invalid credentials");
    // 4) 发自己的会话票（目录只鉴证，不签发）
    const token = await jwt.sign({
      sub: found[0].attrs.uid[0],
      groups: found[0].attrs.memberOf ?? [],
    });
    json.ok({ token });
  },
};
```

### ③ 验证

```bash
curl -X POST http://localhost:9778/v1/api/user/login/      -d '{"username":"eve","password":"secret"}'
# → {"code":0,...,"data":{"token":"..."}}
```

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| `axis("ldap")` 报 `unknown generic axis 'ldap'` | 插件没装/没进清单，或 ABI 不匹配——`plugins()` / `oj info` 核对 |
| 调旧 `ldap.*` 报 `ldap not configured`（段已配） | v0.1.54 双轨期行为：迁移版 oj-ldap 不再注册 typed 槽——改用 `axis("ldap").<op>`；确需旧面就加载旧版 typed 插件（二者择一） |
| `axis("ldap").bind` 抛 `connect ... io error` | 网络/端口/防火墙；`url` 拼错；非「凭据错」——`false` 才是凭据错 |
| `service bind ... rc=49` | 服务账号 `bind_dn`/`bind_pw` 错了（search 在绑定前就失败） |
| search 报 size limit | AD 默认 1000 条返回上限——改 `axis("ldap").search_paged(base, { pageSize: 500 })` |
| `filter` 查不到人 | DN base 不对（`ou=users,…` 按实际目录改）；`scope` 默认 `sub`，base 之上的条目查不到 |
| 头像/证书拿不到 | 二进制属性在 `entry.bin`（base64 字符串）：`Buffer.from(e.bin.jpegPhoto[0], "base64")` |

---

## 场景 12：一次性数据修复脚本（oj exec，v0.1.29）

> 何时抄我：迁移后对账、一次性数据修复、批处理导出；或定时任务的本地原型
> （验证逻辑后搬进 `src/tasks/` 任务池上生产——exec 无 KillSwitch，不适合常驻）。

### ① 配置

不需要新配置：复用项目现有 `config.yaml`（exec 经 `assemble_backend` 装配完整后端，
db/kv/blob/bus/插件全部可用）。唯一要记的差异：**迁移默认 off**（server dev 缺省
auto，两命令相反）——脚本操作前先确认 `oj migrate` 已跑过。

### ② 脚本（scripts/fix-roles.ts）

```ts
// 一次性修复：role 为空的历史账号补默认角色；--dry-run 只对账不改数据。
const dry = args.includes("--dry-run");
const rows = await db.query("select id, name from account where role is null or role = ''", []);
console.log(`待修复 ${rows.length} 条`);
for (const r of rows) {
  console.log("  fix", r.id, r.name);
  if (!dry) {
    await db.exec("update account set role = ? where id = ?", ["member", r.id]);
  }
}
log.info("done", "fixed", dry ? 0 : rows.length);
```

### ③ 验证

```bash
./bin/oj exec scripts/fix-roles.ts -c config.yaml -- --dry-run   # 先对账（args 含 --dry-run）
# → 待修复 2 条          （console.log 原样 stdout，无级别前缀——v0.1.55 通道分离）
# →   fix 1 neo …
./bin/oj exec scripts/fix-roles.ts -c config.yaml --log-file fix.jsonl   # 真跑 + JSONL 落盘
# 退出码 0 = settle 无异常；脚本 throw → stderr 报 V8 异常，exit 1
# （脚本里的 log.info("done", …) 走 stderr 带 INFO 标签——日志不混进 stdout 管道）
```

### ④ 轻量入口：内联代码与 REPL（v0.1.50）

不想为一次性求值落盘一个 `.ts` 文件时，用 `-e/--code` 直接喂字符串，或 `--repl`
进交互式逐行求值（后端全局同样可用）：

```bash
# 内联代码（TypeScript 语法；自包含、不支持相对 import）
./bin/oj exec -e 'const r = await db.query("select count(*) as c from account", []); console.log(r[0].c);' -c config.yaml

# 交互式 REPL：逐行输入，Ctrl-D / Ctrl-C 退出；顶层绑定不跨行持久，跨行共享须 globalThis.x = …
# 真终端下由 rustyline 接管（方向键 / 行内编辑 / ↑↓ 翻历史，不再回显乱串）；管道输入走普通回放。
./bin/oj exec --repl -c config.yaml
# 裸 exec（v0.1.55）：无 file / -e / --repl 时缺省进 REPL，与 --repl 等价。
./bin/oj exec -c config.yaml
# oj> console.log(await db.query("select 1", []))
```

### ⑤ 常见坑

| 现象 | 原因 |
|---|---|
| `json.ok(...)` 什么都没输出 | exec 里 `json.*`/`finish` 空转（没有 HTTP 消费方）——输出用 `console.log`/`log.*` |
| 脚本拷进 handler 后 `console is not defined` | `console` 仅 exec 运行时提供（server/test 无此全局）——搬回 handler 时删掉 |
| `args` 是空数组 | 透传参数必须在 `--` **之后**：`oj exec s.ts -c config.yaml -- --dry-run` |
| import 报 escapes project root | 相对导入钳制在项目根（config 所在目录）内且须显式扩展名（`import "./util.ts"`）；`import "../x"` 上跳被拒 |
| `-e/--code`、`--repl` 里 `import "./util"` 报找不到 | 内联代码/REPL 无基准目录、不支持相对 import——要复用模块请走 `oj exec <file>` |
| REPL 上 `const x=1` 下一行读不到 | 每行独立模块、作用域隔离；跨行共享须显式 `globalThis.x = 1` |

### ⑥ 零配置与表达式回显（v0.1.60）

**无需 config.yaml**：省略 `-c` 时向上搜索不到即用内置默认，且**不再向 stderr 打
`note: no config.yaml found`**（`oj exec` / `oj info` 同口径；仅 `serve` / `migrate` /
`openapi` 等依赖后端配置的场景保留该提示）。纯计算脚本 `-e '1'` 之类可零配置直接跑。

**`-e` / REPL 默认回显单表达式求值结果**（devtools 风格）：整段是单个顶层表达式语句时
自动包裹 `console.log((<expr>))` 输出其值；多语句 / 声明 / 已显式 `console.log` 不回显
（避免污染输出、不叠打 `undefined`）。

```bash
./bin/oj exec -e '1'                    # → 1（stdout）
./bin/oj exec -e '({a:1})'            # → {"a":1}
./bin/oj exec -e 'await db.query("select 1", [])'   # 顶层 await 保真，回显结果
./bin/oj exec -e 'const x=1; x'        # 多语句：不回显
./bin/oj exec -e 'console.log("x")'    # 已显式打印：仅输出 x，不叠打 undefined
# 无 -c 也能跑（零配置）：
./bin/oj exec -e '1'
```
| `sql_guard: "deny"` 库上查询被拦 | exec 无 HTTP 上下文 = 匿名操作员，且守卫不设防；被 deny 拦的查询加 `await db.asSystem()` |
| 脚本卡死不退 | exec 无超时/KillSwitch——同步死循环只能 Ctrl-C；常驻轮询搬进 `src/tasks/` 任务池 |
| `--log-file` 没生成 | 打开失败只 warn 一次不中断——看 stderr 首行（路径不可写等） |

---

## 场景 13：大文件直传绕开 10MB/30s（v0.1.30）

**什么时候用**：office 附件动辄几十 MB，两条路都会撞墙——`http.file()` 受
`server.max_upload_bytes`（10MB）413；上传后进 handler 解析又撞全局 `server.timeout`
（30s → 408）。直传让**客户端把字节直接送存储**，oj 只经手元信息。

### ① s3 后端：预签名直传

```ts
// src/files/api.ts —— initiate：只发 URL，不碰字节
export default {
  async post() {
    const key = `uploads/${crypto.randomHex(8)}-${http.body.filename}`;
    const { url } = await blob.uploadUrl(key);          // 15min 预签名 PUT
    json.ok({ key, upload_url: url });
  },
};
// 客户端：curl -X PUT --data-binary @big.docx "<upload_url>"
// 定稿后再调一个业务路由把 key 记进表——权限/审计都在元信息层
```

### ② local 后端：直传路由

`blob.uploadUrl` 在 local 会抛 `local blob backend has no upload presign; use the
direct PUT upload route`——用内置直传路由：

```bash
curl -X PUT --data-binary @big.docx \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:9778/v1/api/blob/uploads/report.docx
# 200 {"code":0,...}；上限 server.blob_upload_max_bytes（默认 1 GiB，413 信封）
```

**路由过鉴权守卫**（Bearer/cookie 即令牌），不经 JsActor（无 30s）。下载侧 local
内联自动支持 `Range`（206 + Content-Range；越界 416）——pdf.js/视频 seek 直接可用。

### ③ 常见坑

| 现象 | 原因 |
|---|---|
| PUT 413 | 直传腿看 `blob_upload_max_bytes`（1 GiB），**不是** `max_upload_bytes`；改后者没用 |
| PUT 401 | 直传路由过守卫——头没带或 cookie 过期（WS/cookie 语义见场景 14） |
| `blob.uploadUrl` multipart 报 not supported | s3 插件只预签名单发 PUT（object_store 无 multipart presign API）；>1 GiB 分片是已知限制 |
| 大文件处理仍 408 | 直传只解决**存**字节；解析/转换仍走业务路由——给该路由配 `route_timeouts`（见 §10） |

---

## 场景 14：浏览器登录 cookie 会话 + CSRF（v0.1.30；双 cookie 双发 v0.1.46）

**什么时候用**：Web 前端登录。Bearer token 存浏览器哪都是问题（localStorage 被
XSS 拖走）；httpOnly cookie + 双提交 CSRF 是浏览器安全模型正解。CLI/MCP 继续 Bearer。

### ① 配置

```yaml
auth:
  jwt_secret: "change-me"
  anonymous_paths: ["/auth/**"]        # login/logout 端点必须匿名（业务路由，不是内置路由）
  cookie:
    enabled: true
    same_site: Lax                     # 跨站前端改 None + secure: true
    # name/same_site/secure/ttl_secs/csrf_cookie/csrf_header 均有缺省，见 §8
```

### ② 登录端点（签发是业务职责；sample/src/auth/ 有参考实现）

```ts
// src/auth/login/api.ts
export default {
  post() {
    const { username, password } = http.body;
    const row = db.table("users").where("username", username).first();
    if (!row || !bcrypt.verify(password, row.password_hash)) json.fail(401, "invalid credentials");
    const token = jwt.sign({ sub: row.id, roles: JSON.parse(row.roles) }, { expiresIn: 86400 });
    // v0.1.46 起同名头可重复：两枚 cookie 同响应双发（此前响应头单值，csrf 只能
    // 经 body 下发 + 前端写 document.cookie）。oj_csrf 非 HttpOnly——双提交要 JS 读得到。
    json.header("set-cookie",
      `oj_sess=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    json.header("set-cookie",
      `oj_csrf=${crypto.randomHex(16)}; SameSite=Lax; Path=/; Max-Age=86400`);
    json.ok({ user: { id: row.id, roles: JSON.parse(row.roles) } });
  },
};
```

### ③ 前端约定

会话 cookie 浏览器自动带（WS 握手也是——**WS 升级过同一守卫**，401 不升级）。
非 GET/HEAD/OPTIONS 请求做**双提交**：`x-csrf-token` 头 = `oj_csrf` cookie 值
（cookie 非 HttpOnly，前端从 `document.cookie` 读）：

```ts
const csrf = document.cookie.match(/(?:^|;\s*)oj_csrf=([^;]*)/)?.[1] ?? "";
fetch("/v1/api/doc/save", { method: "POST", headers: { "x-csrf-token": csrf } });
```

守卫判定序：匿名 → Bearer → cookie 会话（cookie 值 = 同 secret 的 JWT，过期/篡改统一
401 `missing or invalid bearer token`）→ cookie 会话的非安全方法再查 CSRF 头与
csrf cookie 相等，否则 401 `missing or invalid csrf token`。Bearer 命中的请求不查 CSRF。

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| GET 通、POST 401 `missing or invalid csrf token` | 双提交缺头/值不等；确认登录响应真的双发了 `oj_csrf`（< v0.1.46 响应头单值，第二个 `json.header("Set-Cookie", …)` 会**覆盖** `oj_sess`——cookie 登录直接坏，升级 oj）；前端从 `document.cookie` 读值回传 |
| 登录后只有 `oj_csrf` 没有 `oj_sess` | 同上：宿主版本 < v0.1.46 的单值覆盖 |
| 升级 v0.1.30 后 WS 连不上（401） | **行为变更**：WS 握手过守卫了——ws 路径加 `anonymous_paths`（浏览器 cookie 形态自动过） |
| SameSite=Lax 跨站 POST 不带 cookie | 跨站前端要 `SameSite=None; Secure`（HTTPS） |
| logout 后还能访问 | access JWT 在 cookie 过期前仍有效——短 `ttl_secs` 或维护服务端黑名单 |

---

## 场景 15：WS 房间广播 / presence（v0.1.30）

**什么时候用**：协作文档的房间消息、在线人数、抢锁通知。此前只有 `bus.publish`
（按 topic 全扇出、自己也能收到），房间是**连接分组**语义：join/broadcast/leave。

### ① ws.ts 生命周期钩子

```ts
// src/room/ws.ts —— 目录镜像路由即 WS 端点
export function connection() {
  ws.join(`doc:${sess.state.docId}`);        // 连接身份自动取；断连自动摘除
  ws.broadcast(`doc:${sess.state.docId}`, JSON.stringify({ type: "presence", size: ws.roomSize(`doc:${sess.state.docId}`) }));
}
export function message() {
  const m = JSON.parse(http.body);            // 注意：WS 文本帧 http.body 是已解析的 JSON 值，别再 JSON.parse
  ws.broadcast(`doc:${m.docId}`, JSON.stringify({ from: sess.id, op: m.op }));
}
```

```ts
// src/room/status/api.ts —— HTTP 也可查/可发
export default {
  get() {
    json.ok({ online: ws.roomSize(`doc:${http.param("id", "")}`) });
  },
};
```

### ② 语义速记

- `ws.broadcast(room, data)` → 送达数，**除己**（socket.io 语义）——发送者要回声自己就在
  JS 里补发；`bus.publish` 是含己自回声，两者别混。
- 房间是**进程内**单例：多实例部署的跨机扇出仍走 `bus.publish`（rooms 单机房够用）。
- HTTP handler 调 `broadcast` 不排除任何人（无连接身份），适合服务端系统通知。

### ③ 常见坑

| 现象 | 原因 |
|---|---|
| `ws.join` 报错 / 无效果 | join/leave 仅 ws.ts 生命周期钩子内可用；HTTP 路径没有连接身份 |
| 断线重连后房间成员没清 | 不会——所有退出路径自动摘除；presence 以 roomSize 为准别自建计数 |
| broadcast 返回 0 | 房间没人（join 未生效或成员已断）；诊断先查 `ws.roomSize` |

---

## 场景 16：带 `exports` 的包与 pnpm 布局（v0.1.30）

**什么时候用**：引入现代 npm 包（`exports` 条件导出的 ESM 包、pnpm 安装的项目）。
v0.1.30 起解析完整对齐 Node：`exports` 封闭语义 + pnpm 符号链接布局 + CJS 相对 require。

### ① 直接可用

```ts
import { parse } from "fast-xml-parser";      // exports 条件导出（import 条件命中）
import pdfLib from "pdf-lib";                  // ESM/CJS 混合包（相对 require 链已支持）
import { thing } from "@scope/pkg/sub";        // 子路径 exports 键
```

- pnpm 安装无需特殊配置：解析全程不 realpath，`.pnpm/<pkg>@<ver>` 符号链接视图直读。
- CJS 包内 `require("./sib")` / `require("./data.json")` 可用；循环 require 返回部分
  exports（Node 语义）。

### ② 报错对照

| 报错 | 含义 |
|---|---|
| `Package subpath 'x' is not defined by "exports" in <pkg>/package.json` | 有 `exports` 即封闭语义：该子路径未导出，**不回落** `main`/`module`（Node 一致）。查包文档的真实导出键 |
| `Node builtin 'path' is not available in oj runtime` | 该包引了 Node 内建——找其 browser/wasm 构建（同场景 17） |
| 相对 require 报 escapes project root | `../../` 越出项目根被钳——包应装在其 node_modules 内，别手工指外 |

### ③ 仍不支持的（v0.2 已知限制）

`exports` 的 `types`/`browser` 条件不命中（取 import/require/node/default）；CJS 的
`module.exports = function(){...}` 替换式启发式识别可能漏。`oj build` 依旧不打包
node_modules——发布物自带（场景表「npm 依赖不打包进 tgz」）。

---

## 场景 17：wasm 引擎包进 oj runtime（v0.1.30）

**什么时候用**：评估把 PDF/字体/shaping 等 wasm 引擎包（pdfium/harfbuzzjs/pdf-lib 类）
跑进 oj runtime，替代独立 Node worker。

### ① 已验证可用的胶水面

`WebAssembly.instantiate`（V8 内建，L1 实测）+ `atob`/`btoa`（标准 base64）+
`crypto.getRandomValues(view)`（任意 TypedArray，≤65536 字节/次）——wasm-bindgen 胶水
的三件套已齐。`TextDecoder`/`fetch` 等 Web 面此前已有。

### ② 引擎包兼容性清单（逐包勾选，避免凭记忆重验）

| 检查项 | 通过条件 |
|---|---|
| 解析 | 包的 `exports`/`main` 能被场景 16 的解析命中（L1：`import` 即通） |
| wasm 实例化 | 包内 `*.wasm` 内嵌或经 URL 加载——内嵌字节走 `WebAssembly.instantiate(bytes)` 必通 |
| Web API 面 | grep 包产物对 `atob`/`crypto.getRandomValues`/`TextDecoder`/Node 内建的引用：内建引用 → 需要 browser/wasm 构建 |
| 运行冒烟 | L1 用例：包的最小调用链在 `oj test` 内跑通 |

### ③ 常见坑

| 现象 | 原因 |
|---|---|
| 胶水报 `atob is not defined` / `getRandomValues is not defined`（旧版 oj） | v0.1.30 前无这两个全局——升级；之后仍报说明包引了别的 Web API，按清单补 |
| `Node builtin 'fs' is not available` | 包用了 Node 构建——换其 browser/esm 入口（看 package.json `exports` 的 browser 条件；oj 不命中 browser 条件时可试包提供的显式 browser bundle 路径） |
| wasm 字节从哪来 | 多数包把 wasm base64 内嵌进 JS（正好走 `atob`）；独立 `.wasm` 文件经 `fetch(相对/绝对 URL)` 或 `blob.get` 取字节再 instantiate |

---

## 场景 18：config 里的密码不落明文（v0.1.33）

**什么时候用**：`config.yaml` 要进 git / 进镜像 / 发工单附件，里面有 db DSN、redis URL、
smtp 密码、ldap `bind_pw`、`auth.jwt_secret`、`oidc` 的 client secret。

### ① 一次性：生成密钥对

```bash
# 信封只有一种：X25519 + AES-256-GCM，密文长度≈明文+62B（短密码也紧凑）
./bin/oj secret keygen --out-dir keys
# keys/secrets-private.pem（600，只放部署机）+ keys/secrets-public.pem（可进仓库）
echo 'keys/secrets-private.pem' >> .gitignore   # 私钥绝不进仓库
```

### ② 加密：明文 → `ENC[…]`

```bash
# 走 stdin（推荐）：命令行参数会进 shell history 与 ps
echo -n 'mysql://root:hunter2@127.0.0.1:3306/app' | ./bin/oj secret seal -k keys/secrets-public.pem
# → ENC[Ab3…]  （同一明文每次不同：X25519 临时公钥 + 随机 nonce 保证密文不可重放）
```

### ③ 写进 config

```yaml
secrets:
  private_key_path: keys/secrets-private.pem   # 相对 config 目录

db:
  default: "ENC[Ab3…]"        # 整条 DSN 一起封，不用拆密码字段
redis:
  default: "ENC[Cd9…]"
auth:
  jwt_secret: "ENC[Ef1…]"
ldap:
  default:
    url: ldap://dc.example:389
    bind_dn: "cn=admin,dc=example,dc=com"
    bind_pw: "ENC[Gh2…]"      # 不透明段里同样支持
```

### ④ 验证

```bash
./bin/oj secret open -c config.yaml 'ENC[Ab3…]'   # 应打出原明文（走与启动同一条私钥通道）
./bin/oj serve -c config.yaml --api-path src      # 起得来即装配通过
```

### ⑤ 常见坑

| 现象 | 原因 |
|---|---|
| 启动报 `config has ENC[...] sealed values but no decryption key` | 部署机没给私钥：`OJ_SECRET_KEY`（内联 PEM）/ `OJ_SECRET_KEY_FILE`（路径）/ `secrets.private_key_path` 三选一 |
| `aes-gcm open failed (wrong private key?)` | 私钥和加密用的公钥不是一对（换机器只拷了 config）；**不会**静默降级成把密文当明文 |
| `sealed value is v1 (RSA) — v1 信封已移除` | 手头是旧版 RSA(v1) 密文，新版已不再支持；用 `oj secret seal` 以 X25519 重新加密（v1 无人使用，已整体移除以避免密钥配置歧义） |
| 换了密钥对，老密文解不开 | 轮换须用**新公钥重封全部密文**——旧私钥解不了新密文，反之亦然 |
| 想把私钥也塞进 config | 别：那等于把钥匙和锁放同一张纸。私钥留在部署机，config 只放**路径** |
| 日志里看到 `mysql://***@127.0.0.1:3306/app` | 正常——错误与 warn 里的 DSN/URL 凭据段一律打 `***`（v0.1.33） |

完整手册（威胁模型、密文格式、轮换与迁移步骤）见仓库 `docs/secrets.md`。

---

## 场景 19：一份配置多源资源，按需选源（v0.1.34）

**什么时候用**：你有一份 `config.yaml`，里面同时声明了多套资源——
比如生产库 `default` + 报表库 `report`（db）、主 redis + 缓存 redis、多个 s3 bucket、
es 只读副本、kafka 测试集群 vs 生产集群。你想用**同一条** `oj test` / `oj exec`
对不同的源跑脚本或用例，而不用复制多份 config。

**核心机制**：配置段本来就是命名 map（`db` / `redis` / `blob.backends` / `kafkas` /
`rabbits`），`es` / `broker` 在 v0.1.34 起也放宽成命名 map（旧的单对象写法
`es: { endpoint: ... }` 自动包成 `{ default: ... }`，完全兼容）。CLI 用
`--<key> <profile>` 把某个命名 profile 选为「默认源」，装配期把它别名为字面
`"default"`——于是 JS 侧 `redis()` / `blob()` / `es()` / `bus()` / `kafka("default")` /
`rabbit("default")` **一行代码都不用改**就指向选中源。`--db` 语义不变（请求期重定向）。

### ① 配置（多源都在一份 config 里）

```yaml
db:
  default: "ENC[...]"          # 开发库
  report:  "ENC[...]"          # 报表库
redis:
  default: "redis://:pw@h:6379/0"
  cache:  "redis://:pw@h:6379/1"
blob:
  backends:
    default: { driver: local, root: ./data/blob }
    assets:  { driver: s3, bucket: assets-bkt, region: r }
es:
  default:  { endpoint: http://localhost:9200 }
  archive: { endpoint: http://es-archive:9200 }
broker:
  default: { kind: kafka, brokers: ["k:9092"] }
kafkas:
  default:  { bootstrap: ["k:9092"] }
  staging:  { bootstrap: ["k-stg:9092"] }
rabbits:
  default:  { url: amqp://guest:guest@r:5672 }
```

### ② 选源跑

```bash
# 测试默认落 db.test（等同旧行为）；其余资源走各段 default
./bin/oj test -c config.yaml -d sample/src

# 报表库 + 缓存 redis + 归档 es 一起选源，handler 不改代码
./bin/oj test  -c config.yaml -d sample/src --db report --redis cache --es archive
./bin/oj exec  scripts/fix.ts -c config.yaml --db report --redis cache --es archive
./bin/oj exec  scripts/backfill.ts -c config.yaml --kafka staging
```

### ③ 验证

启动日志会打印选源提示（如 `oj: default db redirected to "report"`）；
未声明的 profile 直接 fail-fast（列出可用 profile），**不会静默回落 default**——
这点和 `oj migrate --db` 一致，目的都是防止误用开发库/错后端。

### 常见坑

- `--<key>` 的 profile 名是 config 段里的**键名**，不是任意字符串；写错会报
  `profile 'X' not declared (available: [...])`，按列表核对。
- `db` 的 `--db` 是**请求期**重定向（字面 `default` 调用改指向），与其他轴「装配期别名」
  实现不同但效果一致：handler 里 `db.default()` / `redis()` 等都指向选中源。
- 多个 redis profile 只会有**一个**被装配（选中的那个）；其余在日志里 warn 忽略。

---

## 场景 20：流式响应 / SSE 实时推送（v0.1.35）

**什么时候用**：导出大 CSV / 流式转码 / 长列表分块吐给前端（避免一次性把全部内容攒进
内存再返回）；或 server-sent events 把进度、通知、日志实时推到浏览器（`EventSource`）。

> 流式响应**绕过** `{code,msg,data}` 信封——直接写裸 body。需要结构化业务响应仍走
> `json.ok` / `json.fail`。

### ① handler（流式 CSV）

```ts
export default {
  get() {
    const s = json.stream({ contentType: "text/csv" });
    s.write("id,name\n");
    for (let i = 0; i < 1_000_000; i++) s.write(`${i},row${i}\n`);
    s.end();                       // 显式关流；不调用也会在 read_capture 阶段自动关闭
  },
};
```

### ② handler（SSE）

```ts
export default {
  get() {
    const e = json.sse();          // Content-Type 自动 text/event-stream
    e.write("hello");              // 自动包成 data: hello\n\n
    e.write("world");              // data: world\n\n
    // 不调用 end() 也行——handler 退出后连接保持，read_capture 接管后关流
  },
};
```

### ③ 验证

```bash
curl -N http://localhost:9778/v1/api/report/export/   # -N 关闭缓冲，看到分块/逐帧到达
# SSE：浏览器 new EventSource(url) 监听 message；或 curl -N 看 data: ...\n\n 帧
```

### ④ 常见坑

| 现象 | 原因 |
|---|---|
| 前端拿到的是 `{code,msg,data}` 而非裸流 | 用了 `json.ok`——流式必须 `json.stream` / `json.sse`，二者绕过信封 |
| 流「卡住」不结束 | 没调用 `end()` 且连接被前端一直保持——`read_capture` 在 handler 退出后接管并关流；若想显式结束务必 `end()` |
| SSE 客户端收不到 | 用了 `json.stream` 但没按 `data: X\n\n` 帧格式——要自动帧化用 `json.sse`；心跳保活间隔 15s（`:\n\n`），静默超 15s 的连接可能被代理掐断 |
| `opts` 想设 `event:`/`id:` 字段 | 不支持——`opts` 仅 `status` / `contentType`；自定义 SSE 字段自己拼进 `write("event: x\ndata: y\n\n")` |
| 想边查库边流 | handler 内可正常用 `db`/`kv`；但通道在 handler 返回后才继续推——重活尽量在 `end()` 之前做完 |

---

## 场景 21：前端跨域调用 oj API（CORS，v0.1.35）

**什么时候用**：浏览器里的前端（另一个 origin）要 `fetch` oj 的 API。同源不用配；跨源
不配会直接被浏览器拦（`CORS` 头缺失）。

> `server.cors` 段**存在即启用**；段缺失（缺省）则不挂 CORS 层，行为与旧版完全一致
> （响应无 `Access-Control-*` 头）。预检（OPTIONS）由 `tower-http::cors` 在路由前短路，
> 业务 handler 不感知。

### ① 配置

```yaml
server:
  cors:
    origins: ["https://app.example.com"]   # 非空：精确匹配；为空 → 允许任意源
    methods: ["GET", "POST"]
    headers: ["x-foo"]
    expose:  ["x-request-id"]
    credentials: false                     # true 必须配 origins（否则启动 fail-fast）
    max_age: 600
```

### ② 验证

```bash
# 预检
curl -i -X OPTIONS http://localhost:9778/v1/api/u/f/ \
  -H 'Origin: https://app.example.com' -H 'Access-Control-Request-Method: GET'
# → 含 Access-Control-Allow-Origin / Access-Control-Allow-Methods
# 简单请求：带 Origin 的 GET 响应头里出现 Access-Control-Allow-Origin
```

### ③ 常见坑

| 现象 | 原因 |
|---|---|
| 启动直接报错退出 | `credentials: true` 且 `origins` 为空——带凭据的 `*` 非法，浏览器拒绝；配显式 origins 即可 |
| 响应里没有 `Access-Control-*` 头 | `server.cors` 段没写（缺省不挂层）——与旧版行为一致；确认 config 段存在 |
| 预检 404 / 进了业务 handler | 不会——`tower-http::cors` 在路由前短路 OPTIONS；handler 永远看不到预检 |
| `origins: ["*"]` 不生效 | 写 `*` 字符串不会按通配展开——要放行任意源就把 `origins` 留空（空列表 = `AllowOrigin::any`） |

---

## 场景 22：应用层 AES-GCM 字段加密（v0.1.35）

**什么时候用**：你要对落库 / 传输前的敏感字段做对称加密（手机号、token、支付信息…），
但密钥不想进 config、不想托给插件——纯应用层、调用方自管密钥。典型：把字段加密后存进
db，或把密文经 `json.ok` 返回前端（前端持密钥再解）。

**红线先说**：`crypto.aesGcmEncrypt` / `crypto.aesGcmDecrypt` 是**纯原语**——密钥由你从
`vars.get(...)`（可被 `ENC[...]` 密封）或别的安全通道传入，op 不耦合 config、不托管密钥。
**密钥泄露 = 数据泄露，密钥管理归你。**

### ① 密钥（16 / 32 字节原始密钥，hex 或 base64）

```ts
// 32 字节（AES-256）原始密钥，hex 编码；可塞进 config.vars 并用 ENC[...] 密封
const KEY = vars.get("APP_FIELD_KEY")!;   // 如 "001122…ff"（32 字节 → 64 hex 字符）
```

> 密钥只支持 16 字节（AES-128）或 32 字节（AES-256）的 hex / base64；**不支持 AES-192**
> （上游 crate 未 re-export），传 24 字节密钥会直接报错。

### ② handler（加密后落库）

```ts
export default {
  async post() {
    const KEY = vars.get("APP_FIELD_KEY")!;
    const phone = http.param("phone", "");
    if (!phone) return json.fail(400, "phone required");

    // 应用层加密：输出 base64(nonce12 ‖ ciphertext ‖ tag16)，每次密文都不同（随机 nonce）
    const ct = crypto.aesGcmEncrypt(phone, KEY);

    await db.table("user").insert({ name: http.param("name", ""), phone_enc: ct }).exec();
    json.ok({ ok: true });
  },
};
```

### ③ handler（读出后解密返回）

```ts
export default {
  async get() {
    const KEY = vars.get("APP_FIELD_KEY")!;
    const rows = await db.table("user")
      .select(["phone_enc"])
      .where({ field: "id", op: "eq", value: http.param("id", "") })
      .all();
    if (!rows.length) return json.fail(404, "not found");
    const phone = crypto.aesGcmDecrypt(rows[0].phone_enc, KEY);  // GCM tag 校验失败即抛错
    json.ok({ phone });
  },
};
```

### ④ 验证

```bash
curl -s -X POST 'http://localhost:9778/v1/api/user/enc/' -d 'name=alice&phone=13800000000' | head -c 200
curl -s 'http://localhost:9778/v1/api/user/enc/?id=1' | head -c 200
# 密文形如 base64，长度 ≈ 明文 + 12(nonce) + 16(tag)，短明文也紧凑（不似 RSA 信封被撑大）
```

### ⑤ 常见坑

| 报错 | 原因 |
|---|---|
| `aes key must be 16/32 raw bytes (AES-192/24-byte not supported; got 24)` | 传了 24 字节密钥——AES-192 不支持；改用 16 或 32 字节 |
| `key not hex/base64: ...` | 密钥既不是偶数长全 hex、也不是合法 base64——检查编码与换行/空格（已 `trim`） |
| `aes-gcm decrypt failed: ...` | GCM tag 校验失败：密文被篡改，或用的不是加密时的同一把密钥 |
| `ciphertext not base64: ...` / `ciphertext too short` | 解密入参不是 `aesGcmEncrypt` 的输出（缺 nonce 段，或已被二次 base64） |
| `plaintext not utf8: ...` | 解密成功但原明文不是 UTF-8——本 op 只回字符串；二进制请用别的通路 |
| 密钥硬编码在 handler 里 | 别——进 config `vars:` 段并用 `ENC[...]` 密封（`vars.get` 读取），密钥管理归你 |

---

## 场景 23：大表流式导出（db.stream，v0.1.37；v0.1.38 起插件后端真流式）

**什么时候用**：你要遍历一张大表（导出 CSV / ETL / 批量重算），如果 `db.query` 一次性把全量拉进
内存，结果集越大越容易撑爆 handler 内存、或撞上信封体积上限。`db.stream` 逐行拉取，常驻内存只
一行，配合 `json.stream` 边收边推，毫无压力。

**红线先说**：Phase A 仅 **核心 `SqlxAccessor`**（sqlite / mysql / postgres，经 `Any` 驱动）支持真
流式；在 `db.tx` 内调用、或后端是插件（`oj-db-*` FFI）时都会直接报错（详见 `api-manual.md` §6 db
节 `db.stream` 与 §13 已知限制全表）。内容与 `db.query` 全量**一致**，差异只在内存形态。

### ① handler（CSV 流式导出）

```ts
export default {
  async get() {
    // 开裸 body 流（绕过 {code,msg,data} 信封），content-type 设 CSV
    const s = json.stream({ contentType: "text/csv" });
    s.write("id,name,email\n");
    // onRow 回调逐行触发，可自由 await（这里只写一行）
    await db.stream(
      "select id, name, email from account order by id",
      null,
      { onRow: (row) => s.write(`${row.id},${row.name},${row.email}\n`) },
    );
    s.end();   // 流走完后再 end，客户端收到完整 CSV
    return;    // 注意：流式响应已接管 body，不要再 json.ok/json.fail
  },
};
```

### ② 异步迭代器形态（逃生舱）

```ts
export default {
  async get() {
    const ids: number[] = [];
    for await (const row of db.stream("select id from account order by id")) {
      ids.push(row.id as number);
    }
    // ids 现在装全表 id——若表极大、仍需聚合/落库，优先用 ① 的回调边收边处理
    json.ok({ count: ids.length });
  },
};
```

### ③ 中途取消（够用即停）

```ts
const ac = new AbortController();
await db.stream(
  "select * from huge_table order by id",
  null,
  {
    signal: ac.signal,
    onRow: (row) => {
      if ((row.id as number) > 1_000_000) ac.abort();   // 拉到一百万行就停
    },
  },
);
```

### ④ 验证

```bash
curl -s 'http://localhost:9778/v1/api/account/export/' | head -c 200
# 输出形如：id,name,email\n1,alice,a@x.com\n2,bob,b@y.com\n…
# 大表下内存平稳（不随结果集增长），响应流式到达（首行先到）
```

### ⑤ 常见坑

| 报错 / 现象 | 原因 |
|---|---|
| `db.stream within an active transaction is not supported (streaming queries run on the connection pool only)` | 在 `db.tx(...)` 回调里调用了 `db.stream`——流式只走直连池。先 `db.query` 取 id 集再在 tx 内逐条处理，或把流式放到 tx 外 |
| `db.stream` 在第三方插件后端上"能跑但不省内存" | 该插件未实现 ABI 10 流式槽（open 哨兵 `{"unsupported":true}`）→ 宿主静默回落 `db.query` 全量。第一方 `oj-db-mysql`/`oj-db-postgres`（v0.1.38 起）真流式 |
| 取消不是立即生效（插件后端） | 插件取消是**协作式**（批间生效）：`stream_cancel` 置标志后，下一批返回 `{"error":"cancelled"}`；core 后端 = 中途 drop（best-effort） |
| 写了 `json.ok(...)` 又 `json.stream` | 流式响应已接管 body，二者互斥——用了 `json.stream` 就别再 `json.ok/fail`，handler 直接 `return` |
| `for await` 拿到的 `row` 是 `undefined` | 流结束哨兵是 `null`，但迭代器形态已为你消化；直接在循环体用 `row` 即可，不要等 `undefined` |
| 取消后已处理的行「回滚」了 | `signal` 只中止**后续拉取**，已回调/已迭代的行不会回滚——取消前的数据已是最终态 |

---

## 相关文档

- `api-manual.md` —— 完整 API 手册（13 章）
- `docs/exec-integration.md`（仓库）—— `oj exec` 集成手册（场景 12 的机制与差异全解）
- `docs/tenant-guide.md`（仓库）—— 多租户白话指南
- `docs/testing.md`（仓库）—— L1/L2 两层测试选型
- `docs/mail-smtp.md`（仓库）—— 邮件投递完整手册

## 场景 24：给 handler 加一层入参契约（`.schema`，v0.1.44）

不想在每个 handler 里手写校验，又不想让脏数据进到业务代码。

### ① handler 上挂 `.schema`

```js
// src/order/_id_/api.ts  →  GET/POST /v1/api/order/{id}
function get() {
  const { id } = http.params;
  const { page } = http.query;
  json.ok({ id, page });
}
function post() {
  const { name } = http.body;
  json.ok({ created: name });
}

// 路径段 id：声明 integer，运行期强转，转不动即 400；query.page 同理带最小约束
get.schema = {
  params: { type: "object", required: ["id"], properties: { id: { type: "integer", minimum: 1 } } },
  query:  { type: "object", properties: { page: { type: "integer", minimum: 1 } } },
};
// body：声明对象 + 必填字段；additionalProperties:false 会拒掉未声明字段
post.schema = {
  body: {
    type: "object",
    required: ["name"],
    additionalProperties: false,
    properties: { name: { type: "string", maxLength: 20 } },
  },
};

export default { get, post };
```

### ② 验证

```bash
# GET 路径段强转：abc 不是 integer → 400（校验在进 JS 之前，get 不执行）
curl -s 'http://localhost:9778/v1/api/order/abc'
# → HTTP 400 {"code":400,"msg":"params.id: expected integer, cannot parse \"abc\"","data":null}

# GET 查询参数越界：page 最小 1 → 400
curl -s 'http://localhost:9778/v1/api/order/5?page=0'
# → HTTP 400 {"code":400,"msg":"query.page: must be >= 1","data":null}

# POST 缺必填字段 → 400（多传未声明字段也会被 additionalProperties:false 拒）
curl -s -X POST 'http://localhost:9778/v1/api/order/5' -H 'content-type: application/json' -d '{}'
# → HTTP 400 {"code":400,"msg":"body: missing required field `name`","data":null}
```

### ③ 常见坑

- 关键字只在白名单内受支持，越界即**启动失败**（不会到运行期才炸）。
- `pattern` 是 Rust regex 语义，不是 JS 正则（lookahead/反向引用不支持，非法即装配期报错）。
- `params` / `query` 是字符串来源，声明 `integer`/`number`/`boolean` 时**显式强转**，转不动即 400；`body` 是真 JSON，**不**强转。
- 契约与路由 pattern 不一致时 `oj openapi` 会报错（两边必须双向对齐）。

## 场景 25：大文件搬运与区间读（blob.copy / move / readRange，v0.1.47）

上传完成（尤其 v0.1.38 的流式大文件）后要「把临时对象转正」，顺带判定文件类型——
**别让字节进 V8**：`blob.get` + `blob.put` 是整份字节过桥（100MB 文件 ≈ 2× 峰值），
`blob.get` 全文只为嗅探前 4KB 更是纯浪费。

### ① handler

```ts
// src/files/complete/api.ts  →  POST /v1/api/files/complete
export default {
  async post() {
    const { key, id } = http.body;                       // 流式落盘的临时 key
    const dst = `docs/${id}/${key.split("-").pop()}`;
    // ① 嗅探：只读前 4KB，不碰全文
    const head = await blob.readRange(key, 0, 4096);
    const isText = !head.some((b) => b === 0);           // 含 NUL 视为二进制
    // ② 搬运：服务端 rename / CopyObject，字节不过桥（src 转正后即消失）
    await blob.move(key, dst);
    const body = isText ? new TextDecoder().decode(await blob.get(dst)) : "";
    db.table("file").insert({ id, key: dst, body, binary: !isText }).save();
    json.ok({ key: dst, url: await blob.url(dst), binary: !isText });
  },
};
```

### ② 验证

```bash
# 4KB 嗅探：大文件只读前 4096 字节（短读截断：越尾只给实际字节，offset 过尾给空数组）
curl -s -X POST http://localhost:9778/v1/api/files/complete \
  -H 'content-type: application/json' -d '{"key":"uploads/1-0-big.pdf","id":7}'
# → {"code":0,"data":{"key":"docs/7/big.pdf","binary":true,"body":""}}

# 落盘结果：临时 key 已消失（move 语义），目标 key 可读
curl -sI http://localhost:9778/v1/api/blob/docs/7/big.pdf | head -1   # 200
curl -sI http://localhost:9778/v1/api/blob/uploads/1-0-big.pdf | head -1  # 404
```

### ③ 常见坑

| 坑 | 说明 |
|---|---|
| 用 `blob.get` + `blob.put` 搬运 | 整份字节过 V8（2× 峰值瞬态）；换 `blob.move`（src 消失）/ `blob.copy`（src 保留） |
| 以为 `blob.copy` 之后 src 没了 | `copy` 保留 src、`move` 才删 src；`src == dst` 两者都是 no-op |
| 假设 `readRange` 一定拿满 `len` | 短读截断：越尾只给实际剩余字节、`offset` 过尾给空数组——先判 `head.length` |
| `readRange` 报 `offset must be a non-negative integer` | `offset` / `len` 传了负数、小数或 NaN（不静默取整） |
| 后端不支持时静默变慢 | 宿主会回落（`copy` → `get`+`put`、`readRange` → `get` 全量切片），JS 不报错但字节过桥；local/s3 均原生支持，回落只是第三方后端的保险 |

## 场景 26：handler 读写服务器本地文件（fs，v0.1.53）

> 何时用：配置/模板落盘、导出 JSON/CSV 到服务器目录、读取本机生成的文件。
> 大文件（GB 级）不要用 fs——一次性 API 整体进内存，走 blob（场景 25）。

### ① 配置

```yaml
fs:
  root: ./data     # jail 根（相对 config.yaml 所在目录；不存在/非目录 → 启动 fail-fast）
  readonly: false  # 只读模板目录场景设 true，写 API 全拒
```

### ② handler

```ts
// src/fsdemo/api.ts —— 目录镜像路由 /v1/api/fsdemo/
async function post() {
  await fs.mkdir("exports", { recursive: true });
  await fs.writeTextFile("exports/note.txt", "hello " + Date.now());
  const st = await fs.stat("exports/note.txt");
  json.ok({ size: st.size });
}
async function get() {
  const names: string[] = [];
  for await (const e of await fs.readDir("exports")) names.push(e.name);
  json.ok({ names, text: await fs.readTextFile("exports/note.txt") });
}
export default { get, post };
```

### ③ 验证

```bash
curl -s -X POST http://localhost:9778/v1/api/fsdemo/        # {"code":0,"data":{"size":…}}
curl -s http://localhost:9778/v1/api/fsdemo/                # {"code":0,"data":{"names":[…],"text":"hello …"}}
cat data/exports/note.txt                                   # jail 根下真实落盘
```

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| `fs.*` 报 `NotCapable` | 未配置 `fs:` 段（fail-closed）；或路径越出 `fs.root`（`..`、root 外绝对路径、root 内 symlink 指向外部一律拒）；或 readonly 下调用写 API |
| 相对路径找不到文件 | 相对路径解析到 **fs.root 之下**，不是进程 cwd |
| `fs.readDir` 当数组用 | 返回异步迭代器：`for await (const e of await fs.readDir(p)) e.name` |
| 想要 `open`/`read`/`write` 流式 | v1 不暴露 fd 句柄（防池化 runtime 跨请求 fd 泄漏）——大文件走 blob，流式导出见场景 23 |
| 想读写 jail 外的系统路径 | 不支持：jail 是安全边界。确需访问请把目录挂进 root（symlink 到外部会被 canonicalize 判越界，勿用） |

多文件批量上传（multipart 同名字段重复/多字段名混合）照抄见
`docs/api/19-fs.md`「multipart 多文件批量上传落盘」——循环 `http.files` +
`await http.file(i)` 逐个落盘，文件名先白名单化。

---

## 场景 27：泛型轴插件调用——`axis(name)`（v0.1.54）

> 何时抄我：装了一个声明**泛型轴**的插件（如 oj-ldap 迁移版、`tools/plugin-template`
> 做的 cache 轴），handler 里要调它的 op。泛型轴不占 9 个类型化轴槽、零 ABI 变更——
> 插件作者侧范式见仓库 `tools/plugin-template/README.md`。

### ① 装配（config.yaml）

```yaml
plugins:
  cache: {}        # 严格清单模式（或留空走扫描模式）
cache:             # 插件自报 config key（入口宏 config: "cache"）→ 全量段透传进 init
  max_entries: 1000
```

装插件：`cargo xtask plugin cache`（产物进 `bin/plugins/<triple>/`）。
装配后 `oj info` 的 `generic_axes` 段应列出 `cache`；没列出就是没装上。

### ② handler

```ts
// src/cache_demo/api.ts —— 泛型轴 op = 方法名，参数位置传，末位对象 = opts（轴自定义）
async function get() {
  const hit = await axis("cache").get("greeting");
  if (hit != null) return json.ok({ hit, from: "cache" });
  const value = `hello ${Date.now()}`;
  await axis("cache").set("greeting", value, { ttl: 60 });
  json.ok({ hit: value, from: "fresh" });
}
export default { get };
```

### ③ 验证

```bash
curl -s http://localhost:9778/v1/api/cache_demo/   # {"code":0,"data":{"hit":"hello …","from":"fresh"}}
curl -s http://localhost:9778/v1/api/cache_demo/   # {"code":0,"data":{"hit":"hello …","from":"cache"}}
```

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| `unknown generic axis 'cache'` | 插件未加载/ABI 不匹配/名字拼错——报错里的 `available` 列表即当前已注册泛型轴；`oj info` / JS `ojInfo().generic_axes` 可核对 |
| op 报 `axis op '<op>': plugin returned non-JSON` | 插件该 op 返回了非 JSON 字节——插件侧 bug，找插件作者 |
| 同名泛型轴两个插件都声明 | 装配期 fail-fast（泛型轴每名单提供者）——`plugins:` 清单里只留一个 |
| 想列一个轴有哪些 op | 协议面没有内省——插件文档/README 为准（如 oj-ldap：`bind/search/search_paged/whoami/compare`） |

## 附：无配置文件快速用法（v0.1.57）

所有子命令的 `-c/--config` 均可省略。省略时按序搜索：**CWD 逐级向上 `config.yaml` →
`$HOME/.oj/config.yaml`**；都没找到则用内置默认值继续（stderr 打 `note: no config.yaml
found …`），显式 `-c` 指向缺失文件仍 fail-fast。

```bash
# 纯计算脚本：不碰任何后端，无需 config
./bin/oj exec -e 'console.log(JSON.stringify({ok: 1 + 1}))'

# 构建 / OpenAPI 生成 / 诊断：无 config 也能跑
./bin/oj build -d src -o dist
./bin/oj openapi -d src -o openapi.json
./bin/oj info        # 回落内置默认 → config 段为空，其余照常

# 纯静态站点：无 config 起服务（证书两路径仍必配——给旗标）
./bin/oj serve --api-path dist --app-path web --cert-path cert.jws --key-path pub.pem

# 用户级兜底配置：所有项目共享一份
mkdir -p ~/.oj && cp config.yaml ~/.oj/config.yaml
```

| 坑 | 说明 |
|---|---|
| 命令行为像「用了别人家的配置」 | 上级目录或 `~/.oj/config.yaml` 有一份就会被自动采用；`oj info` 核对实际装配的段键名，必要时显式 `-c` 锁定 |
| 无 config 跑 `migrate` / `test` 报未声明 default 库 | 回落默认 Config 里没有任何后端——这类命令本来就须要 config，错误在用到后端时才给出 |
| `secret seal` / `open` 不带 `-c` | 同样走搜索；`open` 的私钥仍优先 `OJ_SECRET_KEY` / `OJ_SECRET_KEY_FILE` 环境通道 |
