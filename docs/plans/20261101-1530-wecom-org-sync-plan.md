# 企微通讯录 / 组织架构同步：最终方案（评审修订版 v2）

> 状态：**A1–A3、B1、B2 已实施**（2026-11-01），含 §5.4 的用户页（所属部门 / 主部门列 + 按部门含子部门筛选）。
> 余下见 §8 分期表：`C1` 事件增量 / `C2` LDAP /
> `D` 定时，以及三处**明确未做**的项——① superadmin 跨租户手动触发同步（需绕过租户守卫 + 双写审计）；
> ② 四项权限的「未申请 / 待确认 / 已生效」三态展示（企微未开放查询接口，改为按症状反推，见手册 §2.5）；
> ③ `OrgPicker` 的 runtime export 段（D12，改 runtime 导出要双包 lockstep 发版）。
> v1 经三位专家（企微开发 / 产品运营 / 架构师）评审 + 三位专家（安全合规 / 数据建模 / 交付运维）交叉质辩后修订；
> §12 记录每条意见的采纳与驳回。
> 需求：① 企微代开发自建应用已接入，把组织架构同步进本站；② 做成**共享能力**，别让每个业务模块各建一套；
> ③ 用户企微登录成功时自动补齐本人基础信息与所属部门。
> 官方口径：90208 / 90200 / 90201 / 90196 / 90970 / 33971（代开发应用权限）/ 97201（代开发接入）。

---

## 0. 结论先行

| 项 | 结论 |
|---|---|
| 能做吗 | **有条件能做**。三个前置条件缺一不可，见下 |
| 前置 1 | 代开发模板必须申请**四项**自定义权限（§2.2），且**企业管理员额外确认**（扫码授权只给基础权限，没有姓名和部门名） |
| 前置 2 | 企业不能是「**成员授权模式**」——该模式应用无任何部门权限，同步 100% 失败（§2.3） |
| 前置 3 | 永远只能同步「**应用可见范围内**」的子集，不是全量通讯录。这是硬口径，产品上不许承诺全量 |
| 放哪 | 领域表放 `_platform`（与 `contacts` 并列）；企微同步器放 `auth`；表里不出现任何 `wecom_*` 字段 |
| 同步 | 三轨：登录自更新 / 全量分片推进 / 事件增量（P2b，验证后上） |
| **定位** | ⚡ **CRUD 是基线（保底），企微 / LDAP 只是适配器**。没有外部源时组织架构照样能用；有源时**源只管辖它自己带来的行**（§14） |
| 最大风险 | 不是代码，是**数据全对但看起来全错**（满屏工号、只有几个人）→ 会变成客服工单（§11） |
| 分期 | ⚡ **A 基线（领域+CRUD+共享读面）→ B 企微适配器 → C 事件增量/LDAP 适配器 → D 定时**。基线先立，可独立于企微交付（§8） |

---

## 1. 现状与复用点

| 已有 | 位置 | 本次怎么用 |
|---|---|---|
| JIT 建档 `wecom:<userid>` | `auth/.../wecom/login.ts:ensureWecomUser`、`externalUsername` | 同步的落点。**`username` 就是外部身份真源，不再加 `external_id` 列**（避免双真源，§12-D3） |
| best-effort 补名 | `client.ts:userNameById` | 扩展成「登录自更新」（§6.1） |
| 企业 token | `client.ts:corpAccessToken` | 通讯录接口直接复用，**不需要新凭证** |
| 三张共享表 | `wecom_app_profile` 等 | 新增 `auth_mode` 列；同步按 profile 遍历 |
| 通讯录事件 | `events.ts` default 分支 | 现状「收到记日志回 success」，P2b 开始消费 |
| 读模型 | `_platform/.../domain/contacts.ts` | **不能照抄它的门禁**（§3 D5 已被推翻，见 §12-D1） |
| 跨租户写范式 | `store.ts:100 revokeTenantSessions`（裸 SQL 显式带 `tenant_id`） | 跨租户同步走同一范式，**不用 `asSystem`**（后者模板零先例） |
| 三方言迁移 | `_platform/migrations/0015__tenant.*` | 照抄：mysql 写 `VARCHAR`、pg/sqlite 写 `TEXT`，schema.yaml 仍声明 `text` |

---

## 2. 企微侧硬约束（决定产品长什么样）

### 2.1 接口清单

| # | 接口 | 用途 | 备注 |
|---|---|---|---|
| 1 | `GET /cgi-bin/department/simplelist?access_token=&id=` | **全量主路径**：BFS 递归子部门 id | 官方推荐（90208 明写 `list` 性能低）；天然可分片 |
| 2 | `GET /cgi-bin/department/get?access_token=&id=` | 单部门详情（name/parentid/order） | 与 1 配套 |
| 3 | `GET /cgi-bin/department/list?access_token=&id=` | 一次拿全量 | **降级兜底**：1/2 因权限返回空时用它 |
| 4 | `GET /cgi-bin/user/simplelist?access_token=&department_id=` | 部门成员（userid/name/department） | 轻量；**无 `fetch_child`**，子部门要自己递归 |
| 5 | `GET /cgi-bin/user/list?access_token=&department_id=` | 部门成员详情（职务/排序/主部门/状态） | 重量；同一部门只调一次 |
| 6 | `GET /cgi-bin/user/get?access_token=&userid=` | 单成员详情 | **登录自更新用它**（1 次调用） |

> `user/list_id`（获取成员 ID 列表）需**通讯录同步 secret**，代开发用的是应用 token，**走不通**，别试。
> `open_userid` 仅第三方应用可获取，**代开发拿不到**，不落库。

### 2.2 权限：四项，且分「基础 / 自定义」两类（v1 此处错误）

