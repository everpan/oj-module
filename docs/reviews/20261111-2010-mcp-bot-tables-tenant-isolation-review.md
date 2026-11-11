# MCP 机器人三表多租户隔离迁移方案 · 三方专家评审报告

- 日期：2026-11-11 20:10
- 评审对象：`docs/plans/20261111-1920-mcp-bot-tables-tenant-isolation.md`（初版主张「不回改 0007 / 追加 0008」）
- 评委：架构师 / 工程师 / 机器人开发工程师（各自独立取证，不引用方案现成论证链）
- 流程：第一轮独立评审 → **用户中途裁决「直接改 0007，因为还未发布过，不用增加迁移号」** → 第二轮交叉质辩（冲突主张互喂、逼自我修正）→ 本报告汇总 + 主 agent 独立复核关键数字
- 纪律：全程只读；未改任何实现文件、未跑 `pnpm pack`/`prepack`、未碰 `db.sqlite`/config.yaml/9778/9779 服务。除本报告与修订后的方案文档外，仓库零改动
- 状态：**评审完成 → 用户裁决「以强绑定形式再改一轮」→ 代码已落地（24 文件）→ 换专家复评审已收敛 → 真机冒烟已通过**。本报告为初版（数据层分区）评审；强绑定改判结论见 §11（覆盖 K1/K7/Q7 与 §10 边界声明）

---

## 0. 结论先行

| 项 | 结果 |
|---|---|
| 三方最终总评 | 架构师 **通过（仅数据层改动面）** / 工程师 **有条件通过** / 机器人工程师 **有条件通过（条件集换血）** |
| 收敛结论 | 「直接改 0007 基线」在数据层**技术上成立、无阻断**；但交付名必须从「多租户隔离」降级为「**数据层分区**」，放行前须落地 §4 的 major 项与 §8 拍板 |
| 用户裁决的影响 | 不只消解 0008 的两个 blocker，还连带消解「存量回填断链」整族风险（0007 未发布 ⇒ 无存量行 ⇒ `DEFAULT 'default'` 整个不写） |
| 关键数字 | 守卫代码 **0** 处要改（s-1/s-2/parity 全不动）；新增迁移文件 **0** 个；`shared_allow` **17→14**；`tables.size=31` 不变；必改文件约 **12** 个；dist 旧 0007 副本 **6** 个需重建；本地已应用 0007 的库 **1** 个需删库重建 |
| 下一步 | 先拍板 §8，再进修订方案 §8 的 P1；**改完+验完前不推 `feat/ojm`**（豁免窗口随推送关闭） |

> 说人话：三个专家吵完两轮，一致认为「照用户说的直接改 0007」这套做法本身没毛病、比原来的 0008 方案还简单；但「改完就实现了多租户隔离」这句话是过头话——真正隔离要靠「租户身份绑定」，那块用户明确说了暂不做。所以本阶段交付的是「数据按租户分开存」，不是「系统能证明你是哪个租户」。

---

## 1. 用户裁决与前提变更

### 1.1 裁决原文

> 直接修改 0007 因为还未发布过，不用增加迁移号

### 1.2 主 agent 独立核实的发布状态（一手证据）

| # | 命令 | 结果 | 含义 |
|---|---|---|---|
| P1 | `git log --oneline --follow -- packages/cli/templates/src/app/api/_platform/migrations/0007__mcp_svc_tables.sql` | 单行 `0c838ba0c` | 0007 由且仅由 HEAD 引入 |
| P2 | `git branch -vv` | `feat/ojm [origin/feat/ojm: ahead 1]` | HEAD 未推送 |
| P3 | `git branch -r --contains HEAD` | 空 | 任何远端分支都不含 HEAD |
| P4 | `git log @{u}..HEAD` | 仅 `0c838ba0c` | 唯一未推送提交就是引入 0007 的那个 |
| P5 | `git ls-files "packages/cli/templates/dist/**" \| grep -i 0007` | 空 | 0007 不在任何已跟踪/已分发产物 |

**裁定：用户裁决成立。** 0007 只活在源码树，从未随发布包或远端分发。初版方案 §2 的 C1「不得回改基线」这条纪律本身**没有被推翻**，只是被「没有任何外部库跑过 0007」豁免；一旦 `0c838ba0c` 推送/合并，豁免窗口关闭，改基线不再是选项。

### 1.3 被裁决改变的初版方案构件

| 初版构件 | 裁决后 |
|---|---|
| §2 C1 / §4 新增 0008 三方言迁移 | **作废**：直接改 0007 三份 CREATE TABLE |
| §4「存量数据」段 / `DEFAULT 'default'` | **作废**：无存量行，不写 DEFAULT |
| §7 R1 / R3 / §9 回滚 / §11 Q2、Q3 | **整段重写或作废** |
| §5 同步清单第 4、8 行（0008 文件 / s-2 seqs） | **删除**：不新增文件、s-2 一处不用改 |
| §0「隔离是数据层，不是身份层」 | **保留并升格为交付定性**（见 §5） |

