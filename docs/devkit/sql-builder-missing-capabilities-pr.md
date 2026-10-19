# 上游 PR 提案：SQL 构造器缺失能力清单

> 目的：把模板 `db.query` 全面迁移到 `db.table(...)` 构造器以获得多库（sqlite / mysql / postgres）可移植性时，
> 识别出构造器**当前无法表达**、只能回退 `db.query` 的 7 类能力。本文档作为向上游 `oj` 运行时 SQL 构造器提 PR 的依据。
>
> 证据来源：`~/.local/share/oj/devkit/api-manual.md`（查询构造器章节，含 `like` 操作清单 §1142、子查询限制 §1343、
> `union` §1346、CTE §1378 等）；框架 `README.md` v0.1.66（ESCAPE 纪律）；模板代码 `packages/cli/templates/api/src/**`。

---

## 1. 背景与现状

模板已完成 `db.query` → `db.table()` 的主体迁移：约 96 处查询/写入迁移到构造器，但仍有 **17 处**因构造器能力缺口被迫保留
`db.query`（含注释 `保留 db.query：…`）。这些缺口若不上游补齐，模板永远无法做到"零原生 SQL"。

构造器已具备：`select/where/orderBy/limit/offset/all`、`insert/update/delete/returning/run`、
`where` 树（`and/or/not`）、`in/like/isnull/eq…` 比较、`union`/`union all`、`case`/`window` 列、`with` CTE、嵌套子查询（深度≤4）。

缺口集中在**表达能力**而非基础 CRUD。

---

## 2. 缺失能力总览（按出现频率与阻塞面排序）

| # | 缺失能力 | 阻塞面 | 当前回退点（模板） | 优先级 |
|---|----------|--------|--------------------|--------|
| 1 | `like` 的 `ESCAPE` 转义子句 | 模糊搜索全场景（用户/方案/联系人/目录） | `contacts.ts:20`、`solution-perms.ts:100`、`uninstall.ts:76/82/116` | P0 |
| 2 | `join ... ON` 带**值条件**（`AND user_id = ?`） | 通知合并查询（broadcast LEFT JOIN 回执） | `notify.ts:135-167` | P0 |
| 3 | `select` 支持**字面量/计算列**（`'user' as scope`、`(x IS NOT NULL…) as y`） | 通知合并 + 角色作用域标记 | `notify.ts:144/148` | P1 |
| 4 | `INSERT OR IGNORE` / `INSERT … SELECT` | 通知已读回执幂等写入 | `notify.ts:167-169/186-188` | P1 |
| 5 | **全表 delete 的强制 where 豁免** | 登录限流重置等有意清空 | `rate.ts:78` | P2 |
| 6 | **动态 WHERE** 组合（运行时按可选参数拼接） | 多过滤项搜索、动态 IN | `demo/todos/api.ts:12`、`uninstall.ts:166` | P2 |
| 7 | `select *`（无列清单） | 刷新令牌等整行读取 | `session.ts:114-115` | P3 |

---

## 3. 逐项详述

### 3.1 `like` 缺 `ESCAPE` 子句（P0）

**为什么是硬约束**：框架对模糊搜索有强制纪律——`LIKE` 元字符必须用 `ESCAPE '!'` 转义，且**不能用 `ESCAPE '\'`**
（mysql 默认 `sql_mode` 下 `ESCAPE '\'` 直接 1064）。`api-manual.md` 的 `like` 操作清单（§1142）及子查询限制（§1343）
表明：`WhereCond` 的 `like` 不接受 `escape` 字段，也不接受子查询。

**阻塞的真实代码**（`contacts.ts:20`）：