依据官方 33971：基础权限扫码即得且不可编辑；**自定义权限需企业额外确认**（97201：每次编辑保存会向企业推权限变更消息，有「**待企业客户确认**」中间态，未确认则不生效）。重发开通链接只是幂等 upsert，**补不了权限**。

| # | 权限 | 不申请的后果 |
|---|---|---|
| ① | 成员基本信息 → **姓名** | 满屏工号（`name` 返回 userid 代替） |
| ② | 成员基本信息 → **部门名** | **一棵全无名节点的树**（注意：它不在「组织架构」权限下） |
| ③ | 成员基本信息 → **职务** | `position` 空 |
| ④ | 组织架构 → **部门及父部门 ID、部门负责人** | 只拿得到可见范围内的部门 id，`department[]` 不完整 |

后台要显示**三态**：`未申请 / 待企业确认 / 已生效`，各配一段可复制给企业管理员的话术 + 一键重推（再编辑保存一次）。

### 2.3 成员授权模式（v1 遗漏，阻断级）

`get_permanent_code` 的 `auth_info.agent[]` 带 `auth_mode`（0=管理员授权 / 1=成员授权）。
**成员授权模式下应用无任何部门权限**，`department/list`、`user/list` 直接返回 60011，整条同步必然失败。

→ `client.ts` 顺带解析 `auth_mode` → 落 `wecom_app_profile.auth_mode` → `sync/start` 判 1 即 **400**「该企业为成员授权模式，不支持组织架构同步」，不要跑成一片 60011。

### 2.4 可见范围：永久的子集

代开发**永远**只能拉「token 对应应用权限范围内」的部门，授权 ④ 也不解除。UI 必须常态提示（不是只在出错时）：

> 本页显示的是企业微信中**本应用可见范围内**的 N 个部门、M 位成员。需要看到全公司，请贵司管理员在企微「应用管理 → 本应用 → 可见范围」中扩大范围后点此同步。

### 2.5 敏感字段

2022-06-20 起新建的代开发应用，`user/get` / `user/list` **不再返回**头像/性别/手机/邮箱/地址，需 oauth2 手工授权。**P0–P2 不强求**，字段留空。

---

## 3. 架构决策（v1 → v2 修订处标 ⚡）

```text
L3 消费层   notification / access / demo …
              ↓  HTTP /api/_platform/org/*   或   同 isolate import（#/_platform/… + manifest deps）
L2 领域层   _platform：sys_department + sys_dept_member + 读模型（不含企微语义）
              ↓  领域对象 upsert
L1 适配层   auth/wecom/sync：企微 JSON → 领域对象（第一个源适配器）
L0 基础     租户 = corp_id（tenantOfCorp）
```

| 决策 | v2 结论 |
|---|---|
| D1 领域表放 `_platform` | 不变。用户要求共享；与 `contacts` 同层 |
| D2 同步器放 `auth` | 不变 |
| D3 同步任务表放 `auth` | 不变（租户表） |
| D4 键设计 | 本地自增 `id` 做关联键；`origin`/`origin_id` 只做溯源。**`parent_id` 也用本地 id**（v1 混用了 `parent_origin_id`）⚡ |
| D5 ⚡**读面门禁** | **推翻「登录即可」**。两级：`scope=self`（默认，只读自己的部门路径/主部门/同部门成员）／`scope=all`（挂权限点 `platform.org.read.all`）。读面**不出** `origin_status`、不出负责人关系 |
| D6 触发同步门禁 | 挂权限点 `auth.wecom.sync`；跨租户 admin 面另设端点 |
| D7 ⚡跨租户 | **两个端点**，不靠 `corpId` 参数区分：租户内 `POST /auth/wecom/sync/start`（只同步当前租户）+ superadmin `POST /auth/wecom/admin/sync/*`（**只返回 status/phase/stats/err 元数据，不返回任何组织架构明细**，避免变成绕开租户隔离的数据出口）。跨租户写走 `store.ts:100` 的裸 SQL 显式带 `tenant_id` 范式 |
| D8 ⚡upsert | 构造器**无 upsert**。统一「先 select → 有则 update / 无则 insert → 唯一违例 catch → update + 回查 id」，抽 `upsertDept` / `upsertMember`（照 `store.ts:105 saveProfile`） |
| D9 ⚡墓碑 | **不按 `synced_at < 起点` 删**。改为 `visible` 标记 + `seen_job_id`；只有「本轮完整且无 skip」才批量置 `visible=0`；`deleted=1` **只由 `delete_party` 事件置**。理由：分不清「企微真删了」和「失去可见范围」 |
| D10 ⚡占位部门 | 登录自更新**不得**创建未知部门（否则任何登录成员都能凭空造出部门节点/汇报关系）。未知部门一律跳过，等全量同步补 |
| D11 ⚡契约同步 | 四步：handler 挂 `.schema`/`.response` → **手工注入** `templates/openapi.json`（注入后禁止再跑 `oj openapi`，会冲掉）→ `ojm api` 重生成 `__client` → `ojm api --check`。真正会挂的是 `ojm api --check`，**不是** `tests/cli/init.test.ts:332`（它只断言 demo/home 端点被裁掉） |
| D12 ⚡OrgPicker 归属 | 前端跨模块 import 只允许 `@oj-module/runtime` / importmap / 自身相对路径（SKILL.md）。组件以 runtime 新 export 段发货，**注意双包 lockstep 发版** |
| D13 ⚡**归属权 = `origin`** | `origin` 不只是"来源标签"，它是**归属权标识**：`local` = 本站管理员全权（可 CRUD）；`wecom`/`ldap`/`sso` = 该适配器管辖。**任何同步/回收动作都只作用于自己 origin 的行**——这是"适配器可插拔"与"CRUD 保底"能共存的根本机制 |
| D14 ⚡**保底出口：脱离同步** | 管理员可对任意外部来源的部门/用户执行「**转为本地维护**」（`origin` 改为 `local`）。此后适配器不再管辖它，CRUD 全开。这是"保底"的兜底开关，也是解决「源覆盖手工修改」的唯一出口 |

