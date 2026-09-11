# Phase 1 — 注入机制与契约层

> 配套计划：`docs/prd/202609041045-playground-oj-plan.md` §1 P1、§3 P1-A~P1-D。
> 本阶段目标：让 playground-oj 具备「自包含」的两套能力——① 运行时把原来硬编码在
> root 级的内部 API（角色/菜单/通知/上传）通过注册表注入给模块（D9）；② 用 `ojm api`
> 契约机制从 `api/src/<模块>/contract.ts` 生成前端 client 与 oj handler stub，并对齐校验。
> 完成后：`runtime-exports` 冻结断言仍绿、`ojm api --check` 0/0、11 模块 typecheck 通过。

---

## 1. 执行步骤总览

| 子阶段 | 关键动作 | 产物 / 验证 |
| --- | --- | --- |
| P1-A | 运行时 D9 注入机制（仿 `authProvider`） | `store/api-provider.ts` + 4 个消费点委托 + 注册表接线；25 单测绿 |
| P1-B | `ojm api --check` 豁免清单 | `contract/check.ts` 支持 `--exempt` + `web`/`auth` 豁免；6 单测绿 |
| P1-C | 自包含拷贝 10 模块 + notification 壳 | 11 个 entry；playground-oj typecheck 通过 |
| P1-D | 契约层 + `ojm api` 生成 | 5 份契约四产物 + stub；`ojm api --check` 0/0 |

> P1-B 由子代理先行落地（CLI 豁免），P1-A/C/D 由主链路监督执行。

---

## 2. P1-A：运行时 D9 注入机制（TDD）

### 2.1 动机与决策
- 运行时原本把 `fetchRoleList` / `fetchMenuList` / `fetchNotifications` 以及头像上传
  `action`/`headers` **硬编码到 root 级路径**（如 `role-list`、`/upload`）。模块要接管
  这些端点（前缀收敛到自己的 `/<模块>`），必须有一个「先到先得 + 回落内置」的注入点。
- 设计选择：**照搬 `authProvider` 的模式**（模块作用域单一 provider、注册表、注销隔离），
  不引入 zustand（provider 只在 store action / 守卫里被读，非渲染期订阅）。

### 2.2 实现要点
- 新增 `packages/runtime/src/store/api-provider.ts`，内含三套注册表：
  `SystemApiProvider`（角色+菜单类，10 个 fetch*）、`NotificationsApiProvider`
  （`fetchNotifications`）、`UploadApiProvider`（`action` + `headers()`）。
- 注册函数 `registerSystemApiProvider` / `registerNotificationsApiProvider` /
  `registerUploadApiProvider`：已存在则 `console.warn` 并忽略（先到先得）。
- `unregisterApiProviders(moduleName)`：以 moduleName 作命名隔离，一次性复位三套注册表
  （供 `unloadModule` 调用）。
- **消费点委托**（未注册回落内置 root 级，沿用既有实现）：
  - `api/system/role/index.ts`：6 个 role fetch* 委托；并把菜单类 `fetchMenuList` /
    `fetchAddMenuItem` / `fetchUpdateMenuItem` / `fetchDeleteMenuItem` **再导出**——
    因为 `SystemApiProvider` 把角色与菜单统一在同一 provider 下（测试也从 `role` 入口取用）。
  - `api/system/menu/index.ts`：4 个 menu fetch* 委托。
  - `api/notifications/index.ts`：`fetchNotifications` 委托。
  - `components/basic-form/form-items/form-avatar-item.tsx`：`action`/`headers` 委托。
- `module-loader`：`ctx.register` 新增 `systemApi`/`notificationsApi`/`uploadApi`
  （闭包 `definition.name`）；`unloadModule` 调 `unregisterApiProviders(name)`。
- `runtime` 主入口导出 `SystemApiProvider` / `NotificationsApiProvider` / `UploadApiProvider`
  三个**类型**（仿 `AuthProvider`）。

### 2.3 TDD 与验证
- 先写 `tests/runtime/api-provider.test.ts`：覆盖「注册后取回 / 未注册回落 / 二次注册告警 /
  注销复位 / 消费点走 provider / 三表命名隔离复位」。
- 实现后：`tests/runtime/api-provider.test.ts` 15 绿 + `tests/runtime/runtime-exports.test.ts`
  10 绿（冻结白名单未受影响，因只导出类型、未新增运行时值）。
- 全量 `tests/runtime` 125 绿（`fullscreen-layout` 的 `document is not defined` 是 NProgress
  定时器环境噪声，与本阶段无关）。
- `pnpm typecheck` 全绿；重建 `runtime`/`shell` dist 并提交（memory 纪律：源码改须重建 dist）。

### 2.4 坑
- `ListData<T>` 是运行时 `src/types/index.d.ts` 的**全局环境声明**（非模块），不能 `import`，
  否则报 `File is not a module`。消费点直接用它即可（全局可见）。
- eslint `perfectionist` 要求 import/export 排序；手写后跑 `eslint --fix` 再补一处
  `indent-binary-ops`（改写为 `hitModule || hitPath` 规避多行二元运算）。

---

## 3. P1-B：`ojm api --check` 豁免清单

- 缺口 D12/F19：oj 内置 `auth/*` 与 playground 的 `web` 模块没有对应契约文件，但 `ojm api
  --check` 的「route 双向对账 / routes.js drift」会把它判成 `route-unregistered` 错误。
