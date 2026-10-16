# system 管理前端模板模块 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 `packages/cli/templates/web/src/system/` 管理前端模板模块（6 页），含使其可用的 api 契约（`.schema`/`.response`）补全，T1 设计文档已评审通过。

**Architecture:** 模板模块（entry.ts + pages/ + locales/）+ ojm api 生成 `__client`；页面经 react-query 调生成的端点函数；`/system` 父路由 container 布局 + requiredRoles admin。规划期发现：**system 的 12 个 api handler 均无 `.schema`/`.response`，生成器对无契约端点发无参函数（不传 query/body），前端无法调用**——先补契约（服务层零改动，布尔已在 service 归一为 true boolean）。

**Tech Stack:** React 19 / antd 6 / @tanstack/react-query（宿主单例）/ react-i18next / ojm api 生成 client（ContractApiError）。

## Global Constraints

- 模板代码风格：Tab 缩进、双引号、分号（ESLint @antfu）；模块只可 import `@oj-module/runtime`（含 `/contract`、`/contract/errors`）+ importmap 共享依赖 + 自身相对路径（manual §2.6）。
- 模块名/前缀固定 `system`；不 import 业务模块；`__client` 不进模板（init 后 `oj openapi` + `ojm api` 生成）。
- i18n namespace `system:`；settings `label_key`（`system:setting.*`）落本模块 locale。
- API 服务层（`_shared/service/*`）**零改动**；只动 handler 契约声明。
- 提交信息 conventional + 结尾 `unix@vip.qq.com ai`；每任务一提交。
- BDD 用例真源在设计文档 §4；本计划任务验收引用其 Scenario/点检编号。

---

### Task 1: 设计文档 round2 增补（契约缺口）

**Files:**
- Modify: `docs/plans/2026-10-16-1526-system-admin-web-design.md`

- [ ] **Step 1: 记录 round2 评审发现**（评审记录表加 R9–R10；改动面加 api handler 契约行；任务清单加 T3a）

发现内容：emit-client 无 `.schema` → 无参函数（`packages/cli/src/contract/emit-client.ts` `emitEndpoint`：slots 为空则 `argDecl=""`、opts 无 searchParams/json），12 个 system handler 现均无契约 → 生成的 client 全部不可用。处置：handler 补 `.schema`/`.response`（manual §3.3 写法），服务层零改动。

- [ ] **Step 2: Commit**

```bash
git add docs/plans/2026-10-16-1526-system-admin-web-design.md
git commit -m "docs(system): 计划期发现契约缺口——system handler 补 .schema/.response 纳入范围"
```

---

### Task 2: api 契约——system 12 端点补 `.schema`/`.response`

**Files:**
- Modify: `packages/cli/templates/api/src/system/users/api.ts`（get.response + post.schema/response）
- Modify: `packages/cli/templates/api/src/system/users/forbidden/api.ts`（put.schema）
- Modify: `packages/cli/templates/api/src/system/users/password/api.ts`（put.schema）
- Modify: `packages/cli/templates/api/src/system/users/roles/api.ts`（put.schema）
- Modify: `packages/cli/templates/api/src/system/roles/api.ts`（get.response；post/del.schema——契约完整，页面不用）
- Modify: `packages/cli/templates/api/src/system/permissions/api.ts`（get.response）
- Modify: `packages/cli/templates/api/src/system/oplog/api.ts`（get.schema/response）
- Modify: `packages/cli/templates/api/src/system/settings/api.ts`（get.response + put.schema）
- Modify: `packages/cli/templates/api/src/system/login-methods/api.ts`（get.response）

**Interfaces:**
- Produces（生成 client 端点函数，ojm api 从 operationId 派生，页面据此 import）:
  - `systemUsersGet(): Promise<SystemUsersGetData>` — `UserRow[]`
  - `systemUsersPost({ body }): Promise<SystemUsersPostData>` — `{ id: number }`
  - `systemUsersForbiddenPut({ query: { uid }, body: { forbidden } })`
  - `systemUsersPasswordPut({ query: { uid }, body: { password } })`
  - `systemUsersRolesPut({ query: { uid }, body: { roles } })`
  - `systemRolesGet(): Promise<SystemRolesGetData>` — `RoleRow[]`
  - `systemPermissionsGet(): Promise<SystemPermissionsGetData>`
  - `systemOplogGet({ query: { action?, username?, module?, limit? } }): Promise<SystemOplogGetData>`
  - `systemSettingsGet(): Promise<SystemSettingsGetData>`；`systemSettingsPut({ body: { key, value } })`
  - `systemLoginMethodsGet(): Promise<{ methods: string[] }>`

