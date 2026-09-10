# API 契约机制（ram api）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 落地契约机制——zod 契约为源，`ram api` 生成强类型 client/OpenAPI/routes/handler stub，前端统一 oj 信封，dev 运行时校验与契约 mock。

**Architecture:** DSL 在微包 `@react-antd-module/contract`（零浏览器依赖）；codegen 在 `packages/cli`（复用 `readModuleDefinition` 的 esbuild bundle + stub 链路求值契约）；生成 client 自包含（bindRequest holder 取 scoped client，信封解包内联，dev 校验 schema 独立文件 + DEV 守卫动态 import）；uni-dev 形态 stub handler 即 mock，纯前端形态 ram dev 消费 routes.json 生成 mock。

**Tech Stack:** zod v4（`z.toJSONSchema` → OpenAPI 3.1）、esbuild、Vitest（happy-dom）、ky、redoc CLI、@faker-js/faker。

**设计文档：** `docs/prd/202609030854-api-contract-design.md`（决策编号 AC-D*，本文引用）。

## Global Constraints

- 分支：`feat/api-contract`（已建）；每个 Task 结束即 commit（conventional，subject 小写，尾部署名 `unix@vip.qq.com ai`）。
- 代码风格：tabs 缩进、双引号、分号、@antfu/eslint-config；import alias `#src` → `packages/runtime/src`。
- zod 钉 v4 主版本；Node 侧（codegen）与浏览器侧（runtime re-export）同源定版。
- 报错文案全部「人话」中文（含修复指引）。
- runtime 出口冻结（P3）：本期唯一出口变更 = re-export `z`，drift-prevention 测试同步更新。
- 生产 bundle 不得含 zod / 契约 schema（参照 B15 fake-prod 测试模式断言）。
- 每 Phase 结束：更新本计划任务状态（checkbox），并在文末「阶段小结」节追加该阶段小结（关键过程与耗时）。
- TDD：每个 Task 先写失败测试再实现；评审与回归集中在 Phase 6。

---

## Phase 0：信封统一（AC-D16）

**目标**：全站唯一信封 = oj `{code,msg,data}`（`code=0` 成功，HTTP 状态 = code）；删除 `normalize`/`mapAuth` 适配层与 fake 旧信封透传。

### Task 0.1：error-response 读 oj `msg`

**Files:**
- Modify: `packages/runtime/src/utils/request/error-response.ts:26-32`
- Test: `packages/runtime/src/utils/request/error-response.test.ts`（新建）

**Interfaces:**
- Produces: `handleErrorResponse(response: Response): Promise<Response>` 签名不变；行为变更——JSON 错误体优先读 `msg` 键。

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { handleErrorResponse } from "./error-response";

vi.mock("#src/utils/static-antd", () => ({ message: { error: vi.fn() } }));
import { message } from "#src/utils/static-antd";

describe("handleErrorResponse（oj 信封）", () => {
	it("oj 业务错误体 {code,msg,data} → 吐司展示 msg", async () => {
		const res = new Response(JSON.stringify({ code: 400, msg: "name required", data: null }), { status: 400, statusText: "Bad Request" });
		await handleErrorResponse(res);
		expect(message.error).toHaveBeenCalledWith("name required");
	});
	it("非 JSON 错误体 → 回退 statusText", async () => {
		await handleErrorResponse(new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }));
		expect(message.error).toHaveBeenCalledWith("Bad Gateway");
	});
	it("旧 errorMsg/message 键不再读取（兼容删除）", async () => {
		const res = new Response(JSON.stringify({ message: "old key" }), { status: 400, statusText: "Bad Request" });
		await handleErrorResponse(res);
		expect(message.error).toHaveBeenCalledWith("Bad Request");
	});
});
```

- [x] **Step 2: 跑测试确认失败** — `pnpm vitest run packages/runtime/src/utils/request/error-response.test.ts`，预期第 1、3 条 FAIL。
- [x] **Step 3: 实现** — `error-response.ts:27` 的键读取改为 `const json = data as { msg?: string }; message.error(json.msg || response.statusText);`
- [x] **Step 4: 跑测试确认通过**（同上命令，全 PASS）。
- [x] **Step 5: Commit** — `fix(runtime): error-response 改读 oj 信封 msg 键（ac-d16）`

### Task 0.2：api/user 直消费 oj 信封 + store 适配

**Files:**
- Modify: `packages/runtime/src/api/user/index.ts`（删 `normalize`/`mapAuth`/`OjEnvelope`；fetch* 直返 data）
- Modify: `packages/runtime/src/api/user/types.ts`（`AuthType` 改 oj 线格式命名见下）
- Modify: `packages/runtime/src/store/auth.ts:45-54`、`packages/runtime/src/store/user.ts`、`packages/runtime/src/router/guard/auth-guard.tsx`、`packages/runtime/src/utils/request/refresh.ts`
- Test: `packages/runtime/src/api/user/index.test.ts`（新建）

**Interfaces:**
- Consumes: Task 0.1 的 error-response 行为。
- Produces（后续 Task 与页面依赖）：
  - `fetchLogin(data: LoginInfo): Promise<AuthType>`——成功返回 `{ token, refreshToken }`（`access_token`→`token` 的 3 行边界映射保留在本函数内，**信封**不再归一）；oj 业务失败由 ky HTTPError → error-response 吐司 + throw，store 不再检查 `success` 字段。
  - `fetchUserInfo(): Promise<UserInfoType>`、`fetchAsyncRoutes(): Promise<AppRouteRecordRaw[]>`、`fetchRefreshToken(...): Promise<AuthType>`、`fetchLogout(...): Promise<void>`——全部直返 `data` 或 void，返回类型不再是 `ApiResponse<T>`。

- [x] **Step 1: 写失败测试**（msw 不用，直接 stub ky 链：vi.mock `#src/utils/request` 的 `request`，返回带 `.json()` 的 thenable）

```ts
it("fetchLogin 成功：oj 信封 data.access_token 映射为 token", async () => {
	mockPostJson.mockResolvedValue({ code: 0, msg: "ok", data: { access_token: "a", refresh_token: "r" } });
	await expect(fetchLogin({ username: "u", password: "p" })).resolves.toEqual({ token: "a", refreshToken: "r" });
});
it("fetchUserInfo 直返 data", async () => {
	mockGetJson.mockResolvedValue({ code: 0, msg: "ok", data: { id: 1, username: "u", roles: [] } });
	await expect(fetchUserInfo()).resolves.toMatchObject({ username: "u" });
});
```

