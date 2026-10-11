# oj TS API 开发手册

适用版本：API 面 v0.2（二进制版本号见 `oj/Cargo.toml`）

本手册写给**用 oj 框架开发业务项目**的开发者与 AI agent，内容包括：怎么组织模块、
怎么写 `api.ts` / `ws.ts` handler、怎么用注入的全局对象、怎么写测试、怎么配服务、
怎么构建发布与日常运维。
oj 是把 V8（deno_core）嵌进 Rust 的低代码后端框架：业务逻辑用 TS handler 编写，
运行时注入 `json` / `db` / `http` / `kv` / `blob` / `bus` / `es` 等全局对象，
所有响应统一套 `{code,msg,data}` 信封写回 HTTP。这里说的「信封」就是那层固定的
JSON 外壳：`code` 是状态码、`msg` 是消息、`data` 装业务数据。仓库内部实现见
`docs/dev-guide.md`，部署排障细节见 `docs/ops-manual.md`。本手册随版本包 `devkit/`
一同发布；API 签名以同目录 `global.d.ts` 为类型权威。

目录：1 快速开始 / 2 项目结构与模块约定 / 3 模块数据层 / 4 编写 api.ts /
5 导入解析 / 6 全局对象 API 参考 / 7 响应信封与错误码 / 8 鉴权与多租户 / 9 测试 /
10 配置 config.yaml / 11 构建与发布 / 12 运维要点 / 13 安全红线与已知限制

> **想直接抄代码**：同目录 `scenarios.md` 是场景速查（公开分享页匿名读租户数据 /
> SPA 深链回落与每页 meta / 测试库隔离 / LIMIT 分页陷阱 / 匿名路径通配），
> 每篇都是「配置 + 代码 + 验证 + 常见坑」。本手册讲「有什么、为什么」，场景集讲「怎么写」。

## 1. 快速开始

> 何时读我：第一次接触 oj，要从零跑通一个请求。

### 前置

二选一拿到可执行物：

- **发行包**：解包 `oj-v<version>.tar.gz`，得到 `oj`（主程序）、`plugins/<平台>/`
  （cdylib 插件）、`devkit/`（本手册）。
- **自建**（仓库内）：`cargo xtask build` —— 以 release 构建并归置
  `bin/oj` + `bin/plugins/<host-triple>/`。注意本项目禁止 debug 构建。

### 证书必配（无逃生口）

证书校验强制开启：`server.public_key_path` 与 `server.certificate_path` 缺任一路径，
启动直接报错退出，没有任何 config / CLI 开关可跳过。用 `oj-cert` 工具生成三件：

```bash
cargo run -p oj-cert -- gen -o config --days 365
# → config/private.pem（私钥，仅签发端保管，勿放服务器）
#   config/public.pem（公钥，放服务器）
#   config/cert.jws （JWS 证书，放服务器）
```

config 指向其中两件（公钥 + 证书）：

```yaml
server:
  public_key_path: "./config/public.pem"
  certificate_path: "./config/cert.jws"
```

### 最小项目

```
myproj/
├── config.yaml
├── config/
│   ├── public.pem
│   └── cert.jws
└── src/
    └── hello/
        ├── manifest.yaml
        └── api.ts
```

`config.yaml`（全部字段可省，仅证书两路径必配；生产建议显式写端口）：

```yaml
server:
  port: 9778                       # 监听端口（代码默认即 9778；<1024 属特权端口）
  public_key_path: "./config/public.pem"
  certificate_path: "./config/cert.jws"
db:
  default: "sqlite://db.sqlite"    # 相对 config 所在目录；缺文件自动建空库
```

`src/hello/manifest.yaml`（`name` 必须等于目录名，违反启动失败）：

```yaml
name: "hello"
desc: "第一个模块"
version: "0.1.0"
```

`src/hello/api.ts`：

```ts
export default {
  get() {
    json.ok({ hello: "oj" });
  },
};
```

### 启动与验证

```bash
./bin/oj serve -c config.yaml --api-path src
# 仓库内：先 cargo xtask build 产出 bin/oj，再从仓库根执行同形命令
```

`serve` 按 `--api-path` 目录**自动判定模式**：目录里有 `dist/manifests.yaml`（即「构建锁」，
记录每个模块锁定用哪个版本）就跑 release——跑预构建的 `.js`，不转译；否则是 dev——服务
`.ts` 源码，按需转译，改文件即生效。
启动时日志会写判定结果（`dev/ts` / `release/js` / `static-only`）、模块清单和路由统计
（`method-row / pattern / api file` 计数，v0.1.27 起替代逐行路由表）；
路由错误与冲突仍逐条打出具体 method/pattern/文件。
**终端默认静默（`server.console_log` 缺省 false）**。启动时会打一行日志路径的提示，
随后一切输出只落盘。想让终端同时输出，加 `--console-log` 或配 `server.console_log: true`。
**例外**：启动失败的最终退出原因总是直写终端（console 关闭也不例外），便于立即调整。
**后台运行**：加 `--daemon` 脱离终端（unix 用 setsid，windows 用 DETACHED_PROCESS），
stdio 重定向到空设备，父进程打印子 pid 后退出。日志照常落 `server.logs_dir`，停机用
`kill <pid>`。
**准入门（v0.1.58）**：`mounts:`（config + CLI 折叠后）为空 → 退出并提醒。挂载目录的
存在性在**装配期**统一检查。「装配期」指启动时把配置、插件、路由拼起来、请求还没进来的
那个阶段；「fail-fast」指这个阶段一发现问题就立即报错退出，不带病启动。重复前缀或目录
缺失的报错里都含挂载序号与前缀。

验证信封返回：

```bash
curl 'http://localhost:9778/v1/api/hello/'
# → {"code":0,"msg":"ok","data":{"hello":"oj"}}
```

### 交付（release）跑法

```bash
./bin/oj build -d src -o dist        # 生成 dist/<module>-<version>/ + manifests.yaml 锁 + tgz
./bin/oj migrate -c config.yaml -d dist          # release 默认 verify 门禁：先迁移后启动
./bin/oj serve -c config.yaml --api-path dist
```

**多库项目**（config `db:` 声明了 `default` 之外的命名库）：上面前两条默认只作用
`default`，其余库要加 `--db <name>` 逐库各跑一遍（`oj test fixture` / `oj schema diff` 同旗标）。
模块各自绑不同库（`manifest.yaml` 的 `db:`）时，还须配 `--module` 逐组合跑——见
`scenarios.md` 场景 6。

构建细节见第 11 章；完整可跑样例见仓库 `sample/`（`sample/README.md`）。

## 2. 项目结构与模块约定

> 何时读我：建新项目或新模块前。

### 源码树（dev 服务目录）

```
<project>/
├── config.yaml          # 服务配置（第 10 章）
├── ext_boot.js          # 可选，运行时创建期加载一次（扩展全局对象，§6 末）
├── src/                 # dev 服务目录（release 用 dist/，见第 11 章）
│   ├── user/            # 首层子目录 = 模块名
│   │   ├── manifest.yaml          # 模块清单（必配）
│   │   ├── schema.yaml            # 声明式表结构（有表模块必配，第 3 章）
│   │   ├── migrations/            # 手写迁移 {seq:04}__{desc}[.方言].sql
│   │   ├── fixtures/              # 演示数据，仅 oj test / oj test fixture 灌入
│   │   ├── _shared/validate.ts    # 无 api 文件 → 纯工具代码目录，不产生路由
│   │   ├── account/api.ts         # → {base}/user/account/
│   │   ├── profile/api.ts         # → {base}/user/profile/
│   │   └── profile/detail/api.ts  # → {base}/user/profile/detail/（任意深度）
│   └── order/
│       ├── manifest.yaml
│       └── list/api.ts            # → {base}/order/list/
├── tests/               # L1 测试（*.test.ts，第 9 章）
└── node_modules/        # 裸 specifier 解析起点（第 5 章）
```

约束：

- **首层子目录 = 模块**，每个必须有 `manifest.yaml`；缺失启动失败。
- 任意深度的子目录放 `api.ts`（dev）/ `api.js`（release）即成为一条路由；
  没有 `api` 文件的目录不是路由，可作共享工具目录（如 `_shared/`）。
- 同目录可放 `ws.ts` 产生一条 WebSocket 路由（第 4 章）。

### manifest.yaml（模块清单）

```yaml
name: "user"        # 必须等于父目录名（强校验，否则启动失败）
desc: "用户信息相关，记录账号、地址等个人信息"
version: "0.1.0"
# tables: [account]   # 有表模块必配：拥有的表清单（与 schema.yaml 双向一致 S005）
# deps: { user: "^0.1.0" }  # 跨模块表访问声明（ownership_guard 校验依据）
# config: {}        # 可选，本模块的其他设置
```

`name` ≠ 目录名 → 启动报 `manifest name "x" != directory name "y"` 退出（防止模块名与路由脱节）。

### seed.sql（可选）

- 模块 `seed.sql` 启动时对 `default` 库重放（**三方言**；建库结构演进归
  `migrations/` / `schema.yaml`）。
- 语句按 `;` 切分 → **语句内不得含分号字面量**。
- 幂等 INSERT 保证可重复执行（每次启动都重放）：写 sqlite 惯用法
  `INSERT OR IGNORE INTO …`，引擎按目标方言自动改写（mysql → `INSERT IGNORE`、
  pg → 句尾 `ON CONFLICT DO NOTHING`）；`OR REPLACE` / `ON CONFLICT` /
  `ON DUPLICATE KEY` 不翻译。
- `oj build` 不执行 seed（构建零磁盘副作用，db 用内存库）。

### dist 产物布局（预览）

```
dist/
├── manifests.yaml        # 模块 → 锁定版本（release 按此加载）
├── user-0.1.0/           # 版本目录 = <module>-<version>
├── user-0.1.0.tgz        # 确定性发布包
└── …                     # 多版本目录可共存
```

版本目录内部结构、锁语义与发布流程见第 11 章。

## 3. 模块数据层

> 何时读我：模块要建表、改表、跨模块取数、接存量库时。
> 运维视角的完整 runbook 见 `docs/migration.md`；这里只写开发要点。

### 心智模型

- **声明为源**：每模块可选 `schema.yaml` 声明自己拥有的表。启动 / `oj migrate` 时自动
  收敛到声明（**安全前向**：缺表 CREATE、缺可空列 ALTER ADD、缺索引 CREATE INDEX）。
- **演进靠迁移**：无法安全推导的变更（NOT NULL 列新增、疑似改名、类型变更、数据回填）
  一律 fail-fast 并打印迁移模板——手写 `migrations/{seq:04}__{desc}[.{sqlite|mysql|postgres}].sql`。
- **账本记账**：平台表 `_oj_migrations` 是「账本」，记录每个模块已经应用过哪些迁移
  （`module` 列区分模块）；带方言后缀的文件只在对应方言的库上执行。
- **表归属**：schema.yaml 喂归属图（表 → 模块，同表双声明拒启 S002）与 `SchemaRegistry`
  （`db.table()` 列白名单）；跨模块表访问须 manifest `deps:` 声明。

### schema.yaml

```yaml
tables:
  account:
    pk: id                                    # 可选；主键列须在 columns 声明；联合主键写 pk: [a, b]
                                              # （联合主键不支持 autoincrement；reconcile 对缺失主键列 fail-fast）
    columns:
      id: { type: integer, autoincrement: true }
      name: { type: text, null: false }
      role: { type: text }
```

- 列类型最小集：`integer | bigint | text | boolean | double | blob`；`null` 缺省可空。
- 与 manifest `tables:` 双向一致（S005）：声明了表就要进 manifest，反之亦然。

### 三层 SQL 文件

| 文件 | 时机 | 纪律 |
|---|---|---|
| `migrations/{seq:04}__{desc}[.方言].sql` | 启动（auto）/ `oj migrate` | 只前向；账本 `_oj_migrations`（`module` 列区分模块）；序列空洞/乱序 S007 报错 |
| `seed.sql`（模块级） | 每次启动重放 | 幂等 `INSERT OR IGNORE`；按 `;` 切分，语句内不得含分号字面量（S006） |
| `fixtures/*.sql` | 仅 `oj test` / `oj test fixture` 灌入 | 演示/测试数据，不进 release 产物 |

### 命令

| 命令 | 用途 |
|---|---|
| `oj migrate -c config.yaml -d <dir>` | 应用待执行迁移（`--baseline`：存量库接入，≤head 记为已应用不执行） |
| `oj schema diff -c config.yaml -d <dir>` | 声明 vs 实库对账（D001 漂移 / D002 未声明表），只读，漂移 exit 1 |
| `oj test fixture -c config.yaml -d <dir>` | 灌 `fixtures/*.sql` 演示数据（dev/test 用，不进 release 产物）。v0.1.52 起有**幂等门禁**：非幂等 INSERT（判据同 S006）灌入前报错，改 `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` 写法即可重复灌 |
| `oj openapi -c config.yaml [-d dir] [--base B] [-o out.json]` | 从路由表生成 OpenAPI 3.1（dev 内省 `.route` / release 读 `dist/routes.js`），打印或落盘（v0.1.43）；v0.1.52 起 dev 分支内省失败同样 fail-fast（对齐 release，不再静默缺路由） |
| `oj build --check` | 只跑结构检查 S001–S008 不落盘（CI 门禁） |
| `oj openapi -c config.yaml --check` | 生成物与已提交 `openapi.json` 比对，键序规范化后不一致即非零退出（CI 漂移门禁，v0.1.43）；`--check` 时 `-o` 为待比对文件，缺省 `<dir>/openapi.json` |

三条数据类命令（`migrate` / `test fixture` / `schema diff`）都接受 `--db <name>`（v0.1.21）：
`name` 即 config `db:` 段的键，缺省 `default`；**未声明的库名直接报错**并列出可用键，
不会静默回落 `default`。注意它是**整轮目标库**：会把全部模块的迁移灌进该库，不读模块级
`manifest.yaml` 的 `db:` 绑定（那只是运行期路由）。所以模块绑不同库的项目，要
`--db <profile> --module <M>` 逐组合各跑一遍（`scenarios.md` 场景 6）。

### 门禁配置（第 10 章 server 表）

- `server.migrate_on_start`：`auto`（dev 默认，启动即应用）/ `verify`（release 默认，
  账本落后拒启 M004，报错附 `oj migrate` 命令）/ `off`。
- `server.ownership_guard`：`warn`（默认，跨模块表访问仅告警）/ `deny`（未声明 deps
  拒绝执行，500 附修复指引）。灰度建议：先 warn 观察日志，声明补齐后切 deny。
- **无主表语义**：模块未部署时其表无主，运行时不设防（部分部署/灰度属设计语义）。

### 跨模块取数（deps）

```yaml
# manifest.yaml
deps:
  user: "^0.1.0"     # 模块名 → 版本范围；裸 SQL join 对方表前必须声明
```

误报逃生门：SQL 注释 `/* oj:allow-table=x,y */`。

### 回滚

schema 回滚**没有自动机制**（refinery 语义，只前向）：破坏性变更前备份数据文件；
反向变更手写新 seq 迁移前向执行。应用回滚 = `dist/manifests.yaml` 指回旧版本目录 + 重启。

## 4. 编写 api.ts

> 何时读我：写第一个 handler 时。

### 动词 → 方法名映射

`api.ts` 导出一个对象，键是 HTTP 动词对应的方法名：

| HTTP 动词 | 方法名 |
|---|---|
| GET | `get` |
| POST | `post` |
| PUT | `put` |
| DELETE | `del` |
| PATCH | `patch` |
| HEAD | `head` |
| OPTIONS | `options` |

**DELETE 的方法名是 `del`，不是 `delete`**——写错时该请求返回 405
（`method DELETE not allowed`）。

### 两种 handler 写法

**写法一：同步函数 + `.then().catch()`**。方法体同步返回，异步调用走 Promise 链；
runtime 会泵 event loop 直到所有 Promise 落定后再写回响应（摘自 `sample/src/user/account/api.ts`）：

```ts
function get(): void {
  const id = Number(http.param("id", 0));
  db.table("account").select(["id", "name", "role"]).where({ field: "id", op: "eq", value: id })
    .all()
    .then((r) => json.ok(r))
    .catch((e) => json.fail(500, String(e)));
}
export default { get };
```

**写法二：`async` 函数**（driver 会 `await fn()`；摘自 `sample/src/news/api.ts`）：

```ts
export default {
  async post(): Promise<void> {
    const b = http.body as { text?: string };
    await bus.publish("news", { text: b?.text ?? "hello" });
    json.ok({ published: true });
  },
};
```

两种写法等价可用；同一文件可混用。响应一律经 `json.ok` / `json.fail` 收口（第 7 章）。

### 请求体 http.body

解析规则：空 body → `null`；能按 JSON 解析 → 对象/数组；否则 → UTF-8 字符串。
multipart 请求时 `http.body` 是文本字段对象（`{name: value}`），文件走 `http.files`（第 6 章）。

```ts
const b = http.body as { name?: string };
if (!b.name) { json.fail(400, "name required"); return; }
```

**二进制帧（v0.1.16，仅 WS `message` 钩子）**：客户端发 Binary 帧时 `http.body` 为
`null`（不做 UTF-8 有损转换），原始字节一律走 `http.bodyBytes()`（文本帧同样可用，
返回原始帧字节）：

```ts
// ws.ts：帧型忠实回显（可运行案例 sample/src/echo-bin/ws.ts）
export default {
  async message() {
    const text = http.body; // 二进制帧为 null
    ws.send(text === null ? await http.bodyBytes() : text);
    // Uint8Array → Binary 帧（0x2）；string → Text 帧（0x1）
  },
};
```

### 路由：目录镜像与 `.route` 参数路由

URL = `{base}/{module}/{...path}/{feature}/` → `<dir>/{module}/{...path}/{feature}/api.ts|js`。
尾斜杠有无皆可；`{base}` = api 挂载的 `prefix`（v0.1.58 挂载模型；缺省挂载即 `/v1/api`）。

handler 函数挂 `.route` 属性即**替换**目录镜像路由，支持 matchit 语法
（摘自 `sample/src/user/item/api.ts`）：

```ts
function detail(): void {
  const id = Number(http.param("id", 0));
  if (!(id > 0)) { json.fail(400, "id required"); return; }
  db.table("account").select(["id", "name", "role"]).where({ field: "id", op: "eq", value: id })
    .all()
    .then((r) => (r.length ? json.ok(r[0]) : json.fail(404, "no such account")))
    .catch((e) => json.fail(500, String(e)));
}
detail.route = "{id}";
export default { get: detail };
```

| 语法 | 匹配 | 示例 |
|---|---|---|
| `{id}` | 单段（不含 `/`） | `/user/item/42` → `http.param("id") === "42"` |
| `{*path}` | 尾部一段及以上（含 `/`） | `/file/a/b/c` → `http.param("path") === "a/b/c"` |
| `"/x/{id}"` | 以 `/` 开头挂到 base 根下 | 挂 `/x/{id}` 而非当前目录下 |
| `""` | 视同未挂载 | 目录镜像路由保留 |

`.route` 规则：

- **目录段 `_name_` 即路径参数（v0.1.27）**：把目录名写成整段 `_name_`（首尾各一个下划线），
  URL 里这一段就变成 `{name}`。例：`user/_id_/api.ts` → `/user/{id}`，用 `http.param("id")`
  取值；模块段同样适用（`_aa_/bb/api.ts` → `/{aa}/bb`）。判定规则：必须是整段、内部名非空
  且不以 `_` 开头/结尾、不含 `{}`。不满足的（`__x__`、`___`、`_a{b}_`）保持字面；`_shared`
  （无尾下划线）不受影响。可与 `.route` 自由组合：`_id_/api.ts` 挂 `.route = "{sub}"` →
  `{id}/{sub}`。注意：URL 里字面写 `_id_` 会被 `{id}` 当实参吃掉（不再有静态 `_id_` 路由）。
- 挂载后**目录镜像被替换**：`/user/item`（镜像路径）→ 404，只有参数路由可达。
- **静态段优先于参数段**（与注册顺序无关）：`/x/{pk}` 与 `/x/me` 共存时，`GET /x/me` 必落
  `me` 的 handler 且 `http.param("pk")` 为空；只有 `/x/abc` 之类非静态名才进 `{pk}`。
- 同位置**异名**参数（`/x/{id}` 与 `/x/{name}` 并存）是结构性冲突。后来者在启动时被丢弃：
  dev 模式日志告警且该 URL 404，release 模式**启动失败**。同一位置只用一个参数名。
- `{*path}` catch-all 至少匹配一段：`/file`（零段）→ 404。
- **参数段内不得混字面**：`{id}.json`、`v{major}.{minor}` 均属非法 pattern，
  启动时被丢弃并记日志 `InvalidParamSegment`。需要前缀/后缀字面的 URL 拆成静态多段，
  由 handler 自行校验扩展名。
- TS 项目把 `global.d.ts` 拷进源码根即可获得 `Function.route` 声明，编辑器不报错。
- `oj build` 会把 `.route` 从产物中剥离——**release 下路由事实唯一来源是构建生成的
  `routes.js`**（第 11 章）。

解析顺序（v0.1.58 挂载模型）：请求路径按**前缀最长命中**选挂载（跨挂载不回落）→
api 挂载内：路由表（含 `.route` 参数路由与 `_name_` 目录参数）→ dev 目录镜像兜底
（dev 模式）→ 同前缀配对 web（无 spa 回落）→ 404；web 挂载直接静态服务（仅 GET/HEAD，
其余方法 405）。API 永远优先于静态文件。内建端点 `{api挂载prefix}/health`、
`{api挂载prefix}/plugins`、`{api挂载prefix}/blob/{key}` 逐 api 挂载注册。
目录穿越 / 空段 / 非法段（`..`、`.`、`\`、NUL）→ 404。

### 入参契约 `.schema`（v0.1.44）

与 `.route` 同构：在导出的函数对象上挂 `.schema`，分**三通道**声明入参
（`params` / `query` / `body`，对应 `http.params` / `http.query` / `http.body`）：

```js
export default { get, post };

get.schema = {
  params: { type: "object", required: ["id"], properties: { id: { type: "integer" } } },
};

post.schema = {
  query: { type: "object", properties: { page: { type: "integer", minimum: 1 } } },
  body: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", maxLength: 20 } },
  },
};
```

- **声明即执行**：校验发生在 JS **之前**，违反 → `400` 信封
  （`{"code":400,"msg":"..."}`），handler 不会被调用。
- **字符串强转**：`params` / `query` 在 HTTP 里只有字符串形态，声明为
  `integer` / `number` / `boolean` 时会显式强转，转不动即 400；`body` 是真
  JSON，**不**强转。
- **受支持关键字**（白名单）：`type` / `required` / `properties` / `items` /
  `additionalProperties` / `minimum` / `maximum` / `minLength` / `maxLength` /
  `pattern` / `enum` / `nullable` / `minItems` / `maxItems`。
  白名单外（`$ref` / `oneOf` / `format` …）一律 **fail-fast，绝不静默跳过**
  —— 静默放行等于把声明变成不生效的东西。非法契约在**装配期**即报错（启动失败）。
- **`pattern` 用 Rust regex**，不是 ECMA-262：lookahead / 反向引用不支持，
  非法 pattern 同样装配期报错。
- `params` / `query` 只允许扁平标量（string/number/integer/boolean/null）：
  底层是 `HashMap<String,String>`，声明 array/object 是永远无法满足的死契约，
  装配期即拒。
- `additionalProperties: false`（body 通道）运行期**拒掉未声明字段**；不写则放行额外字段。
  其余白名单关键字按 JSON Schema 语义生效（`required` / `enum` / `minimum`·`maximum` /
  `minLength`·`maxLength` / `items` + `minItems`·`maxItems` / `nullable` / `pattern`）。
- 开关 `server.schema_validation`：**默认 true**（声明了就会执行）；
  置 `false` 为逃生门。
- 同一份声明喂给 `oj openapi`，补出 `parameters` 与 `requestBody`；其中
  `params` 声明必须与路由 pattern 的实参**双向一致**，否则 `oj openapi` 报错
  （避免契约与 URL 变成两份真源）。

### ws.ts（WebSocket 生命周期钩子）

> 系统学习（心智模型 / 实现走读 / 鉴权现状 / 测试映射）见仓库 `docs/websocket.md`
>（devkit 包内不含，仓库查看）。

目录内放 `ws.ts`（dev）/ `ws.js`（release，约定同 `api.ts`）即产生一条 WebSocket 路由
`GET {base}/{...path}/ws`：`src/news/ws.ts` → `/v1/api/news/ws`；根级 `ws.ts` → `/v1/api/ws`。
同目录 `ws.ts` 与 `ws.js` 并存时 `.ts` 优先。

**契约（v0.1.9 起，钩子签名不变）**：default 导出生命周期钩子对象，按事件触发：

```ts
export default {
  connection() { /* 连接建立后恰好一次：bus.subscribe 在此 */ },
  message()    { /* 每帧一次：http.body 读帧（JSON 自动 parse；Binary 帧 → null，字节走 http.bodyBytes()） */ },
  error(e)     { /* 任一钩子抛异常时兜底，之后连接继续 */ },
  close()      { /* 收尾恰好一次：客户端断 / socket 断 / ws.close() 三来源统一 */ },
};
```

**执行模型（v0.1.10 帧池）**：每路由 W 个无状态 Worker（`ws.workers_per_route`，默认 2）
共享执行该路由所有连接的帧。连接状态放 `sess.state`（Rust 会话表持久，按连接隔离，
**必须可 JSON 序列化**——函数等不可序列化值静默丢失）；`sess.id` 为连接 id。
模块作用域相当于 Worker 本地的只读缓存（W 个 Worker 就有 W 份副本）：可变的跨帧状态
禁止放模块作用域，路由级可变状态用 kv/bus。

帧超时断开**该连接**（毒化只影响执行帧的 Worker，池自动补员，其它连接无感）。
`ws.max_connections`（默认 1000，0=不限）超限 upgrade 返 503。

- 四钩子全部可选，但**至少导出一个**（全缺 → 连接建立即断）。
- 钩子内用既有全局（`json`/`http`/`ws`/`bus`/`sess`/…），与 HTTP handler 一致；**返回值一律忽略**，
  回帧必须显式 `json.ok` / `ws.send`。
- 可变跨帧状态一律放 `sess.state`（顶层 `const`/`let` 只是 Worker 本地只读缓存，
  不可依赖其跨帧写入生效）；跨连接共享走 kv / bus。
- 帧超时 = 断开该连接（钩子收不到该事件）；`error(e)` 是唯一带参钩子（e 为异常对象）。

注意客户端**主动断连**（先发 Close 帧）的情况：`close()` 钩子仍会触发，服务端副作用
（如 kv 写入）照常生效；但钩子里的 `ws.send` 离帧受 RFC 6455 关闭握手限制，无法送达
客户端。需要离帧可见时，用服务端 `ws.close()` 收尾。

运行案例（摘自 `sample/src/news/ws.ts`）：

```ts
export default {
  connection() {
    sess.state.ready = true;   // 会话状态外置：跨帧持久、按连接隔离
    bus.subscribe("news");
    json.ok({ subscribed: true });
  },
};
```

注意：release 下 root=dist，WS URL 含模块版本段（如 `…/news-0.1.0/ws`）——v0.2 已知限制
（第 13 章）。bus 的发布/订阅方向约定见第 6 章 bus 小节。

### 帧内发布：`ws.ts` 里直接 `bus.publish`

`bus.publish` 没有上下文限制（只有 `bus.subscribe` 限 WS 连接），帧处理器可以直接当
「广播泵」用。可运行案例 `sample/src/news/chat/ws.ts`——聊天室，任意连接发帧，
所有订阅者收广播：

```ts
// connection = 进房，订阅每连接一次；message = 每帧
export default {
  connection() {
    bus.subscribe("chat");
    json.ok({ joined: true });
  },
  message() {
    const frame = http.body;              // JSON 文本帧已自动 parse 成对象
    if (frame && frame.text) {
      bus.publish("chat", { from: frame.from ?? "anon", text: frame.text });
      json.ok({ sent: true });
    }
  },
};
```

帧内发布特有的三条语义（系统学习见仓库 `docs/websocket.md`）：

1. **自回声**：本连接若订阅了同一主题，会收到自己发布的广播帧（fan-out 不排除
   自己）。客户端按 `from` 字段过滤，或者发布到别的 topic。
2. **钩子可直接 `await`**：钩子会被驱动至 Promise 落定才捕获回帧——要拿 `publish`
   返回的「本地接收方数」，直接 `await bus.publish(...)`（kafka/rabbitmq broker 下
   该数恒 0）。
3. **无状态也够用**：钩子共享该路由的 Worker 池，模块作用域只是只读缓存——可变跨帧
   状态放 `sess.state`（按连接隔离）或 kv/bus（跨连接）；聊天室本例全靠 bus 广播，
   无需任何本地状态。

## 5. 导入解析

> 何时读我：import 报错或想抽公共代码时。

### 别名导入（共享库推荐写法）

`#x` 锚在**本模块根**、`#/m/x` 锚在 **src 根**（`m` = 模块目录名）。与目录深度无关，
目录搬动不用改引用：

