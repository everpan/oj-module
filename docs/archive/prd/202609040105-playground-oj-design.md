# playground-oj 设计文档（全栈验证工程）v2

- 日期：2026-09-04 01:05（v1）；2026-09-04 01:42（v2，双角色评审后修订）
- 状态：v1 已获用户确认；v2 按评审报告修订，F1/F2 处置经用户拍板
- 前置文档：`docs/prd/uni-dev.md`、`docs/prd/202609011158-uni-dev-design.md`（ram 编排 oj）、`docs/prd/202609030854-api-contract-design.md`（契约机制）
- 评审记录：`docs/prd/202609040142-playground-oj-review-report.md`（架构师 + 开发工程师双角色，F1–F12）

## 1. 目标与范围

以 `apps/playground` 为基础，新建 `apps/playground-oj`：一个完整的前后端开发应用，作为 **ram 工具全功能验证载体**。

- 模块集合与 playground 对齐（10 个前端模块，**全部拷贝自包含**）
- 模块 API 全部真实化：oj 后端 + SQLite，接口形态参阅 `fake/` 现有实现
- 完整登录与权限：账号 `admin` 密码 `12345`（另 seed `common/12345` 验证权限差异）
- 全程采用 ram 工具实现并验证其功能；发现 ram 缺口时补充 ram 功能并记录（§7 缺口流程）

非目标：不改动 oj 二进制本身（外部 Rust 仓库）；不动通用 init 模板（`packages/cli/templates/`）；不做后端动态路由的 UI 可观测化（F2，下次演进）；不做 CI/CD。

## 2. 关键决策

| # | 决策点 | 结论 | 理由 |
|---|---|---|---|
| D1 | 后端形态 | **oj**（ram init vendored 二进制） | uni-dev 设计的目标形态；SQLite/JWT auth/handler 热载内建 |
| D2 | 登录链路 | **oj 内置 `/auth/*`** | config.yaml `auth:` 段即启用，JWT+bcrypt 内建 |
| D3 | user-info | web 模块真实库查询（内置 auth 只管签发/刷新） | runtime 默认登录链已适配（D10 登录链三映射，6ac569f） |
| D4 | API 范围 | **全量真实化** | 完整验证契约机制与 oj 数据层 |
| D5 | 起步方式 | **`ram init` 骨架 + 逐模块迁移** | 最大化验证 ram init |
| D6 | 动态路由数据源 | menus 表演化（async-routes 从 menus 按角色过滤） | **已知限制**：输出在 UI 被模块路由遮蔽（F2），降级为 API 级演示，下次演进；验收按 API 级断言 |
| D7 | 头像上传 | **multipart 上线 + base64 入 SQLite**（v2 修订） | 前端 antd Upload 原生 multipart 不重写；base64 仅落存储层；oj 端 `http.files` 接收 |
| D8 | 权限验证 | seed `common/12345`（roles: ["common"]） | UI 差异由模块级 `requiredRoles`（B16）呈现；API 差异由 async-routes 按角色过滤呈现 |
| D9 | runtime 内部端点解耦（v2 新增，F1 处置） | **运行时 hook 注入机制**（仿 authProvider）：runtime 的 system role/menu、notifications、upload 等内部 api 支持模块注入实现；playground-oj 模块注入走契约 client 的模块段版本；runtime 默认实现保持根级路径不变 | 根仓主应用 + fake 零影响；playground-oj 端点收敛到 oj 模块段，契约机制全覆盖 |
| D10 | 模块归属（v2 新增，F8a 处置） | **10 个模块全部拷贝进 playground-oj 自包含**（含根仓 8 个） | 模块需加注入逻辑（D9），不能污染共享的根仓模块；drift 纪律：playground-oj 内模块不再回同步根仓 |
| D11 | 依赖形态（v2 新增，F7a 处置） | init 后把 devDependencies 改回 `workspace:*`/`catalog:`（照抄 playground） | init 钉死 npm 版本是面向外部用户的设计；仓内 dogfooding 必须验证本地代码 |
| D12 | 契约豁免清单（v2 新增） | web（user-info/get-async-routes）、oj 内置 auth 不进契约；`ram api --check` 需豁免能力（ram 缺口，按 §7 流程补） | 递归路由树超出 zod 白名单（无 lazy）；这些端点的消费者是 runtime 内部手写 api，不需要生成 client |

## 3. 总体架构