---

## 4. 数据模型

迁移**拆两份**（`_oj_migrations` pk = `[module, version]`，两模块各有 journal）：
`_platform/0016__org.{sql,mysql.sql,pg.sql}` + `auth/0002__org_sync.{sql,mysql.sql,pg.sql}`。
三方言写法照 `0015__tenant.*`：mysql 键列 `VARCHAR(64/128)` + `BIGINT`，pg/sqlite `TEXT` + `BIGINT`；schema.yaml 统一声明 `text`/`integer`。

### 4.1 `sys_department`（租户表）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | integer autoincrement | pk |
| `tenant_id` | text NOT NULL | |
| `origin` | text NOT NULL DEFAULT 'wecom' | 来源 |
| `origin_id` | text NOT NULL | 企微部门 id（字符串存） |
| `parent_id` | integer | 本地父部门 id；根为 NULL ⚡ |
| `name` / `name_en` | text | 未授权时为 NULL，展示层用 `origin_id` 兜底 |
| `order_no` | integer NOT NULL DEFAULT 0 | 父内排序，值大靠前 |
| `visible` | integer NOT NULL DEFAULT 1 | ⚡ 失去可见/疑似删除 → 0（不物理删） |
| `deleted` | integer NOT NULL DEFAULT 0 | ⚡ 只由 `delete_party` 事件置 |
| `seen_job_id` | integer | 最近一次完整全量命中的 job |
| `update_time` | integer NOT NULL | |

`UNIQUE (tenant_id, origin, origin_id)`；索引 `(tenant_id, parent_id, visible, order_no)`、`(tenant_id, origin, visible, seen_job_id)`。
⚡ 删除 v1 的 `leader_userids` 列（`department_leader` 第三方才可获取）；负责人统一走 `sys_dept_member.is_leader`，负责人不在成员列表的情况留到 P2 再考虑独立表。

### 4.2 `sys_dept_member`（租户表）

`id` pk；`tenant_id`、`user_id`→`users.id`、`dept_id`→`sys_department.id`、`order_no`、`is_leader`、`is_main`、`update_time`。
`UNIQUE (tenant_id, user_id, dept_id)`；索引 `(tenant_id, dept_id, order_no, user_id)`。

对齐纪律：`order[]` / `is_leader_in_dept[]` 与 `department[]` **逐位对应**，长度不等按 0 填充（要写单测）。
`main_department` 可能缺失（仅当应用对主部门有查看权限时才返回）→ 兜底取 `department[0]`，且保证同一 user 至多一行 `is_main=1`。

### 4.3 `users` 扩列（最小改动）

| 新列 | 说明 |
|---|---|
| `activated` integer NOT NULL DEFAULT 0 | ⚡ **防 `contacts` 被放大**（见 §9.1）。存量行迁移时置 1；同步建档默认 0，首次登录置 1 |
| `position` text | 职务 |
| `origin_status` integer | 企微状态快照 1/2/4/5（**整数，不用 TEXT**） |

⚡ **不加 `external_id`**：`username = 'wecom:' + userid` 已是唯一真源（`login.ts:externalUsername`），再加一列就是双真源。

**`origin_status` 不改写 `is_forbidden`**：企微「离职/禁用」自动停用会和本站管理员的手动启停互相覆盖。改法：只存快照，登录时判 `origin_status ∈ {2,5}` → 拒登录（沿用现有 401 口径），停用位永远以管理员为准。

### 4.4 `wecom_app_profile` 加列

`auth_mode` integer NOT NULL DEFAULT 0（§2.3）。

### 4.5 `wecom_sync_job`（auth，租户表）

`id` pk；`tenant_id`、`corp_id`、`agent_id`、`status`(idle/running/done/failed)、`phase`(departments/members/reconcile)、`cursor`(JSON)、`stats`(JSON)、`started_at`/`finished_at`/`update_time`(BIGINT)、
⚡ `err_code` text / `err_detail` text（**只存脱敏后的 `{errcode, phase, deptId, at}`，绝不存异常原文**）。

抢锁：以 PK `(tenant_id, agent_id)` 的 `sync_lock` 行抢，避免 `status='running'` 的读改写竞态。

---

## 5. 接口清单

### 5.1 `client.ts` 新增

| 方法 | 接口 | 失败纪律 |
|---|---|---|
| `departmentChildren(token, id?)` | 1 | 上游错 → 502 |
| `departmentDetail(token, id)` | 2 | 502 |
| `departmentList(token, id?)` | 3 | 502（兜底） |
| `deptMembers(token, deptId)` | 4 | 502 |
| `deptMembersDetail(token, deptId)` | 5 | 502 |
| `userDetail(token, userid)` | 6 | **best-effort：任何失败返回 null，绝不抛**（与 `userNameById` 同纪律） |

**错码分三类**（v1 只有「一律 502」）：

| 类别 | 码 | 处置 |
|---|---|---|
| 权限类 | 60011 / 48002 | **跳过并计 `stats.deptSkipped`，本轮不判 failed** |
| 限流类 | 45009 / 45033 | 指数退避，最多 3 次 |
| 致命类 | 60020 / 45029 / 46004 / 网络 | 计入熔断（连续 10 次 → job `failed`） |

### 5.2 共享读面 `_platform/api/org/*`（D5 两级门禁 + `assertTenantSelf` + `rateLimit`）

