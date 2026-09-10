# playground-oj 实施计划（v3 修订 + 阶段任务）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 执行本计划，逐任务推进。
> 配套设计：`docs/prd/202609040105-playground-oj-design.md`（v2）已按本计划 §0 修订为 v3（因 v2 文件字节损坏，修订内容以本计划为准，等同 v3）。

**Goal:** 在 `apps/playground-oj` 落地一个前后端全栈验证工程（oj 后端 + SQLite + 契约机制 + runtime 注入），完整验证 ram 工具链，并补齐两个 ram 缺口（D9 注入机制、D12 `--check` 豁免）。

**Architecture:** `ram init` 骨架 → 10 个前端模块全拷贝自包含 + 1 个最小 notification 注入壳 → oj 后端按模块段收敛端点（`/api/{module}/{path}`）→ runtime 经「仿 authProvider 的注册表」委托内部 api 到模块注入实现（默认根级回落，根仓/fake 零影响）→ 契约机制 `ram api` 生成 client + `ram api --check` 豁免 web/auth。

**Tech Stack:** React 19 + antd 6（runtime/shell）、oj（Rust+V8，TS handler）、SQLite、zod 契约（`@react-antd-module/contract`）、pnpm workspace、TDD（vitest + oj L1/L2）。

---

## §0. v3 关键修订（结合 oj 手册 + 代码走查，2026-09-04）

1. **oj base = `/api`**（init 模板覆盖默认 `/v1/api`）；端点维持 `/api/{module}/{path}`。
2. **DELETE handler 方法名 = `del`**（非 `delete`，否则 405，api-manual §4）。
3. **D9 注入机制** = 仿 `authProvider` 的注册表族（`api-provider.ts`），覆盖 system-role/system-menu/notifications/upload 四处内部 api；消费点委托 + 默认根级回落。契约 `module` target（`bindRequest(ctx.utils.request)`）用于注入实现。
4. **notification 孤儿发射** = 新增最小 `notification` 模块（无页面）承载注册 + 持有契约，模块集变 11 个 entry。
5. **ram `--check` 豁免** = 新增 `api/.ram-api-exempt.json`（`{modules:["web"], paths:["/auth/*"]}`），`check.ts` 跳过豁免项（error→skip），配测试。
6. **config.yaml**：`host 127.0.0.1` / `port 9779` / `base /api` / `auth.jwt_secret` 随机 / `blob.driver local` + `blob.root uploads`。
7. 数据模型细节：`parentId` 根=0、`user-info.id` string、`web` seed 用 `admin/12345`+`common/12345`、home `line` 懒补数。

---

## §1. 阶段总览（P0–P6）

| Phase | 范围 | 主要产物 | 门禁 |
|---|---|---|---|
| P0 | 骨架 + spike | `apps/playground-oj` 初始化、端口 9779、web 登录冒烟 | `ram dev` 起服 + oj 健康 + 登录 200 |
| P1 | 前端迁移 + 注入机制 + ram 缺口 | 11 模块拷贝、D9 注册表、ram `--check` 豁免 | 单测绿 + `ram api` 生成 + 根仓回归 |
| P2 | 认证与数据层 | web 真实化、system 数据层（migrations+seed）、common 用户 | user-info / async-routes 按角色差异 |
| P3 | system + demo 真实化 | system CRUD handler + 注入接入、demo todos | system CRUD 往返落库 |
| P4 | home/notification/personal-center | home pie/line、notification 注入、upload multipart | 三模块端到端 |
| P5 | release 回归 | `ram build`/`preview`、`ram api --docs`、smoke 两态 | 全链回归 + 根仓主应用回归 |
| P6 | 文档收尾 | 计划勾选、阶段小结、问题分类 | — |

> 每个 Phase 开始前 `git switch -c feat/playground-oj-pX`（CLAUDE.md：每逻辑单分支）。本计划统一在 `feat/playground-oj` 上推进子任务 commit。

---

## §2. P0 — 骨架与 spike（TDD/BDD 任务）

### P0-1 `ram init` 骨架
- **Files:** Create `apps/playground-oj/`（init 生成）
- Step: `cd /Users/ever/git/web/react-antd-module && node packages/cli/bin/ram.mjs init apps/playground-oj --yes`
- 确认：bin/oj 解包（sha256 命中 `VENDOR_SHA256`）、`api/config/{public.pem,cert.jws}` 签发、`api/src/web/{manifest.yaml,seed.sql,migrations,hello,user-info,get-async-routes}/api.ts` 生成。
- Step: 端口改 9779：`apps/playground-oj/api/config.yaml` `server.port: 9779`（F11，避开 playground 9778）。
- Step: D11 依赖改写：照 `apps/playground/package.json` 把 `apps/playground-oj/package.json` 的 devDependencies 改回 `workspace:*`/`catalog:`，并补 `@react-antd-module/contract`（否则 demo 契约 typecheck 挂）。
- Step: `pnpm install`（需 npm registry；失败则记录并手工补 lockfile）。
- Commit: `chore(playground-oj): ram init 骨架 + 端口9779 + D11 依赖改写`

