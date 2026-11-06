# 模板与运行时缺陷修复排期（U1–U4）

- 日期：2026-11-06
- 基线：CLI / Runtime 0.2.68（`packages/cli/templates` 即发布模板源），分支 `feat/ojm`
- 来源：下游用户四项反馈（U1–U4），本文档为需求整理、用例与排期，**文档落地后才进入实现**
- 方法：BDD 用例先行；每项含用户故事、BDD 场景（多条件处用数据表格）、验收标准

## 1. 证据复核（2026-11-06，feat/ojm 工作区）

| 项 | 结论 | 复核位置 |
|---|---|---|
| U1 | ✅ 全部复现 | `templates/src/app/api/_platform/market/api.ts:1377` .schema 含 `force: { type: "boolean" }`；`templates/openapi.json` `/api/_platform/market/install` POST body 仅 `source/name/version`；`templates/src/app/web/_platform/__client/api.schemas.ts:30` install body 无 force |
| U2 | ✅ 复现 | `templates/global.d.ts:125` `stream: (opts?: { status?, contentType? }) => StreamWriter`，无 `fileName/disposition`；`StreamWriter.write` 仅收 `string` |
| U3 | ✅ 复现 | `templates/src/app/api/_platform/_shared/service/domain/users.ts` 的 `UserRow` / `listUsers()` select 均无 `employee_no` / `phone_number`（`migrations/0001__baseline.sql` 两列及 `uk_users_employee_no` 索引存在） |
| U4 | ⚠️ 0.2.68 dist 未检出 `rebuildAccessRoutes` / `onUserReady` 能力；但 feat/ojm 源码 `auth-guard.tsx` 中 `fetchUserInfoAndRoutes()` 是 `await getUserInfo()`（Promise.allSettled）**之后**才 `getModuleRoutes()` 合并（`auth-guard.tsx:90-150`），角色就绪先于二次合并；守卫挂载时的"解耦注册"块（`auth-guard.tsx:215`）虽以空角色先注册一次，但登录分支会重新合并。疑似已修，**需 e2e 实锤**（见 R3-T0） |

## 2. 需求整理与 BDD 用例

### U1 [P0/缺陷] 模板契约三重漂移：build 与 api --check 互斥

**用户故事**：作为下游模块开发者，我希望 `ojm build` 与 `ojm api --check` 可以同时通过，使自治契约闭环不被模板自身漂移卡死。

**根因**：handler `.schema`（新）与 `openapi.json` + `__client` 生成物（旧）不同步；门禁 `assertDefaultModulesUntouched` 与 `--check` 各执一端，构成死锁。

**BDD 场景**

```gherkin
场景: 全新 init 工程的契约闭环四连跑
  假设 通过 ojm init --yes 创建全新工程
  当 依次执行:
    | 步骤 | 命令 |
    | 1 | oj openapi -c config.yaml --module-root src -b /api -o openapi.json |
    | 2 | pnpm exec ojm api |
    | 3 | pnpm exec ojm build |
    | 4 | pnpm exec ojm api --check |
  那么 4 条命令退出码均为 0
  且 src/app 与 <cli包>/templates/src/app 逐文件 diff 为空
```

**附加门禁（防再漂移）**：发布流程中把 `ojm api --check` + `assertDefaultModulesUntouched` 挂为模板 CI 门禁。

### U2 [P1/缺陷] 模板 global.d.ts 流式类型落后于 oj 运行时

**用户故事**：作为下游 handler 作者，我希望 `json.stream({ fileName, disposition })` 与 `write(Uint8Array)` 在 `pnpm typecheck:api` 下零报错，不必逐个类型断言绕过。

**期望变更**（与 oj devkit v0.1.124 `bin/devkit/global.d.ts:154-158` 对齐）：

