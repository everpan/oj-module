# ojm 模块开发手册

> 面向用 `ojm` 开发前后端一体工程的开发者。
> **按章节号按需读章，不要盲读全文。** 章节目录见文末索引，速查表见 §8。

后端 handler 内部写法（`json` 信封、`db`、`kv`、`jwt`、`manifest.yaml`、`oj test`）
属于 **`oj-api-dev` skill** 的范围；本手册讲的是它到前端这一侧的接线。

---

## §1 工程结构

### 1.1 脚手架产物

`ojm init <目录>` 生成（幂等补缺，重跑只补缺失文件，**永不覆盖已有文件**）：

```
<工程根>/
├── package.json           # scripts: dev / build / preview / info / typecheck，全部转发 ojm
├── web.config.ts          # 前端模块清单（name + entry + enabled）
├── tsconfig.json
├── global.d.ts            # 后端 oj 全局对象（db/json/http…）类型声明
├── env.d.ts               # ImportMeta.env 类型补丁
├── api/
│   ├── config.yaml        # oj 服务配置（端口、db、auth、secrets）
│   ├── config/            # dev 证书（public.pem / cert.jws）
│   ├── .ojm-api-exempt.json
│   └── src/
│       ├── _platform/     # 框架级共有表（users）
│       ├── auth/          # login / refresh / logout
│       ├── web/           # hello / user-info / get-async-routes
│       └── notifications/ # root 级 /api/notifications（通知铃兜底）
├── web/
│   ├── src/<模块>/         # 前端模块源码
│   └── dist/              # 构建产物（完整站点）
└── bin/                   # oj 二进制 + plugins/ + devkit/（不入库）
```

登录账号 `admin / 123456`。端口：前端 devServer **5174**，oj 后端 **9778**
（以 `api/config.yaml` 的 `server.port` 为准）。

### 1.2 两个模块体系，同名不同物

前后端各有自己的"模块"，目录名一致是**约定**（契约 AC-D9 会强制）：

| | 前端模块 | 后端模块 |
|---|---|---|
| 位置 | `web/src/<模块>/` | `api/src/<模块>/` |
| 入口 | `entry.ts`（`defineModule`） | `manifest.yaml` |
| 加接口 | 消费生成的 client | 写 `api.ts` handler |
| 注册处 | `web.config.ts` | 目录存在即注册（无需清单） |

### 1.3 后端路由 = 目录镜像

```
api/src/<模块>/<路径...>/api.ts   →   /api/<模块>/<路径...>
```

`api/src/web/hello/api.ts` → `GET|POST /api/web/hello`。
`api.ts` 默认导出一个对象，**方法名就是 HTTP 方法名**：
`get/post/put/patch/del`（注意是 `del`，**不是 `delete`**——写成 `delete` 返回 405）。

### 1.4 重启边界（最容易卡住新人的一点）

| 改动 | 生效方式 |
|---|---|
| 已有 `api.ts` 的**文件内容** | 保存即热更 |
| **新增/删除**后端模块目录 | **必须重启 `ojm dev`** |
| 改 `schema.yaml` / `migrations/` / `config.yaml` | **必须重启** |
| 前端 `web/src/**` | 模块重建 + 浏览器自动刷新 |

### 1.5 建一张新表：三个文件，缺一不可

新手最容易在这里少写文件——**加表不是只写 `schema.yaml`**。给一个模块加表要动三处：

| 文件 | 角色 | 规矩 |
|---|---|---|
| `api/src/<模块>/migrations/{seq:04}__{desc}.sql` | **DDL 真身** | **S006：DDL 只进 migrations**。序号连续且唯一，`CREATE TABLE IF NOT EXISTS` |
| `api/src/<模块>/schema.yaml` | 声明式表结构（喂归属图 / 列白名单） | 列名、null 性、默认值要与 migration **逐字段一致** |
| `api/src/<模块>/manifest.yaml` | `tables: [表名]` | **S005：与 `schema.yaml` 双向一致**，只写一边启动即失败 |

> 少了 migration → 表根本建不出来；少了 `schema.yaml` / `manifest.tables`
> → 归属校验失败；两边列定义漂移 → reconcile 报差异（`oj schema diff` 可见）。

### 1.6 迁移与 seed 的应用时机

| 文件 | 何时生效 |
|---|---|
| `migrations/*.sql` | 启动（dev `migrate_on_start: auto`）；release 默认 `verify`，账本落后则**拒绝启动** |
| `seed.sql` | **每次启动都重放**（sqlite 默认库）——必须幂等，用 `INSERT OR IGNORE` |
| `schema.yaml` | 声明；加可空列 / 加表 reconcile 能收敛，但**改类型与改名必须走 migrations** |

> `seed.sql` 按 `;` 朴素切分，**注释里不许出现分号字面量**，否则语法错。

---

## §2 写前端模块

### 2.1 目录

```
web/src/<模块名>/
├── entry.ts          # 元数据唯一来源（没有 package.json / meta.json）
├── pages/            # 页面组件（按需）
├── locales/          # zh-CN.json / en-US.json（按需）
└── client/           # ojm api 生成物（勿手改）
```

### 2.2 两步缺一不可

1. **有文件**：`web/src/<模块>/entry.ts` 默认导出 `defineModule({...})`；
2. **去登记**：工程根 `web.config.ts` 的 `modules` 数组加一项。