写法（manual §3.3）：`export default { get, put }` 对象字面量改为命名函数 + 挂属性，业务逻辑不动：

```ts
async function get() { /* 原逻辑不动 */ }
get.response = {
	type: "array",
	items: {
		type: "object",
		properties: {
			id: { type: "number" }, username: { type: "string" },
			display_name: { type: ["string", "null"] }, email: { type: ["string", "null"] },
			is_forbidden: { type: "boolean" }, must_change: { type: "boolean" },
			roles: { type: "array", items: { type: "string" } },
		},
		required: ["id", "username", "display_name", "email", "is_forbidden", "must_change", "roles"],
	},
};
```

各端点契约（JSON Schema 白名单子集，布尔安全——service 已 `Number(x)===1` 归一）：

| handler | .schema | .response |
| --- | --- | --- |
| users.get | — | UserRow[] 如上 |
| users.post | body: `{username: string minLength 1, password: string minLength 6, displayName?: string, email?: string}` | `{id: number}` |
| users/forbidden.put | query `{uid: number}` + body `{forbidden: boolean}` | 省略 |
| users/password.put | query `{uid: number}` + body `{password: string minLength 6}` | 省略 |
| users/roles.put | query `{uid: number}` + body `{roles: array<string>}` | 省略 |
| roles.get | — | `RoleRow[]`：`{name, module, title: [string,null], description: [string,null], builtin: boolean, deprecated: boolean, holders: number, permissions: string[]}` |
| roles.post | body `{name: string pattern ^custom\.[a-z0-9][a-z0-9-]*$, title: string, permissions?: array<string>}` | `{name: string, module: string}` |
| roles.del | query `{name: string}` | 省略 |
| permissions.get | — | `array<{code, module, title_key: [string,null], deprecated: boolean}>` required 全列 |
| oplog.get | query `{action?: string, username?: string, module?: string, limit?: number}` | `{list: array<OplogRow>, total: number, truncated: boolean}`；OplogRow = `{id, create_time, user_id, username, action, module, version: [string,null], target: [string,null], detail: [string,null], level: number}` required 全列 |
| settings.get | — | `array<{group: string, items: array<SettingItem>}>`；SettingItem = `{key, module, group, type, value: [string,null], default_value: [string,null], label_key: [string,null], options: [string,null], secret: boolean, update_time: number}` required 全列 |
| settings.put | body `{key: string minLength 1, value: string}` | 省略 |
| login-methods.get | — | `{methods: array<string>}` |

- [ ] **Step 1: 按 9 文件逐个重构（命名函数 + 挂 .schema/.response，逻辑零改动）**
- [ ] **Step 2: 跑 api 模板既有测试回归**

Run: `pnpm exec vitest run --config packages/cli/templates/api/vitest.config.ts`（若 config 依赖目录上下文则 `cd packages/cli/templates/api && pnpm exec vitest run`）
Expected: 全绿（契约声明不影响 handler 行为；rbac-*.spec 是行为回归网）

- [ ] **Step 3: oj openapi 内省 + ojm api --check 零漂移**

```bash
pnpm exec tsx packages/cli/src/index.ts api --check --dir packages/cli/templates/api
```
Expected: 无 violations（若 check 需要先产出 openapi.json，则先 `bin/oj openapi -d api/src`，冒烟任务有真 oj，届时补跑并回填本步结果）

- [ ] **Step 4: Commit**

```bash
git add packages/cli/templates/api/src/system
git commit -m "feat(system-api): 12 端点补 .schema/.response 契约（前端 client 可用的前提）"
```

---

### Task 3: 模块骨架——entry.ts + locales + shared

**Files:**
- Create: `packages/cli/templates/web/src/system/entry.ts`
- Create: `packages/cli/templates/web/src/system/locales/zh-CN.json`、`en-US.json`
- Create: `packages/cli/templates/web/src/system/pages/shared.tsx`

**Interfaces:**
- Consumes: `defineModule`/`AppRouteRecordRaw`/`useUserStore`（`@oj-module/runtime`）、`createSystemClient`（`./__client/api`，生成前 ts 报红为预期，manual §2.2）
- Produces: 路由 `/system` + 6 子路由；locale key 全集（下方清单）；`shared.tsx` 导出：
  - `ForbiddenPanel()` — 403 面板（Result status 403）
  - `useSystemPage()` → `{ t, forbidden, explain }`：`forbidden: boolean`（页面级 403 状态）、`explain(e: unknown): string`（已知 ContractApiError 码映射 i18n 文案，未知透传 msg）