- [x] **Step 2: 跑测试确认失败** — `pnpm vitest run packages/runtime/src/api/user`。
- [x] **Step 3: 实现** — `api/user/index.ts` 重写：`fetchLogin` 体为 `request.post("auth/login", { json: data }).json<{ code: number, data: { access_token?: string, refresh_token?: string } }>().then(d => ({ token: d.data.access_token ?? "", refreshToken: d.data.refresh_token ?? "" }))`；`fetchUserInfo`/`fetchAsyncRoutes` 为 `.json<{ data: T }>().then(d => d.data)`；删除 `normalize`/`mapAuth`/`OjEnvelope`/`success` 检查。`store/auth.ts:45-54` 改为 `const auth = await fetchLogin(loginPayload); set(auth);`（删 success 分支——业务失败已是 HTTPError，由 error-response 吐司）。`store/user.ts`、`auth-guard.tsx`、`refresh.ts` 中 `.result` 消费改为直接消费返回对象（`refresh.ts:36` 附近读 `result.token` 处同改）。
- [x] **Step 4: 跑测试 + `pnpm typecheck`** — 全 PASS、类型零错误（`.result` 残留会编译报错，typecheck 即回归网）。
- [x] **Step 5: Commit** — `refactor(runtime): api/user 直消费 oj 信封，删除 normalize/mapauth（ac-d16）`

### Task 0.3：fake/mock 改 oj 信封 + 存量 `.result` 消费面迁移

**Files:**
- Modify: `fake/*.fake.ts` 全部（响应体 `{code:200,result,success,message}` → `{code:0,msg:"ok",data}`，业务失败改 HTTP 状态 + `json.fail` 形态）
- Modify: `apps/playground/mock/auth.mock.mjs`、`apps/playground/modules/src/login/entry.ts`（authProvider 消费改 oj 信封）
- Modify: `packages/runtime/src/api/home.ts`、`packages/runtime/src/api/notifications/`、`packages/runtime/src/api/system/**`（fetch* 直返 data）
- Modify: `modules/system/pages/**`、`modules/personal-center/**`、`packages/runtime/src/layout/widgets/notification/notification-container.tsx`、`packages/runtime/src/components/basic-form/form-items/form-avatar-item.tsx`（`.result`/`.success` 消费迁移）
- Test: 既有 `pnpm test` 全量 + `pnpm typecheck` 即回归网；fake 信封形态加一条 Vitest：

**Interfaces:**
- Consumes: Task 0.2 的 fetch* 新签名。
- Produces: 全仓 fetch* 约定——`fetch*(...): Promise<T>` 直返业务 data；失败抛错（HTTPError），不再返回信封对象。

- [x] **Step 1: 写失败测试** — `packages/runtime/src/api/system/role/index.test.ts`：stub request 返回 `{code:0,msg:"ok",data:{list:[],total:0}}`，断言 `fetchRoleList(...)` resolves `{list:[],total:0}`（非信封对象）。
- [x] **Step 2: 跑测试确认失败**（当前实现返回信封）。
- [x] **Step 3: 实现** — 按 Files 清单逐个迁移；页面迁移模式：`const responseData = await fetchRoleList(p); responseData.result.list` → `const { list } = await fetchRoleList(p)`；`responseData?.result.map` → 直接 `data.map`；`window.$message.success(... responseData.result)` → 直接用返回值。逐个文件改完即跑 typecheck 收敛。
- [x] **Step 4: 回归** — `pnpm typecheck && pnpm test && pnpm lint` 全绿；`pnpm dev` 手动冒烟登录链 + system/role 列表页。
- [x] **Step 5: Commit** — `refactor: 全站 fake/mock/页面迁移 oj 信封（ac-d16）`

- [x] **Phase 0 小结**：更新上述 checkbox；文末「阶段小结」追加 Phase 0 段落（迁移文件数、遇到的坑、耗时）。

---

## Phase 1：contract 微包（AC-D11）

**目标**：`@react-antd-module/contract`——`defineApi` + zod re-export + `ContractApiError` + `ScopedRequestLike` 类型，零浏览器依赖。

### Task 1.1：微包 scaffold + defineApi + 校验

**Files:**
- Create: `packages/contract/package.json`（name `@react-antd-module/contract`，exports `.` → `src/index.ts` + dist；dependencies `zod: ^4`；构建复用仓内现有库模式，参照 `packages/runtime` 的 tsdown/exports 配置）
- Create: `packages/contract/src/index.ts`、`packages/contract/src/define-api.ts`、`packages/contract/src/errors.ts`、`packages/contract/src/scoped-request-like.ts`
- Test: `packages/contract/src/define-api.test.ts`

**Interfaces:**
- Produces（codegen 与生成 client 共用）：

```ts
// define-api.ts
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
export interface ApiDefinitionInput {
	apiPrefix: string
	route: string            // 相对 apiPrefix，"/" 开头；支持 {id} / {*path}
	method?: HttpMethod      // 缺省 "GET"
	query?: ZodType
	params?: ZodType
	body?: ZodType
	data?: ZodType           // 与 response:"raw" 互斥
	response?: "raw"
	description?: string
}
export function defineApi<D extends ApiDefinitionInput>(def: D): D;  // 校验后原样返回（描述符可枚举 .route）

// errors.ts
export class ContractApiError extends Error {
	readonly code: number;
	readonly msg: string;
	constructor(code: number, msg: string);
}

// scoped-request-like.ts —— 生成 client 对 request 的最小结构类型（ISP）
export interface ScopedRequestLike {
	get: (url: string, options?: { searchParams?: Record<string, unknown> }) => { json: <T>() => Promise<T> }
	post: (url: string, options?: { json?: unknown }) => { json: <T>() => Promise<T> }
	put: ScopedRequestLike["post"]
	delete: ScopedRequestLike["post"]
	patch: ScopedRequestLike["post"]
}
```

- [ ] **Step 1: 写失败测试**

```ts
describe("defineApi", () => {
	it("合法定义原样返回且 .route 可枚举", () => {
		const d = defineApi({ apiPrefix: "/order", route: "/item/{id}", params: z.object({ id: z.number() }) });
		expect(d.method).toBeUndefined(); // 缺省在 IR 层归一
		expect(Object.keys(d)).toContain("route");
	});
	it.each([
		["route 无首斜杠", { apiPrefix: "/order", route: "list" }],
		["route 含 .. 穿越", { apiPrefix: "/order", route: "/../admin" }],
		["参数段混字面", { apiPrefix: "/order", route: "/item/{id}.json" }],
		["data 与 response:raw 并存", { apiPrefix: "/order", route: "/f", data: z.string(), response: "raw" as const }],
	])("%s → 人话报错", (_, def) => {
		expect(() => defineApi(def as never)).toThrowError(/契约/);
	});
});
```

