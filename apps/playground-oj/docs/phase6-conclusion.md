# Phase 6 — 收尾：计划勾选 · 阶段小结 · 问题分类

> 本阶段不写新功能，只做三件事：① 勾选计划（对照 `docs/prd/202609041045-playground-oj-plan.md`）；
> ② 汇总 P0–P5 各阶段小结；③ 把全程踩到的坑按「反常规 / 反常识 / 与业界不符」三类归并（即设计文档的 §10 问题分类），
> 便于本项目作为教学材料复用。
>
> 计划出处：`docs/prd/202609041045-playground-oj-plan.md`。逐阶段教学文档：`docs/phase0-scaffold.md` … `docs/phase5-release-and-integration.md`。

## 1. 计划勾选表

| 阶段 | 计划目标 | 状态 | 交付 / 提交 |
|---|---|---|---|
| P0 | 骨架 + oj 登录冒烟 + `ram dev` 反代 | ✅ | `4a38611` |
| P1 | D9 注入机制 + 契约层 + 10 模块自包含 | ✅ | 收敛到 `e0c1047` 等 |
| P2 | 认证与 system 数据层 + 双账号权限差异 | ✅ | `27af5cb` |
| P3 | system CRUD + demo 真实化（D9 接管） | ✅ | `bd5e264` |
| P4 | home/notification/upload 真实化 | ✅ | `294d3a2`（amend 补入真实 upload 实现） |
| P5 | release 回归 + 集成冒烟（两态） | ✅ | `a1f380f` |

全部 6 阶段完成；每阶段均产出执行步骤 + 阶段小结教学文档（`docs/phaseN-*.md`）。

## 2. 各阶段一句话小结

- **P0 骨架**：`ram init` 生成工程，端口改 9779（避开 playground 的 9778），依赖回 `workspace:*`/`catalog:`，oj 登录链与 `ram dev` 反代联调全绿。
- **P1 注入与契约**：运行时 D9 三套注册表（systemApi / notificationsApi / uploadApi）+ `ram api` 契约生成与豁免 + 11 模块自包含，playground 可独立跑自己的 oj 后端。
- **P2 认证与数据层**：login 退化纯页面回落内置链；web 真实化（user-info / async-routes / 双账号 seed）；system 自管 roles/menus/role_menu；admin(4 节点) ≠ common(2 节点) 权限差异可断言。
- **P3 system CRUD + demo**：六项 system 端点经 D9 接管、CRUD 落库、角色绑菜单（按 CODE）、跨 `oj` 重启持久；demo `todos` 接真实数据层，页面因契约稳定零改动。
- **P4 业务真实化**：home 饼图/折线接真实统计（聚合 + 时间窗口补 0 + 全 0 合成回退）；notification 复用 D9；头像 multipart→base64 写 `users.avatar_base64`，三模块端到端闭环。
- **P5 release 回归**：`ram build` 抓出 S003 跨模块 `deps` 缺失、`pnpm typecheck` 抓出 `home/line` evolving-array 编译错误；`scripts/smoke.sh` 一键跑通 build→preview→dev 两态冒烟（均 10/10）。

## 3. §10 问题分类（反常规 / 反常识 / 与业界不符）

> 归类原则：**反常规**=框架/工具自身行为与其宣称设计相悖；**反常识**=对开发者反直觉（直觉会踩）；
> **与业界不符**=不同于主流 web 技术栈的约定。每条标注出处阶段。

### 3.1 反常规（框架自己打自己脸）

- **R1 框架契约自相矛盾**：`SystemApiProvider.fetchRoleMenu` 返回旧 3 字段投影，而 `fetchMenuList` 返回 18 字段 `MenuItemType`，两者本应一致却长期漂移，迫使 D9 注入点在边界用 `as unknown as` 局部吸收（P3）。
- **R2 改 runtime 源码≠生效**：runtime 以**构建产物 dist** 被消费，`src` 改了不重建 dist，app 仍看到旧类型（如缺 `permission` 的 `MenuItemType`）——"源码即真相"在打包库里不成立（P1/P3）。
- **R3 能跑 ≠ 能发**：同一段跨模块 SQL，`oj server`(dev) 的 `ownership_guard=warn` 只告警，`oj build`(release) 的 **S003 闸门直接硬错**。本地联调过关、CI 构建爆 gate（P5）。
- **R4 契约对账 ≠ 编译**：`ram api --check` 只校验生成物同步 / route 双向 / routes.js 漂移，**不编译 handler**；`pnpm typecheck` 才是 handler 的 tsc 关卡，两者必须各跑各的（P5）。

### 3.2 反常识（直觉会踩的坑）