entry.ts 骨架（verbatim）：

```ts
import type { AppRouteRecordRaw, ModuleDefinition } from "@oj-module/runtime";
import { SettingOutlined } from "@ant-design/icons";
import { createElement, lazy } from "react";
import { createSystemClient } from "./__client/api";

const Users = lazy(() => import("./pages/users"));
const UserRoles = lazy(() => import("./pages/users/roles"));
const Roles = lazy(() => import("./pages/roles"));
const Oplog = lazy(() => import("./pages/oplog"));
const Settings = lazy(() => import("./pages/settings"));
const LoginMethods = lazy(() => import("./pages/login-methods"));

const routes: AppRouteRecordRaw[] = [{
	path: "/system",
	handle: {
		icon: createElement(SettingOutlined),
		title: "system:menu.system",
		order: 100,
		layout: "container",
	},
	children: [
		{ path: "/system/users", Component: Users, handle: { title: "system:menu.users" } },
		{ path: "/system/users/:uid/roles", Component: UserRoles, handle: { title: "system:menu.userRoles", hideInMenu: true } },
		{ path: "/system/roles", Component: Roles, handle: { title: "system:menu.roles" } },
		{ path: "/system/oplog", Component: Oplog, handle: { title: "system:menu.oplog" } },
		{ path: "/system/settings", Component: Settings, handle: { title: "system:menu.settings" } },
		{ path: "/system/login-methods", Component: LoginMethods, handle: { title: "system:menu.loginMethods" } },
	],
}];

export default defineModule({
	name: "system",
	description: "系统管理模块（框架管理面）",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	config: { requiredRoles: ["admin"] },
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	lifecycle: {
		async onInit(ctx) {
			// 构造即接线：登记 /system 前缀 + scoped request（D11），页面直接 import 端点函数
			createSystemClient(ctx);
		},
	},
});
```

（`defineModule` import 同 playground-oj 形态；若模板 notification 的 `defineModule` 为独立 import 则对齐之。）

locale key 全集（zh/en 各一份，值人话）：
- `menu.{system,users,userRoles,roles,oplog,settings,loginMethods}`
- `users.{columns.*（username,displayName,email,roles,status,actions）,create,resetPwd,forbidden,forbiddenOn,createOk,firstLoginHint,selfActionHint}`
- `userRoles.{title,save,saved}`
- `rolesPage.{tabRoles,tabPerms,builtin,deprecated,holders,permissions}`
- `oplog.{filterAction,filterUsername,filterModule,filterLimit,search,truncated,columns.*}`
- `settingsPage.{save,saved,secretHint}`
- `loginMethodsPage.{title,methodLocal,methodLdap,methodSso}`
- `err.{forbidden,selfAction,pwdTooShort,usernameExists,usernameReserved}`
- `setting.{site_title,ldap_enabled,sso_enabled,ldap_base_dn,ldap_uid_attr,ldap_email_attr}`（与 seed `label_key` 对齐）
- `common.{confirm,cancel,loading,empty}`

shared.tsx（verbatim）：

```tsx
import { ContractApiError } from "@oj-module/runtime/contract/errors";
import { Alert, Result } from "antd";
import { useTranslation } from "react-i18next";

/** 页面级 403 面板：路由可进但 API 403（如 admin 碰 superadmin-only）——非 error boundary */
export function ForbiddenPanel({ t }: { t: (k: string) => string }) {
	return <Result status="403" title={t("err.forbidden")} />;
}

/** 已知业务错误码/文案 → i18n 人话；未知透传后端 msg */
export function explainError(e: unknown, t: (k: string) => string): string {
	const code = (e as { code?: number })?.code;
	const msg = (e as { msg?: string })?.msg ?? String(e);
	if (code === 403) return t("err.forbidden");
	if (typeof msg === "string") {
		if (msg.includes("yourself")) return t("err.selfAction");
		if (msg.includes("password too short")) return t("err.pwdTooShort");
		if (msg.includes("username exists")) return t("err.usernameExists");
		if (msg.includes("reserved")) return t("err.usernameReserved");
	}
	return msg;
}

/** 页面 403 装配：数据加载 catch 到 403 → forbidden 置真 */
export function useForbidden(setter: (v: boolean) => void) {
	return (e: unknown) => {
		if ((e as { code?: number })?.code === 403) setter(true);
	};
}
```

（实现时允许合并 useForbidden 进 useSystemPage，少一个导出；以最终代码为准，本文件是形状锚。）