```ts
// src/user/profile/detail/api.ts —— 无论嵌套多深，写法完全一样
import { positiveId } from "#_shared/validate";        // → src/user/_shared/validate.ts
import { v } from "#_shared";                          // → src/user/_shared/index.ts（目录索引）
import { p } from "#_shared/validate.ts";              // 显式后缀
import { requireRole } from "#/user/_shared/validate"; // 跨模块：首段必须是模块目录名
```

规则与边界：

- 后缀补全与相对导入同序；别名路径禁 `..` / 空段。
- **只能在模块内的文件里用**：模块根由**文件自身位置**派生——从所在目录向上找最近的
  `manifest.yaml` 祖先。`src/tests` 用例目录与任务池在模块外 → 没有锚点，继续用相对路径。
  运行期与构建期**共用同一份探针**（`resolve_relative` / `resolve_alias`），所以 dev 与
  release 对同一 specifier 必然命中同一文件（含目录索引）。
- **跨模块别名需声明依赖**：`manifest.yaml` 的 `deps` 缺目标模块 → `oj build` 报 S008
  （与表归属 S003 同一套归属图）。既有**相对**跨模块引用不追溯（升级不破坏）。
- release：build 期实化为版本目录相对路径，跨模块目标按 `dist/manifests.yaml` 锁钉版本，
  产物内不含 `#`。落盘后有两道断言：单文件无残留别名；本次产出目录内的本地 specifier
  都必须落到已落盘文件。任务池是非版本化资产 → 别名一律拒绝，且池内 import 不得越池根。
- 约束：`manifest.yaml` 只能出现在模块根（嵌套会改写别名锚点 → S008）；release 模式不解析
  别名（`ts=false` 直接报错）。
- **本地导入目标必须是 `.ts`**：`./x.js` / `./d.json` 在产物里没有对应文件（只转译 `.ts`）→
  `oj build` fail-fast（此前静默悬空，release 运行期才炸）。
- 编辑器/测试工具对齐：`tsconfig.json` 的 `paths` 按同规则镜像
  （`"#/*": ["./src/*"]` + `"#*": [各模块 /*]`）。值须带 `./` 前缀——无 `baseUrl` 时非相对值
  会被 vite/esbuild 警告（见 `sample/tsconfig.json`）。L2 vitest 走
  `sample/unit/vitest.config.ts` 的 `resolveId` 插件（同规则镜像）。
- `#` 与 Node `package.json#imports` 共用命名空间：项目若声明 `#` 开头的 imports 键，
  `oj build` 直接失败（避免 Node/vite 与 oj 两套解析器分叉）。

### 相对导入

`./x`、`../x` 自动补全，顺序：`.ts` → `.js` → `/index.ts` → `/index.js`。

```ts
import { positiveId, requireRole } from "../_shared/validate";   // → ../_shared/validate.ts
```

**跨模块相对导入**（如 `idp` 引 `auth` 的工具）：dev 下直接可跑；build 时改写为指向
目标模块版本目录的相对路径——目标模块未构建过则报错，先 `oj build auth` 再
`oj build idp`（摘自 `sample/src/idp/login/api.ts`）：

```ts
import { nowSecs } from "../../auth/_shared/util";
```

### 裸 specifier（node_modules）

`import { escapeHtml } from "escape-goat"` —— 从当前文件目录**逐级向上**找
`node_modules/<pkg>`（至 project root；**全程不 realpath**，pnpm 的符号链接
`.pnpm/<pkg>@<ver>/node_modules/<pkg>` 布局因此可用）。

**入口解析（v0.1.30 起完整支持 `exports`）**：`package.json` 有 `exports` 字段即由它
**完全接管**（Node 封闭语义，未命中报错、**不回落** legacy）——支持字符串形态、
条件对象（import/require 二选一按解析侧取、node/default 恒命中）、子路径键、
`./x/*` 与裸 `*` 模式键、数组 fallback（逐项尝试）。无 `exports` 才走 legacy
`module` → `main` → `index.js`。报错文案：
`Package subpath 'x' is not defined by "exports" in <pkg>/package.json`。
`@scope/name` 与子路径 `pkg/lib/util.js` 同前。

### CJS 互操作

CJS 包自动包装：`module.exports` → `default`；`require("pkg")` 走 `__ojRequire`
（进程级缓存）。**v0.1.30 起**相对 require 可用：`require("./x")` 候选
`x` → `x.js` → `x.json`（JSON 模块）→ `x/index.js` → `x/index.json`；
循环 require 返回部分 exports（Node 语义）；解析结果被钳制在 project root 内。
裸 specifier 的 require 同样读 `exports`（条件取 `require`）。
`require("path")` 等 Node 内建报 `Node builtin 'path' is not available in oj runtime`。

### 安全边界

所有解析结果被**钳制在 project root 内**——`..` 逃逸直接报错。

## 6. 全局对象 API 参考

> 何时读我：写任何 handler 期间，查签名与语义。

签名与 `global.d.ts` 一致（类型权威）。SQL 占位符方言：**sqlite / mysql 用 `?`，
postgres 用 `$1`**；值一律经参数数组绑定。

### 总表（27 组）

| 全局 | 说明 |
|---|---|
| `json.ok(data?)` / `json.fail(code, msg, data?)` / `json.header(name, value)` / `json.redirect(url, code?)` | 统一响应信封、响应头与 3xx 重定向原语（v0.1.26） |
| `http.method / query / headers / body / params / param / tenantId / user / files / file(i)` | 当前请求上下文（只读、懒加载、每请求最新） |
| `db.query / exec / table / tx` | 默认库（`db === DB("default")`） |
| `db.sqlProfile()` / 信封 `_sql` | SQL 执行追踪（v0.1.51，dev 默认开）：本请求画像快照 `{count,totalMs,slow,byDb,events}`；dev 信封自动附加 `_sql` 字段 |
| `DB(name)` | 命名库实例（未配置的名字返回 `undefined`） |
| `kv.get/set/del/expire/incr` | KV 存储（配 `redis.default` → 真 Redis，否则进程内存 KV） |
| `redis.get/set/del/expire/incr` | 与 `kv` 同源同面（真连时二者同栈，auth 会话同库） |
| `blob.put/get/del/url/contentType/copy/move/readRange`（可调用：`blob("name")`） | 对象存储（`blob:` 段启用）；`copy` / `move` / `readRange` 自 v0.1.47（ABI 11）起 |
| `fs.readFile/readTextFile/writeFile/writeTextFile/mkdir/remove/rename/stat/readDir` | 本地文件系统（`fs:` 段启用，v0.1.53）；jail 到 `fs.root`，未配置/越界抛 `NotCapable` |
| `bus.publish / subscribe / kind` | 主题广播（HTTP 发布、WS 订阅） |
| `es.search / index / del` | Elasticsearch 薄客户端（`es:` 段启用） |
| `Mail(key)` / `mail` | 邮件投递（`smtp:` 段 + `oj-mail` 插件启用）：`send / sendSync / enqueue / result / sendRaw`，见下「mail」 |
| `axis(name)` | 泛型插件轴调用面（v0.1.54）：`axis("cache").get("k")`；未知轴抛错并列出可用轴名，见下「axis(name)」 |
| `LDAP(key)` / `ldap` | LDAP 目录查询与鉴证（`ldap:` 段 + oj-ldap 插件启用）。**v0.1.54 起 oj-ldap 迁移泛型轴**：JS 调用面为 `axis("ldap").bind/search/search_paged/whoami/compare`（见下「ldap」与「axis(name)」）；类型化 `ldap`/`LDAP` 全局为遗留双轨面 |
| `Kafka(name)` / `RabbitMQ(name)` | 命名 MQ 客户端（`kafkas:`/`rabbits:` 段；未配置的名 → `undefined`；消费方法仅任务上下文，见下「命名 MQ 客户端与长任务」） |
| `tasks.stopping() / tasks.sleep(ms)` | 长任务上下文：停机信号 + 等待原语（见下「命名 MQ 客户端与长任务」） |
| `log.debug / info / warn / error` | 结构化日志 |
| `fetch(url, options?)` | WHATWG fetch（deno 官方实现，v0.1.8；真 `Response`/`Headers`，https 无需额外配置） |
| `ws.send / close` | WebSocket 帧控制（HTTP 路径下 no-op） |
| `sess.id / sess.state` | WS 连接 id 与会话状态（仅 ws.ts 钩子内；state 须可 JSON 序列化） |
| `new WebSocket(url)` | WHATWG 出站 WS 客户端（任务与 handler 均可用，见下「WebSocket —— 出站客户端」） |
| `plugins()` | 已加载插件自省 + 宿主 ABI |
| `ojInfo()` | 装配期固化诊断（v0.1.54；与 `oj info` CLI 同源）：build/abi/plugins/backends/config 五段，config 只出键名，见下「ojInfo()」 |
| `vars.get(name)` | 部署期常量（顶层 `vars:` 段，v0.1.25）：**同步**返回该键的字符串，未声明键 → `null` |
| `jwt.sign / verify / accessDuration / refreshDuration` | JWT 签发与验签（`auth:` 段注入；未配置调用报错，见第 8 章） |
| `bcrypt.hash / verify` | 密码哈希与校验（Rust 侧 `spawn_blocking`，不卡 isolate） |
| `oidc.sign / verify / jwks` + `oidc.issuer / rp / clients` | RS256 JWS 原语与装配期配置（`oidc:` 段启用；私钥留在 Rust，见第 10 章） |
| `crypto.sha256Hex / randomHex` | sha256 十六进制摘要 / 随机 hex（增补进原生 `crypto`，原生成员保留） |
| `toBigInt(v)` / `toUBigInt(v)` / `toDouble(v)` | **64 位整数转换**：DB 的 i64 超界（雪花 id）读出为十进制字符串，回写用 `toBigInt()`；无符号 64 位（仅 MySQL `BIGINT UNSIGNED`）用 `toUBigInt()`（v0.1.24）；见下「大整数与 i64」 |
| 测试 SDK（`client.*` / `describe / it / expect / beforeEach` / `finish`） | **仅测试文件可用**，见第 9 章 |

### json —— 信封与响应头

| API | 签名 | 说明 |
|---|---|---|
| `json.ok` | `ok(data?: unknown): void` | 成功信封 `{code:0,msg:"ok",data}`，HTTP 200 |
| `json.fail` | `fail(code: number, msg: string, data?: unknown): void` | 失败信封，HTTP 状态 = `code`（`code<=0` 映射 500） |
| `json.header` | `header(name: string, value: string): void` | 追加响应头（v0.1.46）：同名可重复——`Set-Cookie` 双发（登录端点同响应下发 `oj_sess` + `oj_csrf`）合法落多个值；其余头同名最后一个生效 |
| `json.raw` | `raw(data: unknown): void` | **裸 JSON 200（无 `{code,msg,data}` 信封）**，content-type 默认 `application/json`（`json.header` 可覆盖）。对外标准协议端点用（OIDC discovery/jwks/token/userinfo）；错误仍走 `json.fail` 信封 |
| `json.redirect` | `redirect(url: string, code?: number): void` | **3xx 重定向原语**（v0.1.26）：`Location` + RFC 9110 §15.4 短超文本注记（HEAD 请求为空 body），content-type 默认 `text/html; charset=utf-8`。`code` 非 3xx **回落 302**（杜绝「200 + Location」畸形响应）；空 url 忽略 `Location`。具名封装：`movedPermanently`(301) / `found`(302) / `seeOther`(303，跟随后改 GET) / `temporaryRedirect`(307，方法/体保持) / `permanentRedirect`(308，永久 + 方法保持)。典型：302 到 `blob.url()` 预签名 URL（`scenarios.md` 场景 8） |
| `json.stream` | `stream(opts?: { status?: number; contentType?: string }): StreamWriter` | **流式响应**（v0.1.35）：打开裸 body 流（绕过信封），返回 `{ write(chunk), end() }`；默认 HTTP 200，可经 `opts.status` / `opts.contentType` 覆盖。`write` 入参 string/ArrayBuffer/ArrayBufferView/TypedArray |
| `json.sse` | `sse(opts?: { status?: number; contentType?: string }): StreamWriter` | **SSE 流**（v0.1.35）：等同 `json.stream` 但强制 `Content-Type: text/event-stream`，每次 `write` 的「数据」自动包成 `data: <内容>\n\n` 帧；`opts` 同 `json.stream` |

> **流式 / SSE 响应（v0.1.35）**：`json.stream` / `json.sse` 返回 `StreamWriter`（`{ write(chunk), end() }`）。
> 数据通道解耦于 isolate 生命周期——handler 退出后 isolate 归还池、但响应继续向客户端推送；
> **不调用 `end()` 也会在 `read_capture` 阶段自动关流**（心跳任务经 `Notify` 退出）。
> 限制：流式响应**绕过** `{code,msg,data}` 信封（直接写裸 body）；心跳保活间隔 15s（`:\n\n`）；
> `opts` 仅支持 `status` / `contentType` 两字段，不支持额外 SSE 字段（如 `event:` / `id:` 需自行拼进 `write` 内容）。

```ts
json.ok({ created: true });
json.fail(400, "name required");
json.fail(404, "no such account", { id });
json.header("X-Request-Id", "abc");
// 重定向（v0.1.26）：不要再用 header+fail 拼——那是失败信封体，非标准形态。
json.redirect.found(await blob.url(key)); // 302 到预签名 URL，浏览器两跳直取
json.redirect.seeOther("/v1/api/order/list/"); // POST 提交后跳转：跟随后一律 GET

// v0.1.35：流式 / SSE（绕过信封，直接写裸 body）
const s = json.stream({ contentType: "text/csv" });
s.write("a,b\n"); s.write("1,2\n"); s.end();          // 普通流式
const e = json.sse();
e.write("hello"); e.write("world");                    // 自动包成 data: hello\n\n / data: world\n\n
```

### http —— 请求上下文

| API | 类型 / 签名 | 说明 |
|---|---|---|
| `http.method` | `string` | 请求方法（`GET`/`POST`/…） |
| `http.query` | `Record<string, string>` | query 参数对象（form-urlencoded 解码：`+`→空格、`%XX`） |
| `http.headers` | `Record<string, string>` | 请求头对象 |
| `http.body` | `any` | 请求体（解析规则见第 4 章）；WS Binary 帧时为 `null` |
| `http.bodyBytes` | `bodyBytes(): Promise<Uint8Array>` | 原始请求体字节（WS 帧场景 v0.1.16 起；HTTP 大体亦可经此取字节） |
| `http.params` | `Record<string, string>` | 路径参数对象（已 percent-decode；目录镜像路由下恒空） |
| `http.param` | `param(name: string, def?: unknown): any` | **路径参数优先，query 兜底**，均缺失返回 `def` 原值 |
| `http.tenantId` | `string \| null` | 租户 id（`tenant.enable` 时从租户头提取；未启用为 `null`） |
| `http.user` | `AuthUser \| null` | 已验签用户 `{id, roles, claims}`；auth 启用且请求通过 Bearer 守卫（进 handler 前统一验 token 的那道检查）才有值，否则 `null` |
| `http.files` | `UploadedFileMeta[]` | multipart 上传元信息 `[{field, filename, content_type, size, key, url}]`；非 multipart 为空数组。**`key`/`url`（v0.1.38）**：流式大文件（> `max_upload`，服务端直落 blob）的 blob 对象 key 与下载地址；小文件为 `null` |
| `http.file` | `file(i: number): Promise<Uint8Array>` | 第 i 个上传文件的字节（越界报错 `no such file`；**流式大文件报错**并指路 `files[i].key`/`.url`——小文件行为不变） |

```ts
const id = Number(http.param("id", 0));   // /item/42?id=9 → "42"（路径优先）
const page = http.param("page", 1);       // 无路径参数 → query 兜底 → 默认 1
```

### db / DB(name) —— 数据库

| API | 签名 | 说明 |
|---|---|---|
| `db.query` | `query(sql: string, params?: unknown[]): Promise<Row[]>` | 参数化查询 → 行数组 |
| `db.exec` | `exec(sql: string, params?: unknown[]): Promise<number>` | 参数化执行 → 受影响行数 |
| `db.stream` | `stream(sql: string, params?: unknown[], opts?: { onRow?: (row: Row) => void; signal?: AbortSignal }): Promise<void> \| AsyncIterable<Row>` | **流式查询**（v0.1.37，PR-2 Phase A）。逐行拉取大结果集，避免一次性 `db.query` 全量驻留。两种形态见下 |
| `db.table` | `table(name: string): QueryBuilder` | 安全查询构造器（标识符白名单 + 参数化值） |
| `db.nextSeq` | `nextSeq(name: string): Promise<number \| string>` | **平台序列分配**（v0.1.24）。单语句原子取号，是 `max+1` 竞态的终态方案。首次使用自动建平台表 `_oj_sequences`。**库级、跨租户共享**——需隔离就把租户拼进 `name`；`name` 请用服务端常量；账号需 DDL 权限或由迁移预建该表；`memory://` 不支持。`db.tx` 内调用搭车同一连接 |
| `db.tx` | `tx(fn: (tx: DBInstance) => unknown): Promise<unknown>` | 事务（语义见下） |
| `db.asSystem` | `asSystem(): DBInstance` | 本请求以系统身份绕过租户防护（v0.1.15，仅 tenant.sql_guard 活跃时有意义；请求级生效 + 审计日志，业务 handler 禁用） |
| `db.asTenant` | `asTenant(id: string): DBInstance` | 匿名请求**声明**租户身份（v0.1.20）——仍强制租户条件，只是把 `tenant_id` 由 `id` 填充；需 `tenant.allow_as_tenant: true` 且请求为匿名（见下） |
| `DB(name)` | `(name: string) => DBInstance \| undefined` | 命名库实例；全部方法与 `db` 同签名 |
| `db.sqlProfile()` | `sqlProfile(): { count: number; totalMs: number; slow: Array<{sql,ms,db}>; byDb: Record<string,{count,ms}>; events: Array<{sql,params,db,inTx,source,ms,rows,ok,error}> }` | **SQL 执行追踪**（v0.1.51，dev 默认开）：本请求累计的 SQL 统计 + 慢查询 + 逐条事件；追踪关闭时返回空对象 |

**SQL 执行追踪**（v0.1.51，开发期可观测性）：

dev 模式（无 `dist/manifests.yaml`）默认开启 SQL 追踪，release 默认关闭（可由 `db_trace.enabled: true` 强制开）。所有 SQL（`db.query/exec/stream`、`db.tx` 内 `tx.query/exec`、`db.nextSeq`）在 op 层统一计时并产出事件，同时喂给两个出口：

- **dev 日志**：每条 SQL 打 `target="oj::sql"` 的结构化日志，含 `sql` / `db` / `ms` / `rows` / `tx`（是否事务）/ `src`（模块名）/ `status` / `err`——直接看 stderr 即可定位慢查询与失败 SQL。
- **`db.sqlProfile()`**：返回本请求画像快照（汇总在 `count`/`totalMs`/`byDb`、慢查询速览在 `slow`、逐条回放在 `events`）。handler 想看时自己调，例如把画像塞进响应或打点：
  ```js
  const rows = await db.query("select * from account where id = ?", [id]);
  const prof = db.sqlProfile();   // { count, totalMs, slow, byDb, events }
  log.info(`ran ${prof.count} SQL in ${prof.totalMs.toFixed(1)}ms`);
  ```
- **dev 信封 `_sql`**：dev 追踪开启且本请求有 SQL 事件时，`json.ok/fail` 的标准信封自动追加兄弟字段 `_sql`（= 画像快照），裸 `curl` 即可见，无需改动 handler。生产追踪关闭时信封不变。

**参数脱敏（红线）**：`db_trace.redact_params` 默认 `true`。画像（`db.sqlProfile()`）与响应信封 `_sql` 里的 `params` **永远**只记「参数个数」（如 `"3 params"`），**绝不**把密码/手机号等经客户端响应外泄。只有服务端 dev 日志（`target="oj::sql"`）在 `redact_params: false` 时才会记参数原值（JSON 序列化），仅供本地排障。

**`db_trace` 配置段**（顶层；`db` 是 name→DSN 的 map 不能塞）：
```yaml
db_trace:
  enabled: true        # 缺省 = dev 自动开 / release 自动关；可强制
  redact_params: true  # 默认 true：画像/信封只记个数；false 仅让 dev 日志记原值（响应仍脱敏）
  slow_ms: 0           # 慢查询阈值(ms)；0 = 全收（日志与 slow 列表均不过滤），>0 按阈值过滤
  to_log: true         # 是否写 dev 日志（dev 默认每条约一行；高频场景可调高 slow_ms 降噪）
```


**查询构造器**（流式、结构化；SQL 由服务端按库方言生成）：

```ts
const rows = await db.table("account")
  .select(["id", "name"])
  .where({ field: "role", op: "eq", value: "admin" })
  .where({ field: "id", op: "gt", value: 0 })     // 多个 where 之间 AND
  .orderBy([{ field: "id", dir: "desc" }])
  .limit(10)
  .offset(0)
  .all();                                          // → Promise<Row[]>（每行 = 列名 → 值）
```

- `WhereCond`：`{ field: string; op?: string; value?: unknown }`。
  操作符：`eq / ne / gt / gte / lt / lte / in（值须数组）/ like / isnull`；未知操作符直接报错。
- `OrderByItem`：`{ field: string; dir?: "asc" | "desc" | null }`。
- **红线**：标识符（表/列/别名）只来自 SchemaRegistry 白名单（启动内省所得），值一律经绑定参数。
  SQL 注入面为零；未知表/列报错，排序列另有可排序白名单。`limit` 缺省 100、硬上限 1000。
- 构造器自动按库方言出 SQL（sqlite/mysql/postgres），业务无需手写方言差异。

**条件树（where 嵌套）**：

```ts
await db.table("account").where({
  and: [
    { field: "age", op: "gte", value: 18 },
    { or: [
      { field: "role", op: "eq", value: "admin" },
      { field: "tag", op: "isnull" },
    ]},
  ],
}).all();            // → WHERE age >= ? AND (role = ? OR tag IS NULL)
```

- 树节点四形：叶子 `{field, op, value?}`、`{and:[...]}`、`{or:[...]}`、`{not:{...}}`。
- 深度上限 8、叶子数上限 64（超限报 `condition tree too deep/large`）；空 `and`/`or` 组直接拒绝。

**条件对象（JS 侧组合/复用）**：`db.leaf(field, op, value)` / `db.and(...)` / `db.or(...)` /
`db.not(c)` 工厂产出条件对象；`where`/`having` 同时接受条件对象或普通 JSON 树。

```ts
const scope = db.and(
  db.leaf("tenant_id", "eq", tid),
  db.leaf("deleted", "eq", 0),
);
const rows = await db.table("account").where(scope).all();
if (!scope.has("tenant_id")) throw new Error("tenant scope required");  // 多租户守卫
```

- 条件对象**不可变**：`c.and(x)` / `c.or(x)` / `c.not()` 返回新对象，不改 `c`。
- `.tree()` 取纯 JSON 树；`.fields()` 取去重字段名列表；`.has(f)` 判断是否涉及某字段。

**join 联表**：

```ts
await db.table("account")
  .join("user", [{ left: "account.user_id", right: "user.id" }], "left")
  .select(["account.id", "user.name"])
  .all();
```

- `on` 只支持列对列等值（`{left, right}` 数组，非空）；`kind` 省略为 `inner`，可选 `left`。
- 列可写 `"表.列"`（表 ∈ 基表 ∪ join 表）或裸列名。裸列名**只解析基表**，有歧义直接拒绝；
  联表查询建议全限定。
- join 表同样过租户/所有权守卫；**自 join 不支持**（无表别名）。

**聚合 / groupBy / having / distinct**：

```ts
await db.table("order")
  .select([
    "user_id",
    { fn: "sum", field: "amount", as: "total" },
    { fn: "count" },                       // count(*) 可省 field
  ])
  .groupBy(["user_id"])
  .having({ field: "total", op: "gt", value: 100 })
  .all();
```

- 聚合列 `{ fn: "count"|"sum"|"avg"|"min"|"max", field?: string, as?: string }`；
  别名形状 `^[A-Za-z_][A-Za-z0-9_]*$`（违例报 `illegal alias`）。
- `having` 白名单列优先，未命中按 select 聚合别名展开（`unknown column '...' in having`）。
  PG 不允许 HAVING 引用输出别名，展开能消灭方言分叉；orderBy 不支持聚合别名（仍走列白名单）。
- `.distinct()` 去重（仅 select）。

**DML：insert / update / delete**（`.run()` 终执行，返回受影响行数；`.all()` 仅 select）：

```ts
await db.table("user").insert({ name: "neo", age: 1 }).run();        // 单行
await db.table("user").insert([{ name: "a" }, { name: "b" }]).run(); // 多行（键集须一致）
await db.table("user").update({ age: 2 }).where({ field: "id", op: "eq", value: 1 }).run();
await db.table("user").delete().where({ field: "id", op: "in", value: [1, 2] }).run();
```

- **红线**：`update`/`delete` 必须带 where 且叶子数 ≥ 1。JS 链层早抛（`update requires where`），
  op 侧同样强制——`fromJSON` 可完全绕过 JS 链层，所以动词×字段矩阵以 **op 侧校验为权威**。
- 动词×字段矩阵：`insert` 拒 `where/orderBy/limit/offset/joins/distinct/groupBy/having`，
  `values` 非空且多行键集一致；`update`/`delete` 拒 `joins/distinct/groupBy/having/limit/offset`，
  `update` 的 `sets` 非空；`select` 拒 `values/sets`。违例报 `<verb> does not accept <field>`。
- insert 键 / update 键均过白名单（`unknown column '<k>' in insert values / update sets`）。
- `db.tx` 内构造的 DML 自动走事务同连接（见下）。

**insert 取回主键 `.returning([...])`**（`run()` 改返回行数组，不返回行数）：

```ts
const rows = await db.table("user").insert({ name: "neo", age: 1 }).returning(["id"]).run();
// → [{ id: 7 }]；无 returning 时 run() 仍返回受影响行数 number
```

- 只 `insert` 接受（`select/update/delete` 报 `<verb> does not accept returning`），列过
  白名单（`unknown column '<c>' in insert returning`，限定名不适用）。
- pg / sqlite：sea-query 渲染 `INSERT ... RETURNING "id"`，**单语句一次往返**取回——
  替代原先「exec 后再查 `last_insert_rowid()` 可能读到并发插入」的裸 SQL 写法。
- mysql：方言无 RETURNING，`returning` 只接受**单列**；op 在同一执行目标上两步
  （insert + `SELECT LAST_INSERT_ID()`），**并发下请放进 `db.tx`** 保证同连接。

**toSQL / toJSON / fromJSON**：

```ts
db.table("user").select(["id"]).where({ field: "age", op: "gt", value: 18 }).toSQL();
// → { sql: "SELECT ... WHERE \"age\" > $1", params: [18] }  （占位符按目标库方言；不执行）

const snap = db.table("user").select(["id"]).where(scope).toJSON(); // 纯 JSON 快照，可直接改
snap.limit = 50;
await db.fromJSON(snap).all();   // 复原后继续链/执行；tx 回调对象上同样有 fromJSON
```

- 快照里的 `db` 字段只是**创建时的 JS 可见名**；`fromJSON` 复原的实例绑定**复原方的 bound db**
  （快照可跨模块传递而不泄漏源模块的库绑定）；tx 内执行自动走事务同连接。
- **大整数参数在 `toSQL().params` 里是 marker，不是字符串**（v0.1.24 订正）：`>2^53-1` 的整数
  以 `{"$oj$i64":"…"}` / `{"$oj$u64":"…"}` 形式出现，这样
  `db.query(toSQL().sql, ...toSQL().params)` 才**真的可回放**（此前被降成字符串 → PG 报
  `bigint = text`）。比较 params 文本的代码请按 marker 取值。

**事务 `db.tx`**：

```ts
// 转账 50：构造器 sets 只接受常量 → 先读余额再写
await db.tx(async (tx) => {
  const from = await tx.table("account").select(["id", "balance"])
    .where({ field: "id", op: "eq", value: 1 }).all();
  const to = await tx.table("account").select(["id", "balance"])
    .where({ field: "id", op: "eq", value: 2 }).all();
  await tx.table("account").update({ balance: from[0].balance - 50 })
    .where({ field: "id", op: "eq", value: 1 }).run();
  await tx.table("account").update({ balance: to[0].balance + 50 })
    .where({ field: "id", op: "eq", value: 2 }).run();
  const rows = await tx.table("account").select(["id", "balance"]).all(); // 同连接读未提交
});
```

- 回调正常返回 → **提交**；throw / reject → **回滚**并把原错误抛给 handler（v0.1.52 起
  rollback 本身失败也不掩盖业务异常，始终抛 handler 的原始错误）。
