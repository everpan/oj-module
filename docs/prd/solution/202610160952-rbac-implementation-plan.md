# RBAC / 账号 / 通讯录 实施计划

> 状态：待评审 · 日期：2026-10-16 · 上游：`202610160908-rbac-auth-design.md`（设计定稿，四专家评审修订）
> 范围：设计文档 D1–D14、hook H1–H12、验收 AC1-1~30 / AC2-1~7 的**代码实现**。
> **本文档只定计划，不开工。** 方法：TDD/BDD（先写用例再实现）；架构遵循 SOLID/DRY；**优先代码实现**（文档已到位的不再返工）；**集中审查**（每阶段绿灯后统一评审点合并，不做逐任务评审）。

---

## 1. 总体策略

| 维度 | 约定 |
|---|---|
| 分支 | 每个阶段一条 `feat/rbac-<phase>` 分支，自 `feat/ojm` 切出；**集中审查**通过后合并回 `feat/ojm` |
| 方法 | 后端 api 采用 **BDD + DDD**：BDD 用例先行（AC 即需求），DDD 组织代码——领域实体/领域服务（users、role、permission 聚合，框架唯一真相）、应用服务（handler 编排）、基础设施（db 访问经构造器红线）；限界上下文 = 框架 `_platform` 与各解决方案 |
| 架构纪律 | SOLID：判权/审计/登录/通讯录各为单一职责模块，service 不越权判权（§2.3-1）；DRY：查询纪律（limit 钳 200 / truncated / LIKE 转义 / keyword≥2）收敛为一个共享查询工具 |
| 集中审查 | 阶段评审点：typecheck + lint + test 全绿 → 发起一次集中评审（变更全量 diff）→ 修复 → 合并；不在任务中途开评审 |
| 任务跟踪 | **本计划文档的任务表是唯一跟踪源**：状态（未开始→进行中→已完成/阻塞）+ 开始时间 + 耗时随任务推进**就地更新**；实现期发现偏差/反常识即时追加设计文档 §9，不另建跟踪工具 |
| 阶段小结 | 每阶段任务**全部完成**后必须写阶段小结（模板见各阶段 DoD 后），再进入下一阶段；全部阶段完成后更新 §9 总结段（关键过程与总耗时） |
| 代码优先 | 设计与 PRD 已定稿，实现期发现矛盾**先记反常识条目到设计文档 §9，后按决策修订**，不阻塞编码 |

## 2. 阶段 0：测试形态 spike（半日，阻塞项）

分支 `feat/rbac-spike`。

| # | 任务 | 内容 | AC 锚点 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| S0 | 测试形态 spike | 纯函数 + oj 测试框架跑通 sqlite；验证 DB 事务能力；一条真实判权 AC 通过；结论回填设计文档 §9 | AC1-5 | 已完成 | 0958 | 5min |

**任务 S0** 详细说明（验证后端可测性，工程评审 E10）：

- spike：`_platform` 模块逻辑抽成接受 db 句柄的纯函数 + oj 侧测试框架跑通 sqlite 方言；
- 验证 oj DB API 是否暴露事务句柄（影响判权缓存失效与级联删除的实现方式，设计文档 D10/§5）；
- **DoD**：一个真实判权纯函数 + 一条 AC（如 AC1-5）在测试框架中通过；结论回填设计文档 §9。
- 若 spike 失败 → 升级决策：后端 AC 改手工验收清单，框架代码仍需单测覆盖纯函数层。

**阶段小结**（S0 已完成，2026-10-16）：
- 关键过程：复用 oj-wiki 测试先例（vitest + node:sqlite 真实迁移夹具），落进模板 `packages/cli/templates/api/`：vitest.config + fixture + 判权纯函数 `decideAccess`（BDD：spec 先行，红→绿）；AC1-1~6 判定矩阵 8 断言 + 夹具冒烟（迁移/全局 db/事务往返）3 断言全绿
- 实际耗时：约 5 分钟（0958–1002）
- 偏差与决策回填（设计文档 §9 条目号）：§9.1 spike 结论已回填（测试形态成立、事务面确认、Node crypto 只读反常识）
- 反常识记录：Node 22 `globalThis.crypto` 只读，夹具补不了 `sha256Hex`——oj 增补 crypto 面按用例单独 stub
- 集中评审结论：待阶段 A 合并时随分支集中评审

