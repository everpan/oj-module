# 权威源迁移：基于 openapi.json 重建 `__client` 生成

> **状态（2026-10-15）：已完成并随 0.1.20 落地。** 全部任务（T1–T10）执行完毕，498 项测试全绿；
> framework-verification-playbook 全链路演练通过。两处后续演进：① oj v0.1.72 起出参可声明在
> `.schema` 之外的平级 `.response`（优先级：动词 `.response` > 组 `.response` > 动词 `.schema.response` >
> 组 `.schema.response`），模板与 playground-oj 已迁到新写法、运行期 oj 门槛升到 0.1.73
> （`del`→`delete` 操作键归一）；② handler/`.schema`/`.route` 多文件拆分仍暂缓（oj loader 约束，
> 见 T10 评审）。本文任务清单与「已确认事实」为执行期快照，其中 v0.1.71 相关表述以上述演进为准。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 oj-module 的 `__client` 代码生成从「`contract.ts`(zod) → IR → emit」翻译层，改为消费上游 oj v0.1.71 的 `oj openapi` 产物 `openapi.json`，使 oj handler 上的 `.schema` 成为唯一权威源；退役 `defineApi`/`contract.ts` 翻译层。

**Architecture:** 权威源 = oj handler 上的 `.schema`（手写）。`oj openapi -c config -d dist -b <base> -o openapi.json` 产出 OpenAPI 3.1 规范；ojm 新模块 `openapi-ir.ts` 解析它为 `IrEndpoint[]`（schema 字段改为 JSON Schema 对象），再由新发射器 `emit-jsonschema-zod.ts`（JSON Schema→zod 源码）与重构后的 `emit-client.ts` 产出 `web/<模块>/__client/{api.ts, api.schemas.ts}`。原 `evaluate`/`emit-oj-schema`/`ir(zod builder)`/`emit-schema` 整体下线。

**Tech Stack:** TypeScript / pnpm workspace（oj-module monorepo）；上游 `oj` 二进制 v0.1.71（`oj openapi`）；zod（仅用于生成产物的前端类型/校验）；vitest（TDD）。

**关联：** `docs/prd/202610142350-defineapi-retire-schema-authority-pr.md`；上游文档 `docs/devkit/api-manual.md`「入参与出参契约 `.schema`」+ `docs/devkit/api-manual.md`「表达力边界：与 zod 的对照表」(v0.1.71)；`oj-bin/docs/openapi-guide.md`。

---

## 0. 已确认事实（来自 oj v0.1.71 + openapi-guide.md + 实测产物）

`oj openapi` 产物（OpenAPI 3.1）每个 operation 字段：

- `operationId`：去 base 后的子路径 + 方法派生，非字母数字统一转 `_`。例：`wiki/collections/{id}`+`get` → `wiki_collections__id__get`。
- `tags[0]`：模块名（首段目录，如 `wiki`）。spec 根另有去重排序的全量 `tags`。
- `x-oj-file`：相对 api 根的源码路径（溯源 / check 对账用，非标准字段）。
- `parameters[]`：`in:"path"`（恒 `required:true`）来自 `.schema.params` 或 pattern；`in:"query"` 来自 `.schema.query`。
- `requestBody.content["application/json"].schema`：来自 `.schema.body`。
- `responses["200"]`：
  - 声明了 `response` → `content["application/json"].schema` = 完整信封 `{code:int,msg:string,data:<payload>}`，带 `x-oj-response-enforced:false`；`data` 即返回 payload。
  - 未声明 `response` → `{ "description": "OK" }`（无 content）。
- **路径 key 含 base 前缀**（如 `/v1/api/...`）。
- **组级 `.schema` 已在 oj 内省期合并进 `RouteRow.schema`**，产物已是最终合并态，无需重建组/动词合并。

> 注：`info.title/version` 为固定占位（`oj API`/`0.1.0`），不读项目；前端版本注入不在本计划范围。

## 1. 已拍板决策（采用推荐默认，未收到用户否决）