---

## 2. 两轮流程与取证纪律

- **第一轮**：三位专家各自只读取证，禁止引用方案的 §2 表格 / E1–E6 / R1–R8 /「已实测」字样与现成数字；计数须来自单一可复现命令并注明大小写敏感。
- **用户裁决**在第一轮报告交付后到达，推翻了被评审方案的核心前提，也直接动了两位专家的头号 blocker 与机器人工程师的头号 blocker 的前提。
- **第二轮**：把三方冲突主张 + 用户裁决 + 主 agent 对守卫行为的独立复核命题一并互喂，要求每位专家重新裁定总评、正面回应他人反驳、明确「消解 / 仍在 / 新增」三分类，并自己 push「无存量行 ⇒ DEFAULT 可不写」这个推论到底。
- **主 agent 独立复核**（本报告 §3、§6 的数字）：`config.yaml` 关键值、`shared_allow` 精确项数、三表引用计数、活注释载体、dist 0007 副本、`db.sqlite` journal 与三表行数、守卫断言，均为本轮实跑。

---

## 3. 三方共识：消解 / 仍在 / 新增

### 3.1 消解（用户裁决直接解决，三方一致）

| # | 项 | 证据 |
|---|---|---|
| D1 | 0008 sqlite「建新表→拷→删旧表→RENAME」打破 parity m-1/m-2/m-3/m-4 | `templates-migration-schema-parity.test.ts:288-310` 的 `effectiveSchema` 只认 DROP/CREATE/ADD COLUMN、**不认 RENAME**；改 0007 用内联 CREATE TABLE，无 RENAME、无新表、无 DROP → 三方各自 /tmp 复刻均得 **0 violation** |
| D2 | 0008 带来的 s-2 序号/文件清单同步 | `templates-schema-columns.test.ts:93-115`（21 个固定文件名）、`:120-121`（`seqs` 硬编码 `["0001"…"0007"]`）→ 不新增文件、不新增序号，**两处都不用改** |
| D3 | 机器人工程师头号 blocker「存量回填四者不对齐」 | 0007 未发布（§1.2）+ 三表数据只由 `db.table()` 构造器产生（`bot.ts:65/130/180`）、`seed*.sql` 零命中 + `db.sqlite` 三表实测 **0/0/0 行** ⇒ 新建/重建库跑完 0007 三表为空，**根本不存在存量行** |
| D4 | 工程师 Q2 major「统一 `default` 让存量 svc token 全换签失败」 | 同 D3，无存量 token 行 |
| D5 | 方案 §7 R1「回改 0007 让已部署库拿不到新结构」 | 「已部署」前提被「未推送」否掉 |
| D6 | 工程师「`auto` 下恢复备份即假回滚（0008 被重放）」的**具体症状** | 无 0008 可重放；内核变形见「新增 N1」 |
| D7 | §11 Q2（存量归属三选一）、Q3（是否 DROP DEFAULT） | 无回填对象，两问作废 |

### 3.2 仍在（用户裁决只解决「迁移号」一件事，三方一致坚持）