## 3. 阶段 A：后端地基（对应 PRD M2）

分支 `feat/rbac-backend`。**先写测试**：判权链/审计/脱敏单测（PRD M2 验收）。

| # | 任务 | 内容 | AC 锚点 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| A1 | 建表与迁移 | `sys_setting` / `sys_oplog` / `sys_solution_route` / `sys_role` / `sys_permission` / `sys_role_permission` / `sys_user_role`（含 `deprecated` 列）；users 增 `source`/`display_name` 迁移；**移除 `users.roles` JSON 列**（D10，含 wiki 数据迁移脚本） | AC1-7 | 已完成 | 1005 | 10min |
| A2 | seed | 框架内置角色（superadmin/admin/editor/viewer，`builtin=1`）；**seed 默认 superadmin 账号**（D12：`admin`/`123456` 固定口令 + `must_change=1` 首登强制改密）。~~原文「初始口令随机生成并打印一次」不可行：seed.sql 是静态 SQL、运行时每次启动重放，无安装期 JS 钩子——随机口令须待安装器（M5）落地，现阶段 must_change 闭环兜底默认凭据窗口（取舍见设计文档 §9.2-6）~~ | AC1-27 | 已完成 | 1010 | 15min |
| A3 | 判权出口 | `_platform` 共享 service：`assertPermission`（四级链，DB 权威源 + 进程内缓存写时失效）、`assertSystemAdmin`、`assertSuperAdmin`（D11）；code 首段 JS 侧切好传参（三方言纪律）；顺带校验 `is_forbidden`（**A3 内补迁移 0006 加列**——A1 遗漏，实现期发现并回填设计文档 §9） | AC1-1~6, AC1-9 | 已完成 | 1014 | 12min |
| A4 | 审计 | `recordOp` + `auditOp`（fire-and-forget，脱敏红线）；403 失败审计按 (user_id, code) 分钟窗口去重（AC1-29）；`sys_oplog` 带 module/version | AC1-29 | 已完成 | 1017 | 8min |
| A5 | 查询工具 | DRY 收敛：`paginate(limit≤200, truncated)` + `likeEscape(keyword, minLen=2, maxLen=64)` 共享工具，全部列表接口复用 | AC1-22/24 | 已完成 | 1020 | 10min |
| A6 | 角色管理 API | 角色 CRUD（custom 机器名强制 `custom.<slug>`）、绑定编辑（insert-if-absent 语义、superadmin/admin/editor/viewer 不出现在绑定编辑）、deprecated 已绑定视图标灰、占用禁删、**手动摘绑定 = 紧急吊销出口**；写审计 role.create/bindings.update/delete | AC1-15~20, AC1-28, AC1-30 | 已完成 | 1023 | 25min |
| A7 | 通讯录 service | `searchContacts`（不含 email/avatar/roles，排除禁用）+ `GET /api/_platform/contacts[/:id]`（keyword≥2、限速、详情含 email/avatar）；**补迁移 0007 加 email 列**（设计 §4B 引用而 A1 未落，同 is_forbidden 先例） | AC1-22~25 | 已完成 | 1028 | 12min |

**DoD**：三方言（sqlite 起步，mysql/pg 冒烟）迁移通过；A3/A4 单测全绿；集中评审合并。