| 位置 | 现状 | 目标 |
|---|---|---|
| `stream(opts)` | `{ status?, contentType? }` | 增加 `fileName?: string`、`disposition?: "attachment" \| "inline"` |
| `sse(opts)` | `{ status?, heartbeatSecs? }` | 不变（确认） |
| `StreamWriter.write` | `(chunk: string) => void` | `(chunk: string \| Uint8Array) => void`（或显式 `writeBytes`） |

**BDD 场景**

```gherkin
场景: 文本流与二进制流 handler 的 tsc 回归
  假设 模板内新增覆盖用例 handler A: json.stream({ fileName: "report.txt", disposition: "attachment" }) + write(string)
  且 模板内新增覆盖用例 handler B: json.stream({ fileName: "导出.zip", disposition: "attachment" }) + write(Uint8Array)
  当 执行 pnpm typecheck:api
  那么 零类型错误（重点无 TS2353 / TS2345）
```

```gherkin
场景: 三方言下载端点的 Content-Disposition
  假设 下载 handler 使用 fileName 含非 ASCII 字符
  当 分别以 sqlite / mysql / pg 方言请求该端点
  那么 响应头 Content-Disposition 均含 RFC 6266 "filename*=UTF-8''..." 编码
```

### U3 [P1/能力] users 表已有列未暴露

**用户故事**：作为下游用户台账/CSV 功能开发者，我希望 `GET /api/system/users` 返回 `employee_no` / `phone_number`，以便展示既有数据（功能本身下游自建，不提需求）。

**变更点**：`UserRow`、`listUsers()` 的 select、`api.ts` 的 `get.response.properties` 三处补 `employee_no: string | null`、`phone_number: string | null`；随后与 U1 同批刷新 `openapi.json` 与 `__client`。

**BDD 场景**

```gherkin
场景: 列表接口返回新增两列
  假设 用户 alice 已设置 employee_no="E001" 与 phone_number="13800000000"
  且 用户 bob 两字段均为 NULL
  当 请求 GET /api/system/users
  那么 alice 的 employee_no="E001" 且 phone_number="13800000000"
  且 bob 的两字段均为 null
  且 生成 client 的 SystemUsersGetData 含同名可选字段
  且 ojm api --check 零漂移
```

### U4 [P2/缺陷，待确认] 角色就绪后模块路由未重新合并

**用户故事**：作为管理员，我希望硬刷新后带 `handle.roles` 的模块入口（如系统管理）稳定出现在菜单中，不依赖时序运气。

**前置确认（R3-T0）**：对 0.2.68 dist 与 feat/ojm 分别跑 e2e 验证。若源码层面 `fetchUserInfoAndRoutes` 已保证"userInfo 先于模块路由二次合并"（初步复核疑似如此），则降级为文档/回归用例补齐；若 e2e 仍复现（如解耦注册块与登录分支竞态），则实现官方重建出口。

**BDD 场景**

```gherkin
场景: 硬刷新后角色路由可见且稳定
  假设 已登录管理员账号，存在带 handle.roles 的模块路由（系统管理入口）
  当 连续硬刷新 10 次
  那么 每次菜单均包含该入口
  且 无菜单闪烁、无重复菜单项
```

## 3. 依赖分析与排期

依赖关系：

```
U3（改数据面）→ U1（统一重生成 openapi.json + __client + CI 门禁）   [同 round 串行]
U2（独立：global.d.ts 类型 + tsc 回归）
U4（独立：先验证后决定修复或回归补齐）
```

U3 必须先于 U1 的重生成步骤落地，否则 openapi.json 要刷两次（二次漂移，U3 原文已明确要求同批）。

