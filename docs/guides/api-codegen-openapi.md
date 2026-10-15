# `__client` 代码生成：基于 openapi.json 的新口径

> 适用版本：**0.1.20**（`@oj-module/cli` / `@oj-module/runtime` 锁步）。运行期依赖 `oj` ≥ `0.1.73`
> 的 `oj openapi`（平级 `.response` 出参声明位自 v0.1.72 起、`del`→`delete` 操作键归一自 v0.1.73 起）。
> 权威源：`oj` handler 上的 `.schema`（入参）+ 平级 `.response`（出参）。`oj openapi` 产出
> `openapi.json`；`ojm api` 消费它生成前端 `__client`。

## 1. 权威源与数据流

```
oj handler .schema（入参，手写）+ .response（出参，平级）——唯一权威源
        │  oj 内省（含组级 .schema / .response 继承合并）
        ▼
oj openapi -c config -d api/src -b <base> -o openapi.json   →  OpenAPI 3.1
        （dev 内省 .route/.schema/.response；release 改 -d dist 读 routes.js）
        │
        ▼
ojm api   →  irFromOpenapi  →  emitZodFromJsonSchema / emitClient
        │
        ▼
web/<模块>/__client/{api.ts, api.schemas.ts}
```

- **不再需要也不能用** `contract.ts`（defineApi / zod）——翻译层已退役删除，`ojm api` **不兼容读取**
  `contract.ts`：工程根找不到 `openapi.json` 即报错指引先跑 `oj openapi`。存量 `contract.ts` 工程须先迁移，
  方法见 `docs/migration/contract-to-openapi-schema.md`。
- **不再由 ojm 自产** `routes.json` / `openapi.yaml`——`openapi.json` 即权威，文档站（`ojm api --docs`）直接聚合它。

## 2. 日常用法

```bash
# 1) oj 产出 OpenAPI 规范（base 从 config 的 api 挂载前缀读；dev 用 -d api/src 内省）
oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json

# 2) ojm 消费生成前端 __client（按 tags[0] 分组到各模块）
ojm api

# 3) 校验同步 / route 双向对账
ojm api --check

# 4) 文档站（聚合 openapi.json → redoc 单文件）
ojm api --docs
```

`ojm api` 只认 `openapi.json`（项目根或 `api/`）：找不到即报错指引先跑 `oj openapi`（旧 `contract.ts` 路径已随翻译层一并删除，不再回退）。

## 2b. `ojm init` 脚手架已升级（「最新方式」）

`ojm init` 产出的模板工程已切换为 oj `.schema` 形态，开箱即走新口径：

- **handler 直接挂 `.schema` + 平级 `.response`**：如 `api/src/notification/api.ts` 的每个动词（含 `del/` 子目录、`personal-center/upload`）挂 `.schema` 入参（`params/query/body`）与平级 `.response` 出参（oj v0.1.72+），无 `contract.ts`。
- **模板随附 `openapi.json`**（项目根）与预生成的 `web/src/<模块>/__client/`——`ojm api --check` 开箱通过，无需先跑 `oj openapi`。
- 改完 handler 的 `.schema` 后：`oj openapi ... -o openapi.json` 重生成规范，`ojm api` 重生成 `__client`，`ojm api --check` 对账。
- 端点方法名来自 `operationId`（如 `notificationNotificationsGet`），与旧 `contract.ts` 的人类命名（`fetchNotifications`）不同；前端 module `entry.ts` 用 `createXxxClient(ctx)` 工厂，内部调用这些派生名。

## 3. 端点命名

客户端方法名 = `camelCase(operationId)`。例如 `wiki/collections/{id}` + `get` → `wikiCollectionsIdGet`。
类型名：`WikiCollectionsIdGetData`（响应 data）、`WikiCollectionsIdGetQuery/Params/Body`（入参）。
旧 `contract.ts` 的人类命名（如 `fetchNotifications`）在迁移时按「逐字节比对」识别为丢失面，需人工确认。

## 4. 安全与语义约定（重要）

`.schema` 是 oj 的 JSON Schema 白名单子集（`type/required/properties/items/additionalProperties/minimum/maximum/minLength/maxLength/pattern/enum/nullable/minItems/maxItems/default`）。

- **`pattern` 不进前端运行时**：oj 的 pattern 是 **Rust regex**，与 JS `RegExp`（回溯引擎）语义不同且存在 ReDoS 风险。生成物仅发 `// @oj-warn` 注释，前端**不**执行 `z.regex`。需要严格校验请下移到 handler。
- **`default` 不射 `.default()`**：oj 运行期不为缺参补默认值；前端若补会让可选字段变必填、掩盖契约漂移。仅发 `// @oj-note` 注释。
- **所有动态键名/枚举值经 `JSON.stringify` 字符串字面量**注入，防止契约值中的反引号/斜杠星/模板插值破坏产物或注入。
- 白名单外关键字（如 `$ref` / `oneOf` / `format`）**fail-fast**，不静默降级。

## 5. 已知限制

- **`raw` 端点**：openapi.json 不携带 raw 标记。当前由 `handler-scan` 的已实现路由表补充标记；若 handler 未实现，raw 端点会被当作普通信封端点。
- **`multipart/form-data`**：文件部件是二进制，不进 JSON Schema；文本部件正常生成，文件部件需手写 `File | Blob`。
- **`catch-all`（`{*path}`）**：路由参数标记已保留，URL 插值按段编码。

## 6. 迁移存量 contract.ts 工程

> ⚠️ **`ojm api migrate-to-schema` 命令当前未实现（待核实）**：设计计划（
> `docs/plans/2026-10-15-schema-authority-openapi-codegen.md` Task 7）曾规划该命令做自动翻译 +
> 丢失面预览，但代码仓库（`packages/cli/src`）目前并无此子命令。请按下面的**人工迁移**步骤操作，
> 完整 checklist 见 `docs/migration/contract-to-openapi-schema.md`。

人工迁移概要：

- 逐个端点把旧 `defineApi` 的 `params/query/body` 翻成 handler 动词上的 `.schema` 三通道
  （`params/query/body`，JSON Schema 子集）；旧 `data` 翻成**平级 `.response`**（oj v0.1.72+）。
- `.response` = 旧 `data` 载荷；`form` / `raw` 端点标记为**丢失面**，需人审手写（详见迁移指南）。
- 把 `.schema` 写回对应 oj handler（人工对照落地，不做 AST 注入），删 `contract.ts`，
  跑 `oj openapi` 重生成 `openapi.json`，再 `ojm api` 生成 `__client`，最后 `ojm api --check` 应转新口径通过。

## 7. 路线图

- **0.1.20（已落地）**：codegen 切换为 openapi.json 源；`runtime/contract` 翻译层与 zod 契约 DSL（defineApi / contract.ts）退役删除；handler 契约改 `.schema` 入参 + 平级 `.response` 出参（oj v0.1.72+，运行期要求 oj ≥ 0.1.73）。
- 后续：`ojm api --docs` 文档站聚合增强（进行中，见 `docs/plans/2026-10-15-schema-authority-openapi-codegen.md`）。
