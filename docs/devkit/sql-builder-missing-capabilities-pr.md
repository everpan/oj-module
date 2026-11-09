# 上游 PR 提案：SQL 构造器缺失能力清单

> **最新状态（2026-11-09 二轮）**：§7 需求已由上游 `oj v0.1.128` 闭环；模板侧 `markAllRead` /
> `clearNotices` 迁移、回执表唯一约束、`MIN_OJ_VERSION` 抬升三项待办**均已完成**，并通过
> sqlite / MySQL 8.4.11 / PG 16.15 三方言真机验证，见 **§7.8**。本轮另新增
> **§8：模板后端裸 SQL 残留普查与构造器统一性验证**（含新需求 #5）。
> 下方更正段、§1、§6 为 2026-10-20 / 11-09 首轮**历史留痕**（各自带标注），按当时口径阅读；
> 最新结论以 §7.8、§8 为准，不静默改写历史。

> **更正（诚实账，2026-11-09）：第 4 项复开，未闭环。** 2026-10-20 的「7 项全部闭环」结论建立在
> 一条错误前提上——当时认为上游 sanctioned 的裸 SQL 绕行 `INSERT OR IGNORE … SELECT` 是「三方言通用」的。
> **它不是**：`OR IGNORE` 是 sqlite 专属语法，MySQL 8.4.11 报 1064、PostgreSQL 16.15 报
> `syntax error at or near "OR"`，`db.exec` 又不做方言改写。模板通知铃「清除 / 全部已读」在 MySQL 真机上
> 因此直接失败（用户实测报错）。截止 oj **0.1.125**，`fromSelect().orIgnore()` 在 sqlite 仍被构造期
> 明文拒绝，即构造器至今无法表达一条可移植、且真幂等的 `INSERT … SELECT`。
> **本文 §7 为该诉求的完整闭环需求（场景 / 问题 / 真机证据 / 诉求 / 验收 / 状态），以 §7 为准**；
> 下方 2026-10-20 闭环结论与 §6 中「三方言通用 / 上游 sanctioned 绕行达成」两处表述均已作废，保留仅为留痕。
> **本仓不在模板内加方言分支绕过**（用户裁定：构造器缺陷向上游提需求，待上游修复再处理）。

> **闭环状态（2026-10-20，历史结论已由上方更正取代）**：原记「7 项诉求全部闭环」——6 项随 oj 0.1.81/0.1.82 发布落地，第 4 项
> （orIgnore + fromSelect）能力本身已发布但**组合在 sqlite 上被上游明文拒绝**，模板按上游
> 文档指引保留一处 sanctioned 裸 SQL 绕行（`notify.ts:216`，api-manual §"orIgnore + fromSelect
> 组合在 sqlite 不支持"原文即指向该绕行）。逐项映射见 §6；模板 `src/*/api`（布局 v2 前为
> `api/src`）内 `保留 db.query` 注释已归零（仅剩 `notify.ts` 里 `markAllRead` / `clearNotices`
> 两处 `保留 db.exec`）。
>
> 目的：把模板 `db.query` 全面迁移到 `db.table(...)` 构造器以获得多库（sqlite / mysql / postgres）可移植性时，
> 识别出构造器**当时无法表达**、只能回退 `db.query` 的 7 类能力。本文档作为向上游 `oj` 运行时 SQL 构造器提 PR 的依据。
>
> 证据来源：`~/.local/share/oj/devkit/api-manual.md`（查询构造器章节，含 `like` 操作清单 §1142、子查询限制 §1343、
> `union` §1346、CTE §1378 等）；框架 `README.md` v0.1.66（ESCAPE 纪律）；模板代码 `packages/cli/templates/src/*/api/**`。

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

> 注（2026-11-09）：**#4 复开**，当前状态「待上游」，见 §7；上表为 2026-10-20 的历史快照。

---

## 3. 逐项详述

### 3.1 `like` 缺 `ESCAPE` 子句（P0）

> **订正（2026-10-20，上游复核结论）**：本节原判「`WhereCond` 的 `like` 不接受 `escape` 字段」
> 是**误报**——`like` 的 `escape` 逃生舱本就存在（白名单 `! / | ~ # @`、显式拒 `\`，见
> devkit `sql-builder-guide.md` §3.5）。真正缺的不是逃生舱，而是**业务零转义的语义化模糊匹配**：
> 每个调用点手写 `%!v!%` 式转义模式易错且三方言心智负担重。上游按此落地
> `contains` / `startswith` / `endswith`（v0.1.81），本节诉求以更彻底的形式闭环。

**为什么曾是硬约束**：框架对模糊搜索有强制纪律——`LIKE` 元字符必须转义，且**不能用 `ESCAPE '\'`**
（mysql 默认 `sql_mode` 下 `ESCAPE '\'` 直接 1064）。当时判定构造器无出口，各调用点只能回退
`db.query` 手写 `LIKE ? ESCAPE '!'`。

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

> **订正（2026-11-09）**：本节「构造器当前 `insert()` 无 `orIgnore()` 修饰，也无 `fromSelect()`」
> 是 2026-10-20 时的状态——两者已于 oj 0.1.81 落地（见 §6）。但诉求**并未闭环**：组合在 sqlite
> 仍被拒、且上游 sanctioned 的裸 SQL 绕行不可移植（MySQL 1064）。**本节 API 提议仍有效，
> 最新状态与完整闭环需求见 §7，以 §7 为准。**