- [ ] **Step 2: 跑测试确认失败** — `pnpm vitest run packages/contract`。
- [x] **Step 3: 实现** — `defineApi` 内 `validateDefinition`：首斜杠/`..`/参数段正则 `/^\{\*?[a-z_][a-z0-9_]*\}$/i`（段内含 `{` 必须整段匹配）/data 与 raw 互斥；报错文案含端点 route 与修法指引。`zod` 从本包 re-export（`export { z } from "zod"`）。
- [ ] **Step 4: 跑测试确认通过 + typecheck**。
- [ ] **Step 5: Commit** — `feat(contract): 新增 @react-antd-module/contract 微包（defineapi + contractapierror，ac-d11）`

- [ ] **Phase 1 小结**：更新 checkbox；文末追加小结。

---

## Phase 2：codegen 核心（packages/cli）

**目标**：契约求值 → IR → 四产物发射器，全部快照测试锁定。

### Task 2.1：契约求值（AC-D13）

**Files:**
- Create: `packages/cli/src/contract/evaluate.ts`
- Test: `packages/cli/src/contract/evaluate.test.ts`（夹具：`packages/cli/src/contract/__fixtures__/order-contract.ts`）

**Interfaces:**
- Consumes: `packages/cli/src/build.ts` 的 esbuild 链路模式（`runtimeStubPlugin`/`dynamicImportStubPlugin` 参照物，不直接复用其 stub 内容）。
- Produces: `evaluateContract(contractFile: string, projectRoot: string): Promise<Record<string, ApiDefinitionInput | unknown>>`——bundle 后真 import()，返回模块全部具名导出（`defineApi` 产物 + zod schema 导出）。stub 插件把 `@react-antd-module/contract` 解析为**真实现**（packages: external 时直接命中 node_modules 即可，需 pnpm workspace link）；`@react-antd-module/runtime` 若被契约误 import 则用空壳 stub 并报人话警告。

- [x] **Step 1: 写失败测试** — 夹具契约含 2 个 `defineApi` + 1 个 zod schema 导出；断言 evaluate 返回对象含端点描述符（`.route === "/item/{id}"`）且 schema 导出是 zod 实例（`._zod` 存在）。
- [x] **Step 2: 跑测试确认失败**（模块不存在）。
- [x] **Step 3: 实现** — esbuild bundle（format esm / platform node / jsx automatic / `.json` loader），`@react-antd-module/contract` 保持 external（Node 直解），写 `.ram-tmp-` 临时目录（复用 build.ts 的落盘理由注释），import() 后清理目录。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): 契约求值链路（esbuild bundle + 真 import，ac-d13）`

### Task 2.2：IR 构建 + schema 白名单（AC-D12）

**Files:**
- Create: `packages/cli/src/contract/ir.ts`
- Test: `packages/cli/src/contract/ir.test.ts`

**Interfaces:**
- Consumes: Task 2.1 的 `evaluateContract` 返回。
- Produces:

```ts
export interface IrEndpoint {
	name: string                  // 导出名，如 "getOrderDetail"
	apiPrefix: string             // "/order"
	route: string                 // "/item/{id}"
	method: "GET" | "POST" | ...  // 缺省已归一为 "GET"
	fullPath: string              // apiPrefix + route，如 "/order/item/{id}"
	paramNames: string[]          // ["id"]；catch-all 段名去 *
	querySchema/bodySchema/paramsSchema/dataSchema?: ZodType  // 运行时对象（发射器再内省）
	raw: boolean                  // response === "raw"
	description?: string
}
export function buildIr(exports: Record<string, unknown>): IrEndpoint[];
```

白名单：`object/array/enum/literal/union/optional/nullable/default/string/number/boolean/date`；拒绝 `transform/refine/preprocess/pipe/coerce/lazy/custom/template_literal`——遍历时读 zod v4 的 `schema._zod.def.type`。

- [x] **Step 1: 写失败测试**（数据表格驱动）：

```ts
it.each([
	["transform", z.string().transform(s => s.length)],
	["refine", z.string().refine(s => s.length > 0)],
	["coerce", z.coerce.number()],
	["lazy", z.lazy(() => z.string())],
	["pipe", z.string().pipe(z.number())],
])("拒绝非白名单 schema：%s", (_label, bad) => {
	expect(() => buildIr({ ep: defineApi({ apiPrefix: "/o", route: "/x", data: bad }) }))
		.toThrowError(/白名单/);
});
it("嵌套白名单 schema 通过并归一 method 缺省", () => { /* object+array+enum+optional+default → 1 端点，method "GET"，fullPath "/order/list"，paramNames [] */ });
it("参数段名提取：/item/{id} → [id]，/file/{*path} → [path]", () => { /* ... */ });
it("同 (目录, method) 冲突报错", () => { /* route "/item/{id}" 与 "/item/{name}" 同 GET → throw */ });
```

- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现** — 遍历导出收集 `defineApi` 产物（duck-typing：有 `apiPrefix`+`route` 即端点）；递归白名单校验（错误文案含端点名 + 字段路径 + 被拒绝的 def.type）；route 切分算法（静态前缀段→目录，首个参数段起→`.route` 尾巴）实现为 `splitRoute(route): { dir: string, routeTail: string }` 同文件导出（Task 2.6/3.2 复用）。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): 契约 ir 构建 + schema 白名单 + route 切分算法（ac-d12）`

### Task 2.3：schema → TS 源码发射器

**Files:**
- Create: `packages/cli/src/contract/emit-schema.ts`
- Test: `packages/cli/src/contract/emit-schema.test.ts`（快照）

**Interfaces:**
- Consumes: Task 2.2 的 `IrEndpoint`（其 schema 运行时对象）。
- Produces: `emitSchemaSource(schema: ZodType): string`——把 zod 运行时对象反向发射为 `z.object({...})` 源码文本（读 `_zod.def`：object→`shape` 递归；string/number→带 `.min()/.max()/.int()/.regex()` 等 checks 从 `def.checks` 还原；enum→`z.enum([...])`；optional/default→包裹）。白名单外不可能到达（2.2 已拦）。