- [ ] Step 1: 写 entry.ts + locales + shared.tsx
- [ ] Step 2: `pnpm exec eslint packages/cli/templates/web/src/system` 通过（`__client` import 报红属预期，eslint 不解析缺失模块的未定义导出即过；若报 no-extraneous-import 类错误则该行加 eslint 注释豁免）
- [ ] Step 3: Commit `feat(system-web): 模块骨架——entry 路由/i18n/403 面板与错误映射`

---

### Task 4: 用户管理页 + 成员资格页

**Files:**
- Create: `packages/cli/templates/web/src/system/pages/users/index.tsx`
- Create: `packages/cli/templates/web/src/system/pages/users/roles.tsx`

**Interfaces:**
- Consumes: `systemUsersGet/systemUsersPost/systemUsersForbiddenPut/systemUsersPasswordPut/systemUsersRolesPut`（Task 2 契约）、`ForbiddenPanel/explainError`、`useUserStore`
- Produces: 行类型 `type UserRow = SystemUsersGetData[number]`（从生成类型派生，DRY）

users/index.tsx 规格（本页为其余页面的模式锚，实现含完整代码）：
- `useQuery({ queryKey: ["system","users"], queryFn: systemUsersGet })`；403 → ForbiddenPanel。
- 列：username / displayName / email / roles（Tag 列表）/ 状态（is_forbidden Switch + must_change Tag「首登改密」）/ 操作。
- 本人行（`useUserStore(s => s.userId)` — 字段名以 store 实际为准，user.ts 有 `userId` 或 `id`，实现时核对）禁用操作按钮（R3 自操作防护）。
- 工具栏「建号」Modal：Form username/password/displayName/email；校验 `minLength 6` 密码、`pattern ^(?!ldap:|sso:).*` 用户名提示；成功 `message.success(firstLoginHint)` + invalidate `["system","users"]`。
- 重置口令：Modal.password 输入新密码 → `systemUsersPasswordPut({ query:{uid}, body:{password} })`。
- 禁用切换：Popconfirm → `systemUsersForbiddenPut`；错误 explainError toast。
- 成员资格入口：仅 `useUserStore` roles 含 superadmin 渲染，navigate `/system/users/${uid}/roles`。

users/roles.tsx 规格：
- `useParams().uid` + `useQuery(users)` 取该 uid 的 `roles` 回显（后端无 GET roles）。
- Checkbox.Group 全量角色（`systemRolesGet` 过滤掉 superadmin/admin？——不过滤：整集替换语义，superadmin 自己知道在做什么；admin 非超管提交即 403 面板，见设计 §3.2）。
- 保存 → `systemUsersRolesPut`，成功回列表；本人 uid 禁保存。
- 加载 403 → ForbiddenPanel（主场景：admin 手输 URL）。

- [ ] Step 1: users/index.tsx（含完整代码）→ eslint 过
- [ ] Step 2: users/roles.tsx → eslint 过
- [ ] Step 3: Commit `feat(system-web): 用户管理与成员资格页`

---

### Task 5: 角色/权限页 + 登录方式页

**Files:**
- Create: `packages/cli/templates/web/src/system/pages/roles/index.tsx`
- Create: `packages/cli/templates/web/src/system/pages/login-methods/index.tsx`

roles/index.tsx 规格：Tabs 两块只读表——角色（name/module/title/description/holders/permissions Tag/builtin+deprecated 标灰 `Tag color="default"`）；权限点（code/module/title_key→`t(title_key)` 不命中回退 code（i18next `t(key, { defaultValue: code })`）/deprecated 标灰）。无任何写控件（规格 §3：写出口唯一为 upsertSolutionPerms）。

login-methods/index.tsx 规格：`useQuery(["system","login-methods"], systemLoginMethodsGet)` → Descriptions 渲染 `methods`（local/ldap/sso 映射 `loginMethodsPage.method*` 文案）。

- [ ] Step 1: roles/index.tsx → eslint 过
- [ ] Step 2: login-methods/index.tsx → eslint 过
- [ ] Step 3: Commit `feat(system-web): 角色权限只读视图与登录方式页`

---

### Task 6: 操作日志页 + 站点设置页

**Files:**
- Create: `packages/cli/templates/web/src/system/pages/oplog/index.tsx`
- Create: `packages/cli/templates/web/src/system/pages/settings/index.tsx`

oplog/index.tsx 规格：Form（action/username/module Input + limit InputNumber≤200）→ `useQuery(["system","oplog",filters], () => systemOplogGet({ query: filters }))`；列：create_time（dayjs(ms) 格式化）/username/action/module/target/detail（ellipsis+Tooltip）/level；`truncated===true` 顶部 Alert 提示（数据已截断，缩过滤范围）。