> 模板真出过这个 bug：模块文件都在，就是忘了登记，结果模块安静地没加载、
> 按钮安静地灰着，**全程没有一个报错**。写完模块第一件事就是检查 `web.config.ts`。

**建档顺序很重要**（有接口的模块）：先写 `contract.ts` → 跑 `ojm api` → 再写 `entry.ts`。
生成前 `import { createXxxClient } from "./client/api"` 必然 ts 报红，
那不是你写错了，是产物还没生成。完整流水线见 §3.4。

```ts
// web.config.ts
export default {
	baseUrl: "",
	modules: [
		// home 必须保留且尽量靠前：shell 预构建把 "/" → VITE_BASE_HOME_PATH（=/home）
		// 重定向，缺 /home 路由会让登录回跳 / 点 logo 落错误边界。
		{ name: "home", entry: "web/src/home/entry.ts", enabled: true },
		// login 必须保留：shell 宿主只消费模块路由、不挂 runtime 内置 baseRoutes，
		// 缺它 `/login` 无路由可跳（登出会落空）。
		{ name: "login", entry: "web/src/login/entry.ts", enabled: true },
		{ name: "books", entry: "web/src/books/entry.ts", enabled: true },
	],
};
```

**清单先后顺序 = 抢活优先级**（§4.2）。

### 2.3 entry.ts 形状

```ts
import { BookOutlined } from "@ant-design/icons";
import { defineModule } from "@oj-module/runtime";
import { createElement, lazy } from "react";

import { createBooksClient } from "./client/api";

const Books = lazy(() => import("./pages/index"));

export default defineModule({
	name: "books",
	description: "图书管理",
	version: "0.1.0",
	peerRuntime: ">=0.1.0",        // 声明兼容的宿主 runtime 版本
	routes: [
		{
			path: "/books",
			handle: {
				layout: "container",       // ⚠️ 布局级路由必填（见 §5.1）
				order: 5,                  // 菜单排序
				title: "books:menu.books", // 命名空间语法 "<模块名>:<key>"
				icon: createElement(BookOutlined),
			},
			children: [
				{
					index: true,
					Component: Books,
					handle: { title: "books:menu.books", keepAlive: true },
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
			createBooksClient(ctx);   // 构造即接线，见 §3.4
		},
	},
});
```

`defineModule` 字段：`name`（= 目录名）、`description`、`version`、
`peerRuntime`、`routes`、`i18n?`、`lifecycle?`。

> 页面组件用**静态 import 或 `lazy()` 都行**：模板（`templates/web/src/*/entry.ts`）
> 用静态 import，多页面模块可对非首屏页面用 `lazy(() => import("./pages/x"))` 做代码分割。
> 单个页面就用静态 import，少一层间接。

### 2.4 路由 handle 字段（RouteMeta）

| 字段 | 说明 |
|---|---|
| `layout` | `"container"`（完整壳）\| `"parent"`（嵌套父级）\| `"fullscreen"`（全屏）\| `"none"`（默认，裸渲染）\| 自定义名（§5） |
| `order` | 菜单排序值 |
| `title` | 菜单标题，用 `"<模块名>:menu.<key>"` |
| `icon` | `createElement(XxxOutlined)` |
| `keepAlive` | 页面缓存（**必须挂在 `layout: "container"` 下才生效**） |
| `hideInMenu` | 不在菜单显示 |
| `roles` / `permissions` | 路由级权限（页面级 / 按钮级） |
| `iframeLink` | 内嵌 iframe 的外链地址 |

> 另有**模块级** `config.requiredRoles` / `config.requiredPermissions`——它在路由
> **注入之前**就筛掉（B16），与上面的路由级 `roles` / `permissions` 不是一回事。

### 2.5 无页面模块

只抢活、没有页面的模块（如通知）：`routes: []`，甚至整个 `lifecycle` 都可省略。

### 2.6 前端模块能 import 什么

**只有三类**：

1. `@oj-module/runtime`（含 `/contract`、`/contract/errors` 子路径）；
2. 宿主 **importmap 提供的共享依赖**；
3. 自身相对路径。

框架内部的 `#src/*` 在构建期被拦。共享依赖由宿主提供**单例**，
模块工程**不得**打包自己的副本——只在 `devDependencies` 里对齐版本（供 `tsc` 用）。

共享依赖矩阵关键项：`react`、`react-dom`、`react-router`、`@tanstack/react-query`、
`antd`（含 `locale/*`）、`@ant-design/icons`、`@ant-design/pro-components`、
`i18next`、`react-i18next`、`zustand`、`dayjs`、`echarts`、`echarts-for-react`、
`motion`、`@dnd-kit/*`、`keepalive-for-react`、`simplebar-react`、`nprogress`、
`react-countup`、`ahooks`、`ky`、`clsx`、`tailwind-merge`、`pinyin-pro`。
查实际矩阵：`pnpm exec ojm info`。

> **`@oj-module/runtime` 到底导出哪些东西？** 权威清单随包发布在
> `node_modules/@oj-module/runtime/dist/index.d.ts`——直接 Read 它，或在编辑器里
> 对 `from "@oj-module/runtime"` 用「跳转到定义 / 自动补全」。**别靠猜**：
> `BasicContent` / `BasicTable` / `AccessControl` / `useAuthStore` / `useUserStore` /
> `usePreferences` 都在里面（详见 §6.3）。猜不到的常见后果是白白退回 antd 原生
> `Table` 重新造轮子。

---

## §3 契约与代码生成

### 3.1 一句话