- **C1 seed 建改语义分裂**：`seed.sql` 同时被说成"初始化数据"，但 `INSERT OR IGNORE` 只插不更新；改已 seed 行的字段必须**删库重 seed**或显式 `UPDATE`（P2）。
- **C2 迁移序号连续唯一（S007）**：一个模块的多张初始表不能拆成多个同号 `0001__*.sql`（会报 S007），必须合并为单文件或顺号——与"一表一迁移"直觉相悖（P2）。
- **C3 seed 按 `;` 朴素切分，注释也不放过**：oj 用 `;` 切分 seed 语句，**注释里写 `;` 也会被当成语句分隔符**报语法错，是其它 ORM/迁移工具没有的行为（P2）。
- **C4 `order` 是 SQL 保留字**：菜单顺序落库用 `sort` 列，`MenuItemType.order` 在 handler 映射 `sort`；SQL 里直接写 `order` 作列名即爆（P3）。
- **C5 `role_menu` 存角色 CODE 不是 id**：seed 写 `'admin'/'common'`，`get-async-routes` 按 `http.user.roles`（CODE 数组）JOIN，按角色 id 查菜单要先反查 code——比直觉"存 id"多一步（P3）。
- **C6 改名不是加列**：`menus.type`→`menu_type` 是迁移**建新列**，若 `get-async-routes` 的 `SELECT m.type` 不同步改 `m.menu_type`，查询因"无此列"被 `catch` 吞掉、路由树**静默变空**——最隐蔽的回归（P3）。
- **C7 时间窗口要"看不见地"补 0**：SQL `GROUP BY day` 只回有数据的天，缺天不出现；handler 必须显式对整窗补 `0`，否则前端按 index 渲染错位（P4）。
- **C8 种子数据随系统时间过期**：`home_line.day` 用绝对 epoch-day，固定值种子约 110 天后彻底落到窗口外，折线全空且触发合成回退——"测试种子"不是一次写好就一劳永逸（P4）。
- **C9 oj 跑在 V8 没有 Node `Buffer`/`require`**：上传转 base64 须浏览器式 `btoa` + 分块 `String.fromCharCode`，沿用 `Buffer.from(bytes).toString('base64')` 在 oj 直接抛 "Buffer is not defined"（P4）。
- **C10 后台进程生命周期在调用方手里**：长驻服务（`ram dev`/`preview` 起的 oj + 静态）必须"起—测—停"放进**同一条命令**，跨 Bash 调用会被回收，出现"上条起了服务、下条连不上"的诡异失败（P5）。
- **C11 TS evolving-array 被 `?? 0` 带偏**：`const out: number[] = []; out.push(map.get(d) ?? 0)` 里 `?? 0` 的 `0` 字面量让 TS 把 `out` 收窄成 `0[]`，后续 `out.push(number)` 报 `number 不可赋值给 0`；改用 `Array.from(..., cb)` 产出明确 `number[]` 绕开（P5）。

### 3.3 与业界不符（不像主流 web 栈）

- **I1 runtime 全局类型只随源码、dist 不发包**：消费方须手工补 `vite-env.d.ts`（`import.meta.env`、`Window.$message`、`ListData`/`OjEnvelope` 等），否则首跑 typecheck 满屏 `any`/未声明（P1）。
- **I2 契约白名单不含 `z.any()`**：文件上传走 multipart、不在 JSON 契约内，`upload.body: z.any()` 直接报错——须删掉 body schema，仅声明返回 `data: string`（P1）。
- **I3 `db.query` 返回 `Row = Record<string, Json>`**：所有列都是 `Json`，必须 `String()`/`Number()` 强制转换（如 `Number(r.id)`、`Number(r.v)===1`），裸用即类型/逻辑错（P3）。
- **I4 JWT roles 是字符串数组（CODE）**：权限树按 `roles`（CODE）`JOIN role_menu.role`，而非用角色 id 做外键——与"外键用 id"的业界惯例不同（P2/P3）。
- **I5 D9 provider 的 `headers` 是函数不是对象**：上传组件每次发请求时调用 `headers()` 实时取 token，`console.warn` 去重；provider 把动态上下文封装进 registry，消费点无需关心鉴权（P4）。
- **I6 oj 运行态端口被 config 钉死**：dev 与 preview 的 oj 都绑 `config.server.port`（9779），不能并行；而前端端口随命令变（5174/4173）——后端端口"不变"与前端端口"变"形成反差（P5）。
- **I7 打包库纪律：改 src 必须重建并提交 dist**：`packages/runtime` 被 app 经 `dist/` 消费，改 `src` 后须 `pnpm build` 重建 dist 并**提交**，否则 dev 报"方法不存在"（memory 纪律，P3 验证）。

## 4. 最终总结

playground-oj 从 `ram init` 骨架出发，分六阶段走完了"模块自包含 → 认证与数据层 → system CRUD 接管 → 业务模块真实化 → release 回归 → 集成冒烟"的完整链路：

- **能力闭环**：runtime D9 注册表（systemApi / notificationsApi / uploadApi）让模块接管原 root 级内部端点；uni-dev 契约机制生成前端 client 与 oj handler stub；消费点经 `get*Provider() ?? 内置` 委托，未注册自动回落。
- **数据闭环**：system（roles/menus/role_menu）、home（home_pie/home_line）、notification、demo（todos）、personal-center（avatar_base64）全部真实落 oj 后端，跨 `oj` 重启持久。
- **质量闭环**：`ram api --check` 0/0、两态（dev + preview）集成冒烟 10/10、`pnpm typecheck` 绿、`ram build`/`ram preview`/`ram api --docs` 全绿；`scripts/smoke.sh` 可一键复跑回归。
- **教学价值**：31 条问题（反常规 4 / 反常识 11 / 与业界不符 7）覆盖了 uni-dev + oj + runtime 三套机制最易踩的非显性约定，逐阶段文档 + 本分类可直接作为新人 onboarding 材料。

提交链：`4a38611`(P0) → `e0c1047`(P1) → `27af5cb`(P2) → `bd5e264`(P3) → `294d3a2`(P4) → `a1f380f`(P5)，分支 `feat/playground-oj`。