**阻塞的真实代码**（本节为 2026-10-20 历史快照，`notify.ts:167-169` 与 `186-188`）：

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
4. `notify.ts:167-188` 已读回执 → `orIgnore()` / `fromSelect()`。**（未闭环：此项验收标准已由 §7.6 取代，待上游）**
5. `rate.ts:78` 限流重置 → `delete().where({ __all: true })`。
6. `demo/todos/api.ts:12` / `uninstall.ts:166` → 动态 WHERE 安全出口。
7. `session.ts:114-115` → `select("*")`。

全部关闭后，模板 `src/*/api` 内 `保留 db.query` / `保留 db.exec` 注释应归零，达成"零原生 SQL 可移植"目标。

---

## 6. 闭环状态（2026-10-20 实测，历史快照）

> **更正（2026-11-09）**：本表 #4 行与下方结论中「三方言通用」「零原生 SQL 可移植目标达成」
> 两处已被真机证伪（MySQL 1064 / PG 语法错），#4 **复开、未闭环**。完整闭环需求见 §7，以 §7 为准。
> 本表其余 6 项结论仍成立，保留作为 2026-10-20 留痕。

> 表中 `notify.ts:NN` 等行号是 **2026-10-20 的快照**，代码此后有增删（文件也已迁到
> `src/notification/api/_shared/notify.ts`）——按函数名定位，别按行号跳。

| # | 诉求 | 上游落地（版本） | 模板现状 |
|---|------|------------------|----------|
| 1 | `like` 的 `ESCAPE` 转义子句 | `contains` / `startswith` / `endswith` 语义化模糊匹配（**v0.1.81**），引擎自动转义 `%`/`_`/`!` | 已闭环：`contacts.ts` 等模糊搜索全部走 `contains`。**订正**：原判「`like` 无 escape 出口」系误报——escape 逃生舱本就存在（白名单 `! / | ~ # @`）；真正缺的是业务零转义语义 op，上游按此落地（L1 实测 `%` 元字符不泛化） |
| 2 | `join ... ON` 值条件 | join 支持表别名 + ON 值条件（**v0.1.81**）：`{ left, op, value }` 混排列对列/列对常量 | 已闭环：`notify.ts:165-168` 广播 LEFT JOIN `r.user_id = ?` 直表达 |
| 3 | `select` 字面量/计算列 | 字面量列 `{ lit, as }`（**v0.1.81**，值走绑定参数）；`expr` 任意表达式入口经上游四路评审**砍除**（计算列用现成 `case`） | 字面量部分已闭环：`notify.ts:163/177` 的 `'user'/'broadcast' as scope`。**计算列子项被设计化解掉**：广播分支第 4 列直接取 `r.read_time`，经 UNION 位置对齐落 `is_read` 列名，是否已读由 `mapItem` 按非空推导（`notify.ts:69-88` 注释同源说明）——模板侧无 `expr` 诉求残留 |
| 4 | `INSERT OR IGNORE` / `INSERT … SELECT` | `orIgnore()` 与 `fromSelect(q, cols)` 均落地（**v0.1.81**）；但**组合在 sqlite 上被明文拒绝**（v0.1.82 文档：`orIgnore with fromSelect is not supported on sqlite`，报错原文即指引绕行） | **复开（未闭环）**：VALUES 形态 upsert 已构造器化（`markRead` 等）；`markAllRead` / `clearNotices` 两处仍保留裸 `INSERT OR IGNORE … SELECT`。~~三方言通用~~ 系误判：该裸 SQL 仅 sqlite 可用，MySQL 1064 / PG 语法错（2026-11-09 真机，见 §7.3）。oj **0.1.125** 上 sqlite 组合仍被拒 |
| 5 | 全表 delete 强制 where 豁免 | `truncate()`（**v0.1.82**）：显式整表清空，渲染 `DELETE FROM t`，三方言通用 | 已闭环：`rate.ts` 限流重置改 `truncate()`；未采纳 `where({ __all: true })`（独立动词比魔法 where 值更不可误用） |
| 6 | 动态 WHERE 组合 | `whereIf(test, cond)`（**v0.1.81**）：`undefined/null/false/[]` 整条跳过（注意 `""`/`0` 是合法值会保留——可选过滤的缺失值必须归一化为 `undefined`，模板 oplog 曾踩此坑并修复） | 已闭环：`demo/todos`、`uninstall.ts` 等全部改 `whereIf`；未采纳裸片段出口（whereIf 已覆盖诉求场景） |
| 7 | `select *` | `select(["*"])`（**v0.1.81**，必须是唯一元素） | 已闭环：`session.ts` refresh 查询改 `select(["*"])` |

**结论（2026-10-20 原文，已由上方更正取代）**：模板 `src/*/api` 内 `保留 db.query` 注释归零；
`保留 db.exec` 仅剩 `notify.ts` 的 `markAllRead` / `clearNotices` 两处，
原判为「上游文档明文记载的 sqlite 组合限制绕行（非能力缺口）」，并据此宣称
「零原生 SQL 可移植」目标达成。**这两句 2026-11-09 被真机证伪**：该绕行不是非能力缺口，
而正是能力缺口本身（构造器无法表达可移植的幂等 `INSERT … SELECT`），且裸 SQL 不可移植。
**当前结论**：`保留 db.exec` 两处仍在，#4 待上游，见 §7。