`ojm api` 读**契约文件**（`contract.ts`），一次性生成前端调用代码、接口元数据、
后端 handler 骨架，让"前端调用的函数"与"后端暴露的路由"永远同源。

```
contract.ts ──evaluate──► IR ──emit──► 四产物 + stub
```

### 3.2 契约 discovery 与产物落点

| 工程形态 | 契约位置 | 产物流向 |
|---|---|---|
| **uni-dev**（前后端一体，推荐） | `api/src/<模块>/contract.ts` | `api.ts` / `api.schemas.ts` → `web/src/<模块>/client/`；`routes.json` / `openapi.yaml` → 契约旁；stub → `api/src/<模块>/<路径>/api.ts` |
| 纯前端 | `web/src/<模块>/client/contract.ts` | 四产物全部落契约同目录，无 stub |

**硬约束 AC-D9**：uni-dev 形态下每个端点的 `apiPrefix` 必须**字面等于**后端目录名
（`api/src/order/contract.ts` → `/order`），不符即人话报错。

> 工程里有两个 "web"：前端 `web/`，与后端 `api/src/web/`（提供 user-info 等内置接口）。
> 豁免清单里的 `"modules": ["web"]` 指的是**后者**。

### 3.3 defineApi 字段

```ts
import { defineApi, z } from "@oj-module/runtime/contract";

const book = z.object({ id: z.number(), title: z.string() });

export const listBooks = defineApi({
	apiPrefix: "/books",              // 必填，"/" 开头
	route: "/list",                   // 必填，"/" 开头，相对 apiPrefix
	method: "GET",                    // 缺省 "GET"
	query: z.object({ keyword: z.string().optional() }),
	data: z.object({ list: z.array(book), total: z.number() }),
	ignoreLoading: true,              // 该端点不触发全局加载条
	description: "图书列表",           // 进 OpenAPI
});

// 另两个按需字段：
//   params: z.object({ id: z.number() })  —— 与 route 的 {id} 参数段一一对应
//   body: z.object({ title: z.string() }) —— 请求体（JSON）
//   response: "raw"                       —— 二进制/非信封逃生口，与 data 互斥
```

**上传文件（multipart/form-data）** —— `form`，与 `body` 互斥：文本字段走
`form.fields`（zod，字段名即表单部件名），文件部件只声明 `name` / `required` /
`multiple`（二进制进不了 JSON Schema，也不进白名单）：

```ts
export const uploadAvatar = defineApi({
	apiPrefix: "/personal-center",
	route: "/upload",
	method: "POST",
	form: {
		fields: z.object({ note: z.string().optional() }),
		files: [{ name: "avatar", required: true }, { name: "gallery", multiple: true }],
	},
	data: z.string(),                 // 上传端点照例可以带响应 data
});

// 调用形态（生成 client 内部组装 FormData）：
// await uploadAvatar({ fields: { note: "合同扫描件" },
//                      files: { avatar: file, gallery: [f1, f2] } });
```

**不要手写 `content-type`**：运行时（ky）见到 `FormData` 会自己补
`multipart/form-data; boundary=…`。后端 handler 侧用 `http.files`（元数据）/`http.file(i)`
（字节）读文件，文本字段落 `http.body.<name>`。

文本字段的取值：标量按 `String()` 发；**对象/数组自动 `JSON.stringify`**（多部件文本只能是
字符串，直接 `String({a:1})` 会静默变 `[object Object]`）。后端从 `http.body.<name>` 拿到的是
JSON 文本，需要结构就自己 `JSON.parse`（或干脆用单独的 JSON 端点发结构化数据）。

**定义期就会抛错**的写法（早炸好过晚炸）：