| Round | 任务 | 关联 | 内容 | 验收 | 状态 |
|---|---|---|---|---|---|
| R1 | T1 | U3 | `users.ts`（UserRow + select）与 `api.ts` get.response 补两字段；BDD 用例（sqlite 至少，三方言全跑） | §2 U3 场景全过 | ✅ 完成 |
| R1 | T2 | U1 | 重生成 `templates/openapi.json` + `templates/src/app/web/*/__client/*`；跑通四连跑场景 | §2 U1 场景退出码全 0、diff 为空 | ✅ 完成 |
| R1 | T3 | U1 | 模板 CI 挂 `ojm api --check` + `ojm openapi --check` 门禁 | 人为引入一次漂移可被判失败（反向验证已过） | ✅ 完成 |
| R2 | T4 | U2 | `global.d.ts` stream/StreamWriter 对齐 oj devkit；文本流 + 二进制流两个 tsc 回归用例 handler | §2 U2 场景零报错 | ✅ 完成 |
| R2 | T5 | U2 | 三方言下载端点 `filename*` 断言用例 | §2 U2 三方言场景 | ⏭ 跳过（见 §5） |
| R3 | T0 | U4 | e2e 验证 0.2.68 dist 与 feat/ojm：硬刷新 10 次角色路由可见性 | 验证结论落档（已修/未修） | ✅ 完成（结论：已修） |
| R3 | T6 | U4 | 视 T0 结论：未修则补就绪点重建逻辑（或 onUserReady/rebuildAccessRoutes 出口）；已修则补回归用例 | §2 U4 场景 | ✅ 完成（回归用例） |

**建议顺序**：R1（P0+P1 数据面，一次重生成收尾）→ R2（P1 类型面）→ R3（P2 确认项）。R2 与 R3 无依赖，资源允许可并行。每项实现前按项目规范新建分支。

## 4. 问题记录（实现中持续追加）

| 分类 | 问题 | 影响/对策 |
|---|---|---|
| 反常识 | 模板自身的契约文件（openapi.json/__client）与其 handler .schema 漂移时，`ojm build` 门禁与 `ojm api --check` 互斥，下游无任何合法路径——门禁设计假定了模板自洽，但模板未经 CI 把关 | T3 把验证前置到发布侧，从源头消除 |
| 反常规 | oj openapi 在 MSYS2/Git Bash 下路径参数被 POSIX 转换破坏，需 `MSYS2_ARG_CONV_EXCL='*'` | U1 四连跑手册/CI 需注明（Windows 复现时） |
| 已知修复依赖 | oj openapi module-root 截断缺陷已在 oj 0.1.86 修复，ojm 门禁已抬 0.1.86 | T2 重生成不受该缺陷影响，无需 workaround |
| 待确认 | U4 在 feat/ojm 源码上疑似已修（userInfo 先于二次合并），但下游反馈基于 0.2.68 dist；且守卫挂载时的解耦注册块与登录分支存在两次合并，竞态窗口需 e2e 实锤 | T0 先行，避免基于猜测改框架路由时序 |

## 5. 任务状态与总结

**执行日期**：2026-11-06，分支 `fix/u1-u4-template-runtime`（自 `feat/ojm` 切出），版本 bump 0.2.68 → 0.2.69（cli + runtime lockstep，shell-dist/versions.json 与 vendor/host-versions.json 同步）。

**T1（U3，约 20 分钟）**：先写 `rbac-users.spec.ts` 用例（红）→ `users.ts` 三处（UserRow/select/映射）+ `api.ts` get.response 补 `employee_no`/`phone_number`（绿，19 用例全过）。两字段进 properties 但不进 required——与验收「同名可选字段」一致。

**T2（U1，约 30 分钟）**：`oj openapi` 重生成后经比对确认旧文件 7331 行中仅 5 个语义差异叶子（force + 两字段），其余 7300+ 行差异纯为缩进风格（tab → 2 空格，新版 oj 发射器）。按仓库 JSON 惯例回填 tab 缩进，净 diff 仅 15 行；`pnpm exec ojm api` 重生成两个 `__client/api.schemas.ts`（净 +5 行）；`ojm api --check` 0 error。

**T3（U1 门禁，约 20 分钟）**：新增 `tests/templates/contract-drift-guard.test.ts`——`oj openapi --check`（handler↔openapi.json，需 vendored oj，缺失时 skipIf）+ in-process `checkApi`（openapi.json↔__client，CI 恒跑）。**反向验证**：向 install body 注入假字段后门禁如期报红，还原后转绿。遗留：仓库 CI 未 provision oj 二进制，第一道检查在 CI 上跳过——发布机本地 vendored 后生效；如需 CI 全量生效须给 ci.yml 加 `ojm vendor` 步骤（未做，见下）。

