# SQL 构造器专题指南（`db.table`）

> 本文是 `docs/devkit/api-manual.md`「查询构造器」章的**专题指引**：集中收录「什么时候用构造器、
> 能力矩阵、三方言差异、红线与逃生舱、从 `db.query` 迁移」等**解释性内容**。`api-manual` 同章只列
> API 契约（签名、允许形态、报错文案），需要背景/口径/方言对照时来这里。两处交叉引用，不重复。

## 1. 为什么优先用构造器

业务读写优先用 `db.table(...)` 构造器，由服务端按目标方言（sqlite / mysql / postgres）**自动
生成正确 SQL**。同一份 handler 因此可在多库 / 跨引擎间迁移——这是获得多库迁移能力的关键前提。

裸 `db.query` 一旦写死方言特有语法（`INSERT IGNORE`、反引号标识符、MySQL 分页 `limit a,b`、
PG 的 `$N` 占位符自管）就会锁死到单一引擎，迁移时须逐条改写。**仅当构造器不支持的语句
（DDL、部分非 CRUD 语义）才退回 `db.query` / `db.exec`**，且仍须用 `?` 绑定参数、避免方言特有语法。

## 2. 能力矩阵（v0.1.82）

| 能力 | 构造器写法 | 方言可移植 | 备注 |
|---|---|---|---|
| 基础 CRUD | `select/insert/update/delete/where/orderBy/limit` | ✅ | 全方言自动生成 |
| 条件树 | `and/or/not`、`db.leaf/and/or` | ✅ | 深度 ≤ 8、叶子 ≤ 64 |
| 模糊搜索 | `op: contains / startswith / endswith` | ✅ | 引擎转义 `%`/`_`/`!`，业务零转义 |
| 动态 WHERE | `whereIf(test, cond)` | ✅ | 假值/空数组跳过，`0`/`""` 保留 |
| 全列 | `select(["*"])` | ✅ | 唯一元素、禁带 join |
| join（列=列） | `join(t, [{left,right}], kind)` | ✅ | inner/left |
| join（列=值） | `join(t, [{left,op,value}])` | ✅ | op 限比较类 |
| 表/被 join 表别名 | `.as("b")` / `join(t, on, kind, "b")` | ✅ | 仅 select/join；守卫按真名 |
| 字面量列 | `{ lit: v, as: "x" }` | ✅ | 绑定参数 + 方言 `CAST` |
| 计算列 | `{ case: {when,else}, as }` | ✅ | 条件表达式 |
| 聚合 / groupBy / having / distinct | `select([{fn,...}])/groupBy/having/distinct` | ✅ | |
| count(distinct col) | `select([{fn:"count",distinct:true,field,as}])` | ✅ | v0.1.82；聚合一行、免拉行计数（受 LIMIT 钳制的 `distinct().all()+length` 是陷阱） |
| 整表清空 | `.truncate().run()` | ✅ | v0.1.82；渲染 `DELETE FROM t`；**租户守卫照常注入**（租户表=清当前租户，整库清用 asSystem） |
| 子查询 / exists / union / with CTE | `subquery / exists / union / with` | ✅ | 嵌套 ≤ 4 |
| 取回主键 | `.returning([...])` | ⚠️ | mysql 仅单列（两步取） |
| 幂等写入 | `.orIgnore()` | ⚠️ | 见 §3；**与 fromSelect 组合在 sqlite 不支持** |
| 批量写入（查询插入） | `.fromSelect(q, cols)` | ⚠️ | 见 §3 |
| 目录自省 | `db.listTables(prefix?)` | ✅ | v0.1.82；当前库全部表名（含未登记 registry），替代按方言分支 `information_schema`/`sqlite_master` |
| 流式读取 | `db.stream` | ⚠️ | 见 api-manual「db.stream」三档 |
| 任意 SQL 表达式 / DDL | — | ❌ | 退回 `db.query` / `db.exec` |

`✅` = 全方言一致可移植；`⚠️` = 语义有方言差异，使用时注意 §3；`❌` = 构造器不支持。

## 3. 方言差异与陷阱

### 3.1 受影响行数（三方言语义对照）

`run()` 返回值 = WHERE **匹配行数**——mysql / postgres / sqlite 在 oj 运行时上一致：

| 引擎 | 协议原生默认 | oj 运行时 |
|---|---|---|
| mysql | **实际变更行**（同值 UPDATE 得 0） | 匹配行（连接协商 `CLIENT_FOUND_ROWS`） |
| postgres | 匹配行（命令标签 `UPDATE n`） | 匹配行 |
| sqlite | 匹配行（`changes()`） | 匹配行 |

mysql 协议默认只数「值真的变了」的行——裸 mysql 客户端（`ROW_COUNT()` 即此语义）对**幂等重写**
是陷阱：把 `is_read` 已是 1 的行再置 1 得 0。oj 的 mysql 插件（sqlx）连接时协商
`CLIENT_FOUND_ROWS`，服务端改报匹配行，与 sqlite / pg 拉齐（oj-db-mysql 真库契约测试钉死：
同值重复 UPDATE → 1、WHERE 不匹配 → 0）。