1. **端点命名**：客户端方法名 = `camelCase(operationId)`（如 `wiki_collections__id__get` → `wikiCollectionsIdGet`）。类型名：`${camelCase(operationId)}Data`（响应 data）、`${camelCase(operationId)}Query`/`Params`/`Body`（入参）。旧的 `contract.ts` 人类命名（如 `fetchNotifications`）在迁移时按「逐字节比对」识别为丢失面，人工确认。
2. **base 前缀处理**：ojm 调用 `oj openapi` 时显式传 `-b <base>`，base 从 config 的 api 挂载 prefix 读取；IR 解析时剥掉该前缀得到模块相对路径。兜底：若无法取得 config，从 `path` 与 `tags[0]` 反推（`base = path.replace(/\/<module>(\/.*)?$/, "")`）。
3. **pattern 跨语言红线**：`.schema` 的 `pattern` 是 **Rust regex**。发射器将其**原样** emit 为 `z.regex(new RegExp(<pattern 经 JSON.stringify>))`，并针对每个 pattern 输出一条 lint 告警注释（`// @oj-warn: pattern 为 Rust regex，前端可能与 oj 侧语义漂移`）。**不做** Rust→ECMA 翻译（避免静默放行导致前端校验被绕过）。
4. **`routes.json` / `openapi.yaml`**：ojm 不再自产这两者。`openapi.json` 由上游 `oj openapi` 产出并替代之。前端若需路由映射，后续从 `openapi.json` 派生（不在本计划范围）。

## 2. 任务分解

### Task 1：新增 `openapi-ir.ts`（openapi.json → IrEndpoint[]）

**Files:**
- Create: `packages/cli/src/contract/openapi-ir.ts`
- Test: `packages/cli/src/contract/__tests__/openapi-ir.test.ts`

**Step 1: 写失败测试** —— 用 §0 实测产物片段（含 params/query/body/response + 无 response 占位）断言：
- `irFromOpenapi(json, { base: "/v1/api" })` 剥前缀得 `/wiki/collections/{id}`；
- `module === "wiki"`，`name === "wikiCollectionsIdGet"`，`method === "GET"`；
- `paramsSchema` 含 `{id:integer}`，`querySchema` 含 `{type:enum[1,2],page:integer}`；
- `bodySchema` 含 `title:string`；
- 有 `x-oj-response-enforced` 时 `dataSchema` 解包到 `data` 子树；无 `response` 时 `dataSchema === undefined`。

**Step 2: 实现 `irFromOpenapi(json, { base })`**
- 遍历 `paths`：`path` 剥 base；`method` 取键；
- `module = tags[0] ?? 首路径段`；
- `name = camelCase(operationId)`；`paramNames` 从 pattern 的 `{x}` 抽取；
- `parameters` 按 `in` 分 `params`/`query`（合并为 `{type:"object",required,properties}`）；
- `bodySchema = requestBody?.content?.["application/json"]?.schema`；
- `dataSchema`：`responses["200"].content?.["application/json"]?.schema?.properties?.data`（仅当存在 `x-oj-response-enforced`）。
- 复用现有 `IrEndpoint` 类型（`packages/cli/src/contract/ir.ts`），schema 字段类型由「活 zod」改为 `JsonSchema`（`export type JsonSchema = Record<string, unknown>` 或细化）。

**Step 3: 跑测试 PASS** → commit。

### Task 2：新增 `emit-jsonschema-zod.ts`（JSON Schema → zod 源码）

**Files:**
- Create: `packages/cli/src/contract/emit-jsonschema-zod.ts`
- Test: `packages/cli/src/contract/__tests__/emit-jsonschema-zod.test.ts`

**Step 1: 写失败测试** —— 输入 §0 白名单子集 JSON Schema（`type/required/properties/items/additionalProperties/minimum/maxLength/pattern/enum/nullable/minItems/default`、类型数组 `["string","null"]`），断言生成 zod 源码：
- `type:"object"+properties` → `z.object({...})`；`required:["a"]` → 字段无 `.optional()`，其余 `.optional()`；
- `additionalProperties:false` → `.strict()`；
- `type:["string","null"]` → `z.string().nullable()`；`nullable:true` → `.nullable()`；
- `pattern` → `z.regex(new RegExp(<JSON.stringify(pat)>))` + `// @oj-warn` 注释；
- `enum` / `default` 元素经 `JSON.stringify` 嵌入；
- `required` 项可能不在 `properties` 中时不抛错（跳过缺失键）。

**Step 2: 实现递归 `emitZod(schema, where): string`**
- 白名单同现 `emit-oj-schema.ts`（`packages/cli/src/contract/emit-oj-schema.ts:19` 的 `ALLOWED_TYPES` / `:35` 的 `ALLOWED_CHECKS`）；表外关键字 fail-fast（报错带路径）。
- 对象键一律 `JSON.stringify(name)` 嵌入（遵守 §2.8 注意 1）。
- `default` 映射 `.default(...)`（仅 zod 侧有意义，oj 不填值）。

