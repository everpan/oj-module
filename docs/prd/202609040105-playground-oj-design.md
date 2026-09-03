# playground-oj 设计文档（全栈验证工程）

- 日期：2026-09-04 01:05
- 状态：已获用户确认（brainstorming 结论）
- 前置文档：`docs/prd/uni-dev.md`、`docs/prd/202609011158-uni-dev-design.md`（ram 编排 oj）、`docs/prd/202609030854-api-contract-design.md`（契约机制）

## 1. 目标与范围

以 `apps/playground` 为基础，新建 `apps/playground-oj`：一个完整的前后端开发应用，作为 **ram 工具全功能验证载体**。

- 模块集合与 playground 对齐（10 个前端模块）
- 模块 API 全部真实化：oj 后端 + SQLite，接口形态参阅 `fake/` 现有实现
- 完整登录与权限：账号 `admin` 密码 `12345`
- 全程采用 ram 工具实现并验证其功能；发现 ram 缺口时补充 ram 功能并记录

非目标：不改动 oj 二进制本身（外部 Rust 仓库）；不引入新的前端框架能力；不做 CI/CD。

## 2. 关键决策（已与用户确认）

| # | 决策点 | 结论 | 理由 |
|---|---|---|---|
| D1 | 后端形态 | **oj**（ram init vendored 二进制） | uni-dev 设计的目标形态；SQLite/JWT auth/handler 热载内建；是验证 ram 全链路的唯一路径 |
| D2 | 登录链路 | **oj 内置 `/auth/*`**（login/logout/refresh） | config.yaml `auth:` 段即启用，JWT+bcrypt 内建，代码最少 |
| D3 | user-info | web 模块真实库查询（内置 auth 只管签发/刷新） | 两者结合：auth 内置 + 业务数据真实 |
| D4 | API 范围 | **全量真实化**（fake/ 全部端点） | 完整验证契约机制与 oj 数据层 |
| D5 | 起步方式 | **`ram init` 生成骨架 + 逐模块迁移** | 最大化验证 ram init（bin 解包/证书/模板/幂等） |
| D6 | 动态路由数据源 | **menus 表演化**（async-routes 从 menus 按角色过滤生成） | 单一数据源，改菜单即改路由，贴合真实后台 |
| D7 | 头像上传 | **Base64 入 SQLite** | blob-s3 是外部对象存储不适用本地；演示性质可接受 |
| D8 | 权限验证 | 除 admin 外 seed 第二个用户 `common/12345`（roles: ["common"]） | 验证 async-routes 按角色过滤的差异 |

## 3. 总体架构

```
apps/playground-oj/                    # ram init 生成骨架，逐模块迁移
├── bin/oj                             # vendored oj 二进制（init 解包，sha256 校验）
├── api/
│   ├── config.yaml                    # server(9778,/api) + db(sqlite://db.sqlite) + auth(jwt) + 证书路径
│   ├── config/{public.pem,cert.jws}   # init 现场签发（RS256 JWS）
│   ├── db.sqlite                      # SQLite 库（oj 缺文件自动建）
│   └── src/<module>/                  # oj 后端模块
│       ├── manifest.yaml              # name/version/tables
│       ├── contract.ts                # 契约单一事实源（uni-dev 层，apiPrefix = 模块目录名）
│       ├── <endpoint>/api.ts          # handler（目录镜像 DSL，热载）
│       ├── migrations/0001__*.sql     # 迁移账本
│       └── seed.sql                   # 种子（INSERT OR IGNORE，每次启动重放）
├── modules/src/<module>/              # 前端模块（从 playground 拷贝，10 个）
├── modules.config.ts                  # 与 playground 同集合同顺序
└── package.json                       # dev/build/preview/info/typecheck（init 生成）
```

运行拓扑（dev）：`ram dev` 起一个端口（默认 5174）——静态（shell dist + modules/dist）+ `/api/*` 反代到 oj（9778）+ 契约 watch + SSE 刷新。release（preview）：`ram preview` 先 `oj migrate`，再以 `api/dist` 起 oj，ram 静态层托管 `modules/dist`。

## 4. 后端模块与端点映射（fake/ → oj 真实 API）

| oj 模块 | 端点（`{base}/{module}/` 下） | 对应 fake | 数据来源 |
|---|---|---|---|
| `web` | `GET user-info` | user.fake.ts | users 表（按 `http.user.id`） |
| `web` | `GET get-async-routes` | async-routes.fake.ts | menus + role_menu 按当前用户角色过滤生成路由树 |
| `web` | `GET country-calling-codes` | auth.fake.ts | 静态常量（对齐 fake/constants.ts） |
| `home` | `GET pie` | home.fake.ts | home_stats 种子表聚合（5 个固定分类） |
| `home` | `POST line`（body: range week/month/year） | home.fake.ts | home_stats 聚合：7 / 当月天数 / 当年已过天数个点 |
| `system` | `GET role-list`（name/status/code 过滤 + 分页） | system.fake.ts | roles 表 |
| `system` | `POST/PUT/DEL role-item` | system.fake.ts | roles 表 CRUD |
| `system` | `GET role-menu`（菜单树） | system.fake.ts | menus 表树形化 |
| `system` | `GET menu-by-role-id?id=` | system.fake.ts | role_menu 表 |
| `system` | `GET menu-list`（分页） | system.fake.ts | menus 表 |
| `system` | `POST/PUT/DEL menu-item` | system.fake.ts | menus 表 CRUD |
| `notification` | `GET notifications` | notification.fake.ts | notifications 种子表 |
| `personal-center` | `POST upload`（头像） | personal-center.fake.ts | base64 入 users 表 avatar 字段，返回 data URL |
| `demo` | `GET todos`（query: keyword） | 原契约 mock 兜底 | todos 表真实读写 |