| # | 项 | 证据 |
|---|---|---|
| K1 | 身份层裸头自证：`require_signed_claim: false`，租户由 `X-TENANT-ID` 自证 | `config.yaml:249`、`:205`；`db-guide.md:195-198` |
| K2 | SvcGate 全局核销，静态 SQL 无租户条件 | `strings /Users/ever/.local/bin/oj \| grep -i oj_svc_token` → `SELECT jti FROM oj_svc_token`；jti 为 `crypto.randomHex(16)` 128-bit（`bot.ts:123`），**安全轴不构成越权**（三方一致），但功能轴完整 HTTP 链路未实测 |
| K3 | `oj_obo_audit` 无 `tenant_id` 索引 + `allRows` 取全到内存 → O(N) 全表扫 | `0007__mcp_svc_tables.sql:22-31` 仅 `PRIMARY KEY(id)`；`bot.ts:274-298/300-305` |
| K4 | 40311 语义被「头带错」污染 | `bot.ts:31/:38` `40311 "服务凭据已吊销或不存在"`、`:346-353` 查 `oj_svc_token` 无行即 40311；`mcp-bot-guide.md:132` 话术把它当「凭据被吊销」 |
| K5 | 跨租户吊销误导 404 | `bot.ts:140-145` delete 0 行 → `botFail(404)`，但 jti 行在别租户下仍在、SvcGate 仍认 |
| K6 | 跨租户失败审计落「头值租户」，凭据签发方看不到探测 | `bot.ts:64-74` `auditObo` insert 注入当前头值租户 |
| K7 | 回调 `X-TENANT-ID` 由谁决定 / 群聊 @ 的「员工→租户」身份解析缺位 | `mcp-bot-guide.md:118-122` 换签骨架 headers 无该头、全文 `tenant` 零命中；`auth/obo/api.ts:19` `claims.tenant` 恒 undefined；`bot.ts:124-129` svc claims 无 tenant；`tenantOfCorp` 9 处调用全在 `auth/wecom/*` 登录/事件链，`auth/obo` 与 `bot.ts` 零命中 |
| K8 | 活注释漏改 + 「白话补回旧结论」是错的 | 与三表定性直接相关 4 处：`0007.sql:4`、`schema.yaml:239`、`manifest.yaml:22`、`bot.ts:2`；另 `config.yaml:225` 旧理由、`templates-schema-columns.test.ts:118-119`「不得回改基线」、`template-bot-access.test.ts:81/:88-89` 标题与断言。注：其余模块的「共享表」注释属正常定性，**不计入漏改** |
| K9 | pg/mysql 三方言内联 DDL 未实测（尤其 mysql 复合主键 `VARCHAR(191)`×3 = 2292B 在目标 `ROW_FORMAT` 下是否成立） | 方案 §4 原标「未实测」；改 0007 后三方言都要改，实测更重，但 `DROP CONSTRAINT oj_bot_binding_pkey` 的约束名不确定性随内联主键消解 |
| K10 | `config.yaml:246-248` 过时注释（「jwt.sign 会静默丢弃自定义 claim」）与 oj v0.1.130 `claims` 平铺事实矛盾 | `api-manual.md:2175,2191-2196`；会误导将来做强绑定的人 |
| K11 | 前端 `tenantNote` / 三份 devkit 指南的「默认 default」措辞在「每租户一套凭据」下不准确 | `zh-CN.json:447`、`en-US.json:447`、`Guide.tsx:45`、`db-guide.md:187/:1377`、`api-manual.md:2505/:2845` |

### 3.3 新增（「直接改 0007」这个动作特有，0008 方案没有）

| # | 项 | 级别 | 证据 |
|---|---|---|---|
| N1 | **残留库**：本地/CI 已应用旧 `:7` 的库不重跑 → 旧结构 + 按租户表写的新代码 → 构造器注入 `tenant_id` 到不存在的列即报错 | major（阻断本地/CI，不阻断生产） | `sqlite3 "file:packages/cli/templates/db.sqlite?mode=ro" "select module\|\|':'\|\|version\|\|':'\|\|name from _oj_migrations where version>=7"` → **`_platform:7:mcp_svc_tables`**（实锤，非「可能」）；`config.yaml:35` `migrate_on_start: auto` 只补未记序号、`:59` `sqlite://db.sqlite` 正指向它；三表 0/0/0 行可丢弃。**同一 `:7` 现在对应两种结构**，journal 无法区分，这是改基线相对追加 0008 的根本代价 |
| N2 | **发布形态**：dist 两套共 6 个旧 0007 副本（含 `tenant_id` **0/6**），`files` 含 `templates` 会进 tarball，而 prepack 只收 tgz/sig、不碰 migrations | major | `find packages/cli/templates/dist -name "0007__mcp_svc_tables*.sql"` → 6 个；`grep -l tenant_id` → 0/6；`packages/cli/package.json:41-49` `files` 含 `"templates"`、`:52` prepack 三脚本；`git check-ignore` 显示 dist 被 `templates/.gitignore:17` 忽略 |
| N3 | parity 从「被动挨打」变成**正向硬约束**：三份 0007 + `schema.yaml` 必须同步建/声明 `tenant_id` **独立列行** | 工程约束（必须做对） | `parity.test.ts:28-40`（`PRIMARY KEY` 等约束行被 `isConstraintLine` 跳过）、`:245-277` `parseColumns`、`:328-354` m-1 双向、`:401-431` m-4 双向。`PRIMARY KEY (tenant_id, provider, external_sub)` 里的 tenant_id 不算列 → 必须另写一行 |
| N4 | **时机约束**：豁免窗口随推送关闭 | 执行前置 | §1.2 P2–P4；改完+验完前不推 `feat/ojm` |
| N5 | s-2 守卫注释与裁决冲突，不同步改会带偏下一个人 | minor | `templates-schema-columns.test.ts:118-119` |

---

## 4. 分级发现汇总（合并去重）