- `apiPrefix` / `route` 不以 `/` 开头；`route` 含 `../`、`./`、`\`；
- 参数段混字面：`{id}.json` 非法（matchit 约束——参数段必须**整段**为 `{name}` 或 `{*name}`，要前后缀就拆成静态多段）；
- `data` 与 `response: "raw"` 同时出现；
- `response` 取 `"raw"` 以外的值；
- `method: "OPTIONS"`（不在支持范围）；
- `method: "HEAD"` 且声明了 `data`（HEAD 无响应体）；
- `form` 与 `body` 同时出现；`form` 既无 `fields` 也无 `files`；`form.files` 缺 `name` 或字段名重复（重名要用 `multiple: true`）；`form.fields` 不是 `z.object`。

`data` 过**类型白名单**：不返回数据的接口**直接省略 `data`**，
写 `z.null()` 或 transform / refine 会被拒。校验放后端做。

### 3.4 生成物使用契约

生成的 `web/src/<模块>/client/api.ts` 导出：

- 裸请求函数（`fetchNotifications`、`markRead`…）——**直接 import 调用**；
- `API_PREFIX` 常量——契约前缀的唯一真源；
- `create<Module>Client(ctx)` 工厂——**构造即接线**，一行完成两件事：
  登记 `apiPrefix` + 把圈好前缀的 `ctx.utils.request` 绑给 client。

```ts
// entry.ts 的 onInit 里，创建一次
const booksClient = createBooksClient(ctx);
```

**关键约束**：

- **一模块一 client**，只在 `onInit` 创建一次。页面/组件/事件回调里**不要再创建**——
  生成物内部是 `let req` 单槽，后创建者覆盖先创建者。
- 创建后请求自动走 `/api/<前缀>/...`。**越界**调别家模块或 root 级接口、
  `../` 向外穿越、逐请求覆盖 prefix，都在发请求**之前**被客户端拒绝（前缀收敛 D11）。
- 忘创建就调裸函数 → 人话报错「请求未绑定」，指路 `create<Module>Client(ctx)`。
- 重复构造幂等安全；`onInit` 每模块只跑一次（HMR / StrictMode 不重复执行）。

> **生成 ≠ 使用。** `ojm api` 为**每个** `api/src/<模块>/contract.ts` 生成
> `web/src/<模块>/client/`，**不看有没有人 import**。所以「契约在、`client/`
> 目录却不在」只有一种解释：那个模块的 `client/` 从没生成过（模板里的
> personal-center 就是这样——它上传走 antd Upload 直连 `uploadApi.action`，
> 生成出来也没人用，故模板没签回）。你在自己工程跑一次 `ojm api`，它就会出现。
> 判断某模块**要不要用** client 的标准只有一个：代码里有没有人 import `./client/api`。
> 有就在 onInit 里 `create<Module>Client(ctx)` 一次；没有就什么都不写，
> 生成了但没人 import 也不报错。

> **只能认领自己的 client。** 工厂构造时核对 `ctx.module.name` 与契约前缀；
> 在 A 的 onInit 里创建 B 的 client，DEV 控制台警告「模块 A 正在认领 /b 的 client」。
> 跨模块认领会共享同一个 request 单槽，且 A 被卸载时 B 的 client 跟着断线。
> 要用别家的接口，正路是 **B 自己创建 client、经 provider 暴露能力，A 消费 provider**。

### 3.5 生成物勿手改

`client/api.ts`、`client/api.schemas.ts`、`routes.json`、`openapi.yaml`
**重跑即覆盖**（eslint 已忽略这些路径）。改需求 = 改契约，重跑 `ojm api`。

**唯一例外：stub。** `api/src/**/api.ts` 的 stub 文件头带指纹
（`// ojm-api:stub <name> sha256:...`）。人碰过的 stub，工具**永不写永不删**——
实现 handler 就是在 stub 里填业务逻辑。

生成是**幂等**的：内容逐字节比对，无变化不写盘，重复跑 `ojm api` 的 git diff 为空。

命名规则：生成的函数名 = 契约导出名（`listBooks`）；类型名 = 导出名 PascalCase +
`Query` / `Body` / `Form` / `Data`（`ListBooksQuery`、`CreateBookBody`、`UploadAvatarForm`、`ListBooksData`）。

### 3.6 命令

```bash
pnpm exec ojm api          # 生成
pnpm exec ojm api --check  # 四重对账（只读，永不修文件）
pnpm exec ojm api --docs   # 聚合 OpenAPI → redoc 静态站
```

`--check` 对四件事（只读，绝不写盘、绝不修文件）：

1. **生成物同步**：内存重生成 vs 磁盘逐字节 diff（含 stub 待更新检测）；
2. **route 双向对账**：AST 扫后端 `api.ts`（default 导出方法名 + `.route = "..."`
   赋值）vs 契约路由表——契约未实现 warn、handler 未登记 error、参数段不一致 error；
3. **`routes.js` diff**：`oj build` 产物路由表 vs `routes.json`；无 dist 给提示不判违规；
4. **WS 路由鉴权**：目录里的 `ws.ts` 会产生 `GET {base}/<模块>/<路径>/ws`——oj v0.1.30 起
   WS 握手也过鉴权守卫，不在 `auth.anonymous_paths` 里的 WS 会让未带凭据的客户端握手 401
   （表现为「文件在却连不上」）。只 warn（带 Bearer/Cookie 的受保护 WS 是正当用法）；
   读不到 config 就不判。

`ojm dev` 内置契约 watch：契约文件变更 → 自动重跑生成 → 产物落 `web/` 树
触发模块重建 + 浏览器刷新。

> ⚠️ **新模块目录的诞生不在 watch 范围**——新建模块的 `contract.ts` 要先重启
> `ojm dev`（目录注册发生在启动期），之后该模块的契约改动才走热更。

### 3.7 后端入参契约（`.schema`，v0.1.44）

契约里声明的 `params` / `query` / `body` 不只生成前端类型与校验——`ojm api` 还会把
它们落成后端 handler 上的 `.schema`，由 oj 在 **JS 之前**校验：违反即 `400` 信封，
handler 根本不会被调用。于是**一份契约同时给出**：前端 client 与类型、前端 DEV 期 zod
校验、后端入参校验、OpenAPI 文档。

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

开关在 `api/config.yaml` 的 `server.schema_validation`（默认 `true`，置 `false` 为逃生门）。
完整裁剪规则与降级表见 `ojm-api-codegen-guide.md` §4.5（白名单无 `format`/`oneOf`、
Rust regex 不支持零宽断言、params/query 只允许扁平标量等都在生成期拦下或告警）。

### 3.8 豁免清单 `api/.ojm-api-exempt.json`

把"确认无害"的对账差异从 error 降级为 skip（**只降级，绝不引入新错误**）：

```jsonc
{
	"_comment": "说明文字写这里——本文件是严格 JSON，写 // 注释会解析失败、豁免静默全失效！",
	"modules": ["web"],      // 整模块跳过（值 = api/src/<模块> 目录名）
	"paths": ["/auth/*"]     // /xxx/* 一层通配；其余为精确前缀
}
```

文件缺失或损坏时静默按空豁免处理。cli ≥ 0.1.5 的 `ojm init` 已内置该文件。

---