> 上游侧复核记录（oj 0.1.81 release notes，devkit `oj-api-dev/README.md`）：7 条诉求落地时
> 判定「1 条误报、1 条部分误报」——误报即 §3.1 的 escape 出口（本就存在），部分误报即 §3.3
> 的计算列（`expr` 被砍，`case` 已够用）；另附赠表别名 `as()`（#8）。本表与该记录口径一致。

---

## 7. 复开需求 #4：可移植的幂等 `INSERT … SELECT`（2026-11-09，待上游）

> 本节是提交给上游 `oj` 的**闭环需求**：场景 → 遇到的问题 → 真机证据 → 根因 → 诉求 → 验收 → 边界 → 状态。
> 用户裁定「构造器缺陷向上游提需求，不是自己绕开」，故本仓本轮**不改模板修复逻辑**，待上游修复后再迁移。

| 项 | 值 |
|---|---|
| 状态 | **已闭环（上游 oj v0.1.128 + 模板侧迁移，2026-11-09 二轮）**——模板侧三项待办均已完成、三方言真机验证见 §7.8；本轮另见 §8 裸 SQL 残留普查 |
| 提交对象 | `oj` 运行时 SQL 构造器及其 devkit 手册（`api-manual.md` / `db-guide.md` / `sql-builder-guide.md`） |
| 复现环境 | `container list -a` → `oj-test-mysql`（MySQL 8.4.11，`192.168.64.2:3306`，root/root）、`oj-test-postgres`（PostgreSQL 16.15，`192.168.64.3:5432`）；sqlite 用 `sqlite3 :memory:` / `node:sqlite` |
| 相关版本 | 模板 vendor `bin/oj` = 0.1.123；PATH `oj` / `~/.local/share/oj/oj` = **0.1.125**（取证时最新）；devkit 手册刷新于 2026-11-07 |
| 关联条目 | 本文 §3.4 / §5#4 / §6#4；playbook §9「通知全部已读」、§11 **U3** |

### 7.1 业务场景

模板通知模块（`packages/cli/templates/src/app/api/notification/_shared/notify.ts`）用「一行广播 + 按人回执」模型避免按人 fan-out。两个批量动作需要「把当前租户下所有广播一次性写进当前用户的回执/隐藏表，且重复调用不产生重复行」：

- `markAllRead(uid)` → 写 `notifications_broadcast_read`（通知铃「全部已读」）
- `clearNotices(uid)` → 写 `notifications_broadcast_hidden`（通知铃「**清除**」）

二者当前都是裸 `db.exec("INSERT OR IGNORE INTO … SELECT … FROM notifications_broadcast WHERE tenant_id = ?")`。用户在 MySQL 上点「清除」即失败。

### 7.2 遇到的问题（如实记录）

1. **MySQL 1064**：`INSERT OR IGNORE` 是 sqlite 专属语法；MySQL 8.4.11 报
   `1064 (42000) … near 'OR IGNORE INTO notifications_broadcast_hidden (tenant_id, broadcast_id, user_id,'`
   —— 与用户上报的报错逐字一致。
2. **PG 语法错**：PostgreSQL 16.15 报 `ERROR: syntax error at or near "OR"`。
3. **「三方言通用」是错的（诚实账订正）**：本文 2026-10-20 闭环结论、§6 #4 行、playbook §9 / §11 U3、
   以及 `notify.ts` 注释均把这条**单语句**裸 SQL 称为「三方言通用」。事实是三方言的忽略冲突语法
   **互不相同**（sqlite `OR IGNORE` / mysql `INSERT IGNORE` / pg `ON CONFLICT DO NOTHING`），而
   `db.exec` **原样透传、不做方言改写**。此处显式更正，以上游文档/本节为准，不静默替换。
4. **构造器在 sqlite 被拒**：oj **0.1.125** 上 `db.table(...).fromSelect(...).orIgnore()` 构造期即抛
   `orIgnore with fromSelect is not supported on sqlite (its upsert clause only follows VALUES)`
   —— v0.1.82 的限制至今未解（devkit 手册仍保留该条）。
5. **`OR IGNORE` 本就是空操作**：两张回执表只有非唯一索引
   `idx_broadcast_read(user_id, broadcast_id)` / `idx_broadcast_hidden(user_id, broadcast_id)`，
   **没有** `(tenant_id, broadcast_id, user_id)` 唯一约束；sqlite 上连跑两次得到 **2 行**，
   冲突从未发生，即「幂等」从未真正生效（见 §7.3 证据）。
6. **本仓不加本地绕过**：曾按 `db.dialect()` 分派裸 SQL（mysql `INSERT IGNORE` / pg `ON CONFLICT` / sqlite `OR IGNORE`），
   被裁定为「绕过构造器缺陷」而**回退**；`notify.ts` 已恢复原始状态。

### 7.3 真机证据（可复现命令，2026-11-09）

**① 模板现状那条裸 SQL，三方言实测**（下列命令可整段复制重跑）：