- [x] **Step 1: 写失败测试** — 快照：`z.object({ id: z.number().int(), name: z.string().max(10), tags: z.array(z.string()).optional(), status: z.enum(["open","closed"]).default("open") })` → 断言发射文本 `expect(src).toMatchSnapshot()`，且 `eval` 级等价：把发射文本交给 evaluate 再 safeParse 同一数据，两端结果一致（往返保真）。
- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现**（递归下降，每 def.type 一个 case）。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): schema 源码发射器（白名单内往返保真）`

### Task 2.4：client.ts + client.schemas.ts 发射器（AC-D5/D6/D8/D15）

**Files:**
- Create: `packages/cli/src/contract/emit-client.ts`
- Test: `packages/cli/src/contract/emit-client.test.ts`（快照 + 生成物行为测试：把生成文本写入临时文件，经 esbuild 打包后 import，对 stub request 跑通成功/失败/raw 三路径）

**Interfaces:**
- Consumes: Task 2.2 IR、Task 2.3 `emitSchemaSource`。
- Produces: `emitClient(ir: IrEndpoint[], opts: { target: "module" | "internal" }): { "client.ts": string, "client.schemas.ts": string }`。
  生成物约定（模板要点，快照锁定全文）：
  - `client.ts`：头部 `/* eslint-disable */` + 「生成物勿手改」注释；`import { ContractApiError } from "@react-antd-module/contract"`、`import type { ScopedRequestLike } from "@react-antd-module/contract"`；
  - holder：`let req: ScopedRequestLike | undefined; export function bindRequest(r: ScopedRequestLike) { req = r; }`（`target:"internal"` 时不生成 holder，直接 `import { request } from "@react-antd-module/runtime"` 赋值）；
  - 每端点生成 `export async function fetchOrderList(query: {...}): Promise<{...}>`——URL 模板拼接（paramNames 插值 + `String()` 序列化）、query 走 `searchParams`、body 走 `json`；
  - 信封解包内联：`const env = await res.json<{ code: number, msg?: string, data: T }>(); return env.data;`；失败通道按设计 §6.2 归一：ky HTTPError 错误体为信封时解出 code/msg 抛 `ContractApiError`，2xx 但 code≠0 同归一（评审 F13 补齐），契约违例与原错误透传；
  - dev 校验：`if (import.meta.env.DEV) { const { schemas } = await import("./client.schemas"); const r = schemas.getOrderList.data.safeParse(env.data); if (!r.success) throw new ContractApiError(-1, \`[契约违例] getOrderList: 字段 ...\`); }`（字段路径取 `issue.path.join(".")`，只拼稳定部分）；
  - `raw: true` 端点：生成函数返回 `req.get(url)` 的原样 `Response` promise（不解包不校验）；
  - `client.schemas.ts`：`import { z } from "@react-antd-module/runtime";` + 各端点 schema 常量（Task 2.3 发射）+ `export const schemas = {...}`。

- [x] **Step 1: 写失败测试** — 快照测试两产物；行为测试：stub `ScopedRequestLike` 返回 `{code:0,msg:"ok",data:{id:1}}`→断言 typed 返回；stub 返回不符 schema 的 data（dev 下）→断言抛 `ContractApiError` 且 message 含端点名；`bindRequest` 未调用时调用 fetch →人话报错「未 bindRequest」。
- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现发射器**（字符串模板 + Prettier 无——本仓 ESLint only，模板直接按 tabs/双引号风格写死）。
- [x] **Step 4: 跑测试确认通过 + 生产剔除验证**：把生成物经 vite build 模式打 prod bundle，断言产物文本不含 `"client.schemas"` chunk 内容（B15 测试模式参照 `packages/runtime` 既有 fake-prod 断言写法）。
- [x] **Step 5: Commit** — `feat(cli): client 生成器（bindrequest holder + 信封解包 + dev 校验，ac-d5/d8/d15）`

### Task 2.5：routes.json + openapi.yaml 发射器（AC-D1/D9）

**Files:**
- Create: `packages/cli/src/contract/emit-meta.ts`
- Test: `packages/cli/src/contract/emit-meta.test.ts`

**Interfaces:**
- Consumes: Task 2.2 IR。
- Produces:
  - `emitRoutesJson(ir): string`——`[{ "method": "GET", "pattern": "order/item/{id}" }]`（规范化：去 apiPrefix 首斜杠、不含 base、含模块段，按 method+pattern 排序保证字节稳定）；
  - `emitOpenapiYaml(ir): string`——每端点 `z.toJSONSchema(dataSchema)` 等 → OpenAPI 3.1 document（paths 键 = fullPath，`/{id}` 参数段转 OpenAPI parameters），yaml 序列化用 `yaml` 包（cli 新增 dependency）。

- [x] **Step 1: 写失败测试** — routes.json 文本快照（含排序稳定性：同输入两次发射字节一致）；openapi 快照 + `z.toJSONSchema` 输出结构断言（`doc.openapi === "3.1.0"`，path 参数在 `parameters` 内）。
- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现**。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): routes.json 与 openapi 3.1 发射器（ac-d1/d9）`

### Task 2.6：handler stub 发射器 + 指纹幂等（AC-D10，§9.1）

**Files:**
- Create: `packages/cli/src/contract/emit-stub.ts`
- Test: `packages/cli/src/contract/emit-stub.test.ts`

**Interfaces:**
- Consumes: Task 2.2 IR（`splitRoute`）。注：示例值生成两处**有意不收敛**（评审 F22 确认）——本 Task 产代码模板文本（`exampleSourceFromSchema`），Task 4.2 产 JSON 值（faker），签名与语义不同，共享反而是错配。
- Produces: `planStubWrites(ir, opts: { apiSrcDir: string }): StubWrite[]`（纯函数，返回计划不写盘）+ `applyStubWrites(writes, fs)`；`StubWrite = { filePath: string, content: string, action: "create" | "update" | "skip", reason?: string }`。
  - 指纹：`// ram-api:stub <端点名> sha256:<hash>`，hash = 内容去指纹行 + LF 归一 + 行尾空白剔除后的 sha256；**内容先过 eslint --fix 同款规则再算 hash**（直接调用本仓 ESLint Node API 对文本 fix）。
  - stub 模板：`export default { async get() { json.ok(<示例值>); } }`，有 `.route` 尾巴时 `get.route = "{id}";`（语句起始标准赋值写法）；方法名映射 DELETE→`del`。

- [x] **Step 1: 写失败测试**（表格驱动 §9.1 五场景）：

```ts
it("handler 不存在 → action create", ...);
it("重跑契约未变 → 全部 skip，零写入", ...);
it("指纹匹配的 stub 随契约变更 → action update", ...);
it("指纹不匹配（人已编辑）→ skip 且 reason 提示走 --check", ...);
it("DELETE 端点 → 方法名 del", ...);
```

- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现**。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): handler stub 生成器 + 指纹幂等（ac-d10）`

- [x] **Phase 2 小结**：更新 checkbox；文末追加小结。

> **Phase 2 小结（2026-09-03 完成）**：codegen 核心六个发射器全部落地，commits 见 `git log --oneline feat/ram`（2.1 契约求值 → 2.6 stub 幂等）。
>
> **关键过程**：
> - 2.1 evaluate：esbuild bundle → `.ram-tmp-` 真 import；contract 包 external 走真实实现，runtime 用空桩 + console.warn 挡住「契约文件误引浏览器代码」。
> - 2.2 IR：`API_DEF` Symbol.for 品牌（非枚举，跨实例稳定）识别端点；白名单递归校验报错含端点名 + 字段路径；`splitRoute` 静态前缀→目录/首个参数段起→`.route` 尾巴，stub 生成与 --check 对账共用同一实现。
> - 2.3 schema 发射：白名单内往返保真（发射文本重建后与原始 schema safeParse 结果一致）为硬断言；zod v4 惰性 default 求值行为实测后按「求值结果发射」定案。
> - 2.4 client 发射：bindRequest 能力持有者（零新增 runtime 导出）；行为测试把生成物落盘 → esbuild bundle（runtime 打桩仅出 z）→ 真 import 跑 stub request，覆盖成功/业务错误归一 ContractApiError/dev 契约违例/raw 通道/**产物 zod 排除**（DEV=false 时 client.schemas chunk 整体消失，AC-D15 实证）。
> - 2.5 meta 发射：routes.json 按 oj routes.js 规范化 + method+pattern 排序字节稳定；openapi.yaml 走 z.toJSONSchema——实测 `z.date()` 不可转 JSON Schema，发射前递归降级为 datetime string（线上本就是 ISO 串）。
> - 2.6 stub 发射：同目录多端点归并一个 api.ts（oj 一文件一方法一 handler）；指纹 = 去指纹行 + LF/行尾空白归一后 sha256，**先过 ESLint fix 再算哈希**防 lint-staged 重排静默失配；人编辑过的文件永不写永不删。
>
> **测试规模**：六个测试文件 50+ 用例全绿；typecheck/lint 零 error。耗时约半个工作日（含 zod v4 内部结构探测）。
>
> **已知问题记录**：① raw 端点无 params schema 时槽位由 route 参数段推导（实现期发现，原设计按 schema 定槽位会让 URL 插值悬空）；② oj stub 的 `json.ok()` 无参写法合法（无 data schema 端点）；③ 测试文件放根 `tests/`（vitest 只收 `tests/**`，与计划写的同包 colocate 不符，已在执行期纠正）；④ 全量 `pnpm test` 高负载下 playground e2e 偶发超时 flake（单跑全绿，复跑消失）；uni-dev-smoke 2 例失败为基线既有环境问题（oj 二进制缺失，CI 跳过），与本阶段无关。

---

## Phase 3：ram api 命令 + --check + watch（AC-D7/D10）

### Task 3.1：`ram api` 命令

**Files:**
- Create: `packages/cli/src/contract/run.ts`（编排：discover → evaluate → IR → 发射 → 写盘）
- Modify: `packages/cli/src/index.ts`（注册 `api` 子命令；usage 文案）
- Test: `packages/cli/src/contract/run.test.ts`（tmp 工程夹具端到端：写 contract.ts → 跑 runApi → 断言四产物落盘内容）

**Interfaces:**
- Consumes: Phase 2 全部发射器。
- Produces: `runApi(opts: { cwd: string, check?: boolean, docs?: boolean }): Promise<RunResult>`；CLI `ram api [--check] [--docs]`。发现 glob：`api/src/*/contract.ts`（uni-dev）+ `modules/src/*/api/contract.ts`（纯前端），两档可配置（`ram.config` 或 CLI flag `--contracts`，缺省两档并扫）。
  - 写盘目标：uni-dev → `client.ts`/`client.schemas.ts` 写到**对应前端模块** `modules/src/<同名模块>/api/`（模块名 = apiPrefix 去首斜杠，AC-D9 字面相等）；纯前端 → 契约同目录。`routes.json`/`openapi.yaml` 写契约同目录。
  - 幂等：内容无变化不写盘（读旧比对），`RunResult` 报告 written/skipped 清单。

- [x] **Step 1: 写失败测试**（端到端夹具，断言四产物路径与关键内容、二次运行零写入）。
- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现**。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): ram api 命令（发现 + 全产物生成，幂等写盘）`

### Task 3.2：`ram api --check` 三重校验

**Files:**
- Create: `packages/cli/src/contract/check.ts`
- Test: `packages/cli/src/contract/check.test.ts`

**Interfaces:**
- Produces: `checkApi(opts): Promise<CheckViolation[]>`（非零退出码由 CLI 层据 violations 决定）。三重：
  1. 生成物同步：内存重生成 vs 磁盘逐字节 diff；
  2. route 双向对账：AST 扫描（`typescript` compiler API，cli 已有 typescript 依赖）`api/src/**/api.ts`——default export 对象的方法名 + 语句起始 `.route = "..."` 赋值；与契约路由表 diff（未实现 warn / 未登记 error / 参数段不一致 error）；
  3. routes.js diff：存在 `api/dist/**/routes.js` 时与 routes.json 规范化比对（无则 skip 并提示先 `oj build`）。

- [x] **Step 1: 写失败测试**（三类违规各一条夹具 + 全通过夹具 + warn/error 分级断言）。
- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现**。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): ram api --check 三重校验（生成物同步 + route 对账 + routes.js diff）`

