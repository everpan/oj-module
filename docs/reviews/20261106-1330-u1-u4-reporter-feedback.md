# U1–U4 需求处理反馈

- 日期：2026-11-06
- 修复版本：**0.2.69**（`@oj-module/cli` / `@oj-module/runtime` lockstep，已并入 `feat/ojm`）
- 对应排期：`docs/plans/20261106-1301-template-runtime-fixes-schedule.md`

## U1 [P0] 模板契约三重漂移 —— 已修复

- 根因确认：模板自身 `handler .schema`（新）与 `openapi.json` / `__client` 生成物（旧）漂移，`ojm build` 门禁与 `ojm api --check` 各执一端构成死锁，证据全部复现。
- 处理：重生成 `templates/openapi.json` 与两个 `__client/api.schemas.ts`——语义差异恰为 5 个叶子（market install 的 `force` 一处 + users 两字段，U3 同批避免二次漂移）。
- 防再漂移：新增模板契约门禁 `tests/templates/contract-drift-guard.test.ts` = `ojm api --check`（openapi ↔ client，CI 恒跑）+ `oj openapi --check`（handler ↔ openapi，需 vendored oj）。已做反向验证：注入假字段门禁如期报红。
- **注意**：仓库 CI 未 provision oj 二进制，第二道检查在无 `bin/oj` 的环境 skip；发布机本地 `ojm vendor` 后生效。
- 手册更新：`oj openapi --check` 缺省比对 `<module-root>/openapi.json`，比对工程根文件须显式 `-o openapi.json`（帮助文案有误导性，已记录）；MSYS2/Git Bash 仍需 `MSYS2_ARG_CONV_EXCL='*'`。

## U2 [P1] global.d.ts 流式类型落后 —— 已修复

- 对齐结果：`stream`/`sse` opts 增加 `fileName?: string`、`disposition?: "attachment" | "inline"`；`StreamWriter.write` 放宽为 `string | Uint8Array`。
- 依据：本机 oj devkit（0.1.123）+ `api-manual` 复核——`fileName` 自 **v0.1.65** 起由运行时写入 `Content-Disposition: <disposition>; filename*=UTF-8''<pct-encoded>`；`write` 按入参类型分发，Uint8Array/ArrayBuffer/TypedArray/DataView 走字节通道（二进制无损）。你反馈的 v0.1.124 声明与此一致。
- 回归：`types/stream-probes/stream-handlers.ts` 探针覆盖文本流 + 二进制流 + inline/SSE 四形态，`pnpm typecheck:api` 零报错；CI 由 `tests/templates/stream-types.test.ts` 显式拉起 tsc 兜底（已反向验证：改回旧签名如期报红）。
- **三方言 `filename*` 断言未自动化**：这是 oj 运行时行为（v0.1.65 起，非本仓代码），且 CI 无 mysql/pg 基建；如你需要，可在有方言环境的机器上直接验证，预期行为已载于 oj api-manual。

## U3 [P1] users 表两列透出 —— 已修复

- `GET /api/system/users` 现返回 `employee_no: string | null`、`phone_number: string | null`；未设置即 `null`。生成 client 的 `SystemUsersGetData` 含同名**可选**字段（properties 声明、不进 required——与你验收标准一致）。
- 用例：`templates/tests/rbac-users.spec.ts` 新增（已设置返回原值 / 未设置返回 null）。

## U4 [P2] 角色就绪后模块路由重建 —— 已修复（无需新钩子）

- 结论：**当前分支已修复，无需 `onUserReady`/`rebuildAccessRoutes` 出口**。0.2.68 dist 确实没有重建能力（你的排查正确）；修复形态是 `auth-guard` 的 `fetchUserInfoAndRoutes()` 保证 **userInfo 决议（角色已写入 store）先于 `getModuleRoutes()` 二次合并**，挂载时的解耦注册（空角色）随即被整体替换。
- 你下游的 `rebuildAccessRoutesWhenReady` 死代码可以删除；框架没有、也不需要稳定挂载点。
- 回归：`tests/runtime/roles-ready-remerge.test.ts` 钉住守卫源码时序 + 两阶段注册行为 + 10 次重建幂等（无重复菜单项）。浏览器级「10 次硬刷新」e2e 未做，以 store 层幂等断言近似覆盖，如复现闪烁请带浏览器 trace 再提。

## 下游行动清单

1. 等 0.2.69 发布后 `ojm init --yes` 重建工程（或按发布说明升级模板）；
2. 删除 U4 下游补丁死代码；删除 U2 的类型断言绕过；
3. 四连跑验收照旧（Windows 下带 `MSYS2_ARG_CONV_EXCL='*'`），预期全部退出码 0。

## 我们侧遗留

- 未给 ci.yml 加 `ojm vendor` 步骤（U1 第二道门禁在 CI  skip）；
- 未做全新 init 工程的隔离四连跑端到端（以模板仓内双 check 等价覆盖），首次真实发布后计划用 verdaccio 模拟发布验一轮。