```
apps/playground-oj/                    # ram init 生成骨架（D5），模块全拷贝自包含（D10）
├── bin/oj                             # vendored oj 二进制（init 解包，sha256 校验）
├── api/
│   ├── config.yaml                    # server(端口 9779,/api) + db(sqlite://db.sqlite) + auth(jwt) + 证书
│   │                                  #   9779：避开 playground/其他 oj 工程的 9778 冲突（F11）
│   ├── config/{public.pem,cert.jws}   # init 现场签发（RS256 JWS，默认 3650 天）
│   ├── db.sqlite                      # SQLite 库（oj 缺文件自动建）
│   └── src/<module>/                  # oj 后端模块
│       ├── manifest.yaml              # name/version（web 需 deps: [system]，F5）
│       ├── contract.ts                # 契约单一事实源（豁免清单除外，D12）
│       ├── <endpoint>/api.ts          # handler（目录镜像 DSL，热载）
│       ├── migrations/0001__*.sql     # 迁移账本
│       └── seed.sql                   # 种子（INSERT OR IGNORE，启动重放；分号纪律：注释无英文分号）
├── modules/src/<module>/              # 前端模块 10 个全拷贝（D10）
├── modules.config.ts                  # 与 playground 同集合同顺序（entry 改指本工程内）
└── package.json                       # init 生成后按 D11 改依赖形态
```

运行拓扑（dev）：`ram dev` 一个端口（默认 5174，冲突自动顺延）——静态（shell dist + modules/dist）+ `/api/*` 反代到 oj（9779）+ 契约 watch + SSE 刷新。release（preview）：`ram preview` 先 `oj migrate`，再以 `api/dist` 起 oj，ram 静态层托管 `modules/dist`。

## 4. 后端模块与端点映射（fake/ → oj 真实 API，URL 全部收敛到模块段，D9）

| oj 模块 | 端点（`/api/{module}/` 下） | 对应 fake | 消费方（v2：注入机制） | 数据来源 |
|---|---|---|---|---|
| `web` | `GET user-info` | user.fake.ts | runtime 默认登录链（已适配，无注入） | users 表（按 `http.user.id`） |
| `web` | `GET get-async-routes` | async-routes.fake.ts | runtime 默认（已适配） | menus + role_menu 按当前用户角色过滤生成路由树（D6，API 级演示） |
| `web` | `GET country-calling-codes` | auth.fake.ts | 无消费方（标注：fake 覆盖面演示端点，F9） | 静态常量（对齐 fake/constants.ts） |
| `home` | `GET pie`（query: by 可选） | home.fake.ts | home 模块页面 → 契约 client | home_stats 按 category 聚合（5 分类种子） |
| `home` | `POST line`（body: range week/month/year） | home.fake.ts | home 模块页面 → 契约 client | home_stats 窗口聚合 + **懒补数**（窗口内缺哪天补哪天，幂等，防种子随时间腐烂，F6） |
| `system` | `GET role-list`（name/status/code 过滤 + 分页，query 传参） | system.fake.ts | system 模块注入 runtime（D9） | roles 表 |
| `system` | `POST/PUT/DEL role-item` | system.fake.ts | 同上 | roles 表 CRUD |
| `system` | `GET role-menu`（**扁平列表**，前端 handleTree 转树） | system.fake.ts | 同上 | menus 表 |
| `system` | `GET menu-by-role-id?id=` | system.fake.ts | 同上 | role_menu 表 |
| `system` | `GET menu-list`（分页） | system.fake.ts | 同上 | menus 表 |
| `system` | `POST/PUT/DEL menu-item` | system.fake.ts | 同上 | menus 表 CRUD |
| `notification` | `GET notifications` | notification.fake.ts | notification 注入 runtime（D9；widget 在 runtime layout） | notifications 种子表 |
| `personal-center` | `POST upload`（multipart，头像 base64 入库，返回 data URL） | personal-center.fake.ts | FormAvatarItem 经 D9 注入 URL + 真 token | users.avatar_base64 |
| `demo` | `GET todos`（query: keyword） | 原契约 mock 兜底 | demo 模块页面 → 契约 client（已是试点形态） | todos 表 |

内置 auth（oj 提供，非业务模块，契约豁免 D12）：`POST /auth/login`、`POST /auth/logout`、`POST /auth/refresh`。

**login 前端模块退化为纯页面模块**（F3）：删除 authProvider 注册（scoped client 无法横跨 `/auth` 与 `/web`），用 runtime 默认登录链。记录：authProvider 注入机制在 playground-oj 失去验证载体（它是 runtime 特性，非 ram 功能；D9 的注入机制同族，验证载体转移至 system/notification/upload）。

