# 历史版本迁移指南：contract.ts / defineApi → openapi.json + handler `.schema` + `.response`

> 适用：仍在使用旧「`contract.ts`（defineApi + zod）」流水线的工程，要升级到新流水线
> （oj handler `.schema` 入参 + 平级 `.response` 出参为唯一权威源，`oj openapi` 产出
> `openapi.json`，`ojm api` 消费它生成 `__client`）。
> 关联设计文档：`docs/plans/2026-10-15-schema-authority-openapi-codegen.md`。
> 新口径总览：`docs/guides/api-codegen-openapi.md`。

## 1. 为什么要迁移

| 维度 | 旧流水线（已退役删除） | 新流水线（当前） |
|---|---|---|
| 契约载体 | `api/src/<模块>/contract.ts`（`defineApi` DSL + zod） | oj handler 动词上的 `.schema`（入参，JSON Schema 子集）+ 平级 `.response`（出参，oj v0.1.72+） |
| 翻译过程 | `evaluate` → IR（活 zod）→ `emit`（client / schemas / stub / mock） | `oj openapi` 内省 → `openapi.json`（OpenAPI 3.1）→ `irFromOpenapi` → `emitZodFromJsonSchema` + `emitClient` |
| 权威源 | `contract.ts` 单一文件 | handler `.schema` / `.response`（手写，落点即路由） |
| 文档源 | ojm 自产 `routes.json` / `openapi.yaml` | `openapi.json`（oj 产出，直接聚合） |

旧翻译层（`defineApi` / `contract.ts` / `evaluate` / `emit-oj-schema` / `emit-schema` / 旧 `ir.ts`）**已从 `packages/cli` 删除**，`ojm api` **不再读取** `contract.ts`：工程根找不到 `openapi.json` 时直接报错指引先跑 `oj openapi`。因此旧工程必须迁移，否则 `ojm api` 无法工作。

## 2. 前置条件

- `oj` 二进制 ≥ **0.1.73**（提供 `oj openapi` 子命令，产出 OpenAPI 3.1；平级 `.response` 出参
  声明位自 v0.1.72 起，`del`→`delete` 操作键归一自 v0.1.73 起——含 `del` 端点的工程低于 0.1.73
  时 `oj openapi --check` 必漂移）。
- `@oj-module/cli` / `@oj-module/runtime` 版本：**0.1.20**（锁步；codegen 切换 openapi.json 源
  与翻译层删除均随该版落地）。升级 cli 后重跑 `ojm init` 刷新 devkit。
- 工程 `api/config.yaml` 站点挂载已迁到顶层 `mounts:`（oj v0.1.58+ 要求）。

> 命令与版本若有出入，以 `oj --help` / `ojm info` 实际输出为准，本指南命令均来自对
> `packages/cli/src/contract/*` 当前实现的核对。

## 3. 迁移方法论（逐步）

### 步骤 0：盘点
列出每个 `contract.ts` 的全部 `defineApi` 导出，记录每端点的：模块、route、method、
`params` / `query` / `body` / `data`（response）、`form`（上传）、`ignoreLoading`。

### 步骤 1：把端点落到 handler `.schema`（入参）+ `.response`（出参）
对模块里的 handler `api.ts`，把每个 `defineApi` 的入参**手工翻译**为动词上的 `.schema`
（JSON Schema 严格子集）；旧 `data` 载荷翻成**平级 `.response`**（oj v0.1.72+）。通道对照：

| 旧 `defineApi` 字段 | 新声明位 | 说明 |
|---|---|---|
| `params` | `.schema.params` | 路径参数，与 route 的 `{id}` 段对应 |
| `query` | `.schema.query` | URL query |
| `body` | `.schema.body` | JSON 请求体 |
| `data` | 平级 `.response` | 响应 `data` 载荷（信封 `code/msg/data` 由 oj 自动包裹） |
| `form` | —（见 §5 丢失面） | 文件上传，当前流水线不生成前端 client |
| `ignoreLoading` | — | 透传标记，仍由 `ojm api` 读取（通道未变） |

**旧：**
```ts
// api/src/notification/contract.ts（已删除）
import { defineApi, z } from "@oj-module/runtime/contract";
export const fetchNotifications = defineApi({
	apiPrefix: "/notification",
	route: "/notifications",
	method: "GET",
	query: z.object({ page: z.number(), type: z.enum(["user", "broadcast"]) }),
	data: z.object({ list: z.array(z.object({ id: z.string(), title: z.string() })), total: z.number() }),
});
```

**新：**
```ts
// api/src/notification/api.ts（.schema 手写入参，oj 运行期据此校验入参）
const notifications = {
	async get() {
		// ...业务逻辑
	},
};
notifications.get.schema = {
	query: {
		type: "object",
		required: ["page"],
		properties: {
			page: { type: "number", minimum: 1 },
			type: { type: "string", enum: ["user", "broadcast"] },
		},
	},
};
// 出参走平级 .response（oj v0.1.72+；语义同旧 .schema.response，优先级最高）
notifications.get.response = {
	type: "object",
	properties: {
		list: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } } },
		total: { type: "number" },
	},
};
export default { notifications };
```

JSON Schema 白名单关键字（其余 fail-fast，不静默降级）：
`type / required / properties / items / additionalProperties / minimum / maximum /
minLength / maxLength / pattern / enum / nullable / minItems / maxItems / default`。

### 步骤 2：生成 `openapi.json`
```bash
oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json
```
- `-b` = api 挂载前缀（与 `config.yaml` 的 `mounts[].prefix` 一致）；dev 用 `-d api/src` 内省源码，
  release 改 `-d api/dist` 读 `routes.js`。
