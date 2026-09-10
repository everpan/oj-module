# API 契约机制设计（ram api）

> 2026-09-03。前置阅读：`module-development-guide.md`（模块开发手册）、
> `202609011520-uni-dev-manual.md`（uni-dev 工程）、oj 后端
> `docs/devkit/api-manual.md`（only-js 仓库，路由/信封/构建约定的事实源）。
>
> 本文决策编号 **AC-D***（避免与模块手册 D9/D10/D11、uni-dev D10 撞号），
> 需求编号 R*。2026-09-03 已经架构/开发双评审（有条件批准），评审意见
> 的处置见各决策行「评审」注记。

## 1. 背景与问题

模块化体系下前后端独立开发，接口交互缺少契约约束：

- runtime 内部 API 层（`packages/runtime/src/api/**`）手写 `fetchXxx` 包装，
  类型松散（`data: any`）、URL 字符串散落各处；
- oj 后端信封（`{code,msg,data}`，`code=0` 成功）与前端 `ApiResponse`
  （`{code,message,result,success}`）是两套，靠 `api/user/index.ts` 逐端点
  手写 `normalize`/`mapAuth` 适配（uni-dev D10），每接一个端点写一遍；
- 外部模块直接拿 `ctx.utils.request` 拼 URL 字符串 + 手写类型；
- mock（`fake/*.fake.ts`、`mock/*.mock.mjs`）手写，与真实接口无关联，
  后端字段漂移只能联调期发现。

后端（oj）目前**没有**机器可读契约，双方愿意**契约先行**。

## 2. 目标（SMART）

| 编号 | 需求 |
| --- | --- |
| R1 | 契约有唯一事实源，前后端共用；TS zod schema 为源，可导出 OpenAPI 交付后端/第三方 |
| R2 | 从契约生成强类型 client（`fetchXxx` 风格），替代手写包装与 `data: any` |
| R3 | dev 环境对响应做运行时 schema 校验，契约违例开发期即报（字段级 diff） |
| R4 | 契约驱动 mock：schema 生成响应数据，替代手写 mock（手写 mock 保留且优先） |
| R5 | 生成接口文档站（redoc），供前后端评审契约 |
| R6 | ~~兼容手写 OpenAPI YAML 作为等价契约输入~~ → **演进点**（评审：YAML 路径产不出 zod schema，R3/R4 在 YAML 下缺失；后端未来反向提供 spec 时启动） |
| R7 | 不破坏既有红线：模块手册 D11 scoped client 收敛、模块自包含（只 import 三类）、runtime 出口冻结（P3——契约机制本身零新增出口（AC-D8）；唯一出口变更是 `z` re-export（AC-D15），走框架方出口变更流程） |
| R8 | 前后端路由可机械对账（契约路由表 ↔ oj build 的 routes.js） |

非目标：后端消费契约做响应校验（oj 侧）、替换既有 mock 基建、强制迁移存量手写 API。

## 3. 核心决策