### Task 3.3：ram dev watch 集成

**Files:**
- Modify: `packages/cli/src/dev.ts`（新增 `api/src/**/contract.ts` watch 目标 + 去抖合并；契约变更 → runApi → client.ts 落 modules 树 → 触发既有重建 + SSE）
- Test: `packages/cli/src/dev.test.ts`（或集成测试：改夹具契约 → 断言 runApi 被触发一次（去抖）且模块重建排队）

- [x] **Step 1: 写失败测试**。
- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现**（去抖 100ms 合并连续变更；watch 失败不崩 dev server，打 `[ram-api]` 前缀人话错误）。
- [x] **Step 4: 跑测试确认通过 + `pnpm dev`（playground）手动冒烟**。
- [x] **Step 5: Commit** — `feat(cli): ram dev watch 契约文件（去抖合并两轮构建）`

- [x] **Phase 3 小结**：更新 checkbox；文末追加小结。

> **Phase 3 小结（2026-09-03 完成）**：`ram api` 命令 + `--check` 三重校验 + dev watch 集成落地。
>
> **关键过程**：
> - 3.1 run.ts：discover（api/src/*/contract.ts + modules/src/*/api/contract.ts 两档并扫）→ evaluate → IR → 四产物幂等写盘（读旧比对零写入）；uni-dev client 落 `modules/src/<同名模块>/api/`，AC-D9 字面相等约束运行期强校验。
> - **生产级 bug 实跑暴露**：contract 微包相对导入缺 `.ts` 扩展名，经 node_modules 原生 Node ESM 解析即崩（此前测试经 vite-node 变换掩盖）；相对导入全部补 `.ts`，tsconfig 开 `allowImportingTsExtensions`——此修复对 oj 侧原生加载同样必要。
> - 3.2 check.ts：①生成物内存重生成 vs 磁盘逐字节（含 stub 待更新）②typescript compiler API 扫 oj api.ts（default 导出方法名 + 语句起始 `.route` 字面量，与 oj build 同口径）双向对账：未实现 warn / 未登记 error / 参数段不一致 error ③routes.js 正则解析 vs routes.json 集合差；无 dist 降级为 hint 不判违规。check 永不修文件。
> - 3.3 watch：`createContractRegen`（去抖 + running/pending 不丢变更 + 错误收敛 onError 不崩 dev）；dev.ts 双 watch 目标（模块树 contract.ts + api/src），产物落模块树后复用既有模块 watch 触发重建 + SSE，不新造通知链。
>
> **测试规模**：新增 3 个测试文件 13 用例；cli 全套 170 用例绿。耗时约 2 小时。
>
> **已知问题记录**：⑤ `pnpm dev`（playground）手动冒烟未执行（需起真服务器，留 Phase 6 集中回归一并跑）；⑥ 模块树内 contract.ts 变更会先触发一次旧 client 的重建、regen 落盘后再触发二次重建（两轮构建，去抖后影响可忽略，设计已认）。