**阶段小结**（阶段 A 全部任务完成，2026-10-16 10:32）：
- 关键过程：A3 判权出口（guard 纯函数 + access DB 加载/短 TTL 缓存/写时失效，15 断言）；A4 审计（recordOp/auditOp + 403 (user,code) 分钟窗口聚合，7 断言）；A5 查询工具（paged/likePattern，7 断言）；A6 角色管理 service 全规则 + /api/system 管理域端点（11 断言）；A7 通讯录 service + /api/_platform/contacts 端点 + rate 限速工具（6 断言）。全阶段 BDD 先行（红→绿），75 测试 8 文件全绿；lint 0 错、typecheck 净
- 实际耗时：A1 10min + A2 15min + A3 12min + A4 8min + A5 10min + A6 25min + A7 12min ≈ 92min
- 偏差与决策回填（设计文档 §9 条目号）：§9.2/§9.3/§9.4 已回填（is_forbidden/email 列 A1 遗漏补迁移 0006/0007；http.user 可变全局须在调用入口同步捕获；403 聚合并发竞态→进程内串行队列）
- 反常识记录：① 设计文档全篇引用 is_forbidden/email 但 A1 迁移未落列（评审两轮未检出，实现期才被测试钉出）② deny 审计并发产生多首条破坏 AC1-29 语义，须串行队列 ③ `LIMIT ? OFFSET ?` 三方言参数化通吃，但 LIKE 转义 sqlite 默认无转义符/mysql/pg 默认非 `!`，须显式 `ESCAPE '!'`（三方言同义最小公倍）
- 集中评审结论：待评审——本阶段 11 个 commit（065c7d2c..822842f1）；**DoD「mysql/pg 冒烟」已实机完成**（ojwiki-mysql 8.4 / ojwiki-pg 16 容器全量重放迁移+seed 双绿，方言差异清单回填设计文档 §9.2-5）；评审要点：diff 全量、方言覆盖文件与 oj-wiki 先例逐字同型的核对、串行队列吞吐上限

## 4. 阶段 B：登录链改造（对应 PRD M3 账号部分）

分支 `feat/rbac-auth`。**先写测试**：AC1-10/12/13/26/27。

| # | 任务 | 内容 | AC 锚点 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| B1 | 登录顺序 | 本地登录先验口令后查禁用（统一 401，D14）；LDAP 路径保持先查号并注明接受 | AC1-12 | 未开始 | - | - |
| B2 | 首登改密 | 建号默认 `must_change=1`；限权 token（仅改密端点）；自助改密（本人+旧口令）；改密/禁用级联删 refresh | AC1-27 | 未开始 | - | - |
| B3 | refresh token | §3.1 完整实现：不透明随机串、SHA-256 哈希存储、30d 绝对 TTL、轮换作旧、reuse 检测全族吊销+审计 | AC1-13 | 未开始 | - | - |
| B4 | access token | JWT 仅载 `sub`，15min；签发时一次 JOIN 读 `sys_user_role` 填用户资料接口（roles 走资料接口不进 claims） | AC1-13 | 未开始 | - | - |
| B5 | 登录限速 | (IP, username) 双维度限速 + 指数 backoff + 失败审计 | AC1-26 | 未开始 | - | - |
| B6 | 建号加固 | 拒绝 `^(ldap|sso):` 前缀用户名；口令 ≥6 | AC1-17 关联 | 未开始 | - | - |
| B7 | 账号管理 API | 4 接口（create/roles/password/forbidden）+ 保护红线（最后 superadmin、禁止操作自己、admin 不碰成员资格）+ 写审计 | AC1-7~10 | 未开始 | - | - |

**DoD**：登录/刷新/改密链路 AC 全绿；集中评审合并。

**阶段小结**（全部任务完成后填写）：
- 关键过程：
- 实际耗时：
- 偏差与决策回填（设计文档 §9 条目号）：
- 反常识记录：
- 集中评审结论：

## 5. 阶段 C：前端页面

分支 `feat/rbac-frontend`。**先写测试**：纯函数（`roleLabel`/`canOperate`/绑定 diff）单测 + 页面 BDD 用例。

| # | 任务 | 内容 | AC 锚点 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| C1 | 用户管理页 | `web/system/pages/user/` 实装（Table+Modal+Form）；角色下拉按 module 分组；superadmin 相关按角色显隐 | AC1-7~10 | 未开始 | - | - |
| C2 | 角色管理页 | 新建（custom.<slug>+展示名）/绑定编辑（标灰 deprecated、超集与页面门角色无入口）/删除（占用禁删）/紧急吊销 | AC1-15~20, AC1-28, AC1-30 | 未开始 | - | - |
| C3 | 操作日志页 | 查询（action/username/module 过滤、truncated）；admin 可查（D13）；403 聚合展示 | AC1-29 | 未开始 | - | - |
| C4 | 系统设置页 | 按 group 分 Card；`framework.site_title` 经 htmlTransform 生效；`market_cdn_url`（superadmin 可见可改） | PRD §4.3 | 未开始 | - | - |
| C5 | 登录页 | **标签切换登录方式**（账号密码 / LDAP / SSO，`GET /system/login-methods` 匿名驱动渲染，未配置不显示对应标签，默认账号密码）；must_change 强制改密跳转 | AC1-12/27 | 未开始 | - | - |
| C6 | 选人组件（可选） | runtime `ContactSelect` 封装 contacts 接口，供 solutions 复用 | AC1-22 | 未开始 | - | - |