| 级别 | 发现 | 提出方 | 处置 |
|---|---|---|---|
| **blocker（未收敛）** | **头值契约（K7）**：不动强绑定也能做（补文档 + 骨架示例加头），但机器人工程师判「上线即断」的 blocker 级前置——按官方指南接入的机器人在 `tenant.enable:true` + `deny` 下会 `400 missing tenant header`；补了头但值 ≠ 凭据签发租户会 `40311/40310` 两头断 | 机器人工程师（架构师并入「显式挂账」、工程师判 major 非 blocker） | **§8 Q-A 交用户拍板** |
| major | 身份层裸头自证、交付名降级（K1） | 架构师 | 「隔离」→「数据层分区」；发版说明如实写边界；**不写「阶段二已排期」** |
| major | SvcGate 功能轴未验证（K2） | 架构师 / 机器人工程师 | 补完整 HTTP 链路；不宣称「全链路隔离」 |
| major | 残留库（N1） | 工程师（架构师/机器人佐证） | 删库重建；方案 §9 回滚段重写为「git 回退 + 删库重建」+ 写死「发布后禁改基线」 |
| major | 发布形态（N2） | 工程师（机器人佐证） | 发布前 rebuild + `pnpm pack` 解包验证 6/6 命中 |
| major | 审计 O(N) 性能债（K3） | 架构师 / 工程师 | 建议本阶段建 `(tenant_id, id)` 内联索引（mysql 受 m-5 限制只能内联 `KEY`）；或明确量化上限写进发版说明 |
| major | 4031x 语义 + 跨租户吊销误导 404（K4/K5） | 机器人工程师 | 话术可缓解；吊销 404 是否改代码待 §8 Q-C |
| major | 跨租户失败审计可见性（K6） | 机器人工程师 / 架构师 | 本阶段只做边界告知；根治排阶段二 |
| major | 活注释 + 守卫/测试同步（K8） | 工程师 | 改陈述新事实，**不把被推翻的旧结论「白话补回」** |
| major | pg/mysql 三方言未实测（K9） | 工程师 / 架构师 | P2 补测 |
| minor | 过时 R6 注释、`tenantNote`「默认 default」、s-2 注释、t-4 标题「28 张表」与 `toBe(31)` 历史不一致、`searchOboAudit` 内存 slice（K10/K11/N5） | 三方 | 随改动顺手同步 |

---

## 5. 实质分歧与交叉质辩裁定

| 分歧 | 架构师 | 工程师 | 机器人工程师 | 本报告裁定 |
|---|---|---|---|---|
| **总评** | 通过（仅数据层） | 有条件通过 | 有条件通过 | 差异集中在「身份层/头值契约算不算本阶段 blocker」；**不强行统一**，如实呈现并交 §8 Q-A 拍板 |
| **头值契约级别** | 显式挂账、不写「阶段二」 | major 非 blocker | **blocker 级上线前置（P0-1）** | **本轮唯一未收敛的实质分歧**。三方一致认可「不依赖迁移号、不依赖强绑定、补文档+骨架加头即可做」；分歧只在是否阻断上线 |
| **性能口径** | 审计无索引全表扫是 major | 冷路径 O(N)，major 性能债 | 热路径增量低 1–2 数量级、分区后 N→N/k 是改善 | **已对齐**：三方在说三个不同对象。热路径点查（jti/复合键/id eq）= 常数级增量；冷路径列表/导出（`allRows` 取全再 slice）= O(N) 全表扫 + 全量入内存，分区**不自动**带来 N→N/k；只有建 `(tenant_id,id)` 索引 + 改掉 `allRows` 才降到 O(N/k + log N)。判 major 性能债、非 blocker |
| **跨租户吊销措辞** | — | 反驳「静默」：404 是 fail-loud | 自我更正为「误导性 404 + 凭据仍有效」 | 工程师反驳成立，机器人已更正。是否改代码另议（Q-C） |
| **「排期阶段二」** | 自我修正：把未立项写成已安排是错的，改为显式挂账 | 认可为 major 非 blocker | 欢迎修正，但坚持头值契约是 blocker | 采纳架构师自我修正 |
| **0008 violation 计数 6 vs 2** | 2 条（只喂 sqlite 基础件） | 6 条（三方言各算 + m-3） | — | 0008 方案已作废，计数失去意义；**不采信任一数字**，以「根因 = RENAME 不被 `effectiveSchema` 识别 + 改基线后 0 violation」为准 |
| **「白话补回旧结论」** | 采纳工程师，区分「删代号补上下文」与「删错误结论」 | 方案「把旧设计理由白话补回」是错的 | 同意 | 工程师对：被推翻的「三表是共享表、不该按租户割裂」不能当新理由留，应改陈述新事实 |

### 专家自我修正记录（交叉质辩的实际产出）

