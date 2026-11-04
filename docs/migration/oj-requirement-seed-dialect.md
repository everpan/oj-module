# 上游需求草案：seed 按数据库方言选择文件（`seed.<dialect>.sql`）

> 状态：**已落地**（2026-11-05 起草；上游 `oj-bin` 提交 `7d70b90` / tag `v0.1.121`）。
> 本仓关联：`docs/prd/framework-verification-playbook.md` §9「保留字让 seed 无法三方言共用一份」、
> §11 **U1**（本条即 U1 的正式化提案）。
> 命名与迁移的文件级方言覆盖**完全同构**（`{seq:04}__{desc}.{dialect}.sql`），见 §3 最后一行。
> 落地口径：`seed.<sqlite|mysql|pg>.sql` 存在即胜出、`seed.sql` 兜底、绝不双跑；不匹配/错名 warn，
> S003/S006 覆盖全部变体且幂等判据按文件方言。§11 的四个开放问题按本文建议全部采纳。

## 1. 结论

请 oj 内核在启动重放 seed 时，按**运行时数据库方言**选文件：

| 当前方言 | 候选（按优先级） | 实际执行 |
| --- | --- | --- |
| sqlite | `seed.sqlite.sql` → `seed.sql` | 前者存在就只跑前者 |
| mysql | `seed.mysql.sql` → `seed.sql` | 同上 |
| pg | `seed.pg.sql` → `seed.sql` | 同上 |

方言件存在即**胜出**，通用件只兜底、**绝不双跑**（与迁移方言覆盖的「胜出/兜底」语义一字不差）。
这样模板里的方言 seed 从「部署期手工覆盖成 `seed.sql`」变成「放好就行」，`ojm init` 出来的工程
在 mysql / pg 上开箱可起。

## 2. 痛点：为什么一份 SQL 撑不住三方言

三条都是本仓 2026-11 真库演练的实锤，不是假设。

**(a) 同一份文件在 mysql / pg 上直接语法错 → 拒启。** 用户实际遇到的报错：

```
ERROR seed failed: db exec: error returned from database: 1064 (42000):
You have an error in your SQL syntax; ... near 'key, module, `group`, type, value, ...' at line 2
module="_platform" file=.../src/app/api/_platform/seed.sql seq=0
oj serve: seed …: db exec: …
```

两处都是「一份 SQL 走三家」必然踩的坑：

- 幂等写法：sqlite 的 `INSERT OR IGNORE` 在 mysql/pg 上不合法（内核已用 `translate_insert`
  改写，但只要语句形态稍偏——比如作者为了方言差异自己写了 `INSERT IGNORE`——就漏改）；
- **保留字**：`sys_setting` 的列 `key`，mysql 必须 `` `key` ``，pg / sqlite 用 `"key"`。
  同一份文本无法同时满足；本次 `_platform` / `home` / `notification` 三个模块都被迫整段重写方言件。

**(b) 没有匹配文件时静默跳过。** 把 `seed.sql` 移走后起服**成功、无任何 seed 日志**，
22 条 `sys_setting` 一条没灌，直到登录页/设置页异常才被发现。「没灌」比「灌失败」更难查。

**(c) 部署期覆盖约定不可持续。** 现约定是「部署到 mysql/pg 时把 `seed.mysql.sql` 覆盖成
`seed.sql`」，后果：

- 覆盖是手工动作，模板升级 / 重新 init 会把它冲掉，谁也不知道自己跑的是哪份；
- 为了「让覆盖有东西可覆盖」，工程根又多出一份方言副本 → 与模块内真件漂移。本仓实测：
  根级副本只有 **4 条** sys_setting（模块内真件 **22 条**），且 mysql 侧裸写 `key`——
  照文档部署**必炸**，而这个坏副本躺了大半年没被发现（它没有任何执行路径天天跑）；
- 已经发生两次事故：一次是模块内基础件被当方言件跑（`seq=15`），一次是根级坏副本被拷成
  `seed.sql`（`seq=0`、`line 2`，即上面那条报错）。

结论：**方言差异必须由内核按方言选文件解决**，靠部署纪律绕不过去。

## 3. 现状取证