**DoD**：四页面可用；title 设置改变浏览器标签；集中评审合并。

**阶段小结**（全部任务完成后填写）：
- 关键过程：
- 实际耗时：
- 偏差与决策回填（设计文档 §9 条目号）：
- 反常识记录：
- 集中评审结论：

## 6. 阶段 D：LDAP 登录（对应 PRD M4）

分支 `feat/rbac-ldap`。**先写测试**：esc 转义单测（RFC 4515 注入样本）+ AC1-12。

| # | 任务 | 内容 | AC 锚点 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| D1 | LDAP 登录 | 移植 wiki 流程 + B1 顺序 + B5 限速 + esc 红线 + 两段式配置（连接段 config.yaml / 映射段 sys_setting） | AC1-12 | 未开始 | - | - |
| D2 | 登录方式发现 | `GET /system/login-methods`（匿名，E6 路径纪律） | C5 关联 | 未开始 | - | - |
| D3 | 设置页 LDAP 组 | 映射段可编辑；连接段只读展示 + 可复制 YAML 片段 + 「需重启」提示；不回写 config.yaml | PRD §4.5 | 未开始 | - | - |

**DoD**：`libldap.dylib` 实机 bind 通过一次真实 LDAP 登录；未配置时登录页无入口；集中评审合并。

**阶段小结**（全部任务完成后填写）：
- 关键过程：
- 实际耗时：
- 偏差与决策回填（设计文档 §9 条目号）：
- 反常识记录：
- 集中评审结论：

## 7. 阶段 E：验收与收尾

| # | 任务 | 内容 | 状态 |
|---|---|---|---|
| E1 | AC 全量回归 | AC1-1~30 / AC2-1~7 逐条过（AC2 系列依赖安装器，属 PRD M5 范围者标记「延后」并说明） | 未开始 | - | - |
| E2 | 设计文档回写 | 实现期偏差与反常识条目追加 §9；任务状态全部更新；补总结段（关键过程与耗时） | 未开始 | - | - |
| E3 | 终版集中评审 | 全量 diff 评审（架构/安全双视角），通过后合并 `feat/ojm` 并打 tag `v0.2.0` | 未开始 | - | - |

## 8. 风险与依赖

| 风险 | 应对 |
|---|---|
| 阶段 0 spike 失败（oj 测试形态不可用） | 半日内出结论；降级为纯函数单测 + 手工验收清单，不阻塞阶段 A 的纯函数层 |
| oj DB API 不暴露事务 | 判权缓存失效改「写后整表失效」（粗暴但正确）；级联删除顺序化 + 失败重试；回填设计文档 |
| mysql/pg 方言差异 | A5 查询工具统一参数化；JS 侧切 code 首段；CI 加三方言冒烟（对齐 PRD M2 验收） |
| AC2 系列（升级稳定性）依赖安装器（M5） | 本计划不实现安装器；AC2 用「模拟安装器 upsert 逻辑」的单元层测试钉死规则，端到端延后至 M5 |

## 9. 总结

本阶段（计划编制）关键过程：四专家并行评审设计文档（产品/架构/工程/安全，36 条发现去重后约 30 项全部处置），用户拍板 4 个设计取舍（DB 判权=撤销即强退、seed 超管、admin 可查审计、本地登录调序）+ 1 个补充决策（DB + 进程内缓存提性能）；版本 bump 至 0.2.0 并提交（commit c14bb1f）。计划编制耗时约 30 分钟。**未开工**，待评审本计划。