| 端点 | 说明 |
|---|---|
| `GET /org/tree?scope=` | 部门树（含成员计数）。`self` 档只返回自身路径 |
| `GET /org/departments?parent=&keyword=` | 平铺分页（大企业避免一次拉全树） |
| `GET /org/members?dept=&includeSub=&keyword=` | 成员 + 部门路径 |
| `GET /org/user?uid=` | 某人的部门路径 / 主部门 / 职务 |
| `GET /org/picker?keyword=` | 人 + 部门混合（选人组件一次拿全） |
| ⚡ `POST /org/resolve {deptIds[], includeSub, userIds[]} → {userIds[]}` | **把「部门（含子部门）」展开成 user_id 列表** |
| ⚡ `GET /org/is-member?uid=&dept=` | 某人是否在某部门（含子部门）下 |

> ⚡ `resolve` / `is-member` 是「共享」的真正价值：需求方要的是「**算**」不是「看」。缺了它们，每个消费模块都会自己把树拉下来递归，共享名存实亡。

### 5.3 同步面 `auth/api/wecom/sync/*`（Bearer + 权限点 + 更严限速）

| 端点 | 说明 |
|---|---|
| `POST /auth/wecom/sync/start` | **不接受 corpId**，只同步调用方当前租户（`tenant_id === corp_id` 天然成立）。返回 `{jobId, status, progress}` |
| `GET /auth/wecom/sync/status` | 轮询进度 |
| `POST /auth/wecom/sync/cancel` | 取消（清游标，不回滚——同步幂等） |
| `POST/GET /auth/wecom/admin/sync/{start,status}` {corpId} | superadmin 跨租户；**只返回元数据**，须先校验 corpId 在 `wecom_app_profile` 存在且 active |

⚡ 这些端点**绝不进** `tenant.anonymous_paths`（`auth/wecom/admin/api.ts:9` 明写管理面必须带租户头）。
⚡ 审计：`recordOp` 加可选 `tenantId`；跨租户场景**双写**——目标租户记 `wecom.org.sync`（detail 带 actor），调用方租户记 `wecom.admin.sync_trigger`。否则受影响企业的管理员在自己后台**永远看不到**「谁同步走了我司数据」。

### 5.4 前端

| 位置 | 内容 |
|---|---|
| `system/web/pages/org/`（新） | 部门树 + 成员表 + **顶部常驻状态条**（§6.4 文案）+ 同步按钮 + 错误卡片（§7） |
| `system/web/pages/users/`（改） | 加「所属部门 / 主部门」列 + 部门筛选（含子部门） |
| `system/web/pages/wecom/`（改） | 每企业加「权限三态」「同步状态 / 上次同步时间 / 手动同步」 |
| `OrgPicker`（新） | 走 `@oj-module/runtime` 新 export 段（D12） |

---

## 6. 同步三轨

### 6.1 轨一：登录自更新（需求 ③）

```text
登录成功（callback）
  └─ 节流：老用户 24h 内不重复打上游；整体 try/catch，失败不影响登录（拿不到就用兜底值）
       └─ userDetail(userid)  ⚡ 1 次调用，软超时（无 timer 全局，用 tasks.sleep 竞态）
            ├─ name → display_name     ├─ position → users.position
            ├─ status → origin_status（不碰 is_forbidden）
            └─ department[] → **只对已知部门写关联**；未知部门跳过（D10）
  └─ users.activated = 1（首次登录才纳入 contacts 目录，§9.1）
```

- ⚡ **不建占位部门**（v1 允许，被判定为可被普通成员伪造组织架构）。
- ⚡ **只加不摘**：人调到新部门，登录只加新部门，旧部门由轨二/轨三摘除——UI 上给主部门加「主」标并置灰非主部门。
- ⚡ `NewUserID`（userid 变更）：必须是 **rename**（改 `username`/`origin` 主键 + 吊销会话），**不新建行**，否则旧号残留且可登录。

### 6.2 轨二：全量同步（唯一权威来源）

```text
phase departments : department/simplelist BFS 递归（兜底 department/list）→ upsertDept
                    ⚡ 孤儿部门（parentid 不在结果集，可见范围所致）→ 挂到根，不报错
phase members     : 逐部门 user/simplelist（轻）/ user/list（要职务与主部门时）
                    → upsertUser + upsertMember；权限类错码 → skip 计数
phase reconcile   : ⚡ 仅当「本轮完整且 skipped=0」才把未 seen 的置 visible=0（不物理删）
```

- **分片推进 + 调用方轮询**（已定）：不动 oj tasks 配置，不受路由超时限制，可续跑可观测。
  ⚡ 分片按「**每片 50~100 部门、单请求 ≤5s**」——**频率不是瓶颈**（官方：每企业单 cgi/api ≤1 万次/分、15 万次/小时；500 部门才 500 次调用），真正的限制是回包大小（45029）与并发（45033）。
- ⚡ 续跑**禁止用定时器**（isolate 无 `setTimeout`），游标由调用方传。
- 并发：抢 `sync_lock`；`status=running` 拒绝第二个 start（409）。

### 6.3 轨三：事件增量（P2b，真机验证后上）

`events.ts` 在 `switch(InfoType)` **之前**加分支判 `Event === "change_contact"`。
⚡ **保留两种 XML 形态的解析**（应用级 `ToUserName/FromUserName=sys/Event/ChangeType`，与 suite 级 `SuiteId/AuthCorpId/InfoType`）——真机验证前这是零成本保险，验证后再收敛。