| 编号 | 决策 | 理由 / 评审注记 |
| --- | --- | --- |
| AC-D1 | zod schema 为契约源格式，单向导出 OpenAPI（3.1，`z.toJSONSchema`） | 团队纯 TS 书写成本最低；运行时校验免费；后端无 spec，契约先行。评审：钉死 zod 主版本（v4），不引第三方转换器（@asteasolutions 长期面向 v3、`z.coerce` 输出不一致） |
| AC-D2 | OpenAPI YAML 输入**本期不做**，列为演进点 | 评审：openapi-typescript 产不出 zod schema，YAML 路径下 R3/R4 双失，「产物相同」是过度承诺 |
| AC-D3 | uni-dev 工程契约放 `api/src/<模块>/contract.ts`（与后端 handler 同树）；纯前端工程放 `modules/src/<模块>/api/contract.ts` | 契约语义（路由/方法/信封）是后端事实，贴着实现方漂移最少；无后端同仓时退化为模块内 |
| AC-D4 | 契约 route 采用 oj 同款 matchit 参数语法（`{id}`、`{*path}`），**一律相对 apiPrefix，无根绝对写法** | 与后端 `.route` 同构可对账。评审：oj 的根绝对 `/x/{id}` 逃逸语义与模块手册 D11 前缀收敛互斥，放行则生成 client 必被 scoped client 运行期拒绝；挂 base 根的需求（如 `auth/*` 无模块段）走 runtime 内部特例通道，不进模块契约 DSL |
| AC-D5 | 契约只描述信封的业务 `data`；信封解包、字段归一、**错误语义**生成进 client | 消除 uni-dev D10 式手写适配。错误语义见 §6.2（评审：原文未规约，每个消费方都会立刻撞到） |
| AC-D6 | 前端模块只提交**生成物**（client.ts，含重新发射的 zod schema 与类型），不跨树 import 契约源文件；手册补约定「页面只许 import `api/client.ts`」 | 保持模块自包含红线（R7）。评审：纯前端形态契约源与页面同树，需显式约定防直接 import |
| AC-D7 | 生成物提交 git；`ram api` 显式命令 + `ram dev` watch 自动重生成 | 契约变更在 PR diff 可见、可评审；CI 校验同步 |
| AC-D8 | 生成 client 经 **capability 式 holder** 取 request：client.ts 导出 `bindRequest()`，模块 `onInit` 里 `bindRequest(ctx.utils.request)`；runtime **零新增出口** | 评审：原 `getModuleRequest(moduleName)` 按名查表引入冒用他模块前缀的绕过路径，把模块手册 D11 的身份绑定从闭包级降为自觉；holder 式保持闭包级绑定，且不动 P3 冻结出口。`onInit` 在 loadAll Phase 3、早于路由渲染，页面调用时 holder 已就绪；未 bind 直接调用抛人话错误 |
| AC-D9 | 生成 `routes.json`，格式与 oj routes.js 同款规范化（无首斜杠、不含 base、含模块段）；**uni-dev 形态 apiPrefix 字面等于 oj 模块段名**（`/order` ↔ `api/src/order/`） | 评审：原 `/order-api` ↔ `order` 映射靠位置隐式推导，换布局即静默断账；字面相等零换算，R8 对账可机械化。纯前端形态无 oj，前缀命名自由 |
| AC-D10 | 契约 route 是唯一手写事实源；`ram api` 为无 handler 的端点生成 `api.ts` stub（`.route`/方法名/`json.ok` 收口已填好）；`ram api --check` 静态扫描后端源做**双向对账** | 消除「契约 route ↔ handler `.route`」两处手写的人为漂移；不采用 handler import 契约取 route（语义需换算，且破坏 oj build 对 `.route` 字面量的静态提取） |
| AC-D11 | DSL 宿主为独立微包 **`@react-antd-module/contract`**（`defineApi` + zod re-export + 类型，零浏览器依赖） | 评审 blocker：`ram api` 须在 Node 进程执行 contract.ts，`import "@react-antd-module/runtime"` 会拉起浏览器侧入口（React/`import.meta.env`/localStorage）即崩，且为纯 schema DSL 扩 P3 冻结出口代价不当 |
| AC-D12 | 契约 schema 走**白名单子集**：`z.object/array/enum/literal/union/optional/default` + string/number/boolean 基础约束；`transform/refine/preprocess/pipe/coerce/lazy` 由 codegen 检出并报人话错误拒绝 | 评审：契约在 codegen 期是求值后的运行时对象，反向发射源码须内省 zod 内部结构（v3 `_def` / v4 `_zod.def` 不兼容）；白名单化后 IR→发射链路才有可写的快照测试基线。params/query 声明语义类型（如 `z.number().int()`），URL 序列化由生成物负责 |
| AC-D13 | 契约求值复用 `packages/cli/src/build.ts` 的 `readModuleDefinition` 链路（esbuild bundle + 真 import()），stub 插件换**功能版**（真 zod + 真 defineApi，zod 版本与浏览器侧严格一致） | 评审：仓内已有现成解法先例（B10）；两端 zod 版本漂移由既有版本矩阵门禁（模块手册 C4/D12）覆盖 |
| AC-D14 | mock 按工程形态分两路：**uni-dev 全栈形态**由 stub handler 承担（stub 的 `json.ok` 直接填 schema 示例值——stub 即 mock，oj dev 热更零额外机制）；**纯前端形态**由 ram dev mock 表消费 routes.json + schema 示例值（段级 matcher：字面段优先于参数段，自研极简实现零新依赖） | 评审：全栈形态 `/api/*` 整体反代 oj，未写 handler 的端点会落 oj 404 而非前端 mock，R4 在全栈形态本不可用；stub handler 正好填这个洞 |
| AC-D15 | zod 经 **runtime re-export** 进浏览器侧（随 runtime dist 进 shell，不新增 importmap 条目）；生成 client 的 dev 校验 schema `import { z } from "@react-antd-module/runtime"`（**例外**：internal 目标在 runtime 树内自引包名成环，直取 `zod`——runtime dist 本就内联 zod，等价同源）；且 schema 定义整体包进 `import.meta.env.DEV` 守卫（生产 tree-shake 剔除，零成本）。另（评审 F3）：生成 client 运行期只 import `@react-antd-module/contract/errors` 这个 zod-free 子路径出口（ContractApiError/ScopedRequestLike），全量 zod 不进共享资产 | 评审：runtime 本就是硬共享单例，re-export 省一张 importmap 条目且与 codegen Node 侧同源定版；原「zod 独立进 SHARED_DEPS」会让没用契约的模块也买单 |
| AC-D16 | **前端统一适配 oj 信封** `{code,msg,data}`（`code=0` 成功，HTTP 状态=code）作为全站唯一信封形态：`error-response.ts` 改读 `msg`（顺带修复存量 bug）；auth/user store、authProvider、生成 client 全部直接消费 oj 信封；`fake/*.fake.ts` 与 `mock/*.mock.mjs` 改发 oj 信封；旧 `ApiResponse{result}` 透传兼容**删除** | 用户拍板（2026-09-03）：双信封兼容（fake 透传通道）是临时态的永久化，每接一个端点写一遍 normalize 正是本机制要消灭的「原始」痛点；uni-dev D10 适配层随之整体退役 |