## §4 抢活（provider）

### 4.1 是什么

框架自带一批功能（登录、通知铃、头像上传、动态菜单…）。
Provider 就是：「这块别用框架自带的了，换我的。」你的模块在 `onInit` 里跟框架说一声，
框架以后要用该功能时来找你；没说的地方继续用自带。**框架代码一行不用改。**

### 4.2 都能抢什么（`ctx.register.*`）

| 入口 | 抢什么活 | 要提供什么 | 不抢时框架用啥 |
|---|---|---|---|
| `authProvider` | 登录、登出、查用户信息 | 3 个方法 | 自带登录接口 |
| `systemApi` | 角色、菜单管理 | 11 个方法 | 自带 |
| `notificationsApi` | 通知读和写 | 4 个方法：拉列表、标一条已读、全部已读、清空 | 自带**只读**接口（铃铛按钮变灰） |
| `uploadApi` | 头像/文件上传 | `action` + `headers()` | 自带 |
| `routesApi` | 登录后从后端拿菜单/路由 | `fetchAsyncRoutes` 1 个方法 | 自带 `web/get-async-routes` |
| `layout("名字", 组件)` | 换页面外壳 | 一个 React 组件 | 自带三种壳（§5） |
| `registerSlot(位置, 节点)` | 往页面头部塞自定义内容 | 一个 React 节点 | 空着 |
| `apiPrefix("/前缀")` | 圈定本模块 API 的家（报户口，非抢活） | `/` 开头的路径 | — |
| `store(名字, store)` | 注册额外 zustand store | 一个 store 实例 | — |

> `apiPrefix` 用生成 client 时**不用手写**——`create<Module>Client(ctx)` 构造时就替你登记了。

### 4.3 规矩

**① 什么时候报名：onInit 结束之前。** 框架等你 `onInit` 里的代码全部跑完
（含 `await`）才开始解析路由、渲染铃铛。所以 onInit 里直接注册稳，
先 `await import(...)` 加载个大组件再注册也稳；拖到 `onActivate` 或某个
不管不顾的异步回调里注册——不保证来得及。

**② 两个人抢同一入口：先到的赢。** 每个入口只认第一个报名的模块，第二个被忽略
并在控制台留一条警告（说清谁赢了）。**没有优先级数字可填——`web.config.ts`
里的排班顺序就是优先级。**

> 模块清单若是 `ojm merge` 合并出来的，谁前谁后取决于合并参数顺序。
> 两个团队合并顺序不同，赢的可能不是同一个——而且这事只在浏览器控制台里看得出来。

**③ 要抢就全抢。** 每个入口的方法一个都不能少——不能说"通知我只做读取、
写操作还用框架的"。接口以后升级加了新方法时，老模块会和新框架对不上，
这种升级要发版说明里专门提醒。

**④ 卸载自动归还。** 框架下线模块时会按模块名清掉它注册的 provider / 布局 / 插槽
（不误伤别人）。但**已渲染的页面不会自动换**——刷新才是全新开始。

**⑤ 老模块遇上新框架。** TypeScript 管不到已打包发布的老模块。框架用之前先挨个检查
方法在不在，缺了就提醒一次然后**降级成只读**，不会崩。你自己写模块时把
`peerRuntime` 标对版本就行。

### 4.4 案例：接管通知（标准四文件）

**① 契约**（`api/src/notification/contract.ts`）——见 §3.3 与 §3.4。

**② handler**（`api/src/notification/notifications/read/api.ts`）：

```ts
export default {
	async post() {
		const body = (http.body ?? {}) as { id?: unknown };
		const id = Number(body.id);
		if (!Number.isFinite(id)) { json.fail(400, "id is required"); return; }
		await db.query("UPDATE notifications SET is_read = 1 WHERE id = ?", [id]);
		json.ok(null);
	},
};
```

**③ 生成**：`pnpm exec ojm api`

**④ 接线**（`entry.ts`）：

```ts
import type { NotificationsApiProvider } from "@oj-module/runtime";
import { defineModule } from "@oj-module/runtime";
import { createNotificationClient } from "./client/api";

export default defineModule({
	name: "notification",
	description: "通知模块",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [],                        // 没有页面
	lifecycle: {
		async onInit(ctx) {
			const notificationClient = createNotificationClient(ctx);
			ctx.register.notificationsApi({
				fetchNotifications: () => notificationClient.fetchNotifications(),
				markRead: id => notificationClient.markRead({ id: Number(id) }).then(() => {}),
				markAllRead: () => notificationClient.markAllRead().then(() => {}),
				clearAll: () => notificationClient.clearAll().then(() => {}),
			});
		},
	},
});
```

**验证**：`pnpm dev` → `admin / 123456` 登录 → 右上角铃铛有蓝点 → 点开 →
点任意一条蓝点消失 → 「全部已读」全清 → 「清空」列表变空。

**加接口的通用流水线**：

```
写契约 contract.ts → 写 handler api.ts → ojm api 生成 client → entry.ts 里 create client + 注册
```

### 4.5 案例：接管头像上传（不写契约的最简入口）

`uploadApi` 只要两个字段，不用写契约、不用生成代码：

```ts
const provider: UploadApiProvider = {
	action: "/api/personal-center/upload",   // 上传直接发到这，不走过生成代码
	// ⚠️ headers 是个「方法」，点上传那一刻才被调用——
	// 因为 token 会刷新，不能提前写好固定值
	headers: () => {
		const token = useAuthStore.getState().token;
		return token ? { Authorization: `Bearer ${token}` } : {};
	},
};
ctx.register.uploadApi(provider);
```