```bash
# --- MySQL 8.4.11（oj-test-mysql，root/root）；表名与模板回执表同名 ---
container start oj-test-mysql
container exec oj-test-mysql mysql -uroot -proot -e "
  DROP DATABASE IF EXISTS ojm_repro; CREATE DATABASE ojm_repro; USE ojm_repro;
  CREATE TABLE notifications_broadcast (id BIGINT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(64));
  CREATE TABLE notifications_broadcast_hidden (id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(64), broadcast_id BIGINT, user_id BIGINT, create_time VARCHAR(64));
  INSERT INTO notifications_broadcast (tenant_id) VALUES ('default');
  INSERT OR IGNORE INTO notifications_broadcast_hidden (tenant_id, broadcast_id, user_id, create_time)
    SELECT tenant_id, id, 7, 'x' FROM notifications_broadcast WHERE tenant_id = 'default';"
# → ERROR 1064 (42000) ... near 'OR IGNORE INTO notifications_broadcast_hidden (tenant_id, broadcast_id, user_id,' at line 1

# --- PostgreSQL 16.15（oj-test-postgres）；用最小同形表 nb / nbr ---
container start oj-test-postgres
container exec oj-test-postgres psql -U postgres -q -c "DROP DATABASE IF EXISTS ojm_repro" -c "CREATE DATABASE ojm_repro"
container exec oj-test-postgres psql -U postgres -d ojm_repro -q -c "
  CREATE TABLE nb (id BIGSERIAL PRIMARY KEY, tenant_id TEXT);
  CREATE TABLE nbr (id BIGSERIAL PRIMARY KEY, tenant_id TEXT, broadcast_id BIGINT, user_id BIGINT, read_time TEXT);
  INSERT INTO nb (tenant_id) VALUES ('default');
  INSERT OR IGNORE INTO nbr (tenant_id, broadcast_id, user_id, read_time)
    SELECT tenant_id, id, 7, 'x' FROM nb WHERE tenant_id = 'default';"
# → ERROR: syntax error at or near "OR"

# --- sqlite（sqlite3 :memory:）；同一语句连跑两次看去重 ---
sqlite3 :memory: "
  CREATE TABLE nb (id INTEGER PRIMARY KEY, tenant_id TEXT);
  CREATE TABLE nbr (id INTEGER PRIMARY KEY, tenant_id TEXT, broadcast_id INTEGER, user_id INTEGER, read_time TEXT);
  INSERT INTO nb (tenant_id) VALUES ('default');
  INSERT OR IGNORE INTO nbr (tenant_id,broadcast_id,user_id,read_time) SELECT tenant_id,id,7,'x' FROM nb WHERE tenant_id='default';
  INSERT OR IGNORE INTO nbr (tenant_id,broadcast_id,user_id,read_time) SELECT tenant_id,id,7,'x' FROM nb WHERE tenant_id='default';
  SELECT 'rows after 2 runs = '||count(*) FROM nbr;"
# → OK；rows after 2 runs = 2（无唯一约束 ⇒ OR IGNORE 空操作）
```

结论汇总：sqlite **OK**（但去重空操作）；MySQL 8.4.11 **ERROR 1064**；PG 16.15 **syntax error at or near "OR"**。

**② 三方言各自的「可移植形态」确实存在**（证明这是构造器缺口，不是引擎限制）：

| 方言 | 命令片段 | 结果 |
|---|---|---|
| MySQL | `INSERT IGNORE INTO … SELECT …` | OK |
| PG | `INSERT INTO … SELECT … ON CONFLICT DO NOTHING` | OK |
| sqlite | `INSERT OR IGNORE INTO … SELECT …` | OK（但去重空操作，见 ①） |

**③ 构造器 `fromSelect().orIgnore()` 探针**（`oj exec -c <dsn> --module-root <模板 src/app/api> probe.ts`，oj 0.1.125；
探针源 `select(["id", {lit:7,as:"user_id"}, {lit:"…",as:"read_time"}])`，目标列 `["broadcast_id","user_id","read_time"]`）：

| 方言 | 构造器行为 | 渲染 / 报错 |
|---|---|---|
| sqlite | **构造期拒绝** | `orIgnore with fromSelect is not supported on sqlite (its upsert clause only follows VALUES)` |
| MySQL | 允许组合、渲染 SQL | `… ON DUPLICATE KEY UPDATE id = id` → `1052 (23000) Column 'id' in field list is ambiguous` |
| PG | 允许组合、渲染 SQL | `CAST($1 AS TEXT) AS "user_id"` → `column "user_id" is of type bigint but expression is of type text` |

> ③ 中 mysql/pg 两条失败与探针形状相关（源列含 `id`、`lit` 注入数字常量），但该形状正是模板所需
> （`broadcast_id` 来自广播 `id`，`user_id`/时间戳来自请求侧 JS 变量），故一并列为上游需核实子项，
> 不据此断言「mysql/pg 可用」。**可确认的事实**：组合只在 sqlite 被构造期拒绝，mysql/pg 至少能渲染出 SQL。

### 7.4 根因

三方言**都具备**幂等 `INSERT … SELECT` 的可移植形态（§7.3②），但语法各不相同；构造器的
`orIgnore()` 只跟随 VALUES、`fromSelect()` 的 SELECT 源在 sqlite 上不允许叠加冲突子句，
而 `db.exec` 又是原样透传不做方言翻译——于是「用构造器写出一条三方言通用、且真幂等的
`INSERT … SELECT`」目前**无路可走**。上游手册把 sqlite 专属裸 SQL 记作 sanctioned 绕行并误标
「三方言通用」，是这个缺口的直接来源。

### 7.5 对上游的诉求