1. **架构师**：撤回第一轮「身份层缺口不是本阶段 blocker、降级为分区 + 排期阶段二」——实质是把一个未立项的事写成「已安排」、给当前风险减记。改为「交付名压到与实做一致 + 开放问题显式挂账」。
2. **工程师**：撤回第一轮「不回改 0007 + 新增 0008 满足 s-2 序号纪律」——方向反了；正确是「直接改 0007，s-2 一处都不用改」。总评从「不通过」改判「有条件通过」。
3. **机器人工程师**：撤回头号 blocker（存量回填四者不对齐，被「未发布 = 无存量行」消解）；更正「跨租户吊销静默安全失败」为「误导性 404 + 凭据仍有效」；但把「回调头值契约」从 major **升为 blocker 级上线前置**。

---

## 6. 诚实账更正（显式标注，以更正后为准）

| # | 原表述 | 错在哪 | 正确值 |
|---|---|---|---|
| 1 | 工程师第一轮「不回改 0007 + 新增 0008 满足 s-2 序号纪律」 | 顺着初版错误前提说的，方向反了 | 直接改 0007、不新增 0008 → `templates-schema-columns.test.ts` 的 s-1/s-2 **一处都不用改** |
| 2 | 架构师第一轮「降级为分区 + 排期阶段二」 | 把未立项写成已安排 | 显式挂账，不写「阶段二已排期」 |
| 3 | 机器人第一轮「跨租户吊销静默安全失败」 | 有 404 响应，不是静默 | 「误导性 404 + 凭据仍有效」 |
| 4 | 架构师 2 条 / 工程师 6 条 0008 violation | 方言计法口径不同，且 0008 方案作废 | 不采信数字，以根因 + 改基线后 0 violation 为准 |
| 5 | **主 agent 本轮 awk 数出 `shared_allow` = 26 项** | 跨段误计：把紧随其后的 `anonymous_paths` 9 条一并计入（26 = 17 + 9） | 精确口径 `sed -n '211,228p' config.yaml \| grep -cE '^    - '` = **17**；删三表后 **14**。三方专家的 17/14 正确 |
| 6 | 初版方案 §2 C1「不得回改基线」被当作绝对禁令 | 该纪律的前提是「已应用过的库不会重跑」 | 纪律本身未被推翻，只是被「0007 未发布、无外部库跑过」豁免；**推送后豁免失效** |

---

## 7. 改动面全表（「直接改 0007」版）

### 7.1 必改

| # | 文件 | 改动 |
|---|---|---|
| 1 | `migrations/0007__mcp_svc_tables.sql` / `.mysql.sql` / `.pg.sql` | 三表 CREATE TABLE 内联 `tenant_id` **独立列行**（`NOT NULL`、不写 DEFAULT）；`oj_bot_binding` 的 `PRIMARY KEY` 纳入 `tenant_id`；删 `:4-5` 旧「共享表」注释 |
| 2 | `_platform/schema.yaml` | 三表去 `tenant: false`（`:242/251/261`）、各加 `tenant_id` 列声明、`oj_bot_binding` 的 `pk` 改 `[tenant_id, provider, external_sub]`（`:252`）；改 `:239-240` 旧理由为陈述新事实 |
| 3 | `config.yaml` | `shared_allow` 删三行（`:226-228`，17→14）；改 `:225`/`:208` 注释；`migrate_on_start: auto`、`sql_guard: deny`、`require_signed_claim: false` **不动** |
| 4 | `_platform/manifest.yaml` | 改 `:22` 注释（保留「SvcGate 直查 jti」事实）；`tables` 清单 `:23-25` **不变** |
| 5 | `bot.ts` | 改 `:2` 注释；**代码零改动**（所有 insert/select/update 未写 `tenant_id`） |
| 6 | `templates-tenant-scope.test.ts` | `shared` 数组移除三表 → **14 项**；改 t-4 标题（`:118`「28 张表」）与 `:130` 注释，把上下文白话补回（三表 B 组 −3 / A 组 +3、总数 31 不变）；**`expect(tables.size).toBe(31)`（`:131`）不变**；t-1/t-2/t-3 自动通过 |
| 7 | `tests/cli/template-bot-access.test.ts` | `:81` 标题、`:88-89` 断言改为「schema.yaml 三表有 `tenant_id` 且 config 不再含 `- <table>`」；`BACKEND_FILES`（`:55-57`）钉的是 0007 三个**文件名**、改内容不删文件，**不动** |
| 8 | `templates-schema-columns.test.ts` | 仅改 `:118-119` 注释与裁决对齐；**可执行断言 s-1/s-2 不动** |
| 9 | 本地/CI 旧 `:7` 库 | 清点并删库重建（三表 0/0/0 行、可丢弃）；`templates/api/db.sqlite` 等另套库一并清点 |
| 10 | dist 两套 6 个 0007 副本 | 发布前 rebuild 刷新（不手改构建产物） |
| 11 | 文档/话术（待 §8 Q-A/Q-D 拍板后） | `mcp-bot-guide.md` 骨架加 `X-TENANT-ID` 头、前端 `tenantNote`、4031x 话术、发版说明、过时 R6 注释 |