> **但别把这当保险**：用行数判「行存在 / 归属我」（`affected > 0`）只在匹配语义下成立，换连接方式
> （裸驱动、未来的插件实现）即翻车。正确姿势是**先断言再写、行数不读**：

```ts
// 跨引擎安全的幂等写：先按 (id, user_id) 断言归属，再无条件 UPDATE
const owned = await db.table("notifications").select(["id"]).where({ and: [
  { field: "id", op: "eq", value: id },
  { field: "user_id", op: "eq", value: uid },
] }).limit(1).all();
if (owned.length === 0)
  json.fail(403, "forbidden");      // 非本人/不存在——SELECT 断言，不看行数
else
  await db.table("notifications").update({ is_read: 1 })
    .where({ field: "id", op: "eq", value: id }).run();  // 行数不读：重复已读幂等成功
```

DELETE 无此坑（删行必「变更」，匹配行 = 变更行），但归属判断同样推荐先 SELECT 断言。

> 注意 `orIgnore` 的 affected-rows **仍不一致**（见 §3.2）——上表是普通 DML 的口径。

### 3.2 `orIgnore()` 三方言差异

| 引擎 | 渲染 | 命中重复键时 `run()` 返回值 |
|---|---|---|
| sqlite | `ON CONFLICT DO NOTHING` | `0` |
| postgres | `ON CONFLICT DO NOTHING` | `0` |
| mysql | `ON DUPLICATE KEY UPDATE <pk> = <pk>` | `1`（匹配行） |

- **不要用 `if (n === 1)` 判幂等**：pg/sqlite 返回 `0`。靠唯一约束 + 事务保证「不会重复写」，
  行数只读「写几条」。
- mysql **无主键表**直接报错：`orIgnore on mysql requires a primary key on table '...'`。
- mysql 上 `orIgnore` 与 `returning` **互斥**（`orIgnore with returning is not supported on mysql`）：
  mysql 无 RETURNING，而 `ON DUPLICATE KEY UPDATE` 又无法在同一语句回带自增 id。
- 实现**不用 `INSERT IGNORE`**：它会把 NOT NULL 违例 / 截断等**所有**错误降级为警告（静默数据
  损坏面），且 sea-query 该路径上游零测试、组合后疑似产出非法 `ON DUPLICATE KEY IGNORE`。

### 3.3 `fromSelect(q, cols)` 注意点

- 目标 `cols` 与源 `q` 的 select 列**按位置一一对齐**，列数不符报
  `insert declares N columns but the source select yields M`（避免写错列）。
- `cols` 为空报 `insert fromSelect needs insert columns`；`values` 与 `fromSelect` 二选一。
- `cols` 含 `tenant_id` 直接拒（`fromSelect must not declare tenant column 'tenant_id'`）：
  tenant 由服务端按当前租户注入，禁止 select 自带。
- 源 select 的**租户收窄**继承到写入侧（跨租户读写被守卫拦截）；源 select 须 `select` 动词、
  深度 ≤ 4、禁 with/unions（见 api-manual「嵌套通用约束」）。
- **sqlite 上 `orIgnore()` + `fromSelect()` 不可组合**（构造期显式拒绝，v0.1.82 明文）：
  `orIgnore with fromSelect is not supported on sqlite (its upsert clause only follows VALUES)`。
  根因：sqlite 的 upsert 子句只能跟在 VALUES 之后，`INSERT … SELECT … ON CONFLICT DO NOTHING`
  是语法错；而 sqlite 原生的 `INSERT OR IGNORE … SELECT` 会把 NOT NULL / CHECK 违例**一并静默
  跳过**（数据面比 ON CONFLICT 宽），与引擎「把静默损坏面收窄到唯一键冲突」的取向相悖，故不实现。
  pg（ON CONFLICT）与 mysql（ON DUPLICATE KEY）的子句本就支持 SELECT 源，组合可用。sqlite 侧确需
  该语义时退回裸 `db.exec("insert or ignore into … select …", [...])`，注释写明根因。

### 3.4 字面量列的方言 `CAST`

`{ lit: v, as: "x" }` 值走绑定参数，按方言转：
- sqlite：裸 `?`
- mysql：`CAST(? AS CHAR)`
- postgres：`CAST(? AS TEXT)`

`lit` 必须是**标量**（数组/对象/嵌套报 `lit column must be a scalar`）；`as` 必填过别名形状
（`^[A-Za-z_][A-Za-z0-9_]*$`，违例 `illegal alias`），与 `*` 混用直接拒
（`literal column cannot mix with select '*'`）。**真正的计算列用 `case`**，不要拼字符串进
`lit`（会破坏参数化、引入注入面）。

### 3.5 模糊搜索：用语义 op，别手写 `LIKE`

`contains` / `startswith` / `endswith` 自动转义通配符并渲染 `LIKE ? ESCAPE '!'`：