**验证**：个人中心换头像 → 显示新头像 → 刷新页面还在（说明真存上了）。
报 401 九成是 `headers` 写成了固定对象而不是方法。

### 4.6 案例：菜单从后端下发（routesApi）

```ts
const menuClient = createMenuClient(ctx);   // 构造即登记 /menu 前缀 + 绑定 request
ctx.register.routesApi({
	fetchAsyncRoutes: () => menuClient.getAsyncRoutes(),
});
```

后端返回路由列表：

```ts
export default {
	async get() {
		const rows = await db.query("SELECT path, title, icon FROM menus ORDER BY sort", []);
		json.ok(rows.map(r => ({
			path: String(r.path),
			handle: { layout: "container", title: String(r.title) },
			children: [{ index: true, Component: "exception/403" }],  // 页面只能引用框架已有的
		})));
	},
};
```

> **边界**：后端下发的页面组件**只能是框架里已有的**（按框架页面目录解析）。
> 推自己模块写的页面，走模块自己的 `routes` 静态注册。这条路适合做的是
> 「同一个框架页面，谁可见」的权限控制。

---

## §5 布局与插槽

### 5.1 内置布局

| 名字 | 用途 |
|---|---|
| `container` | 有侧边栏 + 页签的完整版（**有页面的路由必须显式写这行**） |
| `parent` | 嵌套父级，不渲染自己的 UI |
| `none` | 默认值，裸渲染（不写 `layout` 就是这个） |
| `fullscreen` | 全屏（登录页那种） |

> 路由级 handle 忘写 `layout: "container"`，页面会**裸奔**且 `keepAlive` 失效。

### 5.2 自定义布局

**① 写组件**（普通组件，留一块地方给孩子页面渲染）：

```tsx
import { Outlet } from "react-router";

export default function ProLayout() {
	return (
		<div className="min-h-screen flex flex-col">
			<header className="h-12 flex items-center px-4 border-b">My Brand</header>
			<main className="flex-1 p-6"><Outlet /></main>
		</div>
	);
}
```

**② 起名**（某模块 onInit 里）：`ctx.register.layout("pro", ProLayout);`

**③ 谁想用谁用**——任何路由（含后端下发的）在 `handle.layout` 写这个名字。

**验证**：打开该路由只剩顶栏和内容区。名字写错会提醒一次
`[layout] 未知名布局 "por"`，然后按"没外壳"渲染，不会崩。

### 5.3 特别提醒

- 规矩跟 provider 一样：先到先赢、重名警告、onInit 结束前报名、卸载自动清理；
- 布局在**路由加载那一刻**定下来，改了组件要刷新页面才看到新的；
- ⚠️ **把 `container` 整个换掉 = 自己背起全部家当**：页签缓存、通知铃、
  头部自定义区、主题设置抽屉……全住在自带外壳里，换壳后它们一起消失。
  除非你就是想要个极简壳，否则别换它。

### 5.4 插槽

`ctx.registerSlot(位置, 节点)` 往页面头部塞自定义 React 节点；不注册就是空着。

---

## §6 i18n 与样式

### 6.1 i18n

模块 i18n 自包含：每个模块有自己的 `locales/`，在 `entry.ts` 里按语言注册：

```ts
i18n: {
	"zh-CN": () => import("./locales/zh-CN.json"),
	"en-US": () => import("./locales/en-US.json"),
},
```

注册进 i18next 时**以模块名为 namespace**，所以引用一律带前缀：

```json
{ "menu": { "books": "图书管理" }, "title": "书名" }
```

```tsx
t("books:menu.books")   // ✅
t("menu.books")         // ❌ 会去 common namespace 找
```

框架级 `common.json` 只放共享 UI 字符串，**不放模块菜单文案**。

### 6.2 样式

- **Tailwind CSS 4**（`@tailwindcss/vite`），直接写 utility class；
- **antd** 主题定制走 `ConfigProvider` theme prop + CSS 变量；
- 动态主题相关样式用 **JSS**（`jss-theme-provider`）。

工程内的格式化约定：**Tab 缩进、双引号、必须有分号**（ESLint only，Prettier 已禁用）。

### 6.3 写一个 CRUD 页面

业务开发 90% 的工作量在这里。可用的框架组件（从 `@oj-module/runtime` 导入）：

| 组件 / 全局 | 用途 |
|---|---|
| `BasicContent` | 页面容器（内边距、背景），页面最外层 |
| `BasicTable` | antd Table 封装，自带 loading / 分页 / 搜索表单 |
| `AccessControl` | 按角色/权限控制按钮可见性 |
| `window.$message` | 全局 toast（runtime 的 antd-app 注入，模块内直接用，**无需 import**） |
| `useAuthStore` / `useUserStore` / `usePreferences` | 读 token / 用户 / 偏好 |

推荐形态（照 `web/src/home/pages/`、`web/src/personal-center/pages/my-profile/` 抄）：
`BasicContent` 包一层 → 搜索区 + `BasicTable` → 新增/编辑用 antd `Modal` + `Form`
→ 提交后重新拉列表。数据来自 §3.4 的生成函数，**页面里直接 import 裸函数调用**。

> `window.$message` 的类型声明在工程根 `env.d.ts`——那里也放着 `ImportMeta.env` 补丁。

### 6.4 `pnpm typecheck` 看不到 `api/`