### 7.2 不用改（改基线相对 0008 的核心收益）

| 文件 | 理由 |
|---|---|
| `templates-schema-columns.test.ts` s-1 / s-2 断言 | 无 `ADD COLUMN`、无新文件、seqs/21 文件清单不变 |
| `templates-migration-schema-parity.test.ts` **全部守卫代码** | 内联 CREATE TABLE、无 RENAME/DROP；m-3 只比表集合（`:372-399`）、m-7 只扫 0001（`:492-511`），都管不到 0007；靠 DDL + schema.yaml 同步满足 m-1/m-4 双向一致 |
| 新增 0008 三文件 | **0 个** |
| `openapi.json` / `src/app/web/**/__client/*` / 前端 `pages/bot/*` / locales | 端点、`.schema/.response` 零改动（除非 Q-A/Q-D 拍板放开文档/话术） |
| `session.ts` / 强绑定相关 | 用户明确「强绑定暂时不做」 |

### 7.3 DDL 红线（parity 守卫决定写法）

- `PRIMARY KEY (...)` 是约束行，`parseColumns` 会跳过（`parity.test.ts:30,272`）→ `tenant_id` **必须写成独立列行**，否则 m-1 报「schema.yaml 声明了但迁移未建列」。
- m-1/m-4 是**双向**列集一致（`:328-354/:401-431`）→ 三份 0007 方言 + `schema.yaml` 必须**同时**建/声明 `tenant_id`，少一处即挂。
- mysql 不能写 `CREATE INDEX IF NOT EXISTS`（m-5 违规，`:118`）→ 索引只能内联进 CREATE TABLE（`KEY idx_x (tenant_id)`，该行本就被 `isConstraintLine` 跳过、不算列）；sqlite/pg 可写 `CREATE INDEX`。
- `AUTOINCREMENT` 只在 base 版；m-5 只扫 mysql/pg 方言件（`:433-454`），不违规。
- m-7 只读 `0001__baseline.{mysql,pg}.sql`，**不扫 0007** → pg/mysql 0007 时间列维持 BIGINT 靠人工纪律，别退回 INTEGER（工程师对命题的纠正）。
- mysql 复合主键 `3 × VARCHAR(191) × 4 = 2292B`，目标 `ROW_FORMAT=DYNAMIC` + `innodb_large_prefix=ON` 下上限 3072B 可行，旧 COMPACT 下须实测（K9）。

---

## 8. 待用户拍板清单（对齐修订后方案 §11）

| # | 拍板项 | 选项 | 评审倾向 |
|---|---|---|---|
| Q1 | 交付定性：「隔离」→「**数据层分区**」，不承诺身份层绑定、发版说明如实写「裸头自证 + SvcGate 全局核销」、**不写「阶段二已排期」** | ① 确认 ② 保留原措辞 | **①**（三方一致） |
| Q2 | **头值契约（K7）**：是否接受为 **blocker 级上线前置**（补文档 + 骨架加头 + 头值=签发租户=corp_id + 每租户一套凭据，不动强绑定）？还是按架构师「显式挂账」 | ① blocker 前置 ② 挂账不阻断 | **未收敛，必须拍板**；机器人工程师坚持 ①，架构师/工程师倾向 ② |
| Q3 | 残留库与发布形态：确认「所有已应用 0007 的库可丢弃 + 三表 0 行」为全量前提（含 CI/实验库）；dist 由谁在哪个阶段重建 | ① 删库重建 + 发布前 rebuild ② 加「检测到旧结构即 fail-fast」守卫 | **①**，但实施前须逐个 `count(*)` 复查 |
| Q4 | 审计性能债：本阶段是否补 `(tenant_id, id)` 内联索引 + 改 `allRows` 为 SQL 层分页 | ① 本阶段补 ② 写进发版说明、留作后续 | **①**（改基线下在建表语句里加最自然；注意三方言写法差异） |
| Q5 | 4031x / 跨租户吊销：P0-2（改 `OBO_MSG` 常量话术）、P0-3（改 `revokeSvcToken` 的 404 分支）本阶段动代码吗 | ① 都改 ② 只写发版说明 ③ 只改话术 | 机器人工程师判 P0-3 **必须改代码**；P0-2 属「零改动」口径的例外，需确认 |
| Q6 | 文档同步：`tenantNote` / 三份 devkit 指南 / `config.yaml:246-248` 过时 R6 注释 是否本阶段同步 | ① 同步 ② 留后续 | **①**（否则「零改动」把误导留在线上） |
| Q7 | 确认本次**不含**强绑定（`require_signed_claim` / svc token `claims.tenant` / `session.ts` 改造）与企微绑定 A/B | ① 确认（用户口径）② 并入 | **①** |
| Q8 | 时机：改完+验完前**不推 `feat/ojm`** | ① 确认 | **①**（豁免窗口随推送关闭） |