### P0-2 web 登录冒烟（spike）
- Step: 起 `cd apps/playground-oj && pnpm dev 5191`（避开 5174/9778）。
- Step: `curl -X POST http://127.0.0.1:9779/api/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"123456"}'` → 信封 `code:0` + `data.access_token`。
- Step: `curl http://127.0.0.1:9779/api/web/user-info -H "authorization: Bearer <token>"` → 返回 users 行。
- Step: spike 确认（写 `apps/playground-oj/notes-spike.md`）：`schema.yaml` 强制程度、`oj build --check` S 门禁、`contract.ts` 进 dist 无害。
- Commit: `test(playground-oj): web 登录冒烟 + spike 记录`

### P0-3 竖切联调（ram dev 反代）
- Step: 浏览器/ curl 访问 `http://localhost:5191/` → shell 静态页可达；`/api/*` 反代 oj 返回 200。
- Step: 确认 oj 健康轮询通过、Ctrl-C 回收无孤儿（oj-process 测试已验证，本次手动确认）。
- Commit: `test(playground-oj): ram dev 反代联调`

P0 完成标准：`ram dev` 起服、oj 健康、admin/123456 登录 200、user-info 200。

---

## §3. P1 — 前端迁移 + 注入机制 + ram 缺口

### P1-A runtime D9 注入机制（TDD，先写用例）
- **Files:** Create `packages/runtime/src/store/api-provider.ts`；Modify `packages/runtime/src/api/system/role/index.ts`、`api/system/menu/index.ts`、`api/notifications/index.ts`、`components/basic-form/form-avatar-item.tsx`、`module-loader/index.ts`、`module-loader/types.ts`、`index.ts`（导出类型）、`unloadModule`。
- Step1 写用例（TDD）：`tests/runtime/api-provider.test.ts`
  - 注册表：未注册时 `getSystemApiProvider()` 回落内置；`registerSystemApiProvider("x", impl)` 后 `getSystemApiProvider()` 返回 impl；二次注册 warn 忽略；`unregisterApiProviders("x")` 复位。
  - notifications / upload 同族。
- Step2 实现 `api-provider.ts`：三注册表 + `unregisterApiProviders`；默认实现持 root 级（沿用现有 `fetchRoleList` 等）。
- Step3 消费点委托：
  - `api/system/role/index.ts`：`fetchRoleList` 等 → `const p = getSystemApiProvider(); return p ? p.fetchRoleList(...) : internalClient.fetchRoleList(...)`。
  - `api/system/menu/index.ts`：同上（合并进同一 `systemApi` provider 接口）。
  - `api/notifications/index.ts`：`fetchNotifications` → provider 回落。
  - `form-avatar-item.tsx`：`const up = getUploadApiProvider(); action = up?.action ?? defaultAction; headers = up?.headers ?? {...}`。
- Step4 `module-loader`：`ctx.register` 增 `systemApi`/`notificationsApi`/`uploadApi`（闭包 name）；`unloadModule` 调 `unregisterApiProviders(name)`。
- Step5 导出类型：`packages/runtime/src/index.ts` 导出 `SystemApiProvider`/`NotificationsApiProvider`/`UploadApiProvider` 类型（仿 `AuthProvider`）。
- Step6 重建 dist（memory 纪律）：`pnpm --filter @react-antd-module/runtime build && pnpm --filter @react-antd-module/shell build`，提交 dist。
- Step7 回归：根仓 `pnpm test`（runtime-exports 冻结断言 `fetchRoleList` 等仍为 function）；根仓主应用 `ram dev` 根级路径仍 200（验证零影响）。
- Commit: `feat(runtime): D9 内部 api 注入机制（仿 authProvider）`

### P1-B ram api --check 豁免（TDD，缺口 D12/F19）
- **Files:** Modify `packages/cli/src/contract/check.ts`；Create `api/.ram-api-exempt.json`（在 playground-oj）；Modify `tests/cli/contract-check.test.ts`。
- Step1 写用例：`tests/cli/contract-check.test.ts` 增「存在豁免配置时 `web` 模块与 `/auth/*` 不报 `route-unregistered` / dist 多 error，退出码 0」。
- Step2 实现：`check.ts` 读 `api/.ram-api-exempt.json`（缺省 `{}`）；`reconcileRoutes` 跳过 `modules` 命中与 `paths` 前缀（`/*` 一层通配）命中的 handler；dist 对账跳过 `paths` 命中行。
- Step3 加 CLI 参数 `--exempt <path>` 可选覆盖；文档 `usage.ts` 更新。
- Step4 回归：`pnpm --filter @react-antd-module/cli test` 全绿。
- Commit: `feat(cli): ram api --check 豁免清单（D12）`

