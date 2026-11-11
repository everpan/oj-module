# MCP 机器人三表多租户隔离迁移方案（按用户裁决修订）

- 日期：2026-11-11 19:20 初稿 / 20:10 按用户裁决修订
- 状态：**方案已修订 + 强绑定改判已落地（24 文件）+ 换专家复评审收敛 + 真机冒烟通过**。评审报告 §11 为强绑定改判与真机验证结论。HEAD 仍 `0c838ba0c`（未提交未推送），`feat/ojm` 豁免窗口仍开
- 范围：`packages/cli/templates` 内 `oj_svc_token` / `oj_bot_binding` / `oj_obo_audit` 三表的租户定性迁移 + **强绑定（`require_signed_claim: true` + claims 平铺 tenant）**
- 权威依据：`docs/devkit/oj-api-dev/db-guide.md` §tenant、`docs/devkit/oj-api-dev/api-manual.md` §14 / §8
- **用户裁决（本版核心变更）**：「直接修改 0007 因为还未发布过，不用增加迁移号」→ 撤销初稿「不回改 0007 / 新增 0008」的全部设计
- **后续裁决（强绑定改判）**：「以强绑定形式再修改一轮并重新评估」+「连代码一起落地」→ 撤销初版「强绑定暂不做」，落地 `tenant.require_signed_claim`、`session.ts` 全链路 claims.tenant、无头链接管死锁闭环（前端免注入头 + handler 自报租户）

---

## 0. 结论先行

三表能改成租户表，且**按用户裁决直接改 0007 基线后改动面比初稿更小**：主要动「三份 0007 迁移 + `schema.yaml` + `config.yaml` + 两处守卫测试」，业务代码 `bot.ts` **零改动**、`openapi.json`/`__client` **零改动**、四套迁移守卫（`s-1`/`s-2`/`parity`）**代码一处都不用改**——构造器会自动注入 `tenant_id`，不需要手写过滤，也不需要新增迁移序号。

关键推论（三方评审一致 push 到底）：**0007 从未发布 ⇒ 新建/重建库跑完 0007 三表为空 ⇒ 根本不存在「存量行」⇒ `DEFAULT 'default'` 整个不写**。初稿的「存量回填」整段、§11 Q2/Q3 两个拍板项一并作废，连带消解机器人工程师与工程师各一条头号 blocker。

两个必须说清的边界：

1. **交付是「数据层分区」，不是身份层隔离**。强绑定暂不做 → 租户仍由裸 `X-TENANT-ID` 头自证。本阶段做到的是「数据按租户分开存、构造器自动按头值过滤」，**不承诺系统能证明调用者属于哪个租户**。交付名与发版说明必须压到与实做一致，不写「阶段二已排期」。
2. **上游 SvcGate 仍按全局 jti 核销**。oj 二进制静态 SQL 是 `SELECT jti FROM oj_svc_token`（无租户条件），本仓不能改（规则：只调整本项目，其余项目只读）。jti 是 128-bit 随机串、全局唯一，核销只判「在册与否」，安全轴不构成越权，但这是隔离边界的实情，不粉饰、不宣称「全链路隔离」。

> 术语首现注解：`sql_guard: deny` = oj 的 SQL 守卫，对「租户表」的 `select/update/delete` 自动追加 `tenant_id = 当前头值`、`insert` 强制写当前租户值（fail-closed = 校验不过就拒绝、不放行）。**租户表**判定公式 `!shared && 有 tenant_id 列`；标 `tenant: false` 且列进 `shared_allow` 才是「共享表」，守卫不注入任何租户条件。`parity` = 迁移建表列集 ↔ `schema.yaml` ↔ `manifest.yaml` ↔ 三方言逐列对账的守卫。`journal` = `_oj_migrations` 迁移账本，记已跑到第几号。

评审结论详见 `docs/reviews/20261111-2010-mcp-bot-tables-tenant-isolation-review.md`：三方最终总评 架构师「通过（仅数据层改动面）」/ 工程师「有条件通过」/ 机器人工程师「有条件通过」，唯一未收敛分歧是「回调头值契约是否算 blocker 级上线前置」（§11 Q2）。

---

## 1. 需求与边界

用户口径：「制定 `schema.yaml` 三表隔离迁移方案，强绑定暂时不做」+ 追加裁决「直接修改 0007，不用增加迁移号」。