- `tx` 与 `db` 的 `query / exec / table / fromJSON` 及条件工厂（`leaf/and/or/not`）
  **同签名**——事务内自动走同一连接，无需改写其余代码。注意回调对象不含 `tx`，嵌套事务被拒。
- 每请求**至多一个**活跃事务：嵌套 `db.tx` 报错 `transaction already active`；
  事务未完结时访问其它库报错（先结当前事务）。
- handler 忘记 `await` 或中途崩溃：请求结束时未完结事务**自动回滚**（服务端打 warn 日志）。
- **多租户防护在事务内同样生效**：租户注入（select 收窄 / insert 强制写当前租户 /
  update/delete 收窄 / `sets.tenant_id` 拒绝）发生在**路由之前**，与「走池还是走会话」
  正交。`tx.table(...)` 与 `db.table(...)` 得到完全相同的改写。裸 SQL（`tx.query`）
  只有 best-effort 文本检查，事务内也应优先构造器。

**子查询 / exists**（where 与 having 通用）：

```ts
await db.table("user")
  .select(["id", "name"])
  .where({ field: "id", op: "in", subquery: db.table("order")
      .select(["user_id"]).where({ field: "amount", op: "gt", value: 100 }) })
  .all();          // → WHERE id IN (SELECT user_id FROM order WHERE amount > ?)

await db.table("user").select(["id"]).where({
  exists: db.table("order").select(["user_id"])
    .where({ field: "amount", op: "gt", value: 100 }),
}).all();          // → WHERE EXISTS (SELECT user_id FROM order WHERE amount > ?)（非关联）
```

- 叶子操作符 `in/eq/ne/gt/gte/lt/lte` 接受 `subquery`（builder 或纯 JSON 请求）：
  `in` 渲染 `IN (SELECT ...)`，其余渲染标量子查询 `col = (SELECT ...)`。
- `value` 与 `subquery` 互斥（`value and subquery are mutually exclusive`）；
  `isnull`/`like` 不接受子查询。`{ exists: <子查询> }` 节点不得携带其他键。
- 子查询同样过租户/所有权守卫；嵌套约束见下。

**union / union all**（排序/分页仅顶层）：

```ts
await db.table("vip").select(["id", "name"])
  .union(db.table("black").select(["id", "name"]))            // 缺省 distinct
  .union(db.table("tmp").select(["id", "name"]), "all")       // union all
  .orderBy([{ field: "id", dir: "asc" }])
  .all();
```

- 主查询与成员都须**显式列**（`union requires explicit columns`）且列数一致；
  成员禁 order_by/limit/offset（`union member does not accept order_by/limit/offset`）。
- 成员同样过租户守卫；`intersect`/`except` 不做。

**case 列 / 窗口函数列**（select 列的对象形）：

```ts
await db.table("account").select([
  "id",
  { case: { when: [
      { cond: { field: "balance", op: "lt", value: 0 }, then: "debt" },
      { cond: { field: "vip", op: "eq", value: 1 }, then: "vip" },
    ], else: "normal" }, as: "level" },          // → CASE WHEN ... THEN ? ... ELSE ? END
  { window: { fn: "row_number", partition_by: ["user_id"],
      order_by: [{ field: "amount", dir: "desc" }] }, as: "rn" },
]).all();
```

- case：searched case；`cond` 与 where 条件树同形；`then`/`else` **只允许 JSON 值**（绑定参数，
  不接受列名/标识符）；`as` 必填过别名形状。
- window：`fn ∈ row_number / rank / dense_rank`；`partition_by` 列过白名单；frame 不做；`as` 必填。

**with CTE**（非递归，仅顶层）：

```ts
await db.table("rich")
  .with("rich", ["user_id", "total"], db.table("order")
    .select(["user_id", { fn: "sum", field: "amount", as: "total" }]).groupBy(["user_id"]))
  .select(["user_id", "total"])
  .all();          // → WITH rich(user_id, total) AS (SELECT ...) SELECT ... FROM rich
```

- `.with(name, columns, query)`：`name`/`columns` 过别名形状（`illegal alias '...'`）；
  `columns` 必填非空（`cte needs non-empty columns`）——**声明的输出列即后续解析的白名单**。
- 基表/join 表名命中 CTE 名时跳过 registry 表校验（CTE 无 owner）；CTE 查询递归过守卫。

**嵌套通用约束**（子查询 / exists / union 成员 / CTE 一致）：

- 层数上限 4（`<site>: nested select too deep`，site 为出错位置）；嵌套必须 select
  （`<site>: nested select must be select`）；嵌套禁 with/unions
  （`<site>: nested select does not accept with/unions (v1)`）。
- 隐式默认 limit 只作用于**顶层**查询；嵌套/成员不隐式截断（显式 limit 一律生效）。
  默认值由 `db_query.default_limit`（默认 100）给出，显式 limit 被 `db_query.max_limit`
  （默认 1000）clamp；两者均可在配置中调整（硬顶 100000）。顶层结果为数组且行数 ≥ 生效
  上限时，响应带 `X-OJ-Row-Limit: <上限>` 头提示可能被截断。

#### 流式查询 db.stream（v0.1.37，PR-2 Phase A）

`db.query` 一次性把整张结果集拉进内存再序列化回 JS；结果集很大（导出、ETL、大表遍历）时
会撑爆 handler 内存或触碰信封体积上限。`db.stream` 改为**逐行**从后端拉取，由 JS 一边收一边
处理（写 `json.stream`、落库、累积聚合等），常驻内存只是一条行。

**两种形态**：

1. **回调形态（推荐）**：`opts.onRow(row)` 逐行回调。回调内可自由 `await`（例如每行 `json.sse`
   推一帧、或 `db.exec` 落库）。`db.stream` 返回的 Promise 在流走完（含正常结束与中止）后 resolve，
   异常时 reject（被 `await` 或 `.catch` 捕获）。适合「边收边写」的导出/推送场景。

   ```ts
   // 大表导出为 CSV 流式响应（边收边写，常驻内存仅一行）
   const s = json.stream({ contentType: "text/csv" });
   s.write("id,name\n");
   await db.stream(
     "select id, name from account order by id",
     null,
     { onRow: (row) => s.write(`${row.id},${row.name}\n`) },
   );
   s.end();
   ```

2. **异步迭代器形态（逃生舱）**：不传 `onRow` 时返回 `AsyncIterable<Row>`，可用 `for await`
   消费。每行即一条 `Row`（JSON 对象）；流结束自然退出。

   ```ts
   const out = [];
   for await (const row of db.stream("select id, name from account order by id")) {
     out.push(row);
   }
   ```

**中止（取消）**：传入 `opts.signal`（WHATWG `AbortSignal`，如 `AbortController.signal`），
在 `abort` 事件触发时由桥接层调用 `op_db_stream_abort` 通知后端 pump 中止，流提前结束。`signal`
通过 `addEventListener` 接线，流走完会自动 `removeEventListener`，无需手动清理。

```ts
const ac = new AbortController();
db.stream("select * from huge_table", null, { signal: ac.signal, onRow: (r) => {
  if (r.id > 1_000_000) ac.abort();   // 够了就停
}});
```

**限制与边界**：
- 仅支持**非事务**目标（`DB(name)` 的直连池）。在 `db.tx(...)` 内部调用 `db.stream` 直接报错
  `db.stream within an active transaction is not supported (streaming queries run on the connection pool only)`。
- **后端支持**（v0.1.38 起 ABI 10）：核心 `SqlxAccessor`（sqlite/mysql/postgres）、内置
  InMemory 与第一方插件 `oj-db-mysql`/`oj-db-postgres`（vtable 批量 pull，≤100 行/次）均
  **真流式**。第三方插件若未实现流式槽（open 哨兵 `{"unsupported":true}`），宿主**回落
  `db.query` 全量**（行为等同 `db.query`，仅失去流式内存优势，不报错）。
- `db.stream` 与 `db.query` 返回**内容一致**（同一查询的逐行等价于全量数组）；差异只在内存形态。
- 取消（`signal`）按后端分两档：
  - **第一方插件 `oj-db-postgres` / `oj-db-mysql` 在 `postgres://` / `mysql://` DSN 下走
    **专用连接**（`pg_cancel_backend(pid)` / `KILL QUERY conn_id` + 断连）——服务端查询**立即
    终止（真取消）**，正在跑的慢查询在 `information_schema.processlist` / `pg_stat_activity`
    中秒级消失；sqlx 的 Drop 不通知服务器，故取消为显式发令，非靠断连。
  - **core 后端（sqlite）与第一方插件的 Any 回退路径**为**协作式取消**（批间生效，下一批返回
    `{"error":"cancelled"}`）。
  - 取消 = **流干净提前结束**（消费端收到 done，不报错；服务端行缓冲有界——64 行——消费端不
    拉取时后端拉取同步暂停）；已回调/已迭代的行不回滚。

### 大整数与 i64（v0.1.22）——雪花 id / 长主键必读

JS 的 `number` 只有 f64 精度（安全整数上界 **`2^53-1`**，约 9007199254740991）。雪花 id、
跑到后期的自增主键都远超它，所以平台按**值域**分流：

| DB 值（BIGINT） | JS 侧 | 例 |
|---|---|---|
| `\|v\| ≤ 2^53-1` | `number` | `42` |
| `\|v\| > 2^53-1` | **十进制字符串**（逐字精确） | `"4886674138783273204"` |

（REAL/DOUBLE 列仍是 `number`；`es.search` 的 long 字段同规则。）

- **`toBigInt(v): bigint`** —— 字符串/安全范围内的 number/bigint → 精确 64 位整数。
  **fail-loud**：`Number("<大整数串>")` 的产物、`1.5`、`"007"`、超 i64 等一律 **throw**。
- **`toUBigInt(v): bigint`** —— 同上但为**无符号** 64 位 `[0, 2^64-1]`（v0.1.24）。
  **只有 MySQL `BIGINT UNSIGNED` 列能承载**；PG / SQLite 传它会明确报错（它们的 bigint 就是
  i64），请把这类值存成 text 或换库。跨 op 编码为 `{"$oj$u64":"<十进制>"}`。
- **`toDouble(v): number`** —— 显式接受 f64（可能丢精度）。没有 `toFloat`（JS 无 f32 语义）。

```ts
// ✅ 取号首选：平台序列（v0.1.24）——原子、并发安全，无需自己拿锁
const id = await db.nextSeq("order_no");                    // 1, 2, 3…（超出 2^53-1 给字符串）

// ✅ 需要自己维护一张业务序列表时（读出来是字符串，算完用 toBigInt 写回）
const rows = await db.query("select max(id) as m from seq");
const next = toBigInt(rows[0]?.m ?? "0") + 1n;
await db.exec("insert into seq (id) values (?)", [next]);   // bigint → 精确绑定 i64
json.ok({ id: next });                                      // 出线是字符串

// ✗ 事故写法：Number() 静默坍缩到 f64 网格 → 下次分配撞主键 dup 500
const seq = Number(rows[0].m) + 1;
```

- **字符串是文本意图，BigInt 是整数意图**：平台不做启发式猜测。回传**字符串**写 bigint 列在
  PostgreSQL 上必然报错（`column "x" is of type bigint but expression is of type text`）；
  MySQL/SQLite 会隐式转换，但不要依赖方言差异。
- `json.ok / json.raw / json.fail / log 字段 / mail` 容忍 bigint（自动出十进制字符串）；
  **`es` / `bus` / `mq` / `jwt` / `ws.sess.state` 不容忍**——跨这些边界先 `String(v)`。
- `max+1` 并发下有竞态（会分配出相同序号）——**用 `db.nextSeq(name)`**（v0.1.24）。
  序列值不随调用方事务回滚而回退，按「只增不复用」理解；平台表 `_oj_sequences` 由平台自建自管，
  业务不要手工读写或迁移它。
- **保留键红线**：`$oj$` 前缀是平台内部线格式（`toBigInt()` 编码为 `{"$oj$i64":"<十进制>"}`，
  `toUBigInt()` 为 `{"$oj$u64":"<十进制>"}`）——业务 JSON 数据不得以这类 `$oj$` 键为唯一键，
  否则在**参数位置**会被当作整数绑定。
- **MySQL 读侧的列类型边界（v0.1.24 定稿，MySQL 用户必读）**：**可读** = 整数家族（含
  `BIGINT UNSIGNED`）、文本家族（`TEXT`/`VARCHAR`/`CHAR`/`ENUM`）、二进制、`FLOAT`/`DOUBLE`；
  **其余一律报错**：`DECIMAL`/`NEWDECIMAL`、`DATE`/`TIME`/`DATETIME`/`TIMESTAMP`/`YEAR`、
  `JSON`、`BIT`、`GEOMETRY`。报错会点名列名与 MySQL 类型并给指路，**不会静默变 `null`**。
  需要读这些列时**在 SQL 里显式转换**：`select cast(amount as char) as amount from t`。
  另：`BOOLEAN`/`TINYINT(1)` 读出的是 **`1`/`0`（number）**，不是 `true`/`false`。
- 完整契约、判据表与排障见仓库 `docs/numeric-limits.md`；另见 `scenarios.md` 场景 7。

### kv / redis —— KV 存储

| API | 签名 | 说明 |
|---|---|---|
| `kv.get` | `get(key: string): Promise<string \| null>` | 取值（缺失 `null`） |
| `kv.set` | `set(key: string, value: string): Promise<boolean>` | 写值 |
| `kv.del` | `del(key: string): Promise<boolean>` | 删键 |
| `kv.expire` | `expire(key: string, ttlSec: number): Promise<boolean>` | 设过期（秒）；真 Redis 走 EXPIRE，内存 KV 惰性过期 |
| `kv.incr` | `incr(key: string): Promise<number>` | 自增返回新值（键不存在从 0 起） |

（`redis.get / redis.set / redis.del / redis.expire / redis.incr` 与上表同签名——二者同源同面。）

```ts
// 读穿缓存（摘自 sample/src/order/detail/api.ts，改编）
const hit = await kv.get(key);
if (hit !== null) { json.ok({ cached: true, data: JSON.parse(hit) }); return; }
```

`redis` 全局与 `kv` 同源：`redis.default` 配置即真连（fail-fast），此时两者都走 Redis，
auth 会话也在同一 Redis（多实例共享的前提）；未配置时均为进程内存 KV。

### blob —— 对象存储（`blob:` 段启用，未配置调用即报错）

| API | 签名 | 说明 |
|---|---|---|
| `blob(name?)` | 可调用取命名实例：`blob("media").put(...)`；裸调用 `blob.put(...)` 等价 `blob("default")` | 命名多后端对应 config `blob.backends.<name>` |
| `blob.put` | `put(key: string, bytes: Uint8Array, contentType?: string): Promise<boolean>` | 写对象（local 落盘 / s3 上传） |
| `blob.get` | `get(key: string): Promise<Uint8Array>` | 读对象（不存在报错） |
| `blob.del` | `del(key: string): Promise<boolean>` | 删对象（幂等：不存在视为成功） |
| `blob.url` | `url(key: string): Promise<string>` | 下载地址：local = `{base}/blob/{key}`；s3 = presigned URL（15min） |
| `blob.uploadUrl` | `uploadUrl(key: string, opts?: { kind: string }): Promise<{ url: string }>` | 上传直传预签名（v0.1.30）：s3 后端返回 15min 预签名 PUT URL，客户端直传**不经 handler**（绕开 `max_upload_bytes`/30s）；`opts` 缺省 `{"kind":"put"}`，multipart 形态暂返回 Err。local 后端无预签名——报 `local blob backend has no upload presign; use the direct PUT upload route`，改用直传路由 |
| `blob.contentType` | `contentType(key: string): Promise<string \| null>` | Content-Type（local 读 sidecar / 按扩展名推断；缺失且无法推断返回空串；s3 无 Content-Type 返回 `null`） |
| `blob.copy` | `copy(src: string, dst: string): Promise<boolean>` | **服务端复制（v0.1.47，ABI 11）：src 保留**。local = `fs::copy`；s3 = CopyObject。**字节不进 V8**——大文件搬运的替代写法（不要 `get` + `put`）。`src == dst` 为 no-op；src 不存在报错 |
| `blob.move` | `move(src: string, dst: string): Promise<boolean>` | **服务端搬移（v0.1.47，ABI 11）：src 不再存在**。local 同父目录 = `fs::rename`（原子、零字节），跨目录 = copy + unlink；s3 = CopyObject + DeleteObject。`src == dst` 为 no-op |
| `blob.readRange` | `readRange(key: string, offset: number, len: number): Promise<Uint8Array>` | **区间读（v0.1.47，ABI 11）：短读截断**——`offset + len` 越过对象尾部只返回实际可读字节（可能短于 `len`），`offset` 已过尾部返回**空数组**；key 不存在报错；`offset`/`len` 为负 / 非整数 / NaN 报错（`blob readRange: offset must be a non-negative integer`）。后端不支持区间读时宿主回落 `get` 全量再切片（local/s3 均原生支持） |

**上传四件套完整例子**（摘自 `sample/src/upload/api.ts`）：

```ts
export default {
  async post() {
    const f = http.files[0];                    // 1. 元信息
    if (!f) json.fail(400, "need a file field (multipart)");
    const b = await http.file(0);               // 2. 字节
    await blob.put(f.filename, b, f.content_type);  // 3. 存储
    json.ok({ key: f.filename, url: await blob.url(f.filename), size: b.length });  // 4. 下载地址
  },
  async del() {
    await blob.del(http.param("k", ""));
    json.ok({ ok: true });
  },
};
```

下载走内置公开路由 `GET {base}/blob/{key}`（免鉴权、不落业务表；local 直出字节 +
Content-Type，s3 302 跳 presigned URL）。key 按 `/` 分段白名单校验
（第 13 章路径安全）。上传体积上限 `server.max_upload_bytes`（超限 413）。

**大文件直传（v0.1.30，>10MB 或上传+处理超 30s 的场景）**：不经 handler 的两条直传路——
① s3 后端：`blob.uploadUrl(key)` 拿预签名 PUT URL 给客户端直传；② 任意后端：
`PUT {base}/blob/{key}` 内置路由（**过鉴权守卫**，Bearer/cookie 即令牌；体积上限独立
`server.blob_upload_max_bytes`，默认 1 GiB；不经 JsActor，无 30s 限制）。下载侧 local
内联腿支持 `Range` 单区间（206 + Content-Range；越界 416），pdf.js/媒体 seek 直接可用。

**multipart 大文件流式落 blob（v0.1.38）**：multipart 上传不再整段缓冲——**大于
`server.max_upload_bytes` 的文件字段由服务端流式写进 blob**（local 落盘 / s3 multipart，
单文件上限 `server.blob_upload_max_bytes`，服务端内存恒定），此时 `http.file(i)` 会报错
（文件字节不进 handler），改用 `files[i].key`（`blob.get(key)` 读全文）或 `files[i].url`
（下载/外链地址）；**≤ `max_upload` 的小文件行为完全不变**（`http.file(i)` 照常给字节）。
服务端代分配的 key 形如 `uploads/<时间戳>-<序号>-<安全化文件名>`。

**服务端搬运与区间读（v0.1.47，ABI 11）**：大文件的三件事不该让字节进 V8——

```ts
// ① 搬运：流式落盘的临时对象转正（不要 blob.get + blob.put，那是 2× 峰值）
await blob.move(file.key, `docs/${id}/${file.filename}`);
// ② 复制：src 保留（快照/多版本场景）
await blob.copy(src, dst);
// ③ 区间读：嗅探 / 魔数判定只读前 4KB，不必 get 全文
const head = await blob.readRange(key, 0, 4096);
```

- `copy` / `move` 由后端服务端完成（local：`fs::copy` / 同目录 `fs::rename`；s3：CopyObject
  / CopyObject+DeleteObject）；`move` 后 **src 不再存在**，`copy` 后 src 保留。
- `readRange` 是**短读截断**语义：越尾只读到实际末尾，`offset` 过尾返回空数组——先判空
  再按 `head.length` 定分支，不要假设一定拿满 `len`。
- 后端不支持这三件事时宿主回落（`copy` → `get`+`put`、`readRange` → `get` 全量切片），
  即 JS 侧永不因后端能力失败，但回落**字节进 V8**——local/s3 均原生支持，回落只是保险。
- `src == dst` 是 no-op（`fs::copy` 同文件语义未定义，会截断文件，故显式挡掉）。

### fs —— 本地文件（`fs:` 段启用，未配置调用即报错）

一次性读写 API（移植自 Deno `deno_fs`），**无 fd/流式句柄**——op 内自开自关，
池化 runtime 无跨请求 fd 泄漏面。与 `blob` 分工：blob 走对象存储（大文件/共享），
fs 走服务进程本地磁盘（配置、模板、落盘导出等小对象）。

| API | 签名 | 说明 |
|---|---|---|
| `fs.readFile` | `(path: string) => Promise<Uint8Array>` | 读二进制 |
| `fs.readTextFile` | `(path: string) => Promise<string>` | 读 UTF-8 文本 |
| `fs.writeFile` | `(path: string, data: Uint8Array) => Promise<void>` | 写二进制（覆盖） |
| `fs.writeTextFile` | `(path: string, data: string) => Promise<void>` | 写文本（覆盖） |
| `fs.mkdir` | `(path: string, opts?: {recursive?: boolean}) => Promise<void>` | 建目录 |
| `fs.remove` | `(path: string, opts?: {recursive?: boolean}) => Promise<void>` | 删除 |
| `fs.rename` | `(oldPath: string, newPath: string) => Promise<void>` | 移动/重命名 |
| `fs.stat` | `(path: string) => Promise<FileInfo>` | 元数据（`size` / `mtime` / `isFile` / `isDirectory` …） |
| `fs.readDir` | `(path: string) => Promise<AsyncIterable<DirEntry>>` | 列目录：迭代项 `{name, isFile, isDirectory, isSymlink}`（**不是字符串数组**）；迭代完自动关闭目录句柄 |

路径规则：**相对路径解析到 jail 根（`fs.root`）之下**（不是进程 cwd）；绝对路径必须在
root 内。越界（`..`、root 外绝对路径、root 内指向外部的 symlink）→ `NotCapable`；
readonly 下写类 API → `NotCapable`；路径不存在 → `NotFound`。
大文件不要走 fs（一次性 API 整体进内存）——GB 级请用 `blob`。

```yaml
fs:
  root: ./data     # jail 根；相对路径按 config.yaml 所在目录解析（缺省 "data"）
  readonly: false  # true = 写类 API 全拒
```

### bus —— 订阅发布

| API | 签名 | 说明 |
|---|---|---|
| `bus.publish` | `publish(topic: string, data?: unknown \| Uint8Array): Promise<number>` | 广播给订阅该 topic 的**全部 WS 会话**，返回接收方数（无订阅返回 0）：JSON 数据 → Text 帧 `{"topic":…,"data":…}`；Uint8Array/ArrayBuffer → **Binary 帧原字节**（不包信封，v0.1.16 起，wire 约定见第 13 章） |
| `bus.subscribe` | `subscribe(topic: string): Promise<void>` | 当前 WS 会话订阅 topic（**HTTP 路径调用报错**——订阅对象是连接本身） |
| `bus.kind` | `kind(): Promise<string>` | 活跃 broker 类型：`"local"` / `"kafka"` / `"rabbitmq"`（异步 op，判等须 `await`） |

方向约定：**HTTP handler 发布，WS 会话订阅**。订阅在连接断开自动清除；同一会话重复订阅
幂等去重。`bus.kind()` 为异步，返回 `Promise<string>`，判等须 `await bus.kind()`。

```ts
// HTTP 发布（任意 api.ts）
const n = await bus.publish("news", { text: "hi" });
json.ok({ receivers: n });

// WS 订阅（ws.ts 内，见第 4 章 ws.ts 小节）
bus.subscribe("news");
```

缺省 `broker` 为进程内总线（跨实例不互通）；`broker.kind: kafka|rabbitmq` 需对应插件。

### es —— Elasticsearch（`es:` 段启用，未配置调用报 `es not configured`）

| API | 签名 | 说明 |
|---|---|---|
| `es.search` | `search(index: string, dsl?: unknown): Promise<Json>` | `POST {endpoint}/{index}/_search`，直通 ES 响应体 |
| `es.index` | `index(index: string, id: string, doc?: unknown): Promise<Json>` | `PUT {endpoint}/{index}/_doc/{id}?refresh=true`（写完即可查） |
| `es.del` | `del(index: string, id: string): Promise<Json>` | `DELETE` 同路径（幂等，缺失返回 404 体） |

index / id 限 `[a-zA-Z0-9_-]+`（防路径注入）；非 2xx 报错带 ES 返回体。

### mail —— 邮件投递（`smtp:` 段 + `oj-mail` 插件启用）

> 完整手册（架构/插件内幕/附件与 raw 语义/反馈通道/安全清单/运维与已知限制）：
> `docs/mail-smtp.md`。本节为业务速查。

配顶层 `smtp:` 段即启用全局 `Mail` / `mail`（`mail === new Mail("default")`）；未配置时调用报
`mail not configured (config smtp: section missing, or oj-mail plugin not loaded)`。
**投递**在 `oj-mail` 插件内（lettre 连接池 + 有界队列 + worker 池）；**宿主**（即 oj 进程
本身）负责入参校验（CRLF 剥离/地址强校验/白名单）、附件字节解析、结果存储与 bus 反馈。
凭据只在 config → 插件，**不进 JS**（`Mail.profiles()` 只列 profile 名）。

