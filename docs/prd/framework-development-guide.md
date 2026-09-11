# 框架开发手册：两个 npm 包（新人上手版）

> **读者**：刚加入、需要维护「框架本体」的同学。默认你会 React + TypeScript，能读 Vite / esbuild 配置；**不要求**你了解本仓库历史。
> **目标**：读完能独立完成「定位改动落在哪个包 → 写代码 → 本地验证 → 提交前重建产物」。
> **范围**：只讲 2 个对外发布的包 —— `runtime`（含 `runtime/contract` 子路径）与 `cli`（含预构建宿主 `shell-dist`），每包一章。
> **想直接上手做项目**：看配套实战演练 [`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md)（从零搭一个 oj 前后端应用）。
> 面向「业务模块作者」的手册是 [`module-development-guide.md`](../archive/prd/module-development-guide.md)，两本手册读者不同，不要混读。
>
> ⚠️ **结构变更（已全量落实）**：本手册已按两轮改造逐句核对——**P1/P2 包合并与 scope 改名**（原 4 包 contract / runtime / shell / cli → 2 包 `runtime` / `cli`，`@react-antd-module` → `@oj-module`），以及 **P3 命令与内部前缀改名**（`ram` → `ojm`，内部 `ram-*` → `ojm-*`，**兼容读旧名**）。全文已无「独立 shell/contract 包」「`ram` 命令」口径；依据与迁移记录见 [`202609110947-oj-module-two-package-consolidation-design.md`](./202609110947-oj-module-two-package-consolidation-design.md)（§12 实施记录、§13 陷阱 A27–A46）。
> 旧 scope 的 4 个包（`@react-antd-module/{runtime,cli,contract,shell}`）已在 npm 全量 **deprecate**，安装时会提示迁移到 `@oj-module/*`；两包当前同版 **`0.1.6`**。

---

## 导读（先读这一页）

### 0.1 遇到问题先查这张表

| 你的需求 / 症状 | 去哪个包 | 章节 |
| --- | --- | --- |
| 定义一个新接口、改接口参数/返回值形状 | `runtime/contract` | [第 1 章](#第-1-章-oj-moduleruntimecontract契约层) |
| 页面报「尚未登记 API 前缀」/ 请求被拦 | `runtime`（模块侧）+ `cli`（校验） | [2.9](#29-请求收敛scoped-request) |
| 菜单不显示、路由 404、页签异常 | `runtime` | [第 2 章](#第-2-章-oj-moduleruntime运行时框架) |
| 页面样式丢失、图标空白、组件拿到 `undefined` | `cli`（内置宿主 `shell-dist`） | [第 3 章](#第-3-章-oj-modulecli预构建宿主) |
| `ojm dev`/`build`/`api` 行为不对 | `cli` | [第 4 章](#第-4-章-oj-modulecli工程工具链ojm) |
| 发布新版本 | — | [附录 A](#附录-a发布清单含-staged-publishing-踩坑) |

### 0.2 两个包各干什么

| 包 | 一句话职责 | 谁消费它 |
| --- | --- | --- |
| `@oj-module/runtime` | **浏览器面**：运行时框架（模块加载/生命周期、路由、布局、状态、请求收敛）+ 契约 DSL 子路径 `./contract`、`./contract/errors`（`defineApi` / `z` / `ContractApiError`） | 宿主产物、模块工程（`import { ... } from "@oj-module/runtime"`） |
| `@oj-module/cli` | **Node 工具链面**：`ojm dev/build/preview/api/vendor/...` + 预构建宿主（源码 `shell/`、产物 `shell-dist/`，含 importmap 与共享依赖单例） | 模块工程（开发、构建、发布） |

一句话记忆：**runtime（含契约层）跑在浏览器里组装页面；cli 既提供开发/构建工具链，也把「同一份依赖、同一份实例」的宿主产物发出去。**

### 0.3 依赖关系与构建顺序

```
cli ──► runtime ──► (宿主产物 shell-dist ／ 模块工程)
```

- **版本策略（lockstep 已落实）**：两包同为 **`0.1.8`**（`@oj-module` scope 首发为 0.1.5，其后按 lockstep 递增）；`cli` 对 `runtime` 写 `workspace:*`，发布时被 pnpm 改写成**精确版本 `0.1.8`**（不是 `^` 范围）——由 `tests/cli/release-manifest.test.ts` 真跑 `pnpm pack` 守护（**用 `npm publish` 会漏出 `workspace:*` / `catalog:` 字面量，务必走 `pnpm publish`**）。后续发版保持两包同版本号。
- **依赖方向只有这一条边，没有环**：宿主产物随 `cli` 发布，`ojm dev/build` 直接从 cli 包内 `shell-dist` 取宿主，不再有「先 build 宿主才能用 cli」的顺序约束。
- 手工重建顺序：`runtime` → `cli` 的 `build:shell`（会**顺带重建 runtime**，产出 `packages/cli/shell-dist`）→ `cli` 的 `prepack`（同步 `vendor/host-versions.json`，并断言宿主 runtime 版本 == `packages/runtime` 版本）。

```bash
# 只有改了 runtime 源码时才需要重建 runtime；cli 的 build:shell 内部已包含这一步
pnpm --filter @oj-module/runtime build      # src → dist/runtime.js + dist/index.d.ts + dist/contract/*
pnpm --filter @oj-module/cli build:shell    # 内含 runtime 构建 + host.js + importmap + 共享资产
```

### 0.4 术语表（第一次见的名词都在这）

| 术语 | 含义 |
| --- | --- |
| **模块（module）** | 一个业务功能的独立构建单元，`entry.ts` 导出 `defineModule({...})`。与「包（package）」不是一回事 |
| **entry.ts** | 模块的元数据唯一来源：name / version / routes / i18n / lifecycle |
| **契约（contract）** | `defineApi({...})` 定义的接口形状，由 cli 生成前端 client 与文档 |
| **apiPrefix** | 模块的 API 前缀（如 `/home`）；模块必须 `ctx.register.apiPrefix` 登记，请求只能落在该前缀内 |
| **oj** | 后端框架（Rust + JS bridge），业务代码写在 `api/src/<模块>/<端点>/api.ts` |
| **信封（envelope）** | oj 统一响应格式 `{ code, msg, data }`，`code=0` 表示成功 |
| **`ojm`（命令）** | cli 的唯一命令名（`ojm dev/build/api/...`）。旧名 `ram` 是**弃用别名**：打印更名警告后转发，下个 major 移除（P3） |
| **宿主（host）** | 预构建的静态站点骨架。**不再是独立包**：源码在 `packages/cli/shell/`，产物在 `packages/cli/shell-dist/`，随 cli 发布（P1） |
| **importmap** | 浏览器原生机制，把裸说明符（`react`、`antd`）映射到宿主预构建的单份资产 |
| **`SHARED_DEPS`** | 共享依赖单一来源（`packages/cli/src/shared-deps.ts`）：同时生成宿主入口、importmap、external 判定、版本门禁 |
| **单例（singleton）** | 全站只有一份 react / antd / runtime 实例；多份会导致 Context 撕裂、`instanceof` 失效 |
| **dist** | 构建产物。`packages/runtime/dist` 与 `packages/cli/shell-dist` 都**随仓库提交**（`.gitignore` 开例外）；`shell-dist/**/*.map` 除外，且不发 npm 包 |

### 0.5 环境准备与「5 分钟跑起来」

```bash
# 前置：Node 18+、pnpm（仓库声明 packageManager: pnpm@11）
git clone <repo> && cd react-antd-module
pnpm install

# 方式 A：跑「框架自带 App」（monorepo 根，vite 直接起）
pnpm dev            # 默认 http://localhost:5173

# 方式 B：跑「模块工程全栈」（更接近外部工程，推荐新人用这个）
cd apps/playground-oj
pnpm dev            # = ojm dev，默认 http://localhost:5174
```

浏览器打开 `http://localhost:5174`，用 `admin / 12345` 登录（账号来自 `apps/playground-oj/api/src/web/seed.sql`）。

第一次跑起来后，建议先体验一遍，建立直觉：

1. 左侧菜单点几个页面 → 顶部页签出现；点页签上的 `×` 能关闭；
2. 打开浏览器 DevTools → Network，刷新页面，观察 `modules.json`、`versions.json`、各模块 `entry.js` 的加载顺序；
3. DevTools → Console 执行 `document.querySelectorAll('script[type=importmap]')[0].textContent`，看一眼 importmap 长什么样。

### 0.6 通用红线（动手前先记住）

1. **共享依赖只能有一个版本**：安装走 `catalog:`，产物走宿主（cli 内置 `shell-dist`）的 importmap 单例。私自写死 `react@18` 会导致「双 React」崩溃（详见第 3 章）。
2. **`packages/runtime/dist`、`packages/cli/shell-dist` 随仓库分发**，`.gitignore` 为它们开了例外。**改了源码必须重建并提交 dist**，否则本地/CI 跑的是旧产物（历史上多次出现「方法不存在」）。
3. **不要绕过门禁**：宿主的导出完整性检查、动态 require 检查、版本矩阵校验都是硬门，失败要查根因，别 `--no-verify` 或注释断言。
4. **改公开出口是破坏性变更**：runtime 出口有「冻结契约」测试（`tests/runtime/runtime-exports.test.ts`），加/删导出会让它红，属预期。

### 0.7 跟着做：从契约到页面（端到端 15 分钟）

下面这条链路是本仓库最核心的工作流，两个包都会经过一遍。我们新增一个 `GET /api/demo/todos` 接口并渲染它（仓库里已有同名实现，可对照 `apps/playground-oj/api/src/demo/`）。

**① 写后端实现（oj）** —— `apps/playground-oj/api/src/demo/todos/api.ts`：

```ts
// GET /api/demo/todos —— Bearer 守卫保护；keyword 模糊过滤 title
export default {
  async get() {
    const kw = http.query.keyword;                       // 查询参数
    const where = kw ? "WHERE title LIKE ?" : "";
    const params = kw ? [`%${kw}%`] : [];
    const rows = await db.query(
      `SELECT id, title, done FROM todos ${where} ORDER BY id ASC`,
      params,
    );
    const totalRows = await db.query(`SELECT COUNT(*) AS c FROM todos ${where}`, params);
    json.ok({                                            // 信封：{ code:0, data }
      list: rows.map(r => ({ id: Number(r.id), title: String(r.title), done: Number(r.done) === 1 })),
      total: Number(totalRows[0]?.c ?? 0),
    });
  },
};
```

> oj 注入的全局：`db`、`kv`、`json`、`http`、`jwt`、`bcrypt`、`crypto`。端点文件默认导出一个对象，键是 HTTP 方法（`get`/`post`/`put`/`del`…）。详见 `bin/devkit/api-manual.md`。

**② 写契约** —— `apps/playground-oj/api/src/demo/contract.ts`：

```ts
import { defineApi, z } from "@oj-module/runtime/contract";

export const getTodoList = defineApi({
  apiPrefix: "/demo",                 // uni-dev 形态：必须字面等于目录名 "demo"
  route: "/todos",                    // 相对 apiPrefix
  query: z.object({ keyword: z.string().optional() }),
  data: z.object({
    list: z.array(z.object({
      id: z.number(),
      title: z.string(),
      done: z.boolean(),
    })),
    total: z.number(),
  }),
  description: "演示待办列表",
});
```

**③ 生成前端 client**：

```bash
cd apps/playground-oj
pnpm exec ojm api         # 也可 npx ojm api；仓库内用 node ../../packages/cli/bin/ojm.mjs api
# 产物：web/src/demo/client/api.ts（+ api.schemas.ts）、api/src/demo/routes.json、openapi.yaml
```

**④ 在模块里注入请求能力** —— `web/src/demo/entry.ts`（`defineModule` 的 `lifecycle.onInit`）：

```ts
import { defineModule } from "@oj-module/runtime";
import { bindRequest } from "./api/client";

export default defineModule({
  name: "demo",
  version: "0.1.0",
  routes: [/* ...见 2.4... */],
  lifecycle: {
    async onInit(ctx) {
      ctx.register.apiPrefix("/demo");   // ① 先登记前缀
      bindRequest(ctx.utils.request);    // ② 再把 scoped request 交给生成的 client
    },
  },
});
```

**⑤ 页面里调用**：

```tsx
import { getTodoList } from "../api/client";

export default function DemoPage() {
  const [list, setList] = useState<GetTodoListData["list"]>([]);
  useEffect(() => {
    getTodoList({ keyword: "" }).then(d => setList(d.list));
  }, []);
  return <BasicTable /* ... */ />;
}
```

**⑥ 验证**：`pnpm dev` 起来后登录，Network 里应看到 `GET /api/demo/todos → 200`，信封 `code:0`；页面渲染出列表。

---

## 第 1 章 `@oj-module/runtime/contract`：契约层

> P1 起 contract 并入 runtime 包、作为子路径出口（`./contract`、`./contract/errors`）：源码在 `packages/runtime/contract/`，产物在 `packages/runtime/dist/contract/`。原独立 `@oj-module/contract` 包已取消。

### 1.1 职责

把「一个 HTTP 端点」变成**可在编译期/生成期消费的结构化定义**，并给前端一个统一的错误类型。它必须**零浏览器依赖**（Node 代码生成与浏览器运行时都能安全 import）。

### 1.2 目录速查

```
packages/runtime/contract/
├── index.ts               # 公开出口（defineApi / z / ContractApiError / ScopedRequestLike）
├── define-api.ts          # defineApi + 定义期校验
├── errors.ts              # ContractApiError（zod-free 子路径出口的载体）
└── scoped-request-like.ts # 生成 client 依赖的最小 request 结构类型
```

由 `packages/runtime/tsconfig.contract.json` 编成 `dist/contract/*.js + *.d.ts`；`runtime` 的 `exports` 开放 `./contract` 与 `./contract/errors` 两个子路径。**`./contract/errors` 刻意 zod-free**（zod 只随 runtime dist 走，见 `@oj-module/runtime` 的 `z` re-export）。

### 1.3 完整字段说明

`defineApi(def)` 接受 `ApiDefinitionInput`：

| 字段 | 必填 | 说明 | 例子 |
| --- | --- | --- | --- |
| `apiPrefix` | ✅ | 模块前缀，`/` 开头。uni-dev 形态必须字面等于 `api/src/<目录名>` | `"/home"` |
| `route` | ✅ | 相对 `apiPrefix` 的路由，`/` 开头。支持 `{id}` / `{*path}` 参数段 | `"/pie"`、`"/{id}"` |
| `method` | | HTTP 方法，缺省 `"GET"` | `"POST"` |
| `query` | | 查询参数 schema（URL 序列化由生成物负责） | `z.object({ by: z.string() })` |
| `params` | | 路径参数 schema，须与 route 参数段一一对应 | `z.object({ id: z.string() })` |
| `body` | | 请求体 schema | `z.object({ range: z.string() })` |
| `data` | | 响应信封 `data` 部分的 schema | `z.array(pieData)` |
| `response` | | 仅支持 `"raw"`：二进制/非信封逃生口，不解包、不校验、不进 mock | `response: "raw"` |
| `ignoreLoading` | | `true` 表示该请求不触发全局加载条 | `ignoreLoading: true` |
| `description` | | 接口描述，进 OpenAPI 文档 | `"首页饼图数据"` |

### 1.4 一个真实的契约文件

`apps/playground-oj/api/src/home/contract.ts`（可直接照抄改写）：

```ts
import { defineApi, z } from "@oj-module/runtime/contract";

/** 饼图单项：value 数值 + code 维度键 */
const pieData = z.object({ value: z.number(), code: z.string() });

/* 饼图数据（GET，query 参数） */
export const fetchPie = defineApi({
  apiPrefix: "/home",
  route: "/pie",
  query: z.object({ by: z.union([z.string(), z.number()]) }),
  data: z.array(pieData),
  description: "首页饼图数据",
});

/* 折线图数据（POST，请求体） */
export const fetchLine = defineApi({
  apiPrefix: "/home",
  route: "/line",
  method: "POST",
  body: z.object({ range: z.string() }),
  data: z.array(z.number()),
  description: "首页折线图数据",
});
```

### 1.5 定义期校验：把错误挡在最早

`defineApi` 会在**定义期**（import 时）做校验，违反直接抛错。这是**故意前置**，避免拖到 codegen 才炸：

```ts
// ❌ 全部会在 import 时抛错
defineApi({ apiPrefix: "home", route: "/pie" });        // apiPrefix 必须以 "/" 开头
defineApi({ apiPrefix: "/home", route: "pie" });        // route 必须以 "/" 开头
defineApi({ apiPrefix: "/home", route: "/a/../b" });    // 含路径穿越段
defineApi({ apiPrefix: "/home", route: "/{id}.json" }); // 参数段混字面（matchit 约束）
defineApi({ apiPrefix: "/h", route: "/x", data: z.string(), response: "raw" }); // 二者互斥
defineApi({ apiPrefix: "/h", route: "/x", method: "OPTIONS" });  // 不支持 OPTIONS
defineApi({ apiPrefix: "/h", route: "/x", method: "HEAD", data: z.string() }); // HEAD 无响应体
```

错误消息都带修复指引，例如：

```
[契约] 端点定义非法（route: /{id}.json）：参数段 "{id}.json" 混入字面量——
matchit 约束：参数段必须整段为 {name} 或 {*name}，需要前缀/后缀字面时请拆成静态多段。
```

`defineApi` 还会给结果打上 `Symbol.for("ojm.api.def")` 品牌（非枚举），供生成器可靠识别端点，不与契约文件里普通 schema 混淆。

### 1.6 契约被谁消费

`ojm api`（见第 4 章）会 `discover → evaluate → IR → emit`，产出：

| 产物 | 落点（uni-dev 形态） | 用途 |
| --- | --- | --- |
| `client.ts` | `web/src/<模块>/client/` | 前端调用函数（`getTodoList(...)`） |
| `api.schemas.ts` | `web/src/<模块>/client/` | zod schema，DEV 期响应校验 |
| `routes.json` | `api/src/<模块>/` | 路由清单（对账用） |
| `openapi.yaml` | `api/src/<模块>/` | 接口文档 |
| stub `api.ts` | `api/src/<模块>/<端点>/` | 端点骨架（仅在缺失时新建） |

**生成的 `client.ts` 长什么样**（`web/src/demo/client/api.ts` 摘录）：

```ts
import { ContractApiError } from "@oj-module/runtime/contract/errors";
import type { ScopedRequestLike } from "@oj-module/runtime/contract/errors";
import type { z } from "@oj-module/runtime";
import type { schemas } from "./client.schemas";

interface OjEnvelope<T> { code: number, msg?: string, data?: T }
let req: ScopedRequestLike | undefined;

/** 模块入口 onInit 里调用：bindRequest(ctx.utils.request) */
export function bindRequest(r: ScopedRequestLike): void { req = r; }

export type GetTodoListQuery = z.input<(typeof schemas)["getTodoList"]["query"]>;
export type GetTodoListData = z.infer<(typeof schemas)["getTodoList"]["data"]>;

export async function getTodoList(query: GetTodoListQuery): Promise<GetTodoListData> {
  const client = ensureReq();
  try {
    const env = await client.get(`demo/todos`, { searchParams: query as any }).json<OjEnvelope<GetTodoListData>>();
    if (typeof env.code === "number" && env.code !== 0)
      throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
    const data = env.data as GetTodoListData;
    if (import.meta.env.DEV) {                       // DEV 才做响应校验，生产零成本
      const { schemas } = await import("./client.schemas");
      const r = schemas.getTodoList.data.safeParse(data);
      if (!r.success) throw new ContractApiError(-1, `[契约违例] …${r.error.message}`);
    }
    return data;
  }
  catch (e) { throw await toApiError(e); }            // ky HTTPError → ContractApiError
}
```

**要点**：生成物首行是 `/* eslint-disable */`，**不要手改**，要改就改契约文件后重跑 `ojm api`。

### 1.7 错误处理

所有请求失败最终都会归一成 `ContractApiError`，含 `code`（oj 信封 code 或 `-1`）与 `msg`：

```tsx
import { ContractApiError } from "@oj-module/runtime/contract/errors";

try {
  await getTodoList({ keyword: "" });
}
catch (e) {
  if (e instanceof ContractApiError) {
    // e.code === 401 未登录 / 403 越权 / 500 服务端错误 / -1 契约违例或未绑定请求
    antd.message.error(e.msg);
  }
  else throw e;
}
```

> `instanceof` 要求**单例**：`@oj-module/runtime/contract/errors` 是硬共享依赖（宿主 importmap 提供），不要在模块里自带副本。

### 1.8 改动落点

- **新增校验规则** → `src/define-api.ts` 的 `validateDefinition`。
- **新增公开导出** → `src/index.ts`，并同步给 runtime（如需浏览器侧写契约）。
- **改错误类型** → `src/errors.ts`。runtime 与模块工程都会 `instanceof ContractApiError`，要考虑向后兼容。

### 1.9 本地验证

```bash
pnpm test tests/contract     # define-api 定义期校验
pnpm test tests/cli          # cli 的 contract-* 用例大量消费本包（含快照）
```

### 1.10 常见坑

- 改了 `defineApi` 校验规则后，**cli 的 contract 代码生成快照会变**（`tests/cli/__snapshots__`），需一并更新。
- 本包版本会写进 runtime 的 `peerDependencies`；contract 未发布会导致下游装不上（见附录 A 的真实事故）。
- `route` 一律**相对 apiPrefix**，不支持 oj 的根绝对写法；想写 `/api/xxx` 会被校验拦下。

---

## 第 2 章 `@oj-module/runtime`：运行时框架

### 2.1 职责

浏览器侧的「框架本体」：加载外部模块、驱动生命周期、组织路由/布局/状态、收敛模块请求、携带样式与声明。模块工程 **只允许** import 这一个框架入口。

### 2.2 目录速查

```
packages/runtime/
├── src/index.ts          # 【库入口】公开出口（模块作者唯一该 import 的入口）
├── src/index.tsx         # 【应用入口】setupApp()：加载清单、挂载 #root（本仓库自用/App 链）
├── src/module-loader/    # 模块加载：define-module / types / slots / keep-alive / semver
├── src/router/           # 路由、守卫、baseRoutes、resolve-login-route
├── src/layout/           # 布局：layout-root / header / tabbar / fullscreen / ContainerLayout
├── src/store/            # zustand：auth / user / access / preferences / tabs / api-provider
├── src/utils/request/    # request（全局）+ scoped（按模块 apiPrefix 收敛）
├── src/components/       # BasicTable / BasicContent / AccessControl 等
├── src/locales/          # i18n 初始化与框架文案
├── vite.config.ts        # lib 构建（入口 src/index.ts）
└── scripts/              # rewrite-dts-specifiers.mjs、inline-css.mjs
```

### 2.3 双入口，别搞混

| 入口 | 文件 | 角色 | 是否进 npm 产物 |
| --- | --- | --- | --- |
| 库入口 | `src/index.ts` | 模块作者的公共 API（组件/hooks/store/类型） | ✅ 是（`vite.config.ts` 的 `build.lib.entry`） |
| 应用入口 | `src/index.tsx` | `setupApp()`：拉清单 → `loadAll` → 挂载 `#root` | ❌ 否（仅本仓库 App 链用） |

**给新人的判断法**：你要给「模块作者」用的东西加在 `src/index.ts`；你要改「框架自己怎么启动」看 `src/index.tsx`。

### 2.4 第一个模块：完整 `entry.ts`

`defineModule` 是模块契约的唯一入口（编译期收窄类型，构建期 cli 据此读 name/version）：

```ts
import { FileTextOutlined, HomeOutlined } from "@ant-design/icons";
import { defineModule } from "@oj-module/runtime";
import { createElement } from "react";
import { Navigate } from "react-router";

import { bindRequest } from "./api/client";
import DemoPage from "./pages/index";

export default defineModule({
  name: "demo",
  description: "垂直切片演示模块",
  version: "0.1.0",
  peerRuntime: ">=0.0.0",              // 兼容的宿主 runtime 版本（semver 范围），不兼容会被拒绝加载
  routes: [
    {
      path: "/demo",
      handle: {
        layout: "container",           // ⚠️ 缺了它页面会「裸奔」（无 header/sidebar/tabbar），keepAlive 也会失效
        order: 100,                    // 菜单排序
        title: "demo:menu.demo",       // i18n key（命名空间:key）
        icon: createElement(HomeOutlined),
      },
      children: [
        { index: true, element: createElement(Navigate, { to: "/demo/todos", replace: true }) },
        {
          path: "todos",
          Component: DemoPage,
          handle: { title: "demo:menu.todos", icon: createElement(HomeOutlined), keepAlive: true },
        },
      ],
    },
  ],
  i18n: {
    "zh-CN": () => import("./locales/zh-CN.json"),
    "en-US": () => import("./locales/en-US.json"),
  },
  lifecycle: {
    async onInit(ctx) {
      ctx.register.apiPrefix("/demo");   // ① 先登记前缀（D11）
      bindRequest(ctx.utils.request);    // ② 再把 scoped request 交给生成的 client（AC-D8）
    },
  },
});
```

**只允许 import 三类东西**：`@oj-module/runtime`、共享依赖（react / antd / icons…，由宿主 importmap 提供）、模块自身的相对路径。**不出现任何 `#src/*` 或框架内部路径**（构建期会拦）。

### 2.5 `ModuleContext.register` 全解

生命周期回调拿到的 `ctx` 提供：

| 能力 | 签名 | 用途 | 例子 |
| --- | --- | --- | --- |
| `apiPrefix` | `(prefix: string) => void` | 登记 API 前缀，之后才能发请求 | `ctx.register.apiPrefix("/demo")` |
| `store` | `(name, store) => void` | 注册模块自己的 zustand store | `ctx.register.store("demo", useDemoStore)` |
| `authProvider` | `(provider) => void` | 接管登录/登出/用户信息（先到先得） | 见 `module-development-guide.md` §3.6 |
| `systemApi` | `(provider) => void` | 接管角色/菜单类 API | 见 `apps/playground-oj/web/src/system` |
| `notificationsApi` | `(provider) => void` | 接管通知拉取 | 见 `.../notification` |
| `uploadApi` | `(provider) => void` | 接管头像/附件上传端点 | 见 `.../personal-center` |
| `registerSlot` | `(slotName, node) => void` | 注册布局插槽节点，卸载自动清理 | `ctx.registerSlot("header-right", <MyBtn/>)` |

> `ctx.utils.request` 是**按模块收敛**的 scoped client，不是全局 request。越界请求在客户端即被拒绝。

### 2.6 生命周期时序

```
beforeInit → onInit → onActivate → onDeactivate → onDestroy
   │           │         │            │              │
   │           │         │            │              └ 卸载：注销 provider/store/插槽
   │           │         │            └ 模块失去激活（切走）
   │           │         └ 模块被激活
   │           └ 注册能力（apiPrefix/store/provider）——最常用
   └ 依赖模块已加载后、注册能力前（一般不用）
```

模块状态见 `ModuleInstance.status`：`pending | loading | loaded | active | error | missing-deps`。**依赖缺失不会半加载**（`missing-deps`）。

### 2.7 路由与 `RouteMeta`

| `handle` 字段 | 说明 |
| --- | --- |
| `title` | 页面/菜单标题，支持 i18n key |
| `icon` | 菜单图标（`createElement(XxxOutlined)`） |
| `order` | 菜单排序 |
| `layout` | `"container"`（完整 chrome）/ `"parent"`（父级布局）/ `"fullscreen"`（全屏外壳，登录页）/ `"none"` |
| `keepAlive` | 是否缓存页面（**必须挂在 `layout:"container"` 下才生效**） |
| `hideInMenu` | 不在侧边栏显示 |
| `roles` / `permissions` | 页面级 / 按钮级权限 |
| `login` / `internal` | 登录页标记 / 内置兜底标记（由 `resolveLoginRoute` 消费） |

> 布局是**显式声明**，不做隐式推导（设计决策 D9）。新增模块路由的第一件事就是补 `layout`。

### 2.8 状态 store 与 access 不变量

框架用 zustand；模块常直接消费：

```tsx
import { useUserStore, useAuthStore, usePreferences } from "@oj-module/runtime";

const user = useUserStore(s => s.username);
const isDark = usePreferences(s => s.isDark);
```

**access store 不变量**：「模块路由一经登记即持续可用」。`reset()`（登出时）会清空动态路由，但会按快照**重新登记模块路由**，保证宿主链（无 AuthGuard）重新登录后菜单不空白。细节见 `src/store/access.ts` 与 `tests/runtime/access-store-reset.test.ts`。

### 2.9 请求收敛（scoped request）

模块必须在 `onInit` 里先登记 `apiPrefix`，再发请求。否则会**同步抛出**：

```
Uncaught Error: [module] 模块 "home" 尚未登记 API 前缀：
请先在生命周期中调用 ctx.register.apiPrefix("/your-prefix") 再发起请求。
```

正确姿势：

```ts
// entry.ts
async onInit(ctx) {
  ctx.register.apiPrefix("/home");
  homeClient.bindRequest(ctx.utils.request);   // 生成的 client 持有 scoped request
}

// 页面里
import { fetchPie } from "../api/client";
fetchPie({ by: "all" });  // 落在 /home/*，越界会被拒
```

### 2.10 构建与 dist 约定

```bash
pnpm --filter @oj-module/runtime build
# = vite build && tsc -p tsconfig.contract.json && tsc -p tsconfig.dts.json \
#   && node scripts/rewrite-dts-specifiers.mjs && node scripts/inline-css.mjs
#   顺序有讲究：contract 的 d.ts 必须先于主 d.ts 产出（主 d.ts 会引用 ./contract 子路径）
```

- **裸说明符一律 external**（交给宿主 importmap）；`#src/*`、`~icons/*`、`zod` 例外，构建期内联。
- 构建期注入 `VITE_*`（读仓库根 `.env`）与 `__APP_INFO__`，让产物**自包含**，宿主无需再 define。
- contract 子路径编成 `dist/contract/`（`index` / `errors` / `define-api` / `scoped-request-like`），`exports` 开 `./contract` 与 `./contract/errors`。
- 产物必须能 `import` 即得完整样式（`styles/index.css` 被内联回 `runtime.js`，DOM 标记 `data-ojm-runtime-css`）。
- **`dist/` 必须提交**。

### 2.11 本地验证

```bash
pnpm test tests/runtime                            # 运行时单测全家桶
pnpm test tests/runtime/runtime-exports.test.ts    # 出口冻结契约
pnpm --filter @oj-module/runtime build     # 必须能过
pnpm test tests/shell/shell-importmap.test.ts      # runtime.js 与包 dist 一致性
```

### 2.12 常见坑

- **改源码忘重建 dist**：host/模块拿到的还是旧 `runtime.js`，表现为「方法不存在」。
- 往 `src/index.ts` 加浏览器专用重依赖会破坏「产物自携带」假设；先想清楚是否该走宿主共享依赖（`SHARED_DEPS`）。
- 删掉 `styles/index.css` 的 import 会让宿主链路视觉崩坏（`runtime-bundle-css` 测试守护）。
- 模块里误写 `#src/*` 会在构建期报错，改用 runtime 出口。
- 用旧 runtime 产物定义的端点打的是 `Symbol.for("ram.api.def")`：codegen 双符号识别仍能认出（P3 兼容），但**新代码一律用新符号**，别手动写旧符号。

---

## 第 3 章 `@oj-module/cli`：预构建宿主

> P1 起宿主并入 cli：源码在 `packages/cli/shell/`，产物在 `packages/cli/shell-dist/`（随 cli 发布）。本章讲的就是这两块；cli 的工具链部分见第 4 章。

### 3.1 职责

产出一个**静态站点骨架**：`index.html`（内联 importmap + CSP）+ 一堆**单入口共享依赖 ESM**（`assets/*.js`）+ `host.js` + `versions.json`。它保证宿主、runtime、各模块命中 **同一份** react/antd 实例（单例，否则 React Context 撕裂）。

### 3.2 目录与产物

```
packages/cli/shell/
├── src/host.tsx           # 宿主入口：拉 modules.json → 校验信任 → 注入 CSS/preload → loadAll → RouterProvider
├── src/manifest.ts        # 清单字段转换 + runtime 版本提取
├── src/preload.ts         # modulepreload 收集（带 sha384 integrity）
├── src/trust.ts           # 来源白名单（信任根）
├── src/csp.ts             # CSP 生成（构建期 nonce）
├── scripts/build.mts      # 【核心】预构建脚本
└── index.html             # 宿主模板（CSP / importmap 占位，构建期注入）

packages/cli/shell-dist/   # 【随仓库提交】build.mts 的产物
├── index.html             #   importmap + CSP
├── assets/*.js            #   每共享依赖一个单入口 ESM + ojm-* 子路径 shim + host.js/runtime.js
└── versions.json          #   版本矩阵（外部工程必须严格对齐）
```

### 3.3 importmap 是什么

浏览器原生能力：把裸说明符映射到 URL。宿主产物里生成的片段（节选）：

```html
<script type="importmap">
{
  "imports": {
    "react": "/assets/react.js",
    "antd": "/assets/antd.js",
    "@oj-module/runtime": "/assets/runtime.js",
    "antd/es/modal": "/assets/ojm-antd-es-modal.js",
    "@ant-design/icons/es/icons/CloseOutlined": "/assets/ojm--ant-design-icons-es-icons-CloseOutlined.js"
  }
}
</script>
```

于是模块里 `import { Button } from "antd"` 与宿主、runtime 拿到的是**同一个模块实例**。

### 3.4 共享依赖的单一来源

`packages/cli/src/shared-deps.ts` 的 `SHARED_DEPS` 同时生成「宿主预构建入口」「importmap」「external 判定」「版本校验」——**任何一侧手写清单都会漂移**。

```ts
// packages/cli/src/shared-deps.ts（节选）
export const SHARED_DEPS: SharedDepEntry[] = [
  { specifier: "react", asset: "react", hard: true },
  { specifier: "react-dom", asset: "react-dom", hard: true },
  { specifier: "@oj-module/runtime", asset: "runtime", hard: true },
  { specifier: "@oj-module/runtime/contract/errors", asset: "contract-errors", hard: true },
  { specifier: "antd", asset: "antd", hard: false },
  { specifier: "@ant-design/icons", asset: "icons", hard: false },
  { specifier: "zustand", asset: "zustand", hard: false },
  // …
];
```

**新增一个共享依赖的三步**：

1. 在 `SHARED_DEPS` 登记 `{ specifier, asset, hard }`；
2. 在 `pnpm-workspace.yaml` 的 `catalog` 登记版本；
3. 各包 `package.json` 改写成 `"catalog:"`（不要写死版本）。

> 漏改任一处，`tests/shell/host-version-drift.test.ts` 与 `tests/shell/version-gate.test.ts` 会红。

#### 3.4.1 矩阵全集：模块能 import 的裸说明符

模块**只允许 import 三类东西**：`@oj-module/runtime`、本矩阵内的包、自身相对路径（`#src/*` 等框架内部路径构建期会拦）。矩阵全集如下：

**硬共享**（模块不得自带；工程 `devDependencies` 版本须与宿主严格相等）：

```
react  react/jsx-runtime  react/jsx-dev-runtime  react-dom  react-dom/client
react-router  react-router/dom  @tanstack/react-query
@oj-module/runtime  @oj-module/runtime/contract/errors
@oj-module/runtime/contract   # 仅 Node 侧 codegen 用，浏览器无人 import
```

**软共享**（默认也由宿主 importmap 提供，scopes 允许多版本兜底）：

| 分类 | 裸说明符 |
| --- | --- |
| UI | `antd`、`antd/locale/zh_CN`、`antd/locale/en_US`、`antd/es/locale/zh_CN`、`@ant-design/icons`、`@ant-design/icons/es/components/Context`、`@ant-design/cssinjs`、`@ant-design/pro-components`、`antd-img-crop` |
| i18n | `i18next`、`react-i18next` |
| 状态 | `zustand`（含 `/middleware` `/shallow` `/vanilla` `/react` `/react/shallow` `/vanilla/shallow`）、`use-sync-external-store/shim` |
| 时间 | `dayjs`（含 `/plugin/{advancedFormat,customParseFormat,isoWeek,localeData,quarterOfYear,relativeTime,weekday,weekOfYear,weekYear}`） |
| 图表 | `echarts`、`echarts/charts`、`echarts/features.js`、`echarts-for-react` |
| 动画 / 交互 | `motion`、`motion/react`、`@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`、`keepalive-for-react`、`simplebar-react`、`react-jss`、`clsx`、`tailwind-merge`、`nprogress`、`nprogress/nprogress.css`、`spin-delay`、`react-error-boundary`、`react-countup` |
| 工具 | `ahooks`、`ky`、`pinyin-pro` |

**怎么查**：`pnpm exec ojm info` 打印「共享依赖版本矩阵（宿主 versions.json）」；权威清单见 `packages/cli/src/shared-deps.ts`（源码，含 `hard` 标记与深路径条目）与 `packages/cli/vendor/host-versions.json`（发布包内置的版本矩阵）。

> **类型从哪来**：矩阵只保证**运行时**由宿主 importmap 提供单例，工程 `node_modules` 里不一定有这些包。外部工程若要 `tsc` 通过，须把用到的包加进**自己的 `devDependencies`**（版本对齐宿主矩阵）。`ojm init` 生成的工程已为脚手架模板用到的那些（antd / react / @ant-design/icons / react-router / react-i18next / **echarts / echarts-for-react / react-countup / dayjs**）钉好版本——图表演示见模板 `web/src/home`。

### 3.5 硬共享 vs 软共享

| | `hard: true` | `soft`（`hard: false`） |
| --- | --- | --- |
| 例子 | react / react-dom / react-router / runtime / contract | antd / icons / zustand / dayjs |
| 破坏后果 | 直接崩（Context 撕裂、`instanceof` 失效） | 可能只是包体积/行为差异 |
| 模块工程约束 | **只能进 devDependencies**，且安装版本须与宿主严格相等 | importmap scopes 可多版本兜底 |

### 3.6 深路径兜底：最容易踩的坑

父包不透传的子路径，构建期会现场生成独立资产。**两种必须「修正 default」的情况**：

**（a）`antd/es/*`**：`antd` 父包 default 是**整包命名空间**，默认导入子路径会拿到命名空间而非组件（React #130）。用 `buildAntdSubpathAsset` 从父包取具名导出当 default。

**（b）`@ant-design/icons/es/icons/*`**：父包 `default` 是**通用 `<Icon/>` 壳**（没有 icon prop），而 antd 内部用**默认导入**取图标：

```ts
import CloseOutlined from "@ant-design/icons/es/icons/CloseOutlined";
```

若直接把这类深路径映射到 `/assets/icons.js`，`CloseOutlined` 会变成那个通用壳，渲染出**空的** `<span class="anticon">` —— 表现为页签关闭 `×` 消失、Typography 复制图标空白、Tabs「更多」图标空白。修复是生成按名取用的 shim（`buildIconsSubpathAsset`）：

```js
// packages/cli/shell-dist/assets/ojm--ant-design-icons-es-icons-CloseOutlined.js
import * as __icons from "@ant-design/icons";
const __d = __icons["CloseOutlined"] ?? __icons.default;
export default __d;
```

**（c）`@ant-design/icons/es/components/Context`** 需要独立的 Context 资产（在 `SHARED_DEPS` 里单独登记），否则 `IconContext.Provider` 为 `undefined`，ConfigProvider 一渲染就整页崩。

> 这三类问题都有回归守卫：`tests/shell/shell-importmap.test.ts` + `tests/e2e/verify-shell-iconcontext.mjs`。

### 3.7 宿主启动时序（host.tsx）

```
fetch modules.json + versions.json（并行）
  → assertTrustedModules（来源白名单）
  → 注入模块 CSS（插在宿主 CSS 之前，避免样式闪断）
  → modulepreload（带 sha384 integrity）
  → loadAll(manifest)
  → createBrowserRouter(getRoutes())
  → RouterProvider
```

```tsx
// packages/cli/shell/src/host.tsx（节选）
const [res, versionsRes] = await Promise.all([
  fetch(`${base}modules.json`),
  fetch(`${base}versions.json`).catch(() => null),
]);
assertTrustedModules(list);                       // 信任根：白名单校验
for (const { href, integrity } of collectPreloads(list)) { /* <link rel=modulepreload integrity=…> */ }
await loadAll(toLoaderManifest(list, runtimeVersion));
setRouter(createBrowserRouter([{ path: "/", element: <><LayoutEffects /><Outlet /></>, children: getRoutes() }]));
```

免登录演示宿主：播种 demo user，并在 token 变化时重播种（模块路由的重登记由 access store 快照机制负责）。

### 3.8 构建后的三道硬门禁

`assertSharedExportsComplete()` 任一不过直接构建失败：

1. **具名导出完整性** —— 否则浏览器抛 `does not provide an export named 'x'`（整页白屏）；
2. **裸说明符被 importmap 覆盖** —— 否则抛 `Failed to resolve module specifier`；
3. **无未垫片的动态 `require`** —— 否则抛 `Dynamic require of ... is not supported`。

> 注意：**构建成功 ≠ 能加载**。`export *` 经 external 子路径会退化成运行期对象（文件在、体积对、退出码 0，浏览器却白屏）。这就是门禁存在的原因。

### 3.9 本地验证

```bash
pnpm --filter @oj-module/cli build:shell
pnpm test tests/shell
node tests/e2e/verify-shell-iconcontext.mjs   # 已构建资产真实可加载 + IconContext/图标 default
```

### 3.10 常见坑

- 新增共享依赖漏了三处同步（见 3.4）。
- 忘了 `packages/cli/shell-dist` 随源码提交（改 `build.mts`/`host.tsx` 后必须重建）。
- `index.html` 的 nonce 每次构建都会变，属正常 diff。

---

## 第 4 章 `@oj-module/cli`：工程工具链（`ojm`）

> P1 起 cli 还承载预构建宿主（见第 3 章）。依赖方向只有 `cli → runtime` 一条边，宿主产物就放在 cli 包内 `shell-dist/`。

### 4.1 职责

给模块工程一条命令搞定：脚手架、开发服务器、构建、预览、契约代码生成、oj 下载、诊断。

### 4.2 目录速查

```
packages/cli/
├── bin/ojm.mjs            # 可执行入口（唯一命令名）
├── bin/ram.mjs            # 弃用别名 shim：stderr 警告后转发 ojm（下个 major 移除）
├── src/index.ts           # 命令分发（build/init/preview/dev/info/vendor/api/merge）
├── src/args.ts            # 参数解析（纯函数，便于测试）
├── src/usage.ts           # 用法文本
├── src/build.ts           # 模块构建 + 全站合并 + 元数据/清单
├── src/dev.ts             # 开发服务器装配（静态/SPA/注入、oj 反代、SSE 刷新、watch）
├── src/static-handler.ts  # 静态/SPA/importmap 注入（dev 的 hostRoots 钉死 cli 内置 shell-dist）
├── src/dev-proxy.ts       # /api 反代与 SSE（/__ojm_reload）
├── src/oj.ts / oj-config.ts / oj-cert.ts  # oj 后端进程生命周期
├── src/preview.ts         # 生产形态预览
├── src/init.ts            # 工程脚手架（模板 + 钉版）
├── src/vendor.ts          # oj vendor 下载（缺省 latest，可指定 tag）
├── src/shared-deps.ts     # 【共享依赖单一来源】importmap/宿主入口/external/版本门禁
├── src/versions.ts        # 宿主版本矩阵校验 + resolveShellDist（定位包内 shell-dist）
├── src/esm-exports.ts     # 构建后导出/裸说明符/动态 require 检查（宿主构建与 tests/shell 共用）
├── src/contract/          # 契约代码生成：IR / emit-* / check / mock / docs / watch
├── src/manifest.ts        # 清单合并与解析
├── src/info.ts            # ojm info（版本矩阵 + 模块清单，报障用）
├── shell/                 # 宿主源码（host.tsx / csp / trust / preload / scripts/build.mts）
├── shell-dist/            # 【随仓库提交】宿主预构建产物（importmap + 共享资产 + versions.json）
├── templates/             # 工程脚手架模板（api/ web/ 配置/ tsconfig…）
├── scripts/               # sync-host-versions.mjs（prepack：同步矩阵 + R5 断言）
└── vendor/host-versions.json  # 随包内置的宿主版本矩阵（prepack 自动同步）
```

### 4.3 `ojm` 命令详解

> 命令名统一为 `ojm`；旧名 `ram` 保留为弃用别名（打印警告后转发）。下面的 `ojm ...` 写 `ram ...` 也能跑通，但请尽早改掉。

**`ojm init [dir] [--yes]`** —— 幂等补缺脚手架，复制 `templates/`，并按下表钉死依赖版本。

| 依赖 | 钉版来源 |
| --- | --- |
| `@oj-module/cli` | cli 自身 `package.json` 版本 |
| `@oj-module/runtime` 与其余共享依赖 | 宿主版本矩阵 `shell-dist/versions.json`（该文件不可达时回退 `vendor/host-versions.json`） |

```bash
ojm init my-app --yes
# 产出：api/（oj 后端模板）、web/（模块模板）、web.config.ts、tsconfig.json…
# 含 api/.ojm-api-exempt.json（内置 auth/web/notifications handler 有意无契约）
```

**`ojm dev [port]`** —— 开发服务器（默认 5174）。

```bash
ojm dev        # /api 反代 oj；模块源码变更 → 重建 → SSE 刷新（/__ojm_reload）
# 静态解析：模块空间（/modules.json、/modules/*）取本地模块产物；
#          宿主空间（/、/index.html、SPA 回落）钉死取 cli 内置 shell-dist
```

**`ojm build`** —— 构建后端（`oj build`，零 DB 副作用）+ 前端全站合并。

```bash
ojm build      # 只有 build 会清场合并，产物在 web/dist（含宿主站点全量拷贝）
```

**`ojm preview [port] [--oj-static]`** —— 生产形态预览（migrate → oj server + 静态兜底）。

**`ojm api [dir] [--check] [--docs] [--exempt <path>]`** —— 契约代码生成与对账。

```bash
ojm api                 # 生成 client/schemas/routes.json/openapi.yaml/stub（幂等，未变不写盘）
ojm api --check         # 三重对账：生成物同步 / route 双向 / routes.js 无 drift
ojm api --docs          # 出自包含文档站（单文件离线可看）
```

**`ojm vendor [tag] [--force]`** —— 下载/重装 oj vendor。

```bash
ojm vendor              # 缺省取最新 release
ojm vendor v0.1.11      # 指定 tag
```

**`ojm info`** —— 版本矩阵 + 模块清单（报障第一命令）。

**`ojm merge <out> <in...>`** —— 合并多团队清单（R12）。

### 4.4 契约代码生成的发现规则

> 新人向全链路机制（evaluate → IR → 四产物 → stub → `--check` → 豁免清单）见
> [`ojm-api-codegen-guide.md`](./ojm-api-codegen-guide.md)。

`ojm api` 发现两档（缺省并扫，见 `src/contract/run.ts`）：

| 形态 | 契约位置 | 产物落点 |
| --- | --- | --- |
| **uni-dev**（前后端一体，推荐） | `api/src/<模块>/contract.ts` | client/schemas → `web/src/<模块>/client/`；routes.json/openapi.yaml → 契约旁；stub → oj 目录镜像树 |
| 纯前端 | `web/src/<模块>/client/contract.ts` | 四产物全部落契约同目录，无 stub |

**硬约束（AC-D9）**：uni-dev 形态下 `apiPrefix` 必须**字面等于**目录名，不符时人话报错：

```
[ojm-api] api/src/demo/contract.ts 端点 "getTodoList" apiPrefix "/todos" 与目录名 "demo" 不符——
uni-dev 形态要求字面相等（AC-D9），请改 apiPrefix 或移动契约目录。
```

写盘是**幂等**的：内容无变化不写盘，`RunResult` 会报告 `written` / `skipped`。

### 4.5 与其它包的边界

- **只有一个依赖边**：`cli → runtime`（`workspace:*`，发布转精确版本）。宿主产物（`shell-dist/`）与工具链同在 cli 包内，因此不存在「先构建 shell 才能用 cli」的顺序约束，也没有任何 `node_modules`/monorepo 路径回退。
- **`shared-deps.ts` 是跨包单一来源**：宿主构建（`build:shell`）、importmap、版本门禁都从它生成；改这里等于同时改「宿主产物」与「模块构建 external 集合」。
- **`prepack` 会跑 `scripts/sync-host-versions.mjs`**：从 `shell-dist/versions.json` 生成 `vendor/host-versions.json`，并断言**宿主 runtime 版本 == `packages/runtime` 版本**（设计 R5），不符即发布失败——防止发出「类型来自新版、实现来自旧宿主」的组合。
- `esm-exports.ts` 同时被宿主构建和 `tests/shell` 使用，**不要在两处各写一份正则**。

### 4.6 新增一个 `ojm` 子命令的清单

1. `src/index.ts` 的 `switch` 加分发；
2. `src/args.ts` 加参数解析（纯函数）；
3. `src/usage.ts` 补用法文本；
4. 新增一个 `tests/cli/<cmd>.test.ts`（命令逻辑尽量抽成可注入桩的纯函数）。

### 4.7 本地验证

```bash
pnpm test tests/cli                            # cli 全量单测
pnpm test tests/shell/shell-importmap.test.ts  # 门禁实现一致性
```

### 4.8 常见坑

- dev 服务器静态解析必须正确区分「本地模块产物」与「宿主产物」；`hostRoots` 钉死 cli 内置 `shell-dist`，避免 `ojm build` 的合并残留反向遮蔽宿主。
- 报错面向人话（默认不打印堆栈）；`OJM_DEBUG=1` 才输出堆栈（旧名 `RAM_DEBUG` 一并读）。
- 改了契约文件后忘了重跑 `ojm api`，前端 client 会与后端漂移；CI 用 `ojm api --check` 兜底。

### 4.9 命令与内部前缀改名（P3）与兼容读取

P3 把命令与内部前缀从 `ram` 全改为 `ojm`，但**兼容读旧名**——存量工程升级后不需要手改即可继续跑：

| 旧名（存量工程/产物） | 新名 | 兼容策略 |
| --- | --- | --- |
| 命令 `ram`、`bin/ram.mjs` | `ojm`、`bin/ojm.mjs` | `package.json#bin` 双提供；`ram` shim 打印更名警告后转发，**下个 major 移除** |
| `api/.ram-api-exempt.json` | `api/.ojm-api-exempt.json` | 双名读取（新名优先、旧名回退）；`ojm init` 只产新名 |
| stub 指纹头 `// ram-api:stub …` | `// ojm-api:stub …` | 读双前缀、写新前缀；「纯前缀升级」不计过期，`--check` 不误报，重跑即刷成新头 |
| `Symbol.for("ram.api.def")` | `Symbol.for("ojm.api.def")` | IR **双符号**识别；`defineApi` 新写只发新符号 |
| 环境变量 `RAM_DEBUG` | `OJM_DEBUG` | 双读（新名优先） |
| 日志/报错前缀 `[ram]`、`[ram-api]` | `[ojm]`、`[ojm-api]` | 纯文本，无兼容 |
| `.ram-tmp-*`、`.ram-shim-*`、`data-ram-css`、`data-ram-runtime-css` | `ojm-*`、`data-ojm-*` | 瞬时文件 / DOM 标记，无兼容 |
| 自动子路径资产名（`ram-antd-es-modal.js`、`ram--ant-design-icons-*`） | `ojm-*` | 宿主重建即改名，importmap 同步生成 |
| dev SSE 端点 `/__ram_reload(.js)` | `/__ojm_reload(.js)` | 同一次构建内自洽，无兼容 |

> 存量工程升级后建议跑一次 `ojm api`（把旧 stub 指纹头刷成新名）与 `ojm api --check`（应 `0 error`）。守卫用例见 `tests/cli/rename-compat.test.ts` 与 `tests/cli/package-guards.test.ts`。

---

## 附录 A：发布清单（含 staged publishing 踩坑）

```bash
# 0) 确认要发的包与版本；工作区干净
#    两包独立版本，但 cli 对 runtime 写精确版本（发布由 pnpm 改写 workspace:*）；
#    目标同版本号（见 §0.3 的版本策略说明）
# 1) 重建产物并同步 vendor（cli 的 build:shell 内含 runtime 重建）
pnpm --filter @oj-module/cli build:shell
node packages/cli/scripts/sync-host-versions.mjs
# 1b) 发布内容演练（不产生 tarball）——两包各断言一次
cd packages/cli && npm pack --dry-run --json --ignore-scripts | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s)[0].files.map(x=>x.path);console.log('maps',f.filter(x=>/\.map\$/.test(x)).length,'assets',f.filter(x=>x.startsWith('shell-dist/assets/')).length,'bin',f.includes('bin/ojm.mjs'),f.includes('bin/ram.mjs'))})" && cd ../..
cd packages/runtime && npm pack --dry-run --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s)[0].files.map(x=>x.path);console.log('non-dts .ts',f.filter(x=>/\.tsx?\$/.test(x)&&!/\.d\.ts\$/.test(x)).length,'src/',f.filter(x=>/(^|\/)src\//.test(x)).length)})" && cd ../..
#    期望：cli → maps 0 / assets 119 / bin[ojm]=true bin[ram]=true
#          runtime → non-dts .ts 0 / src/ 0
# 2) 提交（pnpm publish 默认要求工作区干净）
# 3) 按依赖序逐包发布（runtime → cli）
for p in runtime cli; do
  pnpm --filter "@oj-module/$p" publish --access public --no-provenance --no-git-checks
done
# 4) 复核（务必查 registry，不要只看 CLI 的 ✅）
for p in runtime cli; do
  curl -s "https://registry.npmjs.org/@oj-module%2f$p" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s).versions).join(' ')))"
done
```

**真实踩坑记录**：

- **选择性发布**：两包 lockstep（同版本号，当前 `0.1.6`），通常一起发；若只发其中一个，必须用 `--filter` 逐包发，且**先 `runtime` 后 `cli`**（cli 精确依赖 runtime）。
- 发布后**立刻**读 registry 可能仍是旧版本/404（CDN 传播延迟），不要据此判断失败。注意**元数据与 tarball 是两条缓存链**：`npm view` 可能已显示新版本，而 `.tgz` 仍 404（实测约 90s），此间 `npm install` 会报 `ETARGET` 或 tarball 404。确认发布请同时看 `dist-tags.latest` **与** tarball 状态（`curl -sL -o /dev/null -w '%{http_code}' <dist.tarball>`）；安装侧用 `--prefer-online`/新 cache 排除本地 packument 缓存。
- **安装源与发布源不是同一个**：仓库 `.npmrc` 把 `registry` 指向镜像加速（npmmirror），**发布**则走各包 `publishConfig.registry`（`registry.npmjs.org`）。所以 `npm view <pkg>`（读镜像）可能一直 404，别用它判断发布结果——**最可靠的确认是再发一次同版本**，返回 `403 You cannot publish over the previously published versions: x.y.z` 即已发布成功；或直接 `curl https://registry.npmjs.org/<scoped>%2f<name>` 看 HTTP 200。
- `pnpm publish` 遇到「版本已存在」会打印 `409 previously staged version` / `403 previously published versions`，其实是**已经发布成功**的报错文案，不要误判为卡在 stage；到 npmjs Staged Packages 页面确认即可。
- **顺序很重要**：`runtime` 未公开时，新发布的 `cli` 其精确依赖 `runtime@<新版本>` 会悬空，消费者直接装不上。
- **宿主完整性卡口**：`cli` 的 `prepack` 会断言 `shell-dist` 存在且其 runtime 版本 == `packages/runtime` 版本（设计 R5），不满足直接失败——防止发布出「类型来自新版、实现来自旧宿主」的组合。
- **sourcemap 不发版，且 `files` 取反有顺序语义**：`cli` 的 `package.json#files` 靠 `"!shell-dist/**/*.map"` 排除 117 个 `.map`。npm 按 `files` 出现顺序应用模式、**后者优先**，所以这条取反必须排在 `"shell-dist"` **之后**才生效（排前面等于没写，包体 3.85MB → 10.8MB）；因排序与 `jsonc/sort-array-values` 冲突，已对该文件单独关掉排序规则。另注意 **`files` 白名单内的文件无法被 `.npmignore` 排除**，别再尝试加 `.npmignore`（P5 实测）。
- `cli` 版本会被 `ojm init` 直接钉进新工程，且其 `templates/`（含 `env.d.ts`、`api/.ojm-api-exempt.json`）随之分发；发 cli 前建议按 [`framework-verification-playbook.md`](./framework-verification-playbook.md) 从零跑一遍。

## 附录 B：排障速查表

| 症状 | 常见原因 | 处理 |
| --- | --- | --- |
| `模块 "x" 尚未登记 API 前缀` | `onInit` 里漏了 `ctx.register.apiPrefix` | 补登记，再 `bindRequest` |
| `方法不存在` / 行为与源码不符 | 改了 runtime 源码没重建 dist | `pnpm --filter @oj-module/runtime build`（或 `cli build:shell`，内含此步） |
| 页面图标空白（关闭 ×、复制） | 图标深路径 default 退化 | 见 [3.6](#36-深路径兜底最容易踩的坑)，重建宿主 `pnpm --filter @oj-module/cli build:shell` |
| 整页白屏 + `does not provide an export named` | 共享资产零具名导出（A22） | 重建宿主，查 `tests/shell/shell-importmap.test.ts` |
| 整页白屏 + `Failed to resolve module specifier` | 裸说明符未被 importmap 覆盖 | 在 `SHARED_DEPS` 登记该深路径 |
| 组件拿到 `undefined` / React #130 | 子路径 default 是命名空间 | 用「修正 default」的 shim（见 3.6） |
| `Cannot read properties of undefined (reading 'Provider')` | IconContext 深路径被错映射 | 单独登记 `@ant-design/icons/es/components/Context` |
| 登录后菜单空白 | 宿主链无 AuthGuard 且路由被清 | 见 access store reset 快照（2.8） |
| `ojm api --check` 报 drift | 改了契约没重跑生成 | `ojm api` 后重新提交 |
| 执行 `ram ...` 打印「已更名为 ojm」 | 存量 scripts 仍用旧命令 | 改用 `ojm ...`（别名仍可用，下个 major 移除） |
| 存量工程首次 `ojm api --check` 报 stub 待更新 | 旧指纹头 `// ram-api:stub` | 跑一次 `ojm api` 刷成新头即可；纯前缀升级不再误报（P3） |
| 本地 `.bin/ojm` 不存在 / `pnpm install` 说 up to date | workspace 包 `bin` 变更不会触发 app 的 `.bin` 重建 | 删掉该 app 的 `node_modules` 再 `pnpm install`（陷阱 A36） |

## 附录 C：相关文档索引

- **双包整合与改名（本手册的结构依据）**：[`202609110947-oj-module-two-package-consolidation-design.md`](./202609110947-oj-module-two-package-consolidation-design.md)（§12 实施记录、§13 陷阱 A27–A40）
- **实战演练（从零搭 oj 前后端应用）**：[`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md)
- **端到端验证手册（升级后复跑）**：[`framework-verification-playbook.md`](./framework-verification-playbook.md)
- **oj release 二进制缺陷报告（可转上游）**：[`oj-release-binary-defect-report.md`](./oj-release-binary-defect-report.md)
- 模块开发（面向模块作者）：[`module-development-guide.md`](../archive/prd/module-development-guide.md)
- 框架 npm 包化交接与设计取舍：[`handover-framework-npm-package.md`](../archive/prd/handover-framework-npm-package.md)
- 模块化改造总览：[`modular-refactoring.md`](../archive/prd/modular-refactoring.md)
- 单例验证：[`singleton-verification.md`](../archive/prd/singleton-verification.md)
- runtime 公开 API 用量基线：[`runtime-api-usage.md`](../archive/prd/runtime-api-usage.md)
- uni-dev 前后端一体：[`uni-dev.md`](../archive/prd/uni-dev.md)
- oj 后端手册：`bin/devkit/api-manual.md`
- 产物级校验脚本：`tests/e2e/verify-shell-iconcontext.mjs`、`tests/shell/shell-importmap.test.ts`