- 语义：`contains` ⇒ `%v%`、`startswith` ⇒ `v%`、`endswith` ⇒ `%v`。
- 引擎内部统一把模式里的 `%` `_` `!` 三个字符转义（前缀 `!`），业务层**不该、也不需要**自己拼
  `%`/`_`。`contains` 把 `value` 当**普通搜索词**（自动包通配 + 转义），而裸 `like` 把 `value`
  当**已成形**的 LIKE 模式（不转义，写 `%a%` 就按 `%a%`）——绝大多数场景用三个语义 op 即可。
- `like` 的 `escape` 逃生舱保留（高级/框架内部）：`{ op: "like", value: "a%", escape: "!" }`
  渲染 `LIKE ? ESCAPE '!'`；`escape` 仅接受单字符且白名单 `! / | ~ # @`，**显式拒绝 `\`**
  （mysql 默认 `sql_mode` 下 `ESCAPE '\'` 即 1064 语法错误）。业务层基本用不到。
- `in` 的空数组守卫：`{ op: "in", value: [] }` 直接报 `in needs non-empty array`——引擎里 `IN ()`
  是永久假谓词，会静默返回 0 行、与「无匹配」无法区分，故早抛。

### 3.6 表别名：修复前的静默失效缺陷（v0.1.81 前）

v0.1.81 前「别名混入真名」会让归属与租户两条守卫**同时静默失效**：`owner_of("t as b")` → None
→ 判定放行；`scoped("t as b")` → None → 不注入 tenant。本次引入 `TableRef` 类型、入口一次归一化，
**别名只用于列限定与 SQL 渲染，归属/租户守卫始终按真名**；`update`/`delete` 带别名直接报
`table alias is not supported on insert/update/delete`（mysql 的 `DELETE FROM t AS b` 需 8.0.16+，
跨引擎不保证，故构造器直接拒）。

## 4. 红线与逃生舱

- **标识符（表/列/别名）只来自 SchemaRegistry 白名单**（启动内省），值一律经绑定参数——SQL 注入
  面为零。
- **不要**为「构造器不支持」而裸拼标识符进 `db.query`（表名/列名来自 JS 字符串 = 注入面）。
- **逃生舱**：构造器确实不支持的语句（DDL、特殊方言语法）用 `db.query` / `db.exec`，但仍须 `?`
  绑定值、避免方言特有语法；`like` 的 `escape` 是高级逃生舱（白名单 `! / | ~ # @`、显式拒 `\`）。
  **匹配字面 `%` / `_`** 用 `{op:"like", value:"a!_b", escape:"!"}`（模式原样成形 + 自选转义符）；
  纯模糊包含用 `contains` 即可（v0.1.82 起写进迁移清单第 7 条）。
- **`truncate()` 是唯一无 where 的写动词**（v0.1.82）：命名式、可 grep 的「明示清空」，取代
  「退回裸 `db.exec("delete from t")`」。租户守卫照常注入——租户表上只清当前租户（构造性
  fail-safe：永远清不出租户边界），整库清空在 `db.asSystem` 下执行；语义出处见 api-manual §6。
- **目录自省不再分支方言**（v0.1.82）：「枚举当前库的表」（卸载清理、按前缀扫表）用
  `db.listTables(prefix?)`——SQL 文本引擎常量 + 前缀绑定参数，能力面严格弱于 `db.query`，
  价值在跨方言可移植。返回名可含**未登记 registry** 的表；要拿它们的行数据仍须走裸 SQL
  （值绑定参数）。

## 5. 从 `db.query` 迁移（清零手写 SQL）

按阻塞面排序的典型迁移：

1. **模糊搜索** `LIKE '%' || ? || '%' ESCAPE '!'` → `op: "contains"`。
2. **join ON 带值条件** `... AND r.user_id = ?` → `join(t, [{left,right},{left:"r.user_id",op:"eq",value:id}])`。
3. **字面量/标记列** `'svc' as scope` → `{ lit: "svc", as: "scope" }`；条件表达式 → `{ case: {...} }`。
4. **INSERT OR IGNORE / INSERT … SELECT** → `.orIgnore()` / `.fromSelect(q, cols)`（sqlite 的
   orIgnore+fromSelect 组合除外，见 §3.3）。
5. **动态 WHERE** `if (x) q.where(...)` → `q.whereIf(x, ...)`（空数组也自动跳过，避免 `IN ()` 静默 0 行）。
6. **目录扫描**（v0.1.82）：`information_schema.tables` / `sqlite_master` 按方言分支 + `LIKE ? ESCAPE`
   手工转义 → `db.listTables(prefix?)` 一句（前缀转义引擎做，绑定参数）。
7. **无 where 清空**（v0.1.82）：裸 `db.exec("delete from t", [])` → `db.table("t").truncate().run()`
   （命名式明示、租户守卫不缺席）；**去重计数** `select distinct …` 拉行 `.length` →
   `select([{fn:"count",distinct:true,field,as}])`（聚合一行，免受 LIMIT 钳制静默漏算）。
8. **字面 `%`/`_` 匹配**（v0.1.82 明文）：`{op:"like", value:"a!_b", escape:"!"}`——模式原样成形，
   自选转义符（白名单 `! / | ~ # @`）；纯模糊搜仍用 `contains`。

迁移后同一 handler 在多引擎跑通，无需按方言分支。