---

## Phase 4：runtime re-export z + 契约 mock + 文档站

### Task 4.1：runtime re-export `z`（AC-D15）

**Files:**
- Modify: `packages/runtime/package.json`（dependencies + `zod: ^4`）、runtime 入口 re-export、P3 drift-prevention 测试白名单
- Modify: `packages/cli/src/shared-deps.ts`（zod 版本矩阵说明——zod 不进 importmap，随 runtime dist 走；versions.json 生成逻辑核对）
- Rebuild: `packages/runtime/dist` + `packages/shell/dist`（仓规：runtime 改动必须重建提交）
- Test: drift-prevention 测试更新 + 生产 bundle 不含 zod 全量的断言（`pnpm build` 后 grep 产物，zod 只应出现在 DEV 分支可及处——实际验证 tree-shake 结果并记录）

- [x] **Step 1: 改 drift 测试白名单预期为含 `z`（先失败）**。
- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现 re-export + 依赖**。
- [x] **Step 4: 测试 + typecheck + 重建 dist**。
- [x] **Step 5: Commit** — `feat(runtime): re-export zod（ac-d15，p3 出口变更流程）`

### Task 4.2：纯前端契约 mock（AC-D14）

**Files:**
- Create: `packages/cli/src/contract/mock.ts`（`exampleFromSchema(schema, faker)` 语义标注启发式：string format email/url/date 命中 faker 对应器，enum 取首值，number 取 min 或 1）+ 段级 matcher（字面段 > 参数段 > catch-all）
- Modify: `packages/cli/src/dev-mock.ts:53` 附近（契约路由表并入匹配链：手写 mock 精确匹配优先，契约 pattern 兜底）
- Test: `packages/cli/src/contract/mock.test.ts`（matcher 特异性排序表 + 示例值生成快照 + 手写优先断言）

