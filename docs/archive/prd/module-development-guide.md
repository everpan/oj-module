# 模块开发手册（npm 包化版）

> 面向外部团队：在独立仓库中开发业务模块，产物以静态资源形式发布，
> 宿主不重建即可上线（D1）。本文取代旧版「同仓库 modules/」手册。
>
> 更新：2026-08-30 随 P6 安全加固同步——`ctx.utils.request` 收敛为
> 按 `apiPrefix` 的 scoped client、模块资源 URL 受 moduleOrigins 白名单
> 约束、iframe 路由启用 https + 域名白名单 + sandbox。
>
> 更新：2026-08-30 P7 评审整改（详见 `202608300957-p7-review-remediation-plan.md`）——
> peerRuntime 校验真实生效、依赖缺失标记 missing-deps、requiredPermissions 落地、
> scoped client 增加路径归一化与 prefix 剥离、entry 并入 L2 完整性链路、
> 新增 `ram info` / `ram merge`、shell 包转 npm 发布。
>
> 更新：2026-09-01 随 playground 全量模块接入（`202609010056-playground-full-modules-plan.md`）
> ——新增 ram dev 工程 mock 约定（§3.4）、路由相对 path 的菜单 key/id 契约
> （§3.2 要点 4）、AppInfo 缺字段空态契约（§9 常见问题）。
>
> 前置阅读：`202608291145-framework-npm-package-implementation-plan.md`（设计文档），
> 本文引用其中决策编号（D*）与需求编号（B*/O*/R*）。

## 目录