```ts
// 保留 db.query：模糊搜索需 ESCAPE '!'(构造器 like 无 escape 子句；mysql 默认 sql_mode 下 ESCAPE '\' 即 1064)
const rows = await db.query(
  `SELECT * FROM contacts WHERE name LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!'`,
  [pat, pat],
) as unknown as ContactRow[];
```

**提议 API**：

```ts
// 方案 A：WhereCond 增加 escape 字段
db.table("contacts").where({ field: "name", op: "like", value: pat, escape: "!" }).all();
// 方案 B：链式 like 三参
db.table("contacts").where(c => c.like("name", pat, "!").or.like("phone", pat, "!")).all();
```

引擎侧：sqlite 原样 `ESCAPE '!'`；mysql/postgres 同语义转写。**务必锁定 `!` 为默认转义符**，杜绝 `'\'`。

---

### 3.2 `join ... ON` 仅支持列=列，不支持值条件（P0）

**阻塞的真实代码**（`notify.ts:150`，广播通知合并读取）：

```sql
SELECT b.id, …, (r.read_time IS NOT NULL AND r.read_time <> '') as is_read, …, 'broadcast' as scope
  FROM notifications_broadcast b
  LEFT JOIN notifications_broadcast_read r ON r.broadcast_id = b.id AND r.user_id = ?
```

`api-manual.md` 的 join `on` 仅接受 `{ left, right }`（列=列）。`AND r.user_id = ?` 是**值条件**，构造器无法表达。

**提议 API**：

```ts
db.table("notifications_broadcast as b")
  .leftJoin("notifications_broadcast_read as r",
    on => on.on("r.broadcast_id", "b.id").and("r.user_id", "=", uid))
  .select([...])
  .all();
// on() 第二形参支持 op + value：.and("r.user_id", "=", uid)
```

---

### 3.3 `select` 不支持字面量 / 计算列（P1）

**阻塞的真实代码**（`notify.ts:144/148`）：

```sql
SELECT id, avatar, date, is_read, message, title, link, category, 'user' as scope
  FROM notifications WHERE user_id = ?
UNION ALL
SELECT b.id, …, (r.read_time IS NOT NULL AND r.read_time <> '') as is_read, …, 'broadcast' as scope
  FROM notifications_broadcast b LEFT JOIN …
```

`'user' as scope`（字面量列）与 `(r.read_time IS NOT NULL AND r.read_time <> '') as is_read`（计算列）均无法用构造器 `select([...])`
表达（该 API 当前只收列名字符串或 `{ fn, field, as }` 聚合）。

**提议 API**：

```ts
.select([
  "id", "avatar", "date",
  { expr: "'user'", as: "scope" },              // 字面量
  { expr: "(r.read_time IS NOT NULL AND r.read_time <> '')", as: "is_read" }, // 计算列
])
```

> 注：`case`/`window` 列（§1360）已支持，但**任意表达式 + as 别名**维度缺失，建议补齐 `expr` 入口。

---

### 3.4 缺 `INSERT OR IGNORE` / `INSERT … SELECT`（P1）

**阻塞的真实代码**（`notify.ts:167-169` 与 `186-188`）：

```ts
// 保留 db.exec：INSERT OR IGNORE 构造器无等价（引擎按方言改写 IGNORE）
await d.exec("INSERT OR IGNORE INTO notifications_broadcast_read (broadcast_id, user_id, read_time) VALUES (?, ?, ?)", [...]);
// 保留 db.exec：INSERT OR IGNORE ... SELECT 构造器无法表达
await d.exec("INSERT OR IGNORE INTO notifications_broadcast_read (broadcast_id, user_id, read_time) SELECT id, ?, ? FROM notifications_broadcast", [...]);
```

`INSERT OR IGNORE` 是 sqlite 方言；mysql 对应 `INSERT … ON DUPLICATE KEY IGNORE`/忽略，postgres 对应 `ON CONFLICT DO NOTHING`。
构造器当前 `insert()` 无 `orIgnore()` 修饰，也无 `fromSelect()`。

**提议 API**：