settings/index.tsx 规格：`systemSettingsGet` → **`items.filter(i => ["framework","ldap","sso"].includes(i.module))`**（设计 §3.3，业务键与 market.* 排除）→ 按 group 分组 Card；行：`t(label_key, { defaultValue: key })` label；`type==="bool"` → Switch（值 "1"/"0"，secret 项 disabled）；否则 Input（secret 项 `***` disabled）；每项失焦/确认 → `systemSettingsPut({ body:{key, value} })` + invalidate。

- [ ] Step 1: oplog/index.tsx → eslint 过
- [ ] Step 2: settings/index.tsx → eslint 过
- [ ] Step 3: Commit `feat(system-web): 操作日志与站点设置页`

---

### Task 7: 登记 + README

**Files:**
- Modify: `packages/cli/templates/web.config.ts`（notification 项后加 system 项，注释含 superadmin 入口说明）
- Modify: `packages/cli/templates/README.md`（「系统管理模块首次使用」段：`oj openapi -o openapi.json` → `ojm api` → 重启 dev；未生成时 system 模块标 error 属预期）

- [ ] Step 1: 两文件修改
- [ ] Step 2: Commit `feat(system-web): web.config 登记 system 模板模块 + README 首次使用说明`

---

### Task 8: 静态验证

- [ ] Step 1: `pnpm exec eslint packages/cli/templates` 通过
- [ ] Step 2: `pnpm test:cli` 回归（cli 契约/emit/init 测试不受影响）
- [ ] Step 3: Task 2 Step 3 的 `--check` 若此前未跑成（缺 openapi.json），此处并入冒烟前检查
- [ ] （修复随发现随改，不单独提交则并入 Task 9 修复提交）

### Task 9: 临时工程冒烟（设计 §3.6 机制，BDD §4 全量点检）

- [ ] Step 1: 构建 cli + runtime：`pnpm --filter @oj-module/runtime build && pnpm --filter @oj-module/cli build`（shell-dist 若缺先 `pnpm --filter @oj-module/cli build:shell`）
- [ ] Step 2: `node packages/cli/dist/index.js init /tmp/ojm-smoke --yes`；预拷 `apps/playground-oj/bin` → `/tmp/ojm-smoke/bin`（先拷则 init 幂等跳过下载）
- [ ] Step 3: `/tmp/ojm-smoke/package.json` 加 `"pnpm": {"overrides": {"@oj-module/cli": "file:/Users/ever/git/only-js/oj-module/packages/cli", "@oj-module/runtime": "file:/Users/ever/git/only-js/oj-module/packages/runtime"}}`（或 pnpm-workspace overrides 语法，以 pnpm 版本为准）→ `pnpm install`
- [ ] Step 4: `pnpm dev`（起 oj 后端 + web）→ 另终端 `bin/oj openapi -o openapi.json` → `pnpm exec ojm api`（或 `node <cli>/dist/index.js api`）→ 确认 `web/src/system/__client/api.ts` 生成、方法名与 Task 2 Interfaces 一致；不一致则以真实生成物为准修页面 import
- [ ] Step 5: `pnpm typecheck`（strict 口径自查，规格 §5.4）
- [ ] Step 6: 浏览器按设计 §4.2 三 Scenario + §4.3 八行点检（admin/123456 登录；建号 user1；禁用/重置/成员资格；只读视图；oplog 过滤；settings 改 site_title；login-methods）。发现问题回修模板，修复单独提交
- [ ] Step 7: 冒烟结果记录回设计文档 §7 总结段素材（临时文件或直接记）

### Task 10: 文档收尾

- [ ] Step 1: 设计文档任务清单 T1–T7 勾结 + §7 总结段（关键过程与耗时）
- [ ] Step 2: Commit `docs(system): 管理前端模板模块阶段总结`

## Self-Review

- 规格覆盖：6 页（T4–T6）、权限门禁（T3 requiredRoles + 页面 403 + superadmin 入口）、升级两步（T7 登记/README + init copyIfAbsent 幂等补缺）、验收四条（T8 build/test/check + T9 冒烟/typecheck）✓
- 类型一致性：Task 2 Interfaces 的函数签名 = T4–T6 Consumes = 生成器 emitEndpoint 规则（多槽 `{query, body}`、单槽具名）✓
- 占位符：shared.tsx/entry.ts verbatim；页面为规格+精确调用签名（执行者=本会话，模式锚页含完整代码）——已知取舍，记录于 Task 4。