工程 `tsconfig.json` 的 `include` 只有 `web`、`web.config.ts`、`global.d.ts`、`env.d.ts`，
**不含 `api/`**。也就是说契约与 handler 的类型错误 `pnpm typecheck` 不报，
只有 `pnpm exec ojm api` 真正求值契约时才会炸出来。

所以：**契约改完一定要跑一次 `ojm api`**，别指望 typecheck 替你验。

---

## §7 构建与发布

```bash
pnpm dev             # 开发：devServer + oj 后端（api/src 保存即热更）
pnpm build           # = ojm build：oj build（生成 routes.js）+ 前端全站合并到 web/dist
pnpm preview         # = ojm preview：oj migrate（verify 闸）→ 启动 serve + 静态兜底
pnpm typecheck       # = tsc --noEmit
pnpm exec ojm info   # 版本矩阵 + 模块清单（报障用）
pnpm exec ojm vendor # 下载/重装 oj 二进制
```

- `web/dist/` = **完整站点**（`index.html`、`assets/`、`modules/`、`modules.json`、`versions.json`）。
- `api/dist/` = oj build 产物。**release 下只有 `routes.js` 里的路由存在，
  目录镜像路由不生效**——所以参数路由要先 `oj build` 再测。
- 部署包 = `config.yaml` + `dist/` + 可选 `seed.sql`。
- **`oj` 子命令透传**：`ojm` 直接转发 `oj` 的 `test` / `exec` / `openapi` / `migrate` /
  `schema` 子命令，并自动补 `-c api/config.yaml`（config 在 `api/` 下，相对 CWD 会读不到）。
  例如 `ojm migrate -d api/dist`、`ojm schema diff` 等价于带绝对 `-c` 的 `oj` 调用——
  不用再手敲 `-c`。

**按路由注入 HTML（`htmlTransform`，SEO / IM 链接预览）**：SPA 的服务端只有一份
`index.html`——想让 `/issues/<id>` 这类路由带自己的 `<title>`/`og:*`（微信、Slack、飞书预览
与不执行 JS 的爬虫只看服务端 HTML，客户端 `document.title` 无效），在 `web.config.ts` 配：

```ts
// web.config.ts
export default { baseUrl: "...", modules: [...], htmlTransform: "./html-transform.ts" }
```

```ts
// html-transform.ts（工程根）——default 导出即变换函数
export default async (path: string, html: string) => {
	if (!path.startsWith("/issues/"))
		return html;
	const id = path.slice("/issues/".length);
	const name = await fetchIssueTitle(id);          // 你的取数方式
	return {
		html: html.replace("<title>", `<title>${escapeHtml(name)} · `),
		cacheControl: "public, max-age=60",            // 逐路由缓存策略（可选）
	};
};
```

- 生效范围：`/`、`/index.html` 与 SPA history 回落的深链接（`path` 为**解码后**的请求路径）；
  顺序是 transform → dev 的 reload 脚本注入，`ojm dev` 照旧热更。
- 返回 `string` 或 `{ html, cacheControl? }`；**未配置时输出与历史逐字节一致**，抛错/坏返回只
  打日志并回退原文（不会 500），非 HTML 资产完全不受影响。
- 配置的模块缺失或 default 不是函数 → `ojm dev`/`ojm preview` **启动即报错**（不留半个 oj 进程）。
- **`preview --oj-static` 例外**：该模式静态由 oj 二进制直出（`--app-path`），不经 ojm 静态层，
  本钩子不生效；生产要在 oj 托管侧做同样的事，用 oj 的 `server.html_meta`（构建期 JSON）或
  `server.html_meta_handler`（动态 handler）——见 oj devkit 手册「静态站点与 per-route meta」。

> release 的 `server.migrate_on_start` 默认 `verify`：迁移账本落后会**拒绝启动**，
> 先跑 `ojm migrate -d api/dist`（透传自动补 `-c api/config.yaml`）。

---

## §8 排查

### 8.1 五步清单（按顺序来，九成问题死在前两步）

1. **模块跑起来了吗**：`web.config.ts` 登记了吗？`pnpm exec ojm info` 能看到它吗？
   控制台有没有 `[module-loader]` 开头的报错？
2. **onInit 进了吗**：在 onInit 第一行写句 `console.log("我进来了")`——
   没打印就是加载问题，别怀疑注册代码。
3. **报名成功了吗**：控制台搜 `[api]`、`[layout]` 开头的黄字——
   「已由模块 A 提供，忽略 B」就是被抢了。
4. **请求发哪去了**：F12 → Network 看请求地址——带 `/api/你的模块名/`
   说明抢活了；打到不带前缀的地址说明还在用自带的。
5. **自带的也报错**：看响应里的 `{code, msg}`，后端把原因写在 msg 里了。

### 8.2 症状 → 病根 → 药方