1. [架构总览](#1-架构总览)
2. [环境准备](#2-环境准备)
3. [模块开发](#3-模块开发)
4. [构建与发布](#4-构建与发布)
5. [多团队清单合并](#5-多团队清单合并)
6. [运维](#6-运维)
7. [API 参考](#7-api-参考)
8. [红线与门禁](#8-红线与门禁)
9. [常见问题](#9-常见问题)

## 1. 架构总览

```
┌─────────────────────────────────────────────────────┐
│ 宿主（shell，框架方预部署）                            │
│  importmap（共享依赖单例 D5/D12）                     │
│  host.js：fetch modules.json → loadAll → getRoutes   │
└──────────────┬──────────────────────────────────────┘
               │ modules.json（BuiltModule[]，可多份合并）
┌──────────────┴──────────────────────────────────────┐
│ 业务模块（外部团队，独立仓库）                          │
│  entry.ts（defineModule）→ ram build → chunk + 完整性 │
└──────────────┬──────────────────────────────────────┘
               │ import { ... } from "@react-antd-module/runtime"
┌──────────────┴──────────────────────────────────────┐
│ runtime（框架 npm 包，P3 冻结出口）                    │
└─────────────────────────────────────────────────────┘
```

- **模块只依赖三个 npm 包**：`@react-antd-module/runtime`（出口冻结）、
  `@react-antd-module/cli`（`ram` 命令）、宿主提供的共享依赖（importmap 注入，
  模块侧不得打进 bundle）。
- **共享依赖单例**：react/antd/zustand 等由宿主 importmap 提供，
  模块构建时全部 external（`SHARED_DEPS` 表，P4.1 单一来源），
  保证与宿主命中同一份实例。
- **模块路由优先**：模块路由先于后端/前端权限路由合并；同顶级路径下
  后端路由被过滤（`filterBackendRoutes`）。
- **清单加载在应用启动**（P5.5/O5）：`index.tsx` 启动时 `loadAll` 一次，
  路由守卫只消费 `getRoutes()`；加载失败显示人话错误页（P5.8/B7），
  不静默丢路由。
- **安全基线**（P6/§4.8）：模块请求按 `apiPrefix` 收敛（D11）、资源
  来源白名单（D10）+ L2 完整性 + CSP、iframe 守卫。详见 §8 红线表。

## 2. 环境准备

> 需要**前后端一体**（oj 后端 + 前端模块）的全新工程，请改用
> `ram init` 脚手架，见《uni-dev 使用手册》（`202609011520-uni-dev-manual.md`）；
> 本文面向「只写前端模块、接入既有宿主」的工程。

外部工程 `package.json`（参考 `apps/playground`）：

```json
{
	"name": "@your-team/biz-module",
	"scripts": {
		"dev": "ram dev 5174",
		"build": "ram build"
	},
	"devDependencies": {
		"@react-antd-module/cli": "<与宿主同版本>",
		"@react-antd-module/runtime": "<与宿主同版本>",
		"@react-antd-module/shell": "<与宿主同版本>",   // P7.10 起经 npm 发布，ram dev/build 的宿主产物来源
		"@types/react": "^19.x",
		"typescript": "^5.x"
	}
}
```

**版本门禁（C4/D12）**：`ram build` 会校验——

1. `dependencies` 中**禁止**出现硬依赖（react/react-dom/react-router/
   @tanstack/react-query/runtime——它们只能来自宿主 importmap）；
2. 本地安装的共享依赖版本必须与宿主 `shell/dist/versions.json`
   **逐项严格相等**（比较的是 node_modules 实装版本，不是 semver 范围字面量）。

不符即构建失败，报错附修复指引。TS 类型检查无需 paths 映射，
`tsconfig.json` 直接解析 node_modules 里的 runtime 类型即可
（参考 `apps/playground/tsconfig.json`：无 `paths` 字段）。

## 3. 模块开发

### 3.1 目录结构

```
your-module/
├── entry.ts          # 唯一元信息与路由来源（defineModule）
├── pages/            # 页面组件（建议 lazy）
└── locales/          # i18n（zh-CN.json / en-US.json，自管理）
```

### 3.2 entry.ts

```ts
import { lazy } from "react";
import { defineModule } from "@react-antd-module/runtime";

const definition = defineModule({
	name: "order",                    // 全局唯一，进清单合并（重名直接拒绝）
	description: "订单模块",
	version: "1.0.0",                 // 产物目录用（build/modules/order/1.0.0/）
	routes: [
		{
			// 父路由声明布局，子路由渲染页面 —— 不可把页面直接挂到顶层路由。
			// 框架只在「无 Component 且有 children」的路由上按 handle.layout 注入布局
			// （D9），叶子路由直挂 Component 会裸奔（无 header/sidebar/tabbar），
			// 且 KeepAlive 只挂在 ContainerLayout 内，keepAlive 也会一起失效
			path: "/order",
			handle: {
				layout: "container",        // "container" | "parent" | "fullscreen" | "none"
				title: "order:menu.list",   // i18next namespace 语法
				icon: <FileTextOutlined />,
				order: 10,                  // 菜单排序自管理（R1）
			},
			children: [
				{
					index: true,
					Component: lazy(() => import("./pages/list")),
					handle: {
						title: "order:menu.list",
						icon: <FileTextOutlined />,
						keepAlive: true,          // 缓存标记挂在叶子路由上
						roles: ["admin"],         // 路由级角色（渲染前 403）
					},
				},
			],
		},
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	config: {
		dependencies: ["system"],     // 依赖的模块 name，拓扑排序用
		requiredRoles: ["admin"],     // 模块级角色门禁（B16）：无角色
		                              // 用户拿不到路由与菜单，而非 403
		requiredPermissions: ["order:view"], // 权限码须全部满足才激活
	},
	// 可选：兼容的宿主 runtime 版本（semver 范围），不兼容则拒绝加载并显式报错
	// peerRuntime: ">=1.0.0 <2.0.0",
	lifecycle: {
		beforeInit: async ctx => { /* 依赖模块就绪后执行 */ },
		onInit: async ctx => {
			ctx.register.store("orderStore", useOrderStore);
			ctx.register.apiPrefix("/order-api");
			ctx.registerSlot("header-actions", <OrderBell />);
		},
		onDestroy: async ctx => { /* 清理 */ },
	},
});

export default definition;
```

要点：

- `name` 是唯一身份：清单合并（R12）、槽位清理、卸载、i18n 命名空间都以它为键。
- `requiredRoles`（模块级）在路由注入**前**过滤；`handle.roles`（路由级）
  在导航时校验 403。两者语义不同，可叠加。
- 菜单 title 必须用自己模块的 namespace（`order:menu.xxx`），翻译文件
  随模块自管理，框架 `common.json` 不含业务词条。
- **路由 path 建议一律写绝对路径**（`/order/list`）。react-router 允许
  子路由相对 path（`"list"`），框架会把菜单 key 与路由 id 统一拼接为
  绝对路径（相对 key 曾导致点击被按当前路由相对解析而落 404、选中态
  与手风琴展开态错乱，202609010056 暴露后已在框架侧修复）；写绝对路径
  可完全绕开这条转换链，也便于排查。
- `peerRuntime` 写 semver 范围时的 **0.x 陷阱**：`^0.0.0` 在 semver 下
  等价于「恰好 0.0.0」，宿主一升级即误判不兼容。宿主 runtime 尚在
  0.x 阶段时请写开放范围（如 `>=0.0.0`），1.0 后再收紧。

### 3.3 依赖规则

| 引用对象 | 方式 |
| --- | --- |
| 框架能力（store/request/布局/hooks…） | `import { ... } from "@react-antd-module/runtime"` |
| 共享三方（antd/zustand/dayjs…） | 直接 `import "antd"` 等——构建时 external，importmap 提供单例 |
| 模块内部 | 相对路径（`./pages/list`） |
| 发起 HTTP 请求 | `ctx.utils.request`——按 `register.apiPrefix` 前缀收敛的 scoped client，**越界请求被拒绝**（D11）；推荐经契约生成 client（§3.7），不手写 URL |
| API 契约 | `import { defineApi, z } from "@react-antd-module/contract"`——硬共享，devDependency 声明且版本与宿主严格相等 |
| **其他模块的内部文件** | **禁止**（含 `#src/`、`#modules/`——eslint + CI 双卡口，P2.4） |
| 其他模块的能力 | 经 runtime 注册表：`ctx.register.store()` + `getRegisteredStore()` |

### 3.4 开发服务器

```bash
pnpm dev        # = ram dev 5174
```

`ram dev` 是「构建 + watch + 静态服务」架构：宿主页面（shell dist）
代理访问，模块产物变更后**手动刷新**生效。真正的 HMR 需要 vite 中间件
形态的 dev server（已知差距，见设计文档 P5 偏差记录）。

**工程 mock 约定**：`ram dev` 会加载工程根目录 `mock/*.mock.mjs`
（或 `.mock.js`）下 default 导出的路由数组，挂到同源 `/api` 前缀，
供本地开发替代后端：

```js
// mock/order.mock.mjs
export default [
	{
		url: "/order-api/list",              // 归一化到 /api/order-api/list
		method: "POST",                       // 缺省 GET
		response: ({ body, query }) => ({     // 返回值即响应 JSON
			code: 0,                          // oj 信封（AC-D16）：0 成功，非 0 时 HTTP status=code
			msg: "ok",
			data: { list: [], total: 0 },
		}),
	},
];
```

- url + method **精确匹配**，未命中返回 404 JSON（不做透传）——
  mock 表就是该 dev 形态的后端边界；
- **契约驱动 mock 兜底**（§3.7）：手写 mock 未命中时，按契约 `data`
  schema 自动生成示例数据——纯前端开发可以只写契约、零手写 mock；
- 无 `mock/` 目录时零行为变化；**重启 `ram dev` 生效**（手写 mock 不热载；
  契约文件变更则自动重生成 + 热载，见 §3.7）；
- 生产构建不受影响（约定仅存在于 ram dev）。

### 3.5 登录模块（替换内置登录页）

框架内置 `/login` 兜底页；模块可声明同路径登录页**替换**它（login 模块化，
设计文档 `202609021142-login-module-design.md`）：

```ts
routes: [
	{
		path: "/login",              // 契约路径，固定不可改
		handle: {
			layout: "fullscreen",    // 框架全屏外壳：视口/品牌区/工具区/页脚
			login: true,             // “我是登录页”——存在时内置兜底被剔除
			hideInMenu: true,
			title: "login:page.title",
		},
		children: [
			{ index: true, Component: lazy(() => import("./pages/login")), handle: { title: "login:page.title" } },
		],
	},
]
```

契约与仲裁：

- **路径固定 `/login`**（与 `/exception/403|404|500` 同为框架契约路径）；
  非该路径的 `login: true` 标记被拒绝并告警；
- 模块只写**内容区**：视口、品牌区（logo + 应用标题）、主题/语言工具、
  页脚由 `fullscreen` 外壳兜住，模块零框架内部依赖；
- 登录请求默认走 `useAuthStore().login()`，成功后 `navigate(getRedirectPath(search))`
  ——`getRedirectPath` 解析 `?redirect=`，只放行站内路径；
- 多模块声明 `login: true` 时按拓扑序**先到先得**，其余告警忽略；
- 无 login 模块（或模块加载失败未产出路由）时，`/login` 回落内置页。

参考实现：`apps/playground/modules/src/login/`。

### 3.6 认证 Provider 注入（P5）

框架内置的登录 / 登出 / 取用户信息默认对接 `auth/login`、`auth/logout`、
`web/user-info` 三套后端契约。若模块需要对接**异构认证后端**（自有网关、
第三方 IdP 等），可通过生命周期钩子把这套能力**整体接管**。

**用途**：让模块接管 runtime 的登录 / 登出 / 取用户信息，对接异构认证后端，
而 runtime 与各页面（登录页、`user-menu`、AuthGuard）零感知、零改动。

**契约（三者全必填）**——经 `ctx.register.authProvider({...})` 注入一个
`AuthProvider` 对象：

| 方法 | 签名 | 职责 |
| --- | --- | --- |
| `login` | `(payload: LoginInfo) => Promise<AuthType>` | 返回 `{ token, refreshToken }`，**由 runtime 写库** |
| `logout` | `() => Promise<void>` | 清后端会话 |
| `getUserInfo` | `() => Promise<UserInfoType>` | 返回归一后的用户信息 |

不支持部分接管：`login`/`logout`/`getUserInfo` 三者**必须全部实现**，否则
半托管状态下两条链路并存、行为不可推理。

**入口与仲裁**：

- 只能经 `lifecycle.onInit` 的 `ctx.register.authProvider({...})` 注册——
  这是**模块级**能力（登出发生在顶栏，用户刷新后可能从未挂载登录页），
  不是 React hook；注册发生在 `loadAll` Phase 3，早于路由与守卫首次渲染。
- **先到先得**：多个模块注册时，第一名登记成功，后续模块被 `console.warn`
  忽略，与 login 模块去重同一规则（确定性、可测）。
- 注册以模块 `name` 为键，`unloadModule(name)` 时随模块卸载自动清理。

**scoped request 前置**：provider 内部若要发请求，必须用
`ctx.utils.request`；而该 client 受 `ctx.register.apiPrefix()` 约束——
**先登记前缀，再请求**，否则越界请求直接被拒（D11）。典型写法（见 §3.5
login 模块）：

```ts
onInit: async (ctx) => {
	ctx.register.apiPrefix("/login");          // 先登记
	ctx.register.authProvider({
		async login(payload) {
			const res = await ctx.utils.request.post("login/login", { json: payload })
				.json<ApiResponse<AuthType>>();
			if (res.success === false) throw new Error(res.message || "登录失败");
			return res.result;                  // { token, refreshToken }
		},
		async logout() {
			await ctx.utils.request.post("login/logout").json();
		},
		async getUserInfo() {
			const res = await ctx.utils.request.get("login/user-info")
				.json<ApiResponse<UserInfoType>>();
			return res.result;
		},
	});
},
```

**未注册时的回落**：未注入 provider 时，`useAuthStore` / `useUserStore`
回落框架内置 `auth/login`、`auth/logout`、`web/user-info`，行为与今日**完全一致**。

**契约边界（runtime 对 provider 零干预）**：

- runtime **不对 provider 返回的路径/字段做任何校验**——`token` 是否为空串
  由 provider 自己用抛错表达；
- provider 的 `reject` / 抛错**原样透传**给调用方（登录页 catch 后弹红条，
  现状不变）；
- **错误提示归 provider**：后端信封、业务码、中文 message 的归一都在 provider
  内部完成，runtime 只认 `AuthType` / `UserInfoType`。
- 登出 `provider.logout()` 抛错也**不阻塞本地清理**——`logout()` 外层
  `try { ... } finally { reset() }`，无论成功失败都清 token / 用户 / 权限 / tabs。

参考实现：`apps/playground/modules/src/login/entry.ts` + `mock/auth.mock.mjs`；
设计细节与**流程图（mermaid）**见 `202609021446-auth-provider-injection-design.md` §5.1
（登录 / 登出 / 取用户信息 + runtime↔login 模块交互）。

### 3.7 API 契约（ram api）

模块 API 调用不再是手写 URL 字符串——契约是单一事实源，类型化 client、
dev 响应校验、mock 兜底、OpenAPI 文档全部从契约生成。

**写契约** —— `modules/src/<模块>/api/contract.ts`：

```ts
import { defineApi, z } from "@react-antd-module/contract";

export const getTodoList = defineApi({
	apiPrefix: "/demo",              // 须与 entry.ts 登记的 apiPrefix 一致
	route: "/todos",                // 相对 apiPrefix；支持 {id} / {*path} 参数段
	query: z.object({ keyword: z.string().optional() }),
	data: z.object({                 // 信封 data 部分的 schema（线协议唯一真相）
		list: z.array(z.object({ id: z.number(), title: z.string(), done: z.boolean() })),
		total: z.number(),
	}),
	description: "演示待办列表",      // 进 OpenAPI 文档
});
```

**生成** —— 工程根执行：

```bash
ram api          # 生成 client.ts / client.schemas.ts / routes.json / openapi.yaml（幂等，内容不变则跳过）
ram api --check  # CI 门禁：生成物过期、route 双向对账不一致即 error 退出 1
ram api --docs   # 聚合全部契约渲染 redoc 静态文档站
```

`ram dev` 自带契约 watch：改 `contract.ts` 自动重生成，页面刷新即生效。

**绑定请求能力** —— `entry.ts` 的 `onInit` 里两行（顺序不可颠倒）：

```ts
import { bindRequest } from "./api/client";

onInit: async (ctx) => {
	ctx.register.apiPrefix("/demo");   // D11 前缀收敛
	bindRequest(ctx.utils.request);    // AC-D8：宿主注入 scoped client
},
```

**页面使用** —— 类型推导 + 信封自动解包 + dev 下响应违例人话报错：

```ts
import { getTodoList } from "../api/client";

const { list, total } = await getTodoList({ keyword: "x" });
// list 类型自动推导为 { id: number, title: string, done: boolean }[]
```

约束与逃生口：

- 信封格式统一为 oj `{ code, msg, data }`（code=0 成功；非 0 时 HTTP
  status=code，client 归一抛 `ContractApiError`）；
- schema 白名单：string/number/boolean/date/object/array/enum/literal/
  union/optional/nullable/default——`transform`/`refine`/`coerce`/`pipe`/
  `lazy` 无法转 OpenAPI，定义期即拒绝；
- `response: "raw"` 端点不解包不校验（二进制/非信封逃生口）；
- 生成物（`api/client.ts` / `client.schemas.ts`）**勿手改**（eslint 已忽略），
  改动一律改契约后重跑 `ram api`；
- `import.meta.env.DEV` 校验分支在生产构建中被常量消除，zod 不进产物。

**常见问题**：

1. **「请求未绑定」**——`onInit` 里没调 `bindRequest`（或顺序颠倒在
   `apiPrefix` 之前导致越界拒绝）；
2. **「请求越界」**——契约 `apiPrefix` 与 `entry.ts` 登记前缀不一致；
3. **typecheck 报 `import.meta.env` 不存在**——工程无 vite 依赖时，按
   `apps/playground/typings.d.ts` 补一份最小 `ImportMeta.env` 声明，
   并开 `allowImportingTsExtensions`（契约包源码以 `.ts` 后缀相对导入）。

> **框架开发者注意**：`packages/runtime/src` 改动后必须重建并提交
> `packages/runtime/dist` + `packages/shell/dist`（见设计文档 §10），否则消费方
> dev 会因缺新方法而报 `ctx.register.authProvider is not a function`。外部模块
> 开发者不受影响——你只依赖已发布的 `AuthProvider` 类型。

## 4. 构建与发布

```bash
pnpm build      # = ram build
```

产物：

```
dist/modules/order/1.0.0/
├── entry.js              # 入口 chunk
├── chunk-*.js            # 动态 import 拆出的 chunk（标 lazy）
├── *.css                 # 样式产物
└── …

dist/modules.json          # BuiltModule[]（含每 chunk sha384 完整性）
```

`modules.json` 条目（`BuiltModule`）：

```ts
{
	name: "order",
	version: "1.0.0",
	enabled: true,
	dependencies: ["system"],
	// 声明了 config.peerRuntime 时才出现；loader 据此按 semver 校验宿主
	// runtime 版本（P7.6），不匹配标记 error 并显式报错
	peerRuntime: ">=1.0.0 <2.0.0",
	entry: "/modules/order/1.0.0/entry.js",
	integrity: "sha384-…",        // entry 完整性
	css: ["/modules/order/1.0.0/style.css"],
	chunks: [
		{ url: "…/entry.js", integrity: "sha384-…", lazy: false },
		{ url: "…/chunk-X.js", integrity: "sha384-…", lazy: true },
	],
}
```

发布 = 把 `build/modules/<name>/<version>/` 上传到静态资源 CDN/目录，
并交付你的 `modules.json` 给宿主运维。

**来源约束（P6.1/D10）**：清单里的资源 URL 只允许两种形态——同源
相对路径（如 `/modules/order/1.0.0/entry.js`），或 origin 已在宿主
`moduleOrigins` 白名单登记的绝对 URL。使用自建 CDN 时，先把域名交给
框架方登记（同时覆盖信任根校验与 CSP `script-src`），否则宿主在
加载前直接拒绝整份清单。

**完整性档位（§4.7）**：宿主按 L2 保护——所有非 lazy chunk（P7.3 起含 entry）
以 `modulepreload + integrity + crossorigin` 注入，浏览器加载前校验；
lazy chunk 按需加载不受保护（D7），`ram build` 会在产物含 lazy chunk 时
显式提示。注意：篡改的 chunk 会被预载通道拒绝并触发控制台报错，但随后的
动态 import() 不带 integrity（浏览器限制）——需要「拒绝执行」语义时升级到 L3。

**深路径约束（P7.9）**：共享表外的深路径裸说明符（如 `dayjs/plugin/utc`）
无法被 importmap 解析（无前缀通配），`ram build` 会**构建期报错**；
请改从包根导入，或联系框架方在 SHARED_DEPS 增补条目。

## 5. 多团队清单合并

宿主消费多份 `modules.json` 时由 `mergeModuleManifests` 合并（R12）——
P7.15 起可直接用 CLI 执行：

```bash
ram merge dist/modules.json team-a/modules.json team-b/modules.json
```

- **同名模块在任意两份清单中重复 = 构建期直接拒绝**，报错定位两个来源。
  同名即两个团队对同一路由/菜单的竞争声明，绝不静默覆盖。
- 各团队命名建议带团队前缀（`order-`、`crm-`），从源头降低撞名概率。

## 6. 运维

### 6.1 启用/禁用

清单条目 `enabled: false`（或宿主侧合并时过滤）即可下线模块，宿主不重建。

### 6.2 版本回退

把清单中 `entry`/`chunks` 指回旧版本目录即可（版本目录共存）。

### 6.3 加载失败

- 宿主应用（index.tsx）：启动期失败显示全屏错误页——人话原因 + 修复建议
  （检查清单可达性 / 资源 URL / 依赖模块部署）+ 文档链接（P5.8/B7）。
- shell 宿主：Boot 组件内捕获并渲染错误信息。
- 单模块 entry 加载失败：该模块标记 `status: "error"`，**其余模块不受影响**，
  其路由/菜单缺失可从 `getModules()` 观测。
- **版本不兼容（P7.6/US-5）**：模块 `peerRuntime` 与宿主 runtime 版本不匹配时
  标记 `error` 并显式报错（含模块名/期望/实际版本），不静默成功。
- **依赖缺失（P7.8/US-9）**：声明的依赖模块未加载时标记 `status: "missing-deps"`，
  不执行生命周期、不注册路由（杜绝半加载），报错含缺失依赖名。

### 6.4 卸载

`unloadModule(name)`：执行 `onDestroy` → 清理该模块全部布局插槽 → 移除实例。

## 7. API 参考

### 7.1 defineModule

见 [3.2](#32-entryts)。`ModuleConfig` 字段：`dependencies`、
`requiredRoles`（满足其一即激活）、`requiredPermissions`（须全部满足，
P7.12 起在 `getRoutes()` 真实过滤）。`ModuleDefinition` 另有
`peerRuntime`（宿主 runtime 兼容范围，P7.6 起由 loader 按 semver 真实校验，
不匹配标记 `error` 并显式报错）。

### 7.2 ModuleContext（生命周期入参）

| 成员 | 说明 |
| --- | --- |
| `ctx.module` | `{ name, version }` |
| `ctx.utils.request` | **scoped client（P6.3/D11，P7.2 加固）**：底层 ky 实例的按前缀收敛视图（token 注入/401 刷新/进度条已配置）。仅当请求 URL **归一化后**以本模块登记的 `apiPrefix` 为完整路径段前缀才放行（`/order-api` 放行 `/order-api/list`，拒绝 `/order-api-v2/...` 与 `../` 逃逸）；未登记先请求直接抛人话错误。单次请求的 `prefix`/`prefixUrl` 选项会被剥离（P7.2，防 token 外泄）；`create`/`extend` 不暴露（可绕过全局 hooks） |
| `ctx.register.store(name, store)` | 注册私有 store，跨模块经 `getRegisteredStore` 消费 |
| `ctx.register.apiPrefix(prefix)` | 声明模块 API 前缀；`ctx.utils.request` 的放行边界即此值，可重新登记（惰性求值，下一请求生效） |
| `ctx.registerSlot(slotName, node)` | 注册布局插槽（现支持 `header-actions`），随模块卸载自动清理 |

> 后端逐接口鉴权仍是安全兜底（D11 双层）；客户端收敛是纵深防御的第一层。

### 7.3 常用出口

`defineModule` / `getRoutes` / `getModules` / `loadAll` / `unloadModule` /
`getRegisteredStore` / `getRegisteredApiPrefix` / `getAppInfo` /
`useSlotNodes` 等——完整清单以 `@react-antd-module/runtime` 的 d.ts 为准
（出口已冻结，drift-prevention 测试锁定，P3）。

## 8. 红线与门禁

| 红线 | 卡口 |
| --- | --- |
| import 框架内部实现（`#src/`、`#modules/`） | eslint + CI 双卡口（P2.4），构建 external 白名单兜底 |
| dependencies 声明硬依赖 / 共享依赖版本与宿主不一致 | `ram build` 版本矩阵门禁（C4/D12） |
| 请求越出本模块登记的 `apiPrefix` | scoped client 直接抛错（P6.3/D11） |
| 资源 URL origin 未登记（自建 CDN 未报备） | 宿主 `moduleOrigins` 白名单在加载前拒绝整份清单（P6.1/D10） |
| iframe 路由非 https / 域名不在白名单 | `resolveSafeIframeLink` 拒绝渲染，控制台人话报错（P6.4） |
| 清单同名模块 | `mergeModuleManifests` 直接拒绝（R12） |
| 共享依赖新版本 | 须框架方更新 `SHARED_DEPS` 表 + shell 重发布（importmap 无前缀通配） |
| runtime 出口变更 | 框架方流程；外部团队按冻结出口编程（P3） |

## 9. 常见问题

**Q: 菜单不显示？**
依次查：模块是否进清单（`modules.json`）→ `enabled` 是否为 true →
`requiredRoles` 是否把当前角色挡在注入前（B16）→ title 的 namespace
前缀是否是自己的模块名。

**Q: 页面渲染 UnknownComponent？**
路由未被合并：查清单 `entry` URL 可达性、entry 内 `name` 与清单是否一致
（不一致 loader 会拒绝并标 error）。

**Q: 请求报「尚未登记 API 前缀」或「请求越界」？**
scoped request（P6.3/D11）按 `ctx.register.apiPrefix()` 登记的前缀收敛：
先在生命周期里登记前缀，且请求路径必须以它开头（如登记 `/order-api`
后可请求 `/order-api/list`，请求 `/user/...` 即越界）。接口路径调整不了时，
与框架方确认登记正确前缀；后端同样会逐接口鉴权。

**Q: iframe 页面被拒绝渲染？**
`handle.iframeLink` 仅接受 `https:` 且域名在宿主白名单内的链接
（允许其子域），渲染时自动带 `sandbox`（P6.4）。http 链接或未报备
域名会被拒绝并打 `[iframe]` 错误日志——换 https 并联系框架方登记域名。

**Q: 构建报「版本矩阵门禁校验失败」？**
按报错逐项对齐：删掉 dependencies 里的硬依赖；用与宿主 versions.json
严格相等的版本安装共享依赖（注意比较的是实装版本）。

**Q: 样式互相污染？**
模块样式随模块产物加载（宿主 `<link>` 注入）；tailwind 原子类与 antd
cssinjs 已验证兼容（P4.8：`hashPriority="high"` 不加 layer）。

**Q: 如何调试模块加载？**
DEV 下 loader 会打 `[module-loader]` 前缀日志（加载清单、✓ 每模块成功、
依赖缺失/成环告警）；生产用 `getModules()` 检查各实例 status
（`missing-deps` 即依赖未就绪）。

**Q: 怀疑 runtime 有 bug，如何向框架团队报障？（P7.11）**
在模块工程根目录执行 `ram info`——输出 cli/runtime/shell 三方版本 +
共享依赖版本矩阵 + 当前模块清单，完整粘贴即可复现环境。

**Q: 使用 `getAppInfo()` 的字段报 undefined / 崩溃？**
AppInfo 契约（P6.5）：不同宿主注入的应用元信息**字段可缺省**——runtime
产物即不携带 `pkg.dependencies`/`pkg.devDependencies`（供应链信息泄露
防护）。缺字段必须走空态而非崩溃：`Object.keys(getAppInfo().pkg.dependencies ?? {})`。
直接解构后调用曾让宿主形态整页崩（React Router ErrorBoundary）。
另注意：模块源码**不得直接引用全局 `__APP_INFO__`**（CI 契约测试锁定），
一律经 `getAppInfo()`。

**Q: 菜单点击跳到奇怪的路由（如 /system/detail）或选中态丢失？**
十有八九是子路由写了**相对 path**（`path: "detail"`）：点击导航按当前
路由相对解析（在 /system/dept 下点「detail」→ /system/detail）。
框架已把菜单 key/路由 id 统一拼为绝对路径，但仍建议路由 path 一律写
绝对路径（见 §3.2 要点 4）。