| 维度 | 本次范围 | 不在范围 |
|---|---|---|
| 表定性 | 三表从 B 组（共享表）转 A 组（租户表） | 不动 `oj_svc_token` 的 `jti` 主键语义、`oj_obo_audit` 的 `id` 主键语义 |
| 迁移 | **直接回改 0007 三方言 CREATE TABLE**；不新增 0008、不回改 0001 基线 | 任何新序号迁移文件 |
| 存量 | **无存量行**（0007 未发布 + 三表数据只由运行时构造器产生）→ 不写 `DEFAULT 'default'`、不做回填 | 存量归属选型、DROP DEFAULT 选型（均作废） |
| 身份层 | 保持 `require_signed_claim: false` | 强绑定、svc token tenant claim、`session.ts` 改造 |
| 功能 | 无 | 企微绑定 A/B、前端按钮、新端点 |
| 契约 | `openapi.json` / `__client` 零改动 | 端点 `.schema/.response` 不变 |
| 文档/话术 | 待 §11 Q2/Q5/Q6 拍板后决定是否同步 | 默认不含在「零改动」口径内 |
| 时机 | 改完+验完前**不推 `feat/ojm`**（豁免窗口随推送关闭） | — |

---

## 2. 现状取证（可复现命令，大小写敏感）

### 2.1 三表怎么被「豁免」的

```bash
cd packages/cli/templates
grep -n -A2 "^  oj_svc_token:\|^  oj_bot_binding:\|^  oj_obo_audit:" src/app/api/_platform/schema.yaml
grep -n "oj_svc_token\|oj_bot_binding\|oj_obo_audit\|require_signed_claim\|sql_guard" config.yaml
```

| 载体 | 位置 | 内容 |
|---|---|---|
| schema.yaml | 242 / 251 / 261 | 三表各标 `tenant: false` |
| schema.yaml | 252 | `oj_bot_binding` 的 `pk: [provider, external_sub]`（全局唯一，跨租户必然串号） |
| config.yaml | 35 | `migrate_on_start: auto`（启动即迁移） |
| config.yaml | 59 | `default: 'sqlite://db.sqlite'`（缺文件自动建空库） |
| config.yaml | 205 / 206 / 249 | `header_key: X-TENANT-ID` / `sql_guard: deny` / `require_signed_claim: false` |
| config.yaml | 211–228 | `shared_allow` 共 **17** 项（末 3 项为三表） |

即：三表靠 `tenant: false` + `shared_allow` 双声明被判为共享表，守卫不注入 `tenant_id`。`bot.ts` 与七个 handler 里**没有** `db.asSystem()` / 裸 SQL 偷渡——隔离不是被「绕过」，是被「声明豁免」。

### 2.2 引用面计数

命令（口径：大小写敏感、精确表名、只统计 `templates/src` 下 `*.ts/*.yaml/*.sql`）：

```bash
for t in oj_svc_token oj_bot_binding oj_obo_audit; do
  printf '%s %s 处 / %s 文件\n' "$t" \
    "$(grep -rIo "$t" packages/cli/templates/src --include=*.ts --include=*.yaml --include=*.sql | wc -l | tr -d ' ')" \
    "$(grep -rIl "$t" packages/cli/templates/src --include=*.ts --include=*.yaml --include=*.sql | wc -l | tr -d ' ')"
done
```

| 表 | 出现次数 | 文件数 |
|---|---|---|
| `oj_svc_token` | 16 | 6 |
| `oj_bot_binding` | 14 | 6 |
| `oj_obo_audit` | 11 | 6 |

6 个引用文件（同一组）：`bot.ts`、`_platform/manifest.yaml`、三个 `0007__mcp_svc_tables*.sql`、`_platform/schema.yaml`。**注意口径**：`config.yaml` 位于 `templates/` 根、不在 `src/`，需单独同步（§5）。

### 2.3 三条硬约束（修订后）

| # | 约束 | 出处 | 裁决后的适用 |
|---|---|---|---|
| C1 | 已应用过的库不会重跑迁移，新增结构本应追加新序号、不得回改基线 | `templates-schema-columns.test.ts:118-121` | **纪律本身没被推翻**，只是被「0007 未发布、无任何外部库跑过」豁免；`0c838ba0c` 一旦推送，豁免失效。该注释须同步改（§5） |
| C2 | `oj build` / `serve` 启动期校验：租户表必须有 `tenant_id` 列，且 pk 里的列必须在 `columns` 声明 | `db-guide.md:228` + 初稿阴性对照 E2 | 仍适用 |
| C3 | parity 守卫 m-1/m-4 **双向**列集一致；`PRIMARY KEY (...)` 约束行被 `parseColumns` 跳过 | `templates-migration-schema-parity.test.ts:28-40,245-277,328-354,401-431` | **本版最关键的写法红线**：`tenant_id` 必须独立列行；三份 0007 方言 + `schema.yaml` 必须同步建/声明 |

