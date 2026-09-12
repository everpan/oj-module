# Provider 机制专题指南（新人向）

> 日期：2026-09-13 00:35
> 适用版本：`@oj-module/runtime` 0.1.9+（布局注册表与 routesApi 自本仓库 feat/layout-injection 起；通知四方法同版起为全必填）
> 读者：第一次编写 oj-module 模块的前端/全栈开发者

## 1. 什么是 Provider

宿主框架（runtime）里有一些「框架内建、但业务想接管」的能力：登录鉴权、通知读写、后端动态路由、头像上传……

Provider 就是模块对这些能力的**整体接管声明**：模块在 `onInit` 里把「我来实现这套接口」注册进框架的注册表；框架消费点运行时先查注册表，有人接管就走模块实现，没人接管就回落到内置兜底实现。

一句话：**模块通过 provider 把框架的内建能力换成自己的后端，而不改框架一行代码。**

## 2. 注册口一览

模块上下文 `ctx` 提供以下注册口（`packages/runtime/src/module-loader/types.ts`）：

| 注册口 | 接管什么 | 契约 | 未注册时的回落 |
| --- | --- | --- | --- |
| `ctx.register.authProvider` | 登录/登出/取用户信息 | `login` / `logout` / `getUserInfo` 三方法全必填 | 内置 root 级 auth 端点 |
| `ctx.register.systemApi` | 系统角色/菜单类 API | 11 方法全必填 | 内置 root 级实现 |
| `ctx.register.notificationsApi` | 通知读 + 写 | `fetchNotifications` / `markRead` / `markAllRead` / `clearAll` 四方法全必填 | 内置 root 级只读 `/notifications`（互动降级只读） |
| `ctx.register.uploadApi` | 头像/附件上传 | `action` URL + `headers()` | 内置 root 级上传 |
| `ctx.register.routesApi` | 后端动态路由拉取 | `fetchAsyncRoutes` | 内置 `web/get-async-routes` |
| `ctx.register.layout(name, component)` | 布局名（见 §5） | — | 内建 `container` / `parent` / `fullscreen` |
| `ctx.registerSlot(slotName, node)` | header 等 UI 插槽 | — | 空 |

> **全必填原则（D9）**：每个 provider 的接口方法全必填——「接管」是全量接管，不做部分托管。契约变了（如通知加写方法）是**破坏性变更**，须与 runtime 同版本发布。

## 3. 最小示例：接管通知 API

以模板工程 `web/src/notification/entry.ts` 为例（真实代码）：

```ts
import { defineModule } from "@oj-module/runtime";
import * as notificationClient from "./client/api"; // ojm api 生成物

export default defineModule({
	name: "notification",
	description: "通知模块",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [],
	lifecycle: {
		async onInit(ctx) {
			// ① 登记 API 前缀：ctx.utils.request 被收敛到 /notification 下
			ctx.register.apiPrefix("/notification");
			// ② 把 scoped request 绑给生成 client
			notificationClient.bindRequest(ctx.utils.request);
			// ③ 注册 provider：四方法全必填
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

配套后端：契约四端点（`api/src/notification/contract.ts`）+ oj 端点实现（`api/src/notification/notifications/{,read/,read-all/,clear/}api.ts`）。`ojm init` 出的工程开箱即有此模块。

## 4. 生命周期与语义规则

### 4.1 注册时机：onInit 返回前

`loadAll` 会**整体 await** 每个模块的 `onInit`（`module-loader/index.ts`），而全部消费点（路由解析、登录守卫、通知铃渲染）都在这之后才发生。因此：

- ✅ onInit 里同步注册可以；
- ✅ onInit 里 `await import(...)` 之后再注册**也可以**（仍早于一切消费点）；
- ❌ onActivate / fire-and-forget 的延迟注册**不保证生效**。

### 4.2 先到先得 + 重复告警

每个注册口是**模块作用域单例**：第一个注册的模块胜出；第二个注册同口的模块被忽略并 `console.warn`（告警文案含落败方模块名）。没有 priority 字段——manifest 加载顺序即优先级语义。

> 推论：`ojm merge` 的模块顺序 = 命令行参数顺序，两团队 merge 顺序不同可能导致覆盖方不同，且只在浏览器 console 可见。给模块注册前先看 manifest 顺序。

### 4.3 卸载清理

`unloadModule(name)` 时框架按 `moduleName` 自动注销该模块登记的所有 provider / 布局 / 插槽（命名隔离，不影响其他模块）。**注意再解析语义**：已注入运行中路由树的组件不会热替换，需整页刷新才完全回落。

### 4.4 回落与降级

未注册 provider 时消费点回落内置实现。通知特例：内置回落端点是**只读**的，通知铃自动进入只读态（互动按钮禁用）——框架按 `onEventChange` 是否接线推导，模块作者无需关心。

### 4.5 版本漂移防御

provider 契约是 TS 接口，但**跨版本边界的运行时形状 TS 管不了**（仓外老 bundle 可能只有旧版少方法的 provider）。消费点对这类漂移做 `typeof` 逐方法检查：缺失则一次性 `console.warn` 并降级只读，不崩溃。模块作者应让 `peerRuntime` 范围与契约版本匹配。

## 5. 布局注册表（G1，与 provider 同构）

`ctx.register.layout("名字", 组件)` 注册布局名，供任意路由的 `handle.layout` 引用——包括**覆盖内建名**（`container` / `parent` / `fullscreen`），使别人写的 `"container"` 解析到你的组件。

```ts
ctx.register.layout("pro", MyLayout);        // 新名字
ctx.register.layout("container", MyLayout);  // 覆盖内建名
```

规则同 provider：先到先得、重复告警、onInit 返回前完成、卸载按模块清理。未知名（拼错的内建名）运行时 warn-once 一次并回落 Outlet。

> ⚠️ **覆盖内建名 = 自担 chrome 全部职责**：keepAlive 页签缓存、通知铃、header-actions 插槽、preferences 抽屉等内建 chrome 能力全部失效需自建。适用于 intentionally 更简的 chrome；想造「等价 container」目前不支持（积木导出有公开面失控风险，等真实需求再议）。

## 6. 常见坑速查

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 注册了 provider 却没生效 | 注册在 onInit 之后（onActivate/异步逃逸） | 挪进 onInit |
| 控制台「重复的 xx provider 忽略」 | 两个模块注册同口 | 先到先得，调整 manifest 顺序或撤掉一处 |
| 通知铃互动按钮全灰 | 未注册 provider 或 provider 缺写方法 | 补全四方法；老 bundle 见 §4.5 |
| 卸载模块后页面没还原 | 再解析语义，不热回落 | 整页刷新 |
| 后端下发路由用了模块布局名但渲染成 Outlet | 提供布局的模块未加载/未注册 | 看 console 的 `[layout] 未知名布局` warn-once |
| 写了后端路由但组件解析不到 | routesApi 返回的路由按框架 pages glob 解析 component | 模块自有组件的路由走模块 `routes`，别走 routesApi |

## 7. 相关源码索引

- 注册表：`packages/runtime/src/store/api-provider.ts`、`packages/runtime/src/store/auth-provider.ts`
- 布局注册表：`packages/runtime/src/layout/layout-registry.ts`
- 消费点委托样例：`packages/runtime/src/api/notifications/index.ts`、`packages/runtime/src/api/user/index.ts`
- 模块上下文类型：`packages/runtime/src/module-loader/types.ts`
- 模板示例：`packages/cli/templates/web/src/notification/entry.ts`、`packages/cli/templates/api/src/notification/`
- 设计文档：`docs/prd/202609122224-layout-injection-and-notification-design.md`