| ChangeType | 动作 |
|---|---|
| `create_user` / `update_user` | **复用轨一同一套 upsert 函数**（两套写库逻辑必然长歪） |
| `delete_user` | `origin_status=5` + 删 `sys_dept_member`；**不删 `users` 账号**，并按保留期匿名化（§9.3） |
| `create_party` / `update_party` | `upsertDept` |
| `delete_party` | ⚡ 唯一能置 `deleted=1` 的路径（子部门一并标记） |

纪律：事件是**加速器不是权威**——任何失败都照旧回 `success`（否则企微重推三次），只记 `err_code` 等下一次全量兜底。
⚡ **P2a 先做不依赖事件的兜底**（`resolve` + Picker + 消费示范），P2b 开工前必须验完「事件投递地址」。

### 6.4 页面文案（不暴露三轨名词）

> 企微组织架构更新于 **X 分钟前** · 自动同步 · [立即同步]

---

## 7. 降级与自助卡片（照抄进 `wecom-daikaifa.md §8`）

| 现象 | 病根 | 谁处理 | 页面给什么 |
|---|---|---|---|
| 名字全是工号 | 未获权限 ① | 企业管理员 | 卡片：错码/原因/路径（企微 → 应用管理 → 本应用 → 权限） |
| 树只有 id 没名字 | 未获权限 ② | 企业管理员 | 同上 |
| 只有寥寥几个部门 | 可见范围窄 | 企业管理员 | §2.4 常态文案 |
| 400 成员授权模式 | `auth_mode=1` | 企业管理员改授权模式 | 明确文案，不发起同步 |
| 60011 / 48002 | 部门无权限 | 忽略 | 计 `deptSkipped`，页面显示「N 个部门因权限跳过」 |
| 60020 | 出口 IP 白名单 | **服务商运维** | 复用现有速查表条目 |
| 45009 / 45033 | 限流 | 自动退避 | 进度条变慢即可 |
| 46004 | 成员已删除 | 自动 | 跳过 |
| 企业已取消授权 | `cancel_auth` | — | ⚡ 黄条「该企业已取消授权，以下为最后一次同步的快照」+ 冻结同步 + 保留数据 |

⚡ `err_detail` 入库前统一 `scrub()` 抹 `token|secret|permanent_code|password`——`client.ts` 把 token 拼在 URL query 里，异常原文可能夹带凭证，而错误卡片是要给企业管理员看的。

---

## 8. 分期

> ⚡ **分期原则（用户已定）：CRUD 是基线，企微/LDAP 只是适配器。**
> 所以**基线（A）整体排在适配器（B/C）之前**——A 全部零真机、可独立交付、不依赖任何企微凭据；
> 一个不接企微的部署做完 A 就拥有完整的组织架构能力。B/C 是往同一套模型上挂适配器。

| 期 | 内容 | 前置 / 验收 |
|---|---|---|
| **A1 基线·模型** | `_platform/0016__org.*` 三方言迁移 + schema/manifest 同步 + `users` 扩列（`activated`/`position`/`external_status`）+ 领域服务层（部门/成员 CRUD 的 domain 函数，含 `upsertDept`/`upsertMember` 读改写） | 零真机；`pnpm typecheck` / `ojm api --check` 绿 |
| **A2 基线·CRUD** | `system/api/departments/*`（CRUD + `move` + `members`）+ `system/api/users` 补 `PUT`/`DELETE` + 权限点 + 组织架构页（树+增删改移）+ 用户页部门列 + 「转为本地维护」出口（D14） | 零真机；纯本地就能建出一棵完整的树 |
| **A3 基线·共享读面** | `_platform/api/org/*`（`tree`/`departments`/`members`/`user`/`picker`/**`resolve`**/`is-member`）+ `scope=self\|all` 两级门禁 + `users.activated` 接入 `contacts` | 零真机；别的模块能开始消费 |
| **B1 适配器·登录自更新** | `client.ts` 六个读接口 + `auth_mode` 解析与落库 + 登录自更新（节流 + 不建占位部门 + 只写已知部门） | 零真机可编码；真机验 §10-1 |
| **B2 适配器·全量同步** | `auth/0002__org_sync.*` + `wecom_sync_job` + 分片推进 + 错误卡片 + 权限四项三态 + 手册四节 | **前置**：四项权限在测试企业「已生效」 |
| **C1 事件增量** | `change_contact`（`create/update/delete` user & party） | **前置**：验完投递地址与 XML 形态（§10-2/3） |
| **C2 LDAP 适配器** | 第二个 L1 适配器（ou → 部门、member → 成员），验证模型通用性 | **前置**：确认 `axis("ldap")` 支持 search |
| **D 定时** | cron（按 corp 拆任务）+ 敏感字段 oauth2 | 无人值守 |

**A 期不依赖企微**；若只做 A，本方案仍然是一个完整可用的「组织架构 + 共享读面 + CRUD」交付。

---

## 9. 安全与合规（第二轮新增，v1 完全没有）

1. ⚡ **`contacts` 被同步放大（阻断）**：`contacts.ts:22` 只过滤 `is_forbidden=0`；一旦同步为全员建 `users` 行，任何登录账号以 60 次/分就能 keyword 遍历拖走整份企业名册。`contacts` 设计时隐含「users 里都是本人登录过的账号」，这个前提被打破 → 加 `users.activated`，`contacts` 只返回 `activated=1`。
2. ⚡ **读面越权（D5 推翻）**：组织架构含层级 + 负责人 + 主部门 + 在职状态，比 `contacts` 的扁平三字段敏感得多；且同步会把「从未登录本站、无从同意」的全员灌进本地。`self` 档不出 `origin_status`、不出负责人关系。
3. ⚡ **离职成员留存**：定死保留期（建议 `delete_user` 后 90 天匿名化：`display_name`/`position` 置空、删 `sys_dept_member`），写进 retention 说明。
4. ⚡ **审计可见性**：跨租户同步的 oplog 必须写到**目标租户**，否则合规缺口（§5.3）。
5. ⚡ **同步端点限速**：`rateLimit('orgsync:'+uid, 5, 60_000)`，比读面严（打上游）。
6. ⚡ **userid 枚举**：`users` 查询失败一律同一句 401 文案（`store.ts:150` 已有同口径先例）。