1. **P0 — sqlite 支持 `fromSelect().orIgnore()`**（或提供方言无关的 ignore-insert 表达式），使同一段构造器代码三方言都能构造并执行。对应 playbook §11 **U3**。
2. **P0 — `fromSelect` 能注入请求侧常量且类型正确**：当前 `lit` 列在 pg 渲染 `CAST($ AS TEXT)`、mysql 渲染 `CAST(? AS CHAR)`，写入 `BIGINT` 列在 pg 直接报错。模板必须把 `uid` / 时间戳注入源 SELECT，这是刚需。
3. **P1 — mysql `ON DUPLICATE KEY UPDATE` 列限定**：渲染 `… ON DUPLICATE KEY UPDATE id = id` 在源 SELECT 含 `id` 列时报 1052；应生成限定名或 `VALUES(...)` 形式。
4. **P1 — 订正上游文档**：`api-manual.md` / `db-guide.md` / `sql-builder-guide.md` 中「绕行走裸 `insert or ignore … select`」及其可移植性暗示，应明确标注**仅 sqlite 可用**，mysql/pg 会直接语法错；否则下游据此写出的模板换库必炸。本仓 `docs/devkit/oj-api-dev/*` 为上游快照，只读，不在此改动。
5. **P2 — 明确 `orIgnore` 依赖唯一键**：请在文档/校验中说明「无唯一约束时冲突子句不生效」；模板侧补唯一约束属本仓后续动作（§7.7）。

### 7.6 验收标准（上游修复后本仓可关闭的回退点）

1. 同一段构造器代码 `db.table("notifications_broadcast_read").fromSelect(src, cols).orIgnore().run()` 在
   **sqlite / mysql / pg 三者都构造成功并执行成功**（`src` 含 `lit` 注入的 uid 与时间戳，目标列为 BIGINT/TEXT 混合）。
2. `notify.ts` 的 `markAllRead` / `clearNotices` 两处 `db.exec` 裸 SQL 删除，文件内 `保留 db.exec` 注释归零。
3. 「通知铃 清除 / 全部已读」在 mysql / pg 真机不再 1064 / 语法错；连点两次不产生重复回执行（配合唯一约束）。
4. 模板后端单测 / e2e / `ojm api --check` 全绿。

### 7.7 范围与边界

- **本仓本轮不改模板**：`notify.ts` 已回退到原始状态（无 `db.dialect()` 分支、无本地方言分派）；构造器缺陷按裁定走上游需求。
- 唯一约束 `(tenant_id, broadcast_id, user_id)` 的迁移（3 方言 × 2 表）属本仓后续动作，随上游修复一并处理，本轮不动。
- 上游修复前，模板在 MySQL / PG 上的「清除 / 全部已读」**已知失败**（§7.2#1#2），不以本地绕过掩盖。

### 7.8 状态

**已闭环（上游回复，2026-11-09）**：上游 `oj` **v0.1.128** 已发布（tag 已推送）并逐条覆盖本节 §7.5 诉求：

| §7.5 诉求 | v0.1.128 落地 | 验收状态 |
|---|---|---|
| P0 sqlite 支持 `fromSelect().orIgnore()` | 渲染 `INSERT OR IGNORE INTO … SELECT …`（冲突**解决**子句可跟 SELECT——upsert 子句只能跟 VALUES，但二者是不同语法槽位，v0.1.82 拒绝时漏掉了它） | ✅ 构造+执行成功 |
| P0 `fromSelect` 注入请求侧常量且类型正确 | pg 在 INSERT 直接源渲染裸 `$n`，类型由 INSERT 目标列推断（`lit(7)` 灌 BIGINT 不再报 TEXT→bigint 错；bigint/text 混合真机 PREPARE 验证可推断）；mysql `CAST(? AS CHAR)` 隐式转数值可用；sqlite 裸 `?` 走列 affinity | ✅ 三方言全过 |
| P1 mysql 1052 歧义 | fromSelect 形态改渲染 `INSERT IGNORE`——无赋值子句即无 1052 附着点；不再要求主键 | ✅ MySQL 8.4.11 真机过 |
| P1 文档订正 | devkit 四件 + `docs/api/06-db.md` 全部改写：删「sqlite 不支持」条目、「绕行走裸 `db.exec`」及其可移植性暗示；新增「只幂等唯一键冲突」与跨方言语义宽度说明 | ✅ |
| P2 orIgnore 依赖唯一键 | 文档已明示；且本仓唯一约束迁移仍是模板侧动作（见下） | ✅ 文档义务已尽 |

**上游验收证据**（`oj` 仓 `from_select_or_ignore_idempotent_all_dialects`，CI 无真库恒 skip、本机容器亲跑）：
sqlite / PG 16.15 / MySQL 8.4.11 三方言 ×（普通表 + 租户守卫表）共 6 腿 PASS——同一段构造器 JS
跑 3 次仍 2 行 + 首跑 `affected == 2`（吞行哨兵）。

**模板侧后续动作（本仓，2026-11-09 二轮：三项均已完成）**：
1. ✅ `notify.ts` 的 `markAllRead` / `clearNotices` 两处裸 `db.exec` 已迁移到构造器
   `db.table("notifications_broadcast_read").fromSelect(src, cols).orIgnore().run()`（hidden 表同形）；
   `NotifyDb` 接口只留 `table`，`db.exec` / `db.query` 声明移除。