| 位置 | 行为 | 方言感知 |
| --- | --- | --- |
| `oj/src/seed.rs:17` | `const SEED_FILE: &str = "seed.sql";` | 单文件名，无候选 |
| `oj/src/seed.rs:25` `collect()` | 每个模块根拼 `SEED_FILE` | 无（调用时还不知道方言） |
| `oj/src/seed.rs:192` `replay_all()` | 已知 `db.dialect()`，但只用于 `translate_insert` | 部分 |
| `oj/src/seed.rs:160` `translate_insert()` | 只把 `INSERT OR IGNORE` 改写成方言写法，其余原样透传 | 有（说明方言件写原生 SQL 是安全的） |
| `oj/src/checks.rs:119` / `:236` | S003（跨模块表引用）、S006（禁 DDL / 禁非幂等 / 归属）只读 `seed.sql` | 无 |
| `oj/src/checks.rs:418` `insert_is_idempotent()` | 认 `OR IGNORE` / `OR REPLACE` / `ON CONFLICT` / `ON DUPLICATE KEY` | **不认 mysql 原生 `INSERT IGNORE`** |
| `oj/src/build_cmd.rs:752` | dist 白名单 `name.ends_with(".sql")` | 已覆盖，**无需改** |
| `oj/src/migrate.rs:230` `parse_file_name()` | 迁移文件名 `{seq:04}__{desc}[.{sqlite\|mysql\|pg}].sql` | **已有同构约定** |
| `oj/src/migrate.rs:306` 方言选择 | 方言件胜、通用件兜底、别的方言跳过 | **可直接复用语义** |

`seed.rs` 文件头注释（第 1-8 行）已经把「三方言都重放」写在明面上，缺的只是文件名维度。

## 4. 行为契约（P0，内核）

### 4.1 选择规则

以「模块目录下实际存在哪些文件」×「当前方言」决定，**不合并、不双跑**：

| 模块目录有 | 方言 = sqlite | mysql | pg |
| --- | --- | --- | --- |
| 只有 `seed.sql` | 跑它 | 跑它 | 跑它（**老工程行为不变**） |
| `seed.sql` + `seed.<d>.sql` | 只跑 `seed.sqlite.sql` | 只跑 `seed.mysql.sql` | 只跑 `seed.pg.sql` |
| 只有 `seed.<d>.sql` | 跑它 | 跑它 | 跑它 |
| 只有**别的**方言件（如只有 `seed.mysql.sql`，当前 sqlite） | 不跑 + **warn 点名** | — | — |
| 一份都没有 | 静默（多数业务模块没有 seed，不能吵） | 同左 | 同左 |
| 方言未知（`oracle` 等） | **fail-loud**（现行为保留，见 4.5） | | |

### 4.2 幂等改写照旧

选定文件后仍走 `translate_insert(stmt, dialect)`：方言件写 `INSERT OR IGNORE` 会被自动改写，
写原生 `INSERT IGNORE` / `ON CONFLICT DO NOTHING` 则原样透传。**方言件不必被迫写原生语法**，
作者按顺手来。

### 4.3 日志：成功也要能看出跑了哪份

现在成功是「按文件合并一条 info（`module` + `stmts`）」，失败才有 `file=`。
本次事故里正是靠 `file=..._platform/seed.sql` 才定位到「跑错文件」，成功路径同样需要：

```
seed ok module=_platform file=src/app/api/_platform/seed.mysql.sql dialect=mysql stmts=22
```

失败日志保持现状（已有 `file`/`seq`/`stmt`）。

### 4.4 静态检查覆盖全部变体（S003 / S006）

- `seed_files(mdir)` 返回模块下**所有**候选（`seed.sql` 与三个方言件中实际存在的）；
- S003（引用他模块表未声明 deps）、S006（DDL / 非幂等 / 他模块表）逐文件检查，
  错误文案用**真实文件名**——现在文案里硬编码了「seed.sql」四个字，会误导排查；
- `insert_is_idempotent()` 补 mysql 原生写法：`INSERT IGNORE`（注意 `INSERT IGNORED`
  这种前缀相同但不是关键字的串，用词边界判定，别沿用裸 `contains` 的粗判）；
- 豁免机制沿用 `oj:allow-table=`（SQL 注释即文本）的风格，不引入新配置项。

### 4.5 顺带修一个门控顺序

`replay_all()` 目前是「`collect` → 无 seed 就 `return Ok` → 才做未知方言门控」。
于是**零 seed 的工程配 oracle 方言时不会 fail**。方言选择挪到 `collect` 之前后，
门控必须一起前置（`Dialect::known` 不通过就先报错），否则这个洞会被放大。

### 4.6 缺口告警（不是全量 warn）

「模块没有任何 seed」是常态（业务模块大多不灌种子），不能全量 warn；只在下面这一种情形告警：