---

## 10. 待真机验证（开工前必须验完，别猜）

| # | 问题 | 卡住谁 |
|---|---|---|
| 1 | 四项权限在测试企业是否已「生效」（含企业确认中间态） | P0b |
| 2 | `change_contact` 推到**模版回调 URL** 还是**应用回调 URL**（两个不同配置位） | P2b |
| 3 | 事件 XML 是应用级还是 suite 级 | P2b（代码已兼容，验完收敛） |
| 4 | 成员授权模式（`auth_mode=1`）下的实际错码 | P0b |
| 5 | 大企业真实量级（定分片大小与页面是否要虚拟树） | P1 |

---

## 11. 工单预期（产品侧结论）

**工单会变多**，最大来源不是同步失败（占比小、好定位），而是「**为什么只有这么点人 / 为什么名字是工号**」——数据全对但看起来全错，且处置人**不在服务商侧**（要企业管理员去企微后台点确认）。

压住工单量最关键的三件事：§2.4 的常态可见范围文案、§7 的客户自助错误卡片、§2.2 的权限三态话术。把提示埋在运维速查表里是无效的——企业管理员看不到。

---

## 12. 评审裁决记录

### 采纳（按来源）

| 来源 | 裁决 |
|---|---|
| A-1 成员授权模式 | **采纳（阻断）**：`auth_mode` 落库 + 400 拒绝（§2.3） |
| A-2 永远只有可见范围子集 | **采纳**：写成硬口径（§2.4） |
| A-3 事件是应用级 XML | **修正采纳**：主形态按应用级，但**保留两种解析**（交付专家反对过早删 suite 级分支，零成本保险） |
| A-4 NewUserID | **采纳**：rename + 吊销会话，不新建行（§6.1） |
| A-5 频率不是瓶颈 | **采纳**：改分片依据为 50~100 部门/片（§6.2） |
| A-6 60011 不该 failed | **采纳**：权限类跳过计数（§5.1） |
| A-7 补 45009/45033/45029/46004 | **采纳**（§5.1、§7） |
| A-8 删 `leader_userids` | **采纳**：改用 `sys_dept_member.is_leader`（§4.1） |
| A-9 主路径换 simplelist+get | **采纳**：`list` 降级为兜底（§2.1） |
| A-10/11 主部门兜底、order 长度防御 | **采纳**（§4.2） |
| A-12 删 `open_userid`、不做标签/互联企业 | **采纳**（§2.1） |
| B-1/2/3 权限四类与「企业额外确认」三态 | **采纳（阻断）**（§2.2） |
| B-4 读面登录即可=越权 | **采纳**：推翻 D5，改两级（§3、§9.2） |
| B-6 补 `resolve`/`is-member` | **采纳**（§5.2） |
| B-7 取消授权后冻结 | **采纳**（§7） |
| B-8 手册 §3 拆两个回调 URL | **采纳**（§13） |
| B-9/11 常态文案与自助卡片 | **采纳**（§2.4、§7） |
| C-1 分片推进绕不开租户 | **采纳结论**（不同步跨租户）但**改实现**：用 `store.ts:100` 裸 SQL 显式 `tenant_id` 范式，不用 `asSystem`（模板零先例） |
| C-2 构造器无 upsert | **采纳**：统一读改写（§3 D8） |
| C-4 迁移拆两个模块 | **采纳**（§4 头） |
| C-7 端点不进 anonymous_paths | **采纳**（§5.3） |
| C-8 OrgPicker 走 runtime 新 export | **采纳**（D12） |
| C-10 不用递归 CTE、不看 affected rows | **采纳** |
| C-11 登录自更新节流 + try/catch | **采纳**（§6.1） |
| 安全-1 contacts 被放大 | **采纳（阻断）**：`users.activated`（§9.1） |
| 安全-2 last_error 泄露凭证 | **采纳**：scrub + 只存结构化错码（§4.5、§7） |
| 安全-3/4 留存期与敏感字段分级 | **采纳**（§9.3、D5） |
| 安全-5 占位部门可伪造 | **采纳**：登录轨不建未知部门（D10） |
| 安全-裁决3 审计写目标租户 | **采纳**（§5.3） |
| 建模-裁决2 负责人可能不在成员列表 | **部分采纳**：P0/P1 不做负责人，P2 按需加独立表 |
| 建模-裁决4 墓碑分不清删除与失可见 | **采纳**：改 `visible` + `seen_job_id`，`deleted` 只由事件置（D9） |
| 建模-新增 `parent_id` 用本地 id、加索引 | **采纳**（§4.1） |
| 交付-裁决1 P0 拆 P0a/P0b | **采纳**（§8） |
| 交付-裁决3 P2 拆 P2a/P2b | **采纳**（§8） |
| 交付-2 补 60011/45009 等 spec、可控时钟 | **采纳**（§8、§6.2） |
| 交付-5/6 手册改四节、错码进速查表 | **采纳**（§13、§7） |

### 驳回