## 5. 数据模型（SQLite）

各 oj 模块自管 migrations + seed.sql（**不动 init 通用模板**，F6）：

- **web**：`users(id, username, password_hash, roles, avatar_base64, email, phone, description)`
  - seed：admin/12345 + common/12345。bcrypt hash 一次性外部生成（`pnpm dlx bcryptjs` 脚本，配方注释进 seed.sql 头），两用户同密码复用同一 hash；不动模板自带的 admin/123456 行（改为覆盖或清库重建，实施时定）
- **system**（数据层提前到 P2，F5）：`roles(id, name, code, status, remark, create_time, update_time)`、`menus(id, parent_id, menu_type, name, path, component, order, icon, keep_alive, hide_in_menu, status, roles, permissions, current_active_menu, iframe_link, external_link, ignore_access, create_time, update_time)`（列清单以 fake menu-list 响应为事实源，F8b）、`role_menu(role_id, menu_id)`
  - seed 规模对齐 fake（约 8 行角色/菜单量级，**显式指定 id**——fake 菜单 id 100+ 被 role_menu/menu-by-role-id 引用，sqlite 自增从 1 开始不可依赖）
- **demo**：`todos(id, title, done)`
- **notification**：`notifications(id, avatar, title, message, date, is_read)`
- **home**：`home_stats(id, category, stat_date, value)`（pie 按 category；line 懒补数，种子只灌 pie 五分类）

**字段映射口径**（F12）：线协议 camelCase（parentId/menuType/isRead/createTime/phoneNumber）↔ 列 snake_case，逐 handler 映射；`parentId` 根标记（fake 混用 `""` 与 number）在契约中钉死为一种（归一 `0`）；`user-info.id` 线格式 string（handler `String()`，模板先例）。

**跨模块访问**：get-async-routes（web）查 menus/role_menu（system 所有）→ web `manifest.yaml` 声明 `deps: [system]`；`ownership_guard` 维持默认 warn；`oj build --check` 的 S 门禁行为列入 P0 spike 确认。

## 6. 契约层

- 进契约的模块：system / home / notification / demo / personal-center（`api/src/<module>/contract.ts`，apiPrefix=目录名，AC-D9）
- **豁免清单（D12）**：web（user-info/get-async-routes——递归路由树超出 zod 白名单、消费者是 runtime 手写 api）、oj 内置 auth
- `ram api` 产物：client.ts + client.schemas.ts（发射到 `modules/src/<module>/api/`）、routes.json、openapi.yaml、handler stub（sha256 指纹幂等）
- notification 无同名前端模块 → client 发射目标为孤儿目录，**ram 缺口候选**：豁免或改发射目标，实施时按 §7 流程定夺
- **ram 缺口（D12）**：`ram api --check` 需支持豁免清单（否则 web/auth 的 handler 被判"未登记 error"）——P2 前补齐
- home/notification/personal-center 前端模块改为消费生成的 client；system 经 D9 注入（注入实现内部用生成的 client）

## 7. ram 功能验证清单（验收标准）

| 命令 | 验证点 |
|---|---|
| `ram init` | 骨架生成、bin 解包 sha256、证书签发、模板 web 模块、幂等重跑 |
| `ram dev` | oj 编排（spawn/健康轮询/透传/回收）、`/api/*` 反代、契约 watch→重生成→模块重建→SSE 刷新、oj handler 热载 |
| `ram api` | 六产物生成、stub 幂等、豁免清单生效 |
| `ram api --check` | 三重对账全绿（含新增的豁免能力，D12） |
| `ram api --docs` | 聚合 openapi + 自包含 redoc 单页 |
| `ram build` | 模块构建 + 全站合并 + `oj build` 编排；**`oj build --check`（S 门禁）行为确认**；**contract.ts 进 dist 成死代码无害确认**（契约设计 §10 试点验收项） |
| `ram preview` | fail-fast 四查、`oj migrate`、release 模式、静态托管 + 反代 |
| `ram info` | oj 观测段 |
| runtime 注入（D9） | playground-oj 注入生效（端点走模块段）；**根仓主应用默认路径回归不破**（fake 根级路径不动） |