补充：`s-1` 只扫 `ALTER TABLE … ADD COLUMN`（`:34-35,65-89`）、`s-2` 硬编码 21 个文件名与 `seqs`（`:91-121`）；改 0007 用内联 CREATE TABLE、不新增文件 → **两处断言都不触发、都不用改**。`m-3` 只比表集合（`:372-399`）、`m-7` 只扫 0001（`:492-511`），都管不到 0007。

### 2.4 发布状态取证（用户裁决的依据，本轮实跑）

| # | 命令 | 结果 |
|---|---|---|
| P1 | `git log --oneline --follow -- …/0007__mcp_svc_tables.sql` | 单行 `0c838ba0c` |
| P2 | `git branch -vv` | `feat/ojm [origin/feat/ojm: ahead 1]` |
| P3 | `git branch -r --contains HEAD` | 空 |
| P4 | `git log @{u}..HEAD` | 仅 `0c838ba0c` |
| P5 | `git ls-files "packages/cli/templates/dist/**" \| grep -i 0007` | 空 |

**裁定：用户裁决成立**，0007 只活在源码树。

### 2.5 残留库与发布形态事实（本轮实跑，改基线特有风险）

| # | 命令 | 结果 | 含义 |
|---|---|---|---|
| S1 | `sqlite3 "file:packages/cli/templates/db.sqlite?mode=ro" "select module\|\|':'\|\|version\|\|':'\|\|name from _oj_migrations where version>=7"` | `_platform:7:mcp_svc_tables` | 本地库 journal **已记 0007**（实锤）；`auto` 只补未记序号 → 改基线后不重跑，旧结构 + 新代码会崩 |
| S2 | 同库三表 `count(*)` | `svc=0 binding=0 audit=0` | 无真实数据，可丢弃，删库重建即可 |
| S3 | `find packages/cli/templates/dist -name "0007__mcp_svc_tables*.sql"` | 6 个（两套 dist 各 3） | gitignored 构建产物 |
| S4 | 上述 6 个 `grep -l tenant_id` | 0/6 | 旧结构；`packages/cli/package.json:41-49` `files` 含 `templates` 会进 tarball，而 prepack 的 `sync-bundles.mjs` 只收 tgz/sig、不碰 migrations → 发布前须 rebuild + tarball 验证 |

---

## 3. 三表逐一定性（改后形态不变）

| 表 | 现在 | 改成 | pk 处理 | 为什么 |
|---|---|---|---|---|
| `oj_svc_token` | 共享表 | 租户表 | **不改**，`pk: jti` | jti 全局唯一随机串，加 `tenant_id` 列即可；构造器 insert 强制写签发租户，换签按当前租户查登记行 → 凭据天然归属租户 |
| `oj_bot_binding` | 共享表，pk `(provider, external_sub)` | 租户表 | **必须改**为 `[tenant_id, provider, external_sub]` | 不改 pk 则两个租户不能绑同一个企微 userid，隔离等于没做 |
| `oj_obo_audit` | 共享表 | 租户表 | **不改**，`pk: id` | 自增主键，加列即可；审计改按租户可见（用户上一轮口径：审计也隔离） |

改后 `schema.yaml` 三表形态（示意，非仓库改动）：

```yaml
  oj_svc_token:
    pk: jti                      # 去掉 tenant: false
    columns:
      tenant_id: {type: text, null: false}
      jti: {type: text, null: false}
      # …其余列不变
  oj_bot_binding:
    pk: [tenant_id, provider, external_sub]
    columns:
      tenant_id: {type: text, null: false}
      # …其余列不变
  oj_obo_audit:
    pk: id
    columns:
      tenant_id: {type: text, null: false}
      # …其余列不变
```

`config.yaml` 的 `shared_allow` 删掉三行（17→14）；`manifest.yaml` 的 `tables` 清单不变（三表仍归 `_platform`），只改注释。

---

## 4. 迁移方案（直接改 0007 三方言）