| 来源 | 驳回理由 |
|---|---|
| C-3 「pg 基线断了，启动即 fail-fast」 | **误报**。oj 迁移「方言覆盖必胜，通用兜底」（`oj-bin docs/migration.md §3.1`）：缺 `.pg.sql` 时执行通用 `.sql`，而 0003/0005/0006/0007/0013 都是 `ALTER TABLE … ADD COLUMN`，pg 语法合法。降级为「建议」：新迁移三方言都要验证过 |
| 建模-「MySQL TEXT 不可作唯一键」为阻断 | **降级为重要**。仓库已有成熟解法：mysql 方言文件写 `VARCHAR(64)`、schema.yaml 仍声明 `text`（`0015__tenant.mysql.sql:3` 与 `0001__wecom.mysql.sql:5` 均如此）。照抄即可，不构成阻断 |
| 建模-「须建 `sys_external_identity` 表消除双真源」 | **驳回建表**（P0 不需要，过度设计）。但**采纳其关切**：不加 `external_id` 列，`username='wecom:<userid>'` 已是唯一真源（§4.3） |
| 建模-「`origin_status` 用 TEXT 错」 | **采纳**（改 integer），但合并进 §4.3，不单列 |
| 交付-「`init.test.ts:332` 是落点」 | 该行只断言 demo/home 端点被裁掉，不是端点登记表；新增 `_platform`/`auth` 端点不碰它（§3 D11） |

---

## 13. 文档与契约同步清单

改动落地时这几处跟着动（漏了会被守卫挂）：

- `docs/devkit/wecom-daikaifa.md`：§2 加「组织架构四项权限」（B-3）；**§3 拆成「模版回调 URL」与「应用回调 URL」两行**（现 :141 只有一行「数据回调 URL（若模板要求）」且称不消费，必带沟里）；§6.5 造数补「造组织架构」一行；§7.1 加 checklist 项；§8 并入 §7 降级矩阵与新增六个错码；§6.7 加「权限三态只能真机验」。
- `openapi.json` + `_platform/web/__client` + `auth/web/__client`：按 D11 四步；`ojm api --check` 是真正的守卫。
- `config.yaml`：`shared_allow` **不要**加新表（两张领域表与 job 表都是租户表）；P3 引入 tasks 才加 `tasks:` 段。
- `packages/runtime`：`OrgPicker` 新 export 段，**双包 lockstep 发版**（改 runtime 导出后必须 `build:shell`）。

---

## 14. 扩展评估：能否作为「非企微」登录方式的组织架构底座？（含 CRUD）

> 评估对象：本地账号（`local`）/ LDAP（`ldap`）/ SSO（`sso`）三种非企微来源。
> 事实基线：登录方式四种由 `settings.ts:71-77` 定义（`local` 恒在，其余走开关）；
> `users.source` 取值 `local`/`ldap`/`sso`/`wecom`；用户 CRUD 现状只有
> `GET/POST /api/system/users`（`system/api/users/api.ts:11/36`）+ `roles`/`password`/`forbidden` 三个子端点，
> **没有 PUT/DELETE，也没有任何部门端点**。

### 14.1 定位（用户已定，本节据此重写）

> **CRUD 是基线（保底），企微 / LDAP 只是适配器。**

三层含义，逐条落到设计上：

| 含义 | 落到设计 |
|---|---|
| ① **没有外部源时组织架构照样能用** | 分期上 **A（基线）整体排在 B/C（适配器）之前**（§8）；A 全部零真机、可独立交付 |
| ② **适配器只管辖自己带来的行** | `origin` 即归属权（D13）：任何同步 / reconcile 动作都带 `origin='wecom'`（或 `'ldap'`）条件，**绝不碰其它 origin 的行** |
| ③ **管理员永远有最终掌控权** | 「**转为本地维护**」出口（D14）：把外部来源的行 `origin` 改为 `local`，适配器从此不再管它，CRUD 全开 |

模型评估结论不变：**能，推荐就走这条路**（不要为本地/LDAP 再建一套部门表，否则「共享」立刻破功）。
`sys_dept_member` 完全通用，`sys_department` 只差几个语义偏企微的字段（§14.2）。

⚠️ 但若不做 §14.3 的改造与 §14.4 的归属规则，CRUD 会和同步**互相打架**，
典型表现就是「改了没用 / 删了又回来 / 本地部门变孤儿」。

### 14.2 逐元素的通用性体检

| 元素 | 通用？ | 说明 |
|---|---|---|
| `sys_dept_member`（`user_id` + `dept_id` 全本地 id） | ✅ | **完全与源无关，一行不用改** |
| `sys_department.parent_id`（本地 id） | ✅ | 本地部门与同步部门可以混挂 |
| `sys_department.name` / `order_no` | ✅ | |
| `sys_department.origin`（默认 `'wecom'`） | ⚠️ | 领域表不该默认企微 → 改默认 `'local'` |
| `sys_department.origin_id`（NOT NULL） | ⚠️ | 本地部门没有外部 id，见 14.3-① |
| `sys_department.visible` / `seen_job_id` | ⚠️ | 语义是「同步可见性 / 同步轮次」，本地部门恒空 → 改名 `sync_visible` 明示 |
| `sys_department.deleted` | ⚠️ | v2 定的是「只由 `delete_party` 事件置」→ 本地删除需要另一条路径，见 14.4-② |
| `users.position` / `users.activated` | ✅ | |
| `users.origin_status`（企微 1/2/4/5） | ❌ | 对 `local`/`ldap`/`sso` 无意义 → 改名 `external_status`，可空 |

### 14.3 四个改造点

**① 本地部门的 `origin_id`**
两种取法（推荐 A）：

| | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | `origin='local'`，`origin_id` 建行时生成短随机串（如 `crypto.randomUUID()` 前 8 字节 hex） | 保持 NOT NULL 与唯一约束语义一致，无需方言特判 |
| B | `origin='local'`，`origin_id` 置 NULL（三方言 UNIQUE 均允许多个 NULL） | 要靠应用层保证「同父下部门名不重复」；混用 NULL 与非 NULL 易踩坑 |