业务验收：admin/12345 登录 → user-info → system 角色/菜单 CRUD 落库（重启 oj 后数据仍在）→ demo todos 真实读写 → common/12345 登录看到受限菜单（B16）→ **async-routes 接口按角色返回不同树（API 级 smoke 断言，F2 处置）** → 头像上传 multipart 落库回显。

**行为变化记录**：全栈下 `/api/demo/todos` 受 Bearer 守卫，demo 页需登录（playground 现状免登录）。

**ram 缺口处理**：发现缺失/缺陷即补充 ram 功能，记录到 §10。已预知缺口：`--check` 豁免（D12）、notification client 发射目标（§6）。

## 8. 错误处理与测试

- handler 统一 `json.ok/json.fail` 信封；未登录/越权由 oj Bearer 守卫兜 401
- SQL 红线：值一律绑定参数（`db.query(sql, [params])`），禁止字符串拼接（oj 手册 §13）
- `ram api --check` 纳入 typecheck 流水线作为门禁
- 冒烟脚本 `apps/playground-oj/scripts/smoke.sh`：login → user-info → async-routes（admin/common 双账号断言差异）→ 一条 system CRUD 往返，dev 与 preview 两态各跑一遍
- 过程发现的问题追加到 §10 并分类（反常规/反常识/与业界不符等）

## 9. 实施顺序（phase 划分，v2 修订 F5 依赖）

- **P0 骨架与 spike**：`ram init apps/playground-oj`；D11 依赖改写；config.yaml 端口改 9779；seed admin/12345；模板 web 模块登录冒烟。**spike 确认**：schema.yaml/tables 强制程度、`oj build --check` S 门禁行为、contract.ts 进 dist 无害
- **P1 前端迁移 + 注入机制**：10 模块全拷贝（D10）+ modules.config 改指本工程；编写全部契约（豁免清单除外）+ `ram api` 生成 stub，dev 全站可跑（stub 兜底）；**runtime 实现 api 注入机制（D9，TDD）**；补 `ram api --check` 豁免能力（D12 缺口）
- **P2 认证与数据层**：login 模块退化纯页面（F3）；web 真实化（user-info/get-async-routes/country-calling-codes）；**system 数据层**（roles/menus/role_menu migrations + seed，F5）；common 用户；API 级权限差异冒烟
- **P3 system + demo 真实化**：system 全套 CRUD handler + 前端注入接入（D9）；demo todos 真实化
- **P4 home/notification/personal-center**：home pie/line（懒补数）、notification（注入 + ram 缺口定夺）、upload（multipart → base64 入库，FormAvatarItem 注入改造）
- **P5 release 回归**：`ram build` + `ram preview` 全量回归 + `ram api --docs` 产物 + smoke 两态通过 + 根仓主应用回归（D9 默认路径）
- **P6 文档收尾**：计划勾选、阶段小结、问题分类、全文总结

## 10. 过程问题记录（实施中追加）

- **F2 已知限制（2026-09-04 评审）**：menus→async-routes 的输出在 UI 被模块路由遮蔽（`filterBackendRoutes` 丢弃碰撞顶级路径 + 后端路由组件只 glob runtime pages + 角色过滤实为 B16 模块级 requiredRoles）。本期降级为 API 级演示；UI 可观测化（runtime 支持后端路由解析模块组件）下次演进。
- **authProvider 失去验证载体（2026-09-04 评审）**：playground-oj 用 oj 内置 auth，login 模块退化纯页面；authProvider 为 runtime 特性非 ram 功能，同族注入机制的验证载体转移至 D9（system/notification/upload）。
- **fake 既有失真不跟进（2026-09-04 评审）**：fake role-list 读 GET body 过滤（永远 undefined）——真实实现按 query 过滤，属 fake 失真，不对齐。
- **oj-process 测试 flaky 根因（2026-09-04 vendor 收尾时发现）**：抓到真实失败签名——`健康检查超时（3s）`，桩 stderr 为空且未退出，即**子进程活着但 3s 内未完成 node 启动+listen**（83 文件并行时机器负载高，node 冷启动可超 3s；测试注入的 timeoutMs 3000 假设「裸机时序」）。修复：健康路径两例 timeoutMs 3000→10000（对齐生产默认）。期间曾收窄三文件随机端口区间（oj-process/dev-fullstack/preview 原为 20000/21000/23000+0–20000 互相重叠，确定性复现证明碰撞可致「ready 误 resolve 串台」）——区间收窄保留为卫生措施，但非本次失败的根因。教训：**计时假设要在目标并发度下校准；抓到错误原文再下结论**。