---

## 9. 验证 / 补测清单

| # | 项 | 判据 |
|---|---|---|
| V1 | 四套守卫 + `oj build` 全绿，并做一次「删 `tenant_id` 列声明」的阴性对照 | 全绿；阴性对照 EXIT=1（`schema: 表 "oj_bot_binding" 主键 "tenant_id" 未在 columns 声明`） |
| V2 | pg / mysql **回改后**的 0007 三方言：各自空库建表 + 老库升级路径实跑；重点 mysql 2292B 复合主键 | 两方言 EXIT=0、主键确为 `(tenant_id, provider, external_sub)` |
| V3 | 完整 SvcGate HTTP 链路（E6 只做了静态 `strings`）：签发 svc token → Bearer → 核销 → `/auth/obo` | 逐条有日志；确认静态 SQL 在租户表 + `deny` 下照常执行 |
| V4 | 跨租户矩阵冒烟（**先重启 `oj serve` 再打请求**、先把数据重置到已知状态）：同租户签发→换签→审计可见；换头→40311/40310；跨租户 `listSvcTokens` 不可见；跨租户吊销→404 且 jti 仍有效 | 逐条断言有日志 |
| V5 | 实施前复查三表 `count(*)` 仍为 0、无 `seed*.sql` 向三表 insert | 三个 0 / 无命中 |
| V6 | 发布形态：`pnpm pack` → 解包 → 6 个 dist 0007 副本全含 `tenant_id`；`ojm api --check` 仍 0 error / 0 warn | 6/6 命中、契约守卫绿 |
| V7 | 发版说明含 R5/R6 边界（SvcGate 全局核销、裸头自证、不宣称全链路隔离） | 文档在档 |

---

## 10. 收口

**一句话**：用户这一拍，把方案从「0008 + 一堆存量兜底」简化成「改三份 0007 + schema/config + 两处测试 + 删库重建」，parity/s-2 守卫**一个都不用动**；但仍要守住三件事——**交付名降到「分区」**、**身份层/4031x 显式挂账不写「阶段二已排期」**、**任何带旧 `:7` 的库与旧 dist 副本都不能活到新代码下**。

边界声明：
- SvcGate 上游静态 SQL（`SELECT jti FROM oj_svc_token`）属 oj-bin，本仓只读，不改（D1）。
- 企微员工绑定自动化 A（换签回退）/ B（一键导入）本次不做。
- 本报告与修订后的方案均为文档；`openapi.json`、`__client`、实现代码零改动。

---

## 11. 强绑定改判与真机验证结论（2026-11-11，覆盖初版 K1/K7/Q7）

用户裁决「以强绑定形式再修改一轮并重新评估」，且明确「连代码一起落地」。初版评审里「强绑定暂不做」的前提被推翻，本节记录改判结果与真机验证。

### 11.1 强绑定落地的关键改动（24 文件）

| 维度 | 落地内容 | 验证 |
|---|---|---|
| 配置 | `config.yaml` `require_signed_claim: true`；`tenant.shared_allow` 移除三表（17→14）；`tenant.anonymous_paths` 增 `/auth/login`、`/auth/ldap-login`、`/auth/logout`、`/auth/refresh`、`/oj-market/converge`；修正过时 R6 注释（claims 在 oj 0.1.130 已平铺，非静默丢弃） | 单测 + 真机 |
| 三表租户化 | 0007 三方言 CREATE TABLE 加 `tenant_id` 首列（不写 DEFAULT，无存量行）；`oj_bot_binding` PK→`(tenant_id, provider, external_sub)`；`schema.yaml` 三表去 `tenant: false` 改声明 `tenant_id` | 真机 migrate 落盘确认列存在 |
| 签名链平铺 tenant | `session.ts` `signAccess:(sub,tenant)=>jwt.sign({sub,claims:{tenant}})`；`issueFor/localLogin/refresh/changePassword/issueExternal` 均带租户；`system/service-token`、`bot.ts` 签发点 emit `claims.tenant` | 单测断言 `signAccess` 收到 `(sub,tenant)`、roles 不进 claims |
| 无头链接管死锁 | 登录/刷新/登出/ldap/市场收敛 5 条无 token 链：`config.anonymous_paths` 放行 + **前端不为这些请求注入 `X-TENANT-ID`** + handler `db.asTenant(body.tenant\|\|"default")` 自报租户；三表 `sql_guard: deny` 自动按当前租户注入谓词 | 真机 T1–T4 |
| 刻意不用 `db.asSystem()` | auth 引导链 pre-pipeline 即 403，`asSystem` 不可达（且 `sys_refresh_token` 自身是租户表，引导即循环）；刷新/登出沿用「请求体自报 + `db.asTenant`」同构 | 设计裁定（专家复评审收敛） |