**Step 3: 跑测试 PASS** → commit。

### Task 3：重构 `emit-client.ts` 消费 JSON-Schema IR

**Files:**
- Modify: `packages/cli/src/contract/emit-client.ts`（prelude `:224`、端点发射 `:157`、schema 复用 `:305`）
- Test: `packages/cli/src/contract/__tests__/emit-client.test.ts`

**Step 1: 写失败测试** —— 用 Task 1 的 IR 断言产出 `api.ts`：
- `MODULE_PREFIX`/`API_PREFIX` = `/<module>`；`create<Module>Client(ctx)` 注册 `apiPrefix` 并导出 camelCase 方法名；
- 方法体 `client.get(<relPath>).json<OjEnvelope<<name>Data>>()`，信封解包 `env.data`；
- DEV 分支 `import("./api.schemas")` 对 `data` 做 `safeParse`；
- `api.schemas.ts` 含 `<name>Params/Query/Body/Data` 的 zod（委托 Task 2 发射器）。

**Step 2: 改造 `emitClient`** —— IR schema 字段改为 JSON Schema，经 `emit-jsonschema-zod.ts` 产出 `api.schemas.ts`；`api.ts` 端点模板基本复用，`name` 取自 IR（camelCase operationId）。

**Step 3: 跑测试 PASS** → commit。

### Task 4：重构 `run.ts`（`ojm api` 改为 产 + 消费 openapi.json）

**Files:**
- Modify: `packages/cli/src/contract/run.ts`（`discoverContracts` `:45`、`irOf` `:107`、`runOne` `:123`）、`packages/cli/src/index.ts`（`case "api"` `:64`）、`packages/cli/src/args.ts`
- Test: `packages/cli/src/contract/__tests__/run-api.test.ts`

**Step 1: 写失败测试** —— `ojm api [dir]` 默认流程（mock `oj openapi` 调用）：断言先生成 `openapi.json` 再消费生成 `__client`，不再扫 `contract.ts`。

**Step 2: 实现**
- `runApi`：调用 `oj openapi -c <config> -d <dist> -b <base> -o <api-root>/openapi.json`（复用 `packages/cli/src/oj-cmd.ts` 的 passthrough 机制，注入 `-c`）；读 `openapi.json` → `irFromOpenapi` → `emitClient` → 写 `__client/{api.ts,api.schemas.ts}`（`writeIfChanged` 幂等）。
- `discoverContracts` 改为发现 handler 目录（供 stub/check），不再要求 `contract.ts`。

**Step 3: 跑测试 PASS** → commit。

### Task 5：改造 `check.ts` / `emit-stub.ts` 同源 openapi.json

**Files:**
- Modify: `packages/cli/src/contract/check.ts`（`checkApi` `:261`）、`packages/cli/src/contract/emit-stub.ts`（`planStubWrites` `:162`）

**Step 1: 写失败测试** —— `ojm api --check` 断言：`oj openapi --check` 漂移门禁 + `__client` 重生成 diff（artifact-stale）+ handler 表 ⊄/⊋ 生成物端点（route-not-implemented / route-unregistered）。

**Step 2: 实现**
- `checkApi`：`artifact-stale` = `oj openapi --check` 退出码 + ojm 重生成 `__client` 与磁盘 byte-diff；
- `route-not-implemented`：生成物端点 ⊄ `implementedRouteKeys`（`handler-scan.ts:252`）；
- `route-unregistered`：handler 表 ⊄ 生成物端点；
- `emit-stub`：`planStubWrites` 改以 openapi.json 为事实源生成骨架（不再注入 `.schema`，`.schema` 由开发者手写）。

**Step 3: 跑测试 PASS** → commit。

### Task 6：退役翻译层（BREAKING）

**Files:**
- Delete: `packages/cli/src/contract/evaluate.ts`、`emit-oj-schema.ts`、`emit-schema.ts`、`ir.ts`（zod builder 部分；保留 `IrEndpoint` 类型与 `splitRoute`/`wirePrefixOf` 工具，迁移到 `openapi-ir.ts` 或 `ir.ts` 仅留类型）
- Modify: `packages/runtime/package.json`（移除 `./contract` 与 `./contract/errors` 导出）、`packages/runtime/src/contract/*` 删除
- Modify: `packages/cli/src/contract/run.ts`、`check.ts`、`emit-stub.ts` 中移除对翻译层引用
- Test: 出口白名单测试（`packages/runtime/__tests__/*` 中引用 `runtime/contract` 的全部用例改为「导出不存在」断言）