| API | 签名 | 说明 |
|---|---|---|
| `new Mail(key)` | `Mail(key?: string)` | profile 实例；`key` = `smtp:` 段里的 profile 名（缺省 `"default"`），未声明的 key 报错（不回落 default） |
| `mail.send` | `send(m: SendRequest): Promise<Envelope>` | 异步 transport；resolve 投递结果信封 |
| `mail.sendSync` | `sendSync(m: SendRequest): Promise<Envelope>` | 同步 transport（插件 worker 内 `spawn_blocking` 投递） |
| `mail.enqueue` | `enqueue(m: SendRequest): Promise<Envelope>` | 入队即回 `{code:0,data:{jobId}}`；真实完成经 `mail.result` 与 bus 上送。**jobId 由宿主生成**（调用方传入值被剥离） |
| `mail.result` | `result(jobId: string): Promise<Json \| null>` | 查宿主侧结果（未命中/已过期/**非本归属** → `null`）。归属 = `new Mail(key)` 的 key + 模块 + 租户：跨 profile/模块/租户都拿不到（用 bus `mail.result` 做跨模块通知） |
| `mail.sendRaw` | `sendRaw(o: SendRawRequest): Promise<Envelope>` | 原始 MIME 投递（`raw` 原文 + 结构化 `from`/`to` 作信封；与 `attachments` 互斥） |
| `Mail.profiles` | `Mail.profiles(): Promise<string[]>` | 已配置 profile 名清单（**非密钥面**） |

`SendRequest` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `from` | `string` | 必填，发件人（`user@domain`；须命中 `allowed_from`） |
| `to` / `cc` / `bcc` | `string[]` | `to` 至少一个；三者全部须命中 `allowed_recipients` |
| `subject` | `string?` | 主题（换行被**剥离**，非拒绝） |
| `text` / `html` | `string?` | 正文（换行原样保留）；两者至少给一个，或带附件 |
| `headers` | `Record<string,string>?` | 自定义报头（值剥 CRLF）；**不得**覆盖 From/To/Cc/Bcc/Subject |
| `attachments` | `Attachment[]?` | 见下 |
| `sync` / `enqueue_only` | — | **JS 侧无效**：宿主按调用方法（`send`/`sendSync`/`enqueue`）覆写 |

附件（**引用式**，字节不进 JS、不走 base64；`filename` 必填，来源二选一）：

```ts
attachments: [
  { filename: "report.pdf", blobKey: "r2d2" },              // blob 后端（blob 字段选后端，缺省 default）
  { filename: "note.txt", path: "reports/note.txt", mime: "text/plain" },  // 项目根内本地文件
]
```

- `path` 必须落在**项目根**内（`../` 越界即拒；符号链接经 canonical 化覆盖，读盘用同一
  canonical 句柄防 TOCTOU）。
- MIME 三源决议：显式 `mime` → 文件扩展名 → 字节嗅探 → `application/octet-stream`。
- **大小上限**（`smtp.max_attachment_bytes` 默认 10 MiB / `smtp.max_total_attachment_bytes`
  默认 25 MiB）：超限 `code:5`；`path` 路先看长度，超限文件不读进内存。
- `sendRaw` 与 `attachments` **互斥**（原文自带内容）。

信封与错误码：所有方法都 resolve 信封（**只有「未配置 mail」抛异常**）：

| `code` | 含义 |
|---|---|
| `0` | 成功：`data.messageId` 为投递凭据（异步 transport 为 SMTP 应答文本，FileTransport 为落盘 `.eml` 文件名主干）；`data.jobId` 为作业号 |
| `1` | 网络/连接/超时，**以及一切投递期失败**（含 SMTP 5xx/鉴权失败；原始错误只出脱敏分类文案）；亦含「投递未能送达插件」 |
| `2` / `3` | **当前未启用**：首版不细分 SMTP 5xx（`2`）与鉴权失败（`3`），两类均归 `1`（保持 `msg` 脱敏、不泄露 SMTP 对话）。按错误码分支的代码请以 `code !== 0` 判失败 |
| `4` | 队列满（背压，`enqueue` 亦回同一 jobId） |
| `5` | 入参校验失败（地址非法/白名单未命中/缺正文/附件形态错/路径越界/超限/未知 profile） |

**`code !== 0` 一律不得自动重试**：`2`/`3` 未启用，永久失败（SMTP 5xx / 鉴权）与瞬时失败
（连接/超时）都归 `1`，从 `code` 分不出可重试性；自动重试会把永久失败反复重投。

**白名单是唯一控制点，且 fail-closed**（宁可全拒也不误放行）：`allowed_from`/`allowed_recipients`
为**全等**匹配（大小写不敏感），**空表 = 拒绝**——不写白名单就发不出任何信。

- 条目两种合法写法：**完整地址**（`noreply@x.com`，只命中该地址自身，**不**命中
  `evil-noreply@x.com`）与 **`@domain`**（`@x.com`，只命中域全等，**不**命中子域
  `a@sub.x.com`；子域须显式写 `@sub.x.com`）。**不做**子域通配。
- 条目格式在启动期校验：空串、裸域（`x.com`）、首尾空白一律让配置解析失败
  （不会退化成「静默不命中」）。

异步反馈（`enqueue` 的双通道之一）：真实完成经 bus topic `mail.result` 扇出**扁平结果**
（`{jobId, code, msg, messageId?}`，**不含**收件人/主题）：

```ts
const res = await mail.enqueue({ from: "noreply@x.com", to: ["a@x.com"], text: "hi" });
if (res.code !== 0) return json.fail(res.code, res.msg);
const jobId = res.data.jobId;          // 入队成功；真实结果稍后到位
// WS 会话侧订阅（见第 4 章 ws.ts）：
bus.subscribe("mail.result");
```

配置（详见 `sample/config.yaml`；`smtp:` 顶层除 `workers`/`queue_capacity` 外每个键都是一个 profile）：

```yaml
smtp:
  workers: 4
  queue_capacity: 256
  max_attachment_bytes: 10485760        # 单附件上限（字节，默认 10 MiB；超限 → code:5）
  max_total_attachment_bytes: 26214400  # 单封附件合计上限（字节，默认 25 MiB）
  default:
    host: smtp.example.com
    port: 465
    tls: tls                 # tls（隐式 TLS）| starttls（强制升级）| none（明文，须 allow_none_tls: true）
    mechanism: login         # login（user + pass）| xoauth2（user + xoauth2.access_token）
    user: api@example.com
    pass: "change-me"
    timeout: 30
    allowed_from: ["noreply@x.com"]
    allowed_recipients: ["@x.com", "@partner.com"]
  mock:                      # 本地落盘通道：不发网络（目录须先存在），测试/归档用
    host: localhost
    port: 25
    tls: none
    allow_none_tls: true
    mechanism: login
    file_transport: "/tmp/oj-mail-eml"
    allowed_from: ["noreply@x.com"]
    allowed_recipients: ["@x.com"]
```

```ts
export default {
  async post() {
    const r = await new Mail("default").send({
      from: "noreply@x.com",
      to: ["a@x.com"],
      subject: "欢迎",
      text: "正文",
      attachments: [{ filename: "note.txt", path: "reports/note.txt" }],
    });
    if (r.code !== 0) return json.fail(r.code, r.msg);   // 校验失败也是 resolve（不抛）
    json.ok({ messageId: r.data.messageId, jobId: r.data.jobId });
  },
};
```

门禁与常见坑：`tls: none` 必须显式 `allow_none_tls: true`（fail-closed）；`mock` 等
FileTransport profile 也须写 `host`/`port`/`tls`/`mechanism`（插件 schema 必填，只是不联网）；
`file_transport` 目录**须先存在**（lettre 不建目录）；未装插件先跑 `cargo xtask plugin mail`。

**「试发/健康检查」怎么写**（管理端「发送测试邮件」这类需求）：直接用本 profile 的
**`mail.send`**——它 resolve 的就是**投递结果**，`code !== 0` 即失败并带脱敏原因，
正确凭据必然真发（不是「配置齐备性检查」）：

```ts
const r = await mail.send({ from: "noreply@x.com", to: [adminEmail], subject: "test", text: "ping" });
json.ok({ sent: r.code === 0, messageId: r.data?.messageId });
```

**凭据只在 config → 插件，不支持按调用方传入凭据**（不是缺口，是红线：一旦 JS 能传 SMTP 凭据，
任何越权 handler 都能把平台当开放中继用）。要「换凭据立刻生效」= 改 config 的 `smtp:` 段后重启/
热加载配置，不是从请求体里带。

**要「投递成功」才算数**（邮件审计表的 `sent_at` 这类）：别只写 `enqueue`——用 `mail.send` /
`sendSync` 拿**同步结果**再落库（`enqueue` 的语义是「已入队」，不是「已送达」）；需要事后通知
则订阅 bus `mail.result`（只覆盖 `enqueue` 路，且跨 profile/模块/租户归属收窄）。

### ldap —— LDAP 目录与鉴证（`ldap:` 段 + `oj-ldap` 插件启用）

> 完整手册（鉴证模式/filter 注入防护/二进制属性/运维/已知限制）见 `docs/ldap-integration.md`。

配顶层 `ldap:` 段并装配 `oj-ldap` 插件即启用。**v0.1.54 起 oj-ldap 已迁移泛型轴**：
JS 调用面为 **`axis("ldap")`**（`generic(ldap)` 声明，走泛型轴通道），5 个 op 与旧
类型化 API 语义一致；宿主类型化 `ldap`/`LDAP` 全局保留但装配迁移版插件后调用报
`ldap not configured`（双轨期；加载旧版 typed oj-ldap 时 `ldap.*` 仍可用）。
**协议交互**在 `oj-ldap` 插件内（ldap3 客户端：每调用独立 connect → 服务账号绑定 →
操作 → unbind，无连接池）；入参校验与错误文案与旧版逐字一致。错误模型同 `db`：
**除「未配置」外，校验/协议/网络错一律抛异常（Promise reject）**——别用 `try/catch`
当业务分支，只有 `bind` 的「凭据被拒」是正常返回 `false`。

| op（`axis("ldap")`） | 调用 | 说明 |
|---|---|---|
| `bind` | `axis("ldap").bind(dn, pw, opts?): Promise<boolean>` | simple_bind 鉴证。`true` = 绑定成功；`false` = LDAP 拒绝该凭据（含 rc 49 invalidCredentials）；连接/协议错误**抛异常** |
| `search` | `axis("ldap").search(base, opts?): Promise<Entry[]>` | 目录查询；大结果集请用 `search_paged`（无分页时服务端可拒超量返回） |
| `search_paged` | `axis("ldap").search_paged(base, opts?): Promise<Entry[]>` | RFC 2696 分页聚合（逐页取回后合并；服务端不支持分页控制时原样回落单次 search）。`pageSize` 1..=10000，默认 500 |
| `whoami` | `axis("ldap").whoami(opts?): Promise<string>` | whoami 扩展（RFC 4532）→ `"dn:cn=svc,…"` 形式的 authzid |
| `compare` | `axis("ldap").compare(dn, attr, val, opts?): Promise<boolean>` | 属性值比对（compareTrue/False），不读出整条目 |

```ts
type LdapOpts = {
  key?: string;                     // 实例名（ldap: 段的顶层键；缺省 "default"）
  scope?: "base" | "one" | "sub";   // search/search_paged；默认 "sub"（整棵子树）
  filter?: string;                  // RFC 4515 过滤器，默认 "(objectClass=*)"
  attrs?: string[];                 // 要读的属性名；缺省/空数组 = 服务端默认属性集
  pageSize?: number;                // 仅 search_paged；1..=10000，默认 500
  bindDn?: string;                  // 覆盖本次查询的绑定凭据（与 config 合并，取一即可；
  bindPw?: string;                  //   另一个回落 config）。仅 search / search_paged 支持
};
type LdapEntry = {
  dn: string;
  attrs: Record<string, string[]>;  // 文本属性（多值即多元素）
  bin: Record<string, string[]>;    // 二进制属性（jpegPhoto 等），base64 编码字符串
};
```

鉴证（最常见用途——用 AD/OpenLDAP 校验登录）：

```ts
export default {
  async post() {
    const { username, password } = http.body();
    const found = await axis("ldap").search("ou=users,dc=example,dc=com", {
      filter: `(uid=${username})`,   // 用户名 → DN（filter 注入见下）
      attrs: ["uid"],
    });
    if (found.length !== 1) return json.fail(401, "invalid credentials");
    const ok = await axis("ldap").bind(found[0].dn, password);   // false = 密码错，不抛
    if (!ok) return json.fail(401, "invalid credentials");
    json.ok({ uid: found[0].attrs.uid[0] });
  },
};
```

配置（`ldap:` 段，每个顶层键 = 一个实例；未知键/坏 url 启动即报错）：

```yaml
ldap:
  default:
    url: ldaps://dc.example.com:636      # ldap://（明文）或 ldaps://（隐式 TLS）
    bind_dn: cn=svc,ou=app,dc=example,dc=com   # 服务账号：search/whoami/compare 前置绑定
    bind_pw: "change-me"                 # 凭据只在 config → 插件，不进 JS
    timeout_ms: 5000                     # 连接与操作超时（100..=3600000，默认 5000）
  ad:
    url: ldap://ad.internal:389
    start_tls: true                      # 明文口上 StartTLS 升级（ldaps:// 上配置即报错）
    tls_skip_verify: true                # 自签 CA 测试用；生产关掉
```

- `bind_dn`/`bind_pw` 不再强制成对：`bind_dn` 可单独配（服务账号 DN 非密码，可留配置）；
  `bind_pw` 缺失时可在每次 `search`/`search_paged` 用 `opts.bindPw` 作为运行时参数补上
  （与 config 的 `bind_dn` 合并，取一即可）。**只为「有 `bind_pw` 却无 `bind_dn`」报错**
  （凭据无绑定目标）。都不配时 search 以匿名绑定执行（多数目录默认拒匿名读，届时报
  「insufficient access rights」类错误）。
- 错误文案：`ldap: unknown instance 'x'（known: …）`（key 未声明）、`ldap.bind: 'dn' must
  be a non-empty string`（入参校验）、`ldap: connect ldap://…: io error`（网络/拒连）、
  `ldap: service bind …: rc=49 …`（服务账号凭据错）、`ldap.search: 'bindDn'/'bindPw' must
  be a string`（opts 类型校验）、`bind_pw requires bind_dn (set both in config, or supply
  bindPw per search call)`（config 只有密码无 DN）。全部 reject，不会 resolve 半个信封。
- **filter 注入**：`filter` 是拼进 LDAP 查询的字符串，`(uid=${username})` 若 `username`
  含 `*`/`()`/`\` 会改变查询语义（LDAP 无参数绑定）。**先转义**（把 `*` `(` `)` `\` NUL
  前缀 `\`）或用 `axis("ldap").compare` 收口。

### log —— 结构化日志

| API | 签名 |
|---|---|
| `log.debug` | `debug(msg: string, ...kv: unknown[]): void` |
| `log.info` | `info(msg: string, ...kv: unknown[]): void` |
| `log.warn` | `warn(msg: string, ...kv: unknown[]): void` |
| `log.error` | `error(msg: string, ...kv: unknown[]): void` |

键值对交替传参（zap SugaredLogger 风格）：`log.info("order created", "id", id, "amount", amount)`。
输出经 `tracing-subscriber` 结构化打印（第 12 章日志）。

### fetch —— HTTP 客户端（WHATWG，v0.1.8）

标准 WHATWG `fetch`（deno 官方 deno_fetch 实现，v0.1.8 起整体替换自研 reqwest 版）：
`fetch(url | Request, init?)` → 真 `Response`——`ok / status / statusText /
headers: Headers / json() / text() / arrayBuffer() / body（ReadableStream）`。
`Headers` 大小写不敏感：`r.headers.get("content-type")`。`method / headers /
body / signal / redirect` 均按标准语义：body 支持 `string | Uint8Array`（不再限于
字符串），字符串 body 默认 `Content-Type: text/plain;charset=UTF-8`，取消走
`AbortController`（全局已挂载，如 `AbortSignal.timeout(5000)`）。

https/wss 无需额外配置：webpki-roots 根集编译进二进制（`bridge::ws_client_extensions`
注入 `FetchOptions`，https fetch 与 wss 握手共用）。网络错误折叠为 `TypeError`
（`Invalid URL…` / `error sending request…`），非 2xx 照常返回 `Response`
（`ok === false`），都不抛 HTTP 状态错。

```ts
const r = await fetch("https://api.example.com/v1/ping", {
  signal: AbortSignal.timeout(5000),
});
if (r.ok) {
  json.ok(await r.json());
}
```

### ws —— WebSocket 帧控制

| API | 签名 | 说明 |
|---|---|---|
| `ws.send` | `send(data: string \| Uint8Array): void` | 向当前连接发一帧：string → Text 帧（0x1），Uint8Array → Binary 帧（0x2，v0.1.16 起）；HTTP 路径下 no-op |
| `ws.close` | `close(): void` | 结束当前连接 |
| `ws.join` | `join(room: string): void` | 当前连接加入房间（v0.1.30；仅 ws handler 内，连接身份自动取） |
| `ws.leave` | `leave(room: string): void` | 当前连接离开房间（v0.1.30；仅 ws handler 内；断连自动摘除，无需兜底） |
| `ws.broadcast` | `broadcast(room: string, data: string \| ArrayBuffer \| Uint8Array): number` | 房间扇出（v0.1.30）：**除己**送达成员数（socket.io 语义，发送者要回声自己在 JS 里发）；HTTP handler 也可调（无连接身份 = 不排除任何人）。v0.1.52 起 data 与 `ws.send` 对称：string → Text 帧、ArrayBuffer/Uint8Array → Binary 帧；其余类型**报错**而非发垃圾帧 |
| `ws.roomSize` | `roomSize(room: string): number` | 房间当前成员数（v0.1.30；presence 最小原语，任意上下文可调） |

房间是**进程内**单例 hub；跨实例扇出仍走 `bus.publish`。
| `sess.id` | `number`（只读） | 当前连接 id（路由内自 1 递增） |
| `sess.state` | 读写属性 | 连接会话状态（Rust 会话表持久，按连接隔离）；**必须可 JSON 序列化**——函数等不可序列化值静默丢失 |

仅在 `ws.ts` 钩子内有意义（第 4 章 §ws.ts——帧池执行模型与 sess 约束）。

### WebSocket —— 出站客户端（WHATWG，v0.1.7 起）

标准 WHATWG `WebSocket`（deno 官方实现）：`new WebSocket(url)`、
`onopen/onmessage/onclose/onerror`、`send/close`。**任务文件与 HTTP handler 均可用**，
无 MQ 式 task 门禁（连接无 offset/ack 消费会话语义）。

长任务里作消费端取数（`src/tasks/task_*.ts`，写法同「命名 MQ 客户端与长任务」，
可运行案例 `sample/src/tasks/task_wsclient.ts`）：

```ts
const ws = new WebSocket("ws://localhost:9778/v1/api/news/ws");
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
ws.send("{}");                                  // 连上即已订阅（connection 钩子）；此帧触发 message（无则 no-op）
ws.onmessage = (e) => log.info("frame " + e.data);
```

**重连 = 崩溃监督，不手写 reconnect**：`onerror`/`onclose` 后让任务抛错（或像案例那样
在下一轮 `if (closed) throw`）→ `Crashed` → 监督器指数退避重启（1s→2s→…cap 60s）→
新实例重连。停机时在 `stop_grace_secs` 内 `ws.close()` 自然收场（`Stopped`）。

三条硬约束（全部来自真实踩坑）：

1. **鉴权（v0.1.30 起）在握手，不在帧内**：WS 升级握手**过 oj-auth 守卫**
   （`verify(path_no_base, "GET", authorization, headers JSON)`，401 不升级）——
   Cookie 头浏览器自动带（cookie 会话形态天然覆盖 WS）；Bearer 客户端可挂
   Authorization 头。**存量升级注意**：此前 WS 天然匿名，v0.1.30 起要把 ws 路径加进
   `anonymous_paths` 才恢复匿名（sample 已配 `/news/ws`）。受保护数据的订阅鉴别
   因此不再需要首帧 token 握手。
2. **URL 主机名要匹配服务端绑定语义**：服务端缺省监听 `[::1]`（IPv6 回环），写
   `127.0.0.1` 会 connection refused，改用 `localhost`。
3. **等帧必须与停机信号竞速**：挂在 `await` 上没人 wake，会拖到看门狗强杀记 `killed`；
   用 `Promise.race([wake, tasks.sleep(250)])`，轮询间隔 ≪ `stop_grace_secs`
   （与 MQ poll 的 `timeoutMs` 纪律同源）。

wss 自 v0.1.8 起可用（webpki-roots 根集，见上「fetch」节）。`oj test` 运行时
同样挂载该全局。出站客户端教学见 [docs/websocket.md](../websocket.md) §7。

### plugins —— 插件自省

签名：`plugins(): any[]`。返回已加载插件清单
`[{name, semver, abi_version, fingerprint, description, host_abi_version}]`——用于升级核对窗口
（第 11 章插件升级）；`description` 为插件作者自述。v0.1.54 起插件**自报轴清单**
（`oj_plugin_axes()`）；v0.1.58 起插件声明了但宿主不认识的类型化轴名在装配期 stderr 告警后忽略（不再出现在 `plugins()`/`{base}/plugins` 输出里）
（旧插件无此字段）。同一清单经内置端点 `GET {base}/plugins` 公开（不走 Bearer，运维/监控用）。

```ts
json.ok(plugins());
```

### axis(name) —— 泛型插件轴调用面（v0.1.54）

插件经入口宏 `generic(name) => &VT` 声明的**泛型轴**（不占 9 个类型化轴槽、零 ABI 变更）
经统一通道暴露给 JS：`axis(name)` 返回一个 Proxy，任意方法名 = 该轴的一个 op：

```ts
await axis("cache").get("k");                       // op "get"，args ["k"]
await axis("cache").set("k", 42, { ttl: 60 });      // 末位对象 = opts（轴自定义）
await axis("ldap").search_paged("dc=example,dc=com", { pageSize: 1000, key: "ad" });
```

- **同步返回 Promise**；args 经 BigInt-safe `ojStringify` 序列化（plain `JSON.stringify`
  遇 BigInt 会抛，这里安全）。
- 未知轴抛 `unknown generic axis '<name>' (available: [<可用轴名>])`；op 本身的语义/校验/错误
  文案归插件（如 oj-ldap 的 `ldap: unknown op 'x'（known: …）`），future Err 原样 reject。
- **信任边界**：泛型轴是插件自报的任意调用面——参数与返回值都是跨 FFI 边界的 JSON，
  插件自身负责校验（与类型化轴同一信任模型）；handler 侧把 axis 当「带名字的
  `fetch`」对待，别把不可信输入直接拼进 op 语义。
- 泛型轴名**应避开** 9 个保留名（es/db/blob/bus/kv/auth/mq/mail/ldap）；确要撞名（如
  oj-ldap 即 `ldap`）须部署宿主 ≥ v0.1.54——旧宿主会经 per-axis 符号把泛型轴误 cast
  成类型化轴，UB。

### ojInfo() —— 装配期固化诊断（v0.1.54）

与 `oj info [-c config.yaml]` CLI **同一装配体**（`assemble_ojinfo` 单一事实源）的
JS 出口：handler 里 `ojInfo()` **同步**返回五段诊断对象（装配期冻结，无 IO）：

```jsonc
{
  "build":   { "oj": "0.1.54", "profile": "release", "host_triple": "…", "v8": "…", "exe": "…" },  // config_path 仅 oj info CLI 出，JS ojInfo() 无此字段
  "abi":     { "abi_version": 11, "host_fingerprint": "…" },
  "plugins": [ { "name": "…", "semver": "…", "abi_version": 11, "fingerprint": "…",
                 "description": "…", "host_abi_version": 11 } ],
  "backends":{ "db_schemes": {"declared": ["default"]}, "blob_configured": true, "kv_plugin": true,
               "auth_plugin": true, "mail_plugin": false, "ldap_plugin": false, "es_plugin": false,
               "mq_plugins": ["kafka"], "bus_kinds": ["local"], "dbs_registered": ["sqlite", "mysql", "postgres", "memory"] },
  "config":  { "sections": ["auth", "db", "server", …], "unconsumed": ["cahce"] },
  "generic_axes": ["ldap", "cache"],
  "unconsumed_sections": ["cahce"]
}
```

- **零值泄漏安全语义**：只报**声明面**——不 connect 任何库/broker；config 只出**段名/键名**，
  值一律不出（DSN、密钥、ENC[...] 明文都不可能经此泄漏）。
- **没有公共 HTTP 端点**（与 `plugins()` 不同）：要对外透出就自己包一个业务路由
  （加鉴权），handler 进程内直接调即可。
- `unconsumed_sections` / `config.unconsumed`：装配期诊断——顶层 config 段没被宿主也没被
  任何已加载插件消费（`config: "key"` 自报或 `plugins:<name>` 非空透传才算消费）。
  典型成因：段名拼错，或对应插件没装。启动时 stderr 也会打同名告警。

### vars —— 部署期常量（顶层 `vars:` 段，v0.1.25）

「换域名 / 换环境就得重新构建产物」的老问题的正解：把这类常量写进 config 的 `vars:` 段，
handler 用 `vars.get(name)` 读。**同步**（装配期冻结的表，无 IO，同 `plugins()`），
所以可以直接当普通值用：

```ts
const web = vars.get("WEB_URL") ?? "http://localhost:3000";
json.ok({ reset_link: `${web}/reset-password?token=${t}` });
```

| API | 签名 | 说明 |
|---|---|---|
| `vars.get` | `get(name: string): string \| null` | 已声明键 → 该字符串；**未声明 / 未配置 `vars:` 段 → `null`**（不抛错，用 `??` 兜底即可） |

**fail-closed（安全边界）**：只有 `vars:` 段里声明的键可读，且平台**没有**「读任意 OS env /
读任意 config 键」的通道——`db:` 的 DSN、`server.public_key_path`、`smtp:` 的凭据因此不可能
经此泄漏到 JS。旧的「三层 env 叠加」早已删除，单文件 config 是唯一真相源。

**值只能是标量**：字符串/数字/布尔按 YAML 字面量成串读（`PORT: 3000` → JS 收到 `"3000"`，
`FLAG: true` → `"true"`）；嵌套 map/list 属配置解析错误（启动即报错）。要区分「没配」与
「配了空串」，注意空串原样返回、不是 `null`。

```yaml
vars:
  WEB_URL: "https://app.example.com"
  SUPPORT_EMAIL: "support@example.com"
```

### jwt —— JWT 签发与验签（`auth:` 段启用）

secret / 算法 / 有效期由 config `auth:` 段在装配期注入，handler 不接触密钥；
`auth:` 未配置时调用报 `jwt not configured`。`iat` / `exp` 由 Rust 侧补（JS 不可控有效期），
`exp` 取 access 时长。

| API | 签名 | 说明 |
|---|---|---|
| `jwt.sign` | `sign(payload: { sub: string; roles?: string[] }): string` | 签发 access token（payload 至少含 `sub`，`roles` 缺省空数组） |
| `jwt.verify` | `verify(token: string): { sub, roles, iat, exp }` | 验签 + 过期检查（leeway 0）；篡改 / 过期 / 算法不符直接抛错 |
| `jwt.accessDuration` | `readonly number` | 配置的 access 有效期（秒；getter 惰性求值） |
| `jwt.refreshDuration` | `readonly number` | 配置的 refresh 有效期（秒） |

```ts
const token = jwt.sign({ sub: user.id, roles: user.roles });   // 登录端点签发
const claims = jwt.verify(token);                               // 受守卫保护的端点一般直接读 http.user
```

### bcrypt —— 密码哈希（始终可用）

哈希与校验在 Rust 侧 `spawn_blocking` 执行，CPU 密集不卡 isolate；**不依赖 `auth:` 段，
未配置鉴权也可用**（校验不需密钥）。

| API | 签名 | 说明 |
|---|---|---|
| `bcrypt.hash` | `hash(password: string, cost?: number): Promise<string>` | 生成 bcrypt 哈希（cost 缺省库默认） |
| `bcrypt.verify` | `verify(password: string, hash: string): Promise<boolean>` | 校验；非法 hash 返回 `false`（不抛错） |

```ts
const ok = await bcrypt.verify(password, row.password_hash);   // false = 口令不符或 hash 非法
```

### crypto —— 摘要与随机数（增补进原生 crypto）

bootstrap 对 `crypto` 做 `Object.assign` 合并。**不依赖 `auth:` 段，始终可用。**
v0.1.30 起补齐 Web 面：`crypto.getRandomValues(view)` 为 oj 实现（原生不存在）——
任意 TypedArray view 填充后返回原 view，非 view 抛 TypeError，单次 ≤65536 字节
（对齐 WebCrypto）；wasm-bindgen 胶水（`WebAssembly.instantiate` + getRandomValues +
atob/btoa）经 L1 实测可用，wasm 引擎包可进 oj runtime。

| API | 签名 | 说明 |
|---|---|---|
| `crypto.sha256Hex` | `sha256Hex(s: string): string` | UTF-8 编码后的 sha256 十六进制摘要 |
| `crypto.randomHex` | `randomHex(nBytes?: number): string` | `nBytes` 字节随机数的 hex（缺省 32 字节） |
| `crypto.getRandomValues` | `getRandomValues(view: ArrayBufferView): ArrayBufferView` | 填充随机字节（v0.1.30） |
| `crypto.aesGcmEncrypt` | `aesGcmEncrypt(plaintext: string, key: string): string` | AES-GCM 对称加密（v0.1.35）：明文 UTF-8，密钥 16/32 字节 hex 或 base64，返回 `base64(nonce ‖ ct ‖ tag)` |
| `crypto.aesGcmDecrypt` | `aesGcmDecrypt(ciphertext: string, key: string): string` | AES-GCM 解密（v0.1.35）：输入 `aesGcmEncrypt` 的密文，返回原文；密钥/密文错抛错 |

另：全局 `atob(s)` / `btoa(s)` 标准 base64（v0.1.30；非法输入抛
`InvalidCharacterError`），wasm 胶水常用。

> **AES-GCM 应用层加解密（v0.1.35）**：`crypto.aesGcmEncrypt` / `aesGcmDecrypt` 为纯应用层
> 对称加密——**密钥由调用方自行保管**（不进 config、不托管）。适合对落库前/传输前的字段做加密。
> 密钥仅支持 **16 字节（AES-128）或 32 字节（AES-256）**的 hex / base64 编码；**不支持
> AES-192**（上游 crate 未提供），传入 24 字节密钥会明确报错。nonce 由运行时随机生成（12 字节），
> 与密文、GMAC tag（16 字节）一并 base64 拼接返回，解密方无需单独传 nonce。

```ts
const sessionKey = "AUTH-SESSION:" + crypto.sha256Hex(refreshToken);   // 见第 8 章轮换
const token = crypto.randomHex();                                      // 64 字符不透明串

// v0.1.35：应用层 AES-GCM（密钥自行保管，例如从 env / KMS 注入，不进 config）
const key = "2b7e151628aed2a6abf7158809cf4f3c";                        // 16 字节 hex
const blob = crypto.aesGcmEncrypt(userId + ":" + ssn, key);           // 落库前加密
const plain = crypto.aesGcmDecrypt(blob, key);                         // 取出时解密
```

### ext_boot.js —— 运行时补充全局对象

上表全局由 `bootstrap.js` 在**编译期**装配，改它要重编 `oj`。`ext_boot.js` 是运行时补充：
放在 **config.yaml 同级目录**即被加载，可在已有全局上做组合增补（如 `json.page()`、
`log.trace`），不重编二进制。

```js
// ext_boot.js —— 每个新建的 JsRuntime 执行一次（不是每个请求）
export {};
json.page = (rows, total) => json.ok({ list: rows, total });
globalThis.APP_ENV = "prod";
```

| 项 | 行为 |
|---|---|
| 位置 | `<config_dir>/ext_boot.js`（config.yaml 同目录）；不存在即不加载 |
| 执行时机 | **每新建一个 JsRuntime 执行一次**；请求复用池中的 runtime 不重跑 |
| 模块形态 | ESM，支持顶层 `await` 与 `import` 项目内模块（解析规则同第 5 章） |
| 副作用范围 | boot 期写的 `json.ok` 等每请求状态随后即被重置，不会泄漏到请求 |
| 热重载 | **不做**——改动后须重启进程（启动日志打印已冻结的路径与 `?v=`） |
| `oj build` / `oj test` | 同样加载，保证 dev / build / release 行为一致 |
| 失败 | 启动期失败 → 服务拒绝启动；运行期新建 runtime 失败 → 该请求报错、服务存活 |

四条硬边界（不是建议）：

- **必须幂等且无外部副作用**。执行次数 = 模块数 + `pool_size` + WS Worker 数（每路由
  `ws.workers_per_route` 个，与连接数无关），在里面写库 / 发广播 / 打外部接口会被放大同样倍数。
- **只能组合已有全局，拿不到新能力**。`import "ext:core/ops"` 会被 deno_core 拒绝
  （`ext:` 只允许从 `ext:`/`node:` 模块导入）；需要新 op 属于改 bootstrap，不走这条路。
- **用顶层 `await` 必须带一句 `export {};`**（或有真实 import/export）。否则文件被 CJS
  启发式（§5 CJS 互操作）判定为 CJS、包进非 async 函数，顶层 `await` 直接 SyntaxError。
- **boot 里不做长等待**。同步死循环 2s 后被熔断（该 runtime 丢弃）；
  `await` 永不落定的 Promise 由引擎直接报 `Top-level await promise never resolved`。

注入的全局默认可写，handler 覆盖/删除后该 runtime 内后续请求都受影响（boot 不重跑）。
需要防改就用 `Object.defineProperty(..., {writable: false, configurable: false})`。

### 命名 MQ 客户端与长任务（Kafka / RabbitMQ / tasks）

> 何时读我：要接 Kafka/RabbitMQ 消费，或写 `src/tasks/` 下的长任务。
> 教学走读（心智模型 / 实现分层 / 测试地图）见仓库 `docs/mq-tasks.md`
>（devkit 包内不含，仓库查看）。

**命名客户端**：`kafkas:`/`rabbits:` 段（config §10）每个键装配为一个实例，
`Kafka("default")` / `RabbitMQ("default")` 取用（同名实例进程内同一对象；未配置的
名返回 `undefined`）。底层经 oj-bus-kafka / oj-bus-rabbitmq 插件的 `mq` 轴——「轴」是
插件提供能力的一类接口（db / kv / mq / blob 各算一轴），一个插件可实现多个轴。

| 客户端 | 生产面 | 消费面（**仅任务上下文**） |
|---|---|---|
| `Kafka(name)` | `send(topic, {value, key?, headers?})`；`value` 传 Uint8Array/ArrayBuffer → **base64 编码进 `value_b64`**，record 载荷 = 原始字节（v0.1.16） | `poll(topics, {max?, timeoutMs?})` → `{messages}`；`commit(m)`（按 m.offset+1 提交） |
| `RabbitMQ(name)` | `publish(exchange, routingKey, value, {headers?})`（`value` 二进制语义同 Kafka） | `poll(queues, {max?, timeoutMs?})`（= 循环 basic.get）；`ack(m)`；`nack(m, requeue?)` |
| 两者 | `kind()` / `metadata()` | —— |

消息形状（`OjMqMessage`）：`{topic, partition?, offset?, key?, value, value_b64?, headers?, ts?}`。
载荷为 UTF-8 时 `value` 是解析后的 JSON（解析失败为字符串）；**非 UTF-8 载荷** → `value` 为
`null`、`value_b64` 为 base64 字符串（v0.1.16 起，自行 `atob`/解码还原字节）。

**消费门禁（评审 M2）**：`poll/commit/ack/nack` 只在长任务上下文可用。HTTP/WS
handler 里调用直接报错——消费会话归属任务实例，实例级单 poller，第二个并发 poll
报 `instance busy`。任务 = `src/tasks/`（`tasks.dir` 可改）下符合命名约定的文件：
`task_{name}.ts/.js` 或 `{name}_task.ts/.js`。递归扫描；其余文件视为共享库，不执行；
同名双写、超 `max` 直接拒启。每任务一条专用线程 + 独立 V8 runtime。

**任务骨架**（顺序语义：poll → 处理 → commit；commit 按 offset+1，重复处理至
少一次）：

```ts
export {};
const k = Kafka("default");
while (!tasks.stopping()) {
  const { messages } = await k.poll(["orders"], { max: 100, timeoutMs: 1000 });
  // commit(offset+1) 只推进该消息所在分区——多分区主题必须按分区各提交一次
  // （取该分区最大 offset 的消息提交），只提交最后一条会丢其余分区的进度。
  const deepest = new Map(); // partition → 该分区最深的消息
  for (const m of messages) {
    /* 业务处理（幂等） */
    const cur = deepest.get(m.partition);
    if (!cur || m.offset > cur.offset) deepest.set(m.partition, m);
  }
  for (const m of deepest.values()) await k.commit(m);
}
```

** RabbitMQ 拉取骨架**：

```ts
export {};
const r = RabbitMQ("default");
while (!tasks.stopping()) {
  const { messages } = await r.poll(["q1"], { max: 10, timeoutMs: 1000 });
  for (const m of messages) { /* 处理 */ await r.ack(m); }
}
```

硬规则：

- **运行时无 timer 全局**：`setTimeout/setInterval` 不可用；任务里等待一律
  `await tasks.sleep(ms)`。
- **任务文件是 ES 模块**：用顶层 `await` 必须带一句 `export {};`（否则按 CJS 包装
  直接 SyntaxError，见 §5）。
- **`timeoutMs` 与 `stop_grace_secs` 的互动（评审 N3）**：停机 flag 置位后任务有
  `stop_grace_secs`（默认 30s）宽限自然收场；`timeoutMs` 应显著小于宽限（如 ≤1s），
  否则任务在一次长 poll 中错过退出窗口，到点被看门狗强杀（记 Killed）。
- **崩溃自动重启**：异常退出按 1s→2s→4s…（cap 60s）退避重启，成功运行 ≥60s 归零；
  启动/重启/停机逐条落日志（`task: <name> … → started / stopped / crashed`）。
- **热重载无**：改任务文件需重启进程（转译缓存按 mtime 自动失效）。
- **消费会话 topic 固化**：kafka 首次 `poll` 按当时的 topics 建立订阅，其后换
  topics 被忽略（会话不重建）；需换主题就换实例名。
- 与 `bus.*` 的关系：`bus` 是进程内/分布式**广播**（fire-and-forget），MQ 客户端是
  **持久队列消费**（有 offset/ack 语义）。需要可靠逐条消费用后者。

最小无 broker 示例见 `sample/src/tasks/task_demo.ts`（每秒心跳）。

### 池化任务与 cron（v0.1.28）

> 何时读我：写**每轮被驱动**的轮询/心跳/对账任务，或要按 crontab 定时跑一段 JS。
> 设计依据见仓库 `docs/prds/event-cqrs.md` v2。

任务文件按**导出探测**自动分流：导出 `loop_body` 命名导出 → **池化任务**（本节）；
否则 → 上一节的 TLA 监督器。TLA 即 top-level await（顶层 await 循环写法），MQ 消费写法不变。
两种模式可共存于同一 `src/tasks/` 目录。

**池化任务三钩子**（均为命名导出，模块在 worker runtime 上预载一次）：

```ts
// src/tasks/task_watch.ts
export async function setup() {
  // 可选：连接/建会话时执行一次
}
export async function loop_body() {
  // 每轮被 worker 调用一次；单轮超时 loop_body_timeout_ms（默认 5s）
  // 抛错或超时会触发 teardown 收场并记 Failed（退避重启见下）
}
export async function teardown() {
  // 可选：停止/失败/停机时执行（尽力而为，超时不保证跑完）
}
```

- **不需要 `tasks.stopping()` 轮询 / `tasks.sleep()`**：每轮 `loop_body` 返回后
  worker 按管理面 desired 位决定是否再调一轮；停机时先跑 `teardown` 再退出。
- **轮间节奏 `tasks.pool.interval_ms`（默认 100ms；`0` = 不限制）**：每轮返回后框架
  sleep 这么久再调下一轮。目的是防 trivial loop_body 空转独占 Worker——那会让同 Worker
  上的其他任务挨饿。要更快节奏调小它，长轮询任务别用池化。`0` 表示忙扫结束立即轮转
  （压测语义，生产会被空转打满多核）。
- 单轮异常/超时 → teardown → 状态 `failed`；管理面 `start` 后按 1s→2s→4s…
  （cap 60s）退避重连（对齐存量 TLA 退避语义）。
- 任务静态分配到 `tasks.pool.workers`（默认 4）个 worker 线程之一，本地轮转。
- 其余约定与 TLA 任务相同：无 timer 全局、文件须为 ES 模块（顶层 await 的 TLA
  文件仍需 `export {};`——池化文件靠命名导出天然是模块）、无热重载（管理面
  `reload` 可重连单个任务）。

**性能特征与调优（v0.1.28 同机实测；单任务 = sample `task_watch` kv get+set +
`log.info`，多任务 = 4 × kv get+set）**：

| 配置 | 轮率 | 进程 CPU 峰值 | KV/日志写放大 |
|---|---|---|---|
| 单任务，无节奏（旧行为） | ~60,000 轮/s | ~55% | 6 万行日志/s + 12 万次 kv/s |
| 单任务，`interval_ms: 100`（默认） | ~9 轮/s（上限 10/s） | ~5% | 按需 |
| 4 任务，`interval_ms: 0`（不限制） | 聚合 ~247,800 轮/s（每任务 ~62,000） | ~134%（**>1 核**） | 4 × 12 万次 kv/s |
| 4 任务，`interval_ms: 100`（默认） | 聚合 ~39 轮/s（每任务 ~10） | ~12.5% | 按需 |

- **吞吐由 `interval_ms` 一个旋钮决定**（默认 100ms → 每任务 ≈10 轮/s 上限）。
  轮率是**每任务**的，不是全局的——同 Worker 上 N 个任务交替轮转（多任务公平性
  有 BDD 测试钉住）；不同 Worker 的任务互不相干（4 任务 4 Worker 时空转轮率 ×4，
  CPU 可超 100% = 多核一起烧）。
- **调小 `interval_ms` 前先算写放大**：每轮的 kv/db/日志 IO 会乘以轮率。心跳类
  任务保持默认或调大（如 1000ms）；确需高频轮询才往下调。
- **单轮等待超过 `loop_body_timeout_ms`（默认 5s）的任务不要用池化**（看门狗
  会 teardown + failed 退避）——长轮询（MQ 消费、外部接口长连接）留在 TLA 模式，
  用 `tasks.sleep()` 自定节奏。
- **每轮做增量、别全量**：loop_body 里用 kv 存游标/水位（如 `watch:last`），
  每轮只处理游标之后的部分；全量扫描的任务轮率一上来就是灾难。
- **观测面**：`GET {base}/tasks` 的 `runCount` 增速即实际轮率；进程 CPU 突高先查
  是不是 `interval_ms` 太小/为 0，或 loop_body 内有隐藏循环。

**cron 定时任务**：`tasks.crontab`（默认 `task/crontab.yaml`，**相对 `tasks.dir`**）
逐行 `分 时 日 月 周  任务文件路径`（路径同样相对 `tasks.dir`；5 字段：支持 `*/n`、
列表 `1,3`、区间 `1-5`，周字段 7=周日；`#` 注释与空行忽略）：