> 以下 DDL 是**方案示例，未写入仓库**。三方言均改为「在 0007 的 CREATE TABLE 里内联 `tenant_id` 独立列行 + `oj_bot_binding` 主键纳入 tenant_id」，**不写 `DEFAULT 'default'`**（无存量行）。

### 4.1 sqlite（基础件）

```sql
CREATE TABLE IF NOT EXISTS oj_svc_token (
  tenant_id TEXT NOT NULL,
  jti TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oj_bot_binding (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_used_at INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, provider, external_sub)
);
CREATE TABLE IF NOT EXISTS oj_obo_audit (
  tenant_id TEXT NOT NULL,
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  svc TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);
```

### 4.2 pg（时间列保持 BIGINT）

```sql
-- 三表各加 tenant_id TEXT NOT NULL 独立列行；oj_bot_binding 为：
CREATE TABLE IF NOT EXISTS oj_bot_binding (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_used_at BIGINT NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, provider, external_sub)
);
```

> 直接内联主键，**不需要** `DROP CONSTRAINT oj_bot_binding_pkey`（初稿 pg 的不确定约束名假设随之内消解）。`oj_obo_audit` 沿用 `id BIGSERIAL PRIMARY KEY` + `tenant_id` 独立行。

### 4.3 mysql（键列 `VARCHAR(191)`）

