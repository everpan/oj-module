# db 新人手册 —— 配置 + JS 全量数据访问

> 面向第一次写 oj handler 的新人。目标：读完能独立完成「配库 → 建表 → 增删改查 → 事务」，
> 并理解每一步背后的安全边界。
>
> 本手册讲「怎么上手、为什么这样设计」。逐 API 的穷举式参考见
> [`docs/devkit/api-manual.md`](api-manual.md) 第 6 章「db / DB(name)」。
> 所有 API 名、字段名、报错文案均与源码（`src/bridge/bootstrap.js`、`src/bridge/query.rs`、
> `src/bridge/db.rs`、`src/bridge/dialect_caps.rs`、`src/bridge/db_policy.rs`）逐字核对，
> **版本 0.1.89 / ABI 12**。
> 方言能力模型（开放方言名 + 能力位）与结构化数据库错误是 0.1.88 的两处结构性变更，
> 见 §10.5 与 §10.7；库级访问控制（`db_access:` 段）是 0.1.89 的新增面，见 §11.5。
>
> 文中「fail-fast」= 发现问题立刻报错退出；「白名单」= 只有预先声明过的表/列才能被
> 访问，其余一律拒绝。

---

## 0. 五分钟上手

从零到跑通一次查询的最短路径。第一次用 oj 就按这节做。

### 1) 配一个库

`config.yaml`（与 `oj serve -c` 指向的目录同级）：

```yaml
db:
  default: "sqlite://db.sqlite"   # 键 = 库名，值 = DSN
```