> 模块目录里存在 `seed.<x>.sql`，但当前方言既没有对应的 `seed.<d>.sql`，也没有通用
> `seed.sql` → `warn: seed skipped: <模块> 只有 seed.mysql.sql，当前方言 sqlite 无匹配`

这条正好覆盖「以为灌了其实没灌」（痛点 b）。

## 5. 明确不做

| 不做 | 理由 |
| --- | --- |
| 运行时把通用件与方言件**合并执行** | 违背幂等假设（同一行插两遍），且会掩盖「方言件漏写某条」 |
| 内核自动生成/拼接方言 SQL | 保留字引号、函数、`ON CONFLICT` 形态差异太大，猜错比报错更难查 |
| 支持 `seed/` 目录多文件切分 | 与「按 `;` 朴素切分、注释内禁分号」的既有约束打架，收益低 |
| 为老工程保留「方言件存在时也跑通用件」的双路径 | 老工程只有 `seed.sql` 时行为完全不变，不需要额外兼容层 |

## 6. 落点与改法（骨架）

```rust
// seed.rs —— 候选表与选择（片段）
const SEED_GENERIC: &str = "seed.sql";

fn dialect_seed_file(d: Dialect) -> Option<&'static str> {
    match d {
        Dialect::Sqlite => Some("seed.sqlite.sql"),
        Dialect::MySql => Some("seed.mysql.sql"),
        Dialect::Postgres => Some("seed.pg.sql"),
    }
}

/// 返回 (模块名, 实际文件, 是否为方言件)；方言件存在即胜出。
pub fn collect(dir: &Path, index: Option<&ModuleIndex>, d: Dialect)
    -> (Vec<(String, PathBuf, bool)>, Vec<String>)   // 第二项 = 缺口告警
```

```rust
// checks.rs —— 逐变体检查（片段）
fn seed_files(mdir: &Path) -> Vec<PathBuf> {
    ["seed.sql", "seed.sqlite.sql", "seed.mysql.sql", "seed.pg.sql"]
        .iter().map(|n| mdir.join(n)).filter(|p| p.is_file()).collect()
}
```

复用而非复制：`migrate.rs:334` 的 `dialect_tag()` 提为 `pub(crate)`，两处共用同一份
「方言 → 文件名标签」映射（DRY，避免 seed 与迁移各写一套 `"mysql"/"pg"/"sqlite"` 字符串）。

改动量估计：`seed.rs` 约 60-90 行、`checks.rs` 约 40 行、`migrate.rs` 1 行（提权）、
用例约 10 条、文档 6 篇（§9 第 3 条）。

## 7. 验收用例（BDD / INVEST）

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | 模块只有 `seed.sql`（老工程） | 任一方言起服 | 执行它，行数与 0.1.120 一致（**零回归**） |
| 2 | 模块有 `seed.sql` + `seed.mysql.sql`（两份内容不同） | mysql 起服 | 只执行 mysql 件；用「同一唯一键插不同值」断言通用件未被跑 |
| 3 | 同上 | sqlite 起服 | 只执行 `seed.sql` |
| 4 | 模块**只有** `seed.pg.sql` | pg 起服 | 执行它，成功 |
| 5 | 模块只有 `seed.mysql.sql` | sqlite 起服 | 不执行 + 一条 warn，文案含模块名、实际存在的文件、当前方言 |
| 6 | 模块无任何 seed | 起服 | 静默（无 warn 噪音） |
| 7 | 工程配 `oracle` 且**零 seed** | 起服 | fail-loud 报方言不支持（修 4.5 的顺序洞） |
| 8 | `seed.mysql.sql` 用原生 `INSERT IGNORE` | `oj check` | S006 通过（幂等判据认原生写法） |
| 9 | `seed.pg.sql` 里出现 `CREATE TABLE` | `oj check` | S006 报错，文案指向 `seed.pg.sql`（不是 `seed.sql`） |
| 10 | `seed.pg.sql` 语句在 pg 上失败 | 起服 | 错误含真实文件路径与 `seq`；事务性同现状（此前语句已执行，幂等可重放） |
| 11 | release 产物（`dist/<m>-<v>/`）含方言件 | 起服 | 与 dev 同样按方言选择（`collect` 的 `index` 分支同样生效） |

## 8. 影响面与兼容