## 4. 契约 DSL

```ts
// api/src/order/contract.ts —— 唯一事实源（uni-dev 工程）
import { defineApi, z } from "@react-antd-module/contract";

export const apiPrefix = "/order";   // AC-D9：uni-dev 形态字面等于 oj 模块段；
                                     // entry.ts 的 register.apiPrefix 引用同一常量（单一来源）

// 公共类型：schema 即类型，同文件定义并导出（线格式 snake_case 原样）
export const OrderItem = z.object({
  id: z.number(),
  order_no: z.string(),
  status: z.enum(["open", "closed"]),
});
export type OrderItemType = z.infer<typeof OrderItem>;

// 目录镜像风格：route 相对 apiPrefix
export const getOrderList = defineApi({
  apiPrefix,
  route: "/list",                      // ↔ api/src/order/list/api.ts
  method: "GET",                       // 缺省 GET
  query: z.object({ page: z.number().int().min(1), size: z.number().max(100) }),
  data: z.object({ list: z.array(OrderItem), total: z.number() }),  // 信封 data 部分
});

// .route 参数路由风格：matchit 语法（AC-D4），params 声明语义类型（AC-D12）
export const getOrderDetail = defineApi({
  apiPrefix,
  route: "/item/{id}",                 // ↔ 后端 detail.route = "{id}"
  method: "GET",
  params: z.object({ id: z.number().int() }),
  data: OrderItem,
});

export const saveOrder = defineApi({
  apiPrefix,
  route: "/item",
  method: "POST",
  body: OrderItem,
  data: z.string(),
});

// 二进制/非信封逃生口（评审：blob 下载、s3 302、裸 413 等场景无信封）
export const downloadOrderFile = defineApi({
  apiPrefix,
  route: "/file/{*path}",
  method: "GET",
  response: "raw",                     // 不解包信封、不校验、不进 mock 生成
});
```