```yaml
# src/tasks/task/crontab.yaml
*/5 * * * *  ./jobs/report.ts   # 每 5 分钟跑一次 report.ts（整模块跑一次）
30 2 * * 1   ./jobs/backup.ts   # 每周一 02:30
```

cron 文件是**脚本式**的：到点整模块跑一次（顶层 await 即执行体，跑完释放 Worker），
**不是**三钩子任务。命名用普通文件名（如 `jobs/report.ts`）——用 `task_*.ts` 会被
任务扫描器同时收编成长任务，同名直接拒启。到点由单驱动调度器派发**一次性作业**
（复用 worker 池，先推进 next_run 再派发，进程内不重入）。cron 任务的启停/改表达
式走管理面（见下）。

**任务管理 API（v0.1.28）**：`{base}/tasks` 控制面，鉴权（AuthGuard）与租户头语义
与业务路由**完全一致**（守卫/匿名路径/租户头缺省 400 同 §8）；无用户可传脚本路径
的入口（结构性满足脚本路径白名单）：

| 端点 | 说明 |
|---|---|
| `GET {base}/tasks?type=long\|cron` | 任务清单（名称/类型/状态/运行次数/上次错误/nextRun） |
| `GET {base}/tasks/{name}` | 单个任务详情；不存在 404 |
| `PATCH {base}/tasks/{name}` | 仅接受 `{enabled, cron}`（cron 表达式校验）；其余字段 400 |
| `DELETE {base}/tasks/{name}` | 运行时注销（文件仍是事实源，重启后按文件重建） |
| `GET {base}/tasks/{name}/logs?limit=` | 该任务的事件（见下） |
| `POST {base}/tasks/{name}/start\|stop` | 长任务启/停；cron 任务 400（用 enable/disable） |
| `POST {base}/tasks/{name}/enable\|disable` | cron（或长任务）启/停开关 |
| `POST {base}/tasks/{name}/reload` | 重连该任务（重跑 setup） |
| `POST {base}/tasks/{name}/run-once` | **仅 cron 任务**：立即派一轮（long 任务 400）；运行中 409，无任务池 503 |

**任务事件（v0.1.28）**：薄信封 `{eventId, eventType, timestamp, payload}`
（`eventType` 如 `task.started`/`task.failed`/`task.timeout`）。内存池 = JSONL 日志
（`tasks.event_log.path`，超 `max_mb` 轮转 `.jsonl.1`）+ 1000 条环形缓冲；
`logs` 端点从环形缓冲读。仅内存，无 MQ 后端接入（入 backlog）。

## 7. 响应信封与错误码

> 何时读我：设计错误返回或排查非 200 时。

统一信封 `{code, msg, data}`；**HTTP 状态码 = `code`**（`code=0` → 200；
`code<=0` 映射 500）。业务错误直接 `json.fail(400, "…")` 返回对应状态码，
无需另设错误通道。`code > 65535` 时 HTTP 状态 **clamp 到 65535**（v0.1.52 起，
此前按位回绕成错值）；信封 body 里的 `code` 保留全精度。

| 场景 | HTTP | 信封示例 |
|---|---|---|
| 成功 | 200 | `{"code":0,"msg":"ok","data":…}` |
| 无路由匹配 / 目录穿越 | 404 | `{"code":404,"msg":"no route matched","data":null}` |
| 路径命中但动词未注册 | 405 | `{"code":405,"msg":"method DELETE not allowed","data":null}` |
| 非映射动词（`TRACE` 等） | 405 | `{"code":405,"msg":"method TRACE not allowed","data":null}` |
| 路由冲突（同 pattern 同方法双声明） | 500 | `{"code":500,"msg":"route conflict: GET /v1/api/user/{id} declared in a/api.ts and b/api.ts","data":null}` |
| TS 编译错误 / 模块解析失败 | 500 | `{"code":500,"msg":"…/api.ts: 语法错误…","data":null}` |
| handler 死循环 / 超时 | 408 | `{"code":408,"msg":"handler execution timed out","data":null}` |
| 上传超 `max_upload_bytes` | 413 | `{"code":413,"msg":"upload too large","data":null}` |
| blob 不存在 | 404 | `{"code":404,"msg":"blob not found","data":null}` |
| 证书过期进宽限期（仅 GET） | 403 | `{"code":403,"msg":"certificate expired: service available in grace period, but GET requests are restricted","data":null}` |
| 证书已过期（Expired，仅 GET，运行中热替换所致） | 403 | `{"code":403,"msg":"certificate expired: service unavailable","data":null}` |
| 租户头缺失/为空（`tenant.enable`） | 400 | `missing tenant header: X-TENANT-ID` |
| `tenant.require_signed_claim`（v0.1.41）开启后：裸头自证被拒 | claim 缺失/不符 | 403 `tenant requires a signed claim (user.claims.tenant missing)` / `tenant header does not match signed claim`——JWT 里放 `claims.tenant`，头仅作一致性复核 |
| Bearer 缺失/无效/过期（`auth:` 启用） | 401 | `missing or invalid bearer token` |
| cookie 会话 CSRF 校验失败（v0.1.30，非安全方法） | 401 | `missing or invalid csrf token` |
| blob 直传超 `blob_upload_max_bytes`（v0.1.30） | 413 | `{"code":413,"msg":"upload too large","data":null}` |
| blob Range 越界 / 空文件（v0.1.30） | 416 | `Content-Range: bytes */<len>` |
| WS 握手未过守卫（v0.1.30） | 401 | HTTP 401，不升级 |
| fs 未配置 `fs:` / 越出 `fs.root` / readonly 写（v0.1.53） | 500 | `{"code":500,"msg":"NotCapable: …","data":null}`（未捕获异常走 500 信封） |

业务层常用码约定：400 入参不合法、404 资源不存在、401 未认证、403 已认证但无权、
500 服务器内部错误。`json.fail` 的 `msg` 会原样进入信封，勿把内部细节（堆栈、SQL）
透给客户端。

> 3xx 不属于错误通道：重定向走 `json.redirect(url, code?)`（v0.1.26，见 §6 json），
> 响应**无 `{code,msg,data}` 信封**——body 是 RFC 9110 §15.4 短超文本注记（HEAD 为空），
> HTTP 状态即所给 3xx（非 3xx 回落 302）。不要拿 `json.fail(302, …)` 当跳转用。

## 8. 鉴权与多租户

> 何时读我：接口要登录态或多租户隔离时。

### auth：块存在即启用（oj-auth 守卫 + JS 端点）

config `auth:` 段存在即启用两层能力：**Bearer 守卫**（oj-auth 插件在前置管线完成，即请求
进 handler 之前统一验 `Authorization: Bearer` token 的那道检查）与
**`jwt` / `bcrypt` 全局注入**（供 JS 侧实现登录端点，API 细节见第 6 章 jwt / bcrypt / crypto）。
`jwt_secret` 配了却为空串 → 启动 fail-fast（不静默跳过）。

**auth 端点是业务路由，不是内置路由**：`login` / `refresh` / `logout` 由普通 JS 模块实现
（sample 提供参考实现 `sample/src/auth/`，目录镜像路由 `POST /auth/login|refresh|logout`）：
`db` 查用户表、`bcrypt.verify` 校验密码、`jwt.sign` 签发 access token，refresh 为不透明
随机串 + KV session（轮换）。框架不内置这些路由——业务可整模块替换或改名。

| 端点（sample/src/auth/） | 请求体 | 响应 data |
|---|---|---|
| `POST /auth/login` | `{"username","password"}` | `{"access_token","refresh_token","expires_in"(秒),"user":{"id","roles"}}` |
| `POST /auth/refresh` | `{"refresh_token"}` | 同上（**轮换**：旧 refresh 立即失效） |
| `POST /auth/logout` | `{"refresh_token"}` | `null`（删 refresh session；access 到期前仍有效） |

因为是普通业务路由，这三个路径**必须在 `auth.anonymous_paths` 里显式匿名**，否则会被
自己的 Bearer 守卫拦成 401。

**Bearer 守卫**：路由表命中后、进 handler 前，oj-auth 插件对非匿名路径验签
`Authorization: Bearer <access_token>`（缺失 / 验签失败 / 过期 → 401）。通过后 handler 里读
`http.user`（`{id, roles, claims}`）。登录失败统一报 `invalid credentials`（不区分用户
不存在/密码错）。

**cookie 会话（v0.1.30，浏览器形态）**：`auth.cookie` 段缺省关闭（= 纯 Bearer 行为）：

```yaml
auth:
  jwt_secret: "..."
  cookie:                      # 可选；缺省整块不写 = 关闭
    enabled: true
    name: oj_sess              # HttpOnly 会话 cookie
    same_site: Lax             # Lax / Strict / None
    secure: false              # 生产 HTTPS 建议 true
    ttl_secs: 86400
    csrf_cookie: oj_csrf       # 非 HttpOnly，JS 可读
    csrf_header: x-csrf-token
```

判定序（守卫内）：匿名路径 → Bearer → cookie 会话 → 统一 401
（`missing or invalid bearer token`，不泄露哪条路失败）。cookie 会话的 cookie 值是
**同 `jwt_secret` 签的 JWT**（签发是登录端点的职责：`json.header` 写
`Set-Cookie: oj_sess=<jwt>; HttpOnly; SameSite=Lax; Path=/`，sample 有参考实现）。
**`oj_csrf` 与 `oj_sess` 同响应双发**（v0.1.46 起 `json.header` 同名头可重复，
`Set-Cookie` 合法落多个值；此前响应头单值，csrf 只能经 body 下发再由 JS 写
`document.cookie`——sample 旧 workaround 已废）：登录端点第二个 `json.header`
写 `Set-Cookie: oj_csrf=<随机>; SameSite=Lax; Path=/`（**非 HttpOnly**——JS 要读）；
登出端点把两个 cookie 都以 `Max-Age=0` 清掉；
**非安全方法**（非 GET/HEAD/OPTIONS）再叠 CSRF 双提交：`csrf_header` 值必须等于
`csrf_cookie` 值，否则 401 `missing or invalid csrf token`（Bearer 命中的请求不查）。
浏览器 WS 握手自动带 Cookie——cookie 形态是 WS 鉴权的主通道（WS 升级过同一守卫，
401 不升级；v0.1.30 起 ws 路径要在 `anonymous_paths` 里才匿名，见 §6 ws 硬约束 1）。
CLI/MCP 继续用 Bearer，两者并存。

**匿名路径** `auth.anonymous_paths`：去 `{base}` 前缀的路径列表，四种通配形态（字面 / 尾
`/*` 严格一层 / 中段 `*` 恰好一段 / `**` 跨任意层）。条目写字符串即可，需要显式声明
「这一层是有意的」时改写成对象形态 `- { path: "/pub/*", one_layer: true }`（消音迁移
WARN，见下）。`{base}` 之外的路径（静态站点）不设防。

**用户表是业务约定，没有配置项**：框架不管用户表（不存在 `auth.user_table`），JS 端点
按约定查询 `users` 表（`_platform` 伪模块持有归属），最小 schema：

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,   -- bcrypt
  roles TEXT NOT NULL DEFAULT '[]'  -- JSON 数组串，如 '["admin"]'
);
```

auth 段其余字段（`jwt_secret` 生产必改且空串启动 fail-fast、`signing_method`、
access/refresh 时长）见第 10 章配置表。

```ts
// 受保护路由：读验签后的用户身份（sample/src/auth_demo/me/api.ts）
export default {
  get() {
    json.ok({ user: http.user });
  },
};
```

### tenant：多租户头

```yaml
tenant:
  enable: true
  header_key: "X-TENANT-ID"   # 默认即此名
  sql_guard: deny             # 多租户 SQL 防护：false（默认，不改写 SQL）| "warn" | "deny"/true
  shared_allow: [dict]        # 共享表白名单（schema.yaml 里 tenant: false 的表须在此列出才生效）
  allow_as_tenant: false      # v0.1.20：允许匿名请求用 db.asTenant(id) 声明身份（默认关）
  anonymous_paths:            # 豁免缺租户头的路径（去 base 前缀、去尾斜杠后的形态）
    - /public/*               # 尾 /* ：严格一层（/public/a 命中，/public/a/b 不命中）
    - /idp/**                 # 中段/尾 ** ：跨任意层（/idp 到 /idp/a/b/c 全命中）
    - /report/*/export        # 中段 * ：恰好一段（/report/7/export 命中，/report/a/b/export 不命中）