```sql
CREATE TABLE IF NOT EXISTS oj_bot_binding (
  tenant_id VARCHAR(191) NOT NULL,
  provider VARCHAR(191) NOT NULL,
  external_sub VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  last_used_at BIGINT NOT NULL DEFAULT 0,
  created_by VARCHAR(191) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, provider, external_sub),
  KEY idx_binding_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- `tenant_id` 进复合主键 → 必须用 `VARCHAR(191)`（TEXT 不能作 PK 列）；不写 DEFAULT 后「TEXT 不能带字面量 DEFAULT」不再触发（现有 `reason TEXT NOT NULL` 无 DEFAULT 是既有佐证）。
- 复合主键 `3 × 191 × 4 = 2292B`；`ROW_FORMAT=DYNAMIC` + `innodb_large_prefix=ON`（5.7.7+/8.0）下上限 3072B 可行，旧 COMPACT 下须实测（§9 V2）。
- 加索引**不能**写 `CREATE INDEX IF NOT EXISTS`（m-5 mysql 违规，`parity.test.ts:118`）；内联 `KEY idx_x (...)` 是约束行、被 `parseColumns` 跳过，不算列。`oj_obo_audit` 若拍板补索引，同理内联 `KEY idx_obo_tenant_ts (tenant_id, ts)`。

### 4.4 parity 红线（决定写法，必须做对）

| # | 红线 | 违反后果 |
|---|---|---|
| W1 | `tenant_id` 必须**独立列行**，不能只塞进 `PRIMARY KEY (...)` | 约束行被 `parseColumns` 跳过 → m-1 报「schema.yaml 声明了但迁移未建列」 |
| W2 | 三份 0007 方言 + `schema.yaml` **同时**建/声明 `tenant_id` | m-1/m-4 双向列集一致，少一处即挂 |
| W3 | mysql 不写 `CREATE INDEX IF NOT EXISTS` | m-5 判方言违规 |
| W4 | `AUTOINCREMENT` 只在 base 版；pg/mysql 时间列维持 BIGINT | m-5 只扫 mysql/pg 方言件；m-7 不扫 0007，靠人工纪律 |
| W5 | 不写 `DEFAULT 'default'` | 无存量行，构造器 `sql_guard: deny` insert 强制注值；若存在「无租户上下文写入」路径会 fail-loud（§9 V5 补测） |

### 4.5 语义变化（必须写进发版说明）

- `listSvcTokens()` / `revokeSvcToken()` 改按当前租户过滤 → 某租户 superadmin 看不到、也吊销不了别的租户签发的凭据。这是隔离的预期结果，不是 bug。
- `exchangeObo()` 查 `oj_svc_token` 与 `oj_bot_binding` 自动带租户 → 用 A 租户凭据带 B 租户头换签会得到 `40311`（凭据）或 `40310`（绑定）；注意 `40311` 原话术是「凭据被吊销」，会被「头带错」污染（§11 Q5）。
- `searchOboAudit()` / CSV 导出改按当前租户可见。
- 跨租户失败审计落在「请求头值租户」，凭据签发方看不到探测（本阶段只做边界告知）。

---

## 5. 同步清单（改动面全表）

| # | 文件 | 改动 | 契约影响 |
|---|---|---|---|
| 1 | `migrations/0007__mcp_svc_tables.{sql,pg.sql,mysql.sql}` | 三表内联 `tenant_id` 独立列行（NOT NULL、无 DEFAULT）、binding PK 纳入 tenant_id、删 `:4-5` 旧「共享表」注释 | 否 |
| 2 | `_platform/schema.yaml` | 三表去 `tenant: false`、各加 `tenant_id` 列、binding pk 改 `[tenant_id, provider, external_sub]`；`:239-240` **改陈述新事实**（不把被推翻的「共享表、不该按租户割裂」旧结论当理由补回） | 否 |
| 3 | `config.yaml` | `shared_allow` 删三行（17→14）、改 `:225`/`:208` 注释；`migrate_on_start: auto` / `sql_guard: deny` / `require_signed_claim: false` **不动** | 否 |
| 4 | `_platform/manifest.yaml` | 改 `:22` 注释（保留「SvcGate 直查 jti」事实）；`tables` 清单不变 | 否 |
| 5 | `bot.ts` | 改 `:2` 注释；**代码零改动** | 否 |
| 6 | `templates-tenant-scope.test.ts` | `shared` 数组移除三表 → 14 项；改 t-4 标题（`:118`「28 张表」）与 `:130` 注释并白话补回上下文；**`toBe(31)`（`:131`）不变** | 否 |
| 7 | `tests/cli/template-bot-access.test.ts` | `:81` 标题、`:88-89` 断言改为「schema 三表有 `tenant_id` 且 config 不含 `- <table>`」；`BACKEND_FILES`（`:55-57`）钉文件名、不动 | 否 |
| 8 | `templates-schema-columns.test.ts` | 仅改 `:118-119` 注释与裁决对齐；**s-1/s-2 可执行断言不动** | 否 |
| 9 | 本地/CI 旧 `:7` 库 | 清点并删库重建（三表 0/0/0 行）；`templates/api/db.sqlite` 等另套库一并清点 | 否 |
| 10 | dist 两套 6 个 0007 副本 | 发布前 rebuild 刷新（不手改构建产物） | 否 |
| 11 | `templates-migration-schema-parity.test.ts` / `templates-schema-columns.test.ts` / 新增 0008 | **零改动**（内联 CREATE TABLE、无 RENAME、无 ADD COLUMN、无新文件；守卫代码一处不动） | 否 |
| 12 | `openapi.json` / `src/app/web/**/__client/*` / 前端 `pages/bot/*` / locales | **零改动**（除非 §11 Q2/Q5/Q6 拍板放开文档/话术） | 否 |
| 13 | 文档/话术（待拍板） | `mcp-bot-guide.md` 骨架加 `X-TENANT-ID` 头、`tenantNote`、4031x 话术、`config.yaml:246-248` 过时 R6 注释、发版说明 | 否 |

---

## 6. 实测证据

### 6.1 初稿 E1–E6 的适用性说明（诚实账）

初稿 §6 的 E1–E5 是基于「新增 0008 迁移」的 `/tmp` 副本实验（`oj build` 正向/阴性对照、`oj serve` 自动迁移、`pragma table_info` 确认主键），**其产物随初稿作废**；仍具参考价值的只有两点：E2 阴性对照（证明声明期校验确实生效）、E6 静态取证（`strings` 得 `SELECT jti FROM oj_svc_token` 无租户条件）。**改 0007 后必须按 §9 重跑**，不得沿用旧结论。

### 6.2 本轮（裁决后）取证

| # | 实验 | 结果 |
|---|---|---|
| E7 | 三方各自 `/tmp` 逐字复刻 `effectiveSchema`：「改 0007 内联列」场景 base/mysql/pg **各 0 violation**；「0008 RENAME」场景出现 `oj_bot_binding_new` 残留 → violation | 证明 0008 的 parity blocker 随裁决消解（架构师/工程师/机器人工程师各自复跑） |
| E8 | 主 agent 只读复核 `db.sqlite` | journal 有 `_platform:7:mcp_svc_tables`、三表 0/0/0 行（§2.5 S1/S2）→ 残留库实锤、无存量行实锤 |
| E9 | 主 agent 只读复核 dist | 6 个 0007 副本、含 `tenant_id` 0/6（§2.5 S3/S4）→ 发布形态风险实锤 |
| E10 | 计数复核 | 三表 16/14/11 处、6/6/6 文件；`shared_allow` 精确 17 项（删三表→14）；`tables.size=31` 不变 |

> **诚实账更正**：本轮主 agent 曾用 `awk` 跨段数出 `shared_allow` = 26 项，错在把紧随其后的 `anonymous_paths` 9 条一并计入（26 = 17 + 9）。精确口径 `sed -n '211,228p' config.yaml | grep -cE '^    - '` = **17**。以 17/14 为准，详见评审报告 §6。

---

## 7. 风险矩阵（修订）

| # | 风险 | 级别 | 依据 / 处置 |
|---|---|---|---|
| R1 | 回改 0007 的豁免窗口随推送关闭 | 高 | §1.2 P2–P4；改完+验完前不推 `feat/ojm`；发版说明写死「发布后禁改基线」 |
| R2 | 本地/CI 已应用旧 `:7` 的库不重跑 → 旧结构 + 新代码崩 | 高 | E8；删库重建（三表 0 行可丢弃）；**同一 `:7` 对应两种结构**是改基线的根本代价 |
| R3 | dist 6 个旧 0007 副本进 tarball、prepack 不修 migrations | 中高 | E9；发布前 rebuild + `pnpm pack` 解包验证 6/6 命中 |
| R4 | 三方言内联 DDL 未实测（mysql 2292B 复合主键、约束名假设已消解） | 中 | §9 V2 补测 |
| R5 | SvcGate 仍按全局 jti 核销，隔离边界止于 JS 构造器 | 中 | E6；jti 唯一不构成越权，但**须如实写进发版说明**，不宣称「全链路隔离」 |
| R6 | 身份层未强绑定：租户仍由裸 `X-TENANT-ID` 头自证 | 中 | 用户明确「强绑定暂不做」；交付名降为「数据层分区」，显式挂账、不写「阶段二已排期」 |
| R7 | 回调头值契约缺位（机器人按官方指南接入即 `400`/`40311`/`40310` 两头断） | 中～高（级别待 §11 Q2 拍板） | 评审报告 §4；不动强绑定即可补（文档 + 骨架加头） |
| R8 | `oj_obo_audit` 无 `tenant_id` 索引 + `allRows` 取全 → O(N) 全表扫 | 中 | 评审报告 §5 性能口径已对齐；建议本阶段内联索引（§11 Q4） |
| R9 | 4031x 语义被「头带错」污染、跨租户吊销误导 404 | 中 | 评审报告 §4；话术/代码改动待 §11 Q5 |
| R10 | 活注释 / 守卫注释 / 测试断言漏改 | 低 | §5 第 2/3/4/5/6/7/8 行逐一列明；「白话补回旧结论」是错的，改陈述新事实 |
| R11 | 发布形态与源码树差异（点文件剥离 / prepack 重建 bundles） | 低 | 按既有惯例，发布前用 `pnpm pack` tarball 解包验证 |

---

## 8. 分阶段实施计划（待 §11 拍板后执行，本轮不动手）

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| P0 | 拍板 §11；清点并**删库重建**所有已应用 `:7` 的本地/CI/实验库；确认不推 `feat/ojm` | 清单有结论；`count(*)` 三个 0 |
| P1 | 改三份 0007 / `schema.yaml` / `config.yaml` / `manifest.yaml` / `bot.ts` 的定性与注释 | `oj build` EXIT=0；阴性对照 EXIT=1；`templates-tenant-scope` 绿 |
| P2 | 补测 pg / mysql 内联 DDL（含 mysql 复合主键字节数）；按 Q4 决定是否内联索引 | 三方言各自空库建表 + 老库升级路径均成功 |
| P3 | 改两处守卫测试的断言/注释（§5 第 6/7/8 行）；四套守卫全绿 | 根套件 + `packages/cli` 套件全绿；parity/s-2 守卫代码零改动 |
| P4 | 真机冒烟（**先重启 `oj serve` 再打请求**，首个请求可能走旧模块；先把数据重置到已知状态）：同租户签发→换签→审计可见；跨租户换头→40311/40310；跨租户 `listSvcTokens` 不可见；完整 SvcGate HTTP 链路 | 逐条断言有日志 |
| P5 | 发布形态：`pnpm pack` → 解包 → `pnpm install` → 解包产物跑迁移；6/6 dist 0007 含 `tenant_id`；`ojm api --check` 仍 0 error / 0 warn | tarball 形态绿 |
| P6 | 文档/话术（按 Q2/Q5/Q6 拍板结果）、发版说明（含 R5/R6 边界）、清理 `/tmp` 实验产物 | 仓库干净；不宣称「全链路隔离」 |

---

## 9. 验证与回滚

- **验证**：P4/P5 用「同一份产物、只改被测变量」的 A/B 口径；跨租户断言必须先把数据重置到已知状态。补测清单见评审报告 §9（V1–V7）。
- **回滚**：0007 未发布、无外部库 ⇒ **不存在 DDL 迁移回滚**。回滚 = **git 版本回退 + 删库重建**（让 `migrate_on_start: auto` 从空库重跑新 0007），不写双路径代码、不做 SQL 逆操作。按「不做向后兼容兜底」的既有惯例。
- **写死一句**：一旦 0007 发布过，上述结论立即失效，改基线不再是选项，必须回到「追加新序号」路线。

---

## 10. 对外依赖清单（上游 oj-bin，本项目只读）

| # | 诉求 | 现状 | 影响 |
|---|---|---|---|
| D1 | SvcGate 核销查询 `SELECT jti FROM oj_svc_token` 无租户条件 | 上游 Rust 侧静态 SQL（E6），本仓改不了 | 表租户化后该查询仍全局按 jti 核销；jti 唯一不构成越权，但隔离边界止于 JS 构造器（R5） |
| D2 | 若要身份层强绑定（`require_signed_claim: true`） | 上游 v0.1.130 已支持 `jwt.sign` 的 `claims` 平铺（`api-manual.md:2175`），但模板 `config.yaml:246-248` 的「jwt.sign 会静默丢弃自定义 claim」注释与之上矛盾 | **本次不做**；将来做之前必须实测 `claims.tenant` 是否进 `http.user.claims`，并同步改 `session.ts:27` 全链路签发 |
| D3 | pg / mysql 方言的主键/索引写法 | 需各自环境实测 | 见 R4 / §9 V2 |

---

## 11. 待用户确认清单（拍板项）

> 以下均**未自行裁决**，请逐项拍板后我再进入 P1。Q2 是三方评审唯一未收敛的实质分歧。

| # | 拍板项 | 选项 | 评审倾向 |
|---|---|---|---|
| Q1 | 交付定性：「隔离」→「**数据层分区**」，不承诺身份层绑定、不写「阶段二已排期」 | ① 确认 ② 保留原措辞 | **①**（三方一致） |
| Q2 | **回调头值契约**：是否接受为 blocker 级上线前置（补文档 + 骨架加 `X-TENANT-ID` 头 + 头值=凭据签发租户=corp_id + 每租户一套凭据；**不动强绑定**） | ① blocker 前置 ② 挂账不阻断 | **未收敛，必须拍板**；机器人工程师坚持 ①，架构师/工程师倾向 ② |
| Q3 | 残留库与发布形态：确认「所有已应用 0007 的库可丢弃 + 三表 0 行」为全量前提（含 CI/实验库）；dist 由谁在哪个阶段重建 | ① 删库重建 + 发布前 rebuild ② 加「检测到旧结构即 fail-fast」守卫 | **①**，实施前逐个 `count(*)` 复查 |
| Q4 | 审计性能债：本阶段是否补 `(tenant_id, id)` 内联索引 + 改 `allRows` 为 SQL 层分页 | ① 本阶段补 ② 写进发版说明留后续 | **①**；mysql 受 m-5 限制只能内联 `KEY` |
| Q5 | 4031x / 跨租户吊销：改 `OBO_MSG` 常量话术、改 `revokeSvcToken` 的 404 分支，本阶段动代码吗 | ① 都改 ② 只写发版说明 ③ 只改话术 | 机器人工程师判吊销 404 **必须改代码**；P0-2 属「零改动」口径例外，需确认 |
| Q6 | 文档同步：`tenantNote` / 三份 devkit 指南 / `config.yaml:246-248` 过时 R6 注释 是否本阶段同步 | ① 同步 ② 留后续 | **①** |
| Q7 | 确认本次**不含**强绑定与企微绑定 A/B | ① 确认（用户口径）② 并入 | **①** |
| Q8 | 时机：改完+验完前**不推 `feat/ojm`** | ① 确认 | **①**（豁免窗口随推送关闭） |