### P1-C 10 模块拷贝 + notification 壳（D10）
- **Files:** Create `apps/playground-oj/modules/src/<10 模块>/`（拷贝自根仓 `modules/*` 与 `apps/playground/modules/src/{demo,login}`）；Create `apps/playground-oj/modules/src/notification/`（最小壳）。
- Step1 拷贝：`cp -r` 根仓 8 模块 + playground 的 demo/login 到 `apps/playground-oj/modules/src/`，改各 `entry.ts` 路径为本工程内（页面 import 相对路径随拷贝保留）。
- Step2 `notification` 壳：`entry.ts` 无页面 `routes:[]`，`onInit` 注册 notifications 注入实现（见 P4）；`api/src/notification/contract.ts` 持有（见 P4）。
- Step3 `modules.config.ts`：列 11 个 entry，顺序对齐 playground（baseUrl `""`）。
- Step4 `pnpm typecheck`（playground-oj）应过（D11 已补 contract）。
- Commit: `feat(playground-oj): 10 模块拷贝自包含 + notification 壳`

### P1-D 契约生成（ram api）
- **Files:** Create `apps/playground-oj/api/src/{system,home,notification,demo,personal-center}/contract.ts`（apiPrefix=目录名，AC-D9）。
- Step1 写 `system/contract.ts`：`role-list`(GET,query:name/status/code+分页)、`role-item`(POST/PUT/DEL)、`role-menu`(GET)、`menu-by-role-id`(GET,query:id)、`menu-list`(GET)、`menu-item`(POST/PUT/DEL)。zod 白名单内（无 lazy）。
- Step2 `home/contract.ts`：`pie`(GET,query:by?)、`line`(POST,body:range)。
- Step3 `notification/contract.ts`：`notifications`(GET)。
- Step4 `demo/contract.ts`：`todos`(GET,query:keyword)（迁移原试点）。
- Step5 `personal-center/contract.ts`：`upload`(POST)。
- Step6 `ram api` 生成 client/routes/openapi/stub；`ram api --check`（用 P1-B 豁免 web/auth）→ 0。
- Commit: `feat(playground-oj): 契约层 + ram api 生成（豁免生效）`

P1 完成标准：runtime D9 单测绿、ram `--check` 豁免绿、11 模块 typecheck 过、`ram api` 全产物生成。

---

## §4. P2 — 认证与数据层

### P2-1 login 退化纯页面（F3）
- **Files:** Modify `apps/playground-oj/modules/src/login/entry.ts`（删 `authProvider` 注册，用 runtime 默认登录链）。
- Step: `pnpm dev` 验证 admin/123456 经 runtime 默认 `auth/login`+`web/user-info` 登录成功。

### P2-2 web 真实化
- **Files:** Modify `apps/playground-oj/api/src/web/{user-info,get-async-routes,country-calling-codes}/api.ts`；Modify `api/src/web/seed.sql`（admin/12345+common/12345，bcrypt 配方注头）；删模板 admin/123456 行。
- `user-info`：查 `users` where `http.user.id`，返回 snake→camel（`id` string）。
- `get-async-routes`：menus+role_menu 按 `http.user.roles` 过滤 → 路由树（API 级演示，F2）。
- `country-calling-codes`：静态常量对齐 `fake/constants.ts`（F9）。

### P2-3 system 数据层（F5，提前）
- **Files:** Create `apps/playground-oj/api/src/system/{manifest.yaml(加 tables+deps:[system]→实际 system 自管), schema.yaml, migrations/0001__create_roles.sql, 0001__create_menus.sql, 0001__create_role_menu.sql, seed.sql}`。
- Step: `oj migrate -c api/config.yaml -d api/src`（spike 确认 auto 下启动收敛）。
- Step: seed 显式 id（角色/菜单 ~8 行，菜单 id 100+ 对齐引用；F8b 列清单）。

### P2-4 API 级权限差异冒烟
- Step: `curl` admin/12345 login → user-info（roles admin）；common/12345 login → user-info（roles common）；get-async-routes 两账号返回树不同（断言 diff）。
- Commit: `feat(playground-oj): P2 认证与 system 数据层`

P2 完成标准：两账号 user-info/async-routes 差异可断言；system 表建好 + seed 落库。

---

## §5. P3 — system + demo 真实化