- 这是**项目级单文件**，含全部模块；组级 `.schema` 已由 oj 内省期合并，无需重建。

### 步骤 3：生成前端 `__client`
```bash
pnpm exec ojm api          # 消费 openapi.json → web/src/<模块>/__client/{api.ts, api.schemas.ts}
```

### 步骤 4：改前端消费代码（关键差异点）
新流水线**函数名来自 `operationId`**（oj 由「去 base 子路径 + 方法」派生，非字母数字转 `_`），
不再是旧的人类导出名：

| 旧（`defineApi` 导出名） | 新（`camelCase(operationId)`） |
|---|---|
| `fetchNotifications` | `notificationNotificationsGet` |
| `markRead` | `notificationNotificationsReadPost` 之类（取决于 handler 路由/方法） |

类型名同理：`NotificationListData` → `NotificationNotificationsGetData` 等。
逐一替换前端调用点（含 provider 回调里的方法引用，如 `entry.ts` 的 `fetchNotifications: () => client.fetchNotifications()`）。

### 步骤 5：删除 `contract.ts`
确认 `__client` 已重生成、前端调用点已改完后，删除所有 `api/src/**/contract.ts` 与
前端 `web/src/**/__client/contract.ts`。

### 步骤 6：对账
```bash
pnpm exec ojm api --check   # 生成物同步 + route 双向对账 + routes.js diff + WS 鉴权
```
应通过（artifact-stale / route-not-implemented / route-unregistered 均无）。

## 4. 逐点检查清单（checklist）

- [ ] **0. 盘点**：每个 `contract.ts` 的端点（route / method / 入参三通道 / data / form / ignoreLoading）已列出。
- [ ] **1. 翻译**：每个端点已在对应 handler 动词上挂 `.schema` 入参三通道 + 平级 `.response` 出参。
  - [ ] `params` 与 route 的 `{段}` 一一对应。
  - [ ] `query` / `body` 的 zod 已转为 JSON Schema（`z.string()`→`{type:"string"}`，`z.number()`→`{type:"number"}`，`z.boolean()`→`{type:"boolean"}`）。
  - [ ] `enum` → `enum: [...]`；`z.enum` 全字符串用 `z.enum`，混合类型用 `z.union([z.literal(...)])`。
  - [ ] `data` 已改为平级 `.response` 声明（= data 载荷，oj v0.1.72+）。
  - [ ] `z.array(x)` → `{ type: "array", items: <x> }`；`z.object({...})` → `{ type:"object", properties:{...}, required:[...] }`。
  - [ ] 可选字段：**不**写进 `required` 数组（zod `.optional()` 对应「不在 required」）。
- [ ] **2. `oj openapi`** 成功产出 `openapi.json`（路径含 base 前缀，如 `/api/notification/...`）。
- [ ] **3. `ojm api`** 为每个模块生成 `web/src/<模块>/__client/{api.ts, api.schemas.ts}`。
- [ ] **4. 前端调用点**已全部从旧人类命名改为 `camelCase(operationId)` 新方法名（含 provider 回调）。
- [ ] **5. `contract.ts`** 已彻底删除（前后端均无残留）。
- [ ] **6. `ojm api --check`** 通过，无 artifact-stale / route-* 违规。
- [ ] **7. `pnpm dev`** 起得来、接口能通（登录后按 devkit 手册 §8 五步清单核对）。

## 5. 已知丢失面 / 限制（迁移时要人审）

- **`form` / 文件上传**：当前 `ojm api` 的 openapi 流水线**不生成** form 通道的前端 client
  （文件部件是二进制，不进 JSON Schema）。惯例改为 antd `Upload` **直连**后端，handler 用
  `http.files` / `http.file(i)` 读字节，仅平级声明 `.response`。迁移时该类端点走直连，不生成 client。
- **`raw` 端点**：`openapi.json` 不携带 raw 标记，当前由 `handler-scan` 已实现路由表补充标记；
  handler 未实现时会被当作普通信封端点——迁移后务必跑 `--check` 复核。
- **zod 超集表达力**：`refine` / `transform` / `union`（`z.union` 除外，可用类型数组表达）/
  `$ref` / `oneOf` / `format` 等不在 JSON Schema 白名单内。`transform`/`refine` 必须下移到 handler 校验。
- **`pattern`（Rust regex）**：oj 侧校验用，但前端**不执行** `z.regex`（跨语言语义漂移 + ReDoS 风险），
  生成物仅发 `// @oj-warn` 注释。需要严格校验请下移到 handler。
- **`default`**：oj 运行期不为缺参补默认值，前端也不射 `.default()`，仅发 `// @oj-note` 注释。

## 6. 自动迁移命令状态（待核实）

设计计划 Task 7 曾规划 `ojm api migrate-to-schema`（把 `contract.ts` 各槽 zod 自动转成 `.schema`
预览 / 写回）。**当前代码仓库（`packages/cli/src`）并无此子命令**，请勿依赖。本指南的「步骤 1」
手工翻译是当前唯一可行路径；可对照 `docs/guides/api-codegen-openapi.md` §6 的预览思路人工落地。

## 7. 回退与验证

- 迁移是**增删文件**，无破坏性 schema 迁移：保留 `openapi.json` 与 `__client` 即为新口径工作态；
  若需回退，恢复 `contract.ts` 并降级 cli（但旧翻译层已删除，降级需回到对应老版本 cli）。
- 验证以 `ojm api --check` 全绿 + `pnpm dev` 接口联调为准；不要只凭「生成成功」判断。