**② `origin` 默认值 `'wecom'` → `'local'`**；企微同步器本来就该显式传 `wecom`，改默认值不影响它。

**③ `origin_status` → `external_status`**（可空）。语义「外部源侧的状态快照」，企微填 1/2/4/5，LDAP 可填 `disabled` 之类，本地恒空。

**④ `visible` → `sync_visible`、`seen_job_id` 文档化为「仅同步轮次维护」**：同步的 reconcile 只动 `origin='wecom'` 的行，**绝不碰 `origin='local'` 的行**（否则本地建的部门会在第一轮同步后集体消失）。

### 14.4 四条归属规则（不做这四条，CRUD 就是假的）

**① 字段归属权：源拥有的字段只读（除非先脱离同步）**

| 用户 `source` / 部门 `origin` | `display_name` / `position` / 部门结构与层级 | 管理员可改 |
|---|---|---|
| `local` | 管理员拥有 | 全部 |
| `ldap` / `sso` / `wecom` | **源拥有**（下次同步必覆盖） | 仅本站自有字段：角色、`is_forbidden`、（可选）`email` |

→ UI 上源拥有的字段置灰 + 来源徽标 + 「由企业微信同步维护」。
**不要**做成「允许改但会被覆盖」——那是必收工单的设计。

**④ 保底出口（D14）：「转为本地维护」**

被置灰的每一个只读项旁边都给一个动作：**转为本地维护**（`origin: 'wecom' → 'local'`）。
执行后该行脱离适配器管辖，CRUD 全开，后续同步/reconcile 都不再动它。

- 这是「CRUD 保底」的兜底开关——**管理员永远有最终掌控权**，不会被外部源锁死。
- 反向操作（转回 `origin='wecom'`）**不提供**：转回去后下一次同步会立刻按企微口径改写，语义不可控。
- ⚡ 这一条也让 §14.4-②③ 的「禁止删除 / 禁止移动」不再是死路：想要真删或重排，先转本地，再操作。

**② 删除：同步来源的部门不可本地真删，只能隐藏**

| 场景 | 规则 |
|---|---|
| 删 `origin='local'` 部门 | 真删；子部门一并处理（提升或级联删，需产品定）；**手动清 `sys_dept_member`**（逻辑外键无 FK 约束） |
| 删 `origin='wecom'` 部门 | **禁止**。只能 `deleted`/隐藏，否则下一轮同步**原地复活** |
| 删用户 | 沿用现有「停用」语义（`forbidden` 端点已存在），不清 `users`；但**必须清 `sys_dept_member`** |

**③ 移动部门：同步来源部门的 `parent_id` 由源拥有**，本地改必被覆盖 → 同样置灰；只允许移动 `origin='local'` 的部门。
⚠️ 连带规则：reconcile 若要标记某同步部门 `sync_visible=0`，而它下面挂着**本地部门**，不得让它变孤儿——要么提升本地子部门到根，要么拒绝本次隐藏并提示。

### 14.5 需要新增的 CRUD 端点

现有基线只有 `GET`/`POST /system/users`，**缺 PUT/DELETE 与全部部门端点**：

| 端点 | 说明 | 权限点 |
|---|---|---|
| `PUT /api/system/users` | 改资料（display_name/email/position/主部门），源拥有字段按 14.4-① 拒绝 | `system.user.update` |
| `DELETE /api/system/users` | 建议软删（停用 + 清 `sys_dept_member`），不物理删 | `system.user.delete` |
| `GET/POST /api/system/departments` | 部门列表 / 建部门 | `system.department.read/write` |
| `PUT/DELETE /api/system/departments` | 改部门 / 删部门（按 14.4-②） | 同上 |
| `POST /api/system/departments/move` | 移动 + 改排序（按 14.4-③） | 同上 |
| `POST/DELETE /api/system/departments/members` | 加人 / 移出（写 `sys_dept_member`） | 同上 |

建用户与改用户时选部门 → 复用 §5.4 的 `OrgPicker`（这正是它值得上收到 runtime 的理由）。

### 14.6 LDAP 作为第二个「源适配器」

- 模型直接支持：`ou` → `sys_department`（`origin='ldap'`，`origin_id` 用 **entryUUID** 而非 DN——DN 会随组织调整变化且很长），`member`/`memberOf` → `sys_dept_member`。
- 只需新增一个 L1 适配器，L2/L3 一行不动 —— 这正是 §3 分层纪律的兑现。
- ⚠️ 现状 `auth/.../ldap-login.ts` **只有认证、没有目录同步**；要同步得先确认 oj 的 `axis("ldap")` 是否支持 search/遍历（**待验证**）。
- LDAP 同步同样要遵守 14.4 的三条规则（`origin='ldap'` 的部门同样不可本地删）。

### 14.7 对企微方案的回归影响

| 改动 | 影响 |
|---|---|
| `origin` 默认改 `local` | 同步器显式传 `wecom`，无影响 |
| `origin_status` → `external_status` | 同步代码与 §4.3/§6.1 同步改名 |
| `visible` → `sync_visible` | 同上 |
| reconcile 只动 `origin='wecom'` 的行 | **必须加这一条 where**，否则会误伤本地部门 |
| 分期 | ⚡ **重排**：CRUD 不再排在企微之后，而是提到 **A2**（§8）。原「先读面后写面」的理由失效——CRUD 是保底，必须与领域模型同期落地 |
| 端点清单 | §14.5 的 6 个端点全部进 A2；`resolve`/`is-member` 从 P2a 提前到 **A3**（共享读面属于基线，不属于企微） |
</content>