要点：

- `defineApi` 返回的端点描述符可枚举（`.route` 可读），观感与后端
  `fn.route` 一致；codegen/mock 遍历模块导出收集全部端点。
- codegen 期静态校验：每个端点 `route` 必须落在其声明的 `apiPrefix`
  段内（模块手册 D11 越界从运行期提前到生成期）；`{id}` 等参数段遵循
  后端同款约束（参数段内不得混字面）。
- **route →（目录镜像 + `.route`）切分算法**（评审补齐，stub 生成与
  对账共用同一实现）：静态前缀段 → 目录镜像路径；自首个参数段起的
  尾巴 → `.route` 值。零静态前缀（`/{id}`）→ 目录 = 模块根、
  `.route = "{id}"`。两个端点落到同（目录, method）→ codegen 直接报错。
- 框架登录链的 snake→camel 映射（`access_token`→`token`）保留为
  runtime 内部特例，不进模块契约范围。

## 5. 工程布局与产物

### 5.1 uni-dev 工程（前后端同仓）

```
my-app/
├── api/src/order/
│   ├── manifest.yaml
│   ├── contract.ts          # 契约唯一事实源（手写，与 handler 同树，AC-D3）
│   ├── routes.json          # 生成物（提交 git）：method + pattern 表（AC-D9）
│   ├── openapi.yaml         # 生成物（提交 git）：OpenAPI 3.1，交付后端/第三方评审
│   ├── list/api.ts          # 后端 handler（目录镜像路由）
│   └── item/api.ts          # detail.route = "{id}"
└── modules/src/order/
    └── api/
        └── client.ts        # 生成物（提交 git，AC-D6）：typed fetch 函数
                             # + bindRequest holder + dev-only zod schema + 类型
```

### 5.2 纯前端模块工程（外部团队，无后端同仓）

```
modules/src/order/api/
├── contract.ts              # 同一 DSL、同一 IR、同一规则
├── client.ts                # 生成物
└── openapi.yaml             # 生成物
```

`ram api` 契约发现路径固定两档（评审 F14 降级：可配 glob 未兑现，按 YAGNI 固定）：`api/src/*/contract.ts`
（uni-dev）、`modules/src/*/api/contract.ts`（纯前端）。两种位置编译到
同一 IR，规则完全一致。

## 6. 工具链（ram api）

`ram api` 扫描契约 →（AC-D13 求值链路）构建 IR → 发射产物；`ram dev`
时自动以 watch 模式运行（AC-D7；uni-dev 形态增加 `api/src` watch 目标，
契约改动 → 重写 client.ts → 触发既有模块重建 + SSE，去抖合并两轮构建）。

### 6.1 产物

| 产物 | 内容 |
| --- | --- |
| `client.ts` | `fetchOrderList(query): Promise<OrderListData>` 风格强类型函数；内嵌信封解包与错误语义（§6.2）；模块目标经 `bindRequest` holder 取 scoped client（AC-D8），runtime 内部目标直接注入全局 request（见 §8）；dev 下对 `data` 做 `safeParse`（R3，schema 定义整体在 DEV 守卫内，AC-D15） |
| `openapi.yaml` | `z.toJSONSchema` → OpenAPI 3.1（AC-D1），聚合后交付后端 |
| `routes.json` | method + pattern 表，routes.js 同款规范化（AC-D9）；纯前端形态 ram dev mock 直接消费（AC-D14） |
| handler stub | uni-dev 形态为缺失端点生成 `api.ts` stub，`json.ok` 预填 schema 示例值（AC-D10/AC-D14） |
| 文档站 | `ram api docs` 用 redoc 渲染聚合 OpenAPI 3.1（R5） |

### 6.2 生成 client 的错误语义（评审补章，AC-D16 定稿）

全站唯一信封 = oj `{code,msg,data}`（AC-D16），两种响应通道收口：

