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
| [31](#场景-31一个文件多个同动词端点嵌套-handler-组v0164) | 一个文件多个同动词端点——嵌套 handler 组（实体为根）+ 组级 `.route`（v0.1.64；动词/子组判别红线，不再静默丢弃） | §4 编写 api.ts |
| [32](#场景-32用-ddd-规划组级-api实体为根--组级-routeschema-平衡) | 用 DDD 规划组级 API：聚合根→实体组、从属资源→子组、独立聚合→拆目录；组级 `.route`/`.schema` 统一声明公共前缀与公共入参 | §4 编写 api.ts |
| [33](#场景-33特权模块受控挂载最小配置platformv0175) | 平台特权模块最小配置：`platform:` 段 + `mounts[].api` 条目 + 特权 fs 读 trusted 文件 + `exec` 授权（v0.1.75；fail-closed，装配期抢注防护） | §6 fs / §6 exec / §10 platform |
| [34](#场景-34tar-解压安全落位exectar-三步范式v0175) | 用 `exec.run` 跑系统 tar 安全解压发行包：`-tzf` 预检 + 成员名复检 → 解压到 `.staging` → 解压后 walk 校验（symlink 零容忍 + 体积对账）→ 原子落位（v0.1.75；argv 模板白名单，无 shell） | §6 exec / §10 platform |
| [35](#场景-35解决方案市场模块安装闭环v0175) | 市场模块安装端到端闭环：`fetch` 下载 → `sha256Hex` 比对 → `verifyEd25519` 验签 → `exec.run` tar 解压 → `yaml.parse` 读 manifest → `platform.trusted_paths` 文本手术回写 config → `exec.run` `oj migrate --format json` → `server.reloadConfig` 热更（v0.1.75；各步 fail-closed） | §6 fetch / §6 crypto / §6 exec / §6 yaml / §6 server / §10 platform |
| [36](#sc36) | 按模块版本做观测打点与兼容分支——`http.module` 提供 `{name, version}` 只读身份（v0.1.76） | §6 http |
| [37](#sc37) | 远程分发 dist 根挂载：`mounts[].api` 填 `http(s)://` URL + `sha256` 完整性锚（v0.1.77） | §10 配置 / §12 运维 |
| [38](#sc38) | 用 `oj build --bundle` 打出整站 dist 根 tarball 并打印 sha256，供远程挂载校验（v0.1.77） | §11 `oj build` |
| [39](#sc39) | 实时日志流式消费：`exec.spawn` 句柄（`for await` stdout/stderr）/ `exec.run` onStdout/onStderr 回调（v0.1.78） | §6 exec |
| [40](#sc40) | 长任务中途 kill：`exec.run` 超时整组击杀 / `exec.spawn().kill()` 主动击杀（v0.1.78） | §6 exec |
| [41](#场景-41通知回执合并--幂等写入构造器补齐能力v0181) | 通知回执合并 + 幂等写入：join ON 值条件 / 字面量列 `scope` / `orIgnore` / `fromSelect`（v0.1.81 补齐，替代手写 `db.query`） | §6 db / 查询构造器 |

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
./bin/oj test -c config.yaml -d src
# stderr: oj test: using db "test"（migrate / seed / fixtures 一并跟随）

./bin/oj test -c config.yaml -d src --db ci_scratch   # 指定别的库（须在 db 段声明）
./bin/oj test -c config.yaml -d src --anonymous       # 以匿名身份跑（测公开面）
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
`auth.anonymous_paths` 免 Bearer。典型场景是 OIDC 跳转请求：OIDC 是「跳到第三方登录页
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

> 两条列表是**独立的**：OIDC 回调这类「浏览器跳转请求」通常**两个都要加**，
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
// 连续两次分配必须各自推进（确认"旧写法会坍缩"的问题不再出现）
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
const rows = await db.table("account").where({ field: "id", op: "eq", value: id }).all();
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
const rows = await db.table("account")
  .select(["id", "name"])
  .where({ or: [{ field: "role", op: "isnull" }, { field: "role", op: "eq", value: "" }] })
  .all();
console.log(`待修复 ${rows.length} 条`);
for (const r of rows) {
  console.log("  fix", r.id, r.name);
  if (!dry) {
    await db.table("account").where({ field: "id", op: "eq", value: r.id }).update({ role: "member" }).run();
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
`note: no config.yaml found`**（`oj exec` / `oj info` 行为一致；仅 `serve` / `migrate` /
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
| PUT 413 | 直传路由看 `blob_upload_max_bytes`（1 GiB），**不是** `max_upload_bytes`；改后者没用 |
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

### ② 登录端点（签发是业务职责；src/auth/ 有参考实现）

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

> **顺带分清两把钥匙（v0.1.80）**：`--alg ed25519` 生成的是**签名**密钥（`crypto.verifyEd25519`
> 的作者侧，产 `ed25519-private.pem` PKCS#8 + `ed25519-public.hex` raw 32B hex + `.fp` 指纹），
> 与这里的密封密钥**不可互用**——X25519 做加密协商、ed25519 做签名；拿 ed25519 产物去
> `seal`/`open` 会报 `not a OJ X25519 … PEM`。

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
./bin/oj test -c config.yaml -d src

# 报表库 + 缓存 redis + 归档 es 一起选源，handler 不改代码
./bin/oj test  -c config.yaml -d src --db report --redis cache --es archive
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
| `opts` 想设 `event:`/`id:` 字段 | 不支持——`opts` 仅 `status` / `contentType` / `fileName` / `disposition`；自定义 SSE 字段自己拼进 `write("event: x\ndata: y\n\n")` |
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

**红线先说**（两条，动手前先看）：

1. **只走直连池**——在 `db.tx` 内调用会报错
   `db.stream within an active transaction is not supported (streaming queries run on the connection pool only)`。
2. **不是所有后端都真流式**——真流式的是核心 sqlite / mysql / postgres 连接与
   `oj-db-mysql` / `oj-db-postgres` 两个插件后端；其余后端没有逐行拉取能力，宿主会**一次取全量**
   （不报错，行为等同 `db.query`，只是内存优势没了），彻底不支持时直接报
   `backend does not support streaming`。

（详见 `api-manual.md` §6 db 节 `db.stream` 与 §13 已知限制全表）

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
| `db.stream` 在插件后端上"能跑但不省内存" | 该插件没有逐行拉取能力 → 宿主静默改用一次取全量（等同 `db.query`）。真流式的是核心 sqlite / mysql / postgres 连接与 `oj-db-mysql` / `oj-db-postgres`（v0.1.38 起）——用它们才省内存 |
| 取消不是立即生效（插件后端） | 插件取消是**协作式**（批间生效）：`stream_cancel` 置标志后，下一批返回 `{"error":"cancelled"}`；core 后端 = 中途 drop（best-effort） |
| 写了 `json.ok(...)` 又 `json.stream` | 流式响应已接管 body，二者互斥——用了 `json.stream` 就别再 `json.ok/fail`，handler 直接 `return` |
| `for await` 拿到的 `row` 是 `undefined` | 流以 `null` 标记结束，异步迭代器形态已替你消化掉这一帧；直接在循环体用 `row` 即可，不要等 `undefined` |
| 取消后已处理的行「回滚」了 | `signal` 只中止**后续拉取**，已回调/已迭代的行不会回滚——取消前的数据已是最终态 |

### ⑥ 鉴权后二进制附件下载（v0.1.65）

`json.stream` 的 `opts` 新增 `fileName` / `disposition`：可直接把**鉴权后**的字节流式回源、且
浏览器另存为原名，**无需 302 到免鉴权 blob 路由**（避免鉴权被绕过、预签名 URL 泄露）。二进制
**必须传 `Uint8Array`/`ArrayBuffer`/类型化数组**——走字节通道逐字节无损；传 `string` 会被当
UTF-8 文本而失真（图片/压缩包乱码）。

```ts
export default {
  async get({ id }: { id: string }) {
    const rows = await db.table("attachment").select(["data", "name"]).where({ field: "id", op: "eq", value: id }).all();
    const s = json.stream({
      contentType: "application/octet-stream",
      fileName: String(rows[0].name),  // → Content-Disposition: attachment; filename*=UTF-8''<pct-encoded>
      // disposition: "inline",          // 默认 attachment；内联展示改 inline
    });
    s.write(new Uint8Array(rows[0].data));  // 字节通道：逐字节无损
    s.end();
    return;
  },
};
```

**验证**：`curl -s -D - 'http://localhost:9778/v1/api/attachment/?id=1' -o out.bin` → 响应头含
`Content-Disposition: attachment; filename*=UTF-8''<encoded>`，`out.bin` 与源文件逐字节一致。

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

### ④ 出参声明：`.schema` 之内或平级 `.response`（v0.1.72）

```js
// 两种写法等价可并存，.response 平级写法语义相同、.schema 只放入参更清爽
get.schema = {
  params: { type: "object", required: ["id"], properties: { id: { type: "integer" } } },
  response: { type: "object", properties: { id: { type: "integer" } } },
};
// 组级默认出参：整组继承，动词 .response 整体覆盖
post.response = { type: "object", properties: { created: { type: "string" } } };
post.schema = { body: { type: "object", required: ["name"] } };
```

四位置并存时优先级：**动词 `.response` > 组 `.response` > 动词 `.schema.response` > 组
`.schema.response`**。运行期**不校验**响应（只喂 `oj openapi` / 下游 client 生成）；
`json.raw` / `json.stream` / `json.sse` 端点无信封，不要声明。验证：

```bash
./bin/oj openapi -c config.yaml -d src | grep -A8 '"responses"'
# → 200 的 content schema 是 {code,msg,data} 信封，data 即声明的 payload
```

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

## 场景 28：新增一种登录来源（HTTP SSO / CAS / 企业统一登录）

> 何时抄我：企业统一登录是「把用户名/密码 POST 到公司 SSO 地址，按 JSON 响应判
> 成败」的表单形态，或 CAS（302 跳转 + ticket 回校）。**先记住分层：`oj-auth`
> 插件只是守卫**（Bearer/cookie 验签 + 匿名路径 + CSRF），**所有登录端点本来就是
> 普通业务模块**——sample 的 `/auth/login`、`/oidc/*` 全是 JS handler，守卫对
> 「登录从哪来」不可见。新增来源 = 新写一个业务模块（照抄 `src/oidc/`
> 或 `src/auth/`），**不要动 oj-auth 插件**（那是 ABI 面）。

### ① 表单形态：转发凭据到外部端点（src/sso/login/api.ts）

```ts
export default {
  async post() {
    const { username, password } = http.body;
    // POST 到企业 SSO，字段名按对方要求组装
    const r = await fetch("https://sso.corp.com/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, app_id: "myapp" }),
    });
    const body = await r.json().catch(() => null);
    // 成功判定读对方响应的具体字段；失败统一 json.fail，不回吐外部响应体
    if (!r.ok || !body || body.data?.code !== 0) json.fail(401, "invalid credentials");
    // provider 必须命中 config http_sso 已配置名单（未命中 400，防自报命名空间）；
    // JIT 键含 provider 与 tenant 段做隔离（见 docs/superpowers/specs/ v0.1.61 设计）：
    // "sso:<provider>:<tenant>:<username>"（未启用租户 tenant 为空串）
    const p = String(http.body.provider || "corp");
    const localName = "sso:" + p + ":" + (http.tenantId ?? "") + ":" + username;
    let rows = await db.table("users")
      .select(["id", "roles"])
      .where({ field: "username", op: "eq", value: localName }).all();
    if (!rows.length) {
      await db.table("users")
        .insert({ username: localName, password_hash: "!sso", roles: "[]" }).run();
      rows = await db.table("users")
        .select(["id", "roles"])
        .where({ field: "username", op: "eq", value: localName }).all();
    }
    const roles = JSON.parse(<string>rows[0].roles || "[]");
    json.ok(await issueTokens(String(rows[0].id), roles));   // 与本地登录同构，见场景 14
  },
};
```

签发/会话/CSRF 与本地登录完全同构（`src/auth/_shared/session.ts` 的
`issueTokens` + 场景 14 的双 cookie）——登录来源只决定「凭据验过没有」，验过即
换发自家 token，后续请求对守卫无异。

### ② JIT 建号：占位 hash 锁死密码登录

上面 `password_hash: "!sso"` 是关键：**非法 bcrypt 串，`bcrypt.verify` 恒
false**——该号永远不能走本地密码登录，只能由 SSO 换发（OIDC 同款：`"oidc:<tenant>:<sub>"`
+ `"!oidc"`，零 schema 变更）。username 带来源前缀做命名空间隔离：`sso:zhang`
与本地 `zhang` 是两个号；两不同信任级的来源不得指同一键。

### ③ CAS 形态：302 跳转 + ticket 回校

- 跳转请求 `GET /sso/cas/login` → 302 到 `{cas}/login?service={callback URL}`；
- 回跳请求 `GET /sso/cas/callback?ticket=ST-…` →
  `fetch("{cas}/serviceValidate?ticket=…&service=…")` → 响应含
  `<cas:authenticationSuccess>` 即成功，取 `<cas:user>` 走上面同款 JIT；
- 成功后签发 token 并 302 回前端。**交接红线**：token 不进 URL（httpOnly 双 cookie，
  场景 14）；`service` 用装配期配置的固定 callback URL（禁从请求 Host 派生）；302
  目标只认配置固定值或 `/` 开头且非 `//` 的相对路径（绝对 URL 400，防 open-redirect）。

### ④ 配置：登录端点与 302 跳转请求都进两条匿名列表

```yaml
auth:
  anonymous_paths:
    - "/sso/login"                                # form 登录端点：无 token 可言，必须匿名
    - { path: "/sso/cas/*", one_layer: true }     # CAS 302 跳转请求（带不了自定义头）
tenant:
  anonymous_paths:
    - "/sso/login"
    - { path: "/sso/cas/*", one_layer: true }     # 两条列表独立，都要加（OIDC 同款）
```

登录端点**必须**匿名——守卫对非匿名路径无 token 一律 401，而登录恰恰是无 token 时
调用的（`/auth/login` 先例）；CAS 302 跳转请求还带不了自定义头/租户头，故两条列表都要。

### ⑤ 常见坑

| 坑 | 说明 |
|---|---|
| 想加 SSO 就去改 oj-auth 插件 | 方向错了：插件只是守卫（验签 + 匿名路径 + CSRF），改它 = 动 ABI（`AuthGuardVtable`，全部插件联动重编）；登录端点是业务模块，本场景 + `src/oidc/` 覆盖 |
| JIT 建号给了真实口令 hash 或空串 | 占位串（`"!sso"`）就是「此号不走密码登录」的声明——bcrypt 对非法 hash 恒 false；写真实 hash 等于给 SSO 账号开了第二条密码攻击面 |
| username 不带来源前缀 | `sso:zhang` 与本地 `zhang` 必须是两个号；混用同一键 = 低信任来源可接管高信任账号 |
| 把外部 SSO 响应体回吐给前端 | 泄露内部信息——失败统一 `json.fail(401, …)`，成功判定只读具体字段 |
| 生产走 http:// | SSO 凭据明文过网——缺省拒绝非 https 的 `login_url`（装配期报错），内网联调显式 `allow_http: true` 才放行（带 WARN，与 mail 的 `allow_none_tls` 行为一致）；凭据不进日志 |
| CAS 回跳 401 | 跳转/回跳请求没进 `auth.` / `tenant.` **两条**匿名列表（互相独立，只加一条不够） |
| token 拼进 CAS 回跳 URL | 泄露面（Referer/浏览器历史）——httpOnly 双 cookie 交接；302 目标只认配置固定值或 `/` 开头相对路径，防 open-redirect |

## 场景 29：引擎原生全文检索（`_shared/search`，v0.1.61）

> 何时抄我：文档/wiki/博客要全文检索，但不想为中小规模上 ES。三引擎原生 FTS
> 统一成一个面——sqlite FTS5（bundled 已开）/ mysql FULLTEXT(ngram) /
> postgres tsvector+GIN——零额外依赖、随库走、`db.tx` 内使用即同事务。
> 源码：`src/_platform/_shared/search.ts`，引用方 manifest 补
> `deps: { _platform: "^0.1.0" }`。

### ① 建索引与写入口

```ts
import { createSearch } from "#/_platform/_shared/search";
const search = createSearch(db);

// ensureIndex = DDL：进程内每表一次；**禁止在 db.tx 内调用**（MySQL DDL 隐式提交）
await search.ensureIndex("docs", { fields: ["title", "body"], pk: "id" });

// index/remove = 业务表 upsert/delete（三引擎索引随业务行自动维护）
await search.index("docs", { id: 42, title: "部署手册", body: "在生产环境部署 oj" });
await search.remove("docs", 42);
```

事务一致性：业务写入与 `search.index(...)` 放进同一个 `db.tx`，语句经 op 层
`resolve_target` 自动路由进同一连接——无 ES 式异步漂移：

```ts
await db.tx(async () => {
  await db.table("docs").insert({ id: 43, title: "…", body: "…" }).run();
  await search.index("docs", { id: 43, title: "…", body: "…" });
});
```

### ② 检索与高亮

```ts
const hits = await search.query("docs", "环境部署", { limit: 20, highlight: true });
// hits = [{ id: 42, score: <引擎原始分>, fragments: { body: "…<mark>环境部署</mark>…" } }]
```

### ③ 验证

L1（基于 sqlite，`oj test`）：`tests/search.test.ts`——增删改后检索一致、短词回退、
DDL 拒事务、标识符白名单。

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| sqlite 查 2 个字没结果 | trigram 对 <3 字符**静默零命中**——共享模块自动回退业务表 `LIKE`（score=1，统一 `ESCAPE '!'`，转义 `!`/`%`/`_`；勿用 `ESCAPE '\'`——mysql 默认 sql_mode 下是 1064） |
| `DDL inside db.tx` 报错 | ensureIndex 进了事务——MySQL DDL 会隐式提交调用方事务，模块用 `tx.isTx` 直接拒绝 |
| 想直写 `docs_fts` | 别——索引随业务行自动维护，直写 = 双份索引；`index()` 只碰业务表 |
| score 跨引擎比较 | 不可比——返回引擎原始分（sqlite bm25 负值、mysql 相关度、pg ts_rank） |
| `sql_guard: deny` 部署下 search 全挂 | deny 与 FTS 裸查询互斥：要么关守卫要么不用 search；启用租户守卫的库 MATCH 查询须带业务表 `tenant_id` 条件 |
| mysql 建索引报重复 | `ADD FULLTEXT` 无 IF NOT EXISTS——模块已先查 `information_schema.statistics` 再建；自写 SQL 照抄该模式 |
| pg 占位符 | **0.1.67 起统一 `?`**（宿主自动改写 `$n`，sqlx Any 不转换的问题已在宿主侧解决）；存量 `db.dialect()` 渲染的 `$n` 继续有效 |
| mysql 中文没召回 | FULLTEXT 必须 `WITH PARSER ngram`（服务端 ≥5.7.6） |
| `oj schema diff` 报 D002 | `docs_fts*` 影子表未声明——文档化噪音，人工忽略 |

## 场景 30：内容版本化——CAS 修订 + diff + 回滚（`_shared/versions`，v0.1.61）

> 何时抄我：文档/CMS 每次保存要一个不可变修订，支持历史/对比/回滚。CAS 内容表
> （sha256 去重）+ 修订表（UNIQUE 乐观锁兜底）+ 行级 diff，全部随库走、同事务。
> 源码：`src/_platform/_shared/versions.ts`；建表迁移在
> `src/_platform/migrations/0002__versions.{sql,mysql.sql,pg.sql}`
> （sha256 用 CHAR(64)——MySQL TEXT 不可作 PK）。

### ① 提交 / 历史 / 取回 / 回滚

```ts
import { createVersions } from "#/_platform/_shared/versions";
const versions = createVersions(db);

const v = await versions.commit("doc", docId, content, {
  author: http.user?.id, message: "修正部署步骤", expect: 6,   // 乐观锁（可省略）
});
// v = { version: 7, sha256: "…" }
const body = await versions.get("doc", docId, 7);        // 7 | "head"
const log  = await versions.history("doc", docId, { limit: 20 });
const d    = await versions.diff("doc", docId, 6, 7);     // [{type:"ctx"|"add"|"del", text}]
await versions.rollback("doc", docId, 6, { author: http.user?.id, message: "回滚到 v6" });
```

### ② 事务与并发

- `commit` 在调用方 `db.tx` 内调用即同事务（内容+修订行一起回滚）。
- `expect` 与当前 `max(version)` 不符 → 409；并发双 commit 后插者撞
  `UNIQUE(entity_type, entity_id, version)` → 统一 409 `version conflict`。
  不带 `expect` = last-write-wins（UNIQUE 仍保证版本号不重）。
- `rollback` = 旧内容重放为新版本（不删历史，审计友好）；清理（purge）留给业务路由鉴权。

### ③ 验证

L1：`tests/versions.test.ts`——commit×5/get/history/diff/rollback、乐观锁 409、
同内容 CAS 去重、`db.tx` 回滚连带修订回滚、大文档格子预算闸。

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| 409 `version conflict` | 乐观锁撞版本：重读 head 重试，或明示 last-write-wins（省 `expect`） |
| `diff too large` | 修剪公共前后缀后格子数 >4M（≈16MB DP 矩阵会打穿 isolate 堆）——缩小对比范围 |
| 同内容反复 commit 撑库 | 不会——CAS：sha256 命中 `oj_ver_content` 主键即跳过，修订行只是指针 |
| 想自己建表 | 用现成迁移（方言文件 `.{sqlite,mysql,pg}.sql` 后缀）；手写注意 MySQL TEXT 不可作 PK |
| 业务表挂版本 | `entity_type`/`entity_id` 是字符串指针——换实体类型换 `entity_type` 即可，勿混用 |
| purge 想直接删 `oj_ver_content` | 会把仍被修订行引用的内容删掉——先删无引用 sha256（超管权限留给业务鉴权） |

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

## 场景 31：一个文件多个同动词端点——嵌套 handler 组（v0.1.64）

> 何时抄我：同一实体有多个同动词端点（如资产的 读/建/上传），不想为每个动词拆子目录，
> 也不想把 api.ts 撑成大文件。**以实体对象为根**：组名用领域实体，子组用实体下的子资源。
> 端点极少（≤3）时平铺即可；端点各自独立演化、多人分权时仍拆目录。
> 源码：`src/nest/api.ts`，L1 用例 `tests/nest.test.ts`。

### ① 实体为根：同实体多端点聚一组

```ts
// src/nest/api.ts
function get(): void { json.ok({ where: "get" }); }              // GET  /nest/

const asset = {
  get: () => { json.ok({ where: "asset.get", state: http.query.state }); }, // GET  /nest/asset
  post: () => { json.ok({ where: "asset.post" }); },             // POST /nest/asset
  upload: {                                                      // 子资源（再嵌一层）
    post: async () => { json.ok({ where: "asset.upload.post" }); }, // POST /nest/asset/upload
  },
};
asset.get.schema = {                                             // 契约只挂函数，不是路由
  query: { type: "object", required: ["state"], properties: { state: { type: "string" } } },
};

export default { get, asset };
```

### ② 对外根级 URL：组级 `.route` 作整组前缀

```ts
const anchor = {
  post: async () => { json.ok({ anchor: http.param("anchor", "") }); },
};
anchor.route = "/x/{anchor}/upload";   // 绝对 → base 根下：POST /x/{anchor}/upload

// 实体名可以是非标识符（连字符），计算式访问命中
const auditLog = { get: () => { json.ok({ where: "audit-log.get" }); } };
export default { anchor, "audit-log": auditLog };
```

### ③ 验证

dev 与 release 两态一致（`oj build` 后 routes.js 为嵌套行写 `handler: "asset.get"`，
顶层动词行不写该字段；旧产物无此字段照常启动）。sample L1（`oj test -c config.yaml
-d src`）覆盖全形态：

```
GET  /v1/api/nest/                → 200 get
GET  /v1/api/nest/asset           → 400（缺 query state，契约在 JS 前拦）
GET  /v1/api/nest/asset?state=ok  → 200 asset.get
POST /v1/api/nest/asset           → 200 asset.post
POST /v1/api/nest/asset/upload    → 200 asset.upload.post
POST /v1/api/x/a1/upload          → 200 anchor.post
GET  /v1/api/nest/audit-log       → 200 audit-log.get
GET  /v1/api/nest/asset/schema    → 404（元数据不生成路由）
```

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| 启动报 `verb key 'x' … expected handler function` | 动词键下挂了对象/数组/基元——动词键只能是 handler 函数 |
| 启动报 `non-verb key 'x' … expected nested group object` | 非动词键挂了函数/数组/基元（此前的静默丢弃陷阱）；helper 函数别进 default 导出 |
| 组挂 `.route` 后目录镜像 404 | 符合预期：组动词各自替换镜像（与顶层 `.route` 同语义） |
| 报 `nested deeper than 4 levels` / `circular handler group` | 嵌套上限 4 层；自引用（`a.self = a`）内省期即失败 |
| release 启动报 `illegal handler chain` | routes.js 的 `handler` 段非法（`/`、空段、`__proto__`/`constructor`/`prototype`）——重新 `oj build` |
| 该拆目录还是用组 | 见 api-manual §4「何时采用」：同实体多端点用组（实体为根）；端点独立演化/多人分权拆目录；≤3 个同形端点平铺 |

## 场景 32：用 DDD 规划组级 API（实体为根 + 组级 `.route`/`.schema` 平衡）

> 何时抄我：你在设计一个**聚合**（如「项目 Project」带成员、看板、附件），要决定
> 「哪些端点进同一个实体组、哪些拆目录、组级路由/契约怎么挂」。本场景给一套可照抄的
> **领域驱动设计落点**，重点是用**组级 `.route` + 组级 `.schema`** 一次性统一声明整组的
> 前缀与公共入参，避免每个动词重复声明。
> 配套：`src/nest/api.ts`（L1 `tests/nest.test.ts`）；手册 §4「嵌套 handler 组」。

### ① DDD 概念 → oj 落点（先画这张表再动手）

| DDD 概念 | oj 落点 | 本场景例子 |
|---|---|---|
| 限界上下文 | **模块**（`manifest.yaml`） | `project` 模块独占「协作」上下文，不混进 `billing` |
| 聚合根 | **实体组**（组名 = 聚合根） | `project` 组：`project.get` / `project.post` / `project.put` |
| 聚合内从属资源 | **子组**（随聚合根路由） | `project.members`（成员随项目生命周期，无独立 URL 空间） |
| 独立聚合 | **独立目录 / 文件** | `billing` 不进 `project` 组——各自演化、各自鉴权 |

### ② 组级 `.route` + 组级 `.schema`：整组统一声明前缀与公共入参

`project` 聚合的端点分两类：集合端（`GET/POST /project`，无 id）与条目端
（`GET/PUT /project/{projectId}`，带 id）。**组级 `.schema` 只承载跨端点共享的 query
（分页）——路径参数留给各 verb 自挂**（否则 `oj openapi` 的 path 参数双向一致校验
会对无 id 的集合端报错；这是与 oj-module 的 OpenAPI 管线对齐的硬约束）：

```ts
// src/project/api.ts —— 聚合根为根
const project = {
  get:     () => { json.ok({ where: "project.get" }); },        // GET  /project            （列表）
  post:    () => { json.ok({ where: "project.post" }); },       // POST /project            （创建，无 id）
  getById: () => { json.ok({ where: "project.getById", id: http.param("projectId") }); }, // GET  /project/{projectId}
  put:     () => { json.ok({ where: "project.put" }); },        // PUT  /project/{projectId}
  // 从属资源：再嵌一层子组
  members: {
    get:  () => { json.ok({ where: "project.members.get" }); }, // GET  /project/{projectId}/members
    post: () => { json.ok({ where: "project.members.post" }); },
  },
};
// 组级默认前缀：整组挂 /project 下
project.route = "/project";
// 组级默认契约：本聚合所有端点的公共 query（分页）——不碰路径参数
project.schema = {
  query: { type: "object", properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", maximum: 100 } } },
};
// 条目端：动词自身 .route 挂路径参数 + 动词 .schema 补 params（与组 query 合并）
project.getById.route = "{projectId}";
project.getById.schema = {
  params: { type: "object", required: ["projectId"], properties: { projectId: { type: "string" } } },
};
project.put.route = "{projectId}";
project.put.schema = {
  params: { type: "object", required: ["projectId"], properties: { projectId: { type: "string" } } },
};
// 创建端叠加 body 契约：最终 = 组 query(page/pageSize) ∪ 动词 body.title
project.post.schema = {
  body: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 80 } } },
};
// 出参声明（v0.1.70）：`response` = `json.ok(data)` 的 data payload，只进文档/生成，
// 运行期**不校验**。注意它与入参合并规则不同——动词级**整体覆盖**，不与组级做并集。
project.get.schema = {
  response: {
    type: "object",
    required: ["list", "total"],
    properties: {
      list: { type: "array", items: { type: "object" } },
      total: { type: "integer", minimum: 0 },
    },
  },
};

export default { project };
```

内省期合并结果（`oj openapi` 与运行期守卫同源）：

- `project.get` / `project.post` → 继承组 `query`（分页），无路径参数冲突；
- `project.getById` / `project.put` → 组 `query` ∪ 动词 `params.projectId`（route 含 `{projectId}`，双向一致校验通过）；
- `project.members.*` → 继承组 `query`（路由 `/project/{projectId}/members` 含 id，但若 members 自身要 id，在 `members` 子组挂 `.schema` 即可，沿链累加）；
- `response` 通道**不并入参那套**：动词级整体覆盖、无则继承组级（不做 `required` 并集 /
  `properties` 逐键覆盖）——响应是动词各不相同的，组级必填被某动词继承会让文档声称
  返回并不存在的字段。
- 任一 `.schema` 非法 → 装配期硬失败（不静默跳过），且**不受 `schema_validation: false`
  影响**：该开关只关运行期校验，不关声明合法性。

### ③ 平衡判据：组 vs 子目录 vs 平铺（别走向任一极端）

| 形态 | 用在本场景的哪部分 | 何时回退 |
|---|---|---|
| 实体组（`project`） | 同一聚合根的读/建/改/删 + 从属资源 | 文件过胖（>~80 行）→ **聚合过胖信号**，按子域拆聚合，不是回退动词目录 |
| 子组（`project.members`） | 没有独立生命周期的从属资源 | 成员要独立鉴权/独立演化 → 升为独立目录 `project-member/` |
| 拆子目录 | `billing`（独立聚合） | — |
| 平铺 | 模块根只有 ≤3 个动词 | 动词一多立刻收进实体组 |

一句话：**同一聚合的操作进同一个实体组，不同聚合才拆目录；组级 `.route`/`.schema`
统一声明公共前缀与公共入参，动词只补差异**。在「多文件夹」与「大文件」之间取平衡，
文件仍过胖则是聚合该拆的领域信号，而非改用目录结构掩盖。

### ④ 验证

```
GET  /v1/api/project                  → 200 project.get（列表，继承组 query 分页）
POST /v1/api/project                  → 400 缺 body.title（组 query ∪ 动词 body 合并校验，进 JS 前）
GET  /v1/api/project/{pid}            → 200 project.getById（route 含 {projectId}，双向一致校验通过）
PUT  /v1/api/project/{pid}            → 200 project.put
GET  /v1/api/project/{pid}/members    → 200 project.members.get（继承组 query）
POST /v1/api/project/{pid}/members    → 200 project.members.post
GET  /v1/api/project/{pid}/schema     → 404（元数据不生成路由；契约只进 OpenAPI/校验）
```

---

## 场景 33：特权模块受控挂载最小配置（platform，v0.1.75）

> 何时抄我：你要部署一个**平台特权模块**（如 ojm 安装器），它需要读 jail 之外的
> 受信文件（config、发行产物）或执行外部命令（tar 解压等）。本场景给最小可跑配置——
> 生效面 = 特权模块 fs 读写范围扩为 `fs.root ∪ trusted_paths` + `exec` 全局授权；
> tar 解压三步范式见场景 34。
> 手册 §10「platform」、§6 fs「平台特权 fs 扩展」、§6「exec」。

### ① 目录布局（特权模块只能部署方手工放入受控根，不进市场安装树）

```text
<项目根>/
├─ config.yaml
├─ config.yaml.bak …          # 受信文件（trusted_paths 指向）
├─ src/…                      # 普通业务模块（市场安装树，行为不变）
└─ platform-modules/
   └─ ojm-installer/
      ├─ manifest.yaml        # name = ojm-installer
      └─ api.ts
```

### ② 配置（三处缺一不可：mounts 条目 + platform 段 + fs 段）

```yaml
mounts:
  - prefix: /v1/api
    dir: src               # 市场安装树（普通模块，行为不变）
  - prefix: /v1/platform   # 受控根也是普通 api 挂载（前缀须与其他 api 挂载不同——
    dir: platform-modules  #   同类同前缀重复会被拒）——特权模块由此获得归属与路由

fs:
  root: ./data             # 特权扩展的前提：fs: 段已配置（未配置时特权恒不可用）
  readonly: false

platform:
  modules: ["ojm-installer"]
  root: "./platform-modules"                 # modules 非空时必配；须同时列为 mounts[].api 条目
  trusted_paths: ["."]                       # 额外授权根：相对 config_dir 解析（此处=项目根，
                                             # 覆盖 config.yaml 等受信文件；须已存在，否则装配 fail-fast）
  exec:                                      # exec 授权（v0.1.75 生效；与 modules 相互独立，
    ojm-installer:                           #   列出该模块 = 授权其 exec.run）
      allow: ["tar -tzf ${path:archive}", "tar -xzf ${path:archive} -C ${path:dest}"]
      env: ["OJ_SECRET_KEY"]                 # 透传环境变量白名单（值不进 JS 面）
```

### ③ handler（特权模块里 fs 读 trusted 文件）

```ts
// platform-modules/ojm-installer/api.ts —— 目录镜像路由 /v1/platform/ojm-installer/
async function get() {
  // 特权面 = fs.root ∪ trusted_paths：trusted_paths 内文件可读（相对路径按 fs.root 折叠，
  // 绝对 canonical 路径也可）；非特权模块读同一文件 → NotCapable
  const cfg = await fs.readTextFile("../config.yaml");   // 折叠后落在 trusted 根内
  json.ok({ len: cfg.length });
}
export default { get };
```

### ④ 验证

```bash
curl -s http://localhost:9778/v1/platform/ojm-installer/   # {"code":0,"data":{"len":…}}
# 非特权模块读同一文件 → NotCapable（行为不变，fail-closed）
```

### ⑤ 常见坑

| 坑 | 说明 |
|---|---|
| 报 `NotCapable: platform not configured` | config 里根本没有 `platform:` 段——fail-closed，不配 = 全部特权不可用 |
| 报 `NotCapable: module 'x' is not platform-privileged` | 模块不在 `platform.modules` 名单；或没部署在 `platform.root` 下；或受控根没列为 `mounts[].api` 条目（归属与路由只能来自挂载 discover）——三处缺一不可 |
| tasks/WS 里调平台能力恒被拒 | 上下文无模块归属（`module = None`）→ 特权恒不可用，设计如此 |
| 特权模块读 trusted 外文件报 `path escapes fs.root` | 特权面 = `fs.root ∪ trusted_paths` 的**并集**，越出即拒——把目录根加进 `trusted_paths` |
| 配了 `trusted_paths` 但 `fs:` 段没配 | 特权扩展不生效（fs 未配置时恒非特权，trusted_paths 不会凭空开 jail）——先配 `fs.root` |
| 启动报 `platform.modules is set but platform.root is missing` | 名单非空必须配受控根，且该目录须列为 `mounts[].api` 条目 |
| 启动报 `platform module 'x' … must not come from an install tree` | 特权名出现在了其他挂载树（抢注防护，fail-fast）——特权模块只能由部署方放入 `platform.root`，别让市场安装树里出现同名 bundle |
| 启动报 `platform.root (…) must not overlap another api mount (…)` | 受控根与其他挂载树同径或互为父子（含父目录形态）——绊线会被静默穿透，装配期直接拒绝 |
| 启动报 `… is not deployed under platform.root (dangling privilege…)` | 名单悬空：`platform.root` 下没有这个模块——部署它或从名单删掉 |
| 启动报 `platform.trusted_paths canonicalize failed` | trusted_paths 条目路径不存在——相对 config_dir 解析，先建目录或改路径 |
| `exec.run` 报 `module 'x' is not authorized for exec` | **exec 授权 ≠ `platform.modules`**（两名单独立）——`platform.exec.<模块>` 里列出该模块并给匹配的 argv 模板（场景 34） |

---

## 场景 34：tar 解压安全落位——`exec.run` + tar 三步范式（v0.1.75）

> 何时抄我：特权模块要解压发行包（安装闭环「下载 → 校验 → 解压落位」的落位段）。
> `exec.run` 无 shell，argv 必须恰命中一条 `platform.exec.<模块>.allow` 授权模板；
> **安全判定后置**——`tar -tzf` 预检只是快速失败优化，权威校验 = 解压后对目标目录
> 全量 walk。手册 §6「exec」、§10「platform」。

### ① 配置（在场景 33 基础上给 exec 加 tar 模板）

```yaml
fs:
  root: ./data
  readonly: false

platform:
  modules: ["ojm-installer"]
  root: "./platform-modules"
  trusted_paths: ["."]
  exec:
    ojm-installer:
      allow:
        - "tar -tzf ${path:archive}"                       # 预检：列成员（快速失败）
        - "tar -xzf ${path:archive} -C ${path:dest}"       # 解压：两路径都过 ${path:} 校验
      env: []                                              # tar 不需要环境变量；缺省空表
```

模板红线：literal token 逐字相等——handler 里多传/换掉任何 literal（如给 tar 夹
`--use-compress-program=…`）都报 `exec template mismatch`；`${path:}` 值按路径校验
（须落在 `fs.root ∪ trusted_paths` 内），`${raw:}` 拒 `-` 开头与绝对形态。

### ② handler（三步范式：预检 + 成员名复检 → 解压到 .staging → walk 校验 → 原子落位）

```ts
// platform-modules/ojm-installer/extract/api.ts —— POST /v1/platform/ojm-installer/extract/
// body: { archive: "uploads/pkg-1.0.0.tgz", name: "pkg", version: "1.0.0" }（相对 fs.root）
const SIZE_CAP = 512 * 1024 * 1024;   // 解压结果体积对账上限（按需定，防归档炸弹填盘）

async function post() {
  const { archive, name, version } = http.body as { archive: string; name: string; version: string };
  const staging = `dist/.staging/${name}-${version}-${Date.now()}`;

  // ① 预检（快速失败）+ 成员名复检：组件级拒 `..` / 绝对形态 / 控制字符
  //    （按 / 分段判，不做子串匹配——`a..b` 是合法文件名）
  const listed = (await exec.run(["tar", "-tzf", archive])).stdout;
  for (const line of listed.split("\n")) {
    const m = line.trim();
    if (!m) continue;
    if (m.startsWith("/") || m.includes("\0") || m.split("/").some((c) => c === "..")) {
      throw new Error(`rejected archive member: ${m}`);
    }
  }

  // ② 解压到 .staging（jail 内；cwd 已钉在 fs.root，${path:} 值经路径校验）
  await exec.run(["tar", "-xzf", archive, "-C", staging]);

  // ③ 权威校验：解压后对 staging 全量 walk——symlink/hardlink/设备零容忍 + 体积对账
  let total = 0;
  async function walk(p: string): Promise<void> {
    for await (const e of await fs.readDir(p)) {
      const full = `${p}/${e.name}`;
      if (e.isSymlink) throw new Error(`symlink rejected: ${full}`);
      const st = await fs.stat(full);
      if (e.isDirectory) { await walk(full); continue; }
      total += st.size;
      if (total > SIZE_CAP) throw new Error(`extracted size exceeds ${SIZE_CAP}`);
    }
  }
  await walk(staging);

  // ④ 原子落位：同盘 rename 原子（生产建议：目标已存在先 rename 到 <target>.old-<rand>，
  //    成功后回收；staging 命名与 manifests.yaml 的 <module>-<version> 约定一致）
  const target = `dist/${name}-${version}`;
  await fs.rename(staging, target);
  json.ok({ target, totalBytes: total });
}
export default { post };
```

任一步抛错：预检/成员名阶段还没落盘；walk 阶段应删掉整个 staging 目录再抛
（不部分落盘——示例从简，生产把 ③ 包进 try/catch 补 `fs.remove(staging, {recursive: true})`）。

### ③ 验证

```bash
# 造一个测试包塞进 jail
mkdir -p data/uploads data/dist && tar -czf data/uploads/pkg-1.0.0.tgz -C data .
curl -s -X POST http://localhost:9778/v1/platform/ojm-installer/extract/ \
  -H 'content-type: application/json' \
  -d '{"archive":"uploads/pkg-1.0.0.tgz","name":"pkg","version":"1.0.0"}'
# → {"code":0,"data":{"target":"dist/pkg-1.0.0","totalBytes":…}}
ls data/dist/pkg-1.0.0
```

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| `NotCapable: … not authorized for exec` / `template mismatch` | 模块没进 `platform.exec` 授权表；或 argv 与模板 literal 不逐字 / token 数不齐 / `${raw:}` 收到 `-` 开头 token。**exec 授权 ≠ `platform.modules`**，两名单独立 |
| `exec template ambiguous: argv matches N authorized templates` | 同一 argv 命中 ≥2 条模板（如 `tar -tzf ${path:a}` 与 `tar ${raw:x} ${path:a}` 都能吃 `tar -tzf a.tgz`）——收紧模板消除歧义，宿主不静默择一 |
| `NotCapable: exec ${path:archive}: path outside fs.root and trusted_paths …` | 归档/目标路径越出 `fs.root ∪ trusted_paths`——把所在目录根加进 `trusted_paths`，或把文件挪进 jail |
| `exec: command resolve failed for 'tar': … not found in PATH` | 部署机没有 tar——依赖由部署文档声明（macOS bsdtar / Linux GNU tar 方言差异被后置 walk 校验天然覆盖） |
| `exec output limit exceeded` / `exec timed out after N ms` | `tar -tzf` 大包成员列表可超 stdout 合计 10MB；大包解压超缺省 30s——显式调大 `timeoutMs`（硬上限 600s） |
| 只做 `-tzf` 预检就信任归档 | 预检与解压之间归档可被同 jail 模块置换（TOCTOU）；**权威校验是解压后 walk**（symlink/hardlink/设备零容忍、组件级拒 `..`、体积对账）——三步一步都不能省 |
| 给 `${raw:}` 传文件路径 | `${raw:}` 拒 `-` 开头与绝对形态（`/`、`\`、盘符起手），传路径请用 `${path:}`（它才做 jail 校验） |
| 子进程拿到的 argv[0] 不是 "tar" 原文 | 预期：宿主把模板首 token 解析为绝对路径（按宿主 PATH）再传给子进程；模板首 token 必须是裸名 |

---

## 场景 35：解决方案市场模块安装闭环（v0.1.75）

> 何时抄我：平台要做一个「市场」，让运维/用户在运行时从远端拉取一个解决方案 bundle（`.tgz`）
> 并安全装进本实例——下载 → 完整性 → 真实性 → 解压落位 → 读 manifest → 回写 config →
> 迁移 → 热更，整条链路端到端。本场景把本批次能力（`fetch` / `crypto.sha256Hex` /
> `crypto.verifyEd25519` / `exec.run` / `yaml.parse` / `platform.trusted_paths` /
> `server.reloadConfig` / `oj migrate --format json`）串成一条**每步 fail-closed** 的闭环。
> 基础特权配置（mounts + `platform:` + `fs:` + exec 授权）见场景 33 / 34。
> 手册 §6 fetch / §6 crypto / §6 exec / §6 yaml / §6 server / §10 platform。
>
> **关键纪律**：下载/校验/验签/迁移任何一步失败，都**不落盘、不改锁、不触热更**——
> 已落盘的版本目录在迁移失败后删除、已回写的 config 在失败时恢复。fail-closed 不是风格，是
> 市场被中间人投毒时唯一的防线。

### ① 前置：最小 config（特权模块 + trusted_paths 把 config.yaml 纳入特权 fs 可达范围）

```yaml
fs:
  root: ./data                 # 特权扩展前提：fs: 段已配置（未配置时 exec/特权恒不可用）
  readonly: false

platform:
  modules: ["ojm-installer"]   # 只有此名单模块可调 server.reloadConfig / 读 trusted_paths 外文件
  root: "./platform-modules"   # modules 非空必配；受控根须同时列为 mounts[].api 条目
  trusted_paths: ["."]         # 额外授权根 = 项目根（config.yaml 所在）；相对 config_dir 解析
  exec:
    ojm-installer:             # exec 授权与 modules 相互独立：列出该模块 = 授权其 exec.run
      allow:
        - "tar -tzf ${path:archive}"                                       # 解压预检（场景 34）
        - "tar -xzf ${path:archive} -C ${path:dest}"                       # 解压落位
        - "oj migrate -c ${path:config} --format json -d ${path:root} ${raw:module}"  # 迁移（见步骤 7）
      env: []

mounts:
  - prefix: /v1/api
    dir: src                   # 市场安装树（普通模块，行为不变）
  - prefix: /v1/platform
    dir: platform-modules      # 受控根也是普通 api 挂载（前缀须与其他 api 挂载不同）
```

> **特权前提（逐步点名）**：步骤 1–5（下载/校验/验签/解压/读 manifest）只需 `fetch` + `fs`（jail 内）
> 与 `crypto`（始终可用），**不需要** platform 特权；步骤 6（回写 config.yaml）与步骤 8（热更）要求
> 模块在 `platform.modules` 且 config.yaml 落在 `platform.trusted_paths`；步骤 4 / 7 的 `exec.run`
> 要求模块在 `platform.exec` 授权表（与 `modules` 相互独立）。

### ② 安装 handler（八步闭环，每步 fail-closed）

```ts
// platform-modules/ojm-installer/install/api.ts —— POST /v1/platform/ojm-installer/install/
// body: { offer: "pkg/1.0.0" }（市场单 id；实际安装单含 url/sha256/signature，由市场 API 下发）
const PUBLISHER_PUBKEY = "<hex/base64 编码的 32 字节原始 Ed25519 公钥>";
const SIZE_CAP = 512 * 1024 * 1024;

async function post() {
  const { offer } = http.body as { offer: string };
  const [name, version] = offer.split("/");

  // —— 步骤 1：从市场 API 取安装单 + 下载 bundle.tgz 到 jail 内 .staging ——
  // 特权前提：普通模块即可（fetch + fs 在 fs.root 内，无需 platform）。
  // 为什么 fail-closed：下载失败 → fetch 抛错，根本不落盘。
  const meta = await (await fetch(`https://market/api/solutions/${offer}`)).json() as
    { url: string; sha256: string; signature: string };
  const tgz = await (await fetch(meta.url)).arrayBuffer();   // Uint8Array
  const archive = `downloads/${name}-${version}.tgz`;
  await fs.mkdir("downloads", { recursive: true });
  await fs.writeFile(archive, tgz);

  // —— 步骤 2：sha256 比对（fail-closed：不符不落盘、不改锁、不触热更）——
  const sum = crypto.sha256Hex(tgz);            // 二进制直接求摘要（v0.1.75 扩面）
  if (sum !== meta.sha256) {
    await fs.remove(archive);
    json.fail(400, "bundle sha256 mismatch");
    return;
  }

  // —— 步骤 3：发布方签名验签（fail-closed：不符同样不落盘/不改锁/不触热更）——
  // 规范串固定为 "<name>@<version>:<sha256>"；sigBase64 仅标准 base64。
  // 特权前提：crypto 始终可用，无需 platform。
  const canon = `${name}@${version}:${sum}`;
  if (!crypto.verifyEd25519(PUBLISHER_PUBKEY, canon, meta.signature)) {
    await fs.remove(archive);
    json.fail(400, "bundle signature mismatch");
    return;
  }

  // —— 步骤 4：解压落位（exec 模板白名单；前置见①：platform.exec 须含 tar 模板 + fs: 段已配）——
  // 为什么 fail-closed：解压前先做 -tzf 预检 + 成员名复检，解压后全量 walk 校验（symlink 零容忍
  // + 体积对账），任一步失败删掉整个 staging 再抛——不部分落盘（同场景 34 三步范式）。
  const staging = `dist/.staging/${name}-${version}-${Date.now()}`;
  await exec.run(["tar", "-tzf", archive], { timeoutMs: 120000 });   // 预检（快速失败）
  await exec.run(["tar", "-xzf", archive, "-C", staging], { timeoutMs: 120000 });
  // ……（此处省略 walk 校验：同场景 34③ 的 symlink/体积对账，失败先 fs.remove(staging, {recursive:true})）
  const dest = `dist/${name}-${version}`;
  await fs.rename(staging, dest);

  // —— 步骤 5：读 manifest（yaml.parse 三预算防炸弹）——
  const manifest = yaml.parse(await fs.readTextFile(`${dest}/manifest.yaml`)) as
    { name: string; version: string; /* … */ };

  // —— 步骤 6：config 回写（anonymous_paths 并入 / vars.ojm_solutions_gen 自增）——
  // 特权前提：config.yaml 须落在 platform.trusted_paths 内（① 已配 "."）；模块须 platform.modules。
  // 为什么 fail-closed：走「文本手术 + yaml.parse 复检 + sha256 自校验」三步，而不是
  // yaml.stringify 全量覆盖——后者会丢注释与空白（见 §6 yaml 警告）。
  try {
    await patchConfigCommit(name, version);
  } catch (e) {
    await fs.remove(dest, { recursive: true });
    json.fail(500, `config patch failed: ${String(e)}`);
    return;
  }

  // —— 步骤 7：迁移（约束 B 先于热更；fail-closed：必须校验 exit code）——
  // 特权前提：platform.exec 须含 oj migrate 模板（① 已配）。
  const r = await exec.run(
    ["oj", "migrate", "-c", "../config.yaml", "--format", "json", "-d", "dist", `${name}-${version}`],
    { timeoutMs: 600000 },   // 大表迁移可能超缺省 30s，显式调大（硬上限 600s）
  );
  const out = JSON.parse(r.stdout) as
    { results: { module: string; ok: boolean; error?: string }[]; error: null | string };
  // 退出码才是成败真源：任一模块失败 json 仍成功解析、只是 results[].ok=false 且进程退非 0。
  const allOk = r.code === 0 && out.results.every((x) => x.ok);
  if (!allOk) {
    await fs.remove(dest, { recursive: true });   // 删版本目录
    await restoreConfig();                        // 恢复锁（撤销步骤 6 的回写）
    json.fail(500, "migration failed");
    return;
  }

  // —— 步骤 8：热更（特权前提：模块须 platform.modules；reloadConfig 仅特权模块可调）——
  // 返回恒定五键：generation + unchanged + 三清单（applied/restart_pending/kept_listener）。
  const rc = await server.reloadConfig();
  // 验收项：若 restart_pending 含 platform/fs，说明本进程不重建后端/fs 根，须提示运维重启。
  if (rc.restart_pending.some((s) => s === "platform" || s === "fs")) {
    log.warn("solution installed but restart required", "pending", rc.restart_pending);
  }
  json.ok({ generation: rc.generation, restart_pending: rc.restart_pending });
}

// 步骤 6 的「文本手术三步」辅助：只插/改目标段，不碰其余文本。
async function patchConfigCommit(name: string, version: string): Promise<void> {
  const cfgPath = "../config.yaml";                 // 经 trusted_paths 折叠后落在项目根
  const before = await fs.readTextFile(cfgPath);
  // ① 文本手术：把新模块加进 mounts（或 anonymous_paths / vars.ojm_solutions_gen）
  //    ——这里以「给 vars 加一个计数器键」为例，避免正则误伤其它段：
  const marker = "vars:";
  const inject = `\n  ojm_solutions_gen: "${(await readGen(before)) + 1}"`; // 自增计数器
  let next = before.includes("\nvars:")
    ? before.replace(/\nvars:\s*\n/, `\nvars:${inject}\n`)
    : `${before.trimEnd()}\nvars:${inject}\n`;
  // ② yaml.parse 复检：确保仍是合法 YAML（手术没把结构打断）
  yaml.parse(next);
  // ③ 写回 + sha256 自校验：写后再读回，摘要一致才认为落盘完整（防静默截断）
  await fs.writeTextFile(cfgPath, next);
  const written = await fs.readTextFile(cfgPath);
  if (crypto.sha256Hex(written) !== crypto.sha256Hex(next)) {
    throw new Error("config self-check failed after write");
  }
}
async function readGen(text: string): Promise<number> {
  const v = yaml.parse(text) as { vars?: { ojm_solutions_gen?: string } };
  return Number(v.vars?.ojm_solutions_gen ?? "0") || 0;
}
async function restoreConfig(): Promise<void> {
  // 撤销 patchConfigCommit：恢复步骤 6 之前的 config（生产建议先备份 config.yaml.bak，此处从备份回填）
  const bak = await fs.readTextFile("../config.yaml.bak");
  await fs.writeTextFile("../config.yaml", bak);
}

export default { post };
```

### ③ 验证

```bash
# 触发安装（运维/市场调用，特权模块归属来自 mounts，无需手动带租户头）
curl -s -X POST http://localhost:9778/v1/platform/ojm-installer/install/ \
  -H 'content-type: application/json' \
  -d '{"offer":"pkg/1.0.0"}'
# 成功 → {"code":0,"data":{"generation":N,"restart_pending":[...]}}
# 失败任一环节 → 不落盘/不改锁/不热更；迁移失败会删版本目录 + 还原 config

# 验收：install 后手动改坏 config.yaml 的 sha256 段，看 reloadConfig 是否仍拒绝（旧代继续服务）
```

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| `crypto.verifyEd25519` 报 `verifyEd25519: key not hex/base64` / `public key must be 32 raw bytes` | 公钥传了 base64url（含 `-`/`_`）或 PEM/SPKI，或不是 32 字节原始 key——只收 hex/base64 编码的 32 字节原始公钥；签名只收标准 base64（**base64url 不支持**）；格式错抛错、验签不过返回 `false`（v0.1.75） |
| `crypto.sha256Hex(123)` 抛 TypeError | v0.1.75 行为变更：非 string/二进制入参（number/null）现抛错，不再经 `String()` 强转求摘要——显式 `String(x)` 或改传 `Uint8Array` |
| `crypto.md5Hex` 用在签名/完整性校验 | MD5 已密码学破损，仅限缓存键/etag/旧系统兼容；本场景完整性用 `sha256Hex`、真实性用 `verifyEd25519`，**不要**用 md5 |
| `exec.run` 报 `module 'ojm-installer' is not authorized for exec` | 步骤 4/7 的 tar / oj migrate 模板没进 `platform.exec.ojm-installer.allow`；**exec 授权 ≠ `platform.modules`**，两名单独立 |
| `exec ${path:config}: path outside fs.root and trusted_paths` | `../config.yaml` 没落在 `platform.trusted_paths` 内——把 config 所在根加进 `trusted_paths`（场景 33） |
| `server.reloadConfig` 报 `NotCapable: module 'x' is not platform-privileged` | 步骤 8 的调用模块不在 `platform.modules`，或没部署在 `platform.root` 下，或受控根没列为 `mounts[].api` 条目——三缺一 |
| `oj migrate` 子进程里 `argv[0]` 不是 "oj" 原文 | 预期：宿主把 "oj" 解析为服务进程自身（`current_exe()`）——模板首 token 写裸名 `oj` 即可 |
| `exec output limit exceeded` / `exec timed out after 600000 ms` | tar 大包成员列表可超 stdout 合计 10MB；大表迁移超 600s——本场景已显式把 migrate 的 `timeoutMs` 调到硬上限 600s，tar 调 120s |
| 只 `JSON.parse(r.stdout)` 成功就当迁移成功 | json `error` 已脱敏、迁移失败仍成功解析——**退出码 `r.code` 才是真源**，必须 `r.code===0 && results.every(ok)` |
| `yaml.stringify` 回写 config.yaml 后注释全丢 | 本场景刻意走「文本手术三步」而非 stringify 覆盖——serde_yaml 丢注释，config 回写禁走 stringify（§6 yaml） |

---


## 场景 36：按模块版本做观测打点与兼容分支（`http.module`，v0.1.76）

多模块/多版本并存（release 锁里 `<module>-<version>` 可多代）时，业务常需要知道
「这个请求跑在哪个模块的哪个版本上」——`http.module` 就是为这个注入的只读身份。

### ① handler（照抄）

```ts
// src/<module>/diag/whoami/api.ts
export default {
  get() {
    const m = http.module;   // { name, version } | null（无模块上下文为 null）
    if (m === null) {
      // 任务桥 / WS 帧 / run_with / 内省期：没有模块归属
      json.ok({ module: null });
      return;
    }
    // 观测打点：模块名 + 版本进日志（version 勿回显给客户端——指纹面）
    log.info("whoami", "module", m.name, "version", m.version);
    // 兼容分支：按版本前缀分流（版本分流本身在 manifests 锁/挂载层，这里只做行为兼容）
    const legacy = m.version.startsWith("0.1.");
    json.ok({ module: m.name, version: m.version, legacy });
  },
};
```

### ② 验证

```bash
# dev：version 取 src/<m>/manifest.yaml
curl -s http://localhost:9778/v1/api/<module>/diag/whoami/
# → {"code":0,"data":{"module":"<module>","version":"0.1.0","legacy":true}}

# release：version 取 dist/<m>-<v>/manifest.yaml（与目录后缀一致，装配期 fail-fast 校验）
```

### ③ 常见坑

| 坑 | 说明 |
|---|---|
| `http.module` 是 `null` | 按 handler 文件所在目录判定（非请求来源）：任务桥、WS 帧（含模块目录内的 `ws.ts`）、`run_with`、启动期内省期无归属——先判 `null` 再访问（与 `http.user` 匿名同款） |
| 写 `http.module.name = "x"` 抛 `TypeError: Cannot assign to read only property` | 预期：模块身份是框架授信依据（归属守卫/bound_db/平台特权）故冻结；strict 下写/delete 抛错，`require()` 的 CJS 代码写它静默无效——只读用即可 |
| dev 与 release 版本不一致 | 改了 `src/<m>/manifest.yaml` 的 version 但没 `oj build`——release 装配期校验 manifest version == 目录后缀，不一致（stale/手改 dist）启动即 fail-fast；重新 `oj build` 即可 |
| 拿 version 做 A/B 分流 | 版本分流在 `manifests.yaml` 锁与挂载层（同 pattern 多版本竞争由锁裁决）；handler 内按自身 version 分支只适合观测打点与兼容分支，别当分流机制用 |
## 场景 37：远程分发 dist 根挂载（URL + sha256 完整性锚，v0.1.77）

把构建产物发到 CDN / 对象存储，serve 端用 `mounts[].api` 指向 tarball URL + 声明 `sha256`，
启动即拉取、校验、解压到内容寻址缓存并以 release 语义服务——适合多实例共享同一份构建物、
或边缘节点零本地构建分发。

### ① 配置（config.yaml，路径相对 config 目录）

```yaml
mounts:
  - prefix: '/v1/api'
    api: 'https://cdn.example.com/myapp/dist.tgz'   # 整站 dist 根 tarball
    sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'  # 64 hex，必填
    cache: '.oj-cache'                                # 可选；绝对路径原样用
  - prefix: '/'
    web: 'public'
```

### ② 发布侧（先构建，再打成可分发根包）

```bash
./bin/oj build -d src -o dist
./bin/oj build --bundle -d src -o /tmp/sd     # 产出 /tmp/sd/sd.tgz
# 把 sd.tgz 传到 https://cdn.example.com/myapp/dist.tgz，并把其 sha256 填进上面的 config
```

### ③ 验证

```bash
./bin/oj serve -c config.yaml
curl -s http://localhost:9778/v1/api/user/account/?id=1     # 与本地 dist 行为一致
# 改坏 config 里的 sha256 → 重启即拒启（sha256 mismatch），不会静默用错版本
```

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| 漏填 `sha256` 启动报 `URL api requires sha256 integrity anchor` | 远程挂载**必须**声明 64 hex 完整性锚（v0.1.77）；不声明就拒启，不会「信任」任何 CDN |
| 启动报 `sha256 mismatch` | 下载内容与声明不符——CDN 漂移 / 被篡改 / 缓存损坏；重新 `oj build --bundle` 核对 sha256 |
| 报 `dist root missing manifests.yaml` / `extraction rejected` | dist 根须含 `manifests.yaml`；条目带符号链接 / tar-slip / 特殊文件会被解压器 fail-fast 拒启（发布前先本地 `oj build` 验证） |
| 把 per-module `*.tgz` 当远程源 | `--bundle` 打的是「整站 dist 根」空前缀包，解压即 dist 根；单模块 `*.tgz` 根里是版本目录，不是合法 dist 根 |

## 场景 38：用 `oj build --bundle` 产出可校验分发包（v0.1.77）

CI 里构建后顺手打一个「整站 dist 根」tarball 并打印 sha256，把 sha256 随部署清单固定，
下游 serve 用 `mounts[].api` 拉取即获内容寻址 + 完整性校验，无需信任传输通道。

### ① CI 片段（bash）

```bash
./bin/oj build -d src -o dist
./bin/oj build --bundle -d src -o artifacts
# 上一行打印：oj build --bundle: wrote artifacts/<name>.tgz (sha256 <hex>)
# 把 <hex> 写进部署配置 / 镜像标签 / 审计记录
```

### ② 验证

```bash
mkdir -p /tmp/verify && tar xzf artifacts/<name>.tgz -C /tmp/verify
ls /tmp/verify/manifests.yaml /tmp/verify/*/api.js     # 空前缀：解压即 dist 根
```

### ③ 常见坑

| 坑 | 说明 |
|---|---|
| `--bundle` 报 `manifest not found` | 先 `oj build` 生成 `dist/manifests.yaml`，`--bundle` 依赖它 |
| 解压后根不对（多一层目录） | `--bundle` 是空前缀 tarball（等价 `tar czf app.tgz -C dist .`）；若用 `tar czf x.tgz dist` 会多一层 `dist/`，解压落 `<cache>/<sha256>/dist/...` 而非合法 dist 根 |
| 想校验但不想远程挂载 | `--bundle` 的 sha256 也可用于自有发布校验 / 审计，不一定非要配 `mounts[].api` |

## 场景 39：实时日志流式消费（exec.spawn 句柄 / exec.run 回调，v0.1.78）

**什么时候用**：你跑一个会边跑边吐日志的外部命令（构建、ffmpeg、数据导入、长导出），想在前端 / 调用方实时看到进度，而不是等它跑完才一次性拿到整段 stdout。v0.1.78 在 `exec.run` 之上新增流式形态，两种形态复用同一套安全闸门（argv 模板白名单、路径占位符、整组击杀），无第二套读循环、不新增命令构造面：

- **B `exec.spawn(argv, opts)`** 返回句柄，stdout/stderr 是 `AsyncIterable<Uint8Array>`，可 `for await` 逐块消费；
- **A `exec.run(argv, opts)`** 扩展 `onStdout` / `onStderr` 回调：逐块转发给回调，同时攒下全量，返回 `{ code, stdout, stderr }`（stdout/stderr 为有损解码结果，非法 UTF-8 → U+FFFD **不抛**；v0.1.79 订正，此前称「返回 `{ code }`、不缓冲整段」）。

### ① 配置（在场景 33 / 34 的基础上给命令加模板）

```yaml
platform:
  modules:
    - installer
  trusted_paths:
    - ./scripts
  exec:
    installer:
      allow:
        - "sh -c ${raw:cmd}"
        - "ffmpeg -i ${path:src} -f null -"
```

### ② handler（exec.spawn 句柄：实时透传并累计字节）

```ts
export async function post() {
  const h = await exec.spawn(
    ["sh", "-c", "for i in 1 2 3 4 5; do echo progress $i; sleep .2; done"],
  );
  let bytes = 0;
  for await (const chunk of h.stdout) {
    bytes += chunk.length;
    process.stdout.write(chunk);        // 实时透传
  }
  const { code } = await h.exit();      // 等待整组退出，取返回码
  return json.ok({ code, bytes });
}
```

### ③ handler（exec.run 回调：增量转发，返回 { code }）

```ts
export async function post() {
  const r = await exec.run(
    ["sh", "-c", "for i in 1 2 3; do echo $i; sleep .2; done"],
    {
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
      timeoutMs: 5000,
    },
  );
  // 回调形态也攒全量：r 是 { code, stdout, stderr }（有损解码），仍受 10MB 上限
  // 约束；要真正逐块不占内存、拿原始字节，用 exec.spawn。
  return json.ok({ code: r.code, out: r.stdout });
}
```

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| 不 `for await` 消费，子进程却卡住不退出 | 真实子进程背压：stdout 经有界 mpsc（16 槽 × 8KiB）送达，JS 不拉取 → 通道满 → drain 在 send 挂起 → 子进程管道满 → 子进程自然暂停。不是 bug；先消费（或 break）再 `h.exit()` 才会返回 |
| 回调形态想要整段 stdout | v0.1.79 订正：`exec.run` 带 `onStdout` / `onStderr` 时**也缓冲**（返回 `{ code, stdout, stderr }`，只是解码有损）；真正不占内存、拿原始字节要用 `exec.spawn` 逐块消费——大输出别用回调形态 |
| rid 跨请求 / 跨模块共享 | 句柄 rid 是本次 runtime 的 ResourceId，进程内局部；只有自己 spawn 的会话能把 rid 传给 `kill`，跨模块 / 跨请求不可达 |
| 忘了 `exit()` 也能回收 | 句柄 close（JS 释放 / runtime 归还 / 异常丢弃）会同步整组击杀子进程，不会泄漏；但显式 `await h.exit()` 才能拿到退出码 |
| 输出二进制 / 非 UTF-8 | **只有无回调的 `exec.run` 抛** `exec: stdout is not valid UTF-8`；回调形态有损解码（U+FFFD）、`exec.spawn` 给原始字节，均不抛（v0.1.79 订正） |
| 超时 / 超限却没抛错 | 回调与流式形态不抛 `timed out` / `output limit exceeded`，只把 `code` 打成 137 并截断输出——别用 `try/catch` 判成功，要同时校验 `code`（v0.1.79） |
| Windows 上行尾 / 编码 / 分块解码 | `cmd /c echo` 输出以 CRLF 收尾（oj 不归一，跨平台比对用 `trimEnd()`）；输出含中文时为本地代码页、会被 UTF-8 解码拒（先 `chcp 65001`）；流式逐块解码要在块边界合并字节，别逐块新建 `TextDecoder`（v0.1.79） |

## 场景 40：长任务中途 kill（超时整组击杀 / 主动 kill，v0.1.78）

**什么时候用**：跑一个可能失控的外部命令（网络拉取、无限重试、超大导出），需要在超时或业务条件满足时**中途整组击杀**，而不是干等它自然结束；或要在拿到足够输出后主动终止。两种形态都支持：

- `exec.run(..., { timeoutMs })`：超时到期由框架整组击杀（unix SIGKILL），抛出 `exec timed out after <N> ms (process group killed)`；
- `exec.spawn(...).kill()`：主动整组击杀。

### ① 配置（同上，给命令加模板）

```yaml
platform:
  modules: [ installer ]
  trusted_paths: [ ./scripts ]
  exec:
    installer:
      allow:
        - "sh -c ${raw:cmd}"
```

### ② handler（exec.run 超时整组击杀）

```ts
export async function post() {
  try {
    await exec.run(
      ["sh", "-c", "i=0; while true; do echo tick $i; i=$((i+1)); sleep 1; done"],
      { timeoutMs: 2000 },
    );
    return json.ok({ killed: false });
  } catch (e) {
    // exec timed out after 2000 ms (process group killed)
    return json.ok({ killed: true, err: String(e) });
  }
}
```

### ③ handler（exec.spawn 主动 kill + 中途拿输出）

```ts
export async function post() {
  const h = await exec.spawn(
    ["sh", "-c", "i=0; while true; do echo tick $i; i=$((i+1)); sleep 1; done"],
  );
  const dec = new TextDecoder();
  let got = "";
  for await (const chunk of h.stdout) {
    got += dec.decode(chunk);
    if (got.includes("tick 2")) {     // 业务条件满足：拿到第 3 个 tick 就停
      h.kill();                       // 主动整组击杀
      break;
    }
  }
  const { code } = await h.exit();    // 主动 kill 在 unix 上返回 128+9 = 137
  return json.ok({ code, got });
}
```

### ④ 常见坑

| 坑 | 说明 |
|---|---|
| `exec.run` 超时后没有返回码 | 超时形态直接**抛错**（`exec timed out after <N> ms (process group killed)`），不是返回 `{ code: 137 }`；捕获异常即可 |
| kill 之后 `exit()` 拿到的码 | 主动 kill（unix SIGKILL）整组，退出码 = `128 + 9 = 137`；超时被框架 kill 同理 |
| 只 kill 没消费，`exit` 不返回 | 同场景 39 背压：先 break 退出 `for await`，再 `await h.exit()` |
| 误以为能杀别人的进程 | rid 仅本 runtime 可达；`kill` 只杀自己 spawn 的会话，无 pid 入参 |
| `timeoutMs` 想设很大 | 硬上限 600_000（10 分钟），超出被钳制；信号 kill 整组包含其子孙，避免僵尸 |
| Windows 上以为 kill 后子进程就没了 | Windows 无进程组，只杀直接子进程：子进程再派生的孙进程会残留（设计已声明）——别依赖「杀干净」做互斥（v0.1.79） |

## 场景 41：通知回执合并 + 幂等写入（构造器补齐能力，v0.1.81）

**什么时候用**：广播消息后，要把每个用户的「已读回执」合并进一张汇总表，且写入必须**幂等**
（同一条回执重复到达不报错、不重复落）。此前这类查询只能回退 `db.query` 手写 SQL（join ON
值条件、`'svc' as scope`、INSERT OR IGNORE、INSERT…SELECT 构造器都表达不了），是模板里
`db.query` 迟迟无法清零的主要阻塞点。v0.1.81 起全部可用构造器表达，跨引擎可移植。

### ① 配置

无需特殊配置；回报表 `notify_receipt(user_id, broadcast_id, scope)` 照常进 SchemaRegistry。

### ② handler（join ON 带值条件 + 字面量列 scope，合并读回执）

```ts
export async function post({ id }: { id: number }) {
  // 一张 broadcast 表 b + 回执表 r：LEFT JOIN 时 ON 既列对列、又列对常量（当前用户）
  const rows = await db.table("notify_receipt").as("r")
    .join("broadcast", [
      { left: "r.broadcast_id", right: "b.id" },
      { left: "r.user_id", op: "eq", value: id },   // ON r.user_id = ?
    ], "left", "b")
    .select([
      "r.user_id",
      { lit: "svc", as: "scope" },                  // 常量列：'svc' AS "scope"
    ])
    .all();
  return json.ok({ rows });
}
```

### ③ handler（幂等写入回执：orIgnore）

```ts
// 同一条回执重复到达 → 撞唯一键静默跳过（不报错、不重复落）
await db.table("notify_receipt")
  .insert({ user_id: id, broadcast_id: bid, scope: "svc" })
  .orIgnore()
  .run();
// 注意：不要写 `if (n === 1)` 判幂等——mysql 命中重复键返回匹配行 1，pg/sqlite DO NOTHING 返回 0
```

### ④ handler（批量快照：INSERT … SELECT 配 orIgnore）

```ts
// 把当天 notify 聚合结果批量搬进 notify_daily，撞键跳过
await db.table("notify_daily")
  .fromSelect(
    db.table("notify").select(["user_id", "cnt"]).where({ field: "day", op: "eq", value: d }),
    ["user_id", "cnt"],                   // 与源 select 列按位置对齐
  )
  .orIgnore()
  .run();
```

### ⑤ 常见坑

| 坑 | 说明 |
|---|---|
| 模糊搜想要 `%x%` | 用 `contains`（自动转义），别手写 `LIKE '%x%'`——`%`/`_` 会被当通配 |
| `orIgnore` 后读 affected 判幂等 | 三方言不一致：mysql 命中重复键返回 1，pg/sqlite 返回 0；行数只读「写几条」 |
| mysql 上 `orIgnore + returning` | 直接报错——mysql 无 RETURNING，无法同语句回带自增 id |
| `fromSelect` 列对不齐 | 目标 cols 与源 select 列按位置对齐，列数不符报 `insert declares N columns but the source select yields M` |
| `select(["*"])` 带 join | 直接报错——全列只出基表列，join 列会丢 |
| 表别名让租户/归属守卫失效 | 不会：v0.1.81 起别名只用于列限定，守卫始终按真名，update/delete 带别名直接拒 |


## 场景 42：模块卸载清理与整表清空（`db.listTables` / `truncate` / `count distinct`，v0.1.82）

模块卸载（`_lifecycle/uninstall.ts` 类 handler）、测试夹具复位、巡检对账时，需要「枚举当前库
实际存在的表」「无条件清空一张表」「精确数去重计数」——三者都曾被迫按方言分支裸 SQL
（`information_schema` vs `sqlite_master` + 手工 `ESCAPE`）或退回裸 `db.exec("delete from …")`。
v0.1.82 起一句构造器/目录 API 搞定，三方言同一份代码。

### ① 卸载清理：按模块前缀扫表并上报

```ts
// 枚举当前库全部业务可见表（含未登记 registry 的遗留表/api-only 方案的表），
// 按名称排序；前缀过滤的 %/_ 由引擎转义后走绑定参数——前缀来自配置也不注入。
const tables = await db.listTables("myapp_");
if (tables.length > 0 && !confirmed) json.fail(400, `found ${tables.length} tables: ${tables.join(", ")}`);
// 清行：登记过的表走 truncate()（守卫/租户语义不缺席）
for (const t of ["myapp_settings", "myapp_cache"]) {
  await db.table(t).truncate().run();
}
// 删表（DDL）是逃生舱的正当场景：表名来自引擎目录、语句常量，不掺用户输入
for (const t of tables) {
  await db.exec(`drop table if exists ${JSON.stringify(t).replace(/"/g, "")}`, []); // 见下方坑表
}
```

### ② 夹具/排障复位：明示的整表清空

```ts
// 之前：db.exec("delete from sys_login_throttle", [])——像漏写 where 的 delete，审查不可见
await db.table("sys_login_throttle").truncate().run();   // 命名式「清空」，返回受影响行数
```

### ③ 受影响用户数：去重计数不拉行

```ts
// 之前：distinct().all() 拉行 .length —— 顶层隐式 LIMIT 100 / 显式 clamp 1000 静默漏算
const [{ c }] = await db.table("audit")
  .select([{ fn: "count", distinct: true, field: "user_id", as: "c" }])
  .where({ field: "action", op: "eq", value: "login_failed" })
  .all();
```

### ④ 附：构造器分页工厂（count + list 复用同一组条件）

```ts
// 模板 _shared 里放一个工厂函数——条件写一份，count/list 各跑一次（引擎零依赖）：
export async function paged(mk: () => QueryBuilder, { page = 1, size = 20 } = {}) {
  const [{ c: total }] = await mk().select([{ fn: "count", as: "c" }]).all();
  const list = total === 0
    ? []
    : await mk().orderBy([{ field: "id", dir: "desc" }]).limit(size).offset((page - 1) * size).all();
  return { list, total, page, size, truncated: total > page * size };
}
// 用法：await paged(() => db.table("oplog").whereIf(kw, { field: "action", op: "contains", value: kw }))
```

### ⑤ 验证

```sh
curl "http://localhost:9778/v1/api/_lifecycle/uninstall/?module=myapp"   # 返回清理的表清单
```

### ⑥ 常见坑

| 坑 | 说明 |
|---|---|
| `truncate()` 在租户表上以为清了整库 | **只清当前租户的行**（租户守卫照常注入，构造性 fail-safe）；真整库清空在 `db.asSystem` 下执行 |
| `truncate()` 又接了 `.where(...)` | 直接报 `truncate does not accept where`——带条件的清空用 `delete`，别用 truncate 表达 |
| `listTables()` 返回的表名直接拼进 SQL | 名字来自引擎目录而非 registry 白名单——拼接本身不违背红线（非用户输入），但**行数据操作仍须值绑定**；要删整表（DDL）本就该走迁移，不在 handler 里 drop |
| `count(distinct)` 忘了 `field` / 用在 sum 上 | 报 `count distinct needs a field` / `distinct is only supported on count`——显式拒绝，不静默忽略 |
| sqlite 上 `fromSelect(...).orIgnore()` | 不支持（构造期报 `orIgnore with fromSelect is not supported on sqlite`）——见场景 41 与 sql-builder-guide §3.3 |
| `drop table "${t}"` 在 mysql 上 1064 | mysql 默认不认双引号包标识符——DDL 逃生舱里按方言换反引号（此类语句本就是方言语义，分支可接受；表名来自 `db.listTables`，非用户输入） |