2. ✅ 两张回执表补 `(tenant_id, broadcast_id, user_id)` 唯一约束：新增
   `0006__notifications_broadcast_unique.sql` + `.mysql.sql` + `.pg.sql`（先按唯一键去重旧行再建
   唯一索引/键；mysql 用 `ADD UNIQUE KEY` 绕开「无 `CREATE UNIQUE INDEX IF NOT EXISTS`」）。
3. ✅ `packages/cli/src/vendor.ts` 的 `MIN_OJ_VERSION` 由 `0.1.126` 抬到 **`0.1.128`**
   （注释记 `0.2.79`）；本地 gitignored `bin/oj` 与三处 `.oj-version` 同步到 `v0.1.128`。

**本轮真机验证证据（2026-11-09 二轮）**：

| 层 | 载体 / 命令 | 结果 |
|---|---|---|
| 三方言迁移 | `oj migrate notification`（tenant-enabled `verify-{sqlite,mysql,pg}.yaml`） | 三者均 `6 applied`，含新 `V6__notifications_broadcast_unique` |
| 真实函数 · 三方言 | `oj exec` 以 `file://` 绝对路径加载**真实** `notify.ts`，`markAllRead` / `clearNotices` 各连跑两次 | 三方言均 `reads=3 / hidden=3`（3 条广播、不重复）、`tenant_id='default'`、`user_id=42`、列对齐；MySQL 无 1064、PG 无语法错 |
| 方言渲染 | 同探针 `toSQL()` | sqlite `INSERT OR IGNORE … SELECT`；mysql `INSERT IGNORE … SELECT`（无 `ON DUPLICATE KEY UPDATE` 歧义）；pg `… SELECT $1 … ON CONFLICT DO NOTHING`（裸 `$n`，类型由目标列推断） |
| 真实 HTTP + 租户注入 | `pnpm test:e2e tests/e2e/templates/notification.spec.ts` | **5 passed**；`POST /api/notification/notifications/clear` → 200，SQL trace 显示构造器自动注入 `(…, "tenant_id")` 与源 select 的 `WHERE "notifications_broadcast"."tenant_id" = ?`（`params=4`、`rows=2`），清空后列表 `rows=0` |
| 静态 / 契约 | `typecheck:api`、模板 `typecheck`、vitest、`ojm api --check` | 全绿；`--check` = `0 error / 0 warn` |

> **验证边界（如实记录）**：上表「真实函数 · 三方言」用 `oj exec` 直连 DB，oj exec 无 HTTP 请求上下文，
> 须先 `db.asSystem()` 才能查租户表（实测 `db.asTenant()` 被拒「only allowed on anonymous requests」、
> 直接给 `globalThis.http` 赋 `tenantId` / `headers` 均不生效）。该探针覆盖**方言渲染 + 唯一约束幂等 + 列对齐**，
> 不覆盖 tenant 自动注入与源 select 租户收窄；后者由本表 e2e 行（真实 HTTP + `X-TENANT-ID`）与
> vitest 夹具用例 `notification-bulk-idempotent.spec.ts` 覆盖，二者互相印证。

**两个必须记住的语义点（已写进 `notify.ts` 注释）**：
- **只幂等唯一键冲突**——措辞别用笼统的「幂等」；
- **故障模式跨方言相反**——pg 上 NOT NULL/CHECK 违例照常报错，sqlite/mysql 的宽形态
  （OR IGNORE / INSERT IGNORE）对同样脏数据**静默丢行**；mysql 内部 VALUES（窄）/
  fromSelect（宽）两形态宽度不同，均为有意保留。

复开登记 2026-11-09；上游修复同日到达；模板侧迁移与三方言真机验证 2026-11-09 二轮完成，
本节 **已闭环**，进度跟踪 playbook §11 U3 同步改为已闭环。本轮另起的裸 SQL 残留普查见本文 §8。

---

## 8. 模板后端裸 SQL 残留普查与构造器统一性验证（2026-11-09 二轮）

> 用户诉求：「统计下，还有哪些场景未采用 sql builder 进行统一实现，并验证是否可以采用 sql builder
> 进行统一，若无法采用 sql builder 则验证上游是否有功能未实现，提出需求」。
> 本节**只统计 / 验证 / 提需求，不改任何实现代码**（§7 的迁移改动属上一节，已完成）。

### 8.1 统计口径与计数（可复现）

**统计口径（固定 pattern / 范围 / 大小写，跨轮次沿用）**：

- 范围：`packages/cli/templates/src/app/api/**`，glob `*.ts`（模板后端全部源码）。
- 载体检索：Grep 工具 `output_mode: content`，pattern `(?i)db\.(exec|query|dialect|raw)\s*\(`（`(?i)` = 大小写不敏感）→ **命中 5 行**。
- 逐行核对：其中 **4 处真实调用**（§8.2 清单）、**1 行注释**（`rate.ts:79`「取代裸 db.exec…」，说明该处**已改构造器**，排除）。
- 交叉核对：pattern `(?i)(select\s|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table|alter\s+table|drop\s+table)`，glob `*.ts` → 命中 5 行（2 行真实 DELETE + 3 行注释），与载体检索一致。
- 变体检索：`toSQL(` / `.raw(` / `db["query"]` / `db.dialect(` → 0 命中，模板后端不存在「构造器生成 SQL 再裸执行」的中间形态。
- 等价复现命令：`rg -n -i 'db\.(exec|query|dialect|raw)\s*\(' packages/cli/templates/src/app/api -g '*.ts'`（逐行核对得 5 命中 / 4 真实调用）。