- [x] **Step 1: 写失败测试**。
- [x] **Step 2: 跑测试确认失败**。
- [x] **Step 3: 实现**。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): 契约驱动 mock（段级 matcher + faker 示例值，手写优先）`

### Task 4.3：`ram api docs`（R5）

**Files:**
- Modify: `packages/cli/src/contract/run.ts`（`--docs` 分支：聚合 openapi.yaml → redoc CLI 起静态页/产出 html）
- Test: 断言 redoc 产物 html 存在且含端点路径（spawn redoc build，tmp 目录）。

**Interfaces:**
- Consumes: Task 2.5 `emitOpenapiYaml`、Task 3.1 `runApi`。
- Produces: `ram api --docs`——聚合全部契约的 openapi 文档 → `redocly build-docs`（或 redoc CLI）产出 `api/docs/index.html`（纯前端形态落工程根 `docs/api/`）。

- [x] **Step 1: 写失败测试**

```ts
it("redoc 产物包含契约端点路径", async () => {
	await runApi({ cwd: fixtureDir, docs: true });
	const html = await fs.readFile(path.join(fixtureDir, "api/docs/index.html"), "utf8");
	expect(html).toContain("/order/item/{id}");
});
```

- [x] **Step 2: 跑测试确认失败**（`--docs` 分支不存在）。
- [x] **Step 3: 实现** —— `runApi` 增 `docs` 分支：聚合 yaml 落临时文件 → spawn redoc build → 产物落盘；redoc 缺失时人话报错（提示 pnpm install 状态）。
- [x] **Step 4: 跑测试确认通过**。
- [x] **Step 5: Commit** — `feat(cli): ram api docs（redoc 渲染聚合 openapi）`

- [x] **Phase 4 小结**：更新 checkbox；文末追加小结。

> **Phase 4 小结（2026-09-03 完成）**：runtime re-export z + 契约 mock + 文档站。
>
> **关键过程**：
> - 4.1 re-export z：P3 出口变更流程实证——`runtime-exports` 白名单测试先红后绿，cli build 的 RUNTIME_STUB_SOURCE 被防漂移测试强制同步补 `z`；vite.config external 白名单放行 `zod`（打进 runtime dist，不进 importmap，产物零 zod 裸导入实测验证）；runtime+shell dist 按仓规重建提交。
> - 4.2 契约 mock：`mock.ts` 段级 matcher（字面 100 分 > 参数 10 分 > catch-all 最末，零新依赖）+ faker 语义示例值（seed 可复现）；`resolveMock` 收敛「手写精确匹配优先、契约 pattern 兜底」选择序，dev.ts 一行换接。emit-stub 保留文本版示例生成（代码模板需未引号键名，与值版 JSON 形态不同——有意不收敛，避免互相迁就）。
> - 4.3 文档站：`runApiDocs` 聚合各契约 paths（operation 打模块 tag，撞车人话报错）→ redocly build-docs（js bin 经 createRequire 解析，缺失/失败人话）；uni-dev 落 `api/docs/`、纯前端落 `docs/api/`，聚合 `openapi.yaml` 同盘供评审直读。真实 redoc 构建进测试（2 例 120s 超时预算）。
>
> **测试规模**：新增 17 用例；cli 全套 187 用例绿。耗时约 1.5 小时（含 runtime/shell dist 重建）。
>
> **已知问题记录**：⑦ faker 示例值非跨版本稳定（seed 只保同版本复现）——测试只断言形态不断言字面值，已规避；⑧ redoc 首次构建冷启动 ~10s（测试超时预算已留），产物为单文件 html 无外部依赖。

---

## Phase 5：试点迁移 + 手册

### Task 5.1：runtime 内部 system/role 契约试点（内部目标）

**Files:**
- Create: `packages/runtime/src/api/system/role/contract.ts`（内部契约，`target:"internal"`）
- Modify: `packages/runtime/src/api/system/role/index.ts`（手写 fetch* 替换为生成 client re-export，保持导出名不变——消费方零改动）
- Test: Task 0.3 建的 role 测试改为对生成物跑（行为不变应全绿）。

- [x] **Step 1: 跑 Task 0.3 的 role 测试确认基线绿** — `pnpm vitest run packages/runtime/src/api/system/role`。
- [x] **Step 2: 写契约** — `packages/runtime/src/api/system/role/contract.ts` 覆盖 6 个端点（role-list/role-item POST/PUT/DELETE/role-menu/menu-by-role-id），`data` schema 按 fake 实际响应建模。
- [x] **Step 3: 生成并替换** — `ram api`（`target:"internal"`）产物落 `packages/runtime/src/api/system/role/api/`；`index.ts` 改为 `export { fetchRoleList, ... } from "./api/client"; export * from "./types";`，导出名与签名保持不变。
- [x] **Step 4: 测试仍绿 + typecheck**（重构零行为差；modules/system 页面零改动即证明接口兼容）。
- [x] **Step 5: Commit** — `refactor(runtime): system/role 迁移契约制试点（内部目标）`

### Task 5.2：playground demo 模块契约试点（模块目标）

**Files:**
- Create: `apps/playground/modules/src/demo/api/contract.ts` + 生成物；`entry.ts` `onInit` 加 `bindRequest(ctx.utils.request)`
- Modify: demo 页面改用生成 client
- Test: playground 现有测试 + 手动冒烟（`pnpm dev` → demo 页列表渲染；改契约字段 → dev 页面报契约违例红条）。

- [x] **Step 1: 写 demo 契约** — 覆盖 demo 页实际调用的端点；`entry.ts` 的 `onInit` 增加：
```ts
import { bindRequest } from "./api/client";
// onInit 内：
ctx.register.apiPrefix("/demo");
bindRequest(ctx.utils.request);
```
- [x] **Step 2: 跑 `ram api` 生成产物**（`modules/src/demo/api/client.ts` + `client.schemas.ts`），demo 页面改为 import 生成 client。
- [x] **Step 3: playground 测试 + 手动冒烟** — `pnpm dev`（playground）：demo 页列表渲染正常；临时把契约某字段类型改错 → 页面报「契约违例」人话红条（dev 校验生效）→ 改回。
- [x] **Step 4: `ram api --check` 在 playground 零违规**。
- [x] **Step 5: Commit** — `feat(playground): demo 模块接入契约机制（bindrequest holder）`

### Task 5.3：手册更新

**Files:**
- Modify: `docs/prd/module-development-guide.md`（§3.3 依赖表加 `@react-antd-module/contract`；新增「3.7 API 契约」节：契约写法、bindRequest、ram api 命令、--check 门禁、常见问题三条）
- Modify: `docs/prd/202609011520-uni-dev-manual.md`（工程布局图加 contract.ts/routes.json；§4 ram dev 加契约 watch 行为说明）

- [x] **Step 1: 写文档 → Step 2: Commit** — `docs(prd): 手册接入 api 契约机制（模块手册 §3.7 + uni-dev 布局）`

- [x] **Phase 5 小结**：更新 checkbox；文末追加小结。

> **Phase 5 小结**：Task 5.1（runtime internal 试点）、5.2（playground 模块试点，Step 3 手动冒烟顺延 Phase 6）、5.3（手册）完成。runtime role 模块 6 端点全部契约化，消费方（modules/system 角色页）仅一处类型随契约修正（menus: string[]→number[]，线协议真相），其余零改动；playground demo 页以契约驱动 mock 兜底跑通「无后端先写页」闭环。
>
> **试点暴露并修复的四处真实裂缝**（均为单测/快照盲区，首次真实消费才现形）：
> ⑨ ScopedRequestLike.searchParams 过宽（Record<string, unknown>）导致真 ky 实例无法赋给接口——收窄为 ky 兼容形态；⑩ importmap 未覆盖 @react-antd-module/contract（internal 生成物首个运行期裸导入）——纳入 SHARED_DEPS 硬共享 + runtime peerDependencies，shell 资产 67 项校验通过；⑪ 旧手写 client 的 ignoreLoading 行为在生成物中丢失——契约 DSL 增 ignoreLoading 开关透传；⑫ 模块工程 typecheck 缺 import.meta.env 类型与 allowImportingTsExtensions——playground 补 typings.d.ts + tsconfig，已写入手册 §3.7 常见问题。
>
> **测试规模**：emit-client 新增 2 用例（internal z 来源 / ignoreLoading 透传）；两处产物级实证（runtime dist 与 playground demo 产物均无 client.schemas 引用、DEV 校验分支消除）。耗时约 1 小时。

---

## Phase 6：集中评审 + 回归

### Task 6.1：全量回归

- [x] `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm check:circular-deps` 全绿；
- [x] playground e2e（现有布局 e2e 基线 `docs/prd/202608311543-layout-e2e-baseline-design.md` 对应套件）通过；
- [x] 生产 bundle 断言：无 zod schema 泄漏、无 fake 代码（B15）；
- [x] `ram api --check` 在主仓与 playground 各跑一遍零违规。

### Task 6.2：集中评审 + 修复闭环

- [x] 邀架构/开发双角色评审实现（评审输入：本计划 + 设计文档 + `git diff feat/ram...feat/api-contract`）；
- [x] 评审报告落盘 `docs/prd/<日期>-api-contract-review-report.md`；findings 分类处置（blocker/major 必修，minor 评估），修复提交后复跑 Task 6.1 回归；
- [x] 设计文档与计划文末追加总结段（关键过程与耗时）；合并回 `feat/ram` 前的 commit 序列整理。

- [x] **Phase 6 小结**：文末追加小结 + 全文总结段。

---

## 阶段小结

> 每阶段完成后在此追加：关键过程、偏差与原因、耗时。

### Phase 1：contract 微包（AC-D11）——已完成（2026-09-03，约 15 分钟）

- 完成：`packages/contract`（@react-antd-module/contract）——defineApi
  定义期校验（首斜杠/../穿越/matchit 参数段混字面/data 与 raw 互斥）、
  ContractApiError、ScopedRequestLike 最小结构类型、zod v4 re-export；
  zod 入 pnpm catalog 同源定版（contract/runtime/cli 三处共用）。
- 偏差：无实质偏差；测试落 tests/contract/（沿用 Phase 0 发现的仓规）。
  微包不加构建步骤，exports 直指 src（同 packages/cli 模式）。
- 验证：10 条单测全过；typecheck/lint 干净。

### Phase 0：信封统一（AC-D16）——已完成（2026-09-03，约 40 分钟）

- 完成：error-response 改读 oj `msg`（存量 bug 顺带修复）；api/user 删
  normalize/mapAuth，fetch* 直返 data；全局类型 `ApiResponse/ApiListResponse`
  → `OjEnvelope/ListData`；runtime api 层（home/notifications/system）经新增
  `unwrap` 助手直返 data；fake 统一 `ojOk` 助手且 auth 载荷改 snake_case 线
  格式；页面/组件 `.result` 消费面全量迁移（role/menu/home/notification/
  avatar）；playground mock 改 oj 信封；ram dev mock 按信封 code 置 HTTP
  状态（`mockStatusCode`，含单测）；login 模块 authProvider 同步适配。
- 偏差记录：
  1. 仓规 vitest 只收 `tests/**`（不收包内 co-located 测试）——计划中的
     测试全部落 `tests/`，且发现已有 `tests/runtime/error-response.test.ts`
     同主题文件，合并去重（删了计划外的新建重复文件）。
  2. 存量测试三处编码了旧 D10 信封行为（api-oj-contract/auth-login-failure/
     auth-provider），按 AC-D16 语义重写而非删除，F12 防回归意图保留。
  3. `tests/integration/uni-dev-smoke.test.ts` 2 条失败为**基线既有**
     （feat/ram 上同样挂，oj 真二进制环境 404），CI 本就跳过，与本阶段无关。
  4. `line-chart.tsx` 旧类型误标 `string[]`（fake 实际发 number[]），借机
     对齐线格式。
  5. 反常规记录：初版测试因 mock 未在用例间清理出现「假失败/假通过」，
     `beforeEach(clearAllMocks)` 后恢复判定力——BDD 用例必须隔离断言。
- 验证：typecheck 零错误；单测 368 通过（仅上述 2 条环境性集成失败）；
  lint 0 error。

### Phase 5：试点迁移 + 手册——已完成（2026-09-03，约 1 小时）

- 完成：runtime system/role 六端点契约化（internal 目标，消费方零改动）；
  playground demo 模块接入（契约驱动 mock 兜底跑通「无后端先写页」）；
  模块手册 §3.7 + uni-dev 手册命令表/布局图/watch 说明。
- 试点裂缝 ⑨-⑬（详见 Phase 5 节内小结）：ky 类型兼容、importmap 覆盖、
  ignoreLoading 透传、模块工程 tsconfig 前提、生成物 lint 重排版误报——
  全部是首次真实消费才现形的形态问题，为 Phase 6 评审提供了实证素材。

### Phase 6：集中评审 + 回归——已完成（2026-09-03，约 2.5 小时）

- 回归（Task 6.1）：typecheck / lint / 464 单测 / 根+playground 构建 /
  circular-deps / e2e 23/23 / 双仓 `ram api --check` 全绿；产物断言无
  fake 代码（B15）、无 client.schemas 泄漏；demo 契约 mock curl 冒烟通过。
- 评审（Task 6.2）：架构/开发双角色独立评审（报告落盘
  `202609031526-api-contract-review-report.md`）——25 条 findings 归并，
  无 blocker；8 条 major 全修（F1-F8），minor 顺手修 6 条（F9-F14），
  演进点 6 条记录在案（F15-F20）。
- 评审揭示的共性问题：**「机制核心承诺（dev 校验 + 契约 mock 反馈环）
  在单测里全绿、在真实联用路径上失效」**——date 语义三链互斥、mock
  自违例、mock 不热载三条互相咬合，只有真起 dev server 才现形。教训已
  固化：F25（生成物 tsc 兜底）+ F1 端到端断言（mock 值过生成 schema）
  + dev 冒烟脚本化。
- 偏差：主仓 `ram api --check` 不适用（无可发现契约）——以
  `role-contract-freshness.test.ts` 补门禁；oj-process / uni-dev-smoke
  的环境性 flake 与基线一致，非本分支引入。

## 全文总结

契约机制（ram api）七阶段全部闭环。最终形态：zod 契约为单一事实源
（`@react-antd-module/contract`），`ram api` 幂等生成强类型 client /
OpenAPI / routes.json / handler stub，`--check` 三重对账（生成物同步 +
route 双向 + routes.js），`ram dev` 契约 watch + 契约驱动 mock 兜底 +
dev 响应违例人话报错，redoc 文档站聚合。前端信封统一 oj 格式（AC-D16）。
两处试点（runtime internal role + playground demo module）验证双目标
生成路径；生产产物实证 zod 零泄漏（模块侧 984B contract-errors 资产 +
DEV 分支消除）。累计耗时约 8 小时（设计+计划 ~2h 在前序会话，
P0-P6 实现约 6h），新增/修改测试约 90 用例。