| 维度 | 结论 |
| --- | --- |
| 老工程 | 只有 `seed.sql` → 行为逐字节不变 |
| dist 白名单 | `build_cmd.rs:752` 已收 `*.sql`，**不用改** |
| 打包/安装 | `pack.rs` 全量收，不用改 |
| 新失败模式 | 方言件写错方言 → 起服报错并点名文件（比现状「静默跑错文件」更早暴露） |
| 风险 | 「方言件存在但内容是旧副本」这类漂移要靠 §4.4 的静态检查 + 可选门禁（下节）；内核不做行数比对 |
| 版本 | 建议 minor（`0.1.121`），CHANGELOG 记 `feat(seed)` |

## 9. 分期

| 期 | 内容 | 可独立发版 |
| --- | --- | --- |
| P1 | `seed.rs` 方言选择 + 成功日志 + 缺口 warn + 门控前置；用例 1-7、11 | 是 |
| P2 | `checks.rs` 逐变体检查 + `insert_is_idempotent` 补原生写法；用例 8-10 | 是 |
| P3 | 文档：`docs/devkit/{db-guide,api-manual,SKILL}.md` + `docs/{migration,user-manual,ops-manual}.md` 把「部署期覆盖」改为「放好即生效」 | 随 P1 |
| P4（可选） | 「通用件 vs 方言件」结构一致性 warn（表集合、每表语句数），`oj check` 输出、默认不 fail，可用 `oj:allow-seed-drift` 注释豁免 | 可延后 |

P4 的设计动机是本仓实测的 4 条 vs 22 条漂移；但它对「方言件合法地多一条 UPDATE」这类正常写法
会误报，所以只 warn、给豁免注释，且不阻塞 P1-P3。

## 10. 模板侧联动（✅ 2026-11-05 全部完成）

1. ✅ 部署手册去掉「把 `seed.<dialect>.sql` 覆盖成 `seed.sql`」整个动作；`docs/devkit/manual.md`
   的提示块重写为「同名方言件放好，oj 自动选」，并写明 `file=` / `dialect=` 日志判据；
2. ✅ `m-8` 守卫保留（根级副本仍然禁止，杜绝第二份真源）；
3. ✅ `framework-verification-playbook.md` §9 对应行 + §11 U1 收口；**真库验证**：
   用 `oj 0.1.121` + 同一模块（`seed.sql` 插 `generic`、`seed.mysql.sql` 插 `mysql`、
   `seed.pg.sql` 插 `pg`）分别起服——mysql 只落 `mysql`、pg 只落 `pg`，日志分别是
   `seed ok … file=…/seed.mysql.sql dialect="mysql"` 与 `…/seed.pg.sql dialect="postgres"`，
   通用件零执行（未做任何覆盖）；
4. ✅ devkit 快照（`docs/devkit/oj-api-dev/`）按发版内容整目录同步；`MIN_OJ_VERSION`
   0.1.86 → 0.1.121（方言选择是模板的前置能力）。

## 11. 开放问题（附建议）

> 2026-11-05 落地时四项**全部按建议采纳**（命名 `seed.<dialect>.sql`；通用件继续参与检查；
> 缺匹配 warn；允许不同构，一致性 warn 留 P4）。

| # | 问题 | 建议 |
| --- | --- | --- |
| Q1 | 命名用 `seed.<dialect>.sql` 还是 `seed.sql.<dialect>` / `seeds/<dialect>.sql`？ | **`seed.<dialect>.sql`**：与迁移 `{desc}.{dialect}.sql` 完全一致，且 `seed*.sql` 通配能一把扫到（本仓 m-8 守卫已按此写） |
| Q2 | 通用件与方言件并存时，通用件还参与 S003/S006 吗？ | **参与**：它是 sqlite 的唯一真源，坏了一样炸 |
| Q3 | 「只有别的方言件」是 warn 还是 fail？ | **warn**：多方言工程可能只对有差异的方言给覆盖件；但必须点名，不接受静默（痛点 b） |
| Q4 | 是否允许方言件缺某张表（与通用件不同构）？ | **允许**（合法场景存在），一致性只在 P4 里 warn，不 fail |

## 12. 一句话版（提 issue 用）

> oj 只认字面 `seed.sql`（`seed.rs:17` 常量），三方言执行同一份文件：`INSERT OR IGNORE` 与
> 保留字列（`key`/`group`）在 mysql/pg 上直接 1064 拒启，缺文件时又静默跳过、无日志。
> 请像迁移的 `{seq}__{desc}.{dialect}.sql` 一样支持 `seed.<dialect>.sql`：方言件存在即胜出、
> 通用件兜底不双跑，成功日志打印实际文件，`oj check` 覆盖全部变体。