内置 auth（oj 提供，非业务模块）：`POST /auth/login`、`POST /auth/logout`、`POST /auth/refresh`——信封与字段映射已由 runtime 适配（ac-d16 / D10 登录链）。

## 5. 数据模型（SQLite）

各 oj 模块自管 migrations + seed.sql：

- **web**：`users(id, username, password_hash, roles, avatar_base64, email, phone, description)`（init 模板改造：seed admin/12345 + common/12345，bcrypt）
- **system**：`roles(id, name, code, status, remark, create_time, update_time)`、`menus(id, parent_id, menu_type, name, path, component, order, icon, keep_alive, hide_in_menu, status, roles, permissions, create_time, update_time)`、`role_menu(role_id, menu_id)`
- **demo**：`todos(id, title, done)`
- **notification**：`notifications(id, avatar, title, message, date, is_read)`
- **home**：`home_stats(id, category, stat_date, value)`（pie 按 category 聚合；line 按 range 取窗口聚合）

种子数据对齐 fake/ 现有返回形态（路由树/角色/菜单/五分类饼图），保证前端页面零改动或最小改动。menus 种子即 async-routes 路由树的单一来源（D6）：`handle` 各字段（icon/title/order/roles/permissions/keepAlive/hideInMenu/iframeLink）落列存储。

## 6. 契约层

- 每个后端模块配 `api/src/<module>/contract.ts`（uni-dev 发现路径，`apiPrefix` 字面等于模块目录名，AC-D9）
- `ram api` 产物：`client.ts` + `client.schemas.ts`（发射到前端模块 `api/`）、`routes.json`、`openapi.yaml`、缺失端点的 handler stub（sha256 指纹幂等，人改不动）
- 前端模块改为消费生成的 client（demo 已是试点形态；system 参照 308f48c 的迁移方式）
- login 模块保留 playground 的 authProvider 形态，端点改为 oj 内置 `/auth/*`（runtime 已完成信封/字段/端点三映射，6ac569f）

## 7. ram 功能验证清单（验收标准）

| 命令 | 验证点 |
|---|---|
| `ram init` | 骨架生成、bin 解包 sha256 校验、证书签发、模板 web 模块、幂等重跑只补缺口 |
| `ram dev` | oj 编排（spawn/健康轮询/日志透传/回收）、`/api/*` 反代、契约 watch→重生成→模块重建→SSE 刷新、oj handler 热载 |
| `ram api` | 六产物生成、stub 幂等、未实现端点警告 |
| `ram api --check` | 三重对账全绿（产物同步 / route 双向对账 / routes.js diff） |
| `ram api --docs` | 聚合 openapi + 自包含 redoc 单页（离线可看） |
| `ram build` | 模块构建 + 布局感知全站合并 + `oj build` 编排（api/dist + manifests.yaml + routes.js） |
| `ram preview` | fail-fast 四查、`oj migrate`、release 模式、静态托管 + 反代 |
| `ram info` | oj 观测段输出 |

业务验收：admin/12345 登录 → user-info → async-routes 按角色出菜单 → system 角色/菜单 CRUD 落库（重启 oj 后数据仍在）→ demo todos 真实读写 → common/12345 登录看到受限菜单。

**ram 缺口处理**：过程中发现 ram 功能缺失/缺陷，按"必要情况下补充 ram 功能"原则实现，并追加记录到本文档 §10。

## 8. 错误处理与测试

- handler 统一 `json.ok/json.fail` 信封；未登录/越权由 oj Bearer 守卫兜 401
- `ram api --check` 纳入 typecheck 流水线作为门禁
- 冒烟脚本 `apps/playground-oj/scripts/smoke.sh`：login → user-info → async-routes → 一条 system CRUD 往返，dev 与 preview 两态各跑一遍
- 过程发现的问题按仓库约定追加到文档 §10 并分类（反常规/反常识/与业界不符等）

## 9. 实施顺序（phase 划分）

- **P0**：`ram init apps/playground-oj` 骨架 + 模板 web 模块跑通登录冒烟（admin/12345 改 seed）
- **P1**：拷贝 10 前端模块 + modules.config.ts，dev 全站可跑（契约 mock 兜底未实现端点）
- **P2**：web 模块真实化（user-info / get-async-routes ← menus 表 / country-calling-codes）+ login 对接内置 auth + common 用户
- **P3**：system（roles/menus/role_menu 全套 CRUD）+ demo todos 真实化
- **P4**：home / notification / personal-center（upload base64 入库）
- **P5**：`ram build` + `ram preview` release 态全量回归 + `ram api --docs` 产物 + smoke 两态通过
- **P6**：文档收尾（计划勾选、阶段小结、问题分类、全文总结）

## 10. 过程问题记录（实施中追加）

（空——实施阶段按发现追加，含分类与处置）