| 通道 | 形态 | 生成 client 行为 |
| --- | --- | --- |
| (a) 成功 | 2xx + 信封 `code=0` | dev `safeParse` 后返回 typed `data` |
| (b) 业务/系统错误 | 非 2xx（oj `json.fail(code,msg)` 把 HTTP 状态置为 code） | catch ky `HTTPError` → 解析响应体信封 → 抛 `ContractApiError { code, msg }`（msg 取信封 `msg`，缺则 statusText） |

- 401 刷新重试由 request 层 hooks 先行处理，生成 client 只见最终结果，
  不重复实现；
- `ContractApiError` 由 contract 微包导出类型，消费方
  `catch (e) { if (e instanceof ContractApiError) ... }`；
- `response: "raw"` 端点不进上述任何通道：原样返回 `Response`，
  错误处理归调用方；
- 旧 fake 信封（2xx + `success/result`）形态随 AC-D16 废弃，fake 与 mock
  一律改发 oj 信封，runtime 的 `normalize`/`mapAuth` 适配层整体删除。

### 6.3 依赖新增（评审点名）

| 依赖 | 归属 | 用途 |
| --- | --- | --- |
| zod（钉 v4 主版本） | contract 微包 dependencies + runtime dependencies（re-export） | 契约书写 / dev 校验 |
| `@faker-js/faker` | cli dependencies | mock 示例值生成（语义标注启发式：email/url/date 等 format 命中） |
| redoc CLI | cli dependencies | `ram api docs` |
| 段级 matcher | 自研极简（cli 内部，非依赖） | mock 路由匹配 + 特异性排序（字面段 > 参数段 > catch-all） |

## 7. 运行时校验

dev 环境（`import.meta.env.DEV` 守卫，生产构建整段剔除、schema 定义与
zod 一并 tree-shake、零成本，AC-D15）下，生成 client 对解包后的 `data`
做 `schema.safeParse`；违例抛「契约违例」错误（端点名 + 字段级 diff），
把后端字段漂移暴露在开发期（R3）。diff 文案只对稳定部分（端点名、
字段路径）做断言，zod issue 全文案随版本变，不做全文断言（评审提醒）。

## 8. 迁移路径

1. runtime 内部 `api/` 以 `system/role` 为试点改契约制。**内部目标不走
   holder**——runtime 内部 api 不是模块、无 apiPrefix 登记，生成模板参数化：
   模块目标用 `bindRequest` holder（AC-D8），内部目标直接注入全局
   `request`（评审：登记伪前缀 `"/"` 在现有 boundary 匹配下等于不设防，
   不采用）；
2. 旧手写 `fetchXxx` 保留至全部迁完，消费方逐步切换；
3. 外部模块按需接入，不强制；`ctx.utils.request` 裸用不被禁止（契约是
   增量能力，不是新红线）。

## 9. 测试与门禁

- codegen 单测：IR → client/openapi/routes/stub 快照（Vitest）。schema
  内省快照对 zod 升级敏感——「zod 升级 = 快照批量重生」写入运维注意；
- e2e：mock 返回与 schema 不符 → dev 报契约违例（断言稳定部分：端点名 +
  字段路径）；
- CI：`ram api --check` 三重校验——
  1. 「契约 ↔ 生成物」同步，drift 即失败（同 P3 drift-prevention 思路）；
  2. **route 双向对账**（AC-D10）：静态扫描 `api/src/**/api.ts` 的目录镜像
     路径 + `.route` 字面量（AST 解析，下限不用正则，避免误报面），与契约
     路由表 diff——契约路由无 handler（契约先行期可配 warn）、handler
     `.route` 未登记（error）、同名端点参数段不一致（error）；
  3. uni-dev 工程校验「契约路由表 ↔ 后端 routes.js」一致（R8，release 兜底）。

## 9.1 handler stub 生成（AC-D10）

`ram api` 发现契约端点尚无对应 handler 时生成 `api.ts` stub：