> 口径纪律（沿用本仓「取证计数」约定）：数字来自单一 pattern、单一范围、注明 `(?i)`，且每个数字都能
> 对到 §8.2 的 `文件:行号` 清单；不眼估、不混大小写口径。

### 8.2 场景清单（4 处真实调用，按场景归并）

| # | 文件:行号 | 语句 | 用途 | 场景 |
|---|---|---|---|---|
| A1 | `auth/_shared/wecom/store.ts:134` | `db.exec("DELETE FROM sys_refresh_token WHERE tenant_id = ?", [tenantId])` | `revokeTenantSessions`：吊销指定企业租户全部 refresh token | A 跨租户删除 |
| A2 | `auth/_shared/wecom/tenant-admin.ts:182` | `db.exec("DELETE FROM sys_refresh_token WHERE tenant_id = ? AND user_id = ?", [tenantId, row.id])` | 重设租户管理员密码后失效其旧会话 | A 跨租户删除 |
| B1 | `_platform/_shared/service/infra/query.ts:40` | `db.query(countSql, params)` | 旧 `paged` 分页的 count 查询（接受任意 SQL 片段） | B 任意 SQL 分页 |
| B2 | `_platform/_shared/service/infra/query.ts:41` | `db.query(listSql + " limit ? offset ?", [...])` | 旧 `paged` 分页的 list 查询 | B 任意 SQL 分页 |

**普查附带发现（如实记录，不计入上表）**：

- `paged`（B1/B2 所在函数）在生产代码**零调用方**：Grep `\bpaged\b` 全 `packages/cli/templates` 只命中
  `query.ts` 的定义/注释与 `tests/query-utils.spec.ts` 的测试调用；所有列表接口走构造器版
  `pagedFactory`（`publish/api.ts:135`、`oplog.ts:40`）。即 B 是**仅测试引用的残留代码**，不是活跃裸 SQL 场景。
- `_lifecycle/verify-checks.ts:2` 注释称「迁移账本走 db.query + journalHeadOf」，与实现不符：
  `journalHeadOf` 实际是 `db.table("_oj_migrations").select([{ fn: "max", … }])`（`site-facade.ts:181`）构造器。
  注释过时、非裸 SQL 场景；按「不静默替换」原则记录，不在此改实现。
- 模板后端其余 DB 访问均为 `db.table(...)` 构造器（含 `db.tx` / `truncate()` / `db.listTables` 等构造器面），
  无 `db.dialect()` 分支、无 `toSQL()` + `db.query` 组合。

### 8.3 逐场景「能否用构造器统一」验证（oj 0.1.128 真机，三方言）

验证载体：`oj exec -c /tmp/ojm-probe/verify-{sqlite,mysql,pg}.yaml --module-root packages/cli/templates/src/app/api <probe>.ts`；
三份 config 均 `tenant.enable: true` + `sql_guard: deny`，sqlite 走本地文件、mysql = `oj-test-mysql`(8.4.11)、
pg = `oj-test-postgres`(16.15)。探针以 `file://` 绝对路径加载**真实源码模块**。

| 探针 | 场景 | 三方言结果 | 结论 |
|---|---|---|---|
| **Probe C** | B：`paged`(裸 SQL) vs `pagedFactory`(构造器) 对同表分页 | 三者均 `total=5, ids=[13,12], truncated=true`，**两者完全一致** | ✅ 能统一，且生产已统一；`paged` 无生产调用方，无上游缺口 |
| **Probe B** | A：无 `asSystem` 时构造器直查租户表 | 三者均 `tenant guard: … require tenant context (missing tenant header; use db.asSystem() for system tasks)` | 构造器在 `deny` 下强制租户上下文 |
| **Probe B** | A：`db.asSystem()` + `db.table("t").where({tenant_id:"other"}).delete()` | 三者均 `affected=2`、精确删掉 other 两行、`toSQL` 为 `DELETE FROM t WHERE tenant_id = ?`（**无自动注入**） | ✅ 纯技术上能用构造器统一 |
| **Probe B** | A：`asSystem` 后不带 where 的构造器查询 | 三者 `SELECT id FROM t LIMIT ?` **无 tenant 注入**、count 含 other 租户数据 | ⚠️ `asSystem` 是**请求级全关**，粒度粗 |

**场景 A 的分层结论（诚实账，不合并成一句「能/不能」）**：

1. **纯技术**：能。`db.asSystem().table("sys_refresh_token").where({tenant_id:…}).delete().run()` 三方言可行（Probe B）。
2. **在模板现有安全纪律下**：不能「干净地」统一。`db.asSystem()` 会把**本请求全部**构造器查询的租户防护关掉
   （Probe B 实证），而模板把它定为「全仓唯一、不得复制」（`tenant-admin.ts:17-31`，且该文件已因
   「平台开通动作」用过一次）；`db.asTenant(id)` 仅限**匿名请求**且**不绕过**防护（`global.d.ts:910-913`，
   `oj exec` 实测被拒）。故 `store.ts` / `tenant-admin.ts` 改用「带 `tenant_id` 条件的裸 `db.exec`」——
   它只依赖裸 SQL 守卫的**文本级 best-effort check-on-miss**（`db-guide.md:236-242`），范围限这一条语句、
   不扩大到整个请求，是有意且被注释论证过的选择（`store.ts:126-135`、`tenant-admin.ts:180-182`）。