| 症状 | 病根 | 药方 |
|---|---|---|
| 模块像不存在：没路由、没反应、也不报错 | `web.config.ts` 里没登记 | 登记后重启 `ojm dev` |
| 注册了却没效果 | 注册代码不在 `onInit` 里 | 挪进 `onInit` |
| 控制台「重复的 xx provider 忽略」 | 两个模块抢同一入口 | 排前面的赢；调顺序或撤一处 |
| 铃铛按钮全灰 | 没注册通知 provider，或只写了拉列表一个方法 | 4 个方法补齐；老模块见 §4.3⑤ |
| 调用报「请求未绑定」 | onInit 里没调 `create<Module>Client(ctx)` | onInit 里先 create 再发请求 |
| 在页面/组件里又 create 了一个 client | 创建只该发生在 onInit 一次 | 页面里直接 import 裸函数，不要再创建 |
| 控制台「模块 A 正在认领 /b 的 client」 | A 创建了 B 的 client | 由 B 创建并经 provider 暴露能力 |
| 改了契约，前端类型没变 | 没重新生成 | 跑 `ojm api`；生成确定，diff 应只含你改的部分 |
| `ojm api` 报「schema 超出白名单」 | 契约里写了 `z.null()` / transform / refine | 不返回数据就别写 `data`；校验放后端 |
| `ojm api` 报「apiPrefix 与目录名不符」 | AC-D9 字面相等约束 | 改 `apiPrefix` 或移动契约目录 |
| `ojm api` 报「没有发现契约文件」 | 目录不符发现规则 | 按 §3.2 核对；注意 `modules/`→`web/`、`api/`→`client/` 迁移 |
| `--check` 报 artifact-stale | 改了契约没重跑 | 重跑 `ojm api` |
| `--check` 报 handler 未登记 | 内置/手写 handler 无契约 | 补契约，或登记豁免清单 |
| 豁免写了 `//` 注释后全部失效 | 严格 JSON 解析失败、静默回退 | 注释写进 `_comment` 字段 |
| 新建后端模块目录后 API 404 | 目录镜像路由未热更 | **重启** `ojm dev` |
| DELETE 返回 405 | 方法名写成了 `delete` | 改成 `del` |
| IM 预览/爬虫只有默认标题（页面 JS 改了没用） | 服务端没做 HTML 注入 | 配 `htmlTransform`（见 §7；`preview --oj-static` 模式下要改到 oj 侧 `server.html_meta_handler`） |
| 配了 `htmlTransform` 但没生效 | 路径写错 / default 不是函数会**启动报错**；能起来却没效果 → 检查该请求是否命中静态层（`/api` 前缀与带扩展名的资源都不过钩子） | 见 §7 的生效范围 |
| 上传报 401 | `headers` 写成固定对象，token 过期 | 写成方法，用时现取（§4.5） |
| 后端菜单用了我的布局名，页面却没壳 | 注册该布局的模块没加载 | 看控制台 `[layout] 未知名布局` 提醒 |
| 后端下发的页面组件找不到 | 下发的组件名必须在框架页面目录里 | 自己模块的页面走模块 `routes` |
| 下线模块后页面没变 | 已渲染的页面不自动换 | 刷新页面 |
| 登录 401 且 msg 不是 `invalid credentials` | `/auth/*` 不在 `anonymous_paths` | 加进 `api/config.yaml`，重启 |
| 登出/回登录页空白或 404 | 工程缺 `login` 模块（shell 无内置登录回落） | 在 `web.config.ts` 保留 `login` |
| 登录后 / 点 logo 落 React Router 错误边界 | 工程缺 `home` 模块 | 在 `web.config.ts` 保留 `home`（尽量靠前） |
| 通知铃 404 `no route matched` | 缺 root 级 `/api/notifications` | 补 `api/src/notifications` 模块 |
| `@types/react` / `typescript` 装成 `*` | 宿主 versions.json 未列 | 安装后按实际版本钉死（`*` 不可复现） |
| 迁移账本落后、服务拒绝启动 | release `verify` 闸 | 先 `ojm migrate -d api/dist`（透传自动补 `-c`） |
| `seed.sql` 没生效 / 语法错 | 按 `;` 朴素切分，注释里有分号 | 去掉注释里的分号字面量 |
| 页面图标 / 关闭 × 空白 | 共享资源图标默认值回归 | 重建宿主 shell |
| curl 访问 SPA 路由返回 404 | SPA history 回落要求 `Accept: text/html` | 加 `-H 'Accept: text/html'`（浏览器自带，不是 bug） |

---

## §9 参考

业务工程里**没有框架源码**——所有能抄的东西都在你自己的工程目录里：

| 想抄什么 | 抄这里 |
|---|---|
| 带页面的模块（路由 / i18n / order） | `web/src/home/entry.ts`、`web/src/demo/entry.ts` |
| 抢通知 provider（四方法全量） | `web/src/notification/entry.ts` |
| 上传 provider（action + headers 方法） | `web/src/personal-center/entry.ts` |
| 无页面模块（`routes: []`） | 同 `web/src/notification/entry.ts` |
| 契约写法（GET + POST、参数段） | `api/src/notification/contract.ts`、`api/src/personal-center/contract.ts` |
| handler 写法（列表 / 写入 / 上传） | `api/src/notification/notifications/api.ts`、`.../read/api.ts` |
| 生成物长什么样（含工厂） | `web/src/notification/client/api.ts` |
| 建表三件套 | `api/src/notification/{schema.yaml,manifest.yaml,migrations/}` |
| 全局类型（`window.$message` 等） | 工程根 `env.d.ts` |

另有：

- **后端 handler 手册**：`bin/devkit/api-manual.md`——随 oj 二进制由 `ojm init`
  解压到 `bin/`，即 `oj-api-dev` skill 的手册。写 handler 遇到 `json` / `db` / `kv` /
  `jwt` / 租户 / 测试的问题查它。
- **框架团队内部**：本目录 `framework-dev.md`（改 `packages/runtime`、`packages/cli` 用，
  业务工程不适用）。