- 目录按 §4 切分算法创建；`.route` 参数段已按契约填好；
- 方法名已按契约 method 映射（`DELETE`→`del`，规避 oj 手册红线）；
- 响应已带 `json.ok(<schema 示例值>)`——stub 即 mock（AC-D14）；
  TODO 注释标注对应契约端点名。

### 幂等规则

生成单位是 (route, method) 对，写盘粒度为**整个文件、只创建不修改**。
stub 文件头带指纹注释（`// ram-api:stub <端点名> sha256:<内容哈希>`，
哈希对去除指纹行后的内容计算，跨机器稳定）：

| 场景 | 行为 |
| --- | --- |
| handler 文件不存在 | 生成 stub |
| 重跑且契约未变 | 产物字节一致（稳定排序 + 固定模板），零写入，git diff 为空 |
| 文件存在且指纹匹配（stub 未被人编辑） | 契约变更时允许更新/随路由迁移该 stub（无人的劳动成果，覆盖安全） |
| 文件存在但指纹不匹配（人已填写业务逻辑） | **永不修改**；已有文件缺契约新增的 method 时由 `--check` 报「未实现」并打印可粘贴片段 |
| 契约 route 改名 | 新路径生成 stub；旧文件成孤儿由 `--check` 报「handler 未登记」；**删除是人的决定**，工具不删文件 |

指纹健壮性（评审补齐）：**写盘前先经项目 formatter（eslint --fix 同款
规则）再算哈希**，输入做 LF + 行尾空白归一——否则 lint-staged 首次提交
重排即令指纹失配，「未编辑 stub 可自动更新」能力静默丧失（降级方向
安全，但属静默失效，须防）。

原则：人碰过的文件工具永不写、永不删；一切 drift 走 `--check` 对账，
修复动作永远由人执行。

## 10. 风险与开放点

| 项 | 说明 |
| --- | --- |
| codegen 自研维护成本 | IR + 模板发射，量薄；schema 侧有白名单（AC-D12）封顶，不引入 openapi-generator 级重型工具 |
| 契约文件进 oj 构建产物 | `oj build` 把 `api/src` 全部 .ts 原路径转译进 dist，`contract.js` 成死代码（其 import 的微包在部署机不存在，但永不加载故无运行害）；uni-dev 试点验收加一条「产物含 contract.js 无害 + oj build 不受 contract.ts 影响」 |
| 对账盲区 | oj build 剥 `.route` 只认「语句起始的标准赋值写法」（oj 手册 §13 已知限制）；人把 stub 改成花式写法后 `--check` 同样漏——此处承认不完备，release 兜底靠 routes.js diff（第 3 重校验） |
| 信封统一（AC-D16 已拍板） | 前端全站统一为 oj 信封：`error-response.ts` 读 `msg`（存量 bug 一并修复）、`normalize`/`mapAuth` 适配层删除、fake/mock 改发 oj 信封；影响面集中在 request 层 + auth/user store + 登录链，由实现计划 P1 承载 |
| zod 版本 | 钉 v4 主版本；两端（Node stub / 浏览器 re-export）同源定版，版本矩阵门禁覆盖；「zod 升级 = 快照批量重生」为已知运维成本 |
| 后端消费契约（oj test 校验响应） | 留作演进点；契约位置放对（AC-D3）后此事免费 |
| OpenAPI YAML 输入（原 R6） | 演进点：需 openapi→zod 生成层才有 R3/R4，本期不引 |

## 11. 术语对照

| 前端契约 | oj 后端 |
| --- | --- |
| `apiPrefix`（`/order`，uni-dev 形态字面等于模块段，AC-D9） | 模块段 `{base}/order/...`（`api/src/order/`） |
| `route: "/list"` | 目录镜像 `src/order/list/api.ts` |
| `route: "/item/{id}"` | `detail.route = "{id}"` |
| `data` schema | `json.ok(data)` 的 data |
| `routes.json`（无首斜杠、不含 base、含模块段） | build 产物 `routes.js`（同款规范化） |