3. **上游是否「功能未实现」**：**不是 bug 级缺失**——跨租户能力由 `db.asSystem()` 官方提供
   （`SKILL.md:280`、`db-guide.md:244-246` 明确「跨租户操作走 `await db.asSystem()`」）。
   但存在**能力粒度缺口**（见 §8.5）。

### 8.4 上游能力核实

| 核实项 | 依据 | 结论 |
|---|---|---|
| 构造器在 `deny` 下对 delete 自动注入当前租户 | `db-guide.md:209-221`：select/update/delete 追加 `{别名}.tenant_id = ?`；insert 强制写当前租户；跨租户读写被守卫拦截 | 官方明文档设计，非 bug |
| 跨租户操作的官方通道 | `SKILL.md:280`「跨租户操作（对账/报表）走 `await db.asSystem()`」；`db-guide.md:244-246`「两个逃生口」 | 上游已有能力 |
| `asSystem` 粒度 | `db-guide.md:244`「**请求级**绕过、ReqState 重置即失效」；Probe B 真机 | 请求级全关，非语句级 |
| `asTenant` 门禁 | `global.d.ts:910-913`（三道门禁：开关 / 匿名请求 / id 非空，请求级一次）；`oj exec` 实测 `only allowed on anonymous requests` | 不适用于「普通请求里按服务端派生 id 写别的租户」 |
| 裸 SQL 守卫强度 | `db-guide.md:236-242`「文本级 best-effort，不等于语义分析」，并建议 `use db.table() builder` | 模板 A 场景依赖的是较弱的一层 |

### 8.5 新需求 #5（增强诉求，非阻塞、非 bug）：语句级构造器跨租户身份

| 项 | 值 |
|---|---|
| 状态 | **待上游（2026-11-09 提出）** |
| 提交对象 | `oj` 运行时 SQL 构造器租户守卫（`DBInstance` / `QueryBuilder`） |
| 关联 | 本文 §8.3 场景 A；playbook §9（`oj exec` 验证坑行） |
| 优先级 | P2 增强（不阻塞现网：模板 2 处裸 SQL 当前工作正常且被注释论证） |

**场景**：服务端派生的租户 id（企微 `corp_id`、租户管理员重设）需要在**普通请求**里对「非当前请求租户」做窄范围写（删该租户的 refresh token），且不希望把整个请求的租户防护关掉。

**问题**：上游只有两极——`asSystem()`（请求级**全关**，粒度太粗、模板纪律禁止复制）与
`asTenant(id)`（仅匿名请求且**不绕过**防护，租户条件照常注入）。缺一个「语句级 / 查询级」的
构造器跨租户身份：让**单条**构造器语句以指定租户 id 执行、仍受结构化条件约束，其余语句照常注入当前租户。

**诉求（任选其一形态即可）**：

1. `db.forTenant(id).table("t").where(…).delete().run()` —— 返回语句级作用域实例，本语句的租户注入值取 `id`（服务端派生），语句结束即失效；
2. 或 `db.table("t").asTenant(id).where(…).delete().run()` —— 构造器链上的单语句租户覆盖；
3. 或放宽 `asTenant` 的「仅匿名请求」门禁，允许「系统任务 + 服务端派生 id」在普通请求里声明，但仍**不关闭**租户条件注入（只换注入值，不关防护）。

**红线（必须保持）**：

- 租户 id 必须服务端派生，**绝不可**取请求参数（`global.d.ts:910-913` 现有红线）；
- 不得演变成「请求级全关」的第二个 `asSystem`；
- 结构化条件注入照常生效（不能变成纯裸 SQL 文本检查）。

**验收标准**：

1. 同一条构造器语句能以指定租户 id 精确读写，且**同请求内另一条普通构造器语句仍注入当前租户**（证明非请求级全关）；
2. 三方言（sqlite / mysql / pg）行为一致；
3. 上游落地后，模板可把 A1/A2 两处裸 `db.exec` 收敛为构造器，并删除 `store.ts:126-135` /
   `tenant-admin.ts:180-182` 的「保留裸 SQL」注释论证，达成模板后端**零原生 SQL**。

### 8.6 结论汇总

| 场景 | 处数 | 能否用构造器统一 | 上游缺口 | 本轮动作 |
|---|---|---|---|---|
| B 任意 SQL 分页（`query.ts` `paged`） | 2 | ✅ 能，且生产已统一（`pagedFactory`，Probe C 三方言等价） | 无 | 仅统计/验证；`paged` 仅测试引用、零生产调用方，按「不改实现代码」未删除 |
| A 跨租户删除（`store.ts` / `tenant-admin.ts`） | 2 | ⚠️ 技术能（asSystem + 构造器），但模板安全纪律下不能干净统一（asSystem 请求级全关、不得复制） | 非 bug 级；缺「语句级构造器跨租户身份」增强能力 → **需求 #5** | 形成 §8.5 闭环需求；不本地绕过、不改实现 |
| 注释 / 过时描述 | 3 行 | — | — | 如实记录（`rate.ts:79`、`verify-checks.ts:2`），不静默替换 |

> 本仓方法约束（用户裁定）：「db 构造器如果存在缺陷，需要向上游提出需求，不是自己绕开」。
> 场景 A 现状是模板用裸 SQL 绕开构造器限制，故本节按该约束把缺口整理成 §8.5 需求提交上游，
> **不在模板内增加方言分支 / 旁路 / 兼容 shim**。
