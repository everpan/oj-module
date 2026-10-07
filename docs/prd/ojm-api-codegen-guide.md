# ojm api 契约代码生成指南（新人向）

- 日期：2026-09-12
- 读者：刚接触 oj-module 工程、需要理解「契约 → 前端 client」链路的开发者
- 关联：[[202609112324-web-layout-and-codegen-guide-design]]（本次改名决策）、[[202609030854-api-contract-design]]（契约原始设计）、`oj-fullstack-tutorial.md`（上手操作向）

> tutorial 讲「怎么用」，本文讲「它是怎么工作的」——读完应能回答：改了契约会发生什么、
> 生成的文件能不能手改、`--check` 在对账什么、豁免清单怎么配。

## 1. 一句话总览

`ojm api` 读 **契约文件**（`contract.ts`，用 `defineApi` 声明端点），一次性生成前端调用
代码、接口元数据和后端 handler 骨架，让「前端调用的函数」与「后端暴露的路由」永远同源。

```
contract.ts ──evaluate──► IR（中间表示）──emit──► 四产物 + stub
```

## 2. 两种工程形态与契约发现

`discoverContracts`（`packages/cli/src/contract/run.ts`）默认并扫两档：

| 形态 | 契约位置 | 产物流向 |
|---|---|---|
| **uni-dev**（前后端一体，推荐） | `api/src/<模块>/contract.ts` | `api.ts`/`api.schemas.ts` → `web/src/<模块>/client/`；`routes.json`/`openapi.yaml` → 契约旁；stub → `api/src/<模块>/<路径>/api.ts` |
| **纯前端** | `web/src/<模块>/client/contract.ts` | 四产物全部落契约同目录，无 stub |

uni-dev 形态有硬约束（AC-D9）：契约里每个端点的 `apiPrefix` 必须**字面等于**后端目录名
（`api/src/order/contract.ts` 的端点 `apiPrefix` 必须是 `/order`），不符即人话报错。

> 注意：工程里有两个 "web"——`web/` 是前端模块源码，`api/src/web/` 是 oj 后端的 web
> 模块（提供 user-info 等内置接口）。两者不同目录、不同语义，豁免清单里的
> `"modules": ["web"]` 指的是**后者**。

## 3. 生成管线五步

1. **发现**：按上表规则扫出全部 `contract.ts`。
2. **求值**（evaluate）：esbuild 把契约打成 bundle 后真实 `import()`——契约里可以写注释、
   用变量、做条件判断；裸说明符被 external，从工程 `node_modules` 解析。
3. **IR 归一**（ir.ts）：方法缺省推导、`apiPrefix + route` 拼全路径、参数段提取
   （`{id}` / `*` catch-all）、zod schema 过白名单（只保留可安全发射的类型与约束）。
4. **发射**：
   - `emitClient` → `api.ts`（类型 + 请求函数，含 `create<Module>Client(ctx)` 工厂——
     构造即登记 apiPrefix + 绑定 request；旧 `bindRequest` 保留为 @deprecated 逃生口）与
     `api.schemas.ts`（zod schema，DEV 下 `safeParse` 校验响应；生产构建被摇树移除）
   - `emit-meta` → `routes.json`（路由表）与 `openapi.yaml`（评审可读）
   - `emit-stub` → 后端 handler 骨架（仅 uni-dev），按 oj 目录镜像路由落位
   - `emit-oj-schema` → handler 上的 `.schema` 入参契约（见第 4.5 节）
5. **幂等写盘**：内容逐字节比对，无变化不写盘（`written`/`skipped` 报告），重复跑
   `ojm api` 的 git diff 为空。

## 4. 生成物使用契约

- `web/src/<模块>/client/api.ts` 的函数**直接 import 调用**；首次使用前在模块
  `entry.ts` 的 `lifecycle.onInit` 里 `const client = create<Module>Client(ctx)`（构造即
  登记 apiPrefix + 绑定 request，前缀唯一真源是生成物的 `API_PREFIX` 常量），
  未创建就调用会人话报错指路。一模块一 client。
- **生成物勿手改**：`api.ts`/`api.schemas.ts`/`routes.json`/`openapi.yaml` 重跑即覆盖
  （eslint 已忽略这些路径）。改需求 = 改契约，重跑 `ojm api`。
- **stub 例外**：`api/src/**/api.ts` 的 stub 文件头带指纹
  （`// ojm-api:stub <name> sha256:...`）。人碰过的 stub 工具**永不写永不删**——
  实现 handler 就是在 stub 里填业务逻辑。

## 4.5 入参契约落到后端：`.schema`（oj v0.1.44）

契约里声明的 `params` / `query` / `body` 不只生成前端类型与校验，也会落成后端 handler 的
`.schema`，由 oj 在 **JS 之前**校验——违反即 `400` 信封，handler 根本不会被调用：