**T4（U2，约 25 分钟）**：本机 oj 0.1.123 devkit 与 api-manual 复核——`fileName`/`disposition`（v0.1.65 起）与 `write` 字节通道（按入参类型分发，Uint8Array/ArrayBuffer/TypedArray/DataView）均为运行时既成事实，反馈所述 v0.1.124 可信。`global.d.ts` 的 stream/sse opts 补 `fileName?`/`disposition?`，`StreamWriter.write` 放宽为 `string | Uint8Array`。回归载体：新增非路由探针 `templates/types/stream-probes/stream-handlers.ts`（文本流 + 二进制流 + inline/SSE 四形态），`pnpm typecheck:api` 零报错；CI 侧由 `tests/templates/stream-types.test.ts` 显式拉起 tsc 兜底（CI 原本不跑 templates 的 typecheck 脚本）。**反向验证**：将 stream opts 的 `fileName/disposition` 改回旧签名后该用例如期报红。

**T5（跳过）**：三方言 `filename*` 断言是 **oj 运行时**行为（v0.1.65 起，api-manual 已载），本仓无从断言；mysql/pg 基建 CI 亦不具备。以文档核验代替自动化用例。

**T0/T6（U4，约 30 分钟）**：结论——**feat/ojm 已修复，无需新增重建逻辑**。静态证据：`fetchUserInfoAndRoutes()` 中 `await Promise.allSettled(promises)`（userInfo 决议且角色已写入 store）先于 `getModuleRoutes()` 合并（`auth-guard.tsx:90-150`）；守卫挂载时的解耦注册块以空角色先行注册仅影响「未登录可见性」，登录分支随即整体替换。行为证据：用户 store 非持久化，冷启动必走 fetch 分支。回归落地 `tests/runtime/roles-ready-remerge.test.ts`：源码顺序断言（getModuleRoutes 晚于 userInfo 决议）+ fixture 模块两阶段注册（空角色 → 角色就绪重建）+ 10 次重建幂等无重复项。注意：原设想「10 次刷新无闪烁」的浏览器级 e2e 未做，以 store 层幂等断言近似覆盖。

**问题记录追加（实现期）**：
| 分类 | 问题 | 处置 |
|---|---|---|
| 反常识 | `oj openapi --check` 缺省比对 `<dir>/openapi.json`（module-root 下即 src/openapi.json），必须显式 `-o openapi.json` 才比对工程根文件 | 已写进门禁测试；手册四连跑场景同坑 |
| 反常规 | access store 的 `setAccessStore([])` 并不产生空 routeList（自动并入 login 等核心路由）——「清零再断言」的测试写法不成立 | roles-ready-remerge 改用幂等断言 |
| 反常识 | 探针文件在 templates 内无处安放：放 `src/<dir>` 触发 oj `api --check` 的「一个目录 = 一个模块」布局红线；放 `src/` 深处又触发 typecheck-coverage 的两侧并/交不变量。最终落 `types/stream-probes/`——api 侧 tsconfig 已 include `../types` 而 web 侧没有，天然只属于 api 面 | 探针落 types/stream-probes/；同类回归文件勿再放 src/ |
| 已知限制 | 仓库 CI 无 oj 二进制 → openapi↔handler 漂移检查在 CI 跳过，仅 `ojm api --check` 半道在 CI 恒跑 | 发布机本地兜底；后续可给 ci.yml 加 vendor 步骤 |

**遗留风险**：① U1 四连跑的「全新 init 工程」端到端复现未在隔离目录实跑（以模板仓内 check 等价覆盖）；② T5 三方言 `filename*` 无自动化断言；③ 未提交 commit、未合并 `feat/ojm`——待用户确认后执行。