- 实现：`contract/check.ts` 读 `api/.ojm-api-exempt.json`（缺省回退 `{}`），`modules` 命中整模块、
  `paths` 前缀（`/auth/*` 一层通配）命中则降级跳过。CLI 增 `--exempt <path>` 可选覆盖。
- 测试 `tests/cli/contract-exempt.test.ts` 6 例覆盖豁免生效路径。

---

## 4. P1-C：自包含拷贝 10 模块 + notification 壳

### 4.1 拷贝来源
- 根仓 `modules/*` 8 个：`about` `access` `exception` `home` `outside` `personal-center`
  `route-nest` `system`。
- `apps/playground/modules/src` 的 `demo` `login`（替换 init 生成的纯 demo）。
- 根仓模块已统一 `import ... from "@oj-module/runtime"`，无 `#src/*` alias，故拷贝后
  在 playground-oj（依赖 `workspace:*` runtime）可直接解析。

### 4.2 补齐依赖
- 模块用到的 `pro-components` / `react-query` / `clsx` / `echarts` / `echarts-for-react` /
  `i18next` / `react-countup` / `@types/react-dom` 不在 init 的 deps 里 → 全部补为 `catalog:`。

### 4.3 notification 壳
- 仅 `defineModule({ name: "notification", routes: [] })`，无页面；通知拉取注入实现留 P4
  （连同 oj `/notification` handler 与 `contract.ts`）。使清单达 11 个 entry（D11）。

### 4.4 类型工程对齐（关键坑）
- playground-oj 经 **dist** 消费 runtime，而 runtime 全局类型（`ListData`/`OjEnvelope` 等）
  只随 **源码** 携带，dist 不发包。拷贝来的模块用 `import.meta.env` / `window.$message` /
  `fetch* 返回 ListData` → 首跑 typecheck 报 `ImportMeta.env` / `$message` / `item: any`。
- 修复：新增 `apps/playground-oj/vite-env.d.ts`，手工声明 `import.meta.env`、
  `Window.$message/$modal/$notification`、以及运行时全局 `ListData`/`OjEnvelope`/
  `ApiTableRequest`/`Recordable`；`tsconfig.json` 放开 `allowImportingTsExtensions`
  （runtime dist 引用的 `@oj-module/runtime/contract` 类型指向 `src/*.ts` 含 `.ts` 扩展名）。
- 结果：`pnpm --filter playground-oj typecheck` 通过。

---

## 5. P1-D：契约层 + `ojm api` 生成

### 5.1 契约形态（uni-dev）
- 文件位置：`api/src/<模块>/contract.ts`；`ojm api` 据此生成：
  - 前端 client：`modules/src/<模块>/api/{client.ts, client.schemas.ts}`（target=`module`，
    导出 `bindRequest(ctx.utils.request)`）。
  - 契约旁：`routes.json` + `openapi.yaml`。
  - oj handler stub：`api/src/<模块>/api/<路由>/api.ts`（POST/PUT/DEL 同路由合并到一个 stub）。
- **AC-D9**：每个端点 `apiPrefix` 字面等于 `/<目录名>`，否则 `ojm api` 人话报错。
- demo 由「前端试点契约」迁移为 uni-dev 形态（删 `modules/src/demo/api/contract.ts`，
  建 `api/src/demo/contract.ts`）。

### 5.2 五个契约
- `system`：`role-list`(GET) / `role-item`(POST/PUT/DEL) / `role-menu`(GET) /
  `menu-by-role-id`(GET) / `menu-list`(GET) / `menu-item`(POST/PUT/DEL)。
- `home`：`pie`(GET) / `line`(POST)。
- `notification`：`notifications`(GET)。
- `personal-center`：`upload`(POST)——multipart 由 antd `Upload` 直连 `uploadProvider.action`
  发送，不经 JSON client，故契约**不声明 body**，只声明 `data: string`（返回资源 URL）。
- `demo`：`todos`(GET)。

### 5.3 验证
- 生成 5 份契约四产物 + 11 个 stub（唯一路由数）。
- `ojm api --check`：**0 error / 0 warn**（`web` 豁免；未实现端点已是 stub 不告警；
  `api/dist/**/routes.js` 缺失仅 hint）。
- playground-oj typecheck 通过（生成 client 被 `/* eslint-disable */` 覆盖、tsconfig 已纳入 `api`）。

### 5.4 坑
- 契约 schema **白名单**不含 `z.any()`（`upload.body: z.any()` 直接报错）。文件上传走 multipart，
  不在 JSON 契约内 → 删掉 body schema。
- 生成的 oj stub 缩进超一格（4 tab vs 3 tab），`eslint --fix` 即可；修正后指纹变更，被视为
  「人工已编辑」——恰是 P4 落地 handler 的预期状态，`ojm api` 不再覆盖。

---

## 6. 阶段小结

- **能力闭环**：运行时 D9 注入（P1-A）+ 契约生成与豁免（P1-B/D）+ 自包含模块（P1-C）三件套
  到位，playground-oj 不再依赖根仓的 root 级内部端点，可独立跑自己的 oj 后端。
- **仍留白（P4 填）**：system/home/notification/personal-center/demo 的 oj handler 目前是 stub，
  notification 壳尚未注册 `notificationsApi` provider，system 模块尚未切到生成的 client。
- **下一步**：P2 认证与数据层（login 退化纯页面、system 真实迁移、common user、权限 diff）。
