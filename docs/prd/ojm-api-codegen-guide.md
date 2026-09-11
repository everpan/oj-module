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
   - `emitClient` → `api.ts`（类型 + 请求函数，含 `bindRequest` 注入缝）与
     `api.schemas.ts`（zod schema，DEV 下 `safeParse` 校验响应；生产构建被摇树移除）
   - `emit-meta` → `routes.json`（路由表）与 `openapi.yaml`（评审可读）
   - `emit-stub` → 后端 handler 骨架（仅 uni-dev），按 oj 目录镜像路由落位
5. **幂等写盘**：内容逐字节比对，无变化不写盘（`written`/`skipped` 报告），重复跑
   `ojm api` 的 git diff 为空。

## 4. 生成物使用契约

- `web/src/<模块>/client/api.ts` 的函数**直接 import 调用**；首次使用前在模块
  `entry.ts` 的 `lifecycle.onInit` 里 `bindRequest(ctx.utils.request)` 注入请求能力，
  未注入就调用会人话报错指路。
- **生成物勿手改**：`api.ts`/`api.schemas.ts`/`routes.json`/`openapi.yaml` 重跑即覆盖
  （eslint 已忽略这些路径）。改需求 = 改契约，重跑 `ojm api`。
- **stub 例外**：`api/src/**/api.ts` 的 stub 文件头带指纹
  （`// ojm-api:stub <name> sha256:...`）。人碰过的 stub 工具**永不写永不删**——
  实现 handler 就是在 stub 里填业务逻辑。

## 5. `ojm api --check` 三重对账（只读，永不修文件）

1. **生成物同步**：内存重生成 vs 磁盘逐字节 diff（含 stub 待更新检测）。
2. **route 双向对账**：AST 扫后端 `api.ts`（default 导出方法名 + `.route = "..."` 赋值）
   vs 契约路由表——契约未实现 warn、handler 未登记 error、参数段不一致 error。
3. **routes.js diff**：`oj build` 产物路由表 vs `routes.json`；无 dist 给提示不判违规。

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
| 调用函数报「未 bindRequest」 | entry.ts 未注入请求能力 | 见 §4 `lifecycle.onInit` |
| 豁免写了 `//` 注释后全部失效 | 严格 JSON 解析失败静默回退 | 注释写进 `_comment` 字段 |