```

启用后所有 `{base}` 请求必须带该 header（缺失/空 → 400），值注入 `http.tenantId`
供 handler 做数据隔离。`tenant.anonymous_paths`（与 `auth.anonymous_paths` 同语义）是
**去 base 前缀**后的路径列表，支持四种通配形态：字面、`/*`（严格一层）、`**`（跨任意层）、
中段 `*`（恰好一段）。豁免命中且确实没带租户头的请求被标记为**匿名**
（`RequestInfo.anonymous`），不再因缺头而 400——这是给 OIDC 302 跳转腿用的（浏览器带不了
自定义头）。已带的头仍照常注入。

**租户声明的服务端绑定（`tenant.require_signed_claim`，v0.1.41，默认 false）**：开启后
`http.tenantId` **只认验签后的 JWT claim `claims.tenant`**——裸租户头不再自证：带头仅作与
claim 的一致性复核（不符 → 403 `tenant header does not match signed claim`），无 claim →
403 `tenant requires a signed claim (user.claims.tenant missing)`（即使带头）。claim 命中时
无头也放行（claim 即来源）。`anonymous_paths` 豁免语义不变（OIDC 回跳逃生口）。装配期
fail-fast：开关开启但缺 `tenant.enable` 或缺 auth 守卫 → 拒绝启动。作用面为 HTTP 前置
管线（WS 帧/任务桥为系统上下文，不经此绑定）。

**迁移 WARN 只针对 `auth.anonymous_paths`**（v0.1.23 订正）：v0.1.20 的「尾 `/*` 从任意深度
收紧为严格一层」**只发生在 oj-auth 侧**；`tenant.anonymous_paths` 自引入起就是严格一层
（旧 server 实现即 `!rest[1..].contains('/')`，`git show v0.1.19:server/src/lib.rs`）。
对租户条目提「收回了面」是伪前提，故该列表不再参与启动期告警。

对 `auth.anonymous_paths`，**两个条件同时成立才打**聚合 WARN：

1. 条目是**旧式前缀形态**——只有尾段那一个 `*`，其余段全是字面量（`/idp/*`、`/users/me/accounts/*`）。
   旧 oj-auth 实现是「砍掉尾 `*` 再 `starts_with`」（任意深度），只有这种形态当时能命中
   真实请求；**含中段 `*` 的结构条目**（`/public/anchor/*/issues/*`）那时根本匹配不上，
   只能诞生于 v0.1.20 的四形态语义，是刻意写的形状。对它们提「改 `**`」是错的，故静默。
2. 该条目**确实丢了面**——存在一条已注册路由比严格一层更深：
   - `/idp/*` 而项目里注册了 `/idp/.well-known/openid-configuration`（深两层）→ **告警**
     （收紧确实收回了既有免鉴权面，应改 `/idp/**` 或把深路径单列）；
   - `/auth/oidc/*` 这类**本就没有更深路由**的条目 → **静默**。
   - 若唯一「更深」只是 `**` 多出的**零层**（裸 `/user/account` 配 `/user/account/*`）→ 旧语义
     也没覆盖它，**不算丢面**，同样静默。

确属「有意一层」时把条目写成对象形态并标 `one_layer: true`，永久退出该 WARN：

```yaml
auth:
  anonymous_paths:
    - /auth/login
    - { path: "/idp/*", one_layer: true }   # 明知 ** 更宽，就要一层（discovery 另行单列）
```

对象形态只认 `path` 与 `one_layer` 两个键：**写错键名会报错**（不再是静默失配）。`one_layer`
标在末段不是 `*` 的条目上无意义，装配期直接报错（fail-fast，防配置撒谎）。`tenant.` 段同样
接受对象形态，但那里不告警，标记等于备注。

**`sql_guard`（v0.1.15 起）**：开 `enable` 只是识别租户头；`sql_guard` 才自动防护 SQL。
`db.table()` 构造器查询自动注入 `tenant_id` 条件（join 进 ON、子查询递归）、insert 强制
当前租户、update/delete 自动收窄、sets 显式改 tenant_id 拒绝。裸 SQL 查「完全遗漏
tenant_id」时 warn 告警 / deny 拦截。guard 非 Off 时 schema.yaml 声明的表必须有 `tenant_id` 列
（共享表 `tenant: false` + `shared_allow` 双声明豁免），serve 启动 / `oj build` /
`oj migrate` 三处校验。跨租户操作（对账、运营报表）走 `db.asSystem()`（请求级、打审计日志）。
**`tenant_id` 列类型（v0.1.24 起）**：只能是 `text` / `integer` / `bigint`，其余类型在
**serve 启动 / `oj build` / `oj migrate` 三处 fail-fast**（`double`/`boolean`/`blob` 没有
「等值租户 id」语义）。守卫按**声明类型**绑值：`text`（及旧装配路径的「未声明类型」）→ 字符串；
`integer` / `bigint` → **数值**：`≤2^53-1` 用 number，更宽用 i64 标记，`> i64::MAX` 用
`$oj$u64`（只有 MySQL `BIGINT UNSIGNED` 能承载，PG/SQLite 会在绑定前报错）。insert / update
的租户等值判定接受**四种形态**（字符串 / 数字 / `toBigInt` / `toUBigInt`）。**注意**：数值列上
租户头必须是**十进制字面量**，否则直接报错——**即使 `sql_guard: warn` 也硬失败**（warn 只放行
「无法判定」的情形，不放行「判定为不匹配」）。
**`db.asTenant(id)`（v0.1.20 起）**：与 `asSystem` 方向相反——不是绕过防护，而是给
**匿名请求**补上租户身份。三道门禁全过才生效：① `tenant.allow_as_tenant: true`
（默认 false）；② 该请求是匿名的（`anonymous_paths` 命中且未带租户头，或 `oj test
--anonymous`）；③ `id` 非空。生效后 `tenant_id` 被填为 `id`，构造器查询照常强制注入
租户条件；**请求级且只能设一次**（已带租户头 / 已设过 → 抛错，防运行期切换身份）。
典型用途：公开分享页、OIDC 回调等无头请求仍需按 URL 里的租户读取数据。

新人向白话文档见 `docs/tenant-guide.md`；**注意租户头目前是客户端自报，防伪造需 JWT claims
绑定（规划见设计文档 §7）**。

### auth_demo 走读（sample）

`sample/src/auth_demo/`：`me`（受保护，返回 `http.user`）与 `health`（匿名，
在 `anonymous_paths`）两个路由；`sample/seed.sql` 已建 `users` 表并写入 demo 用户
（`demo` / `demo1234`，角色 admin）。走读顺序：login 拿 token → 带 Bearer 打
`/auth_demo/me/` → refresh 轮换 → logout 失效。sample 同时开了 tenant，
curl 需另带 `-H 'X-TENANT-ID: acme'`（完整命令见 `sample/src/auth_demo/README.md`）。

### OIDC 演示走读（sample：idp + oidc）

`sample/src/idp/` 是同进程 **OP**（`/.well-known/openid-configuration`、`jwks.json`、
`authorize`、`login`、`token`、`userinfo`——标准协议端点用 `json.raw` 出裸 JSON）；
`sample/src/oidc/` 是 **RP**（`login` → 302 授权 → `callback` 换会话桥接成本地
`auth` token → `logout`）。OIDC 的 302 跳转腿带不了自定义头，故 demo 在
`tenant.anonymous_paths` 与 `auth.anonymous_paths` **两条列表**里都匿名
`/oidc/*`、`/idp/*`、`/idp/.well-known/*`（窄面：discovery 比 `/idp/*` 深一层，故单列；
auth 的 `/idp/*` 标 `one_layer: true` 确认「有意一层」；键见第 10 章 tenant/auth）；
`oidc.rp`/`oidc.clients` 配置驱动，对接外部 IdP 只改 config。curl 全链路见
`sample/README.md` 的「OIDC 演示」；实现走读（含 mermaid 时序图）与接入手册见
`oidc-implementation.md` / `oidc-integration.md`（仓库在 `docs/` 下，发行包随 devkit
同目录附带）。

## 9. 测试

> 何时读我：写模块测试或搭 CI 时。

两层测试互补：**L1 `oj test`**（进程内真实 v8 + 真实路由/鉴权/租户管线 + 真实后端，
零 TCP）；**L2 vitest 纯 mock**（Node 直调 handler，mock 全局，毫秒级）。
一句话：**L2 测 handler 纯逻辑（快、稳），L1 测端到端行为（真、全）**。

### L1：`oj test`

目录约定：测试文件放 `tests/*.test.ts`（目录由 `-t/--tests` 指定，相对 config 所在目录，
默认 `tests`）。v0.1.52 起**递归扫描**子目录（`_` 前缀目录跳过，其余按路径排序收集）——
此前只扫首层，子目录里的 `*.test.ts` 会被静默忽略。

```bash
./bin/oj test -c sample/config.yaml -d sample/src                 # human 摘要
./bin/oj test -c config.yaml -d src --format junit --output l1.xml # CI 报告
```

| 旗标 | 说明 |
|---|---|
| `-c/--config` | 配置文件（v0.1.57 起可省：CWD 逐级向上 → `$HOME/.oj/config.yaml` 搜索，未找到用内置默认） |
| `-b/--base` | API 基础前缀覆盖（server：`--api-path` 折叠挂载的 prefix，默认 `/v1/api`，裸 `-b` 报错；openapi/test：覆盖路由前缀） |
| `-d/--dir` | 源码目录 `src` 或产物 `dist`（默认自动判定） |
| `-t/--tests` | 测试目录，相对 config 目录（默认 `tests`） |
| `--format` | `human`（默认）/ `tap` / `junit` / `json` |
| `--output` | 报告落盘文件；省略打到 stdout（机器格式 stdout 纯净） |
| `--db` | 测试库（v0.1.20）：缺省取 config 的 `db.test`（未声明则 WARN + 用 `default`）。字面 `default` 的库调用改指向该库，建表/seed/fixtures 一并跟随；未声明即报错 |
| `--redis` | 选中 `config.redis.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast（不回落 default） |
| `--blob` | 选中 `config.blob.backends.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--es` | 选中 `config.es.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--broker` | 选中 `config.broker.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--kafka` | 选中 `config.kafkas.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--rabbit` | 选中 `config.rabbits.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--anonymous` | 以匿名请求身份跑（v0.1.20）：等同生产 `tenant.anonymous_paths` 命中，便于测公开面 handler |

> `oj test --db` 与 `oj migrate --db` **同名不同义**：前者重定向「字面 `default` 的库调用」，
> 后者是整轮迁移的目标库（第 3 章「命令」）。
>
> `--redis/--blob/--es/--broker/--kafka/--rabbit`（v0.1.34）把 config 对应段里**命名 profile**
> 选为默认源，装配期别名为字面 `"default"`——JS 侧 `redis()` / `blob()` / `es()` / `bus()` /
> `kafka("default")` / `rabbit("default")` 无需改代码即指向选中源。给定 profile 不在 config 段中
> 直接 fail-fast（列出可用 profile），不静默回落 default。各段缺省回退字面 `default`。

退出码：**全部通过 = 0，任一失败 = 1**——可直接做 CI 门禁。

测试文件用注入的全局 `client` 与 `describe/it/expect`（类型见 `global.d.ts`）：

```ts
describe("user account", () => {
  it("lists accounts (auth + tenant)", async () => {
    const token = await client.login("demo", "demo1234", { "X-TENANT-ID": "default" });
    const r = await client.get("/user/account", {
      headers: { Authorization: "Bearer " + token, "X-TENANT-ID": "default" },
    });
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);   // 信封：{ code, msg, data }
    expect(body.code).toBe(0);
    expect(Array.isArray(body.data)).toBeTruthy();
  });
});
```

注入的全局 API：

| API | 说明 |
|---|---|
| `client.get/post/put/del/patch/head/options(path, opts?)` | 进程内派发；`opts = { headers?, body? }`，返回 `ClientResp { status, headers, body, upgrade }`；`path` 相对 base（如 `"/user/account"`） |
| `client.login(username, password, headers?)` | POST 业务路由 `/auth/login`（sample/src/auth/）→ 返回 `access_token`（失败抛错；`headers` 透传，如租户头） |
| `client.ws(path)`（v0.1.16） | WS 帧测试面：`send(string\|Uint8Array)` / `next(ms?) → {binary,data}\|{closed:true}\|null` / `close()`；首次使用惰性起 127.0.0.1:0 本地服务（真实路由 + 帧循环）。**`send`/`next`/`close` 任一个都能建连**——`next()` 可单独读服务端主动推的首帧（connection 钩子 `ws.send` / bus 广播），不必先 `send`；文本帧 `data` 为 string（运行时无 `TextDecoder`，测试面自带 UTF-8 解码）。用例见 `sample/tests/ws-bin.test.ts` |
| `describe(name, fn)` / `it(name, fn)` / `beforeEach(fn)` | vitest 风格子集 |
| `expect(actual)` | `.toBe / .toEqual / .toBeTruthy / .toBeFalsy / .toContain` |
| `finish()` | 标记会话结束 |

**两个必知约束（由 config 决定）**：

1. 多租户：config 启用 `tenant` 后，每个请求都必须带 `X-TENANT-ID` 头，否则 400。
2. 鉴权：config 启用 `auth` 后，除匿名路径外都要带 `Authorization: Bearer <token>`，否则 401。

> `beforeEach` 注册的是**单一全局钩子**，跨多个 `describe` 会被覆盖；多 describe 文件建议
> 在各 `it` 内联准备（如每个用例自己 `client.login`），避免互相干扰。

适用：API 端到端行为（路由/鉴权/租户/真实 DB/bus 广播/信封）与契约回归；
代价是启动开销，适合 CI 与关键链路守护。

### L2：vitest 纯 mock（`unit/` 独立 npm 包）

```bash
cd sample && npm run test:unit    # 统一入口（等价 cd unit && npm ci && npx vitest run）
cd sample && npm run typecheck    # 类型检查（src + tests + unit 共用一个 tsconfig；CI 门禁）
```

结构：`mocks/oj-globals.ts` 提供 `installGlobals(opts?)`——把 `db/json/http/bus/log`
换成可控桩，返回响应捕获 `{code,msg,data}`。`lastPublished()` 取 `bus.publish` 记录，
`lastSqlCalls()` 取 `db` 发出的 SQL（query/exec/构造器）与绑定参数，可据此断言 handler
走了哪个分支。`invoke.ts` 提供 `invoke(handler, method, opts?)`（装桩 → 调 handler →
flush 微任务 → 返回 `{ ...capture, published }`）；`*.spec.ts` 直接 import 真实
`../src/.../api` 的 handler。

```ts
import { describe, it, expect } from "vitest";
import account from "../src/user/account/api";
import { invoke } from "./invoke";
import { lastSqlCalls } from "./mocks/oj-globals";

describe("user/account (L2 分支 + SQL)", () => {
  it("post 缺 name → 400，且不落任何 SQL", async () => {
    const r = await invoke(account, "post", { body: { role: "admin" } });
    expect(r.code).toBe(400);
    expect(r.msg).toBe("name required");
    expect(lastSqlCalls()).toEqual([]);
  });
});
```

适用：handler **内部分支**与边界（入参校验分支、默认值回落、纯函数如
`requireRole`/`positiveId`/`lineLength` 的固定日期期望值）、「发出了什么 SQL」、
bus 事件**内容**，以及 TDD 快速回归；
局限：mock 不是真实后端，发现不了鉴权/租户/路由装配等集成层问题。

> **与 L1 分工（避免双写）**：契约类断言（字段结构、分页包装、状态码、camelCase）只放
> L1；分支类（输入 X 得 Y、边界、纯函数）只放 L2。判据见 `docs/modules/08-testing.md` §4。

### 选型与推荐组合

| 维度 | L1 `oj test` | L2 vitest |
|---|---|---|
| 运行时 | 真实 deno_core(v8) + axum | Node + vitest（无 v8） |
| 后端 | 真实 DB/KV/bus | mock 桩 |
| 速度 | 较慢（启动开销） | 极快 |
| 覆盖 | 路由/鉴权/租户/DB/总线 | handler 内部分支与纯函数 |
| 稳定性 | 受后端/配置影响 | 稳定、无副作用 |

**推荐组合：开发期 L2 快速验证逻辑，CI 用 L1 守护端到端契约；两层都绿才有信心发布。**

CI 已内置（`.github/workflows/plugin-matrix.yml` 的 `sample-tests` job，发版门禁另见
`release.yml` 的 `lint`）：`npm ci`（`unit/`）→ `npm run typecheck` →
`cargo run --release -p xtask -- build`（workspace 构建，产出 `bin/oj` + 全部第一方插件。
勿用 `cargo build -p oj`，那会按不同 feature 归一化重编 rusty_v8）→
`./bin/oj test -c sample/config.yaml -d sample/src --format junit` → `npx vitest run`。

依赖管理：L2 的 vitest 与 typescript（类型检查用）声明在 `unit/package.json` 的
`devDependencies`，与运行时依赖（如 `escape-goat`）隔离——被测物不携带测试工具；
统一入口在 `sample/package.json`（`npm run test` = `typecheck` + `test:unit` + `test:api`）。

## 10. 配置 config.yaml

> 何时读我：起服务前定配置，或排查启动 fail-fast 时。

**`-c` 可选与搜索路径（v0.1.57）**：除 `secret keygen` 本就不需要配置外，所有子命令的
`-c/--config` 均可省略。省略时按序搜索：① CWD 逐级向上找 `config.yaml`（项目根或任意
上级目录有一份即可）；② `$HOME/.oj/config.yaml`（用户级兜底）。两处都没找到 → **不报错**，
用内置默认 Config 继续：`oj build` / `oj openapi` / `oj exec`（纯计算脚本）/ `oj info` /
纯静态 `oj serve`（`--api-path` + `--app-path` 俱足时）无需配置文件即可运行；需要后端的
命令（`migrate` / `test` / `schema diff` 等）会在用到具体后端时给出「未声明 default 库」
类错误。显式 `-c` 指向缺失文件仍是 fail-fast。stderr 会打出 `note: no config.yaml found …`
提示回落了默认值。全字段可省（均有默认），除证书两路径**必配**。
相对路径相对 **config 所在目录**（回落默认时相对 CWD）；命令行相对路径相对 CWD。

### mounts（v0.1.58）

顶层挂载表：**一行 = 一个绝对 URL 前缀 + 一个目录**（api/web 恰好其一；值空串报错）。
路由按前缀**最长命中、跨挂载不回落**（`/v2/typo` 只会命中 `/v2` 挂载的 404 JSON，
不会被 `/` web 挂载吞成 200）。旧 `server.api_prefix` / `app_path` / `app_prefix` /
`static_sites` / `app_spa_fallback` 已删除——config 里出现即报错并输出迁移 YAML
（见 user-manual §3.1）。

```yaml
mounts:
  - prefix: "/v1/api"     # api 挂载：/v1/api/<module>/...（目录相对 config 所在目录）
    api: "src"            #   dev/release 逐条目自动判定（目录含 manifests.yaml → release）
  - prefix: "/"           # web 挂载：静态服务，仅 GET/HEAD（其余方法 405）
    web: "public"
    spa: true             # SPA 深链回落（默认 false；显式开启）
    headers: { X-Frame-Options: "DENY" }   # 挂载级响应头，覆盖全局同名（框架头永远优先）
  - prefix: "/app1"       # 同前缀 api+web 配对合法（api 优先；配对 web 不开 spa 回落）
    web: "app1-dist"
  - prefix: "/app1/api"   # 嵌套 api 挂载：最长前缀命中使其路由优先于 /app1 的 web
    api: "./app1/api"
```

| 规则 | 说明 |
|---|---|
| api 挂载 | 服务该目录的模块路由；目录缺失启动报错。内建 `/health`、`/plugins`、`/blob/{key}` 跟各自 api 挂载前缀走（与既往部署零 URL 变化） |
| web 挂载 | 前缀根 → `index.html`；穿越段（含 `%2F`）404；无 Range/ETag（经前置反代补）；**仅 GET/HEAD**（其余方法 405） |
| `spa: true` | 静态未命中 + 无扩展名 + `Accept` 含 `text/html`/`*/*`/缺失 → 送**本挂载根** `index.html`。默认 false（静默把 404 变 200 会掩盖错配）；要求同前缀无 api 挂载（嵌套 api 挂载经最长前缀命中本来就吞不掉） |
| 同前缀重复 | 同类（api×api / web×web）报错；一条 api + 一条 web 合法（配对，api 优先） |
| 根 `/` | 允许：api 挂载路由 `/<module>`；web 挂载全路径兜底 |
| CLI 折叠 | `--api-path d [-b B]` → upsert `{prefix: B(默认 /v1/api), api: d}`（裸 `-b` 报错）；`--app-path d` → upsert `{prefix: "/", web: d}`、`--app-path /p=d` → upsert 同前缀 web 条目（保留 headers/spa） |

### server

| 字段 | 默认 | 说明 |
|---|---|---|
| `host` | `"localhost"` | 监听地址 |
| `port` | `9778` | 监听端口；<1024 属特权端口（需 root），不要配成 `778` 之类 |
| `timeout` | `"30s"` | 单请求执行超时（超时熔断 → 408）；单位支持 `s/sec/secs/ms/m/min/h/d`。路由级覆盖见 `route_timeouts` |
| `route_timeouts` | `[]` | （v0.1.30）路由级超时覆盖：`[{pattern: "/v1/api/convert/**", timeout: "5m"}]`；pattern 段语义同匿名路径（字面 / `*` 一段 / `**` 跨段），按声明序首个命中，匹配**含 base 全路径**；超时语义同全局（408）。pattern 空/时长非法 → 启动 fail-fast |
| `pool_size` | `4` | JS 执行线程数 = 并行请求上限 |
| `max_upload_bytes` | `10485760`（10MB） | handler 面（multipart 进 `http.file`）上传体积上限；超限 413。axum 层对非 blob 路径再乘 2 做硬顶（双闸，见第 13 章）。**不经 handler 的直传不受它管**——见 `blob_upload_max_bytes` |
| `blob_upload_max_bytes` | `1073741824`（1 GiB） | （v0.1.30）直传路由 `PUT {base}/blob/{key}` 的体积上限（过鉴权守卫、不经 JsActor/30s）；超限 413 信封 |
| `response_headers` | `{}` | （v0.1.30）全局自定义响应头 `{name: value}`，施加动态信封/静态站点/blob 响应面；**框架自有头永远优先**（只补缺，Content-Type/Location 等不可覆盖）；默认空 = 行为不变 |
| `html_meta` | 无 | （v0.1.20）**构建期** per-route meta 目录名（相对各 web 挂载根）：送 HTML 前读 `<挂载根>/<dir>/<path>.json`，把 `title`/`description`/`canonical`/`og:*`/`twitter:*` 注入 `<head>`（值 HTML 转义、**不注入脚本**；目录自身不可公开访问）。只覆盖构建期已知路由 |
| `html_meta_handler` | 无 | （v0.1.25）**动态** meta 源 = 业务 handler 的路由路径，见下「静态站点与 per-route meta」。静态 JSON 打底、动态按 key 覆盖；装配期校验它必须命中一个 **GET** 路由（拼错启动即报错） |
| `html_cache_control` | 无 | （v0.1.25）HTML 响应的 `Cache-Control`（**只管 HTML**，js/css/图片不受影响）。动态 handler 返回的 `cache_control` 优先；两项都没有 = 不加头 |
| `logs_dir` | 无（= config 目录下 `./logs`） | 日志目录（终端输出完整镜像落盘；每次启动新建文件 `server-<启动秒>_<pid>.log`，按 `logs_max_m` 滚动、保留 `logs_keep_files` 个）；不存在自动创建
| `logs_max_m` | `100` | 单个日志文件大小上限（单位 M；**<100 按 100 生效**），超过滚动为 `base.1.log` 依次后移 |
| `logs_keep_files` | `10` | 日志文件保留个数（含活动文件，超出删除；最小生效值 2） |
| `console_log` | `false` | 终端输出开关。**默认 false = 只落盘**，终端保持干净（stdout 与 stderr 一起静默，因为 tracing 控制台层写的是 stderr）。`true` = 额外回写终端；CLI `--console-log` 亦可打开（与配置取「或」）。**非 unix 平台无落盘，此时强制保留终端输出并告警**。启动失败的最终退出原因无论开关都直写终端（`echo_terminal`，原始 stderr fd 副本） |
| `public_key_path` | **必配** | 证书校验公钥（SPKI PEM；仅验签，私钥不落服务器） |
| `certificate_path` | **必配** | JWS 证书（`Base64URL(Header).Payload.Signature`，RS256） |
| `grace_days` | `30` | 证书过期后宽限天数（缩窄可加速告警） |
| `migrate_on_start` | `auto`（dev）/ `verify`（release） | 迁移门禁：auto 启动即应用；verify 账本落后拒启（M004，先 `oj migrate`）；`off` 迁移完全归运维 |
| `ownership_guard` | `"warn"` | 表归属守卫：`warn` 跨模块表访问仅告警；`deny` 未声明 deps 拒绝执行（500 附修复指引） |

### 静态站点与 per-route meta（SEO / IM 预览）

静态托管只做三件事：按目录镜像发文件（含 SPA 壳）、可选深链回落、可选按路由注入 `<head>`。
**平台不引入 SSR 运行时**——注入的是「壳 + 一个 JSON 键值表」，不是服务端渲染的页面。

> **多 web 挂载（v0.1.58）**：`mounts:` 配多个 web 挂载后，下文的「站点根」均按
> **命中挂载**理解——meta JSON 目录、SPA 回落的 `index.html` 都读命中挂载自己的根；
> 命中挂载内未命中**不跨挂载**回落。最长前缀命中（`/docs/api/x` 胜过 `/` 挂载），
> `http.query.path` 是已剥**命中挂载前缀**的站内路径。

> **注入是「替换」不是「追加」**：浏览器与爬虫只认**第一个** `<title>` / 同名 `<meta>`，
> 所以注入前会先把 head 里**同名**的既有标签摘掉（`<title>`、`description`、`canonical`、
> `og:*`、`twitter:*`），再放新标签。壳里写死 `<title>App</title>` 也能被接管——不必改前端
> 产物。`<script>`/`<style>` 的内容当不透明文本整段跳过（里面的 `<title>` 字符串不会被误摘）。
> 只在 `</head>` 之前动刀，head 之外原样。

两级 meta 源，可同时开、按 key 合并（静态打底、**动态覆盖**）：

| 源 | 配置 | 适用 |
|---|---|---|
| 构建期 JSON | `html_meta: "__meta"` → `<挂载根>/__meta/<path>.json` | 路由清单固定（首页、栏目页） |
| 运行期 handler | `html_meta_handler: "/v1/api/html-meta"` | **按数据**（issue 标题、分享页正文、公开页 OG） |

> 只想给壳挂缓存头、**不做注入**也行：单配 `html_cache_control` 即生效（三键彼此独立）。

动态 handler 的约定：

- 送静态 HTML 前**内部派发**它（HTTP 动词恒 GET，JS 方法名 `get`）；
- **`http.query.path` 是已剥命中 web 挂载前缀的站内路径**（挂载 `prefix: "/site"` 时
  `/site/issues/7` → `/issues/7`；SPA 回落的深链接即它本身），仍 percent-encoded，
  需要明文自己 `decodeURIComponent`；
- 返回对象（或标准信封 `json.ok({...})` 的 `data`）里的键与 `html_meta` **同一白名单**：
  `title` / `description` / `canonical` / `og:*` / `twitter:*`（`og:*` 出 `property`，其余出
  `name`；值一律 HTML 转义、**不注入脚本**）；未列出的键被忽略；
- 保留键 **`cache_control`**：字符串，作为本响应的 `Cache-Control`（优先级最高），不进 `<head>`；
  类型写错只丢这个键（WARN），其余 meta 照常注入；
- **恒以匿名身份运行**：不经前置守卫（页面请求带不了 `Authorization`，走守卫等于恒 401），
  **租户头/请求头/请求体一律不传递**（`http.tenantId` 恒 `null`）。这不是省事，是安全边界：
  页面请求的头由客户端决定。若透传 `X-Tenant`，① `sql_guard: deny` 下构造器会把**攻击者指定的
  租户**当过滤条件；② `db.asTenant` 的门禁要求 `tenant_id` 为空，透传会让它必抛。
  要按租户取数只有一条正路：**handler 从 URL 派生 id → `await db.asTenant(id)`**
  （需 `tenant.allow_as_tenant: true`）。
  该 handler **不需要**写进 `anonymous_paths`；它被外部直接访问时仍受守卫约束（要连外部访问
  也放开才需加）；
- **fail-open**：未命中 / 非 2xx / 超时 / 非 JSON / 信封 `code != 0` → 打 WARN 后按静态结果
  原样送出（注入面坏了不能让页面跟着坏）；装配期则 **fail-fast**（路径必须命中 GET 路由）。
- **预算与缓存**：每次送 HTML 都会派发一次（平台侧无缓存层），超时按 `server.timeout`
  （默认 30s）——页面请求会跟着等。让 handler 只做**轻查询**/读缓存，并用返回的 `cache_control`
  让中间层替你挡住重复请求；不确定就 `no-cache` 或 `private, max-age=…`。
  **meta 若随身份/租户而异，禁用 `public`**（共享 CDN 会把 A 的标题发给 B；本版已把
  「租户头」这条来源掐掉，但 URL 派生租户 + `public` 的组合仍要自己判断）。

> **部署形态提醒**：注入由 **oj 自己送静态文件时**生效。生产若由前置反代/CDN 直出 SPA
> （nginx `try_files` / Caddy `file_server` / 对象存储静态站），本能力不生效——要么让站点走
> oj 托管（web 挂载），要么在反代层做同样的注入。

```yaml
mounts:
  - prefix: "/"                 # web 挂载（原 server.app_path: dist）
    web: "dist"
    spa: true                   # 深链刷新不 404
server:
  html_meta: "__meta"             # 可选：构建期 JSON 打底
  html_meta_handler: "/v1/api/html-meta"   # 运行期数据驱动
  html_cache_control: "no-cache"  # 壳随路由而异，别让中间层盲缓存