### 11.2 换专家复评审收敛结论

红队 / 开源治理 / 演化架构经济 / 发布运维 / DX 五视角复评（不引用初版论证链，各自取证）：
- **初版 K1（裸头自证）已被强绑定消解**：`require_signed_claim: true` 下，服务端只认 JWT 顶层 `claims.tenant`，伪造 `X-TENANT-ID` 头在前置管线即 `403`（真机 T2/T3 实证）。
- **初版 K7（头值契约 blocker）被消解**：强绑定让「头值 = 签名 claim」成为硬约束，不再是「上线即断」的软契约；前端免注入头 + handler 自报租户，闭环成立。
- **SvcGate 上游静态 SQL 无租户谓词（K2/D1）仍是 oj-bin 外部事实**：本仓只读、不改；功能轴 500（见 11.4 真实越权读未重测，留作 P3 的 oj-bin 侧议题）。
- 三表 tenant 隔离数据层机制（自动注入 `tenant_id` 谓词）真机实测成立（T1 SQL 日志 `WHERE ... AND users.tenant_id = ?`；svc token 表 INSERT 带 `tenant_id`）。

### 11.3 真机冒烟矩阵（oj 0.1.130 真二进制，dev/ts 模式，全新 db.sqlite）

| # | 请求 | 期望 | 实测 |
|---|---|---|---|
| T1 | POST `/api/auth/login` 无 `X-TENANT-ID`、body `{tenant:"default"}` | 200 + JWT 顶层 `tenant:"default"` | **200**，payload `{"sub":"2","roles":[],...,"tenant":"default"}` |
| T2 | 合法 token + 伪造 `X-TENANT-ID: evil` | 403 | **403** `tenant header does not match signed claim` |
| T3 | `X-TENANT-ID: evil` + 无 token 直接登录 | 403 | **403** `tenant requires a signed claim` |
| T4 | 合法 token、无伪造头 | 200 | **200** |
| T5 | 三表 schema（全新 migrate） | `tenant_id` 首列 + `oj_bot_binding` PK `(tenant_id,provider,external_sub)` | 真机 `PRAGMA table_info` 确认 |

> 结论：强绑定 + 三表租户隔离端到端成立；tokenless 登录链在「前端免注入头 + handler 自报租户」下不锁死登录。

### 11.4 验证中暴露的两个**既有**阻断点（非本任务引入，如实记录）

1. **`oj build` 产物 minify 损坏 `session.js`（阻断 built-dist 形态验证）**：`oj build` 把 `refresh()` 的 `value: hashOf(String(token ?? ""))` 错并成 `value:i=String(e??""),r.sha256Hex(i)`，导致 `oj serve`（release/js）/ `ojm preview` 形态下 login 直接 500 `SyntaxError`。源码 `session.ts` 本身正确（`node --check` 通过）；这是 `oj build` 工具链的 minify bug，**影响所有走 built-dist 的流程（含 `ojm preview`）**，与强绑定无关。规避：用 `ojm dev`（src/ts，不 minify）验证登录行为。集成测试 `tests/integration/uni-dev-smoke.test.ts` 的 login 步骤走 `ojm dev` 因此不被影响，但其 `build`/`preview` 步骤若触达 login 也会中招。
2. **`_platform/seed.sql` 的 `DELETE`/`UPDATE` 与 oj 0.1.130 `--with-seed` 白名单冲突（阻断显式 `--with-seed` 灌种）**：`seed.sql` 第 14/15 行历史清理语句（`DELETE FROM sys_user_role ...; UPDATE users SET must_change=0 ...`）被 `--with-seed` 的「只放行幂等 INSERT」门禁拒绝，整条 seed 回放失败、admin 不落地。冷启动重放（preview/dev 的 `migrate` 不带 `--with-seed`）不受影响，admin 正常落库。属于「模板随 oj 升级到 0.1.130 的兼容性尾巴」，建议后续把这两行改成幂等 INSERT-only 或移出 seed。

### 11.5 修订后放行判据（替换初版 §8 Q1/Q7）

- Q1（交付定性）：强绑定下「数据层分区 + 身份层硬绑定」**同时成立**，可恢复「多租户隔离」定性，发版说明如实写「强绑定（require_signed_claim）已开、SvcGate 上游静态 SQL 仍无租户谓词（oj-bin 侧待办）」。
- Q7（是否含强绑定）：**已含**（用户裁决「连代码一起落地」）。
- 余下 major（N1 残留库删重建、N2 发布形态 rebuild 6/6、K3 审计索引、K4/K5 4031x 话术、K9 三方言实测、K10/K11 过时注释）仍按初版 §8 推进，不回退。