DSN 支持 `sqlite://`、`mysql://`、`postgres://`，可混用（见 [§1](#1-db-配置)）。
test-only 还有 `sqlite::memory:`（真 sqlite，重启即丢）与 `memory://`（**假后端**，不执行 SQL）。

### 2) 声明表（白名单的源头）

模块目录下 `schema.yaml`（例：`src/user/schema.yaml`）：

```yaml
tables:
  account:
    pk: id
    columns:
      id: { type: integer, autoincrement: true }
      name: { type: text, null: false }
      role: { type: text, null: false }
```

同时在该模块的 `manifest.yaml` 里声明拥有它（`tables: [account]`）。
**没有进 schema.yaml 的表/列，JS 侧一律摸不到**——这是整座安全模型的根。

### 3) 写第一个 handler

`src/user/account/api.ts`：

```ts
function get(): void {
  db.table("account")
    .select(["id", "name"])
    .where({ field: "role", op: "eq", value: "admin" })
    .orderBy([{ field: "id", dir: "desc" }])
    .limit(10)
    .all()
    .then((rows) => json.ok(rows))
    .catch((e) => json.fail(500, String(e)));
}

export const get_route = "{id}";   // 可选：路径参数路由
export { get };
```

handler 也支持 **async 写法**——`db.*` 全部返回 Promise，运行时会等 Promise 落定再捕获
信封（sample 的 admin 模块即此风格，多数人觉得更好读）：

```ts
async function get(): Promise<void> {
  try {
    const rows = await db.table("account")
      .select(["id", "name"])
      .where({ field: "role", op: "eq", value: "admin" })
      .orderBy([{ field: "id", dir: "desc" }])
      .limit(10)
      .all();
    json.ok(rows);
  } catch (e) {
    json.fail(500, String(e));
  }
}

export const get_route = "{id}";
export { get };
```

两种写法等价，选一种贯穿整个模块即可。async 的额外好处：多个 db 调用按顺序
`await`（读起来像同步代码），整个函数共享一个 `try/catch`，不用每步 `.catch`。
事务（§4）的 `db.tx(async (tx) => {...})` 只能用 async 写。

### 4) 跑起来

```bash
./bin/oj serve -c sample/config.yaml --api-path sample/src
curl "http://localhost:9778/v1/api/user/account/?role=admin"
```

返回 `{code:0, msg:"ok", data:[...行数组]}`。就这么多——下面逐层展开。

---

## 1. db 配置

### 1.1 `db:` 段 —— 命名库

```yaml
db:
  default:   "sqlite://db.sqlite"
  analytics: "mysql://user:pass@127.0.0.1:3306/app"
  warehouse: "postgres://127.0.0.1:5432/app"
```

- 键 = **库名**，值 = DSN。DSN scheme 只负责**选后端**（`sqlite://` 内建、
  `mysql://` → `oj-db-mysql`、`postgres://` → `oj-db-postgres`）；**方言名由后端自己声明**
  （插件 `describe()` 的 `dialect`，v0.1.88 起是开放集），不是宿主从前缀猜的。
  未知 scheme 启动即拒：`unknown db scheme in dsn '<脱敏>' (known: ["sqlite://", …])`——
  `known` 列表随**实际装上**的后端变，看不出 mysql 就是插件没装上（不是配置写错）。
- 仅测试可用的两个 DSN：`sqlite::memory:`（真 sqlite，进程退出即丢）与 `memory://`
  （`InMemoryAccessor`，**假后端**：不执行 SQL，`query`/`exec` 一律回夹具行）。因此
  `memory://` 上 `db.nextSeq` 拿不到返回值（`no value returned`）——它不是「内存版
  sqlite」，别拿它验业务 SQL。
- JS 侧 `db` 就是 `DB("default")`；其他库用 `DB("analytics")` 取。名字不存在时
  `DB(name)` 返回 `undefined`（`op_db_has` 探测）。
- **模块默认库重定向**：模块 `manifest.yaml` 可写 `db: warehouse`，此后该模块里的
  字面 `db.*`（即 "default"）自动落到 warehouse；显式 `DB("...")` 不受影响。
- **库级迁移 / 对账（v0.1.21）**：`oj migrate` / `oj test fixture` / `oj schema diff` 默认作用
  `default`，用 `--db <name>` 改指上面任一命名库（未声明即 fail-fast）。它是**整轮**的
  目标库，不认模块级 `manifest.yaml` 的 `db:` 绑定——多库部署对每个 profile 各跑一遍，
  账本 `_oj_migrations` 与 schema 收敛各库独立。详见 `docs/migration.md` §3.8。

### 1.2 数据库插件

方言能力由 cdylib 插件提供：`oj-db-mysql`、`oj-db-postgres`（sqlite 由内置 sqlx 访问器承载）。
插件在 `describe()` 里声明方言名与能力位（`placeholder_*` / `id_*` / `stream` / `cancel`），
宿主装配期严格校验，写错直接拒启——能力位全表见 §10.5，运维面（`plugins.lock.json`、
整体拷贝 `bin/`）见 `docs/ops-manual.md` §1.2。装配走 `config.yaml` 的 `plugins:` 段，一段三用：

```yaml
plugins:
  oj-db-mysql: {}          # 值 = 空对象：装配插件，配置回落轴适配器
  # oj-es: { endpoint: ... }  # 值 = 非空对象：原样透传给插件 cfg
  # 缺省/空 map = 扫描模式：加载插件目录下全部插件
```

插件发现路径（先到先得）：`OJ_PLUGINS_DIR` 环境变量 > config 的 `plugins_dir` >
打包布局（`OJ_BUNDLED_LD` 上溯两级，仅打包形态）> `<exe>/plugins` >
`<workspace_root>/bin/plugins/<host-triple>/`。
用 `cargo xtask build` 会把插件归置到 `bin/plugins/`。

### 1.3 `schema.yaml` —— 白名单与建表

- **列白名单**：表/列只有声明进 schema.yaml，构造器与归属守卫才认。
  列类型最小集：`integer | bigint | text | boolean | double | blob`。
- **安全前向自动收敛**（`migrate_on_start: auto`，dev 默认）：加表、加可空列、加索引
  会在启动/reconcile 时自动应用；**类型变更、删列、改名必须走 `migrations/` 手写迁移**
  （release 默认 `verify`：账本落后拒启，先 `oj migrate`；非 `default` 库用
  `oj migrate --db <name>`）。
- 同一张表被两个模块声明 → 装配 fail-fast（S002）。
  `manifest.yaml` 的 `tables:` 清单与 schema.yaml 双向一致（S005，`oj build` 内嵌检查）。

### 1.4 表归属守卫（模块间）

schema.yaml 声明使表「归属」其模块。跨模块访问需要显式依赖：

```yaml
# src/order/manifest.yaml
deps: { user: "^0.1.0" }   # 声明后 order 模块可读 user 模块的表
```

`server.ownership_guard` 控制处置：`warn`（默认，仅告警）/ `deny`
（拒绝执行，报错文案附修复指引）。未声明归属的表不设防。
守卫覆盖三条路：构造器（`db.table()` 按表精确判）、裸 SQL（提取表名逐表判）、
以及构造器条件里嵌套的子查询/exists/union 成员/CTE 内部（递归全查）。

### 1.5 多租户（与 db 的关系）

```yaml
tenant:
  enable: true
  header_key: "X-TENANT-ID"        # 缺失/空 → 400 `missing tenant header: X-TENANT-ID`
  sql_guard: deny                  # off（默认）| warn | deny；也认 bool（true=deny / false=off）
  require_signed_claim: false      # true：租户只认验签后的 user.claims.tenant
  shared_allow: [dict, geo]        # 共享表白名单（schema.yaml `tenant: false` 才生效）
  allow_as_tenant: false           # 放行 db.asTenant(id)
  anonymous_paths: ["/v1/api/oidc/*"]   # 免租户头（OIDC 回跳带不了自定义头）
```

`enable: true` 后请求头值注入 `http.tenantId`；`require_signed_claim: true` 时改用验签
claim（`user.claims.tenant`），裸头只做一致性复核——不符 `tenant header does not match
signed claim`，缺 claim `tenant requires a signed claim (user.claims.tenant missing)`。
装配期校验：`require_signed_claim` 必须同时有 `tenant.enable=true` 与 `auth:` 段。

**SQL 层是否自动拼租户条件，由 `sql_guard` 决定**（默认 `off` = 完全不注入，
「过滤靠你的 where」只在这个默认档成立）：

| 档位 | 构造器（`db.table()`） | 裸 SQL（`db.query/exec/stream`） |
|---|---|---|
| `off`（默认） | 不注入、不校验 | 不校验 |
| `warn` | 缺失租户头 → `eprintln!` 告警后**不注入**放行；有头则照常注入 | 缺 `tenant_id` / 无租户头 → 告警放行（warn 只查「文本里有没有 `tenant_id`」，不核对绑定值） |
| `deny` | 缺失租户头 → 拒；其余同 `warn` 的注入路径但违规即拒 | 缺 `tenant_id` / 参数不含当前租户 / 碰 DDL → 拒 |

`warn` / `deny` 下构造器的注入是全自动的（`build_statement` 之前做，`toSQL()` 产物
同样已注入，可安全回跑 `db.query`）：

- `select` / `update` / `delete`：追加 `{表别名}.tenant_id = ?`（用别名限定，避免 join 歧义）。
- `insert`：强制写入当前租户值；行里已带 `tenant_id` 且不等 → `tenant guard: insert
  tenant_id mismatch (got …, want …)`；`update` 的 `sets.tenant_id` 一律拒
  （`tenant guard: update sets.tenant_id not allowed (got …)`）。
- `insert…fromSelect`：源 select 当作常量列补 `tenant_id`，`insert_cols` 显式带
  `tenant_id` → `tenant guard: insert fromSelect must not supply tenant_id`。
- join 表：租户条件进 `ON`（不是 `WHERE`）；条件树 / `having` / `case when` / 子查询 /
  `exists` / union 臂 / CTE / `fromSelect` 全部递归覆盖。
- 缺失租户头时：`tenant guard: table(s) ["t"] require tenant context (missing tenant
  header; use db.asSystem() for system tasks)`。

**哪些表算租户表**：`!shared && has_column("tenant_id")`。共享表要在 schema.yaml 标
`tenant: false`，**并且**列进 `tenant.shared_allow`——白名单为空时该标记被忽略（fail-closed，
仍按受租户约束校验 `tenant_id`）。

`sql_guard` 非 `off` 时的声明期硬约束（serve 启动 / `oj build` / `oj migrate` 三处校验）：
schema.yaml 里声明的业务表**必须有 `tenant_id` 列**（`schema: [m] 表 "t" 缺 tenant_id 列…`，
共享表双声明豁免）；`tenant_id` 列类型只能是 `text` / `integer` / `bigint`
（`double` / `boolean` / `blob` 没有等值租户 id 语义，直接拒）。注入值按**声明类型**绑：
`text` → 字符串，`integer` / `bigint` → 数值形态（小值 number、更宽 i64/u64 标记）。
数值列上租户头必须是**十进制字面量**，否则 `tenant guard: tenant id "…" is not a valid
integer for numeric column t.tenant_id`——**`warn` 档也硬失败**（warn 只放行「无法判定」，
不放行「判定为不匹配」）。

裸 SQL 是**文本级 best-effort**（清洗注释/引号后找 `tenant_id` 字样 + 参数等值），
不等于语义分析：`tenant guard: raw sql on ["t"] lacks tenant_id condition (use db.table()
builder)`、`tenant guard: raw sql params must include current tenant id ("t1") under deny
mode`；另有两条 fail-closed——DML/DDL 命中却**提取不到已登记表**
（`tenant guard: {KW} touches no registered table (cannot verify tenant scope)`）、
`TRUNCATE/ALTER/DROP/CREATE` 触碰已登记表（`tenant guard: {KW} on registered table(s) […]
not allowed under sql_guard`）——都无法注入条件，deny 拒、warn 只告警。

**两个逃生口**：`db.asSystem()`（请求级绕过、`ReqState` 重置即失效，日志留
`warn: db.asSystem() invoked (tenant guard bypass for this request)`，只给审计/运维类
handler）；`db.asTenant(id)`（匿名请求声明租户，**不绕过**防护——租户条件照常注入，只是
id 由 handler 给。三道门禁：`allow_as_tenant: true`、请求匿名且尚无租户头、`id` 非空）。
报错文案：`db.asTenant is disabled: set tenant.allow_as_tenant=true to let anonymous handlers
declare a tenant` / `db.asTenant is only allowed on anonymous requests (anonymous_paths hit,
no tenant header)` / `db.asTenant: id must not be empty`。

---

## 2. `db` 全局：方法面总览

`db === DB("default")`，每个命名库同构：

| 成员 | 签名 | 返回 | 用途 |
|---|---|---|---|
| `query` | `query(sql, params?)` | `Promise<行数组>` | 原生参数化查询 |
| `exec` | `exec(sql, params?)` | `Promise<受影响行数>` | 原生参数化执行 |
| `stream` | `stream(sql, params?, opts?)` | `Promise<void>` \| `AsyncIterable<行>` | 流式查询（逐行拉取，v0.1.37，见 §3.1） |
| `explain` | `explain(sql, params?, opts?)` | `Promise<{plan: PlanNode}>` | 执行计划归一树（G3 v0.1.108，见 §3.2；sqlite/未知方言 unsupported） |
| `table` | `table(name)` | 查询构造器 | 安全构造器（本手册主角） |
| `fromJSON` | `fromJSON(snapshot)` | 查询构造器 | 从 toJSON 快照恢复 |
| `tx` | `tx(async (tx) => {...})` | `Promise<fn 返回值>` | 请求内事务（§4） |
| `session` | `session.begin()` / `attach(id)` / … | `Promise<…>` | **跨请求**事务会话（v0.1.95，§4.5） |
| `leaf` / `and` / `or` / `not` | 工厂 | 条件对象 | 条件组合（§5.2） |
| `nextSeq` | `nextSeq(name)` | `Promise<number \| string>` | 平台序列取号（§11 第 7 条） |
| `listTables` | `listTables(prefix?)` | `Promise<string[]>` | 目录自省（v0.1.82；三内置方言同口径，其他方言 `OJ_DB_UNSUPPORTED`） |
| `listSchemas` | `listSchemas(prefix?)` | `Promise<SchemaInfo[]>` | schema 清单（REQ-04 v0.1.105；系统目录平台过滤；mysql 与 listDatabases 同源） |
| `listDatabases` | `listDatabases(prefix?)` | `Promise<DatabaseInfo[]>` | database 清单（pg 由任意库连出 pg_database，不换连接拿名字） |
| `forSchema` | `forSchema(name)` | 只读内视句柄 | 钉住一个 schema/database 的受限视图（五件内视；sqlite/pg-forDatabase unsupported） |
| `dialect` | `dialect()` | `string` | 后端声明的方言名——**别拿它当能力探测**（§10.7） |
| `sqlProfile` | `sqlProfile()` | `{count,totalMs,slow,byDb,events}` | 本请求 SQL 画像（dev 默认开；追踪关时 `{}`） |
| `asSystem` | `asSystem()` | 本实例 | 本请求以系统身份绕过租户防护（审计日志；业务禁用） |
| `asTenant` | `asTenant(id)` | 本实例 | 匿名请求**声明**租户身份（仍需 `tenant.allow_as_tenant`） |

除 `stream` 外，所有方法在**命名库实例**（`DB(name)`）与 **`tx` 回调对象**上同面；`tx` 对象另有
`isTx: true` 标记（DDL 必须拒绝在此句柄上执行），且**不提供 `stream`**（流式只走直连池，见 §3.1）。

---

## 3. 原生参数化查询（query / exec）

适合构造器不覆盖的语句（聚合报表、方言特有语法）；简单增删改查优先用构造器（见 [§5](#5-查询构造器从最小查询到组合)）：

```ts
const rows = await db.table("account").select(["id", "name"]).where({ field: "role", op: "eq", value: "admin" }).all();
// 构造器不覆盖的语句才退回原生参数化执行：
const n = await db.exec("update account set role = ? where id = ?", ["user", 7]);
```

- **值只经 `?` 占位符绑定**，绝不允许字符串拼接——这是红线（SQL 注入），不是风格建议。
  **`?` 是三引擎统一占位符（0.1.67 起）**：postgres 由宿主自动改写 `$n`，无需 `db.dialect()`
  分支；存量 `$n` 写法继续有效（`$n`+`?` 混用按序号续接）。唯一例外：JSONB 存在性
  运算符在 PG 下请写 `jsonb_exists(doc, 'key')`（裸 `?` 与占位符无法区分，见 §错误表）。
- `params` 可省略（无参便捷形式）。
- 裸 SQL 也过归属守卫：SQL 里出现的表必须是你模块拥有的或已声明 deps 的。
- 表名/列名无法参数化——动态标识符请改用 `db.table()` 构造器（白名单）。
- **执行回调面（v0.1.114，REQ-11）**：`opts` 除 `timeoutMs` 外新增两个回调——
  - `onOpen(executionId)`：语句一开始执行即回调 `exec_…` 执行 id。把它存 `kv` 后，
    **同一主体的任意请求**可 `db.cancel(id)` 取消这条池执行（见 §3.1）。
  - `onProgress(ev)`：进度回调，事件 `{phase, elapsedMs, rows?}`——相位
    `sent`（语句已下推服务端）→ `fetching`（首批行回流）→ `done`（**恒发一次**，
    必含 `rows`：query 为行数 / exec 为受影响数）。同相位 **100ms 节流**（快语句
    可能只见 sent + done 两个相位）。**带任一回调即走 begin/poll/take 登记模型**
    （执行进入跨请求取消登记表，挂断联动因此能定位它）；不带回调也全量登记（挂断
    联动同样覆盖），只是 JS 侧拿不到 executionId，无法 `db.cancel`。
  - `onOpen` 内抛异常只记 warn、**不杀执行**（进度/取消机制尽力而为，绝不让回调
    错误污染语句结果）。
- **挂断取消（v0.1.114，尽力而为）**：HTTP 客户端断开（真 FIN）时，serve 层按
  本次请求的执行登记**尽力取消**在飞执行——已提交结果不会写回（客户端已走），
  in-flight 语句经 pg `pg_cancel_backend` / mysql `KILL QUERY` 尽量真杀。直连池
  `db.query`/`db.exec` **全量登记**（v0.1.114 legacy 全量登记，含无回调直路）——
  挂断同样取消，只是无回调执行 JS 拿不到 executionId；`db.tx`/`db.session` 会话内
  执行与 WS/内部派发不登记（无请求连接/token）。

### 3.1 流式查询（`db.stream`，v0.1.37）

`db.query` 会把整张结果集拉进内存；导出、ETL、大表遍历这类场景应该改用 `db.stream`——
**逐行**从后端拉取，一边收一边处理（写 `json.stream` 推流、落库、累积聚合），常驻内存只有一行：

```ts
// 回调形态（推荐）：Promise 在流走完后 resolve，异常 reject
const s = json.stream({ contentType: "text/csv" });
s.write("id,name\n");
await db.stream("select id, name from account order by id", null, {
  onRow: (row) => s.write(`${row.id},${row.name}\n`),
});
s.end();

// 异步迭代器形态（逃生舱）：for await 消费
for await (const row of db.stream("select id, name from account order by id")) {
  console.log(row);
}
```

- 结果与 `db.query` **内容一致**（同一查询逐行 ≡ 全量数组），差异只在内存形态。
- 取消：传 `opts.signal`（`AbortController.signal`），`abort` 事件触发即中止后端拉取——
  流**干净提前结束**（消费端收到 done，不报错）；服务端行缓冲有界，消费端不拉取时后端
  拉取同步暂停；已回调的行不会回滚。
- **跨请求取消（`db.cancel`，v0.1.96；v0.1.114 起受理池执行）**：`executionId` 是
  开流（或带 `onOpen` 回调的 `db.query`/`db.exec`）后发放的跨请求取消句柄
  （`exec_…` 形状）——流：回调形态经 `opts.onOpen(executionId)` 拿到，异步迭代形态经
  `it.executionId()`；池执行：经 `opts.onOpen` 拿到。把它存到 `kv`/`vars` 后，
  **同一主体的任意请求**可 `db.cancel(id)` 停掉这条执行（「请求 A 发起长导出、
  请求 B 点停止」）。重复取消幂等（同返回值 `{cancelled: true, alias}`）；
  未知/已结束/他人 id 一律 `execution … not found`（不泄露存在性）。被取消后发起方的
  **下一次拉取抛错** `db stream exec_… was cancelled via db.cancel`（流；不是静默
  结束——消费方不得误以为数据取完；已交付的行保留）；池执行 `db.query`/`db.exec`
  直接 reject `db exec exec_… was cancelled via db.cancel`（`e.code=OJ_DB_CANCELLED`、
  `retryable=false`、`sessionDisposition=close`——见 §11.6.5 错误码表）。后端效果：
  mysql `KILL QUERY` / pg `pg_cancel_backend` 真取消（被取消的连接报废、**绝不回池**，
  池瞬时补员一条新连接），其余协作式。id 是 bearer 凭据：日志/错误只出前 8 字符。
- **流式进度（v0.1.114，REQ-11 G3）**：`opts.onProgress({rows, bytes, elapsedMs})`——
  每行回流驱动（**100ms 节流**），`bytes` 为在飞已计量字节（`it.info()` 之外的
  低成本进度源；大导出进度条的直接数据源）。
- **事务内不可用**：`db.stream` 只走 `DB(name)` 直连池，在 `db.tx(...)` 内调用直接报错。
- 后端支持（v0.1.38 起 ABI 10）：核心 `SqlxAccessor`（内置只承载 sqlite）、测试用
  InMemory，以及第一方插件 `oj-db-mysql`/`oj-db-postgres`（typed 直连，vtable 批量 pull，
  ≤100 行/次）真流式；**未声明** `stream` 的插件（或旧插件返回 `{"unsupported":true}`）→ 回落
  `db.query` 全量（不报错，仅失去内存优势）。
  **声明了 `stream` 却返回 unsupported** 是能力契约违规 → 结构化 `OJ_DB_UNSUPPORTED`
  （`e.data.capability = "stream"`，v0.1.88），不静默回落；反过来「未声明却真提供了流」
  宿主采信但打 warn（插件该补 `"stream"`）。
- **专用连接并发上限 8**（v0.1.84，mysql/postgres 的 typed 直连路径）：每条游标独占一条
  池外连接（真取消语义的前提），超限报
  `db stream_open: too many concurrent cursors (limit 8) — close or cancel running streams first`。
  并行导出请改成串行或复用单流——打满会连累同库的池查询。
- 裸 SQL 同样过归属守卫与多租户防护（与 `db.query` 相同）。

### 3.2 执行计划（`db.explain`，G3，v0.1.108）

```ts
const { plan } = await db.explain("select * from account where id = ?", [42]);
// plan: { category, operation, relation, accessPath, cost{startup,total},
//         rowsEstimate, width, extra, children: PlanNode[] }
```

`EXPLAIN` 的跨方言归一：PG 文本计划与 MySQL `FORMAT=JSON` 在宿主侧解析成**同一棵
PlanNode 树**，前端一条渲染路径覆盖（`category` 是宿主侧枚举 `scan|join|aggregate|sort|other`，
渲染选图标/着色；`operation` 保原文——PG 物理算子名如 `Index Scan`/`Nested Loop`，
MySQL `access_type` 如 `const`/`ref`/`ALL`）。

- 字段级 null 口径：`cost.startup` 仅 PG 有（MySQL 恒 `null`，`total` 取 `prefix_cost`）；
  `width` 仅 PG 有；`rowsEstimate` 与 PG `Plan Rows` 同为「输出行数」语义（MySQL 取
  `rows_produced_per_join`）；`extra` 为谓词/附属信息多行文本（PG：`Index Cond`/`Filter`/
  `Hash Cond` 等；MySQL：`used_key_parts`/`ref`/`filtered`/`attached_condition`）。
- **授权面与 `db.query` 同门**：包上 EXPLAIN 前缀的整句复用 `db.query` 同一通路
  （归属/租户守卫、风险分类、REQ-05 配额 `opts.timeoutMs` 同口径、trace）。「能 explain」
  不蕴含「能真跑」：EXPLAIN 被归只读，`read_only` 连接可 explain 一条 UPDATE 的计划
  （不执行、无副作用——无 ANALYZE 由构造保证）。
- **多租户 Deny 站点**：内层语句先剥前缀过租户守卫——`EXPLAIN UPDATE <未注册表>`
  与传统 UPDATE 同样被拒。
- **Tx 臂注意**：attached session（`db.session`）内无语句超时，`opts.timeoutMs`
  对 `db.explain` 不生效（与 `db.query` Tx 臂口径一致）。
- **方言边界**：sqlite / 未知方言 → 结构化 `OJ_DB_UNSUPPORTED`
  （`e.data.capability === "explain"`）。**版本错位能力探测**：
  `typeof db.explain === "function"`（旧二进制上是 TypeError，勿版本号嗅探）。
- PG 侧实现注记：`EXPLAIN (FORMAT JSON)` 的 json 输出列驱动不解（v0.1.108 实测），
  故走文本计划解析；绑定参数两方言均支持（`?` 统一占位符）。

---

### 3.3 DDL 生成（正向 `db.catalog("ddl")` + 反向 `db.ddlDiff`，U-14，v0.1.109）

正向取对象源码、反向从结构差出 ALTER——dbx PR-2（DDL 展示/复制）与 PR-9（结构比较）
的服务端底座。

```ts
// 正向：单对象源码（信封 {kind:"ddl", dialect, items:[{name, ddl}]}）
const { items } = await db.catalog("ddl", "orders");
// pg 普通表 → 拼接器还原（serial 序列 + OWNED BY / identity / 约束 / 索引 / 注释）；
// pg 视图/物化视图 → pg_get_viewdef 原样；mysql → SHOW CREATE TABLE。

// 反向：结构 diff + 有序可重放 statements（零 DB I/O，执行走 db.exec + allow_ddl）
const from = { columns: await db.listColumns("orders") };
const to = { columns: [...from.columns, { name: "priority", nativeType: "int", nullable: true }] };
const { diff, statements } = await db.ddlDiff({
  objectType: "table", name: "orders", from, to,
});
for (const s of statements) await db.asSystem().exec(s); // DDL 须 allow_ddl 通道
```

- **缺省 vs 空数组（数据安全语义）**：维度字段**缺省 = 不参与 diff**；**空数组 = 期望为空**
  （出 DROP）。`to` 只给 `columns` 时，旧表上的索引/约束/外键一个不动；显式 `indexes: []`
  才会 DROP 全部索引。`from = null` → `CREATE TABLE`（主键内联，其余约束/FK 随后）。
- **方言差**：pg 改类型 `ALTER COLUMN c TYPE t USING c::t`；mysql 无 USING，位置差产
  `AFTER`/`FIRST`（pg 无列位置 DDL，位置差忽略——changed 里也不出现 position 项）；
  mysql 列注释内联 `MODIFY ... COMMENT`，pg 走 `COMMENT ON COLUMN`；MySQL DDL **隐式提交**，
  事务里跑 ddlDiff 语句会断事务。
- **identity（pg-only）**：翻转（加/去 identity）出 changed（field=`identity`）+ PG
  `ADD GENERATED ... AS IDENTITY` / `DROP IDENTITY`；MySQL 结构里出现 identity → 参数错误
  （GENERATED AS IDENTITY 非 MySQL 语法，不产非法 SQL）。identity 恒等时跳 default 文本比对。
- **同名 changed 约束/索引/外键**：先 DROP 再 ADD——只 ADD 会在重放时撞已存在对象；
  MySQL 约束 DROP 按类型分派（pk → DROP PRIMARY KEY；uq → DROP INDEX；ck → DROP CHECK）。
- **列维度缺省**：`from`/`to` 任一端缺省 `columns` = 列维度整维不参与（不产全量 ADD/DROP
  COLUMN——缺省端不是空表）；建表路径（from = null）diff 形状与 alter 路径一致。
- **正向快照口径**：pg 拼接器是 best-effort 快照（5 查询无事务），Pool 臂可落在不同连接，
  高并发 DDL 下偶发不一致；行数触顶 → `OJ_DB_CAPACITY`（拒绝不完整 DDL）。跨 schema/跨库
  重放时索引名同 schema 唯一，须自行换名（`pg_get_indexdef` 裸索引名）。
- **边界**：sqlite / 未知方言 → `OJ_DB_UNSUPPORTED`（`capability = "ddl_diff"`）；
  `ddlDiff` 不生成序列对象（serial 的 `CREATE SEQUENCE` 不在 ALTER 流里）；版本错位先探
  `typeof db.ddlDiff === "function"`。

### 3.4 任务式批量导入（`db.import` / `importStatus` / `importCancel`，REQ-12，v0.1.115）

大表灌数不用手写 `for + db.table(...).insert()`：导入是**长任务**——发起即返
`{taskId}`，Rust consumer 自驱「读源 → 解析 → 多值 INSERT 批事务」落库，前端轮询
`importStatus` 画进度条，用户点「取消」走 `importCancel`（批间协作，已提交批不回退）。

```ts
// 1) 上传 CSV 到 blob（既有上传接口），拿到 key
const { key } = await blob.uploadUrl("imports/users.csv");

// 2) 发起导入（立即返回）
const { taskId } = await db.import({
  table: "users",
  blobKey: key,            // 或 rows: [{...}] 内联小数据（≤ db_import.max_rows）
  format: "csv",           // csv | jsonl
  // columns: ["id","name"],  // 缺省 = csv 表头 / 首行键——生产用法请显式给
  mode: "append",          // append | upsert | replace
  // onError: "skip",       // 坏行进 samples 行不落库；缺省 abort（批错整批回滚）
});

// 3) 轮询状态
for (;;) {
  const st = await db.importStatus(taskId);
  if (st.state !== "running") {
    // st.rows = 已提交行数；st.errors + st.samples（≤20，line = 源文件绝对行号）
    return json.ok(st);
  }
  await new Promise((r) => setTimeout(r, 500)); // 轮询间隔自定
}

// 4) 取消（任意后续请求，同主体）：幂等；终态任务 no-op
await db.importCancel(taskId);
```

**方言路径**（全部多值 INSERT 全参数化——值只走绑定参数）：

| 方言 | append | upsert | replace | 事务 |
|---|---|---|---|---|
| PG | 多值 INSERT | 多值 INSERT 直挂 `ON CONFLICT (keys) DO UPDATE` | `DELETE` + 多值 INSERT（单事务） | 每批一个事务 |
| MySQL | 多值 INSERT | `ON DUPLICATE KEY UPDATE`（**表上须有唯一键**，缺 → 参数错误） | 同上 | 每批一个事务 |
| sqlite | 多值 INSERT | `INSERT OR REPLACE` **仅 `conflictKeys=["rowid"]`** | 同上 | **全单事务**（性能关键） |

- **批收敛**：`batchSize`（100..=50000，缺省 `db_import.default_batch_size` 5000）再按
  方言变量上限/列数收敛——PG/MySQL 65535，**sqlite 32766**（`SQLITE_MAX_VARIABLE_NUMBER`
  ≥3.32 默认；7 列宽表默认批会被压到 4680 行/批）。
- **sqlite 特例（语义差，必读）**：append/upsert 在 sqlite 走**全单事务**——cancel/
  fail 是**整回滚**：`rows=0`、库空。网络方言（PG/MySQL）abort/cancel 则**已提交批保留**
  （`rows`=已提交）。跨方言业务代码不要假设取消后 rows>0。
- **幂等口径**：append 重复导入 = 主键/唯一约束错照常上报（不误称幂等）；幂等只由
  upsert/replace 承担。同数据 upsert 跑两遍行数不变（实测腿：PG/MySQL 3k 行）。
- **samples 行号口径**：`line` = 源文件绝对行号（1-based，csv 的 header 计 1 行）——
  直接拿去编辑器/日志定位原行。skip 模式单行错记 sample 行不落库，`errors >
  maxErrors`（默认 10）→ 整任务 Failed。
- **守卫（放行绝不宽于等效裸 INSERT）**：sql_guard 下目标表**已登记且 tenant-scoped**
  → fail-closed——Warn 档 `OJ_DB_UNSUPPORTED`（`e.data.capability="import_under_guard"`）、
  Deny 档报 `import_under_guard`（守卫只能验「某参数=当前 tid」，无法证明导入每行都属于
  该租户）；Deny + 未登记 → 拒（同裸 SQL「cannot verify tenant scope」）。逐行租户强制
  （tenant 列强制写成当前 tid）是未来工作，落地前 scoped 表导入保持拒绝。
- **replace 是危险写**：`allow_ddl` + 危险写确认 token（truncate 同档），先删后插单事务。
- **标识符红线**：表/列名只走 `quote_ident`（NUL/控制字符拒、引号翻倍）；已登记表的列
  必过 SchemaRegistry 白名单，**未登记表的列名是用户串**——脏标识符（空/控制字符）在
  渲染期即参数错误，不拼进 SQL。csv 表头只用于列序匹配——与登记列名不符 → 参数错误
  fail-fast，**绝不**把表头文本当标识符拼 SQL。
- **配额**（`db_import:` 段，装配期 validate fail-loud）：全局并发 4 / 每主体 2 /
  max_rows 100 万 / max_bytes 512MiB / default_batch_size 5000 / TTL 24h；导入与导出
  配额互相独立。`db.import.start/done/failed/cancelled` 全量落审计。
- **性能口径**：500k×10 CSV 全链路实测 PG 1.8s / MySQL 3.3s（预算 <60s）。

## 4. 事务

```ts
const out = await db.tx(async (tx) => {
  await tx.table("account").insert({ name: "neo", role: "user" }).run();
  const rows = await tx.table("account").select(["id", "name"])
    .where({ field: "name", op: "eq", value: "neo" }).all();
  if (rows.length === 0) throw new Error("gone");   // throw/reject → 自动回滚
  return rows;
});                                                  // 正常 resolve → 自动 commit
```

- `tx` 回调拿到的对象与 `db` 同面（`query`/`exec`/`table`/`fromJSON`/`nextSeq`/`listTables`/
  `dialect`/`sqlProfile`/`asSystem`/`asTenant` + 条件工厂，另有 `isTx: true`；**没有 `stream`**），
  全部路由到**同一连接**上。
- **例外：`tx.asSystem()` / `tx.asTenant(id)` 返回的是外层池句柄**（不带 `isTx` 标记）。别指望
  它「离开事务」——执行路由按**库名**判定，语句照样进事务会话；反倒是靠 `isTx` 认事务域的
  共享库（如 `search.ensureIndex` 的 DDL 拒绝）会因此失明。要绕租户就在进 `db.tx` 之前调
  `db.asSystem()`（逃生位是请求级的）。
- 事务期间（包括构造器 `.run()/.all()`）同库操作自动骑到事务会话；
  **碰别的库**报错：`transaction active on db 'x' (finish it before touching db 'y')`。
- 不支持嵌套：`transaction already active (nested tx not supported)`。
- **构造器在事务里同样受多租户防护**：租户条件在「走池 / 走会话」判定之前注入，
  所以 `tx.table(...)` 与 `db.table(...)` 的改写完全一致（select 收窄、insert 强制写
  当前租户、update/delete 收窄）。裸 SQL 只有「文本里有没有 tenant_id」的 best-effort
  检查——事务里也请优先用构造器。

---

## 4.5 跨请求事务：`db.session`（v0.1.95）

`db.tx` 的事务活在**一个请求**里：handler 返回即提交/回滚。多步表单向导（步骤 1 存草稿、
步骤 2 改行、步骤 3 提交）横跨多个人类请求，塞不进一个 handler——这就是 `db.session`：

```ts
// 步骤 1（请求 A）：开会话 + 写草稿，把 id 存进你的业务表/前端
const s = await db.session.begin();          // → { id, alias, dialect, expiresInMs, … }
await db.session.exec(s.id, "insert into draft (uid, body) values (?, ?)", [uid, body]);
// s.id 是 **bearer token**：存服务端的会话记录里（或加密后给前端），别写进日志/URL

// 步骤 2（请求 B，可能是几小时后）：绑到本请求，之后 db.query/table 全走这条连接
await db.session.attach(s.id);
await db.table("draft").update({ body: body2 }).where({ field: "uid", op: "eq", value: uid }).run();

// 步骤 3（请求 C）：提交（或 rollback 丢弃全部）
await db.session.commit(s.id);
```

### 配置（默认关）

```yaml
db_session:
  enabled: true                     # 缺省 false：能力不存在，db.session.begin 直接报错点名怎么开
  allow:                            # 谁能开会话（四维并集，任一声明维度命中即放行）
    roles: ["draft-editor"]
  max_sessions: 32                  # 进程级并发上限（含「正在连接」的占位）
  max_per_owner: 8                  # 同一 (tenant,user) 的上限
  idle_timeout_secs: 300            # 空闲多久自动回滚
  max_lifetime_secs: 1800           # 无论多活跃，最长存活
  require_identity: true            # 无 user.id 且无 tenant 的调用方拒建（匿名部署别关）
```

装配期 fail-loud（拒绝启动）：`enabled: true` 但 `allow` 四维全空；`max_sessions`/`max_per_owner`
为 0；`max_per_owner > max_sessions`；`idle_timeout_secs` 为 0；`max_lifetime < idle_timeout`。
配置段改动归热更的 `restart_pending`（**改了要重启**）；但**已开的会话跨热更存活**——会话表挂在
进程级的 `StableState` 上，热更只替换模块代码。

### 方法面

| 方法 | 返回 | 说明 |
|---|---|---|
| `begin(opts?)` | `Promise<{id, alias, dialect, state, readOnly, ageMs, idleMs, expiresInMs, ops, createdBy}>` | 在 `DB(name)` 上开（默认 `DB("default")`；名字由 `DB(name)` 绑定，参数不是别名）；`id` = `tx_<4hex>_<32hex>`。**`opts.readOnly`（G9，v0.1.99）**：只读会话位——begin 时定死、不可变；该会话上 Write/DDL 在 op 层一律拒（attach 路径与 `db.session.query/exec` 双入口都拦，直发 op 也拦得住），错误 `e.sessionDisposition === "keep"`（会话不被判死）；SELECT 照常 |
| `attach(id)` | `Promise<true>` | 本请求绑定；之后 `db.query`/`db.exec`/`db.table()`/`nextSeq`/`listTables` 全走该连接 |
| `detach()` | `Promise<true>` | 解绑（会话本身仍在） |
| `query(id, sql, params?)` | `Promise<行数组>` | 不绑定也可逐语句显式执行 |
| `exec(id, sql, params?)` | `Promise<受影响行数>` | 同上 |
| `commit(id)` / `rollback(id)` | `Promise<true>` | 结束会话（失败也摘表，不允许续用） |
| `close(id)` | `Promise<true>` | **幂等**收尾（`finally` 用）：best-effort 回滚，失败不上抛 |
| `touch(id)` | `Promise<{expiresInMs}>` | 只推空闲计时，不延长最长寿命（长表单用） |
| `closeAll()` | `Promise<number>` | 关掉**本主体**全部会话（登出用） |
| `list()` | `Promise<摘要数组>` | 本主体的活跃会话（绝不列他人） |
| `info(id)` | `Promise<摘要>` | 单条；已结束的会话会给出「已回滚 + 原因」的诊断 |
| `stats()` | `Promise<{enabled, active, maxSessions, maxPerOwner, idleTimeoutSecs, maxLifetimeSecs, timedOut, discarded, rejected, boot}>` | 运维观察面（只统计本主体） |

### 六条硬规则（踩了会静默错或假回滚）

1. **`begin` 与 `attach` 必须落在同一个库别名上**。绑定后去 `DB("另一库").query(...)` 直接报
   `db session is attached to db 'x', not 'y' (detach first)`——判权用会话登记的别名，绝不按当前
   请求的模块绑定重算（否则就是「A 库判权、B 库执行」）。
2. **会话内禁止事务控制与会话状态语句**：`BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`RELEASE`/
   `START`/`SET`/`USE`/`ATTACH`/`DETACH`/`PRAGMA` 一律报错。原因很实在：MySQL 上这些语句
   **隐式提交**，先写、再 `BEGIN`、最后 `rollback` 会得到「假回滚」——数据其实已经落库。
3. **会话与 `db.tx` 互斥**（双向拒绝）。要请求内事务就别开跨请求会话。
4. **`db.stream` 在会话内不可用**（流式只走直连池）：报
   `db.stream within an active transaction is not supported`。
5. **`db_access` 照样生效**：会话里每条语句都重新过授权与风险分类——只读库在会话里也写不进去。
6. **只读会话位（G9）**：`begin(name, {readOnly: true})` 的会话，Write/DDL 在 op 层被拒——
   即使别名本身可写。这是**会话级**的收窄（连接级硬保证仍是 DB 账号 GRANT，与 §11.5 同口径）。
7. **id 是 bearer token**：他人拿到也调不动（归属按 tenant+user 判定，错误文案与「不存在」完全
   一致，不泄露存在性）；日志与错误只出现前 8 字符（`tx_ab12_…`）。别把完整 id 回给最终用户。

### 生命周期

- 空闲超时 / 超最长寿命 → 后台回收器**先 rollback 再摘表**，并记一条
  `DB_SESSION_TIMEOUT`；之后调它得到「已过期（原因）；已回滚」。
- 会话内语句把剩余寿命耗尽 → 该语句失败、会话判死（连接状态不可信，不再复用）。
- 动态数据源 `db.client.delete` / `reRegister` → 该别名上的会话全部判死（`DB_SESSION_DISCARD`）。
- 进程退出 / 关闭会话 → 未提交的一律回滚。**没有任何「自动提交」路径**。

### sqlite 上的现实

内置 sqlite accessor 的池刻意只有 **1 条连接**（`:memory:` 与写锁语义使然）。开一个会话就占满
它：同别名上的其他查询会一直等到会话结束（40s 后报错）。装配期会为此打一条 `warn:`。
**跨请求事务请用在 mysql/postgres 上**，sqlite 只适合单请求串行验证。

---

## 5. 查询构造器：从最小查询到组合

一行心智模型：**`db.table(表)` 起链 → 链上每个方法只修改请求快照 → `.all()/.run()` 终执行**。
构造器完全不可变副作用——方法返回同一 builder 便于链式，但内部 req 是逐步填充的普通对象。

### 5.1 基础查询

```ts
// 全列
const rows = await db.table("account").all();

// 选列 + 条件 + 排序 + 分页
const rows = await db.table("account")
  .select(["id", "name"])
  .where({ field: "age", op: "gte", value: 18 })
  .orderBy([{ field: "id", dir: "desc" }])   // dir 省略 = asc
  .limit(10).offset(20)
  .all();
```

要点：

- **隐式 LIMIT 只加在顶层查询**，值取 `db_query.default_limit`（**默认 100**）；显式
  `limit(n)` 一律生效并被 clamp 到 `db_query.max_limit`（**默认 1000**，硬顶 100000）。
  子查询/union 成员不会被隐式截断。两者都在装配期校验（`0` / 倒置 / 超硬顶 → fail-fast）。
- **截断不再静默**：返回行数达到实际生效上限时，响应带 `X-OJ-Row-Limit: <n>` 头
  （含「显式 limit 被 clamp」这一类）。显式给了 limit 且行数未达上限 → 不写头。
- 多次 `.where()` 条件之间 **AND**（`.having()` 是整体替换，单树）。
- **可选筛选写 `whereIf(test, cond)`**（v0.1.81）：`test` 为 `undefined` / `null` / `false` /
  **空数组** 时整条跳过；`0` 与 `""` **保留**（`status = 0` 是合法过滤值）。用来避免
  `in []` 这种「永久假谓词静默返回 0 行」：
  ```ts
  db.table("order")
    .whereIf(id, { field: "id", op: "eq", value: id })
    .whereIf(ids?.length, { field: "id", op: "in", value: ids });
  ```
- **`select(["*"])`**（v0.1.81）必须唯一（`select '*' must be the only column`），且不能带
  join（`select '*' is not allowed with joins`）；不写 `select` 与写 `["*"]` 同义。
- `.orderBy` 的列必须是表/join/CTE 白名单里的**真实列**（聚合别名不行，见 §8）。

#### 调试：`.toSQL()`

```ts
const { sql, params } = db.table("account")
  .where({ field: "id", op: "in", value: [1, 2, 3] }).toSQL();
// sql: SELECT ... FROM "account" WHERE "id" IN (?, ?, ?)   params: [1,2,3]
```

同步返回 `{sql, params}`（按配置库的方言渲染），**只构造不执行**，和 `.all()` 走完全相同的
校验管线。写不出来或报错看不懂时，先 toSQL 看。

### 5.2 条件：对象形式与工厂

叶子：`{field, op, value}`。`op` 全集（类型化枚举，拼错直接报）：

| op | value 要求 |
|---|---|
| `eq` `ne` | 任意 JSON 值；**省略 value 渲染成 `= NULL` / `<> NULL`（三值逻辑，恒不成立——判空用 `isnull`）** |
| `gt` `gte` `lt` `lte` | 必填（`gt needs value`） |
| `in` | 必须**非空**数组（非数组 `in needs array value`；空数组 `in needs non-empty array`——`IN ()` 是永久假谓词，会静默 0 行） |
| `like` | 必填（**已成形**的 LIKE 模式，不转义；需要转义就用 `escape:"!"` 逃生舱） |
| `isnull` | 不需要 value |
| `contains` `startswith` `endswith` | 必填（v0.1.81）。把值当**普通搜索词**：引擎自动转义 `%` `_` `!` 并渲染 `LIKE ? ESCAPE '!'`，业务零转义、零方言知识 |

> 模糊搜索优先用语义化三兄弟（`contains` / `startswith` / `endswith`）；`like` 只留给框架内部
> 与确有「模式已成形」需求的场景——详见 `docs/devkit/sql-builder-guide.md` §3.5。

组合树：`{and: [...]}` / `{or: [...]}` / `{not: 叶子}`。手工写嵌套树容易错，推荐工厂：

```ts
const { leaf, and, or, not } = db;          // 每个命名库（含 tx 回调）都带这组工厂

const cond = and(
  leaf("age", "gte", 18),
  or(leaf("role", "eq", "admin"), not(leaf("tag", "eq", "hidden"))),
);

await db.table("account").where(cond).all();   // .all() 是 async，必须 await
```

- 工厂产物是**不可变**条件对象：`.and(c)` / `.or(c)` / `.not()` 返回新对象，不改原树。
- `.where()` 入参三种通吃：普通对象树、条件对象（自动 `.tree()` 解包）、
  **另一个构造器**（自动取快照作为子查询，见 §9.1）。

### 5.3 检查与内省

条件对象自带内省（适合「租户字段必须存在」这类守卫）：

```ts
const c = and(leaf("tenant_id", "eq", http.tenantId), leaf("ok", "eq", 1));
c.fields();        // ["tenant_id", "ok"] —— 树内全部字段（去重）
c.has("tenant_id"); // true
if (!c.has("tenant_id")) return json.fail(403, "tenant required");
```

---

## 6. join 联表

```ts
const rows = await db.table("order")
  .join("user", [{ left: "order.user_id", right: "user.id" }], "left")
  .select(["order.id", "user.name"])
  .all();
```

- `kind`：`"inner"`（默认）/ `"left"`。**right join 不做**。
- `on` 是**列对列等值**数组 `{left, right}`；v0.1.81 起也收**列对常量** `{left, op, value}`
  且可与列对列混排（op 限比较类，`contains`/`isnull` 等模式类直接拒）：
  ```ts
  db.table("receipt").as("r")
    .join("broadcast", [{ left: "r.broadcast_id", right: "b.id" },
                        { left: "r.user_id", op: "eq", value: uid }], "left", "b");
  // → ... JOIN broadcast b ON r.broadcast_id = b.id AND r.user_id = ?
  ```
- 限定名 `"表.列"`：表段 ∈ {基表, join 表, CTE 名}；**非限定列只解析基表**
  （两表同名列天然无歧义）。列不存在：`unknown column 'x' in join on`。
- **表别名**（v0.1.81）：基表用 `db.table("x").as("b")`，被 join 表用第 4 参数
  `join(t, on, kind, "b")`。别名只作用于列限定与 SQL 渲染——**归属/租户守卫始终按真名**
  生效（守卫失效的那次缺陷就是别名混进真名导致的）。
- **自 join 需起别名**（v0.1.81）：`db.table("a").as("x").join("a", [...], "inner", "y")`
  可用；两侧同真名且 `sql_name()` 撞车才拒——`self join needs distinct table aliases
  (got 'a')`（同真名）或 `duplicate table alias 'a'`（异真名、别名撞车）。
- `update`/`delete` **不接受别名**（mysql 的 `DELETE FROM t AS b` 需 8.0.16+，跨引擎不保证）：
  `table alias is not supported on insert/update/delete`。
- on 不能为空：`join 'x' needs non-empty on`；join 表同样过归属守卫。
- select 省略 columns 时展开**基表**全列（带 join 时自动限定）；显式 `select(["*"])`
  （v0.1.81）与 join **互斥**（`select '*' is not allowed with joins`）——全列只出基表，
  join 列会丢。

---

## 7. DML：insert / update / delete

动词由 `.insert()/.update()/.delete()` 声明，**`.run()` 终执行**（带 JS 侧预检）：

```ts
// insert：单对象或行数组；返回受影响行数
await db.table("account").insert({ name: "neo", role: "user" }).run();
await db.table("account").insert([{ name: "a" }, { name: "b" }]).run();

// update / delete：必须带 where（叶子数 ≥ 1），返回受影响行数
await db.table("account").update({ role: "admin" })
  .where({ field: "id", op: "eq", value: 7 }).run();
await db.table("account").delete()
  .where({ field: "id", op: "in", value: [8, 9] }).run();
```

动词×字段**兼容矩阵在 op 侧权威校验**（`fromJSON` 也绕不过）。注意 `update`/`delete` 共用一个
拒绝分支，报错里的动词字样就是字面 `update/delete`：

| 动词 | 允许 | 拒绝（`<verb> does not accept <field>`） |
|---|---|---|
| select | where/joins/columns/groupBy/having/orderBy/limit/offset/distinct/unions/with | values, sets, returning, orIgnore, fromSelect |
| insert | values 或 fromSelect（**二选一**）、returning、orIgnore | where, orderBy, limit/offset, joins, distinct, groupBy, having, unions, with, columns |
| update | sets（非空）+ where（≥1 叶子） | joins, columns, distinct, groupBy, having, unions, with, limit/offset, returning, orIgnore, fromSelect, truncate |
| delete | where（≥1 叶子）或 `truncate()`（此时不得带 where） | joins, columns, distinct, groupBy, having, unions, with, limit/offset, returning, orIgnore, fromSelect |

`truncate` 不是独立动词：`.truncate()` 置 `verb=delete` + 标志位（矩阵里只在 update 行拒绝；
`delete` 行不列它）。`sets` 只有 `update` 渲染 `SET`——`fromJSON` 让 delete 带上 `sets` 不会被
拒，会被静默忽略。

其它 op 侧兜底（矩阵外）：`table alias is not supported on insert/update/delete`；
`insert takes either values or fromSelect, not both` / `insert needs either values or fromSelect`；
`insert fromSelect needs insert columns` / `insert columns are only allowed with fromSelect`；
`fromSelect source needs explicit columns (no '*' / omission)`。

insert 行数组必须**键集完全一致**（`insert rows must share identical key sets`）；
键/sets 逐一过白名单（`unknown column 'k' in insert values` / `in update sets`）。
update/delete 无 where 在 JS 侧提前抛（`update requires where`），绕过 JS 层时 op 侧
兜底（`Update requires where (leaf count >= 1)`）。

**返回形态**：select → 行数组；insert/update/delete → 受影响行数（number）；
insert 带 `.returning([...])` → 行数组。

```ts
// 取回自增主键：替代原先的「insert ... returning id」裸 SQL
const rows = await db.table("account").insert({ name: "neo", role: "user" })
  .returning(["id"]).run();
const id = rows[0].id;
```

- `.returning(["id"])` 只有 insert 接受（其它动词报 `<verb> does not accept returning`），
  列过白名单。
- pg / sqlite：渲染 `INSERT ... RETURNING "id"`，**单语句一次往返**（不再需要
  「exec 之后查 `last_insert_rowid()`」这种会串号的写法）。
- mysql：方言无 RETURNING，只接受**单列**（`mysql returning accepts exactly one column
  (no RETURNING support)`），在同一连接上两步取 `LAST_INSERT_ID()`
  ——并发请放 `db.tx` 内。

同一 `resolve_target` 路由：有活跃事务走会话，否则走池——DML 与查询天然同事务。

### 7.1 幂等写入 / 查询插入 / 整表清空（v0.1.81–0.1.82）

```ts
// 撞主键/任意唯一键就跳过（不报错、不写入）——幂等导入
await db.table("notify").insert({ id: 1, user_id: uid }).orIgnore().run();

// INSERT ... SELECT：目标列与源 select 列按位置对齐
await db.table("notify_daily").fromSelect(
  db.table("notify").select(["user_id", "cnt"]).where(leaf("day", "eq", d)),
  ["user_id", "cnt"],
).run();

// 命名式整表清空（渲染 DELETE FROM t；租户表上只清当前租户）
await db.table("sys_login_throttle").truncate().run();
```

- **`orIgnore()`**：sqlite/pg 渲染 `ON CONFLICT DO NOTHING`，mysql 渲染
  `ON DUPLICATE KEY UPDATE <pk> = <pk>`（恒等式）——所以 mysql **要求表有主键**
  （`orIgnore on mysql requires a primary key on table '…'`）。**别把 `orIgnore()` 与
  `returning(["id"])` 一起用**（mysql 上恒等赋值不刷新 `LAST_INSERT_ID()`，跳过重复行时会拿到
  连接上的旧值）——要幂等+id 就先按唯一键 `select`。**affected-rows 三方言不一致**（mysql 命中
  重复键给 1，pg/sqlite 给 0）：别用 `if (n === 1)` 判幂等，靠唯一约束 + 事务保证「不会重复写」。
- **sqlite 上 `orIgnore()` + `fromSelect()` 不可组合**（upsert 子句只能跟在 VALUES 后）：
  `orIgnore with fromSelect is not supported on sqlite (its upsert clause only follows VALUES)`；
  pg/mysql 组合可用。
- **`fromSelect(q, cols)`**：列数不符 `insert declares N columns but the source select yields M`；
  `cols` 含 `tenant_id` 直接拒（租户由服务端注入）；源 select 递归过租户与归属守卫
  （`ownership_guard: deny` 下跨模块搬运同样被挡）。
- **`truncate()`** 是唯一无 where 的写动词（明示整表清空，取代裸 `delete from`）：带 where 报
  `truncate does not accept where`；**租户表上只清当前租户**（要整库清空走 `db.asSystem()`）。

---

## 8. 聚合 / 分组 / having / distinct

```ts
const rows = await db.table("account")
  .select([
    "role",                                        // 普通列（字符串）
    { fn: "count" },                               // count(*)，别名可省
    { fn: "avg", field: "age", as: "avg_age" },    // 聚合 + 别名
  ])
  .groupBy(["role"])
  .having(leaf("avg_age", "gt", 20))               // ← 引用聚合别名，自动展开
  .all();
```

- `fn` 全集：`count | sum | avg | min | max`。**只有 count 允许省略 field**
  （其余报 `aggregate needs field (only count allows omission)`）。
- 别名形状：ASCII 字母/下划线开头（数字不能开头），违者 `illegal alias 'x'`。
- `.having()` 引用列优先按真实列解析，未命中查**聚合别名台账**展开——所以 having 里
  可以直接写 `avg_age`（PG 不允许 HAVING 引用输出别名，展开消灭了方言分叉）。
  两者都不是：`unknown column 'x' in having`。
- **`count(distinct col)`**（v0.1.82）：`{ fn: "count", distinct: true, field: "user_id", as: "c" }`
  → `COUNT(DISTINCT user_id)`，聚合成一行、不受 LIMIT 钳制。仅 count 支持
  （`distinct is only supported on count`），且必须带具名 field（`count distinct needs a field`）。
  **别再用 `distinct().all()` 拉行后取 `.length` 计数**——顶层隐式 LIMIT 会静默截断，
  受影响用户数 > 1000 就漏算。
- **字面量列**（v0.1.81）：`{ lit: "svc", as: "scope" }` 把常量作为一列输出，值走**绑定参数**
  并按方言 `CAST`（sqlite 裸 `?`、mysql `CAST(? AS CHAR)`、postgres `CAST(? AS TEXT)`）。
  `lit` 必须是标量（`lit column 'x' needs a scalar value …`）；要与 `*` 同时用会报
  `select '*' must be the only column`。计算列请用 `case`。
- `.distinct()` 去重。`orderBy` 不认聚合别名（只解析真实列），排聚合结果请子查询或
  在 SQL 侧处理。
- case/window 列也走 `.select([...])` 对象形式，见 §9.3。

---

## 9. 进阶构造（Phase 8）

### 9.1 where / having 子查询 + exists

叶子把 `value` 换成 `subquery`（或顶层用 `exists`）——值与子查询**互斥**：

```ts
// IN (SELECT ...)
db.table("order").where({
  field: "user_id", op: "in",
  subquery: db.table("user").select(["id"]).where(leaf("role", "eq", "admin")),
}).all();

// EXISTS：条件树槽位直接放 {exists: <req>}（对象或构造器均可）
db.table("user").where({
  exists: db.table("order").select(["id"]).where(leaf("amount", "gt", 100)),
}).all();
```

注意：子查询是**自包含**的——不能引用外层查询的列（没有相关子查询/外列引用机制）。
「存在订单金额大于 100 的用户」这类语义如需按行关联，用 **join** 表达。

规则：

- 子查询 op ∈ `in/eq/ne/gt/gte/lt/lte`；`like does not accept subquery`、
  `isnull does not accept subquery`、`value and subquery are mutually exclusive`。
- 嵌套深度上限 `REQ_NEST_MAX = 4`：顶层算 `depth 0`，最深只能用到 `depth 3`（即最多 3 层
  嵌套），再深即 `subquery: nested select too deep`（site 换成 `exists` / `union` / `cte` /
  `fromSelect`）。
- 嵌套 req 只能是 select（`nested select must be select`）且**禁带 with/unions**
  （`nested select does not accept with/unions (v1)`）。
- 子查询/exists 同样支持写在 **having** 叶子里，且递归过归属守卫。

### 9.2 UNION / UNION ALL

```ts
db.table("user")
  .select(["id", "name"])
  .union(db.table("account").select(["id", "name"]), "all")   // "distinct"(默认) | "all"
  .all();
```

- 基查询与成员都必须**显式 select 列**（`union requires explicit columns`），
  列数一致（`union column count mismatch: 2 vs 3`）。
- 成员禁排序/分页：`union member does not accept order_by/limit/offset`。
- Intersect / Except 不做（旧版 mysql 不支持）。

### 9.3 CASE 列与窗口函数列

都挂在 `.select([...])` 的对象形态上：

```ts
db.table("account").select([
  "name",
  {
    case: {                                     // searched case；then/else 只能是值
      when: [
        { cond: leaf("age", "lt", 18), then: "minor" },
        { cond: leaf("age", "gte", 60), then: "senior" },
      ],
      else: "adult",
    },
    as: "age_group",
  },
  {
    window: { fn: "row_number", partition_by: ["role"], order_by: [{ field: "id", dir: "desc" }] },
    as: "rn",
  },
]).all();
```

- 窗口 `fn`：`row_number | rank | dense_rank`（frame 不做）。
- `when` 非空（`case needs non-empty when`）；then/else 走绑定参数，**不能是标识符**。
- partition_by / order_by 列过白名单（site：`window partition_by` / `window order_by`）。

### 9.4 CTE（非递归 WITH）

**概念**：CTE（Common Table Expression，公用表表达式）就是**给一段子查询起个名字**，
让它在**这一条语句内**可以被当成表来用。SQL 形态是
`WITH 名字(列, ...) AS (子查询) 主查询`。心智模型：**语句级的临时视图**——不是建表、
不落盘、语句结束就消失；相当于"先把这部分结果算出来存个名，主查询再拿这个名字当表查"。

什么时候需要它：

- **可读性**：嵌套子查询套到第三层就读不动了，把每层拆成具名步骤，像读流水账。
- **自 join 的替代**：v0.1.81 起同表自 join 只要两侧起不同别名就能写（见 §6）；但同一张表
  被引用三处以上时，CTE 复制一份读起来更像流水账。
- **复用**：一个定义，主查询里可以当基表、也可以进 join 条件引用它。

```ts
const adults = db.table("account")
  .select(["id", "name"]).where(leaf("age", "gte", 18));

db.table("adults")
  .with("adults", ["id", "name"], adults)     // name + 声明列 + 成员查询
  .select(["id", "name"])
  .where(leaf("name", "like", "a%"))
  .all();
```

**原理（渲染与安全模型）**：上面这条链渲染为（`.toSQL()` 随时可验证）：

```sql
WITH "adults" ("id", "name") AS
  (SELECT "id", "name" FROM "account" WHERE "age" >= ?)
SELECT "id", "name" FROM "adults" WHERE "name" LIKE ?
```

- 执行时成员 SELECT 先算出一个结果集，主查询把它当普通表引用；至于引擎内联还是
  物化这个中间结果是优化细节，语义不变、不落盘。
- **为什么 `columns` 必填**：引擎不推断 CTE 的输出列形状，**声明的列就是它对外发布的
  契约**（`cte needs non-empty columns`）。后续一切对 `adults` 的列引用都按这份清单
  过白名单——成员查询里摸不到的列，引用侧同样摸不到，白名单防线在这里不打折。
- **非递归**：不支持 `WITH RECURSIVE`（树形/图遍历请用应用层循环或裸 SQL）。
- CTE 是**虚拟表**，不查 schema 注册表、无归属模块（归属守卫递归查它的成员查询）；
  但名字与列名仍过别名形状校验（`illegal alias 'x'`）。
- **WITH 名遮蔽同名真实表**（标准 SQL 语义）：本语句内 `adults` 指 CTE 而非同名实体表。
- **校验顺序**：WITH 先于主语句表解析——所以基表直接写 CTE 名是合法写法。
- 成员查询受嵌套约束：仅 select、禁再嵌 with/unions（`nested select does not accept
  with/unions (v1)`），嵌套深度计入 `REQ_NEST_MAX`（§9.1）。

---

## 10. 序列化：toJSON / fromJSON

```ts
const snap = db.table("account")
  .select(["id", "name"])
  .where(leaf("role", "eq", "admin"))
  .toJSON();                                  // 纯 JSON 快照（可入库/入队列/跨网络）

const rows = await DB("analytics").fromJSON(snap).all();   // 在另一个库上恢复继续链
```

- 快照是**不透明 req 对象**：`db` 字段只是创建时的 JS 可见名，恢复时统一重指到
  调用 `fromJSON` 的那个库。
- 快照恢复**完全绕过 JS 链层**——所有安全校验在 op 侧重复生效（动词矩阵、白名单、
  归属守卫），不要试图从快照夹带私货。
- 典型用途：把查询存表、由别的模块/服务恢复执行、审计。

---

## 10.5 方言能力矩阵（v0.1.88，ABI 12）

宿主只对**它认识的三种方言**替你生成 SQL；其他方言（由插件 `describe()` 声明）上一期只开放
**裸 SQL 路径**。能力缺失一律 `OJ_DB_UNSUPPORTED`（`e.data.capability` 点名是哪个 API），
**绝不**静默按 sqlite 语义生成一段错误 SQL。

| API | sqlite | mysql | postgres | 其他方言 |
|---|---|---|---|---|
| `db.query` / `db.exec` / `db.tx` | ✅ | ✅ | ✅ | ✅（裸 SQL 全量可用） |
| `db.stream` | ✅ | ✅（typed 直连，真流式） | ✅（typed 直连，真流式） | 取决于插件是否声明 `stream`；未声明回落 `db.query` 全量 |
| `db.stream` 的 `signal` 取消 | 协作式（批间） | ✅ `KILL QUERY` | ✅ `pg_cancel_backend` | 取决于插件是否声明 `cancel`。`db.cancel`（v0.1.96）复用同一取消链，只是触发点跨请求 |
| `db.query`/`db.exec` 的取消（v0.1.114） | 客户端早停（category 仍 `OJ_DB_CANCELLED`） | ✅ `KILL QUERY`（连接报废不回池） | ✅ `pg_cancel_backend`（连接报废不回池） | 插件轴 query 经宿主侧复用 stream vtable 真杀（query_cancelable）；插件轴 exec 取消不可达（ABI 13 车） |
| `db.import` 任务式批量导入（REQ-12，v0.1.115） | ✅（全单事务：cancel/fail 整回滚 rows=0） | ✅ 多值 INSERT + `ON DUPLICATE KEY UPDATE`（upsert 需唯一键） | ✅ 多值 INSERT + `ON CONFLICT (keys) DO UPDATE` | ❌（构造器形态，按上表构造器行同门——见 §3.4） |
| `db.table(...)` 构造器（含 DML / join / CTE / 聚合） | ✅ | ✅ | ✅ | ❌ `OJ_DB_UNSUPPORTED` |
| `db.listTables` | ✅ | ✅ | ✅ | ❌ |
| `db.nextSeq` | ✅ | ✅ | ✅ | ❌ |
| `_shared/search.ts` / `_shared/versions.ts` | ✅ | ✅ | ✅ | ❌ |
| `oj migrate` / `oj seed` | ✅ | ✅ | ✅ | ❌（迁移须用该方言自己的工具） |

> **`memory://` 不在上表三列里**：它是测试**假后端**（见 §1.1），`query`/`exec`/`stream`
> 都直接回夹具行、不执行 SQL，`db.nextSeq` 因此拿不到返回值（`db.nextSeq: no value
> returned`）。要验真实 SQL 语义请用 `sqlite::memory:`。

### 能力位对照表（8 个串 × 三内置方言）

插件在 `describe()` 里声明**它真做得到**的能力位；宿主装配期解析成
`DialectCaps { placeholder, id, stream, cancel }`，运行期纯查表。下表是**声明面**的逐位对照
（`plugins()` / `GET {base}/plugins` 的 `caps` 列、启动横幅 `| caps: …` 同源，
串由 `DialectInfo::summary()` 拼装）：

| 能力串 | 语义（声明 = 承诺） | sqlite | mysql | postgres | 宿主消费点 / 执行期影响 |
|---|---|---|---|---|---|
| `placeholder_q` | 原生占位符 `?` | ✅ | ✅ | — | `placeholder.rs` **不改写**，JS 写的 `?` 原样下发。**参与执行** |
| `placeholder_dollar` | 原生占位符 `$n` | — | — | ✅ | `placeholder.rs` 把 `?` 依次改写成 `$1..$n`（`?` 个数与参数个数不符提前报 `placeholder count <n> != params <m>`）。**参与执行** |
| `placeholder_colon` | 原生占位符 `:n` | — | — | — | 宿主**不改写**（透传），`:n` 改写归**插件内部**。**参与执行（插件侧）** |
| `id_returning` | insert 单语句 `RETURNING` 取自增 | — | — | ✅ | **仅登记**：构造器取 id 按具体方言选路，不读这一位（见下） |
| `id_two_step` | 取自增需二次查询 | ✅ | ✅ | — | **仅登记**（同上）：mysql `LAST_INSERT_ID()`、sqlite `last_insert_rowid()` |
| `id_none` | 不提供自增 id（主键由客户端 / `db.nextSeq` 生成） | — | — | — | **仅登记**：上层要 id 时给「无 id」，不报错 |
| `stream` | 实现 `stream_open/next/cancel/close` | ✅ | ✅ | ✅ | `db.stream` 走 vtable 批量 pull（≤100 行/次）。**参与执行** |
| `cancel` | 语句级真取消（服务端中断） | — | ✅ | ✅ | `signal` 中止活跃游标时调 `stream_cancel`（mysql `KILL QUERY` / pg `pg_cancel_backend`）。**参与执行** |

**三内置方言的完整能力串**（启动横幅与 `oj info` 里逐字可见）：

```
sqlite    placeholder=? id=two_step stream
mysql     placeholder=? id=two_step stream cancel
postgres  placeholder=$ id=returning stream cancel
```

> **组的约束**（装配期校验，错即拒载并点名）：`placeholder_*` 三选一**必选**、`id_*` 三选一
> **必选**；`stream` / `cancel` 独立可选（缺省 false）。同组出现两个（如 `id_returning` +
> `id_two_step`）算错。四种失败各有固定文案：`unknown capability "…"`（typo）、
> `describe json invalid: …`（JSON 本身坏了）、`missing capability group "placeholder"|"id"|"dialect"`、
> `duplicate capability in group "placeholder"|"id"|"stream"|"cancel"`。

> `id` 组的现实口径：**登记与对账用，不参与执行路由**。构造器取 id 的路由按具体方言
> 判定（只有 mysql 进「两步 `LAST_INSERT_ID()`」，其余走 `RETURNING`）——所以 sqlite 虽然
> 声明 `id_two_step`，`.returning(["id"])` 生成的却是**单语句 `RETURNING`**。因为回取语句是
> 方言私有的，宿主无法从能力位推出来。`query.rs::exec_route` 的注释与
> `lastid_route_is_mysql_only_not_equivalent_to_id_two_step` 用例钉死了这条边界。

> **能力位齐全 ≠ 业务 API 可用**：新方言的每格都由它自己的 `describe()` 决定，规则与上表
> 完全一致；但构造器 / `listTables` / `nextSeq` / `migrate` / `seed` 还要求方言名落在宿主
> known 子集（`sqlite` / `mysql` / `postgres`），否则一律 `OJ_DB_UNSUPPORTED`（见本节上方
> API 矩阵的「其他方言」列）。

**接新方言（插件作者）**：在 `describe()` 返回 `{"dialect": "<名>", "capabilities": [...]}`，
能力串只能取上表 8 个之一（两个互斥组各必选一，`stream` / `cancel` 可选）。宿主装配期严格
校验，写错/漏项直接拒绝该插件并点名——宁可拒绝启动，也不让错配活到运行期。接入全流程与
验收口径见 `docs/plugins/plugin-development.md` §15（conformance 清单），起手骨架见
[`tools/plugin-template-db`](../../tools/plugin-template-db/README.md)；类型/值契约见本节 §10.6。

**错误诊断**：db 的 reject 自带 `e.code` / `e.retryable` / `e.sessionDisposition` / `e.data`
（含引擎原始码 `data.vendor_code`）——不要解析 message 文本。完整口径见
`docs/devkit/api-manual.md`「结构化数据库错误」。

`OJ_DB_UNSUPPORTED` 的 `e.data.capability` 是**闭集**（业务代码可以安全 switch）：

| capability | 触发点 |
|---|---|
| `query_build` / `query_sql` | `db.table(...).all()/run()` 与 `.toSQL()`（宿主生成 SQL） |
| `list_tables` | `db.listTables()` |
| `next_seq` | `db.nextSeq()` |
| `migrate` / `seed` | `oj migrate` / `oj seed`（CLI 侧 fail-loud，不进 JS） |
| `stream` / `cancel` | 插件声明了该能力却回 unsupported（契约违规） |

**业务代码要不要按方言分支？** 多半不需要，且 `db.dialect()` 不是判断能力的正确工具——
迁移分档与模板见 §10.7。

---

## 10.6 类型映射表与值契约（跨方言）

`schema.yaml` 的列类型词汇是**固定的六类**（唯一来源 `src/bridge/registry.rs` 的
`ColumnType::SCHEMA_TYPES`：`integer` / `bigint` / `text` / `boolean` / `double` / `blob`）。
任何方言插件都必须能把六类建成表、并读回 JS 可用的值；对不上要**报错**，不许静默兜底。

### 1) 建表映射（DDL）

| 逻辑类型 | sqlite | mysql | postgres | oracle（M2 · 方案级） | 达梦 DM8（M2 · 待真库复核） |
|---|---|---|---|---|---|
| `integer` | `INTEGER` | `INT` | `int4` | `NUMBER(38)` | `INT` |
| `bigint` | `INTEGER` | `BIGINT` | `int8` | `NUMBER(20)` | `BIGINT` |
| `text` | `TEXT` | `TEXT` / `VARCHAR(n)` | `text` | `VARCHAR2(4000)`；超长 `CLOB` | `VARCHAR(n)` / `CLOB` |
| `boolean` | `INTEGER`（0/1） | `TINYINT(1)` | `boolean` | `NUMBER(1)` + `CHECK (c IN (0,1))` | `BIT` / `TINYINT`（M2 定） |
| `double` | `REAL` | `DOUBLE` | `float8` | `BINARY_DOUBLE` | `DOUBLE` |
| `blob` | `BLOB` | `BLOB` | `bytea` | `BLOB` | `BLOB` |

> 后两列来自设计 §5.6 的方案结论，**M2 落地时以真库 DDL 复核后回填**——不要据此直接生产建表。

### 2) 读侧值契约（JSON / JS）

| 逻辑类型 / 引擎列型 | JS 侧拿到 | 备注 |
|---|---|---|
| `integer` / `bigint` | `number`；**超出 ±(2^53-1) 的 i64 → 十进制字符串** | 见 `docs/numeric-limits.md`；回写超界整数用 `toBigInt()` |
| `double` / `float8` | `number` | 二进制浮点，别用来放钱 |
| `real` / `float4` | `number` | **4 字节**：`1.1::real` 读回 `1.100000023841858`（这是该列的真实值，不做舍入粉饰） |
| `boolean` | `true` / `false`；**MySQL 读出 `1` / `0`** | MySQL 无独立布尔类型（`TINYINT(1)`） |
| `text` | `string` | |
| `blob` / `bytea` | `string`（**UTF-8 lossy 转换**） | 真二进制请自己 base64 后存 `text`；二进制不会原样穿过 JSON |
| `DECIMAL` / `NUMERIC` | `string`（十进制文本，**不经 f64**） | MySQL 保留列声明精度（`numeric(10,2)` 的 `12.30` → `"12.30"`）；PG 走**去尾零规范形式**（→ `"12.3"`），原因见下 |
| `DATE` | `string` `"YYYY-MM-DD"` | |
| `TIME` | `string` `"HH:MM:SS[.ffffff]"` | 小数秒按值给，无小数秒则不带点 |
| `DATETIME` / `TIMESTAMP`（无时区） | `string` `"YYYY-MM-DDTHH:MM:SS[.ffffff]"` | ISO 8601，**无**时区后缀 |
| `TIMESTAMP`（MySQL，UTC 语义）/ `TIMESTAMPTZ` | `string` `"…Z"` | ISO 8601 + `Z` |
| `JSON` / `JSONB` | `string`（**JSON 文本**） | **不自动 `JSON.parse`**，由业务侧决定（见 §3 示例） |
| `BIT(n)`（MySQL） | `string`（位串，如 `b'10101'` → `"10101"`） | 无前导零（sqlx 不暴露位宽）；PG 的 `BIT` / `VARBIT` 目前**不支持** |
| `UUID`（PG） | `string`（规范 8-4-4-4-12） | |
| 数组（PG，一维） | `array` | 元素按上面同口径转换（`numeric[]` → 字符串数组）；元素 `NULL` → `null`；**多维不支持** |
| `GEOMETRY` 家族、`TIMETZ`、范围/复合/`point` 等 | —— | **PG（v0.1.111，REQ-07a）**：降级为 `$<type>:<base64>` 前缀标量（type 名小写，base64 = 协议原始字节、可逆；判别按**列声明类型**，非内容嗅探）。语句级权威清单 = `X-OJ-Degraded` 响应头（按 `{col,type}` 去重；`db.query` 裸 SQL 与构造器两路；干净结果不打头）/ 导出任务 `exportStatus.degraded`（干净导出 `[]`）。**MySQL**：仍**报错**（sqlx 0.9 无公开原始字节出口，v0.1.111 未随 PG 降级） |

#### 未解码类型降级契约（REQ-07a，v0.1.111）

- **grammar**：单元格值 = `$<type>:<base64>`，type 段 `[a-z0-9_]+`（方言类型名小写化；
  非法字符落 `_`，跨 FFI 不 panic）。`<binary>` 段只能是 base64——JSON 字符串必须是合法
  UTF-8，裸二进制无路可走（base64 1.33× 是文本编码地板价；体积敏感请导出到文件）。
- **判定口径**：按列声明类型（type-driven），同列全行同形态；**不做内容嗅探**。
- **权威判定面是语句级清单，不是前缀**：TEXT 列字面量可能恰好以 `$<type>:` 开头，
  消费方只看 `X-OJ-Degraded` 头 / `exportStatus.degraded`（去重的 `{col,type}` 数组）。
- **红线**：`try_get_raw` 拿不到原始字节的窄场景仍 `undecodable_column` 整行报错，
  绝不产空信封；Any/sqlite 路径语义不变（sqlite 无未解码类型）。
- **已知边界**：`db.stream` 流式批次暂不带降级汇总（随 REQ-07b 二进制批补齐）；
  MySQL `GEOMETRY` 家族维持 fail-loud（见上表）。

> **新增的类型都是只读的。** 上面那张表的每一行都只在**读**侧成立；写侧 `bind_value` 只绑
> `null` / 布尔 / 数字 / 字符串，没有对称编码。要把值写回 `numeric`/`jsonb`/`uuid`/数组列，
> 必须在 SQL 里显式转换：`insert into t (n) values (?::numeric)`（PG 直接绑字符串会报
> `42804`）。这是有意的：隐式编码会让「字符串到底是文本还是 JSON」变成方言猜谜。
>
> **为什么 PG 的 `NUMERIC` 要去尾零**：sqlx 的 `TryFrom<&PgNumeric> for BigDecimal` **丢弃
> 服务端 dscale**，把标度硬算成 4 的倍数（`sqlx-postgres/src/types/bigdecimal.rs`），
> 于是 `1.5` 会读成 `1.5000`。值本身精确（没经 f64），但字符串带假精度比丢尾零更误导，
> 故统一 `normalized()`：只去尾零、不动有效位。MySQL 的 `DECIMAL` 由协议**文本**解析而来，
> 标度是服务端给的，原样保留。

### 3) 三内置方言的读侧边界

| 方言 | 可读 | 报错（点名列名 + 类型，给 `cast` 指路） | 未识别时静默 `null`？ |
|---|---|---|---|
| sqlite | 整数 / 浮点 / 文本 / BLOB（动态类型） | —— | **是**（`row_to_json` 兜 `Value::Null`，既有行为，未收紧） |
| mysql | 整数家族（含 `BIGINT UNSIGNED`）/ 文本家族 / 二进制 / `FLOAT` / `DOUBLE` / `DECIMAL`、`DATE`、`TIME`、`DATETIME`、`TIMESTAMP`、`YEAR`、`JSON`、`BIT` | `GEOMETRY` 家族、`SET` 等其余列型 | 否 |
| postgres | `boolean`、`int2` / `int4` / `int8`、`float4` / `float8`、`text` / `varchar` / `char`、`bytea`、`numeric`、`date` / `time` / `timestamp` / `timestamptz`、`json` / `jsonb`、`uuid`、一维数组（见上加白名单） | `timetz`、`bit` / `varbit`、范围类型、几何、复合类型、多维数组 | 否 |

**`db.query` / `db.tx(...)` 内的查询 / `db.stream` 三条路径用同一套判据**（v0.1.93 起
`oj-db-postgres` 的 `query` / `exec` / `tx_*` 也从 `sqlx::Any` 换成 typed `Pool<Postgres>`——
此前这些类型只有流式能读，同样的查询走 `db.query` 会报「未解码」，属于**同一列两种结论**的
分叉，已消除）。

### 4) 新方言接入的硬要求

1. **列类型必须闭集**：禁止 `Unknown` 静默当 text。`SchemaFile::parse` 在声明期就拒未知
   类型（点名原串 + 列出支持清单 + 指引「其余类型请写 `migrations/NNNN__desc.sql`」）；v0.1.88
   起核心侧也收紧——`ColumnType::from_schema_type` 返回 `Option`（不再兜底 `Unknown`），
   `registry_tables()` 对未识别类型同样拒载并点名，**即使有人绕过 `parse` 直接反序列化**也走不到
   「当 text」。`Unknown` 只剩一个含义：**列类型未声明**（旧装配路径 `table()`，按 v0.1.23 行为）。
   为什么必须这样：把 `varchar` 当 text，租户守卫会给 `tenant_id` 绑字符串，在 PG 上退化成一句
   难懂的 `operator does not exist: bigint = text`——看起来像方言 bug，实际是声明写错。
2. **读侧不许静默 `null`**：解不出的列类型必须报错（mysql/pg 插件的既有做法）。sqlite 的静默
   `null` 是历史包袱，新插件**不要照抄**。
3. 上表第 2 节的**值契约是跨方言契约**，逐项写进插件 conformance 清单验收（见
   `docs/plugins/plugin-development.md` §15「新增数据库方言」）；起手用
   [`tools/plugin-template-db`](../../tools/plugin-template-db/README.md) 骨架，它已把这四条
   摆成代码面（含未声明/已声明 `stream`·`cancel` 的一致性用例）。

---

## 10.7 `db.dialect()` 的红字与迁移范式（v0.1.88）

> **红字：不要用 `db.dialect()` 判断「这个库能干什么」。**
> 方言名是**开放集**（插件 `describe()` 声明什么就是什么，`"oracle"` / `"dameng"` / 私有的
> `"demo"` 都合法）。v0.1.88 起宿主**不再把它回落成 `"sqlite"`**（旧行为是封闭三值枚举：
> 未识别的 DSN 前缀一律当 sqlite 处理，`dialect()` 于是报 `"sqlite"`，让一切都「看起来支持」），
> 也不再据此生成 SQL。能力位
> `{placeholder, id, stream, cancel}` 才是宿主认识的契约，但它是**宿主 ↔ 插件**之间的契约，
> 不是给业务 handler 的分派开关。
>
> 危害是**静默**的：`if (d === "mysql") A else B` 在新方言接入后会把 B 直接发给它——
> 占位符风格对不上、取 id 走错路、`ON DUPLICATE KEY` 发给 Oracle，报错落在引擎侧
> （`ORA-00933`、`near "?"`…），看起来像方言 bug，实际是分支兜底。

`db.dialect()` 只剩三种正当用途：**诊断/日志**、**确属方言特有的 SQL**（第 ③ 档，必须白名单
+ 响亮失败）、**共享模块的集中适配层**（`_shared/dialect.ts` 这一类，业务代码不直接看它）。
`db.tx` 回调对象是同面（`tx.dialect()`），语义一致。

### 迁移分档：先问「这段分支能不能删」

| 档 | 原来在分支什么 | 现在怎么写 | 为什么不用问方言 |
|---|---|---|---|
| ① 删掉 | 拼占位符（`?` / `$n` / `:n`） | 一律写 `?` | 按 `placeholder` 能力位改写：`placeholder_dollar` 宿主改 `$n`；`placeholder_colon` 宿主**不改写**，由插件内部把 `?` 改 `:n` |
| ① 删掉 | 取自增 id（`RETURNING` vs `LAST_INSERT_ID`） | `db.table(...).insert({...}).returning(["id"]).run()`（mysql 只收单列） | 取 id 路线由构造器按**具体方言**决定（只有 mysql 走两步 `LAST_INSERT_ID()`，其余 `RETURNING`）——不是按 `caps.id` 推的，回取语句是方言私有 |
| ① 删掉 | 列目录（`sqlite_master` / `information_schema`） | `db.listTables(prefix?)` | 三内置方言同口径（SQL 是引擎常量），业务侧不用写分支 |
| ① 删掉 | `limit n` 语法 / `select max(id)+1` 取号 | 构造器 `.limit(n)` / `db.nextSeq(name)` | 构造器与序列原语自己处理方言差异 |
| ② 换问法 | 「这个 API 支持吗」 | **直接调用，接住 `OJ_DB_UNSUPPORTED`** | 宿主抛结构化错误，`e.data.capability` 点名是哪个 API；不用猜 |
| ③ 保留 | 真方言特有 SQL（upsert 语法、窗口函数差异、受限列型 `cast`、DDL） | 白名单 + 未知方言**响亮失败**（模板见下） | 这类差异确实存在，但必须「不认识就报错」而不是兜底 |

**第 ② 档的写法**——不要「先问再调」，直接调：

```ts
async function listReportIds(): Promise<unknown[]> {
  try {
    return await db.table("report").select(["id"]).all();
  } catch (e: any) {
    if (e.code === "OJ_DB_UNSUPPORTED") {          // 该方言不支持构造器
      return db.query("select id from report");    // 裸 SQL 路径始终可用
    }
    throw e;
  }
}
```

这比 `if (["sqlite","mysql","postgres"].includes(db.dialect()))` 更准：白名单写错会骗自己，
结构化错误不会。

### 第 ③ 档的模板（白名单 + 禁止静默兜底）

```ts
// _shared/dialect.ts —— 全项目唯一的方言分派点，集中受审
const UPSERT_SQL = {
  sqlite:   "insert into account (id,name) values (?,?) on conflict(id) do update set name=excluded.name",
  postgres: "insert into account (id,name) values (?,?) on conflict(id) do update set name=excluded.name",
  mysql:    "insert into account (id,name) values (?,?) on duplicate key update name=values(name)",
} as const;
type UpsertDialect = keyof typeof UPSERT_SQL;   // 新增方言时编译器会在这里报错

export async function upsertAccount(id: number, name: string): Promise<void> {
  const d = db.dialect();                       // 可能是任何声明名，包括 "oracle"
  if (!(d in UPSERT_SQL)) {
    throw new Error(`upsertAccount: dialect ${d} 未适配（已支持 ${Object.keys(UPSERT_SQL).join("/")}）`);
  }
  await db.exec(UPSERT_SQL[d as UpsertDialect], [id, name]);
}
```

要点：

- **白名单用对象/数组并 `in`/`includes` 判定**，键集合随类型走——新增方言忘改会编译期红，
  不会运行期静默。
- **失败信息点名函数 + 方言 + 已支持集**：排障时一眼定位，比引擎原始码有用。
- **别把 `db.dialect()` 存进模块级常量**：命名库之间可以不同方言，`db` 是 `DB(name)`，
  `db.tx` 句柄同面——缓存会导致跨库读错。
- **别在 handler 里按 `plugins()` 的 `caps` 自己分派**：`caps` 是留给运维核对装配的
  外显（`GET {base}/plugins`、`oj info`），不是业务能力探测入口；能力探测请走第 ② 档。

完整可照抄场景见 `docs/devkit/scenarios.md` 场景 45；能力位全表见 §10.5，插件侧接入见
`docs/plugins/plugin-development.md` §15。

---

## 11. 边界与红线（新人必读）

1. **动态标识符只来自白名单**。表名/列名绝不允许来自请求拼 SQL——注入防线的根。
   构造器里一切标识符都过 SchemaRegistry（或 CTE 声明列）；裸 SQL 的标识符只能写死。
2. **值只走绑定参数**。构造器值、`?` 占位符（三引擎统一，0.1.67 起）；永不字符串拼接。
3. **update/delete 必须带 where 且叶子 ≥ 1**——防全表误伤，JS 与 op 双层强制。唯一显式例外是
   `.truncate()`（命名式整表清空，见 §7.1）。
4. 数量级：条件树深度 ≤ 8、叶子 ≤ 64；嵌套 select 最多 3 层（`REQ_NEST_MAX=4`，顶层算 0 层）；
   limit 显式受 `db_query.max_limit` 约束（**默认 1000**，可配至硬顶 **100000**）。
5. **多写 .toSQL()**：与执行同管线，报错前先看它渲染出了什么。
6. **64 位整数（雪花 id）读出来是字符串**（v0.1.22）：`|v| > 2^53-1` 的 i64 一律以十进制
   字符串交付（超界给 bigint 会让 `json.ok` 直接 500）；回写用 `toBigInt()`——
   **字符串是文本意图、BigInt 是整数意图**，平台不做启发式转换（PG 上字符串写 bigint 列必报
   `column "x" is of type bigint but expression is of type text`）。**绝不要 `Number(大整数字符串)`**。
   无符号 64 位（`> i64::MAX`，仅 MySQL `BIGINT UNSIGNED`）用 `toUBigInt()`；
   **取号优先用 `db.nextSeq(name)`**（见 §11 第 7 条），不要再手写 `max(id)+1`。
   完整契约与范式见 `docs/numeric-limits.md`。
7. **取号用 `db.nextSeq(name)`（v0.1.24）**：平台序列分配原语，单语句原子、并发安全——
   `const id = await db.nextSeq("project_identifier");`（在 `db.tx` 内调用则搭车同一连接）。
   平台表 `_oj_sequences(name, v)` 首次使用**自动建**（`_oj_` 是平台命名空间，**业务不要手工
   读写/迁移它**）。返回值 ≤2^53-1 是 number，超出是十进制字符串（与 DB 读值同契约）。
   它取代了历史上 `select max(id)+1` 的写法（后者并发下会分配出相同序号，见
   `docs/numeric-limits.md` §3）。
   **四条必须知道的语义**（v0.1.24）：
   - **库级、跨租户共享**：`_oj_sequences` 没有 `tenant_id`，同一库内所有租户共用一个计数器；
     需要按租户隔离就把租户拼进 `name`（如 `` `order_no:${http.tenantId}` ``）。
   - **`name` 用服务端常量**，别直接取用户输入——否则序列表行数可被外部无限放大。
   - **需要 DDL 权限**（首次使用要 `create table if not exists`）；生产账号若只有 DML 权限，
     请用迁移**预建** `_oj_sequences(name, v)`。
   - **`memory://` 假后端不支持**（`no value returned`）；`sqlite://` / `sqlite::memory:`
     正常。平台序列表是普通表，`db.nextSeq` 只在**宿主认识的三种方言**上可用（§10.5）。
   - 序列值**不随调用方事务回滚而回退**（一次独立的原子自增）——按「只增不复用」理解。
8. **MySQL 读侧的列类型边界（v0.1.24 起；v0.1.94 扩到十进制/时间/JSON/BIT/YEAR）**：
   类型化路径下**可读** = 整数家族（含 `BIGINT UNSIGNED`）、文本家族
   （`TEXT`/`VARCHAR`/`CHAR`/`ENUM`）、二进制、`FLOAT`/`DOUBLE`，以及
   `DECIMAL`/`NUMERIC`（→ 十进制字符串，保留声明标度）、`DATE`/`TIME`/`DATETIME`
   （→ ISO 8601）、`TIMESTAMP`（→ ISO 8601 带 `Z`）、`YEAR`（→ number）、`JSON`
   （→ JSON 文本）、`BIT(n)`（→ 位串，如 `b'10101'` → `"10101"`）；`BOOLEAN`/`TINYINT(1)`
   按整数读出 `1`/`0`（MySQL 无独立 boolean 类型）。
   **仍然报错**：`GEOMETRY` 家族（`POINT`/`LINESTRING`/`POLYGON`/…）、空间类型、
   `SET`、以及无法判定的自定义类型——报错点名列名与类型，**不会静默给 `null`**。读这些列
   请在 SQL 里显式转换（`select ST_AsText(shape) as shape from t`），别用 `select *` 兜。
   与 PostgreSQL 共用同一判据：`db.query` / `db.stream` / 事务内查询**结论一致**（详见 §10.6）。

### 常见报错速查

| 报错（逐字） | 原因 | 修法 |
|---|---|---|
| `unknown table 'x'` | 表未进 schema.yaml | 声明表并检查模块装配 |
| `ownership: 表 "x" 属于模块 "y"…`（deny 模式） | 跨模块访问未声明依赖 | manifest `deps: [y]` 或改契约调用 |
| `unknown column 'x' in <site>` | 列不在白名单 / 未限定 | 补 schema；join 场景用 `表.列` |
| `unknown table 'x' in <site>` | 限定名表段不是基表/join/CTE | 检查限定名拼写 |
| `insert needs either values or fromSelect` | `.insert()` 空参（或 `fromJSON` 里两条都缺） | 传对象/非空数组，或改用 `.fromSelect(q, cols)` |
| `insert takes either values or fromSelect, not both` | 同一请求里两条路都给了 | 二选一（upsert 语义请用 `orIgnore`） |
| `insert rows must share identical key sets` | 行数组键不一致 | 对齐每行键 |
| `orIgnore on mysql requires a primary key on table 't'` | mysql 的 `orIgnore` 靠 `ON DUPLICATE KEY UPDATE pk=pk`，无主键无从恒等 | 给表加主键，或改用唯一约束 + 先查后写 |
| `orIgnore with fromSelect is not supported on sqlite (its upsert clause only follows VALUES)` | sqlite 的 upsert 只能跟 VALUES | 裸 `insert or ignore … select`（注意它连 NOT NULL/CHECK 也静默跳过），或 pg/mysql |
| `insert declares N columns but the source select yields M` | `fromSelect` 目标列与源列数不符 | 按位置对齐列清单 |
| `truncate does not accept where` | `.truncate()` 自带条件 | 走 `.delete().where(...)` |
| `count distinct needs a field` / `distinct is only supported on count` | `{fn:"count",distinct:true}` 缺 field / 给非 count 聚合加了 distinct | 写 `{fn:"count", distinct:true, field:"col"}` |
| `lit column 'x' needs a scalar value (string/number/bool/null)` | `{lit: …}` 给了数组/对象 | 标量；表达式请用 `case` |
| `db.nextSeq: no value returned` | `memory://` 假后端不执行 SQL | 换 `sqlite::memory:` 或真库 |
| `unknown db scheme in dsn '…' (known: […])` | DSN scheme 不认识，或对应插件没装上（`known` 列表按实际后端） | 装插件 / 改 DSN |
| `tenant guard: table(s) ["t"] require tenant context (missing tenant header; …)` | `sql_guard` 开着但请求没带租户头（deny 档） | 带 `X-TENANT-ID`，或系统任务改 `db.asSystem()` |
| `schema: [m] 表 "t" 缺 tenant_id 列（tenant.sql_guard 启用中…）` | 开了 `sql_guard` 但表没声明 `tenant_id` 列 | 补列；共享表标 `tenant: false` 并列进 `shared_allow` |
| `update needs non-empty sets` | `.update({})` | 至少一列 |
| `Update requires where (leaf count >= 1)`（delete 同款，动词首字母大写） | update/delete 无 where（绕过 JS `run()` 预检时由 op 兜底） | 补 `.where(...)`，或明示 `.truncate()` |
| `<verb> does not accept <field>` | 动词×字段矩阵拒绝 | 见 §7 表 |
| `condition tree too deep (max 8)` / `too large (max 64 leaves)` | 条件树超限 | 拍平/拆分条件 |
| `in needs array value` / `in needs non-empty array` | `op:"in"` 值非数组 / 空数组 | 传非空数组（空集请在 JS 侧直接短路，别发查询） |
| `value and subquery are mutually exclusive` | 叶子同时给了 value 和 subquery | 二选一 |
| `column "x" is of type bigint but expression is of type text`（PG） | 回写给 bigint 列传了**字符串** | 用 `toBigInt(...)`（见 §11 第 6 条） |
| `operator does not exist: bigint = text`（PG） | `where bigint 列 = $1` 传了字符串 | 同上 |
| 主键 `duplicate key`，被撞值末几位是 0 | `Number(max(id)) + 1` 坍缩到 f64 网格值 | 改 `toBigInt(max) + 1n`（`docs/numeric-limits.md` §3） |
| `toBigInt: … is not a safe integer` | 传入的是已坍缩的 number | 传 DB 原样给出的十进制字符串 |
| `invalid byte sequence for encoding "UTF8": 0x00` / `insufficient data left in message`（PG） | v0.1.24 前：同一 SQL 文本混用字符串/数字参数（sqlx 语句缓存按文本 key） | **v0.1.24 起平台自动按参数形态分缓存键**，无需再规避；若仍出现，检查 PG 插件是否随宿主重建 |
| `db param: u64 value … is not supported on this path` | `toUBigInt()` 的值走了一条不能承载 u64 的路径（PG/SQLite 全部；MySQL 的 sqlx::Any 回落路径） | 该值改存 text，或确保走 `BIGINT UNSIGNED` 的 typed 直连（`mysql://` DSN + 插件） |
| ``db(mysql): column 'x' has MySQL type 'GEOMETRY' which this plugin does not decode yet — select explicit columns and cast it in SQL (e.g. `ST_AsText(x) as x`); see docs/devkit/db-guide.md §10.6``（v0.1.24；v0.1.94 收窄到**剩余**类型；**v0.1.111 起 MySQL 维持报错**——sqlx-mysql 0.9 无公开原始字节出口） | MySQL 读侧**仍未支持**的列类型（`GEOMETRY` 家族、`SET` 等）——**报错而不再静默给 `null`** | 在 SQL 里显式转换：`cast(x as char) as x` / `ST_AsText(x) as x`；避免 `select *`。`DECIMAL`/时间/`JSON`/`BIT` 自 v0.1.94 起可直接读（见 §10.6） |
| ``db(postgres): column 'x' has type 'POINT' … see docs/devkit/db-guide.md §10.6``（v0.1.94；**v0.1.111 起仅「原始字节也拿不到」的窄场景才出现**） | PG 未覆盖类型自 v0.1.111 起**降级为 `$<type>:<base64>` 前缀标量**（按列声明类型；协议原始字节、可逆），不再整条 400；语句级权威清单 = `X-OJ-Degraded` 头 / `exportStatus.degraded`（§10.6 降级契约小节） | 消费方按清单解码 base64；要文本可读仍 `cast(x as text) as x`。`numeric`/时间/`json(b)`/`uuid`/一维数组自 v0.1.94 起可直接读 |
| PG `numeric` 读回 `12.3`（不是 `"12.30"`）；MySQL 读回 `"12.30"` | PG 侧统一 `normalized()` 去尾零（sqlx 解 numeric 会丢服务端 dscale，不规范化会出 `1.5000` 假精度）；MySQL 的标度来自协议文本 | 数值精确、不经 f64；要固定小数位在 SQL 里 `to_char(n,'FM999999990.00')` |
| PG `42804 column "n" is of type numeric but expression is of type text` | v0.1.94 新支持的类型（`numeric`/时间/`jsonb`/`uuid`/数组）**只读**，写侧无对称编码 | 回写须显式转换：`values (?::numeric)`、`?::jsonb`、`?::uuid`、`?::int4[]` |
| MySQL `BOOLEAN` 读出是 `1`/`0` | `BOOLEAN` 即 `TINYINT(1)`，协议层无长度元数据可区分 | 按整数读；需要布尔语义就在 SQL 里转：`select flag = 1 as flag from t` |
| `<site>: nested select too deep`（site ∈ `subquery`/`exists`/`union`/`cte`/`fromSelect`） | 嵌套 > 3 层（depth ≥ 4） | 减层或拆 CTE |
| `nested select does not accept with/unions (v1)` | 子查询/union 成员带了 with/unions | 移到顶层 |
| `union requires explicit columns` | union 侧省略 select 列 | 双方显式列且列数一致 |
| `union member does not accept order_by/limit/offset` | 成员带排序分页 | 排序分页放最外层 |
| `self join needs distinct table aliases (got 'a')` / `duplicate table alias 'a'` | 同表自联没起别名 / 别名撞车（v0.1.81 起带别名可用） | 基表 `.as("x")`、被 join 表第 4 参起别名 |
| `table alias is not supported on insert/update/delete` | 别名只用于 select/join | 去掉 `.as()`，或先查后写 |
| `select '*' must be the only column` / `select '*' is not allowed with joins` | `*` 与显式列/join 混用 | 要么只写 `["*"]`，要么列清单写全 |
| `illegal alias 'x'` | 别名形状不合法 | 字母/下划线开头 |
| `cte needs non-empty columns` | `.with(name, [], q)` | 声明列清单 |
| `transaction active on db 'x' …` | 事务中碰了别的库 | 先 commit/rollback |
| `transaction already active (nested tx not supported)` | 嵌套 `db.tx` | 复用当前 tx 回调对象 |
| `db: instance 'x' not configured` | 执行期按名取不到库：多半是 `manifest.yaml` 的 `db: x` 指向了 config 未声明的库（`DB("x")` 本身对未声明名返回 `undefined`，不会抛这条） | 在 `db:` 段补 DSN，或改 manifest 的绑定 |
| `db.stream within an active transaction is not supported (streaming queries run on the connection pool only)` | 事务内调 `db.stream` | 移到事务外（流式只走直连池，见 §3.1） |
| `db access: alias "x" not granted to this caller (…)` | `db_access` 的 `allow` 未命中（四维全不中/取不到身份） | 找管理员在 `allow` 里给对应维度授权（reason: `db_not_granted`） |
| `db access: alias "x" is read_only; statement classified write` | 该库 `read_only: true` 而语句被判为写类 | 改只读语句，或放开 `read_only`（reason: `db_read_only`） |
| `db access: alias "x" does not allow DDL` | DDL 未放开 | 放开 `allow_ddl`，或走迁移通道（reason: `db_ddl_denied`） |
| `db access: alias "x": dangerous write without an effective WHERE (…)` | UPDATE/DELETE 无 WHERE（或多表 / 恒真谓词） | 补 WHERE，或放开 `allow_dangerous`（reason: `db_dangerous_write`） |
| `db access: statement classification failed; denied by fail-closed` | 词法分不出类别（串未闭合 / 断词 / 未知语句） | 改用构造器 `db.table()`——它走精确意图判定，不依赖词法（reason: `db_unknown_risk`） |

---

## 11.5 db 访问控制（`db_access:` 段，v0.1.89）

一句话：`db:` 只定义「有哪些库、怎么连」，`db_access:` 定义「谁能对这些库做什么」。
两者**分开配置**——`db:` 仍是纯粹的 `别名 -> DSN` map，不塞任何策略。

### 11.5.1 配置形态

```yaml
db:                        # 不动：name -> DSN
  default: "sqlite://db.sqlite"
  analytics: "mysql://root@10.0.0.5:3306/olap"

db_access:
  defaults:                # 全局默认档（缺省 = off，与升级前完全一致）
    enforce: off           # off | warn | deny
  analytics:
    read_only: true
    max_rows: 1000         # 缺省 = 不限；范围 [1, 100000]
    allow:                 # 四维并集；缺省 = 不限制
      roles: [admin, dba]
      sources: [http]      # http | task
```

**继承语义**：`db_access.<alias>` 是**覆盖条目**，未声明的键**逐键继承** `defaults`
（`allow` 是**逐维**覆盖）。这不只是一个口味问题——若整条覆盖，运维设好
`defaults.enforce: deny` 后再给某库加一条 `read_only: true`，该库的 `enforce`
会悄悄回落 off：**全局设防被一次局部微调静默解除**。

装配期校验（fail-loud，不静默取其一）：`max_rows` 越界、`read_only: true` +
`allow_ddl: true` 矛盾、未知键（点名 `db_access.<alias>.<key>`）、非法档位。

### 11.5.2 谁可以访问：四维并集

主体四维：`modules`（请求所属模块）/ `roles`（`user.roles`）/ `tenants` /
`sources`（`http` | `task`）。

- 语义是**并集**：任一**已声明**的维度命中即放行；未声明的维度不参与限制。
- ⚠️ **声明多维不会提高强度，只会降低**（任一命中即过）。要「同时满足」本阶段做不到。
- `allow: {}`（或整段不写）= 不限制；`allow: { roles: [] }` = 声明且为空 → **无人可过**。
- fail-closed：声明了某维而请求取不到该维身份 → 该维不命中（**不因「取不到」而放行**）。
- `tenants` 维**只认 server 注入的租户**：`db.asTenant()` 自填的租户不作数
  （否则匿名 handler 可自造租户命中白名单 → 借道跨租户）。
- `db.asSystem()` **不豁免**访问控制（它只绕过租户注入）；管理员通道请走 `allow.roles`。
- `sources` 维是为了解决**任务桥恒无身份**（定时任务没有 user/module/tenant）：
  给它们声明 `sources: [task]`。WS 帧跑在 HTTP 桥上，source 记 `http`
  （**没有 `ws` / `anon` 两个取值**，写了永不命中）。

### 11.5.3 做什么：风险分类与策略位

语句按词法分成五类：`readonly` / `write` / `ddl` / `tx` / `unknown`。
`unknown` 一律按最严档处置（**fail-closed**）——分不出来就当最坏的看。

- `read_only: true` → 拦 `write` 与 `ddl`。
- `allow_ddl: false`（默认）→ 拦 `ddl`。
- `allow_dangerous: false`（默认）→ 拦**危险写**：`UPDATE`/`DELETE` 无 WHERE、
  多表（`update a, b` / JOIN / USING）、恒真谓词（`where 1=1`、`where a=a`）。
- **`dangerous_confirm_token`（G9，v0.1.99）**：危险语句**确认门**——配置 token 后（即便
  `allow_dangerous: true` / `enforce: off`），危险写一律要求请求头 **`x-oj-confirm`** 精确匹配
  才放行（键名大小写不敏感，值必须逐字相等）；放行即每条落审计 `DB_DANGEROUS_CONFIRM`
  （`audit.query` 可检索）。典型链路：前端弹「确认执行？」→ 用户确认 → 前端带头发请求——
  **op 层强制，不经任何方案包 handler 也拦得住**。token 只从 config 来（运行期
  `db.access.grant` 不覆盖安全位）；空串装配期拒启。
- `max_rows` → raw `query` 取回后截断（响应打 `X-OJ-Row-Limit`）；`db.stream`
  达上限**提前终止**；构造器路径取 `min(声明 limit, max_rows)`。

### 11.5.4 档位与自省

`enforce`：`off`（默认，零开销早退）/ `warn`（告警放行，灰度用）/ `deny`（拒）。
`warn` 与 `deny` 都落结构化日志，前缀 **`DB_ACCESS_DENY`**，按 `(alias, reason)`
聚合计数（warn 档逐条落会被刷爆、且可被当成刷盘放大器）。

**`deny` 是「拒绝违规」，不是「忽略 allow 硬拦所有人」**（v0.1.93 明确，此前 L3 的 Deny 短路
把 `allow` 授权整个废掉过）：

- `deny` + 写了 `allow` → **白名单制**：命中 allow 才放行，未命中拒（`db_not_granted`）。
- `deny` + 没写 `allow`（= 不限制主体）→ 主体全放行，但 `read_only` / `allow_ddl` /
  `allow_dangerous` / `unknown` 这些**策略位照常执行**。
- `warn` + 任何 `allow` → 只记日志、一律放行（灰度用；**不是**授权）。
- 「谁都不许」只有一种写法：动态登记且未声明 `db_access.<name>` 的库（见 §11.6.3），
  或用 `allow: { roles: [] }` 这种「声明且为空」的维。

`db.allowed()` 返回**当前主体可用**的库列表（含各库能力位）：

```js
const list = db.allowed();
// [{ alias: "default", dialect: "sqlite", read_only: false, allow_ddl: false,
//    allow_dangerous: false, max_rows: null, enforce: "off" }]
```

没有这个出口，前端只能列出全部连接、点了才报错——那是**假入口**。

### 11.5.5 承诺 / 不承诺

| 承诺 | 不承诺 |
|---|---|
| 库级授权（谁可以访问哪个 `db` 别名） | 行级 / 列级授权（已有 `SchemaRegistry` 白名单 + 租户守卫，不重叠建设） |
| 语句风险分类 + 危险写门 | 分类是 **best-effort 词法**，不是 SQL 解析器；复杂语句会落 `unknown` 并被拒 |
| `read_only` 位（**宿主侧文本判定**） | **不是**数据库账号权限的替代品——真正的写防线仍是 DB 侧 GRANT |
| `max_rows` 截断（raw）/ 提前终止（stream） | **不是**限流 / DoS 防线：raw 是先取回全量再截断，扫描与传输照旧 |
| 决策可观测（`DB_ACCESS_DENY` + `SqlEvent.risk/operator`） | **不是**审计系统：无防篡改、无持久化、无回溯 |
| `db.allowed()` 只列已授权的库 | 不回显 `allow` 名单（否则 403 响应可被用来枚举库与授权名单） |
| 约束 **JS 提交的 SQL** | **不约束**平台自生成 SQL（`db.nextSeq` 序列表 DDL、`db.listTables` 内省）与 CLI 通道（`oj migrate` / `oj schema` / `oj build` 不经 bridge） |
| 模块 / 角色 / 租户 / 来源 四维白名单 | 无黑名单形态；多维是**并集**（声明更多维只会放宽） |

### 11.5.6 升级须知

- 默认 `enforce: off` → **不配 `db_access:` 与升级前行为完全一致**（包括 `db.asSystem()`
  跑写语句的既有 handler 不受影响）。
- 一旦把某库设成 `deny` 档，用 `db.asSystem()` 跑写语句的 handler **会被拒**
  （asSystem 不豁免访问控制）——这是有意的行为变更。
- `sql_guard=deny` 站点上「raw SELECT 未登记表」的敞口**原样保留**：本策略只管
  alias + risk，只读语句一律放行。不要把本节读成「该敞口已修」。

### 11.5.7 结构内省（`listColumns` / `listIndexes` / `listForeignKeys`，v0.1.90）

把「表名级」的 `db.listTables` 扩到**列 / 索引 / 外键**三级，三方言同构返回，
供前端画连接树（连接 → 库 → 表 → 列/索引/外键）而不必裸 `db.query` 拼方言 SQL。

```js
const cols = await db.listColumns("user");        // {name, nativeType, nullable, default, primaryKey}[]
const idx  = await db.listIndexes("user");        // {name, unique, primary, origin, columns}[]
const fk   = await db.listForeignKeys("user");    // {name, columns, refTable, refColumns}[]
// 事务内同签名：const cols = await db.tx(async t => t.listColumns("user"));
```

要点：

- **表名只经绑定参数**，零标识符内联；`_lazy` 里面含 `%` / `_` 是按字面量等值匹配，
  **不是 LIKE 通配符**（`listColumns("foo_bar")` 能查到，不会变成「前缀模糊」）。
- **`nativeType` 是方言原始声明文本**，零归一化：sqlite `type`、mysql `column_type`
  （含长度 `varchar(64)` / `decimal(10,2)`）、pg `format_type`（含数组 `int[]` /
  `character varying(32)`）。需要跨方言归一化请业务侧自己做。
- **`origin` 三方言统一**为 `c`(普通) / `u`(唯一) / `pk`(主键)。注意 sqlite 的
  `create unique index` 在 `pragma_index_list.origin` 里归 `c`（那是「创建方式」不是
  「唯一性」），本能力已按 unique/origin 派生成统一口径，UI 不再分支。
- **`primaryKey` 以 `listColumns` 为准**：sqlite rowid 表在 `listIndexes` 里可能无索引项。
- **`ForeignKey.name` 可为 null**（sqlite 外键无约束名）；复合外键 `columns[i]` ↔
  `refColumns[i]` 按位配对。
- **表不存在 / 不可见 / 在别的 schema → 一律空数组**，不区分原因；要校验表名先用
  `db.listTables(prefix)`。
- **表名入参校验**：长度 > 128、含 NUL / 控制字符、或（sqlite）含 `.` → 空数组
  （挡 `other.secrets` 形式的跨库内省、避免畸形输入变 500）。
- **授权**：三个 op 与 `db.listTables` 一并过 `db_access` 的**授权维**（`granted_only`）。
  `asSystem()` **不豁免**；`warn` 档放行并落 `DB_ACCESS_DENY`；`deny` 档未授权主体
  返回 `OJ_DB_DENIED`（`db_not_granted`）。内省恒只读，故不受 `read_only` 限制
  （只读库也必须能看结构，否则 UI 连展开都做不到）。
- **未知方言**：结构化 `OJ_DB_UNSUPPORTED`，`e.data.capability` 点名
  `list_columns` / `list_indexes` / `list_foreign_keys`，**绝不回落 sqlite**。
  调用前可用 `db.dialect()` 预判。
- **每 op 硬上限 1000 行**（元数据规模天然小，正常站点碰不到）。

> **红线**：内省结果是**目录读**，不是标识符白名单。**禁止**把列名回填构造器或拼进
> 裸 SQL——构造器的标识符只认 `SchemaRegistry`（未登记表 `db.table("x")` 报
> `unknown table`）。内省也不回显 `allow` 名单。

#### 三方言差异对照（前端自检用）

| 维度 | sqlite | mysql | postgres |
|---|---|---|---|
| 列 `nativeType` | `type`（声明原文） | `column_type`（含长度） | `format_type(atttypid,attypmod)`（含数组/域） |
| 列 `default` | 原始 DDL（字符串带引号 `'x'`） | `column_default`（表达式文本） | `column_default::text` |
| 索引 `origin` | 按 unique/origin 派生 `c/u/pk` | `PRIMARY`→`pk`，`non_unique=0`→`u`，余 `c` | `indisprimary`→`pk`，`indisunique`→`u`，余 `c` |
| 外键 `name` | 恒 `null`（无约束名） | `constraint_name` | `conname` |
| 复合外键配对 | `pragma_foreign_key_list` 按 `seq` | `position_in_unique_constraint` | `conkey`/`confkey` 按 ordinality |
| schema 范围 | 单库（文件） | `DATABASE()` | `current_schema()` |

---

### 11.5.8 库/schema 层：清单 + `forSchema` 受限视图（REQ-04，v0.1.105）

把对象树从「连接(=库) → 表」补齐到「连接 → 库 → schema → 表」。清单两件跨方言同构
`{name, owner?, isDefault?, comment?}`（可选键缺省不出现）；系统目录由平台统一过滤
（mysql 滤 `information_schema`/`mysql`/`performance_schema`/`sys`；pg schema 滤
`pg_catalog`/`pg_toast%`/`information_schema`；pg database 滤模板库），调用方零
if-else。账号级可见性跟随 DB 账号自身权限模型（pg_database 有 per-database ACL；
mysql 的 schemata 对可连接账号可见库名）——平台不越权代做账号级过滤。

```js
const dbs = await db.listDatabases();        // pg：集群共享目录，不换连接拿名字
const schemas = await db.listSchemas("app"); // mysql：与 listDatabases 同源（schema≡database）
const scope = db.forSchema("app_log");       // 只读内视受限句柄：五件内视、无 query/exec/stream
const tables = await scope.listTables();
```

- **机制**：内视 SQL 的范围谓词（`DATABASE()` / `current_schema()`）在 scoped 模式
  改写为**绑定参数**——schema 名零标识符内联，`.` 合法（库名含点），畸形名
  （>128 / 控制字符）返回空结果（不报错不泄漏，与表名同口径）。
- **unsupported 矩阵（报错不静默， capability 点名）**：sqlite 的 forSchema 各件
  （无 schema 概念）；pg 的跨 database 视图（database=独立连接，物理不可行，
  「一连接=一库」）；mysql `catalog("ddl")` 的 SHOW 例外（不接受绑定参数）。
- **安全**：与既有内视面同链——`granted_only` 授权维、known 方言门控、
  `MAX_ROWS` 截断、trace 脱敏；句柄池面 only（无 tx/session 变体）。

---

### 11.6 动态数据源登记（`db_client:` 段 + `db.client`，v0.1.91；实例化能力 L4 v0.1.92）

运行期把任意 DSN 登记为**命名数据源**，对齐 dbx 的多数据库连接树「运行期增删连接」。登记后别名
直接进入 `DB(name)` 解析路径，**复用 L1 访问控制（§11.5）+ L2 结构内省（§11.5.7）+ 全部
query/exec/stream**——**不另起平行的 `db.client.query` API**（使用面一律走 `DB(name)`）。

连接经与装配期**同集**的 `DbBackendRegistry`：`sqlite` / `memory` 内置，`mysql` / `postgres` 由
插件注册（与静态库走完全一样的后端）。

#### 11.6.1 配置（`db_client:`）

```yaml
db_client:
  enabled: true            # 默认 false（fail-closed）。false 时 register/test/... 全拒。
  max_entries: 64          # 单进程连接池硬上限（=0 装配期 fail-loud 拒启动）。
  max_per_owner: 32        # U-7（v0.1.97）：单主体（registered_by）最多登记几个动态库。缺省 32；=0 拒启动。
  max_streams: 32          # U-7（v0.1.97）：动态库全局并发流预算（所有动态别名 db.stream 游标总数）。缺省 32；=0 拒启动。
  allow:                   # 登记门：谁能调 register/test/delete/reRegister/list。
    roles: [dba]           # 四维并集；任一命中即放行。全缺 = 不限制。
    sources: [task]        # 可限定 http / task 来源。
```

**装配期 fail-loud**：`enabled=true` 且 `allow` 四维全缺（无限制）→ **拒启动**（防「开了忘配」就全开，
SSRF / 内网横向移动面）；`max_entries==0`、`max_per_owner==0`、`max_streams==0`、
`max_per_owner > max_entries` 同样拒启动。

**真实并发算式（U-7，容量规划必读）**：一个动态库的连接峰值 = **池连接 + 8**（typed 流式游标
独占池外连接，插件侧每别名闸 8）；全进程动态轴峰值 ≈ `max_entries × (池 + 8)`。`max_streams`
是**全局**游标预算（不排队，满了 `db.stream` 直接报错点名 `db_client.max_streams`），用来把这个
乘法封顶；行数上限按别名配 `db_access.<name>.max_rows`。

**查询超时与结果集字节上限（v0.1.103，REQ-05 已覆盖）**：`db_access.<name>.statement_timeout_ms`
（调用侧 `timeoutMs` 只能收紧）+ `db_access.<name>.max_result_bytes` / `on_exceed`
（行 JSON 编码字节，边拉边计；fail 档缺省，truncate 档打 `X-OJ-Result-Truncated` 信令）。
语义与架构限制（sqlite 同步步进饿死定时器、内置 sqlx `data.cancelled=true` / 插件轴
`false` 的诚实位口径）见 §11.6.3。

#### 11.6.2 管理面（`db.client`）

```js
const r = await db.client.register("rep", "mysql://user:pass@host/db"); // 返回 {alias,dialect,dsn,registeredBy,registeredAtMs,serverVersion,probedAtMs,queries}
await db.client.test("mysql://user:pass@host/db");   // {ok, dialect?, error?}（不落库）
await db.client.reRegister("rep", "mysql://...");    // 替换已登记连接（不存在则错）
const ok = await db.client.delete("rep");            // 删库 + 驱逐 dbCache（见下）
const names = await db.client.list();                // [{alias,dialect,dsn,registeredBy,registeredAtMs,serverVersion,probedAtMs,queries}]（dsn 已脱敏）
db.client.has("rep");                                // 同步 bool（探活用，不经过登记门）
```

- **使用面走 `DB(name)`**：登记后 `DB("rep").query(...)` 与静态库完全一致（访问控制 / 内省 / 流 /
  查询计数全复用）。
- **`delete` 必须再 `DB(name)` 前驱逐缓存**：`db.client.delete` 已自动 `dbCache.delete(name)`，否则
  删后再 `DB("rep")` 拿到**陈旧实例**。
- **`dsn` 全脱敏**：`user:pass@` → `***`，host/库名保留排障；连接失败错误同样脱敏。
- **审计**：register / delete / reRegister 落 `DB_CLIENT_AUDIT`（operator/module/tenant/source），
  非防篡改但比 deny_log 更适合安全敏感事件。配额/预算/拨号拒绝落 `DB_CLIENT_DENY`
  （action/reason/owner/alias，U-7）。
- **拨号守卫（U-7，v0.1.97，防内网端口扫描）**：`test` / `register` / `reRegister` 的 connect
  统一包 **5s 拨号超时**；同一主体**连续 8 次 connect 失败**（含超时/认证失败）→ 锁退 60s，
  期间一律在**拨号之前**拒绝（不给探测流量出网），错误带 retry 秒数；成功一次即清零。
  超限/锁退落 `DB_CLIENT_DENY`。

#### 11.6.3 安全红线（四路评审 [安全·阻断] 裁决）

- **未声明 `db_access.<name>` 的动态库默认拒所有人**（fail-closed）：`policy_for` 对未声明动态别名
  配 **`enforce=Deny` + 「声明且为空」的 `allow`**（空表 `allow` 是「不限制」，不能拿来表达拒绝），
  杜绝「登记即全员可查内网库」。要放开某动态库，必须显式写 `db_access.<name>.allow`（与静态库同形），
  或运行期 `db.access.grant`（见 §11.6.6）。
- **登记门 `asSystem()` 不豁免**（`identity` 不读 `ReqState.system`）；管理员通道请走 `allow.roles`。
- **开放端绝不回显凭据**：错误文案与 `list` 的 `dsn` 全经 `secret::redact`。
- **未知 scheme**：结构化错误（列已知 scheme 清单），**绝不伪造条目 / 绝不静默回落 sqlite**。

#### 11.6.4 限制（与 dbx 对齐时的边界）

- **框架不落盘（L4 关键边界）**：`register` 构造的实例只存在进程内存（`StableState` 的 `client_dbs` 是壳
  `Arc` + 内部 `Mutex`，不破不可变红线）；热重载保留同一 `Arc`（登记存活），**整进程重建（重启 / HUP）丢失**。
  框架**只提供实例化能力，不自动持久化**——没有 `db_client.persistence` 之类的自动落盘配置。
- **耐久登记由应用侧负责**：应用需跨重启保留时，在自己表里存 `(name, ENC[...] 密文 dsn)`（`secret.seal`
  密封，绝不存明文），启动初始化 handler 里逐条 `db.client.register` 重建（单条不可达 → 跳过 + warn，不 brick
  启动）。存储介质 / 加密 / 备份全是应用关切。
- **不跨进程**：本进程登记的别名，别的进程看不到；若都连同一真实 DB 并各自回放，语义一致（DB 实例本就是
  per-process 连接池）。
- **`max_entries` 封顶**：超过返回 `OJ_DB_CLIENT_FULL`。
- **`max_per_owner` 封顶（U-7）**：同一主体登记数达上限 → register 报
  `client db registry per-owner cap N reached (owner …); delete an alias before registering another`；
  delete 释放名额。
- **`max_streams` 全局预算（U-7）**：动态别名上的流游标总数达上限 → `db.stream` 报
  `db client stream budget exhausted (db_client.max_streams); close running streams or raise the cap`。
  permit 随流结束（自然/`signal`/`db.cancel`/close）自动释放。
- **与 L1 `enforce` 一致**：动态库未声明即 deny；声明后按 `db_access.<name>` 的档位走。

#### 11.6.5 错误码

| 文案 / 码 | 含义 | 修复 |
| --- | --- | --- |
| `reason: db_client_disabled` | `db_client.enabled=false` | 管理员开启 `db_client.enabled`。 |
| `reason: db_client_not_authorized` | 登记门 `allow` 未命中 | 找管理员在 `db_client.allow` 给对应维度授权。 |
| `already registered` | 重名登记 | 用 `reRegister` 替换或先 `delete`。 |
| `registry full (cap N)` | 超 `max_entries` | 调大 `max_entries` 或删旧条目。 |
| `not registered (use register to add)` | `reRegister` 目标不存在 | 先 `register`。 |
| `unknown db scheme in dsn '…' (known: […])` | DSN scheme 不在后端集 | 检查 scheme（sqlite:// / sqlite: / memory:// / mysql:// / postgres://）。 |
| `db access: … (reason: db_not_granted)` | 未声明 `db_access.<name>` 的动态库被查 | 在 `db_access.<name>.allow` 显式授权。 |

#### 11.6.6 运行期动态授权（`db.access`，U-1 v0.1.93）

`register` 只构造实例、实例**默认 deny**（见 §11.6.3「未声明 `db_access.<name>` 的动态库默认 deny」）。
要让某个**角色/主体**在**不重启**的前提下查该库，用 `db.access.grant` / `db.access.revoke`
（与 `db.client` **同特权门**——`db_client.enabled=false` 或 caller 不在 `db_client.allow` → 拒）：

```js
// 管理 handler：登记后立刻按角色放行（默认只读）
await db.client.register("rep", dsn);
await db.access.grant("rep", { roles: ["analyst"] });   // analyst 角色即可查，无需重启
await db.access.revoke("rep");                          // 撤回 → 回落 config（非删 config）
```

要点（与 dbx 对齐时务必讲清的边界）：

- **只注入放行维，绝不放松 config**：运行期 grant 只动 `allow`，不把 config 的 `read_only` /
  `max_rows` / `allow_ddl` / `allow_dangerous` 放开（防提权）。
  - config 未限制主体（`allow` 全缺省）→ grant **成为白名单**；并把 `off` 档抬到 `deny`，
    否则 `off` 档没有授权判定，grant 只是空操作。
  - config 已有白名单 → **逐维并集**（新角色追加进来，config 已授权的角色不被挤掉）。
  - `warn` / `deny` 档位本身不因 grant 改变（`warn` 仍只记日志不拒——要真拒请把档位设成 `deny`）。
- **`revoke` 回落 config，非删 config**：撤销的是运行期表项，别名回到 config 兜底；对纯 config 兜底项
  `revoke` **显式报错**（不静默），防越权/DoS 撤销他人静态授权。
- **grant 必须至少限制 allow 一维**：空 allow = 对全员放行，被 host 拒绝（运行时授权严禁全局放行）。
- **审计**：grant / revoke 落 `DB_ACCESS_AUDIT`（operator/module/tenant/source + allow 维），安全敏感度
  高于 register。
- **跨 isolate / 跨 handler 即时生效**：运行表是进程全局共享的，grant 后**任意** handler（含不同模块、
  不同 isolate）按名解析即吃到新策略。
- **改 `db_access` / `db_client` 配置段须重启**：该两段不在热更即时生效范围（StableState 不可变），改了会被标
  `restart_pending` 提示重启，不再静默盲区。运行期零重启改授权请用 `db.access.grant/revoke`。

#### 11.6.7 跨 isolate 失效（`db.epoch`，U-3 v0.1.93）

`db.client.delete` / `reRegister` 把别名的 `epoch` +1，`DB(name)` 每次调用比对 epoch 自动让 JS 侧缓存失效
（修复 cache-hit 短路——旧实现命中即返回、不再校验，删后还返回陈旧实例）。

```js
// 应用侧「随用随取」配方：缺失则回放登记；epoch 变化说明连接被删/轮换，重新回放
if (!db.client.has("rep")) await db.client.register("rep", dsn);
const ep = db.epoch("rep");   // host 权威；存起来下次比对，不一致 → 重新 register 回放
```

> **正确性不依赖 JS 持有的 epoch**：查询 op 始终按名从 host registry 重解析 accessor。即便恶意 handler
> 覆写缓存 epoch 跳过失效，也拿不到已删连接（host 直接报未登记）——U-3 的 epoch 只是优化 JS 缓存新鲜度，
> 不是安全边界。

### 11.6.3 语句级超时 + 结果集字节上限（REQ-05，v0.1.103）

```yaml
db_access:
  defaults:
    statement_timeout_ms: 30000    # 语句级超时上限；调用侧只能收紧
    max_result_bytes: 67108864     # 结果集字节上限（与 max_rows 并存，先到先生效）
    on_exceed: fail                # fail（缺省）| truncate
```

```js
await db.query(sql, params, { timeoutMs: 5000 });   // 只能 ≤ 配置；更大 → OJ_DB_CAPACITY 点名 statement_timeout_ms
await db.stream(sql, params, { timeoutMs: 600000 }); // pump 全程竞速（导出长档场景）
const it = db.stream(sql);                            // truncate 档的信令：
for await (const r of it) {...}
const inf = await it.info();                          // {rows, bytes, truncated}——结束后仍可读
```

- **覆盖面**：`db.query` / `db.exec` / `db.stream` / `db.table()` 构造器四条 pool 路径。
  tx / attach 会话路径不叠语句超时（连接状态不可知，维持会话寿命封顶口径）。
- **错误信封**：超时 → `OJ_DB_TIMEOUT`（`retryable=true`、`sessionDisposition=close`、
  `data={alias,timeout_ms,cancelled}`）；字节触顶（fail）→ `OJ_DB_CAPACITY`
  （`data={alias,limit_bytes,counted_bytes}`）。截断信令：raw/构造器走响应头
  `X-OJ-Result-Truncated: <counted>`；db.stream 走 `it.info().truncated`。
- **字节口径**：行 **JSON 编码字节**累加（≥ 线上原始字节，更严、确定性可测）。边拉边计：
  sqlite 内置触顶**真早停**（fetch 流 drop，连接随之关闭不复用）；把结果推过上限的那一行
  计入 `counted` 但不交付。
- **架构限制（诚实口径）**：
  - sqlite 内置的**单条 CPU 密集语句**（如同步步进的递归 CTE）会饿死 current_thread
    定时器——deadline 只能在驱动让步点触发。网络型后端（mysql/pg 插件轴，I/O 驱动）
    准点触发（env-gated 用例：`statement_timeout_matrix_pg_mysql`）。
  - 超时后 `data.cancelled` 按后端诚实标注（v0.1.114 口径）：**内置 sqlx 三方言
    （sqlite/mysql/pg DSN）= `true`**——取消/超时走 `close_on_drop()` 真关 TCP，
    服务端语句即死（连接关闭级语义）；**插件轴 = `false`**——宿主弃 FfiFuture 只 free
    state，语句可能仍在服务端跑（真取消 = ABI 13 车）。本车的护栏价值 = 调用侧准点
    拿到结构化超时 + 字节闸不再 OOM。
  - 未覆盖 metered 拉取的后端（内存 fake / 回落路径）字节计量为「拉完再计」：fail 仍拒、
    truncate 交付全量 + 信令照打（无 OOM 防线）。

## 11.6.4 任务式导出（U-18，v0.1.104）

`db.export`/`db.exportStatus`/`db.exportCancel` 三件：发起即返 taskId，自驱消费任务把
游标流式编码成 csv/jsonl 落 blob（`export/` 保留前缀，TTL 24h 宿主清扫，live 豁免）。
配置 `db_export:` 段（并发配额/字节上限/回落硬顶/TTL）；与语句超时的分工、重启 not
found 语义、错误≠策略双轨见 api-manual 限制表两行与 scenarios 场景 54。

## 11.7 安全审计（`audit:` 段 + `audit.query`，U-9 v0.1.98）

安全审计事件**统一出口**：`DB_CLIENT_AUDIT`（register/delete/reRegister）、`DB_CLIENT_DENY`
（配额/预算/拨号拒绝，U-7）、`DB_ACCESS_AUDIT`（grant/revoke，U-1）、`DB_SESSION_*`
（会话 begin/commit/rollback/timeout/discard，U-4——**reaper 后台判死也入库**）。
每条事件一个类型：`{tsMs, kind, user, tenant, module, source, alias, detail}`——**零凭据**
（只有 alias / 动作 / 前 8 字符 id，无 DSN 无密码）。

```yaml
audit:
  enabled: true           # 缺省开（有界环形、零凭据事件）；false 时只打日志不落存储。
  max_entries: 2000       # 环形缓冲上限（超限丢最旧）。0 拒启动。
  retention_secs: 86400   # 留存时长（超龄自动清理，push/query 双点清）。0 拒启动。
  allow: { roles: [auditor] }  # audit.query 的读取门（每调用重判）。缺省不限制 → 装配期 warn。
```

```js
const evs = await audit.query({ kind: "DB_SESSION_TIMEOUT", sinceMs: Date.now() - 3600e3, limit: 50 });
// → [{tsMs, kind, user, tenant, module, source, alias, detail}, …]（最新在前）
```

- **stderr 行归一**：所有事件统一打 `OJ_AUDIT: kind=… user=… tenant=… alias=… detail="…"`
  （v0.1.98 起，旧的 `DB_CLIENT_AUDIT:` / `DB_SESSION_*:` 散点前缀退役——**日志解析器需更新**）。
- **存储是进程内有界环形缓冲**：条数 + 年龄双限自动清理（无后台 reaper，push/query 顺带清）；
  **不跨重启**（进程退出即清零）。跨重启持久化 / 防篡改需接外部 sink（从 `audit::emit` 单一出口接，
  不散点）——登记为已知限制。
- **`audit.query` 即导出通道**：过滤器 `kind / user / tenant / alias / sinceMs / untilMs / limit`
  （缺省 100 条，硬顶 1000，最新在前）；handler 拿到 JSON 自行服务（CSV/下载/前端表格皆可）。
- **读取门**：`audit.allow` 四维并集（同 `db_client.allow` 形态），每个调用重判；缺省不限制
  （事件进程内、零凭据）——**生产应收紧**，装配期会 warn 点名。
- **与 `db.sqlProfile()` 的边界**：SQL 级画像（耗时/行数/成败/逐条 SQL）走 sql_trace 的 per-request
  出口（dev 画像，不进审计存储——全量 SQL 入库内存不可控）；`audit` 只收**安全事件**。

## 12. 延伸阅读

- [`docs/devkit/api-manual.md`](api-manual.md) —— 权威 API 参考（§6「db / DB(name)」
  含全量字段表与更多示例；§3「模块数据层」讲 schema/migrations 全流程）。
- [`docs/dev-guide.md`](../../dev-guide.md) —— 内部实现走读（bridge、装配、插件）。
- [`sample/`](../../sample/README.md) —— 可运行示例工程（`sample/config.yaml` +
  `sample/src/`，含 raw SQL 与构造器混用的真实 handler）。


## DB API 参考（自 `api-manual` §6 迁入，v0.1.93；db 的全部操作与相关内容统一在此）

> 本手册是 db 的权威参考：API 契约（签名、允许形态、报错文案）、查询构造器、SQL 执行追踪、
> 动态数据源登记（`db.client`）、运行期动态授权（`db.access`）、跨 isolate 失效（`db.epoch`）。
> 库级访问控制（`db_access:`）见 §11.5，动态登记的应用侧持久化配方见 §11.6。

### db / DB(name) —— 数据库

| API | 签名 | 说明 |
|---|---|---|
| `db.query` | `query(sql: string, params?: unknown[], opts?: DBCallOpts): Promise<Row[]>` | 参数化查询 → 行数组。`opts.timeoutMs` 语句超时；`opts.onOpen`/`opts.onProgress` 执行 id + 进度回调（v0.1.114，见 §3） |
| `db.exec` | `exec(sql: string, params?: unknown[], opts?: DBCallOpts): Promise<number>` | 参数化执行 → 受影响行数。opts 同 query |
| `db.stream` | `stream(sql: string, params?: unknown[], opts?: { onRow?: (row: Row) => void; signal?: AbortSignal; onOpen?: (executionId: string) => void; onProgress?: (ev: { rows: number; bytes: number; elapsedMs: number }) => void; timeoutMs?: number }): Promise<void> \| AsyncIterable<Row> & { executionId(): Promise<string> }` | **流式查询**（v0.1.37）。逐行拉取大结果集，避免一次性 `db.query` 全量驻留。**只走直连池**（`db.tx` 内会报错），且**只有部分后端真逐行拉取**（其余回落全量或直接报错，详见下节）。两种形态见下；`onOpen` / `executionId()`（v0.1.96）给跨请求取消句柄，见 §3.1 的 `db.cancel` 条目；`onProgress`（v0.1.114）行级进度（100ms 节流，`bytes` 在飞可查） |
| `db.cancel` | `cancel(executionId: string): Promise<{ cancelled: boolean; alias: string }>` | **跨请求取消执行**（v0.1.96；v0.1.114 起受理池执行）。`executionId` 来自 `db.stream` 的 `onOpen`/`executionId()`，或带 `onOpen` 回调的 `db.query`/`db.exec`。同一主体的任意请求可调；重复取消幂等；未知/已结束/他人 id 一律 `execution … not found`。流：取消后发起方下一次拉取抛 `… was cancelled via db.cancel`；池执行：reject `OJ_DB_CANCELLED`（`retryable=false`、`sessionDisposition=close`）。后端 pg/mysql 真杀（连接报废不回池），其余协作式 |
| `db.table` | `table(name: string): QueryBuilder` | 安全查询构造器（标识符白名单 + 参数化值） |
| `db.nextSeq` | `nextSeq(name: string): Promise<number \| string>` | **平台序列分配**（v0.1.24）。单语句原子取号，是 `max+1` 竞态的终态方案。首次使用自动建平台表 `_oj_sequences`。**库级、跨租户共享**——需隔离就把租户拼进 `name`；`name` 请用服务端常量；账号需 DDL 权限或由迁移预建该表；只在 sqlite/mysql/postgres 上可用（其他方言 `OJ_DB_UNSUPPORTED`）；`memory://` 假后端拿不到返回值（`no value returned`）。`db.tx` 内调用搭车同一连接 |
| `db.tx` | `tx(fn: (tx: DBInstance) => unknown): Promise<unknown>` | 事务（语义见下） |
| `db.asSystem` | `asSystem(): DBInstance` | 本请求以系统身份绕过租户防护（v0.1.15，仅 tenant.sql_guard 活跃时有意义；请求级生效 + 审计日志，业务 handler 禁用） |
| `db.asTenant` | `asTenant(id: string): DBInstance` | 匿名请求**声明**租户身份（v0.1.20）——仍强制租户条件，只是把 `tenant_id` 由 `id` 填充；需 `tenant.allow_as_tenant: true` 且请求为匿名（见下） |
| `DB(name)` | `(name: string) => DBInstance \| undefined` | 命名库实例；全部方法与 `db` 同签名 |
| `db.sqlProfile()` | `sqlProfile(): { count: number; totalMs: number; slow: Array<{sql,ms,db}>; byDb: Record<string,{count,ms}>; events: Array<{sql,params,db,inTx,source,ms,rows,ok,error}> }` | **SQL 执行追踪**（v0.1.51，dev 默认开）：本请求累计的 SQL 统计 + 慢查询 + 逐条事件；追踪关闭时返回空对象 |
| `db.dialect()` | `dialect(): string` | **连接引擎名**（v0.1.61）。供 `_shared` 共享模块（search/versions）与诊断分派方言 SQL；业务 handler 分支方言 = 放弃跨引擎可移植承诺，**慎用**。v0.1.88 起返回插件 `describe()` **声明的方言名**——此前是封闭三值枚举（未识别的 DSN 前缀被当作 sqlite 处理，`dialect()` 于是报 `"sqlite"`），现在原样返回真名。要判别「宿主是否替你生成 SQL」请比较 `"sqlite"｜"mysql"｜"postgres"` 白名单，而非假设不会出现其他值。**不得用它判断能力**：方言名是开放集，`if (d === "mysql") A else B` 会把 B 静默发给新方言——能力问题直接调用并接 `OJ_DB_UNSUPPORTED`，确需方言特有 SQL 时用白名单 + 响亮失败（scenarios 场景 45）。`db.tx` 回调对象同面（另有 `isTx: true` 标记事务域句柄——DDL 必须拒绝在此类句柄上执行） |
| `db.listTables` | `listTables(prefix?: string): Promise<string[]>` | **目录自省**（v0.1.82）。当前库全部业务可见表名，**含未登记 registry 的表**（api-only 方案 / 历史遗留表），按名称排序；可选前缀过滤（`%`/`_` 按字面量匹配，绑定参数）。sqlite 排除 `sqlite_*` 内部表；mysql/pg 经 information_schema 限当前库/schema。对**宿主认识的三种方言**同口径（SQL 文本引擎常量，不需业务分支）——其他方言 `OJ_DB_UNSUPPORTED`（`e.data.capability = "list_tables"`，v0.1.88）。替代「按方言分支 `information_schema` / `sqlite_master`」的裸 `db.query`。`db.tx` 回调对象同签名（搭车事务连接） |
| `db.listColumns` | `listColumns(table: string): Promise<Array<{ name: string; nativeType: string; nullable: boolean; default: string \| null; primaryKey: boolean }>>` | **列结构内省**（v0.1.90）。当前库单表的列信息，按声明序；`nativeType` 是方言**声明文本**（sqlite `type` / mysql `column_type` / pg `format_type`，零归一化），`default` 是原始 DDL 文本（sqlite 字符串默认带引号）；表名只经绑定参数。表不存在/不可见 → 空数组（不区分）。未知方言 `OJ_DB_UNSUPPORTED`（`e.data.capability = "list_columns"`）。`db.tx` 回调同签名 |
| `db.listIndexes` | `listIndexes(table: string): Promise<Array<{ name: string; unique: boolean; primary: boolean; origin: "c" \| "u" \| "pk"; columns: string[] }>>` | **索引结构内省**（v0.1.90）。`origin` 三方言统一为 `c`(普通) / `u`(唯一) / `pk`(主键)——UI 不再分支；`columns` 为已按序聚合的组成列。其余口径同 `listColumns`；能力缺失码 `list_indexes` |
| `db.listForeignKeys` | `listForeignKeys(table: string): Promise<Array<{ name: string \| null; columns: string[]; refTable: string; refColumns: string[] }>>` | **外键结构内省**（v0.1.90）。sqlite 外键无约束名 → `name` 为 `null`；复合外键 `columns[i]` ↔ `refColumns[i]` 按位配对。其余口径同 `listColumns`；能力缺失码 `list_foreign_keys` |
| `db.catalog` | `catalog(kind: "views" \| "routines" \| "sequences" \| "ddl" \| "comment" \| "constraints" \| "stats", arg?: string): Promise<{ kind: string; dialect: string; items: object[] }>` | **目录类内省**（U-14 批 a，v0.1.100；新一代信封——L2 三件保持裸数组不动）。`views`=清单+定义、`routines`=函数/过程清单、`sequences`=序列（mysql 为 auto_increment 模拟）、`ddl`=单对象源码（`arg`=对象名；v0.1.109 起 `ddl` 全量：pg 走**拼接器**（普通表还原 serial/identity/约束/索引/列注释+表注释；视图/物化视图原样 `pg_get_viewdef`；分区表（relkind 'p'）附 `PARTITION BY`（pg_get_partkeydef，子分区不产出）；序列等其余对象 → 空结果；30s 整体预算 + 行数触顶 `OJ_DB_CAPACITY`），mysql 走 `SHOW CREATE`（输出含 `AUTO_INCREMENT=<当前计数值>`，属实时计数器非纯定义））、`comment`=列注释（`arg`=表名）、`constraints`=PK/UQ/CHECK（`arg`=表名；FK 走 listForeignKeys）、`stats`=估算行数/大小（**只估算**，无全表扫描开关）。行数上限 1000。**能力矩阵**：sqlite 仅 views/ddl；mysql 全部（sequences 为 auto_increment 模拟；constraints 批 a 仅 PK/UQ）；pg 全部（sequences 原生；`ddl`=表/视图/物化视图）——**unsupported 报 `OJ_DB_UNSUPPORTED`（`e.data.capability`），不静默**。授权链同 L2（`granted_only`） |
| `db.ddlDiff` | `ddlDiff(spec: { objectType: "table"; name: string; from?: Structure \| null; to: Structure }): Promise<{ diff, statements }>` | **反向 DDL 渲染**（U-14，v0.1.109）。diff 为结构化四维比较（columns/constraints/indexes/foreignKeys × added/removed/changed，PR-9 比较视图直接渲染）；statements 有序可重放——DROP（FK→约束→索引→列）→ 列变更 → ADD → 约束/索引 → FK 最后；`from = null` → `CREATE TABLE`（主键内联）。**纯渲染器，零 DB I/O**；执行仍走 `db.exec` + `allow_ddl`。维度字段**缺省 = 不参与 diff；空数组 = 期望为空（出 DROP）**——省略 `indexes` 绝不生成 DROP INDEX 全家桶。方言差：pg 改类型产 `USING col::type`；mysql 位置差产 `AFTER`/`FIRST`（pg 无列位置 DDL → 忽略）；identity 列跳过 default 文本比对；**不生成序列对象**。verbatim 片段（nativeType/default/definition）拒含 `;`；标识符方言引号+翻倍（合法名可含非 ASCII/空格）。sqlite / 未知方言 → `OJ_DB_UNSUPPORTED`（`e.data.capability = "ddl_diff"`）。授权链同 L2（`granted_only`） |
| `db.allowed()` | `allowed(): Array<{ alias: string; dialect: string; read_only: boolean; allow_ddl: boolean; allow_dangerous: boolean; max_rows: number \| null; enforce: "off" \| "warn" \| "deny" }>` | **访问控制自省**（v0.1.89）。只列**当前调用主体有权限访问**的库别名及其能力位（按 alias 排序）；未授权的库不出现在列表里。管理员后台 / 数据面板的「库选择器」应以此为准，不要硬编码 `db:` 段的全部别名（那是**假入口**：列出来点了才报错）。同步 op；不执行任何 SQL。`db.tx` 回调对象同签名 |
| `db.client.register` | `register(name: string, dsn: string): Promise<ClientDbEntry>` | **动态数据源登记**（client 轴，v0.1.91）。运行期把 DSN 登记为命名数据源；登记后别名进入 `DB(name)` 解析路径（复用 L1 访问控制 + L2 内省 + 全 query/exec/stream），此处只暴露**管理面**。重名 / 超 `max_entries` 抛错。未配置的名字返回 `undefined` 的地方同理：`db.client` 仅在 `db`（即 `DB("default")`）存在时挂载 |
| `db.client.test` | `test(dsn: string): Promise<{ ok: boolean; dialect?: string; error?: string; serverVersion?: string \| null; probedAtMs?: number }>` | 试连（**不落库**）；返回 `{ok, dialect?, serverVersion?, probedAtMs?, error?}`（U-11：探测成功即带版本） |
| `db.client.reRegister` | `reRegister(name: string, dsn: string): Promise<ClientDbEntry>` | 替换已登记连接（不存在则抛 `not registered`） |
| `db.client.delete` | `delete(name: string): Promise<boolean>` | 删除数据源；**自动驱逐 `DB()` 缓存**（否则删后再 `DB(name)` 拿到陈旧实例）；返回是否删除成功 |
| `db.client.list` | `list(): Promise<ClientDbEntry[]>` | 列出全部已登记数据源（`dsn` 已脱敏：`user:pass@` → `***`） |
| `db.client.has` | `has(name: string): boolean` | 是否已登记（同步；探活用，不经过登记门） |
| `db.access.grant` | `grant(name: string, allow: { modules?, roles?, tenants?, sources? }, opts?: { readOnly?: boolean }): Promise<{ ok: boolean; alias: string; readOnly: boolean; allow: object }>` | **运行期动态授权**（U-1，v0.1.93）。把别名 `name` 的**放行维**（角色/主体四维并集）注入运行表，无需重启即对被授权主体放行（默认 `readOnly=true`）。与 `db.client` **同特权门**（`db_client.allow` 四维并集、`enabled=false` 时拒）——不是人人可授权的入口。详见下「库级访问控制 · 运行期动态授权」 |
| `db.access.revoke` | `revoke(name: string): Promise<boolean>` | **撤销运行期动态授权**（U-1，v0.1.93）。只接受**运行期表项**；若别名仅有 config 兜底（无运行期 grant）则**显式报错**（不静默）；撤销后该别名**回落 config**（非删 config）。与 `grant` 同特权门、同审计 |
| `db.epoch` | `epoch(name: string): number` | **连接世代号**（U-3，v0.1.93；host 权威）。取别名当前 epoch；`db.client.register/reRegister/delete` 各 +1。用于跨 isolate 探测连接是否被删/轮换——与上次见过的值不一致即说明已失效。只读、无特权 |

> **业务 SQL 写法红线**：业务读写优先用 `db.table` 构造器（见下「查询构造器」），由服务端按目标方言自动生成 SQL，从而获得**多库 / 跨引擎迁移能力**；仅在构造器不支持的语句（DDL、部分非 CRUD 语义）才退回 `db.query` / `db.exec`，且仍须用 `?` 绑定参数、避免方言特有语法。

#### 动态数据源登记（`db.client`，client 轴，v0.1.91；实例化能力 L4 v0.1.92）

运行期把任意 DSN 登记为**命名数据源**，对齐 dbx 的「运行期增删连接」。登记后别名直接进入
`DB(name)` 解析路径，**复用 L1 访问控制（§`db_access`）+ L2 结构内省 + 全部 query/exec/stream**——
**不另起平行的 `db.client.query` API**（使用面一律走 `DB(name)`）。连接经与装配期**同集**的
`DbBackendRegistry`：`sqlite` / `memory` 内置，`mysql` / `postgres` 由插件注册。

**建模视角（L4）**：`db.client.register(name, dsn)` 即 **构造一个 DB 实例实体**（`db = new DB(name, dsn)`）——
`register` / `reRegister` / `delete` 是其实例的**生命周期**（构造 / 替换 / 销毁），`list` / `has` / `test`
是探活面。框架**只提供实例化能力**；**落盘持久化由应用侧负责**（见下「耐久登记」）。

**配置（`db_client:`）**：

```yaml
db_client:
  enabled: true            # 默认 false（fail-closed）；false 时全部 db.client.* 拒。
  max_entries: 16          # 单进程连接池硬上限（=0 装配期 fail-loud 拒启动）。
  allow:                   # 登记门：谁能调 register/test/delete/reRegister/list。
    roles: [dba]           # 四维并集；任一命中即放行，全缺 = 不限制。
    sources: [task]
```

- **装配期 fail-loud**：`enabled=true` 且 `allow` 四维全缺（无限制）→ **拒启动**（防「开了忘配」全开，
  SSRF / 内网横向移动面）；`max_entries==0` 同样拒启动。
- **登记门 `asSystem()` 不豁免**（`identity` 不读 `ReqState.system`）；管理员通道走 `allow.roles`。
- **使用面走 `DB(name)`**：`DB("rep").query(...)` 与静态库完全一致（访问控制 / 内省 / 流 / 计数复用）。
- **`delete` 自动驱逐 `DB()` 缓存**：已内建，业务无需手动做；漏做会读到陈旧实例。
- **`dsn` 全脱敏**：`user:pass@` → `***`；连接失败错误同样脱敏。
- **审计**：register / delete / reRegister 落 `DB_CLIENT_AUDIT`（operator/module/tenant/source）。
- **未声明 `db_access.<name>` 的动态库默认 `deny`**（fail-closed）：要放开必须显式写
  `db_access.<name>.allow`（见下「库级访问控制」）——否则任何人可查该内网库。
- **框架不落盘（关键陷阱，L4）**：`register` 构造的实例是**进程内存**的，`register` 后热重载保留、`kill -HUP`
  / 重启整进程重建后**丢失**（与 L3 一致）；不跨进程。`max_entries` 封顶。需要**跨重启耐久**的登记，由
  **应用侧**负责——应用在自己的表里存 `(name, 密文 dsn)`（`ENC[...]` 密封，复用 `secret.seal`，绝不存明文），
  在启动初始化 handler 里逐条 `db.client.register` 重建（单条不可达 → 跳过 + warn，不 brick 启动）。
  框架**不**提供 `db_client.persistence` 之类的自动落盘配置；存储介质 / 加密 / 备份都是应用关切。

**运行期动态授权（`db.access`，U-1 v0.1.93）**：`register` 只是「构造实例」，实例**默认 deny**（见上「未声明 `db_access.<name>` 的动态库默认 deny」）。要零重启地让某个**角色/主体**能查该库，用 `db.access.grant` 注入运行期放行维：

```js
// 让 role=analyst 的主体可查刚登记的 rep 库（默认只读）。
await db.access.grant("rep", { roles: ["analyst"] });
// 之后任意 handler 里 DB("rep") 对 analyst 角色即可通，无需重启。
// 放行所有人（空 allow）→ 被 host 拒（运行时授权严禁对全员放行）。
await db.access.grant("rep", {}); // 抛错：allow must restrict at least one dimension
```

- **与 `db.client` 同特权门**：`db_client.enabled=false` 或 caller 不在 `db_client.allow` → 拒（`reason: db_client_disabled` / `db_client_not_authorized`）。授权是特权操作，不是人人可调用。
- **只注入放行维，不放松 config**：运行期 grant 只动 `allow`，不放开 config 的 `read_only` / `max_rows` / `allow_ddl` / `allow_dangerous`（防提权）。config 未限制主体（`allow` 全缺省）时 grant **成为白名单**并把 `off` 档抬到 `deny`；config 已有白名单时按**逐维并集**追加（不挤掉 config 已授权的角色）。
- **`revoke` 回落 config，非删 config**：撤销的是运行期表项；该别名回到 config 兜底策略。对已无运行期表项的别名（纯 config 兜底）`revoke` 显式报错（不静默），防越权/DoS 撤销他人静态授权。
- **必须授权给「角色/主体」**：`allow` 必须至少限制一维（`modules` / `roles` / `tenants` / `sources`）；空 allow = 对全员放行，被 host 拒绝。
- **审计**：grant / revoke 落 `DB_ACCESS_AUDIT`（operator/module/tenant/source + allow 维），安全敏感度高于 register。
- **跨 isolate / 跨 handler 即时生效**：运行表是进程全局共享的，grant 后**任意** handler（含不同模块、不同 isolate）按名解析即吃到新策略。

**跨 isolate 连接失效（`db.epoch`，U-3 v0.1.93）**：`db.client.delete` / `reRegister` 会把别名的 epoch +1，`DB(name)` 每次调用比对 epoch，自动让 JS 侧缓存失效——但**正确性不依赖 JS 持有的 epoch**：查询 op 始终按名从 host registry 重解析 accessor。即便恶意 handler 覆写缓存 epoch 跳过失效，也拿不到已删连接（host 直接报「未登记」）。应用侧「随用随取」配方：`has()→缺则 register 回放` 配合 `db.epoch` 即可保证多实例一致。

**`ClientDbEntry`**（`db.client.list()` 元素）：`{ alias, dialect, dsn, registeredBy, registeredAtMs, serverVersion, probedAtMs, queries }`
——`serverVersion`（U-11，v0.1.100）：connect 后一条版本查询（3s 超时；**失败/开放方言 = null，
降级不阻断登记**）；`probedAtMs` 探测时刻。主力消费者是内省 golden 快照定位与排障；静态库不透出。
（`dsn` 已脱敏；`queries` 是经 `lookup` 自动累加的命中计数）。

**错误码**：`OJ_DB_CLIENT_DISABLED`（`reason: db_client_disabled`）／
`OJ_DB_CLIENT_NOT_AUTHORIZED`（`reason: db_client_not_authorized`）／`OJ_DB_CLIENT_FULL`
（`registry full (cap N)`）／`OJ_DB_CLIENT_EXISTS`（`already registered`）／
`OJ_DB_CLIENT_NOT_REGISTERED`（`not registered (use register to add)`）／
`OJ_DB_UNSUPPORTED`（`unknown db scheme in dsn '…' (known: […])`，绝不回落 sqlite）。

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

> **专题指南**：SQL 构造器的**能力矩阵、三方言语义差异**（受影响行数 / `orIgnore` / `fromSelect`
> / 字面量列 `CAST` / 模糊搜索转义）、**红线与逃生舱**、**从 `db.query` 迁移路径**，统一见
> **`sql-builder-guide.md`**。本章只列 API 契约（签名、允许形态、报错文案）。

- **业务优先用构造器**：业务读写应优先用 `db.table(...)` 构造器，而非手写 `db.query` /
  `db.exec` 裸 SQL。构造器按目标方言（sqlite/mysql/postgres）**自动生成正确 SQL**，业务无需
  关心方言差异，同一份 handler 可在多库 / 跨引擎间迁移；**仅当构造器不支持的语句（DDL、部分非
  CRUD 语义）才退回 `db.query` / `db.exec`**，且仍须用 `?` 绑定参数、避免方言特有语法。

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
  操作符：`eq / ne / gt / gte / lt / lte / in（值须非空数组）/ like / isnull / contains / startswith / endswith`；
  未知操作符直接报错。**`eq`/`ne` 省略 `value` 渲染成 `= NULL` / `<> NULL`——三值逻辑下恒不成立，
  判空请用 `isnull`**；`in` 传空数组直接拒（`in needs non-empty array`，`IN ()` 会静默 0 行）。
  `contains` / `startswith` / `endswith` 是**语义化模糊匹配**（转义与
  `like` 逃生舱口径见 `sql-builder-guide.md` §3.5）：
  业务层零转义负担、零方言知识，引擎自动把 `%` `_` `!` 转义后渲染 `LIKE ? ESCAPE '!'`。
- `OrderByItem`：`{ field: string; dir?: "asc" | "desc" | null }`。
- **`select(["*"])`（v0.1.81）**：显式拉全列。必须是唯一元素
  （`select(["*", "id"])` 直接报 `select '*' must be the only column`）；**带 join 时直接报错**
  （`select '*' is not allowed with joins`）——全列展开只出基表列，业务拿 join 列做授权判断会拿到 `undefined`。
- **`whereIf(test, cond)`（v0.1.81）**：条件化 where。`test` 为 `undefined` / `null` / `false` /
  **空数组 `[]`** 时整条跳过；`0` 与 `""` 照常保留（它们是合法过滤值，例如 `status = 0`）。
  用来把「可选筛选」写成一行而不用 `if (x) q.where(...)`：
  ```ts
  db.table("order")
    .whereIf(id, { field: "id", op: "eq", value: id })        // id 为假值→跳过
    .whereIf(ids && ids.length, { field: "id", op: "in", value: ids });  // 空数组→跳过（避免 IN () 静默 0 行）
  ```
- **红线**：标识符（表/列/别名）只来自 SchemaRegistry 白名单（启动内省所得），值一律经绑定参数。
  SQL 注入面为零；未知表/列报错，排序列另有可排序白名单。`limit` 缺省 100；显式 limit 被
  `db_query.max_limit` clamp（**默认 1000**，可配至硬顶 **100000**）。
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

**模糊搜索（v0.1.81）——`contains` / `startswith` / `endswith`**：

```ts
await db.table("user").where({ field: "name", op: "contains", value: "100%" }).all();
// → WHERE name LIKE ? ESCAPE '!'  with param '%100!%'  （业务零转义，% 被当字面量）
await db.table("order").where({ field: "code", op: "startswith", value: "AB_" }).all();
// → LIKE 'AB!_%' ESCAPE '!'
await db.table("file").where({ field: "path", op: "endswith", value: ".log" }).all();
// → LIKE '%\.log' ESCAPE '!'  （注意 . 也被转义，不会匹配任意字符）
```

- 语义：`contains` ⇒ `%v%`、`startswith` ⇒ `v%`、`endswith` ⇒ `%v`；引擎自动转义 `%`/`_`/`!`
  并渲染 `LIKE ? ESCAPE '!'`，业务零转义、零方言知识。转义原理、`like` 的 `escape` 逃生舱
  （白名单 `! / | ~ # @`、显式拒 `\`）、`in` 空数组守卫的口径，统一见
  `sql-builder-guide.md` §3.5。

**join 联表（v0.1.81 支持表别名与 ON 值条件）**：

```ts
await db.table("account")
  .join("user", [{ left: "account.user_id", right: "user.id" }], "left")
  .select(["account.id", "user.name"])
  .all();

// ON 值条件（v0.1.81）：列对列 + 列对常量混合
await db.table("receipt").as("r")
  .join("broadcast", [{ left: "r.broadcast_id", right: "b.id" },
                      { left: "r.user_id", op: "eq", value: uid }], "left", "b")
  .all();
// → ... JOIN broadcast b ON r.broadcast_id = b.id AND r.user_id = ?
```

- `on` 条目两形：`{left, right}`（列=列）或 `{left, op, value}`（列 `<比较op>` 值）。可混合
  出现在同一 `on` 数组。列可写 `"表.列"`（表 ∈ 基表 ∪ join 表）或裸列名（只解析基表，歧义拒）。
- `op` 限**比较类**（`eq/ne/gt/gte/lt/lte/in` 等）；`contains`/`startswith`/`endswith`/`isnull`
  等模式/空值类 op 在 ON 值条件里直接拒绝（`join on 'r.user_id' takes a compare op, not 'contains'`）。
  `value` 过 `encodeParams`（BigInt 标记不丢）。
- 第 4 参数 `alias` 给**被 join 的表**起别名；基表别名用 `db.table("x").as("b")`（v0.1.81）。
  别名只用于列限定，**归属感/租户守卫始终按真名生效**（见下「表别名与归属/租户守卫」）。
- `kind` 省略为 `inner`，可选 `left`。自 join 现已放开（基表/被 join 表均可别名）。
- `select(["*"])` 与 join 互斥（全列展开只出基表列，join 列会丢）。

**表别名与归属/租户守卫（v0.1.81）**：

- `db.table("x").as("b")` 让基表以别名 `b` 出现（列限定写成 `b.col`）；`join` 的第 4 参数给被
  join 表起别名。别名**只作用于列限定与 SQL 渲染**；归属/租户守卫始终按**真名**生效（此前
  「别名混入真名」会让两条守卫同时静默失效的缺陷已修，背景见 `sql-builder-guide.md` §3）。
- 表别名形状与聚合/CTE 等其他别名位**同一道门**（v0.1.83）：`^[A-Za-z_][A-Za-z0-9_]*$`，
  违例（含空串 `.as("")`）在请求反序列化期报 `illegal alias '<a>'`——此前表别名不做校验，
  空串/怪形会漏到 SQL 渲染，换回一句看不懂的 DB 原生报错。
- 别名**只支持 select / join**：`update` / `delete` 带别名直接报
  `table alias is not supported on insert/update/delete`（mysql 的 `DELETE FROM t AS b` 需
  8.0.16+，跨引擎不保证，故构造器直接拒）。

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

- 聚合列 `{ fn: "count"|"sum"|"avg"|"min"|"max", field?: string, as?: string, distinct?: boolean }`；
  别名形状 `^[A-Za-z_][A-Za-z0-9_]*$`（违例报 `illegal alias`）。
- **`count(distinct col)`（v0.1.82）**：`{ fn: "count", distinct: true, field: "user_id", as: "c" }`
  → `COUNT(DISTINCT user_id)`，聚合一行返回、不受 LIMIT 钳制。仅 count 支持
  （其他聚合带 `distinct` 报 `distinct is only supported on count`）；必须带具名 `field`
  （缺省或 `"*"` 报 `count distinct needs a field`）。**别再**用 `distinct().all()` 拉行后
  `.length` 计数——顶层 select 隐式 LIMIT 会静默截断（受影响用户数 >1000 即漏算）。
- `having` 白名单列优先，未命中按 select 聚合别名展开（`unknown column '...' in having`）。
  PG 不允许 HAVING 引用输出别名，展开能消灭方言分叉；orderBy 不支持聚合别名（仍走列白名单）。
- `.distinct()` 去重（仅 select）。

**DML：insert / update / delete / truncate**（`.run()` 终执行，返回受影响行数；`.all()` 仅 select）：

```ts
await db.table("user").insert({ name: "neo", age: 1 }).run();        // 单行
await db.table("user").insert([{ name: "a" }, { name: "b" }]).run(); // 多行（键集须一致）
await db.table("user").update({ age: 2 }).where({ field: "id", op: "eq", value: 1 }).run();
await db.table("user").delete().where({ field: "id", op: "in", value: [1, 2] }).run();
await db.table("sys_login_throttle").truncate().run();               // 整表清空（v0.1.82）
```

- **红线**：`update`/`delete` 必须带 where 且叶子数 ≥ 1。JS 链层早抛（`update requires where`），
  op 侧同样强制——`fromJSON` 可完全绕过 JS 链层，所以动词×字段矩阵以 **op 侧校验为权威**。
  **唯一例外是 `truncate()`（v0.1.82）**：明示的整表清空，取代「退回裸 `db.exec("delete from …")`」。
- **`truncate()`（v0.1.82）**：无 where 的显式清空，渲染 `DELETE FROM t`（三方言通用——sqlite 无
  TRUNCATE 语句，sea-query 的 TruncateStatement 不可移植）。**租户守卫照常注入**：租户表上只清
  **当前租户**的行（真整库清空在 `db.asSystem` 下执行）；非租户表 / 系统态 = 整表清空。自带
  where 报 `truncate does not accept where`（带条件的清空用 `delete`）；`update` 携带 truncate
  报 `update does not accept truncate`。
- 动词×字段矩阵（op 侧权威）：`insert` 拒 `where/orderBy/limit/offset/joins/distinct/groupBy/
  having/unions/with/columns`，`values` 与 `from_select` **二选一**（都给报
  `insert takes either values or fromSelect, not both`，都空报 `insert needs either values or
  fromSelect`）；`update`/`delete` 拒 `joins/columns/returning/distinct/groupBy/having/unions/
  with/limit/offset/orIgnore/fromSelect`（`truncate` 仅 delete 承载，`update` 带它报
  `update does not accept truncate`）；`select` 拒 `values/sets/returning/orIgnore/fromSelect`。
  `update`/`delete` 共用拒绝分支，违例文案的动词字样是字面 `update/delete`（如
  `update/delete does not accept returning`），其余为 `insert` / `select`。
- insert 键 / update 键均过白名单（`unknown column '<k>' in insert values / update sets`）。
- 表别名只用于 select/join（见上）：`insert/update/delete` 带 `.as(...)` 直接报
  `table alias is not supported on insert/update/delete`。
- `db.tx` 内构造的 DML 自动走事务同连接（见下）。

**幂等写入（v0.1.81）——`orIgnore()` 与 `fromSelect(q, cols)`**：

```ts
// 撞主键/唯一键则跳过（不报错、不写入），用于「已存在就忽略」的幂等导入
await db.table("notify").insert({ id: 1, user_id: uid }).orIgnore().run();

// INSERT ... SELECT：从一张查询的结果批量写入（两列列表按位置对齐）
await db.table("notify_daily").fromSelect(
  db.table("notify").select(["user_id", "cnt"]).where({ field: "day", op: "eq", value: d }),
  ["user_id", "cnt"],
).run();
// 也可叠加 .orIgnore()：fromSelect(...).orIgnore().run()——**sqlite 除外**（见下）
```

- **`orIgnore()`**：撞主键/任意唯一键的行被跳过。sqlite / postgres 渲染 `ON CONFLICT DO NOTHING`；
  mysql 走 `ON DUPLICATE KEY UPDATE <pk> = <pk>`（恒等式、命中冲突即跳过），**要求表有主键**——
  无主键表报 `orIgnore on mysql requires a primary key on table '...'`。**mysql 上别把
  `orIgnore()` 和 `returning(['id'])` 组合**：恒等赋值不会刷新 `LAST_INSERT_ID()`，跳过重复行时
  两步取 id 会拿到该连接上的旧值——要「幂等 + 拿到 id」就先用唯一键 `select` 出 id（或改用普通
  `insert` 并接 `OJ_DB_CONSTRAINT`）。**三方言 affected-rows
  不一致**（mysql 命中重复键返回匹配行 1，pg/sqlite 返回 0），勿用 `if (n === 1)` 判幂等——
  口径与「为什么不用 `INSERT IGNORE`」见 `sql-builder-guide.md` §3.2。
  **sqlite 上 `orIgnore()` 与 `fromSelect()` 不可组合**（v0.1.82 明文）：报
  `orIgnore with fromSelect is not supported on sqlite (its upsert clause only follows VALUES)`
  ——sqlite 的 upsert 子句只能跟在 VALUES 之后（引擎在构造期显式拒绝，pg / mysql 的
  ON CONFLICT / ON DUPLICATE KEY 支持 SELECT 源，不受限）。绕行：裸
  `db.exec("insert or ignore into … select …", [...])`（注意 sqlite 的 `OR IGNORE` 会把
  NOT NULL / CHECK 违例**一并静默跳过**，数据面比 ON CONFLICT 宽，自行权衡），或先查后插。
- **`fromSelect(q, cols)`**：`q` 是另一个 `db.table(...)` 构造器（或纯 JSON 请求）；`cols` 是目标
  表写入列、与 `q` 的 select 列**按位置一一对齐**。列数不符报
  `insert declares N columns but the source select yields M`；`cols` 为空报
  `insert fromSelect needs insert columns`；`values` 与 `fromSelect` 二选一。`cols` 含 `tenant_id`
  直接报 `fromSelect must not declare tenant column 'tenant_id'`（tenant 由服务端按当前租户注入）。
  **两条守卫都递归源 select**：租户注入 v0.1.81 已覆盖；**归属守卫 v0.1.83 起同样覆盖**——
  `ownership_guard: deny` 下源表不在本模块或 `deps:` 声明内即拒（报错同跨模块表访问），堵住
  「`insert into 我的表 select * from 别人的表`」这条此前绕过归属守卫的搬运通道。
- `db.tx` 内构造的 DML 自动走事务同连接（见下）。

**受影响行数的三方言语义**：`run()` 返回值 = WHERE **匹配行数**，三方言在 oj 运行时上一致（mysql
协商 `CLIENT_FOUND_ROWS`）。「用行数判行存在 / 归属」只在匹配语义下成立，跨连接方式即翻车——正确
姿势是**先断言再写、行数不读**（示例见 `sql-builder-guide.md` §3.1）。三方言完整对照表与
`orIgnore` 的 affected-rows 差异，见 `sql-builder-guide.md` §3.1。

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

**case 列 / 窗口函数列 / 字面量列**（select 列的对象形）：

```ts
await db.table("account").select([
  "id",
  { case: { when: [
      { cond: { field: "balance", op: "lt", value: 0 }, then: "debt" },
      { cond: { field: "vip", op: "eq", value: 1 }, then: "vip" },
    ], else: "normal" }, as: "level" },          // → CASE WHEN ... THEN ? ... ELSE ? END
  { window: { fn: "row_number", partition_by: ["user_id"],
      order_by: [{ field: "amount", dir: "desc" }] }, as: "rn" },
  { lit: "svc", as: "scope" },                    // → 'svc' AS "scope"（按方言 CAST，见下）
]).all();
```

- **字面量列（v0.1.81）**：`{ lit: <值>, as: "<别名>" }` 把常量作为一列输出。值走**绑定参数**
  （永远不会拼进 SQL 文本），并按目标方言做类型转换——sqlite 裸 `?`、mysql `CAST(? AS CHAR)`、
  postgres `CAST(? AS TEXT)`。用途：给结果打固定标记列（如 `scope = 'svc'`）、与真实列拼接。
  - `lit` 必须是**标量**（数组/对象/嵌套报 `lit column '<as>' needs a scalar value
    (string/number/bool/null)`）；`as` 必填且过别名形状
    （`^[A-Za-z_][A-Za-z0-9_]*$`，违例 `illegal alias`），与 `*` 混用报
    `select '*' must be the only column`（`*` 只能独占一列）。
  - **真正的计算列请用 `case`**：`{case:{when:[...],else:...},as:"x"}` 已支持条件表达式；
    `lit` 只承载常量，不承载表达式。注意 op 拼写是 `isnull` 不是 `isNull`。
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

- 层数上限 **3 层嵌套**（内部 `REQ_NEST_MAX = 4`，顶层算 depth 0，第 4 层即
  `<site>: nested select too deep`，site 为出错位置）；嵌套必须 select
  （`<site>: nested select must be select`）；嵌套禁 with/unions
  （`<site>: nested select does not accept with/unions (v1)`）。
- 隐式默认 limit 只作用于**顶层**查询；嵌套/成员不隐式截断（显式 limit 一律生效）。
  默认值由 `db_query.default_limit`（默认 100）给出，显式 limit 被 `db_query.max_limit`
  （默认 1000）clamp；两者均可在配置中调整（硬顶 100000）。顶层结果为数组且行数 ≥ 生效
  上限时，响应带 `X-OJ-Row-Limit: <上限>` 头提示可能被截断。

#### 流式查询 db.stream（v0.1.37）

> **两条限制（动手前先看）**：
> 1. **只走直连池**：在 `db.tx` 内调用报
>    `db.stream within an active transaction is not supported (streaming queries run on the connection pool only)`
>    ——先 `db.query` 取 id 集，或把流式挪到事务外。
> 2. **不是所有后端都真逐行拉取**，分三档：
>    - **真流式**（逐行推）：核心 sqlite / mysql / postgres 连接，以及 `oj-db-mysql` /
>      `oj-db-postgres` 两个插件后端——大表遍历内存恒定。
>    - **回落全量**（v0.1.38 起）：插件**未声明** `stream`（或旧插件返回
>      `{"unsupported":true}`）时，宿主改成一次取全量——**结果与 `db.query` 完全一致，
>      不报错，只是内存优势没了**。反过来「未声明却真提供了流」宿主采信 + warn（插件该补
>      `"stream"`）。
>    - **彻底不支持**：进程内后端若未实现 `stream_query`（默认实现），报
>      `backend does not support streaming`；插件**声明了** `stream` 却回 unsupported 是能力
>      契约违规，报结构化 `OJ_DB_UNSUPPORTED`（`e.data.capability = "stream"`）。两种都请换
>      `db.query` 分页。
>
>    想确认走的是哪一档：真流式的耗时随结果集分批推进（边收边出），回落全量的耗时会
>    在首行之前一次性卡住。


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
- **后端能力分三档**（v0.1.38 起，见本节开头的「两条限制」）：核心 sqlite / mysql /
  postgres 连接与 `oj-db-mysql` / `oj-db-postgres` 插件后端**真流式**；没有逐行能力的后端
  **回落 `db.query` 全量**（行为一致、不报错，仅失去内存优势）；彻底不支持的报
  `backend does not support streaming`。
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
- **专用连接并发上限 8**（v0.1.84，mysql / postgres 的 typed 直连路径）：每条游标独占一条
  池外连接（真取消语义的前提），并发超限 **fail-loud**：
  `db stream_open: too many concurrent cursors (limit 8) — close or cancel running streams first`
  ——此前无上限，并发大结果集可打满服务端 `max_connections`（此后连池查询一并失败，全库
  不可用）。游标收口（done / err / cancel / close）即释放配额；Any 回退路径走池、不占闸。

**结构化数据库错误**（v0.1.88，ABI 12）：`db.*` 的失败不再是「只能读文案的字符串」。所有
数据库 op（含构造器、`db.tx`、`db.stream`）reject 的 Error 都带四个结构化自有属性：

| 属性 | 类型 | 说明 |
|---|---|---|
| `e.message` | `string` | 人类可读原文（既有方言的文本**保持原样**；宿主不再叠 `ffi <op>: ` 前缀） |
| `e.code` | `string` | 稳定错误码，见下表 |
| `e.retryable` | `boolean` | 该错误**重试是否有意义**（如死锁/超时可重试，唯一键冲突不可）。已是布尔，无需再解析 |
| `e.sessionDisposition` | `"keep" \| "reset" \| "close"` | 会话处置：`keep` 连接可继续用；`reset` 需重置会话状态；`close` 应丢弃该连接 |
| `e.data` | `object` | 附加数据（**已解析为对象**，不是 JSON 串）：`data.vendor_code` 为引擎原始错误码（mysql 数字如 `1062`、pg SQLSTATE 串如 `"22012"`）；能力缺失时另有 `data.capability` / `data.dialect` |

`e.code` 取值：

| code | 含义 | 典型来源 |
|---|---|---|
| `OJ_DB_SYNTAX` | SQL 语法 / 对象不存在 | SQLSTATE 42xxx、mysql 1064 |
| `OJ_DB_CONSTRAINT` | 约束冲突（唯一键/外键/非空） | SQLSTATE 23xxx、mysql 1062 |
| `OJ_DB_TIMEOUT` | 超时（含连接池等待超时） | SQLSTATE 40xxx、`PoolTimedOut` |
| `OJ_DB_CONNECTION` | 连接失败/已断开 | SQLSTATE 08xxx、io/tls 错 |
| `OJ_DB_CAPACITY` | 容量/资源耗尽 | SQLSTATE 53xxx |
| `OJ_DB_CANCELLED` | 查询被取消 | SQLSTATE 57xxx、流取消、`db.cancel` 取消池执行（v0.1.114） |
| `OJ_DB_UNSUPPORTED` | **该方言不支持这个能力** | 查询构造器 / `listTables` / `nextSeq` / `search.*` / `migrate` / `seed` 遇到宿主未识别的方言 |
| `OJ_DB_INTERNAL` | 其余（含未知厂商码） | 未映射的错误 |

`OJ_DB_CANCELLED` vs `OJ_DB_TIMEOUT`（v0.1.114 区分口径）：两者都是「语句没跑完」，
但 **CANCELLED = 有人（`db.cancel`/挂断联动）要它停**——`retryable=false`
（重试是抗超时/死锁的，对主动取消无意义）、`sessionDisposition=close`（被取消的
连接已报废）；**TIMEOUT = 资源预算到点**（`statement_timeout_ms`）——`retryable=true`
（语句本身可能健康，换一个时间窗重试合法）。业务分流按 `retryable` 即可，勿按
文案猜。

`OJ_DB_UNSUPPORTED` 的 `e.data.capability` 取值（**闭集**，可安全 switch）：
`query_build` / `query_sql`（构造器 `.all()/.run()` 与 `.toSQL()`）、`list_tables`、
`list_columns` / `list_indexes` / `list_foreign_keys`（结构内省三 op，v0.1.90）、
`next_seq`、`migrate` / `seed`（CLI 侧，不进 JS 运行时）、`stream` / `cancel`（插件声明了
能力却回 unsupported = 契约违规）。同一错误另有 `e.data.dialect` = 声明名。

```js
try {
  await db.table("account").insert({ id: 1, name: "neo" }).run();
} catch (e) {
  if (e.code === "OJ_DB_CONSTRAINT" && e.data.vendor_code === 1062) {
    json.fail(409, "account already exists"); return;
  }
  if (e.retryable && e.sessionDisposition === "keep") {
    /* 可以安全重试（如死锁） */
  }
  throw e;
}
```

> **升级注意（v0.1.88）**：ABI 11 及以前，db 错误的 message 前面会再叠一层宿主前缀，形成
> `ffi db query: db query: <引擎原文>` 的**双前缀**；现在只保留 `db query: <引擎原文>`。
> 若你在 catch 里匹配过 `^ffi db `，改成匹配主体前缀即可；不要去解析 `e.message`——
> 用 `e.code` / `e.data.vendor_code` 判别。

> **方言边界**：宿主只对 **sqlite / mysql / postgres** 生成 SQL（构造器、`listTables`、
> `nextSeq`、`migrate`/`seed`）。其他方言（插件声明 `describe()` 里的
> `dialect`）上一期只开放**裸 SQL 路径**（`db.query` / `db.exec` / `db.stream` / `db.tx`），
> 构造器类 API 一律 `OJ_DB_UNSUPPORTED`（`data.capability` 点名是哪个 API）——不会再
> 悄悄按 sqlite 语义生成错误 SQL。sample 的 `_shared/search`、`_shared/versions` 是**模块
> 自带的**方言白名单（不是宿主门控），抛同码但 `data.capability` 为 `search` / `versions`。
>
> **别用 `db.dialect()` 判断「能干什么」**：方言名是开放集（`"oracle"` / `"dameng"` / 插件
> 自定名都合法），`if (d === "mysql") A else B` 在新方言接入后会把 B **静默**发给它
> （占位符风格错、`ON DUPLICATE KEY` 发给 Oracle），报错却落在引擎侧。正确做法：
> ①能力问题**直接调用**并接 `OJ_DB_UNSUPPORTED`；②确属方言特有的 SQL（upsert 语法等）
> 用白名单 + 未知方言**响亮失败**，别写 `else` 兜底。可照抄模板见 scenarios 场景 45。


### db —— 命名库（多库混用）

`name → DSN` 映射：`sqlite://<path>`（相对 config 目录，缺文件自动建空库）、
`sqlite::memory:`（仅测试，重启即丢）、`mysql://…`、`postgres://…`（原样透传）。

- 内置只有 sqlite/memory；`mysql`/`postgres` 需对应插件（oj-db-mysql / oj-db-postgres），
  未装插件 → 启动报 `unknown db scheme`。
- `DB("name")` 按名取库；查询构造器自动按库方言出 SQL；裸 SQL **统一用 `?` 占位符**
  （0.1.67 起，postgres 由宿主自动改写 `$n`；存量 `$n` 继续有效，见「统一占位符」节）。
- `seed.sql` 启动时对 `default` 库重放，**三方言**（幂等靠 S006 门禁 + 引擎按方言改写）。
- mysql/pg 连不上启动 fail-fast（连接串错/库未建）。
- **按库运维（v0.1.21）**：`oj migrate` / `oj test fixture` / `oj schema diff` 的 `--db <name>`
  即上方键名；缺省 `default`，未声明 fail-fast。账本 `_oj_migrations`、schema 收敛、
  `--baseline` 都各库独立——多库须逐库跑（模块绑不同库见第 3 章「命令」与场景 6）。
- DSN 带密码时写成 `"ENC[…]"` 密文（v0.1.33，见「secrets —— 凭据密封」）：整条 DSN
  一起封即可，不必拆出密码字段。

### db_access —— 库级访问控制（v0.1.89）

`db:` 只定义「有哪些库、怎么连」；`db_access:` 定义「谁能对这些库做什么」。两者分开，
`db:` 仍是纯粹的 `别名 → DSN` map。**不配这段 = 与升级前完全一致**（默认 `enforce: off`）。

```yaml
db_access:
  defaults:                # 全局默认档（缺省 = off）
    enforce: off           # off（不设防） | warn（告警放行） | deny（拒）
  analytics:
    read_only: true        # 拦 write / ddl
    allow_ddl: false       # 单独放开 DDL（与 read_only 互斥，装配期报错）
    allow_dangerous: false # 放开「无 WHERE 的 UPDATE/DELETE」等危险写
    max_rows: 1000         # 缺省 = 不限；范围 [1, 100000]
    allow:                 # 四维并集；不写 = 不限制
      modules: [sales]
      roles: [admin, dba]
      tenants: ["t1"]
      sources: [http]      # 只有 http | task 两个取值
```

要点（写错会付出真代价，逐条看）：

- **逐键继承**：`analytics:` 是**覆盖条目**，未声明的键继承 `defaults`（`allow` 是逐维
  覆盖）。若整条覆盖，设好 `defaults.enforce: deny` 后再给某库加一条 `read_only: true`
  会把该库的 `enforce` 悄悄打回 off——**全局设防被一次局部微调静默解除**。
- `allow` 是**并集**：任一已声明维度命中即放行。⚠️ **声明多维不会提高强度，只会降低**
  （任一命中即过）。`allow: { roles: [] }` 是「无人可过」，不是「不限制」。
- fail-closed：声明了某维而请求取不到该维身份 → 该维**不命中**（不因取不到而放行）。
- `tenants` 维**只认服务端注入的租户**：`db.asTenant()` 自填的租户不作数。
- `db.asSystem()` **不豁免**访问控制（它只绕过租户注入）。
- `sources` 只有 `http` / `task`：**没有** `ws` / `anon`（WS 帧跑在 HTTP 桥上记 `http`，
  写了永不命中）。定时任务无 user/module/tenant，靠 `sources: [task]` 授权。
- 装配期 fail-loud：未知键、`max_rows` 越界、`read_only` + `allow_ddl` 矛盾都启动报错。
- 只约束 **JS 提交的 SQL**：`db.nextSeq` 的平台表 DDL、`db.listTables` 的内省查询，以及
  `oj migrate` / `oj schema` 等 CLI 通道（不经 bridge）**不受本策略约束**。

被拒时 JS 拿到的是错误（文案形如 `db access: alias "analytics" is read_only;
statement classified write`），`reason` 稳定串有五个，供告警 grep：
`db_not_granted` / `db_read_only` / `db_ddl_denied` / `db_dangerous_write` /
`db_unknown_risk`。服务端同时落前缀 `DB_ACCESS_DENY` 的结构化日志（按 `(alias, reason)`
聚合计数）。分类失败的修复指向很明确：**改用 `db.table()` 构造器**——它走精确意图判定，
不依赖词法。

JS 侧自省：`db.allowed()` 只列**当前主体有权限**的库（含能力位）。

**运行期动态授权（U-1，v0.1.93）**：config 改 `db_access` 段须重启才生效（该段纳入热更 diff 的
`restart_pending`，改了会被提示重启，不会静默盲区）。但**零重启**地对「已存在别名」（静态或
`db.client` 登记的动态库）追加**角色/主体放行维**，可用 `db.access.grant(name, allow)` /
`db.access.revoke(name)`（见 §6 `db` 总表与「运行期动态授权」小节）。要点：

- 运行期 grant **只注入放行维 allow**，绝不覆盖 config 的 `enforce` / `read_only` / `max_rows`
  （防提权）；撤销后别名回落 config（非删 config），纯 config 兜底项 `revoke` 显式报错。
- 与 `db.client` 同特权门（`db_client.allow` 四维并集、`enabled=false` 拒）——授权是特权操作。
- grant 必须至少限制 allow 一维（空 allow = 对全员放行，被 host 拒）。必发 `DB_ACCESS_AUDIT`。


## 11.8 管理面 connector（`mgmt:` 段 + `globalThis.mgmt`，U-15 M1）

管理面（DBA 运维：进程列表、KILL、配置读写）与客户面（`kv`/`bus`/`es` 业务连接）**正交**。
承载机制：connector 是带泛型轴的插件，其轴名写进 `mgmt.axes` 后在**装配期被收编**——
**不进 `axis()` 公开面**（特权旁路封堵：任意 handler 都调不到，只有 mgmt 面可达）。

```yaml
mgmt:
  enabled: true             # 缺省 false（fail-closed）
  axes: ["mongo"]           # 收编名单（这些轴从 axis() 消失）
  allow: { roles: [dba] }   # 写档：register/delete/非只读 call；enabled 时必须显式（否则拒启）
  allow_read: { roles: [monitor, dba] }   # 读档：list/只读 call；缺省复用 allow（has 无特权语义，仅探活）
  max_entries: 8
  max_per_owner: 4
```

```js
await mgmt.register("mongo", "mongodb://u:p@host:27017");  // 探 __ops__ + __connect__ + ping（失败即拒）
const list = await mgmt.list();          // [{connector, dsn(脱敏), registeredBy, registeredAtMs, ops}]
const st = await mgmt.call("mongo", "serverStatus");        // 只读 op（读档）
await mgmt.call("mongo", "killOp", { opId: 12345 });        // 非只读 op（写档）
await mgmt.delete("mongo");
```

- **能力位契约**（零 ABI，架在泛型传输上）：connector 实现保留 op `__ops__`（返回
  `[{"op","readOnly"}]`）/ `__connect__` / `__disconnect__`；未声明 op →
  结构化错误 `OJ_DB_UNSUPPORTED`（`e.data.capability` = op 名；fail-loud，不透传）。
- **红线：readOnly 是插件自报、宿主不可验证**——分档判权据此，但插件谎报即绕过；
  connector 须第一方（红线成文于评审处置）。
- **审计**：register/delete/call 逐条 `MGMT_AUDIT`；拒绝 `MGMT_DENY`；全字段零凭据
  （连接串入库即脱敏，args 永不入审计）。`__connect__` 的 args 含**明文 DSN**——connector 侧日志须自行脱敏（红线）。
- **容量与并发**：`max_entries` / `max_per_owner`（U-7 同款锁内重判）；每 connector
  并发闸 4（满即拒不排队）。
- 首个 connector（mongo）**未交付**（M2 另期）；M1 交付宿主面 + 契约测试夹具。

---

## 11.9 运行期凭据（`secret.seal` / `secret.open`，U-10 v0.1.101）

把 config `ENC[...]` 的同一套 X25519 + AES-256-GCM 信封开给运行期：handler 可以把敏感值
（DSN、token）**加密后落自有表**，解密只能靠部署私钥——「配置文件可以进 git」的同一威胁
模型延伸到「业务表里的凭据」。

- **密钥来源（装配期一次）**：公钥 = `secrets.public_key_path` 显式配置 > 由私钥推导
  （部署机为解封 config `ENC[...]` 本就持有私钥，零新增配置）。两者皆缺 = 无密钥装配，
  `secret.*` 报 `secret axis not configured`（fail-closed，不静默当明文用）。
- **`secret.open` 需部署私钥**：只有公钥的装配（seal-only，如构建机）seal 可用、open 报
  `no private key`。**私钥永不出 Rust 边界**，JS 只见密文与解出的明文。
- **审计**：每次 `open` 落 `SECRET_OPEN`（U-9 统一出口，`audit.query({kind:"SECRET_OPEN"})`
  可查；零凭据——不记 token 与明文）。`seal` 不落审计。
- **随机化**：同一明文两次 seal 密文不同（临时密钥 + 随机 nonce）——**不能拿密文判等**，
  要比对就先 `open`。

```js
// 登记连接时把 DSN 加密入库（重启后 replay 用 open 解出再 db.client.register）：
const tok = secret.seal(dsn);                    // "ENC[...]"，可存自有表
const dsn2 = secret.open(tok);                   // 需部署私钥；明文只在本次请求内
```

- **与 `crypto.aesGcm` 的分工**：`secret.seal/open` 的密钥是**部署机**的（模块不可导出、
  跨模块共享同一信任根）；`crypto.aesGcm(key, ...)` 的密钥由模块自带（如 `vars` 里的
  模块级密钥）。要「跟着部署走、模块摸不到密钥」用前者；要「模块自治、可导出迁移」用后者。