```

```ts
// src/html-meta/api.ts —— 只做「读数据 → 出键值表」，不碰 HTML
export default {
  async get() {
    const path = decodeURIComponent(String(http.query.path ?? ""));
    const slug = path.replace(/^\/issues\//, "");
    if (!slug) {
      json.ok({ title: "App" });
      return;
    }
    const rows = await db.table("issues").select(["name"]).where({ field: "id", op: "eq", value: slug }).limit(1).all();
    const name = rows.length > 0 ? String(rows[0].name) : "Not found";
    json.ok({
      title: `${name} · App`,
      "og:title": name,
      "og:type": "article",
      cache_control: "public, max-age=60",
    });
  },
};
```

验收（爬虫视角，不执行 JS）：

```bash
curl -s -H 'Accept: text/html' http://127.0.0.1:9778/issues/abc | grep -i '<title>\|og:'
```

### db —— 命名库（多库混用）

`name → DSN` 映射：`sqlite://<path>`（相对 config 目录，缺文件自动建空库）、
`sqlite::memory:`（仅测试，重启即丢）、`mysql://…`、`postgres://…`（原样透传）。

- 内置只有 sqlite/memory；`mysql`/`postgres` 需对应插件（oj-db-mysql / oj-db-postgres），
  未装插件 → 启动报 `unknown db scheme`。
- `DB("name")` 按名取库；查询构造器自动按库方言出 SQL；裸 SQL 占位符方言归业务
  （sqlite/mysql `?`，postgres `$1`）。
- `seed.sql` 仅对 **default 库且为 sqlite** 时重放。
- mysql/pg 连不上启动 fail-fast（连接串错/库未建）。
- **按库运维（v0.1.21）**：`oj migrate` / `oj test fixture` / `oj schema diff` 的 `--db <name>`
  即上方键名；缺省 `default`，未声明 fail-fast。账本 `_oj_migrations`、schema 收敛、
  `--baseline` 都各库独立——多库须逐库跑（模块绑不同库见第 3 章「命令」与场景 6）。
- DSN 带密码时写成 `"ENC[…]"` 密文（v0.1.33，见「secrets —— 凭据密封」）：整条 DSN
  一起封即可，不必拆出密码字段。

### redis

```yaml
redis:
  default: "redis://127.0.0.1:6379/1"
```

`default` **配置存在即真连**（启动 fail-fast：连不上直接报错退出，不静默退回内存），
需 oj-kv-redis 插件；未装插件 → 启动报 `no kv plugin loaded`。段缺失/全注释 →
进程内存 KV。真连后 `kv`/`redis` 全局与 auth 会话共享同一 Redis（多实例水平扩展的前提）。
仅 `default` 被使用，其余键 warn 忽略（warn 里的 URL **凭据段打 `***`**）。

URL 带密码时写成 `"ENC[…]"` 密文（v0.1.33，见「secrets —— 凭据密封」）。

### es

```yaml
es:
  endpoint: "http://127.0.0.1:9200"   # 块存在即启用；尾斜杠自动剪除
```

存在即启用 `es.search/index/del`，需 oj-es 插件；缺失时调用报 `es not configured`。
config 声明了 `es` 但无 es 插件 → 启动 fail fast。

### blob —— 对象存储

```yaml
blob:
  driver: "local"        # local | s3（s3 需 oj-blob-s3 插件）
  root: "uploads"        # local 专用：存储根（相对 config 目录绝对化，缺目录自动建，需写权限）
  # s3：endpoint / access_key / secret_key 可选，bucket / region 必填（缺失 fail-fast）
  # path_style: true     # MinIO/自建 S3 需 true（默认 virtual-hosted）
```

块存在即启用 `blob.*` 全局与 `{base}/blob/{key}` 下载路由。命名多后端：
`blob.backends.<name>` 各写一段（与平铺字段互斥，并存且平铺非默认 → 歧义报错），
JS 侧 `blob("name")` 取用。

### fs —— 本地文件系统

```yaml
fs:
  root: ./data     # jail 根（相对 config 目录绝对化；不存在/非目录 → 启动 fail-fast）
  readonly: false  # true = 写类 API 全拒（read 轴仍放行）
```

块存在即启用 `fs.*` 全局；缺省不启用（`fs.*` 抛 `NotCapable`，fail-closed）。

### broker —— 事件总线（三种 kind）

```yaml
broker:
  kind: kafka                       # local（默认，进程内）/ kafka / rabbitmq
  brokers: ["127.0.0.1:9092"]       # kafka 必需；rabbitmq 可省（取 url，再取 brokers[0]）
  # group: "oj-bus"                 # kafka 消费组默认
  # topic_prefix: "oj-bus"          # kafka 物理 topic 前缀 / rabbitmq 交换名，默认 oj-bus
  # url: "amqp://…"                 # rabbitmq 用
```

缺省（无 `broker:` 段）= 进程内 Bus（跨实例不互通）。`kind: kafka`/`rabbitmq` 需对应
插件，未装 → 启动报 `unknown broker kind`。

### tasks —— 任务池（v0.1.28）

```yaml
tasks:
  # dir: tasks                # 任务目录（api-path 相对；递归扫描 task_{name}.* / {name}_task.*）
  # max: 64                   # 任务数上限（同名双写拒启）
  # stop_grace_secs: 30       # 停机宽限（TLA 任务看门狗/池化 teardown 共用）
  pool:
    workers: 4                # 池化/cron 任务 worker 线程数（静态轮转分配）
    loop_body_timeout_ms: 5000  # 单轮 loop_body 看门狗超时（超时 → teardown → failed）
    interval_ms: 100          # 轮间节奏：每轮返回后 sleep 这么久再下一轮（防空转独占 Worker）
                             #   0 = 不限制（立即轮转——压测语义，生产会打满多核）
  crontab: task/crontab.yaml  # cron 清单（相对 tasks.dir，5 字段：分 时 日 月 周  相对路径）；缺省不启用
  event_log:
    enabled: true             # 任务事件 JSONL 日志（内存池的落盘侧）
    path: logs/task-events.jsonl
    max_mb: 16                # 超量轮转 .jsonl.1（朴素单备份）
```

双模分流：导出 `loop_body` 的任务文件走池化（§6「池化任务与 cron」）；其余走存量
TLA 监督器。两者皆无（无 loop_body 导出、无 crontab 文件）则不创建任务池。

### ws —— WebSocket 运行时（v0.1.10）

```yaml
ws:
  # max_connections: 1000      # 全局并发连接闸门：超限 upgrade 返 503；0 = 不限
  # workers_per_route: 2       # 每路由无状态 Worker 数（共享执行该路由全部连接的帧）
  # idle_linger_ms: 0          # 路由连接归零后 Worker 池保活毫秒数（0 = 立即退役）
```

段缺省 = 全默认。语义：内存与连接数解耦——每连接只持会话态（sess.state ≈KB 级），
V8 runtime 按 Worker 数常驻；单帧超时只断该连接（毒化 Worker 由池补员）。
执行模型详见第 4 章 §ws.ts。

### tenant / auth

字段与语义见第 8 章。tenant：默认关闭、header 默认 `X-TENANT-ID`、`anonymous_paths`
跳转腿豁免；v0.1.15 起增 `sql_guard`（false|"warn"|"deny"）与 `shared_allow` 共享表
白名单，语义与建表要求见第 8 章与 `docs/tenant-guide.md`。auth：`jwt_secret`（空串
启动 fail-fast，生产必改）、`signing_method`（HS256|HS384|HS512，默认 HS256）、
`access_token_duration`（默认 60s）、`refresh_token_duration`（默认 720h）、
`anonymous_paths`。无 `user_table` 配置——用户表是业务约定。

### oidc —— 内置 OP/RP 原语（段存在即启用）

RS256 签名/验签原语与装配期配置（第 6 章 `oidc` 全局）；缺 `oidc:` 段调用报
`oidc not configured`。

| 键 | 说明 |
|---|---|
| `issuer` | OP 标识/发现基址（如 `http://localhost:9778/v1/api/idp`） |
| `private_key_path` | RS256 私钥（PKCS#8 PEM，相对 config 目录；demo 用 `sample/config/oidc_rs256.pem`，与示例证书同性质，勿用于生产） |
| `rp` | RP 侧 `tenant → IdP` 映射：`issuer` / `client_id` / `client_secret` / `scope` |
| `clients` | OP 侧 client 白名单：`secret` / `redirect_uris`（**精确串**，未命中绝不重定向）/ `tenant` |

私钥只在 Rust 侧解析使用；`client_secret` 经 `oidc.rp`/`oidc.clients` 对 JS 可读——
与 `auth.jwt_secret` 同一信任级（能跑 handler 即能拿鉴权密钥）。

### plugins / plugins_dir —— 插件装配（map 一段三用）

`plugins:` 为 **map**，一段三用：

- **键 = 加载清单**：非空 map → 严格模式，只装配列出的插件（缺文件/身份不符/`@semver`
  pin 不符 fail fast）。
- **值 = 插件 cfg**：必须是 YAML 映射（对象）——非空对象**原样透传**为该插件 init cfg
  （跳过回落，第三方插件正规通道）；空对象 `{}` = 不覆盖，回落轴适配器/默认来源；
  字符串/列表等非对象值视为未提供，静默回落。
- **缺省/空 map = 扫描模式**：加载插件目录全部（目录不存在/为空 = 零插件，仅内置后端）。
  旧 list 写法 `plugins: [a, b]` 已废弃（解析报错）。

**cfg 三级解析（v0.1.54）**：插件 init 收到的 cfg 字符串按序取第一个命中——

1. `plugins:<name>` 非空对象 → 原样透传（如上）；
2. 插件自报 **config key**（入口宏 `config: "key"`）→ 顶层 `<key>` 段的**全量 Value**
   （段是「读」不是「占」——撞宿主已知的段名合法；段未配置给 `{}`，段可选是既有语义）；
3. 按名遗留臂（es/auth/mail/ldap 等第一方适配器）。

未被子报 key 或 `plugins:<name>` 非空透传消费的**未知顶层段**，启动打
`unconsumed config sections: […] (typo? or plugin not loaded)` 诊断，并可经
`oj info` CLI / JS `ojInfo()` 复查（见第 6 章「ojInfo()」）。

```yaml
plugins:
  kv-redis: {}                     # 只要清单不要覆盖 → 回落轴适配器（顶层 redis: 段仍生效）
  auth: { jwt_secret: "..." }      # 非空对象 = 原样透传，跳过回落
```

命名契约：插件文件 stem == descriptor name == `plugins:` 键（如 `libauth.dylib` ↔ `auth`）；
扫描模式以文件 stem 命中配置键。

`plugins_dir` 目录五级发现（先到先得），最终目录 = `<plugins_dir>/<host-triple>/`：

1. 环境变量 `OJ_PLUGINS_DIR`
2. config `plugins_dir`（相对 config 目录）
3. 打包布局：`OJ_BUNDLED_LD` 上溯两级得 `<bin>/plugins`（仅打包形态，v0.1.56 起）
4. `<exe>/plugins`（`bin/oj` 旁即 `bin/plugins`）
5. `<workspace_root>/bin/plugins`

已装配插件的清单可查：JS `plugins()`（第 6 章）与内置端点 `GET {base}/plugins`
（公共端点，不走 Bearer；`plugins` 为保留路径，业务模块勿占用该目录名）。

### vars —— 部署期常量（顶层 `vars:` 段，v0.1.25）

```yaml
vars:
  WEB_URL: "https://app.example.com"   # handler: vars.get("WEB_URL")
  SUPPORT_EMAIL: "support@example.com"
```

- **唯一读口**是 JS 的 `vars.get(name)`（第 6 章「vars」）：**同步**返回字符串，未声明键 → `null`。
- **fail-closed**：只有本段声明的键可读，平台没有「读任意 OS env / 任意 config 键」的通道。
- 值只能是**标量**（数字/布尔按 YAML 字面量成串，`PORT: 3000` → `"3000"`）；嵌套 map/list
  在解析期报错。
- 典型用途：邮件里拼的站点基址（`WEB_URL`）、对外展示的联系方式——**换环境只改 config，
  不必重新 `oj build`**。

### secrets —— 凭据密封（`ENC[...]`，v0.1.33）

把 config 里的明文密码换成密文，**配置文件可以进 git，私钥不行**。

```bash
# 生成 X25519 密钥对（私钥自动 0o600，已存在则拒绝覆盖）：
./bin/oj secret keygen --out-dir keys   # keys/secrets-private.pem + secrets-public.pem
echo -n 'hunter2' | ./bin/oj secret seal -k keys/secrets-public.pem   # → ENC[BASE64…]
./bin/oj secret open -c config.yaml 'ENC[BASE64…]'  # 排障：确认密文与私钥对得上
```

```yaml
secrets:
  private_key_path: keys/secrets-private.pem   # 相对 config 目录；**只放部署机**
  public_key_path:  keys/secrets-public.pem    # 可选，`oj secret seal` 缺省取它

db:
  default: "ENC[Ab3…]"          # 整条 DSN 密封（含密码）
auth:
  jwt_secret: "ENC[Ab3…]"
ldap:                            # 不透明段里的 bind_pw 同样支持
  default:
    url: ldap://dc.example:389
    bind_dn: "cn=admin,dc=example,dc=com"
    bind_pw: "ENC[Ab3…]"
```

- **算法（单信封，X25519 + AES-256-GCM，密文都带 `ENC[` 前缀）**：X25519 ECDH（临时私钥 ×
  收件方公钥）+ HKDF-SHA256 派生 32 字节会话密钥，正文由 AES-256-GCM 加密。明文长度无上限
  （不再受 RSA 单次 190 字节限制），密文被改一个 bit 会**解密失败**（GCM 校验）而不是解出垃圾。
  **固定地板仅约 62B**（版本 1 + 算法 1 + 临时公钥 32 + nonce 12 + tag 16），密文长度≈明文+62B，
  8 字密码约 95 字符（早期 RSA4096 同例会 ~735 字符，现已不会撑大）。
  RSA(v1) 信封已**移除**——`oj secret keygen` 只生成 X25519 密钥，config 里只有一种密钥，
  不再有「RSA 还是 X25519」的歧义；遇到存量 v1 密文解密时明确报错提示以 X25519 重封。
- **覆盖范围**：解密发生在配置解析的 Value 层（`Config` 结构体之前），**任何段、任意
  深度的字符串值**都支持——包括 `ldap` / `plugins` / `kafkas` 这类不透明段。将来新增
  配置段自动生效。没有 `ENC[...]` 的旧配置**完全不碰密钥路径**，行为不变。
- **私钥三通道**（优先级从高到低）：`OJ_SECRET_KEY`（PEM 内联）> `OJ_SECRET_KEY_FILE`
  （文件路径）> 本段 `private_key_path`。**常态用后两者**——内联 PEM 会出现在
  `/proc/<pid>/environ`、`docker inspect`、k8s pod spec 与 CI 的 env 回显里，只适合临时
  排障。
- **每环境用独立密钥对**：信封里没有 key-id，同一密钥对下**把 dev 的密文粘进 prod 照样
  能解**（反之亦然）。这不是缺陷，是刻意不做 key-id 与 AAD——代价是「环境隔离」要靠密钥
  分离来兑现，别多环境共用一对密钥。
- **fail-closed**：配置里有 `ENC[...]` 却找不到私钥（或解密失败）→ **启动报错退出**，
  绝不静默把密文当明文用（那会连上一个名叫 `ENC[…]` 的密码）。
- **能防什么**：配置文件泄漏（误提交 git / 镜像层 / 备份 / 工单附件）——泄漏者拿不到
  私钥就解不出密码。把「N 个密码」收敛成「1 个私钥」，且加密权（公钥，可进仓库）与
  解密权（私钥，只在部署机）分离。
- **不防什么**：私钥本身泄漏（那就全完了）、内存取证（明文必然在内存里）。
  **私钥请 chmod 600（`keygen` 已自动设置）、加进 `.gitignore`、不要和 config 放同一处。**
- **换密码/轮密钥**：`oj secret seal` 出新密文粘回去即可，密文互不相关（X25519 临时公钥 +
  随机 nonce，同一明文两次加密结果不同，且密文不可重放）。轮换密钥对须重封**全部**密文
  （旧私钥解密不了新密文）。
- **只能加密字符串值**：解密结果是字符串，落到 `port` / `limit` 这类数值字段会
  `invalid type: string` 报错（加密非敏感值也不报错——平台不判断「该不该加密」，只判断
  「是不是密文」）。字面量恰好以 `ENC[` 开头且以 `]` 结尾的明文会被当密文硬失败，报错
  里会提示换写法。密文也不能当**键**用（`ENC[...]: 1` 直接报错）。
- **日志面**：DSN / URL 出现在错误信息与 warn 里时**凭据段打 `***`**
  （如 `mysql://***@127.0.0.1:3306/app`），排障认得 host 就够。
- `keygen` 只生成 X25519 密钥对（无需 `--bits` / `--alg` 旗标）；密文格式固定为
  X25519 + AES-256-GCM，密文长度≈明文+62B。RSA(v1) 信封已整体移除（v1 无人使用，移除以
  避免密钥配置歧义）；手上若有旧版 RSA(v1) 密文，用 `oj secret seal` 以 X25519 重新加密。

完整手册（威胁模型、密文格式、轮换与迁移步骤、排障）见仓库 `docs/secrets.md`。

### 证书三字段：必配不可绕过

- `public_key_path` / `certificate_path` 缺任一 → 启动报错退出；**没有任何 config/CLI
  开关可跳过证书校验**；CLI `--cert-path` / `--key-path` 可覆盖路径，但不豁免校验。
- 证书有效期内正常；过期进入宽限期（`grace_days`，默认 30 天）→ **所有 GET 返回 403**
  （其余方法正常），替换证书即恢复，服务不中断。
- 宽限期结束再启动 → 记 ERROR 后进程退出（不服务）。
- 证书 / 公钥文件被覆盖即**热加载**（notify 事件驱动，无需重启）。

证书生成/续期见第 1 章与第 12 章。

### fail-fast 行为清单（启动即退，不等第一个请求）

| 触发 | 表现 |
|---|---|
| 证书两路径缺任一 | `certificate is mandatory but not configured` / `certificate not configured` 退出 |
| 证书过期且宽限期尽 | `certificate has expired and grace period elapsed` 退出 |
| `redis.default` 配置但连不上 | 报连接错误退出（不静默退回内存） |
| 未知 db scheme | `unknown db scheme` 退出 |
| db 方案冲突（内置与插件 scheme 交集） | fail fast 退出 |
| `broker.kind` 非法或声明但无对应插件 | `unknown broker kind` 退出 |
| `blob.driver` 非 local/s3；s3 缺 bucket/region | 启动报错退出 |
| `auth.jwt_secret` 为空串 | `auth.jwt_secret must not be empty` 退出 |
| `oidc.issuer` / `oidc.private_key_path` 为空，或私钥非 PKCS#8 PEM | `oidc: …` 报错退出（`oidc:` 段存在即校验） |
| config 声明 `es:` 但无 es 插件 | fail fast 退出 |
| `-d` 目录不存在 | 启动即报错 |
| 首层子目录缺 `manifest.yaml` | `missing manifest.yaml` 退出 |
| `manifest.yaml` 的 `name` ≠ 目录名 | `manifest name "x" != directory name "y"` 退出 |
| 版本目录名碰撞 | `version dir collision` 退出 |
| release：`manifests.yaml` 缺失/损坏/指向不存在版本 | 报错提示先 `oj build` |
| `no mounts configured — …` | 准入门（v0.1.58）：`mounts:`（config + CLI 折叠后）为空——加一条挂载或传 `--api-path`/`--app-path` |
| `api path not found: …` | `--api-path` 指定了就必须存在（静态站点存在性不在此判，见下行） |
| `mounts[i]: duplicate … mount prefix` / `mounts[i]: 挂载目录 …: No such file or directory` | （v0.1.58）装配期挂载解析 fail-fast：同类前缀重复或挂载目录缺失/非目录（api+web 同前缀配对合法） |
| `server.html_meta_handler` 未命中 GET 路由 | `server.html_meta_handler: "…" 不在路由表（拼错了？）` / `未映射 GET 方法` 退出（v0.1.25；后果只在爬虫侧可见，故不留到运行期） |
| config 里有 `ENC[…]` 但找不到私钥 / 解密失败 | `config has ENC[...] sealed values but …` 退出（v0.1.33；**不静默把密文当明文用**） |
| `vars:` 段值不是标量（嵌套 map/list） | 解析期报错（值只能是字符串/数字/布尔） |
| 同一张表被两个模块 schema.yaml 声明 | 表归属单射违反（S002），启动拒启 |
| release 下迁移账本落后（verify 门禁） | M004 拒启，报错附 `oj migrate` 命令 |
| `ext_boot.js` 存在但语法错/导入失败/顶层 await 抛错 | 启动期预热即 `ext_boot: …` 退出（服务不监听） |
| crontab.yaml 坏行（非 5 字段 cron + 路径 / 路径不存在） | fail-fast 退出，报错带 `:行号:`（v0.1.28） |
| `server.cors.credentials: true` 且 `server.cors.origins` 为空 | `cors: credentials requires explicit origins (wildcard '*' is rejected by browsers)` 退出（v0.1.35；带凭据的 `*` 非法）。其余字段缺省回落安全值 |

## 11. 构建与发布

> 何时读我：dev 跑通后要交付时。

### `oj build [module] [-d src] [-o dist] [--no-minify]`

```bash
./bin/oj build -d src -o dist          # 全部模块
./bin/oj build user -d src -o dist     # 单模块
./bin/oj build user --no-minify        # 排障：多行可读产物（含内联 sourcemap）
```

`oj build` 内建结构检查 S001–S008：S001 模块目录/manifest 合法性、S002 表归属唯一、
S003 跨模块 SQL 须声明 deps、S004 deps 版本范围可满足、S005 `tables` 与 schema.yaml
一致、S006 seed.sql 纪律（禁 DDL/禁非幂等 insert/只碰本模块及 deps 表）、S007 迁移
序列合法、S008 导入别名（`#` 目标存在、跨模块须在 deps 声明、manifest.yaml 只在模块根）。
违规 fail build；`oj build --check` 只查不落盘，作 CI 门禁。

每个模块构建为版本目录 `dist/<module>-<version>/`（版本读自模块 `manifest.yaml`；
同版本重建先清空旧目录）。构建零磁盘副作用（db 用内存库，不执行 seed）。

| 产物 | 说明 |
|---|---|
| `<module>-<version>/api.js` 等 | 全部 `.ts` 原路径换 `.js`（api.ts → 同目录 api.js）；默认转译 + **全量 minify**（v0.1.28：swc minifier，单行剥注释 + 死码消除/表达式压缩 + **函数内局部变量名混淆**；顶层/导出名与 `json`/`db`/`http` 等注入全局不受影响）。minify 同时剥掉转译尾部自带的内联 sourcemap——那行 base64 里藏着整份 TS 源码和构建机绝对路径，发布物不应带它；`--no-minify` 产物则保留（排障时可映射回源码，但别外发） |
| `<module>-<version>/routes.js` | 本模块路由表（pattern 无首斜杠、不含 base、含模块名段）；**`.route` 已从 api.js 剥离**——release 下路由事实唯一来源 |
| `<module>-<version>/manifest.yaml` | 原样复制 |
| `dist/manifests.yaml` | 模块 → 锁定版本（原子写，保留其他模块条目）；多版本目录可共存，锁决定 release 加载哪个 |
| `dist/<module>-<version>.tgz` | 确定性发布包（同输入字节一致，可校验完整性） |

跨模块相对导入构建期改写为指向目标模块版本目录的相对路径；目标模块未构建过则报错
（先 `oj build user`）。npm 依赖不打包进 tgz（裸 specifier 运行时沿 `node_modules`
解析，发布物需自带）。

### release 加载语义

`serve --api-path dist`（含 `manifests.yaml` → 自动 release）按锁逐模块加载各版本目录的
`routes.js` 聚合路由；锁缺失/损坏、指向不存在的版本、任何条目非法 → 直接报错
（提示先 `oj build`）。**目录镜像路由在 release 不存在**——路由只认 routes.js，
所以发布前必须 `oj build`。

### 发行包布局与打包脚本

按平台选用脚本（两者产物布局一致，仅归档格式不同）：

```bash
bash scripts/deploy.sh     # macOS / Linux → dist/oj-v<version>-<triple>.tar.gz
scripts\deploy.bat         # Windows (cmd) → dist/oj-v<version>-<triple>.zip
```

`<triple>` 取自 `rustc -vV` 的 host 行（如 `aarch64-apple-darwin`、
`x86_64-unknown-linux-gnu`、`x86_64-pc-windows-msvc`），与插件加载器的发现路径
`<exe>/plugins/<triple>/` 同形。版本取自 `oj/Cargo.toml`。每个包附带同名
`.sha256` 校验文件。

包内容（解包后，根路径 = 包名）：

```
oj-v<version>-<triple>/
├── oj                    # 主程序（Windows 上为 oj.exe；独立二进制，deno_core 内嵌）
├── plugins/<triple>/     # 插件 cdylib（oj-es、oj-db-*、oj-kv-redis、oj-blob-s3、oj-bus-*）
└── devkit/               # 本手册 + SKILL.md + global.d.ts（agent/编辑器类型提示）
```

目标机部署：解包 → 项目目录放 `config.yaml` + `dist/` + `seed.sql`（可选）+
vendored `node_modules/`（不打进 tgz）→ `./oj migrate -c config.yaml -d dist`
（release 默认 `migrate_on_start: verify`，账本落后会拒启 M004；config `db:` 段有命名库时
加 `--db <name>` 逐库跑）→ `./oj serve -c config.yaml --api-path dist`。
启动时把模块清单 + 路由表写入日志，可据此核对发布是否完整（终端默认静默：
`tail -f logs/server-*.log`，或启动时加 `--console-log`）。

### npm 分发（@oj-bin/*，v0.1.13）

除 tarball 外还有 npm 渠道，最终布局与解包一致：

```bash
npm i @oj-bin/oj     # 主包；optionalDependencies 自动带平台子包 @oj-bin/oj-<triple>
# 一次性运行（不落盘）：pnpm dlx @oj-bin/oj / npx @oj-bin/oj —— 经 bin.js 启动器直 exec 子包 oj
```

- `postinstall` 按当前平台取子包内容落盘 `<项目根>/bin/`（`oj` / `plugins/<triple>/` /
  `devkit/` / `lib`），原子替换（rename，可覆盖运行中的旧二进制）；**不支持全局安装**
  （没有确定的项目根，装全局直接报错）。被 `--omit=optional` / `ignore-scripts` 排除
  时 fail-fast 并提示。
- 发布由仓库 `scripts/npm-publish.sh` 单一来源：装配 + 幂等（`npm view` 已发布即
  skip）+ 门禁（tag 与 Cargo.toml 版本一致性、同 `(os,cpu)` 撞车、包根布局断言）+
  发布后置信断言（os/cpu/tarball 文件清单）。`DRY_RUN=1` 只装配断言不发布，本地自检用。
- npm 包不可撤回：CI 上 release 草稿期不发 npm（人工核对 release 后幂等补发），
  版本一经发布不可复用——改代码必须递增版本。

### `oj exec` —— 直接执行脚本（v0.1.29；内联代码/REPL v0.1.50；输出通道分离 + 缺省 REPL v0.1.55）

不起 HTTP 服务，直接在一个装配好完整后端的运行时里跑 ts/js 代码：一次性数据
修复、迁移后对账、定时任务原型、批处理脚本、临时调试求值。后端全局与 handler 同源
（`json`/`db`/`kv`/`blob`/`bus`/`es`/`fetch`/`ws`/`log`/`plugins`/`cert`/`jwt`/`bcrypt`/
`crypto`/`oidc`/`ldap`/`mail`/`mq`），经 `assemble_backend` 装配，db/kv/es/blob/bus/插件
全部可用。专题手册：仓库 `docs/exec-integration.md`。

**config.yaml 不是必需的**（v0.1.57 起 `-c` 可省）：省略时按「CWD 逐级向上 `config.yaml`
→ `$HOME/.oj/config.yaml`」搜索，都没有就用内置默认值（**v0.1.60 起 `oj exec` 静默回落、
不再向 stderr 打 `note:`**，与 `oj info` 同口径；仅 `serve`/`migrate`/`openapi` 等依赖后端配置
的场景保留该提示）——纯计算脚本（`-e '1'` 之类，不碰 db/表白名单）零配置可跑。目录解析
（`-d` 缺省时）：取 config/mounts 的第一条 api 挂载，无挂载才向上探测（只认「像业务树」的候选，
见 `-d` 参数行）；在源码仓根这类「祖先带非业务 `src/`」的地方裸跑，会得到 `service dir not
found` 指路 `-d`/`-c`，而不是把别人的树当模块扫。

**`-e` / REPL 默认回显单表达式求值结果**（v0.1.60，devtools 风格）：仅当整段是**单个顶层
表达式语句**时才包裹 `console.log((<expr>));` 输出其值——`oj exec -e '1'` 输出 `1`、
`oj exec -e '({a:1})'` 输出 `{"a":1}`；多语句 / 声明（如 `const x=1; x`）/ 已显式 `console.log`
等场景**不回显**，避免污染输出。需要显式控制输出时照常用 `console.log`。

三种用法互斥（**三者缺省——裸 `oj exec`——v0.1.55 起进 REPL**）：

- **`<file>`**：执行磁盘上的 `.ts`/`.js` 文件（`file + --code` / `file + --repl` 由 clap 报错）。
- **`-e, --code <code>`**（v0.1.50）：直接执行字符串里的 TypeScript（JS 子集亦合法），不落盘。
- **`--repl`**（v0.1.50）：进入交互式 REPL，逐行读 stdin 求值（Ctrl-D 退出）。

```bash
./bin/oj exec scripts/fix.ts -c config.yaml                  # 完整后端（文件）
./bin/oj exec scripts/fix.ts -c config.yaml --log-file a.jsonl
./bin/oj exec scripts/fix.ts -c config.yaml -- --dry-run id=7  # -- 后 argv 注入 globalThis.args
./bin/oj exec -e 'console.log(await db.query("select 1", []))' -c config.yaml   # 内联代码
./bin/oj exec --repl -c config.yaml                                        # 交互式 REPL
./bin/oj exec -c config.yaml                                              # 裸 exec：缺省进 REPL（v0.1.55）
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `<file>` | 三选一，缺省 REPL | 脚本路径；仅 `.ts`/`.js`，其他扩展名报错退出（exit 1）；与 `--code`/`--repl` 互斥 |
| `-e, --code` | 三选一，缺省 REPL | 内联代码（TypeScript 语法）；不落盘、自包含——**不支持相对 import**（无基准目录，合成 `file:///oj-eval.ts` specifier）；与 `<file>`/`--repl` 互斥 |
| `--repl` | 三选一，缺省 REPL | 交互式 REPL：逐行读 stdin 求值，后端全局可用；每行独立模块、顶层绑定作用域隔离，**跨行共享状态须显式 `globalThis.x = …`**；与 `<file>`/`--code` 互斥。真终端下由 **rustyline** 接管原始终端（方向键 / 行内编辑 / ↑↓ 翻历史，不再把 `\x1b[A` 等转义序列回显成乱串）；管道 / 重定向输入走普通回放（CI、测试、文件回放）。**裸 `oj exec`（无 file/-e/--repl）缺省即进 REPL（v0.1.55）** |
| `-c` | `config.yaml` | 配置文件路径 |
| `-d` | 自动探测 | schema 白名单来源目录（自 config 同级/CWD 向上逐级搜，同 `oj test`；只认「像业务树」的候选——首层 `*/manifest.yaml`、`manifests.yaml` 或空树，源码仓自己的 `src/` 会被跳过）；无合格候选 → 报 `service dir not found` 指路 `-d`/`-c`（纯 kv/log/fetch 脚本不受影响，给了 `-d` 或空树即可跑） |
| `--db` | 无 | 默认库重定向（同 `oj test`；未声明的库名 fail-fast，不回落 default） |
| `--redis` | 无 | 选中 `config.redis.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--blob` | 无 | 选中 `config.blob.backends.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--es` | 无 | 选中 `config.es.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--broker` | 无 | 选中 `config.broker.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--kafka` | 无 | 选中 `config.kafkas.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--rabbit` | 无 | 选中 `config.rabbits.<profile>` 为默认源（v0.1.34）；未声明即 fail-fast |
| `--log-file` | 不落盘 | 追加 JSONL（`{"ts","level","msg"}`）；打开失败仅 stderr warn 一次，终端输出继续 |
| `-- arg...` | 无 | `--` 之后的 argv 原样注入 `globalThis.args: string[]`（无 `--` 为空数组；REPL 下同样注入） |

> `--redis/--blob/--es/--broker/--kafka/--rabbit`（v0.1.34）把 config 对应段里**命名 profile**
> 选为默认源（装配期别名为字面 `"default"`），JS 侧对应全局无需改代码即指向选中源；给定
> profile 不在 config 段中直接 fail-fast，不静默回落 default。各段缺省回退字面 `default`。

**与 serve 的装配差异（有意为之，勿拿 server 直觉套 exec）**：

- **无证书门禁**：`server.certificate_path` 等不校验（exec 不起 HTTP 面）。
- **迁移默认 off**：serve dev 缺省 `auto`、exec 缺省**全跳过**（apply/verify/
  reconcile 都不做）；仅 config 显式写 `migrate_on_start: auto|verify` 时才执行对应项。
- **无 KillSwitch**：手工 runtime 不过 RuntimePool，同步死循环（`while(true){}`）
  会无限挂起——Ctrl-C 是唯一兜底；长任务请用 `src/tasks/` 任务池。
- **租户/归属守卫不设防**：exec 无 HTTP 请求上下文（租户 id 恒 None），视同匿名
  系统操作员；`sql_guard: "deny"` 的库上脚本须 `await db.asSystem()`。
- **`console` 仅 exec 可用**：serve/test 的 runtime 无 `console` 全局——同一脚本
  拷进 handler 会 `ReferenceError`。
- **`json.*`/`finish` 空转**：`json.ok(x)` 不会打印 x（没有 HTTP 消费方）；要输出
  用 `console.log`/`log.*`。

输出语义（**v0.1.55 通道分离**：结果走 stdout、诊断走 stderr）：`console.log`/`info`
**原样** stdout——无级别前缀，管道消费方拿到的就是消息本体（装配期 tracing 日志也只走
stderr，stdout 保持纯净）；`console.debug`/`warn`/`error` 与 `log.*`（zap 结构化日志，
含 info 级）走 **stderr**（保留 `INFO    消息` 式级别标签）；`--log-file` 时同一事件
双写 JSONL（全部级别照旧带级别标签落盘，语义不变）。退出码：成功 settle 0；脚本未捕获
异常 / 加载失败 / 装配失败 → stderr 报错，exit 1。

相对导入：脚本可 import 项目根（config 所在目录）内的 `.ts`/`.js`，**必须带显式
扩展名**（`import "./util.ts"`）；`import "../x"` 上跳出项目根即被拒。脚本放项目外
（如 `/tmp/foo.ts`）则连 `./util.ts` 都导不了（解析上界 = 项目根）。

## 12. 运维要点

> 何时读我：服务跑起来之后的证书/日志/排障/升级。

### 证书生命周期

```bash
# 首次签发（三件：private.pem / public.pem / cert.jws）
cargo run -p oj-cert -- gen -o config --days 365
# 到期续签：用现有私钥重签（公钥不变，服务器无需换公钥）
cargo run -p oj-cert -- renew -k config/private.pem --days 365
```

- 私钥**仅签发端保管**；服务器只放 `public.pem` + `cert.jws`。
- CLI `--cert-path` / `--key-path` 仅覆盖路径，**不豁免校验**。
- 运行中替换证书文件 → **热加载**即时生效（无需重启）；重载失败保留旧状态并记 warn。
- 探测：`GET {base}/health` 实时返回证书状态（宽限/过期仍可访问，便于监控）：

```json
{ "status": "OK", "certificate_status": "valid|grace|expired",
  "certificate_expiry": "2027-01-01T00:00:00Z", "grace_remaining_secs": 123456 }
```

- 宽限语义：过期 → GET 全部 403（其余方法正常）；宽限尽再启动 → 进程退出。
  调大 `grace_days` 仅延长宽限、不改 `exp`。

### 热重载语义

| 变更 | 是否热生效 |
|---|---|
| dev 模式改 `api.ts` 及其依赖 | 是（mtime 版本化 specifier 失效缓存，下次请求用新代码） |
| release 同版本重建 dist（清场重写同目录） | 是（同样按 mtime 失效） |
| release 换版本（改锁指向新版本目录） | **否**——`dist/manifests.yaml` 仅启动时读取，需重启 |
| 证书 / 公钥文件被覆盖 | 是（notify 事件驱动，不轮询 mtime） |
| `config.yaml` | 否（重启生效） |
| `seed.sql` | 否（仅启动重放） |
| `manifest.yaml` 新增/删除模块 | 否（重启生效） |
| schema.yaml / migrations 变更 | 否（重启或 oj migrate 生效；dev auto 在下次启动收敛） |
| `node_modules` 新增包 | 否（已加载包缓存于进程，重启生效） |
| `ext_boot.js` | **否**——装配期冻结 `file://…?v=<mtime>`，改了必须重启。启动日志会打印 `ext_boot: loaded <绝对路径> (<spec>)`，这是核对「跑的是不是改过的那份」的唯一依据 |

### 超时与资源

- 超过 `server.timeout` 的 handler 被 `terminate_execution` 强杀，HTTP 返回 408；
  被杀的 JsRuntime **丢弃不回池**，server 不崩、后续请求正常（这是对死循环的唯一熔断手段）。
- `RuntimePool` 最大空闲 16，负载后自动收缩；`pool_size` 等于并行请求上限
  （过高吃内存，过低排队）。

### PostgreSQL 语句缓存（v0.1.24，DBA 视角）

PG 插件会给**实际执行的 SQL 前置一段块注释签名** `/*oj:<形态>*/`（形态字母表 `t/i/f/b/m/u`，
分别对应字符串/整数/浮点/布尔/标记/无符号），使「同一条 SQL 文本 + 不同参数 Rust 类型」落到
**不同** prepared statement 缓存条目。这正是 v0.1.24 之前
`invalid byte sequence … 0x00` / `insufficient data left in message` 的病根：sqlx 的缓存 key
只有 SQL 文本，命中后会复用旧的 param OIDs。

- **可见性**：`pg_stat_activity.query` / PG 日志 / `EXPLAIN` 里会看到该前缀；`toSQL()` 与业务
  自己写的 SQL 字符串**不含**前缀。看到它请勿以为被篡改。
- **容量**：连接补了 `statement-cache-capacity=512`（条目数会随「SQL 数 × 参数形态数」增长）。
- **MySQL / SQLite 无此问题**（前者每次 execute 重发参数类型，后者无声明参数类型），故不打签名。

### 日志

`tracing-subscriber` 结构化输出：启动横幅（模块/路由表）、请求日志（方法/路径/状态/耗时）、
handler 内 `log.debug/info/warn/error(msg, ...kv)`。生产用 `RUST_LOG` 控制级别：

```bash
RUST_LOG=oj=info ./oj serve -c config.yaml --api-path dist
```

访问日志目录见第 10 章 `logs_dir`。

### 排障表（高频条目）

| 症状 | 原因 | 处置 |
|---|---|---|
| 启动报 `missing manifest.yaml` | 首层子目录缺清单或残留空目录 | 补齐 / 删除空目录 |
| 启动报 `manifest name "x" != directory name "y"` | `name` ≠ 目录名 | 对齐 |
| 启动报 `manifests.yaml … run oj build first` | release 锁缺失/损坏/指向不存在版本 | 跑 `oj build <module>` |
| 404 | 无对应 api 文件，或穿越/非法段 | 核对路径与 `-b` 前缀；release 确认模块在锁内 |
| 405 `method 'del' not exported` | DELETE 请求但没导出 `del`（不是 `delete`） | 改导出名 |
| 500 信封含 `api.ts` 字样 | TS 编译/解析错误 | 看 msg 定位行号 |
| 408 | handler 死循环/超时 | 查死循环，或调大 `server.timeout` |
| 413 | 超 `max_upload_bytes` | 调上限或压缩上传 |
| GET 全部 403 `certificate expired` | 证书进入宽限/过期 | 替换证书文件（热加载即时生效）；查 `{base}/health` |
| 启动报 `certificate …` 系列错误 | 缺路径/密钥不匹配/JWS 格式错 | 见第 10 章证书门禁；`oj-cert` 重签 |
| 启动报 `redis 'default': …` | Redis 不可达（fail-fast） | 起 Redis 或核对 URL；不想依赖就注释掉 `redis:` 段 |
| 400 `missing tenant header` | `tenant.enable` 且未带租户头 | 客户端补 header |
| 401 `missing or invalid bearer token` | auth 启用且路径不匿名 | 走 `/auth/login` 换 token |
| 500 `transaction already active` | 嵌套 `db.tx` | 合并为一个事务回调 |
| 日志 `open transaction … rolled back at request end` | `db.tx` 漏 await | 修 handler；数据已按未提交丢弃 |
| `bus.publish` 收不到广播 | bus 缺省为进程内，跨实例不互通 | 发布与订阅须同实例 |
| `GET {base}/…/ws` 404 | release 未重新 build，或 URL 含版本段 | 先 `oj build`；release URL 为 `…/news-0.1.0/ws` |
| 改 `api.ts` 不生效 | release 下 dist 未更新 / 换版本未重启 | 同步 dist；必要时重启 |
| `blob not configured` / `es not configured` | config 无对应段 | 加 `blob:` / `es.endpoint` |
| 启动报 M004 / 迁移账本落后 | release verify 门禁：有迁移未应用 | 先 `oj migrate -c config.yaml -d dist` 再启动；非 default 库加 `--db <name>` |
| 500 报跨模块表访问被拒 | `ownership_guard: deny` 且未声明 deps | manifest 补 `deps:`；或临时 SQL 注释 `/* oj:allow-table=x */` |
| `oj schema diff` exit 1 | 声明与实库漂移（D001/D002） | 按输出对齐 schema.yaml 或补迁移；存量库用 `oj migrate --baseline` |
| `oj migrate` 报 `--db "x" not declared in config (db keys: [...])` | `--db` 的库名不在 config `db:` 段（工具**不**回落 default，防迁错库） | 按报错里的 `db keys` 核对拼写；多库逐 profile 各跑一遍 |
| 启动报 `ext_boot: …` 并拒启 | ext_boot.js 语法错/导入失败/顶层 await 抛错 | 看报错定位；改完重启 |
| 启动没打印 `ext_boot: loaded` | 文件不在 config.yaml 同目录，或文件名不是 `ext_boot.js` | 挪到 config 同级；核对文件名 |
| 改了 `ext_boot.js` 没生效 | 不做热重载，装配期已冻结 spec | 重启进程 |
| `ext_boot.js` 里 `await` 报 SyntaxError | 文件无 import/export，被 CJS 启发式包进非 async 函数 | 加一句 `export {};` |
| `ext_boot.js` 里 `import "ext:core/ops"` 失败 | deno_core 硬拦，设计如此 | 用已有全局组合；要新 op 属改 bootstrap |
| 运行期偶发 500 且 msg 含 `ext_boot` | boot 依赖外部服务抖动，或文件被删/替换 | boot 改为幂等无外部依赖；恢复文件后重启 |

完整排障表见 `docs/ops-manual.md` §7。

### 插件升级与回滚

- 插件替换用 `.new` / `.bak` **原子换名**；升级前 `cargo xtask plugin <name> --check`
  预检（ABI / 身份 / semver / 符号）。
- **ABI bump 部署顺序：先升插件到新 ABI 并验证，再升宿主**（或同版本原子升级）。
  升级窗口内可用 `plugins()` 自省核对（第 6 章）。
- 多版本共存回滚（代码）：`dist/` 内旧版本目录不被构建清除，回滚单模块 =
  把 `dist/manifests.yaml` 该模块指回旧版本 + 重启 serve（锁仅启动时读）。
- 回滚（二进制）：换回上一版打包产物；保持二进制与 `dist/` 同版本发布。
- 升级前备份 sqlite 数据文件（`db.default` 路径）；配了 Redis/ES 的实例，它们的可用性
  进入启动契约（fail-fast），发布/巡检时先确认可达。

## 13. 安全红线与已知限制

> 何时读我：任何写 SQL / 拼路径 / 处理上传的时刻；发布前自查。

### SQL 注入红线（置顶，不可违反）

- **动态标识符（表名/列名）只来自 `db.table()` 查询构造器**（SchemaRegistry 白名单），
  **绝不来自 JS 字符串**。
- **值只通过绑定参数传递**（`db.query("... where id = ?", [id])` 或构造器的 `value`），**绝不字符串拼接**。

```ts
// 正确：标识符走构造器，值走绑定参数
const rows = await db.table("account").select(["id", "name"])
  .where({ field: "id", op: "eq", value: id }).all();

// 正确：裸 SQL 也必须参数化
await db.query("select id, name from account where id = ?", [id]);

// 错误：字符串拼接值（注入入口）
await db.query("select id from account where id = " + id, []);   // 禁止
```

排序/过滤白名单同理：构造器的表、列、可排序列都经白名单校验，绕过即失守。

### 路径安全

- 路由路径里的 `..` / `.` / `\` / NUL / 空段 → 404；静态兜底与 blob key 先 percent-decode
  再校验——解码出 `/`（`%2F` 走私）、`..`（`%2e%2e` 走私）同样 404。
- 路径参数（`http.param` / `http.params`）**已解码**（可含 `/`、`..` 字面）——仅用于
  参数化查询与类型转换，**勿拼接文件路径 / URL**。
- blob key 白名单：按 `/` 分段，`.` / `..` / `\` / NUL / 空段拒绝。下载路由
  `{base}/blob/{key}` **公开免鉴权**——不要把需鉴权的对象放进去。
- import 解析结果钳制在 project root 内，`..` 逃逸报错（第 5 章）。

### v0.2 已知限制全表

| 限制 | 说明 / 绕行 |
|---|---|
| ~~相对 `require("./x")` 不支持~~（v0.1.30 已支持） | 相对 require / JSON 模块 / 循环 require 均可用；`exports`/`conditions` 与 pnpm 布局完整支持。残留限制：`exports` 的 `types`/`browser` 条件不命中；CJS `module.exports` 替换函数式写法启发式识别 |
| blob multipart 预签名（v0.1.30） | `blob.uploadUrl` 的 multipart 形态暂返回 Err（object_store 无 multipart presign API）；单发 PUT 预签名 + `PUT {base}/blob/{key}` 直传路由（≤1 GiB）已覆盖大文件场景，>100MB 分片需求出现再补 |
| build 剥 `.route` 仅识别语句起始的标准赋值写法 | `fn.route = "…"` 顶层标准写法可用；花式写法可能漏剥 |
| npm 依赖不打包进 tgz | 发布物需自带 `node_modules/` |
| 旧版本目录不自动回收 | 锁不指向即为死数据，手工删 |
| 端口 <1024（如 778）属特权端口 | 需 root 才能 bind，用 ≥1024（默认 `9778`） |
| `.tsx` / `.mts` 不转译 | 直通 V8；统一用 `.ts` |
| 本地导入目标必须是 `.ts` | `./x.js`、`./d.json` 在产物里没有对应文件（只转译 `.ts`）→ `oj build` 直接失败 |
| 别名只能在**模块内**用 | 模块外的文件（`tests/` 用例、`src/tasks/` 任务池）没有模块根可锚定 → 继续用相对路径 |
| 跨模块别名必须声明 `deps` | 别名跨模块引用省略 `manifest.deps` → S008 fail（既有**相对**跨模块引用不追溯） |
| `manifest.yaml` 只能出现在模块根 | 嵌套声明会改写 `#` 别名的锚点 → S008 fail |
| tasks 池禁用别名 / 不得越池根 | 任务池是非版本化资产（只镜像 `dist/<tasks.dir>/`），无法绑定模块版本 |
| web 挂载无目录列表 / Range / ETag | 未知扩展名按 `application/octet-stream`；SPA 深链回落需挂载显式 `spa: true`（v0.1.58 起逐挂载，默认关——静默把 404 变 200 会掩盖错配，见 `scenarios.md` 场景 2）；HTML 缓存头可配 `server.html_cache_control`（v0.1.25，只作用于 HTML）；Range/ETag 经前置反代补；web 挂载仅 GET/HEAD（其余方法 405） |
| 多挂载（v0.1.58） | 同类前缀归一后重复 → 启动报错；挂载目录缺失/非目录 → 启动报错；命中挂载内 miss **不跨挂载**回落；`spa` 逐挂载显式（配对 web 恒无回落）；`html_meta`/`html_cache_control` 是全局键、按命中挂载根生效 |
| 动态 meta 每次 HTML 请求**多派发一次 JS** | `server.html_meta_handler`（v0.1.25）：每次送 HTML 都调一次该 handler（无缓存层）。高流量站点请让 handler 只读缓存/轻查询，并用返回的 `cache_control` 让中间层替你挡住重复请求 |
| release 下 WS URL 含版本段 | `…/news-0.1.0/ws`；客户端发现 WS 地址时注意拼版本段 |
| `db.tx` 每请求至多一个；嵌套报错 | 合并事务回调 |
| `db.stream` 仅非事务目标（v0.1.37；v0.1.38 起插件后端真流式） | 在 `db.tx` 内调用报 `db.stream within an active transaction is not supported (streaming queries run on the connection pool only)`。核心 SqlxAccessor（sqlite/mysql/postgres）+ 第一方插件（`oj-db-mysql`/`oj-db-postgres`，vtable 批量 pull ≤100 行/次）真流式；第三方插件未实现流式槽 → 回落 `db.query` 全量（不报错，仅失去内存优势）。内容等价于 `db.query` 全量，差异仅在内存形态 |
| 流式取消（`signal`）= 干净提前结束（v0.1.39；v0.1.42 起 pg/mysql 真取消） | abort 后**停止后端拉取**（有界行缓冲背压），缓冲行交付完即 done。**第一方插件 `oj-db-postgres`/`oj-db-mysql` 在 `postgres://`/`mysql://` DSN 下走专用连接，取消 = `pg_cancel_backend`/`KILL QUERY` + 断连 → 服务端查询立即终止（真取消）**；core（sqlite）与 Any 回退路径为协作式（批间生效）。已回调的行不回滚 |
| `http.file(i)` 对流式大文件报错（v0.1.38） | > `max_upload` 的 multipart 文件由服务端流式落 blob（字节不进 handler）——报错文案指路 `files[i].key`/`.url`；小文件行为不变 |
| `bus` 缺省进程内，跨实例不互通 | 需要跨实例广播配 `broker.kind` |
| bus 二进制 wire 约定（v0.1.16） | JSON → record/信封文本帧；字节 → record payload = 原始字节、投递为 Binary 帧。消费侧启发式：UTF-8 且为含 `topic`+`data` 的 JSON 对象才按文本信封，否则按二进制透传——**恰为该形状 JSON 的二进制载荷会以文本帧投递**（无害，自辨） |
| WS 二进制状态（Yjs awareness 等）不进 `sess.state` | `sess.state` 必须可 JSON 序列化；二进制状态走 base64 字符串存 `sess.state`/kv，或分片放 kv |
| `WhereCond.and/or` 嵌套未展开 | 多个 `where()` 即 AND；复杂条件用 `db.query` 参数化 SQL |
| schema 回滚无自动机制 | 迁移只前向；破坏性变更前备份，反向变更写新 seq 迁移 |
| fixtures/ 不进 release 产物 | 演示数据走 fixtures（oj test / oj test fixture）；参考数据走模块 seed.sql |
| `db param: u64 value … is not supported on this path`（v0.1.24） | 在 PG/SQLite 上用了 `toUBigInt()`——它们的 bigint 是 i64；改存 text，或把该列放到 MySQL `BIGINT UNSIGNED` |
| `_name_` 目录段必须整段且参数名合法（v0.1.27） | `__x__`/`___`/`_a{b}_` 不转换（保持字面）；转换产物由 `oj build` 期 pattern 试插校验把关，非法/同位异名即构建失败 |
| 同层异名 `_x_` 目录是结构性冲突（v0.1.27） | `_aa_/` 与 `_bb_/` 并存 → 后者启动丢弃并告警（matchit 同位异名规则，与 `.route` 同） |
| handler 分配超限 → `js heap limit exceeded`（v0.1.40） | 单 isolate 堆限额 `server.js_heap_limit_bytes`（默认 256 MiB，下限 32 MiB）：V8 near-heap-limit 触发即终止该 isolate 并**丢弃不回池**，请求 5xx 信封、进程存活。已知边界：单个 > 限额的巨型分配仍可能触发 V8 Fatal（V8 二次逼近语义） |
| WS 目录镜像不转换 `_name_`（v0.1.27） | `_name_/ws.ts` 暴露字面 URL；WS 侧暂不支持动态段（v0.2 评估） |
| `tenant guard: tenant id "acme" is not a valid integer for numeric column …`（v0.1.24） | `tenant_id` 列声明为 integer/bigint，但租户头不是十进制字面量；数值租户列请用数字租户 id，或把列改成 text |
| i64 超界读出来是字符串，不是 number（v0.1.22） | `\|v\| > 2^53-1`（雪花 id 常态）按值域分流为十进制字符串——改过 `typeof id === "number"` 判断的代码要复查；回写用 `toBigInt()`，别用 `Number()`（会静默坍缩） |
| `Number("<大整数串>")` 平台拦不住 | 语言语义，只能靠范式：`toBigInt(rows[0].m) + 1n`（`toBigInt` 对已坍缩的值会抛错） |
| `db(mysql): column 'x' has MySQL type 'DECIMAL' which this plugin does not decode yet`（v0.1.24） | MySQL 读侧不支持的类型（`DECIMAL`/`JSON`/`DATE`/`DATETIME`/`TIMESTAMP`/`TIME`/`YEAR`/`BIT`/`GEOMETRY`）**报错而非给 `null`**；在 SQL 里显式转换：`select cast(x as char) as x from t`。不要用 `select *` 兜住这些列 |
| MySQL `BOOLEAN`/`TINYINT(1)` 读出是 `1`/`0` 而不是 `true`/`false`（v0.1.24） | MySQL 没有独立 boolean 类型（`BOOLEAN` 即 `TINYINT(1)`），协议层无列长度元数据可区分；按整数读。需要 boolean 语义就在 SQL 里转：`select flag = 1 as flag from t` |
| 迁移工具 `--db` 不解析模块级 `manifest.db`（v0.1.21） | `oj migrate` / `test fixture` / `schema diff --db X` 把**全部**模块作用于 X（运行期绑定只影响路由）；模块各自绑不同库的项目须 `--db X --module M` 逐组合跑——见 `scenarios.md` 场景 6 |
| ldap 无连接池（每调用独立 connect/bind/unbind） | 设计取向：bind(dn,pw) 用户凭据绝不共享连接；LAN 上 AD 连接建立为毫秒级。热路径（每请求多次 LDAP 调用）先用 `search` 一次取全所需字段，仍不够再评估给插件加 ldap3 pool |
| ldap `search` 不做分页 | 服务端可拒超量返回（AD 默认 1000 条上限）；大结果集用 `axis("ldap").search_paged` |
| ldap referral 不自动跟随 | `search` 返回 referral 引用（`ResultEntry::Refer`）时插件收集进结果 refs 并跳过——目录树跨 ref 分片的场景先确认 base 落在目标分区内 |
| ldap `filter` 无参数绑定 | 字符串直拼，用户输入须先按 RFC 4515 转义（见 §6 ldap 节），否则是 LDAP 版注入 |
| 二进制属性（`jpegPhoto` 等）出 `bin` 为 base64 字符串 | `entry.bin.jpegPhoto[0]` 是 base64 文本；落库/出 HTTP 前自行解码，勿当 UTF-8 原文 |
| `ext_boot.js` 用顶层 `await` 须带 `export {};` | 否则被 CJS 启发式包进非 async 函数 → SyntaxError（§6 末） |
| `ext_boot.js` 拿不到 `ext:core/ops` | deno_core 拒绝 `file://` → `ext:` 导入；只能在已有全局上做组合，新 op 属改 bootstrap |
| `ext_boot.js` 不做热重载 | 装配期冻结 spec，改动必须重启；池内可能新旧混杂 |
| `oj exec` 无执行超时 / KillSwitch（v0.1.29） | 手工 runtime 不过 RuntimePool：同步死循环（`while(true){}`）无限挂起，Ctrl-C 是唯一兜底；常驻轮询用 `src/tasks/` 任务池 |
| `oj exec` 租户/归属守卫不设防（v0.1.29） | 无 HTTP 请求上下文（租户 id 恒 None）= 匿名系统操作员；`sql_guard: "deny"` 的库上脚本须 `await db.asSystem()` |
| `oj exec` 相对导入上跳被拒（v0.1.29） | import 被钳制在项目根（config 所在目录）内且须显式扩展名——`import "../x"` 报 escapes project root；脚本在项目外则连 `./util.ts` 都导不了 |
| `oj exec -e/--code` 与 `--repl` 不支持相对 import（v0.1.50） | 内联代码/REPL 行无基准目录（合成 `file:///oj-eval.ts` / `file:///oj-repl/<n>.ts` specifier），**应自包含**；需要 import 复用请改走 `<file>` 模式 |
| `oj exec --repl` 顶层绑定不跨行持久（v0.1.50） | 每行是独立模块、作用域隔离；`const x=1` 下一行读不到，跨行共享须显式 `globalThis.x = 1` |
| `blob.readRange` 是短读（v0.1.47） | 越尾只返回实际可读字节、`offset` 过尾返回**空数组**——先判 `head.length` 再分支，不要假设一定拿满 `len`；`offset` / `len` 为负 / 小数 / NaN 报错 `blob readRange: offset must be a non-negative integer` |
| `blob.copy` / `blob.move` 的 `src == dst`（v0.1.47） | 明确 **no-op**（`fs::copy` 同文件语义未定义、会截断文件）——不是「复制一份给自己」；`move` 后 src 一定不存在，`copy` 后 src 一定还在 |
| blob 搬运 / 区间读的能力回落（v0.1.47） | 后端不支持时宿主回落：`copy` → `get`+`put`（**2× 峰值，字节进 V8**）、`readRange` → `get` 全量切片。JS 侧永不因后端能力失败，但回落不便宜——local/s3 均原生支持，回落只是第三方后端的保险 |

### 常见陷阱清单

- `del` 不是 `delete`——DELETE 请求映射方法名 `del`，写错返回 405。
- 大整数（雪花 id / i64）：读出来是**字符串**，算之前 `toBigInt()`，回写也用它的结果；
  `Number("<大整数串>")` 会静默坍缩成 f64 网格值（后续撞主键 dup 500），详见 §6「大整数与 i64」。
- 同一条 SQL 文本别混用不同类型的参数（一会儿字符串、一会儿数字/大整数）——PG 的
  prepared statement 缓存会给出协议级报错（`invalid byte sequence for encoding "UTF8": 0x00`
  等）；换 SQL 文本或保持参数形态稳定。
- `{id}.json` 混字面 pattern 非法——matchit 参数段不得混字面，拆成静态多段由 handler 校验。
- `seed.sql` 不得含分号字面量（按 `;` 切分）；用 `INSERT OR IGNORE` 保证幂等。
- postgres 占位符是 `$1`，sqlite/mysql 才是 `?`。
- 上传 413 双闸：`max_upload_bytes`（信封 413）+ axum 层 2x 硬顶（裸 413）——客户端看到
  的 413 未必带 oj 信封。
- 未配置 `blob:` / `es:` 段时调用 `blob.*` / `es.*` 即报错（配置即启用）。
- 挂 `.route` 后目录镜像路径 404（替换语义）；`{*path}` 至少匹配一段。
- `redis.default` 配置即真连且 fail-fast——CI/离线环境注释掉该段即用内存 KV。
- 每请求至多一个 `db.tx`；漏 await 会在请求结束时自动回滚并打 warn。
- `beforeEach` 是单一全局钩子，跨 `describe` 被覆盖——多 describe 文件在各 `it` 内联准备。
- WS Binary 帧 `http.body` 是 `null` 不是乱码——取字节用 `http.bodyBytes()`（v0.1.16）。
- `ws.send` 的帧型由**参数类型**决定：string → Text、Uint8Array → Binary——回显二进制协议时
  别把字节先 decode 成 string 再发（帧型就变了）。
- `ext_boot.js` 里别写库/发广播/打外部接口——执行次数是「模块数 + `pool_size` + WS Worker 数
  （每路由 `ws.workers_per_route`）」，副作用按此放大；boot 只做全局装配。
- `ext_boot.js` 顶层 `await` 忘了 `export {};` → 看起来莫名的 SyntaxError（CJS 启发式误判）。
- 静态站深链刷新 404：web 挂载没写 `spa: true`（默认关，刻意为之）。
- IM 预览/爬虫只看到默认标题：`html_meta`（构建期 JSON）覆盖不了**按数据**的路由 —— 用
  `server.html_meta_handler` 指一个 GET handler（v0.1.25），见 §10「静态站点与 per-route meta」。
- `vars.get("X")` 恒 `null`：`X` 没写进 config 的 `vars:` 段（fail-closed，不读 OS env）。
- 动态 meta 的 handler 要读**原始请求路径**得看 `http.query.path`（percent-encoded，自己
  `decodeURIComponent`）；它不经守卫、拿不到 `http.user`（页面请求本来也没有 Bearer）。
- `oj exec` 脚本里 `json.ok(x)` 不打印 x——`json.*`/`finish` 空转（没有 HTTP 消费方）；
  要输出用 `console.log`/`log.*`（`console` 仅 exec 运行时提供，拷进 handler 是
  `ReferenceError`；v0.1.55 起通道分离——`console.log`/`info` 原样 stdout，
  `console.debug`/`warn`/`error` 与 `log.*` 走 stderr）。`oj exec` 迁移默认 off
  （serve dev 缺省 auto，两命令相反）。