### P3-1 system CRUD handler（D9 注入接入）
- **Files:** Create `apps/playground-oj/api/src/system/{role-list,role-item,role-menu,menu-by-role-id,menu-list,menu-item}/api.ts`；Modify `apps/playground-oj/modules/src/system/entry.ts`（onInit 用 `api/src/system/client.ts` `bindRequest(ctx.utils.request)` 注册 `systemApi` provider）。
- handler：query 过滤 + 分页（role-list/menu-list）；CRUD（role-item/menu-item，DEL→`del`）；SQL 全参数绑定；snake→camel。
- Step: `ram api --check` 仍绿（system 已进契约）。
- Step: system 模块页（拷贝）调 `fetchRoleList`（runtime 导出）→ 经 registry 委托到注入实现，dev 下走 `/api/system/role-list`。

### P3-2 demo todos 真实化
- **Files:** Create `apps/playground-oj/api/src/demo/{manifest.yaml,todos/api.ts, migrations, seed.sql}`；demo 模块 `entry.ts` 已 `apiPrefix("/demo")`+`bindRequest`（试点）。
- Step: todos GET（keyword 过滤）查 `todos` 表；seed 几条。
- Step: demo 页登录后读写（行为变化：全栈受 Bearer 守卫）。
- Commit: `feat(playground-oj): P3 system CRUD + demo todos 真实化`

P3 完成标准：system CRUD 往返落库（重启 oj 数据仍在）；demo todos 真实读写。

---

## §6. P4 — home / notification / personal-center

### P4-1 home pie/line（懒补数）
- **Files:** Create `apps/playground-oj/api/src/home/{manifest.yaml,schema.yaml,migrations,seed.sql(五分类),pie/api.ts,line/api.ts}`；home 模块 `entry.ts` 注册 `home` 契约 client。
- `pie`：按 category 聚合；`line`：窗口聚合 + 缺哪天补哪天（幂等，F6）。

### P4-2 notification 注入（D9 + 壳）
- **Files:** Create `apps/playground-oj/api/src/notification/{manifest.yaml,notifications/api.ts, migrations, seed.sql}`；`modules/src/notification/entry.ts` 注册 `notificationsApi` provider（用 `api/src/notification/client.ts`）。
- `notifications` GET 查 `notifications` 表；notification-container 经 registry 回落→注入。

### P4-3 upload multipart → base64（D7/F4）
- **Files:** Create `apps/playground-oj/api/src/personal-center/{manifest.yaml,upload/api.ts}`；`modules/src/personal-center/entry.ts` 注册 `uploadApi` provider（`action=/api/personal-center/upload`，headers 带真 Bearer）。
- `upload` POST：`http.files[0]` → base64 → 写 `users.avatar_base64`（按 `http.user.id`）；返回 data URL。form-avatar-item 经 registry 取 action/headers（D9）。
- Commit: `feat(playground-oj): P4 home/notification/upload 真实化`

P4 完成标准：home 图表、通知列表、头像上传回显三模块端到端通过。

---

## §7. P5 — release 回归 + 集成

### P5-1 build / preview / docs
- Step: `ram build`（模块构建 + 全站合并 + `oj build --check` S 门禁）→ 0。
- Step: `ram preview`（migrate → oj server + 静态兜底）→ 访问 `/` 与 `/demo` 深链接。
- Step: `ram api --docs` → `api/docs/index.html`（注：需网络拉 redoc CDN；离线跳过并记录）。
- Step: 根仓主应用回归：根仓 `ram dev` / `pnpm test` 根级路径仍 200（D9 默认回落零影响）。

### P5-2 集成冒烟脚本
- **Files:** Create `apps/playground-oj/scripts/smoke.sh`：login(admin/common) → user-info → async-routes(diff 断言) → system CRUD 往返；dev 与 preview 两态各跑。
- Step: 两态跑通，断言全绿。
- Commit: `test(playground-oj): 集成冒烟两态通过`

P5 完成标准：build/preview 全链回归 + smoke 两态 + 根仓回归不破。

---

## §8. P6 — 文档收尾

- Step: 本计划逐任务勾选完成状态，追加「阶段小结」（关键过程 + 耗时）。
- Step: §10 过程问题分类（反常规/反常识/与业界不符）。
- Step: 全文总结（设计 v3 终稿 + 验收对照）。
- Commit: `docs(playground-oj): 阶段小结 + 问题分类 + 总结`

---

## §9. 风险与依赖

- **网络**：`pnpm install` / `ram api --docs` 需 registry/CDN；离线时记录并跳过。
- **macOS arm64 only**：`ram init` 平台硬限（init.ts:32）。
- **dist 必随源码提交**：改 runtime/shell src 后必须重建并提交 dist（memory + 设计 §10）。
- **ram 缺口**：`--check` 豁免（P1-B 补）、notification 孤儿发射（P1-C 壳解）。
- **oj-process 时序**：健康轮询 timeoutMs 已 10000（生产默认），本工程沿用。