```ts
// api/src/order/list/api.ts（ojm api 生成，勿手改正文外的部分）
function get(): void {
	json.ok({ /* TODO */ });
}
get.schema = {
	"query": {
		"type": "object",
		"properties": { "page": { "type": "number", "minimum": 1 } },
		"required": ["page"]
	}
};
export default { get };
```

于是**一份契约同时给出**：前端 client 与类型、前端 DEV 期 zod 校验、后端入参校验、OpenAPI 文档。

**降级规则（oj 的关键字是白名单，白名单外装配期 fail-fast，所以必须裁剪）**：

| 契约写法 | 落到 `.schema` | 说明 |
|---|---|---|
| `z.string()` / `z.number()` / `z.boolean()` | `type` | — |
| `z.number().int()` | `type: "integer"` | 影响 params/query 的字符串强转 |
| `.min()` / `.max()` | `minimum` / `maximum` | array 上是 `minItems` / `maxItems` |
| `.min()` / `.max()`（string） | `minLength` / `maxLength` | — |
| 全字面量 `z.union([...])` | `enum` | 白名单无 `oneOf`，只能等价降级 |
| 其它 `z.union` | 该字段不校验 | **会打 warn**，不静默丢 |
| `.email()` / `.uuid()` / `.url()` | 跳过 | 白名单无 `format`；**会打 warn** |
| `.regex(re)` | `pattern` | 必须是 Rust regex：`(?=)` / `(?!)` / `\1` 会在**生成期**报错 |
| `z.date()` | `type: "string"` | JSON 无日期类型，线上是 ISO 串 |
| `z.nullable()` | `nullable: true` | — |

**params / query 只允许扁平标量**（string/number/integer/boolean/null）：HTTP 里它们只有
字符串形态，声明 array/object 是永远无法满足的死契约——`ojm api` 在生成期就报错，不等 oj
装配期才拒。

开关在 config：`server.schema_validation`（默认 `true`，置 false 为逃生门）。

## 5. `ojm api --check` 四重对账（只读，永不修文件）

1. **生成物同步**：内存重生成 vs 磁盘逐字节 diff（含 stub 待更新检测）。
2. **route 双向对账**：AST 扫后端 `api.ts`（default 导出方法名 + `.route = "..."` 赋值）
   vs 契约路由表——契约未实现 warn、handler 未登记 error、参数段不一致 error。
3. **routes.js diff**：`oj build` 产物路由表 vs `routes.json`；无 dist 给提示不判违规。
4. **WS 路由鉴权**：目录里的 `ws.ts` 产生 `GET {base}/<模块>/<路径>/ws`——oj v0.1.30 起
   WS 握手过鉴权守卫，不在 `auth.anonymous_paths` 里的 WS 会让未带凭据的客户端握手 401
   （表现为「文件在却连不上」）。只 warn（带 Bearer/Cookie 的受保护 WS 是正当用法）；
   读不到 config 就不判。

### 豁免清单 `api/.ojm-api-exempt.json`

把「确认无害」的对账差异降级为 skip（仅降级，绝不引入新错误）：

```jsonc
{
	"_comment": "说明文字写这里——本文件是严格 JSON，写 // 注释会解析失败、豁免静默全失效！",
	"modules": ["web"],      // 整模块跳过对账（值 = api/src/<模块> 目录名）
	"paths": ["/auth/*"]     // /xxx/* 一层通配（只盖 /xxx/<单段>）；其余为精确前缀
}
```

文件缺失或损坏时静默按空豁免处理。旧名 `.ram-api-exempt.json` 只读回退（R4）。

## 6. 其他子命令

- `ojm api --docs`：聚合全部契约的 OpenAPI → redoc 静态站（uni-dev 落 `api/docs/`，
  纯前端落 `docs/api/`）。
- `ojm dev` 内置契约 watch：契约文件变更 → 自动重跑生成 → 产物落 `web/` 树触发
  模块重建 + 浏览器刷新。

## 7. 排错速查

| 症状 | 原因 | 处置 |
|---|---|---|
| `没有发现契约文件` | 目录不符发现规则 | 按 §2 表核对；存量工程注意 `modules/` → `web/`、`api/` → `client/` 迁移 |
| `apiPrefix 与目录名不符` | AC-D9 字面相等约束 | 改 apiPrefix 或移动契约目录 |
| `--check` 报 artifact-stale | 改了契约没重跑 | 重跑 `ojm api` |
| `--check` 报 handler 未登记 | 内置/手写 handler 无契约 | 补契约，或登记豁免清单 |
| 调用函数报「请求未绑定」 | entry.ts 的 onInit 里没调 `create<Module>Client(ctx)` | 见 §4 `lifecycle.onInit` |
| 豁免写了 `//` 注释后全部失效 | 严格 JSON 解析失败静默回退 | 注释写进 `_comment` 字段 |