**Step 1: 写测试** —— `import("@oj-module/runtime/contract")` 应解析失败 / 未在 exports 中。

**Step 2: 删除并清理引用**（先确保 Task 1–5 全部接管，无残留引用再删）。

**Step 3: 跑全量测试 PASS** → commit。

### Task 7：迁移命令 `ojm api migrate-to-schema`（TDD）

**Files:**
- Create: `packages/cli/src/contract/migrate.ts`
- Test: `packages/cli/src/contract/__tests__/migrate.test.ts`

**Step 1: 写失败测试** —— 对一份含 `contract.ts` 的示例工程，断言：
1. 旧 IR（evaluate→buildIr）逐端点翻译为 oj `.schema` 写回对应 handler（response 通道同步写入）；
2. `oj openapi` 重生成 `openapi.json` → ojm 据其生成 `__client`，与旧 `contract.ts` 管线产物逐字节比对，差异输出「翻译丢失面」清单；
3. 删 `contract.ts` 后 `ojm api --check` 转新口径通过。

**Step 2: 实现** `migrateToSchema(cwd)`：读 `contract.ts` → 旧 IR → 端点→handler `.schema` 写回（幂等 + dry-run 预览 + 丢失面报告）。

**Step 3: 跑测试 PASS** → commit。

### Task 8：模板与示例工程改造

**Files:**
- Modify: `packages/cli/templates/api/src/notification/contract.ts`、`personal-center/contract.ts` 删除，改为在对应 handler 上写 `.schema`；`packages/cli/templates/web/src/notification/__client/*` 改由 `openapi.json` 生成；删除模板内旧 `openapi.yaml`/`routes.json`。
- Test: 模板 smoke（`oj build` + `ojm api` 跑通产出 `__client`）。

**Step 1: 写失败测试** —— 模板 `ojm api` 跑通且 `__client` 与手写 `.schema` 一致。

**Step 2: 改造模板** —— 把 `contract.ts` 契约搬到 handler `.schema`（含 response 通道）；重生成 `__client` 并核对。

**Step 3: 跑测试 PASS** → commit。

### Task 9：devkit 文档重写

**Files:**
- Modify: `packages/runtime/README.md`（或项目 devkit 文档）契约章节 → 「`.schema` 权威源 + `openapi.json` → `__client`」章节（含场景用例与示例代码）。

**Step 1: 写/改文档**，覆盖：权威源定位、`.schema` 四通道手写、`oj openapi` 产出、`ojm api` 消费生成、`migrate-to-schema` 用法、`pattern` 跨语言红线提示。

**Step 2: commit。**

## 3. check 新口径（对照 PRD §4.3）

| 项 | 实现 |
|---|---|
| `artifact-stale` | `oj openapi --check`（openapi.json 漂移）+ ojm 重生成 `__client` vs 磁盘 diff |
| `route-not-implemented` | 生成物端点 ⊄ handler 表（`handler-scan.ts`） |
| `route-unregistered` | handler 表 ⊄ 生成物端点 |
| `routes-js-drift` | 不变（oj build `routes.js` 对账） |

## 4. 版本策略（PRD §5）

- `0.2.0`：codegen 切换为 `openapi.json` 源 + `migrate-to-schema`（response 通道已就绪，v0.1.70）。
- `0.3.0`：删除 `runtime/contract` 子路径 + 翻译层（原 PRD 排期；因 `oj client` 未落地、codegen 保留在 ojm 本地，但 zod 翻译层整体下线）。

每特性单独 bump（用户指示）。

## 5. 风险与回退（PRD §7 更新）

| 风险 | 缓解 |
|---|---|
| 上游 `oj openapi` 排期/行为漂移 | 已落地 v0.1.71，实测产物稳定；若上游改 shape，仅 `openapi-ir.ts` 适配 |
| 端点重命名（operationId vs 旧人类命名） | 迁移逐字节比对 + 丢失面清单人工确认；或团队约定 `.schema` 路径即最终命名 |
| `pattern` 跨语言语义漂移 | 原样 emit + lint 告警（Task 1/2 决策 3），复杂校验下移到 handler |
| `__client` 生成质量回归 | 迁移时旧/新 client 逐字节比对，100% 归因后再删 `contract.ts` |
| zod 超集表达力（refine/transform/union）DSL 无对应 | §0 对照表 fail-fast + 迁移输出丢失面 |