```ts
db.table("notifications_broadcast_read")
  .insert({ broadcast_id, user_id, read_time })
  .orIgnore()          // 引擎按方言转写：sqlite OR IGNORE / pg ON CONFLICT DO NOTHING / mysql 忽略重复
  .run();

db.table("notifications_broadcast_read")
  .insert(["broadcast_id", "user_id", "read_time"])
  .fromSelect(db.table("notifications_broadcast").select(["id", lit(uid), lit(now)]))
  .orIgnore()
  .run();
```

---

### 3.5 全表 delete 强制 where 无豁免（P2）

**阻塞的真实代码**（`rate.ts:78`，登录限流重置——有意清空整张表）：

```ts
await db.exec("delete from sys_login_throttle", []);
```

构造器在运行时抛 `"update requires where"`（delete 同理强制 where）。清空整表是合法运维动作，需显式豁免。

**提议 API**：

```ts
db.table("sys_login_throttle").delete().where({ __all: true }).run();
// 或显式逃逸：.delete().run({ force: true })
```

命名上建议用**显眼且不可误用**的写法规避"忘了加 where 误清表"，例如要求 `where({ __all: true })` 或 `deleteAll()`。

---

### 3.6 动态 WHERE 组合无安全出口（P2）

**阻塞的真实代码**（`demo/todos/api.ts:12`、`uninstall.ts:166`）：

```ts
// 保留 db.query：WHERE 由 JS 字符串拼接动态生成（规则5）
// 保留 db.query：IN 占位符经 JS 字符串拼接动态生成（动态 SQL），构造器 in 仅接受静态数组值
```

运行时按可选过滤参数拼接 WHERE（如"给了 status 才加 `status = ?`"、动态 IN 长度）超出了构造器静态 `where(...)` 树。

**提议 API**（安全逃逸舱，而非放开字符串拼接）：

```ts
db.table("todos")
  .where(sql`status = ? AND owner = ?`, [status, owner])   // 类型安全参数化片段
  .all();
// 或 builder 拼接：.whereIf(cond, c => c.eq("status", v))
```

> 反对直接暴露 `where(rawString, params)` 给业务层——保留给平台内部/高级场景，避免回到拼接 SQL 的老路。

---

### 3.7 `select *` 无整行读取（P3）

**阻塞的真实代码**（`session.ts:114-115`）：

```ts
// 保留 db.query：select * 无已知列清单（规则6）
const rows = await db.query("select * from sys_refresh_token where token_hash = ?", [hash]) …;
```

**提议 API**：

```ts
db.table("sys_refresh_token").select("*").where({ field: "token_hash", op: "eq", value: hash }).all();
// 或省略 select，默认整行：.all()
```

---

## 4. 不在本文范围

- **方言无关的表达式求值**：计算列目前建议以 `expr` 字符串透传（由引擎保证参数化安全），不要求构造器解析表达式语义。
- **存储过程 / 批处理 / 事务编排**：与可移植性目标无关。
- **`db.query` 下架**：补齐上述能力后模板侧可全量迁移，下架是后续动作，不在本 PR 提案内。

---

## 5. 验收建议（上游实现后模板侧可关闭的回退点）

1. `contacts.ts:20` 模糊搜索 → 改用 `like` + `escape`。
2. `solution-perms.ts:100` / `uninstall.ts:76/82/116` 目录与权限 LIKE → 同上。
3. `notify.ts:135-167` 通知合并 → `leftJoin` 值条件 + `expr` 列。
4. `notify.ts:167-188` 已读回执 → `orIgnore()` / `fromSelect()`。
5. `rate.ts:78` 限流重置 → `delete().where({ __all: true })`。
6. `demo/todos/api.ts:12` / `uninstall.ts:166` → 动态 WHERE 安全出口。
7. `session.ts:114-115` → `select("*")`。

全部关闭后，模板 `api/src` 内 `保留 db.query` / `保留 d.exec` 注释应归零，达成"零原生 SQL 可移植"目标。
