# Provider 上手指南（大白话版）

> 日期：2026-09-13（实战案例 + 人话改写）
> 适用版本：`@oj-module/runtime` 0.1.9 及以上
> 写给：第一次给 oj-module 写模块的人
> 怎么用这篇：前面两节花五分钟看懂概念；第三节照着案例敲；后面几节当字典，出问题了再翻。

## 1. Provider 是个啥？

框架自己做了一批功能：登录、通知铃、头像上传、动态菜单……

但你的后端往往跟框架默认的不一样。Provider 就是一句话：**「这块别用框架自带的了，换我的。」**

你的模块在启动时（`onInit`）跟框架说一声「通知这块我包了」，框架以后要用通知功能时就来找你；你没吱声的地方，框架继续用自带的。框架代码一行不用改。

打个比方：框架是个饭店，默认菜单（内置接口）有几道菜。Provider 就是你这个外包厨师上门说「这几道菜以后我来做」，饭店照常营业，客人吃到的已经是你的手艺了。

## 2. 都能接管什么？

你的模块启动时会拿到一个 `ctx` 对象，`ctx.register` 下面就是所有能「抢活」的入口：

| 入口 | 抢什么活 | 要提供什么 | 你不抢时框架用啥 |
| --- | --- | --- | --- |
| `ctx.register.authProvider` | 登录、登出、查用户信息 | 3 个方法，缺一不可 | 自带的登录接口 |
| `ctx.register.systemApi` | 角色、菜单管理 | 11 个方法，缺一不可 | 自带的 |
| `ctx.register.notificationsApi` | 通知的读和写 | 4 个方法：拉列表、标一条已读、全部已读、清空 | 自带的只读接口（铃铛上的按钮会变灰） |
| `ctx.register.uploadApi` | 头像/文件上传 | 一个网址 + 一个取请求头的方法 | 自带的 |
| `ctx.register.routesApi` | 登录后从后端拿菜单/路由 | 1 个方法：返回路由列表 | 自带的 `web/get-async-routes` |
| `ctx.register.layout("名字", 组件)` | 换页面外壳（布局） | 一个 React 组件 | 自带的三种外壳（见第五节） |
| `ctx.registerSlot(位置, 节点)` | 往页面头部塞自定义内容 | 一个 React 节点 | 空着 |
| `ctx.register.apiPrefix("/你的前缀")` | 圈定本模块 API 的家（不是抢活，是报户口）。**用生成 client 时不用手写这行**——`createXxxClient(ctx)` 工厂构造时就替你登记了 | 一个 `/` 开头的路径 | —（不登记就用不了 scoped request） |
| `ctx.register.store(名字, store)` | 注册额外的 zustand store | 一个 store 实例 | — |

> `apiPrefix` 怎么理解：它是**前缀收敛**——登记后 `ctx.utils.request` 只会往 `/api/你的前缀/...` 发请求，想调别家模块或 root 级接口、`../` 往外穿越，发出去之前就会被拒。值必须和契约里 `defineApi` 的 `apiPrefix` 一字不差。用生成 client 时这行不用手写：`createXxxClient(ctx)` 构造时自动登记，前缀值就来自契约，存在生成物的 `API_PREFIX` 常量里（唯一真源，不会两处写岔）。

> **一条铁规矩：要抢就全抢。** 每个入口的方法一个都不能少——不能说「通知我只做读取，写操作还用框架的」。接口以后升级加了新方法时，老模块会和新框架对不上，这种升级要发版说明里专门提醒。

## 3. 动手案例（照着敲就能跑）

### 3.0 先记住一个坑：模块写了不等于模块会跑

一个模块要生效，**两件事缺一不可**：

1. 有文件：`web/src/你的模块名/entry.ts`，里面默认导出一个 `defineModule({...})`；
2. **去登记**：工程根目录的 `web.config.ts` 里，往 `modules` 数组加一项。`ojm dev` 只认清单里登记了的模块。

> 这可不是危言耸听——模板就真出过这个 bug：通知模块的文件都在，就是忘了登记，结果模块安安静静地没加载、按钮安安静静地灰着，**全程没有一个报错**。所以写完模块第一件事：检查 `web.config.ts`。
>
> ```ts
> // web.config.ts
> export default {
> 	baseUrl: "",
> 	modules: [
> 		{ name: "home", entry: "web/src/home/entry.ts", enabled: true },
> 		// 你的新模块必须写在这里，漏了它就不会跑
> 		{ name: "notification", entry: "web/src/notification/entry.ts", enabled: true },
> 	],
> };
> ```

清单里的**先后顺序**就是抢活的优先级（两个人抢同一个入口时，排前面的赢），细节见第四节。

### 3.1 案例 A：看懂模板自带的通知模块

`ojm init` 建出来的工程，通知功能开箱即用。拆开来正好是标准流程的四个文件：

**① 先说清楚接口长啥样** —— `api/src/notification/contract.ts`：

```ts
import { defineApi, z } from "@oj-module/runtime/contract";

const notificationItem = z.object({
	id: z.number(),       // 每条通知的唯一编号——「标一条已读」就靠它
	avatar: z.string(),
	date: z.string(),
	isRead: z.boolean().optional(),
	message: z.string(),
	title: z.string(),
});

export const fetchNotifications = defineApi({
	apiPrefix: "/notification",   // 模块前缀
	route: "/notifications",      // 合起来就是 /api/notification/notifications
	data: z.array(notificationItem),
	description: "通知列表",
});

export const markRead = defineApi({
	apiPrefix: "/notification",
	route: "/notifications/read",
	method: "POST",
	body: z.object({ id: z.number() }),
	description: "单条通知已读",
});
// 全部已读、清空同理，都是 POST
```

> 小提示：不返回数据的接口（比如「标记已读」），**不要把 `data` 写成 `z.null()`**——类型白名单不认它，直接不写 `data` 就行，跑了 `ojm api` 会报错告诉你。

**② 写接口真身** —— `api/src/notification/notifications/read/api.ts`。文件放哪，路由就是哪：`api/src/通知模块/通知列表/read/api.ts` 对应 `POST /api/通知模块/通知列表/read`。`db`、`json`、`http` 是框架给你的现成对象：

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

**③ 一键生成前端调用代码**：在工程根目录跑

```bash
pnpm ojm api
```

它会按契约生成带类型的调用函数，放到 `web/src/notification/client/`。这些文件是自动生成的，**别手改**。

**④ 前端接线** —— `web/src/notification/entry.ts`。这个模块没有页面，就是专门来「抢通知活」的：

```ts
import type { NotificationsApiProvider } from "@oj-module/runtime";
import { defineModule } from "@oj-module/runtime";
import { createNotificationClient } from "./client/api";

export default defineModule({
	name: "notification",
	description: "通知模块",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [],                       // 没有页面
	lifecycle: {
		async onInit(ctx) {
			// 构造即接线：createNotificationClient 替你干了两件事——
			// ① 登记契约前缀 /notification（唯一真源在 client/api.ts 的 API_PREFIX，
			//    与契约里 defineApi 的 apiPrefix 一致，不用手写、不可能写岔）；
			// ② 把圈好前缀的 ctx.utils.request 绑给生成 client（此后请求自动走
			//    /api/notification/...；越界调别家模块/root 级接口、或 "../" 向外
			//    穿越，发请求前即被客户端拒绝——前缀收敛，D11）。
			// 必须在 onInit 里创建；一模块一 client。
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

**敲完怎么验证？** `pnpm dev` 起工程（后端会自动一起起），然后：

1. 用 `admin / 123456` 登录 → 右上角铃铛上应该有个蓝点（种子数据里有未读消息）；
2. 点开铃铛 → 点任意一条 → 蓝点消失；点「全部已读」→ 全清；
3. 再点「清空」→ 列表空了。
4. 哪一步不对，按第七节的清单排查。

**以后你自己加接口，就背这条流水线：**

```
写契约（contract.ts）→ 写实现（api.ts）→ pnpm ojm api 生成调用代码 → entry.ts 里 create client + 注册
```

### 3.2 案例 B：接管头像上传（最简单的练手入口）

`uploadApi` 只要两个字段，不用写契约、不用生成代码，最适合拿来练手。目标：让用户头像传到你模块的接口。

**① 后端收文件**（模板里已有现成实现，可以照着抄）：

```ts
// api/src/personal-center/upload/api.ts
export default {
	async post() {
		const uid = http.user?.id;   // 登录校验框架已做，这里直接用
		if (!uid) { json.fail(401, "unauthorized"); return; }
		if (!http.files || http.files.length === 0) { json.fail(400, "no file"); return; }
		const meta = http.files[0];
		const bytes = await http.file(0);
		// …把文件转 base64 存库（或者存你自己的文件服务）
		const dataUrl = `data:${meta.content_type};base64,${toBase64(bytes)}`;
		await db.exec("UPDATE users SET avatar_base64 = ? WHERE id = ?", [dataUrl, Number(uid)]);
		json.ok(dataUrl);
	},
};
```

**② 前端抢活**（随便哪个模块的 onInit 里）：

```ts
const provider: UploadApiProvider = {
	action: "/api/personal-center/upload",   // 上传直接发到这（不走过生成的调用代码）
	// 注意：headers 是个「方法」，点上传那一刻才被调用——
	// 因为 token 会刷新，不能提前写好固定值
	headers: () => {
		const token = useAuthStore.getState().token;
		return token ? { Authorization: `Bearer ${token}` } : {};
	},
};
ctx.register.uploadApi(provider);
```

**验证**：个人中心换头像 → 显示新头像 → 刷新页面还在（说明真存上了）。如果报 401，九成是 `headers` 写成了固定对象而不是方法。

### 3.3 案例 C：给页面换外壳（布局）

框架自带三种外壳：`container`（有侧边栏+页签的完整版）、`parent`（嵌套用）、`fullscreen`（登录页那种全屏）。想要自己的？三步：

**① 写个外壳组件**（就是个普通组件，留一块地方给孩子页面渲染）：

```tsx
// web/src/pro-layout/index.tsx
import { Outlet } from "react-router";

export default function ProLayout() {
	return (
		<div className="min-h-screen flex flex-col">
			<header className="h-12 flex items-center px-4 border-b">My Brand</header>
			<main className="flex-1 p-6">
				<Outlet />   {/* 孩子页面渲染在这里，别漏 */}
			</main>
		</div>
	);
}
```

**② 给它起个名**（某个模块的 onInit 里）：

```ts
import ProLayout from "./pro-layout";
ctx.register.layout("pro", ProLayout);
```

**③ 谁想用谁用**——任何路由（包括后端下发的）在 `handle.layout` 里写这个名字：

```ts
{
	path: "/campaign",
	handle: { layout: "pro", title: "活动页" },
	children: [{ index: true, Component: CampaignPage, handle: { title: "活动页" } }],
}
```

**验证**：打开 `/campaign` → 只剩顶栏和内容区，侧边栏不见了。如果名字写错（比如 `"por"`），控制台会提醒一次 `[layout] 未知名布局 "por"`，页面照常用没外壳的样子渲染，不会崩。

> 进阶：也可以 `ctx.register.layout("container", ProLayout)` 把自带外壳**整个换掉**——后果见第五节，想清楚再动手。

### 3.4 案例 D：菜单从后端下发（routesApi）

场景：菜单不该写死在前端，要按登录人的角色从数据库查。

**① 后端返回路由列表**（什么角色看什么菜单）：

```ts
// api/src/menu/api.ts
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

**② 前端抢活**：

```ts
const menuClient = createMenuClient(ctx);   // 构造即登记 /menu 前缀 + 绑定 request
ctx.register.routesApi({
	fetchAsyncRoutes: () => menuClient.getAsyncRoutes(),
});
```

**验证**：登录 → 侧边栏出现你数据库里配的菜单。

> 注意一条边界：这里下发的页面组件**只能是框架里已有的**（按框架页面目录解析）。想推自己模块写的页面，走模块自己的 `routes` 静态注册，别走这条路。这条路适合做的是「同一个框架页面，谁可见」的权限控制。

## 4. 抢活的规矩

### 4.1 什么时候报名：onInit 结束之前

框架加载模块时，会**等你 onInit 里的代码全部跑完**（包括里面的 `await`），然后才开始解析路由、渲染铃铛。所以：

- ✅ onInit 里直接注册——稳；
- ✅ onInit 里先 `await import(...)` 加载个大组件再注册——也稳，还来得及；
- ❌ 拖到 onActivate 或者某个不管不顾的异步回调里才注册——不保证来得及，大概率不生效。

### 4.2 两个人抢同一个入口：先到的赢

每个入口只认**第一个**报名的模块；第二个会被忽略，并在控制台留一条警告（会说清楚谁赢了、谁被忽略了）。没有「优先级数字」可填——`web.config.ts` 里的排班顺序就是优先级。

> 提醒：模块清单是 `ojm merge` 合并出来的话，谁前谁后取决于合并时的参数顺序。两个团队合并顺序不同，赢的可能就不是同一个——而且这事只在浏览器控制台里看得出来。要让固定模块赢，就把它的顺序钉死。

### 4.3 模块被卸载：抢的活自动还回去

框架下线某个模块时，会自动把它注册的 provider、布局、插槽全部清掉（按模块名清，不会误伤别人）。但**已经渲染出来的页面不会自动换**——已经画上去的东西保持原样，刷新页面才是全新开始。

### 4.4 不抢的时候会怎样

框架用自己自带的实现兜底。通知是唯一有「降级」的：自带的通知接口只能读不能写，所以铃铛会进入**只读模式**（按钮灰掉、点列表没反应），这是刻意设计，不是坏了。

### 4.5 老模块遇上新框架

接口是 TypeScript 写的，但 TypeScript 管不到「已经打包发布的老模块」——它运行时可能还是旧版少几个方法的实现。框架对这种「老面新馅」做了防护：用之前先挨个检查方法在不在，缺了就提醒一次然后降级成只读，不会崩。你自己写模块时，把 `peerRuntime` 标对版本就行。

## 5. 换布局的特别提醒

- 规矩跟 provider 一样：先到的赢、重名警告、onInit 结束前报名、卸载自动清理；
- 名字写错会提醒一次然后当「没外壳」渲染，不会崩；
- 布局是在路由加载那一刻定下来的，**改了组件要刷新页面才看到新的**；
- ⚠️ **把 `container` 整个换掉 = 自己背起全部家当**：页签缓存、通知铃、头部自定义区、主题设置抽屉……这些全住在自带外壳里，换壳后它们一起消失，都得你自己重做。除非你就是想要个极简壳，否则别换它。

## 6. 踩坑速查

| 症状 | 病根 | 药方 |
| --- | --- | --- |
| 模块像不存在：没路由、没反应、也不报错 | `web.config.ts` 里没登记 | 登记后重启 `ojm dev` |
| 注册了却没效果 | 注册代码不在 onInit 里（拖到了 onActivate 或某个异步回调） | 挪进 onInit |
| 控制台说「重复的 xx provider 忽略」 | 两个模块抢同一个入口 | 排前面的赢；调整 `web.config.ts` 顺序，或撤掉一处 |
| 铃铛按钮全灰 | 没注册通知 provider，或者只写了拉列表一个方法 | 4 个方法补齐；老模块见 4.5 |
| 改了契约，前端类型没变 | 没重新生成 | 跑 `pnpm ojm api`；生成是确定的，diff 里应该只看到你改的那部分 |
| 接口调用报「请求未绑定」 | entry 的 onInit 里没调 `createXxxClient(ctx)`（旧写法是 `bindRequest`） | onInit 里先 `const client = createXxxClient(ctx)` 再发请求；一模块一 client |
| `ojm api` 报「schema 超出白名单」 | 契约里写了 `z.null()` 或 transform/refine 这类 | 不返回数据的接口干脆别写 `data`；校验放后端做 |
| 下线模块后页面没变 | 画好的页面不自动换 | 刷新页面 |
| 后端菜单用了我的布局名，页面却没外壳 | 注册那个布局的模块没加载 | 看控制台的 `[layout] 未知名布局` 提醒 |
| 后端下发的页面组件找不到 | 下发的组件名必须在框架页面目录里能查到 | 自己模块的页面走模块 `routes`，别从后端下发 |
| 上传报 401 | `headers` 写成了固定对象，token 过期了 | 写成方法，用的时候现取（案例 B） |

## 7. 排查清单（按顺序来，九成问题死在前两步）

1. **模块跑起来了吗**：`web.config.ts` 登记了吗？`pnpm ojm info` 能看到它吗？控制台有没有 `[module-loader]` 开头的报错？
2. **onInit 进了吗**：在 onInit 第一行写句 `console.log("我进来了")`——没打印就是加载问题，别怀疑注册代码。
3. **报名成功了吗**：控制台搜 `[api]`、`[layout]` 开头的黄字——「已由模块 A 提供，忽略 B」就是被抢了。
4. **请求发哪去了**：浏览器 F12 → Network，看请求地址——带 `/api/你的模块名/` 说明抢活了；打到不带前缀的地址说明还在用自带的。
5. **自带的也报错**：看响应里的 `{code, msg}`，后端把原因写在 msg 里了。

## 8. 想深入？去看源码

- 抢活登记表：`packages/runtime/src/store/api-provider.ts`、`packages/runtime/src/store/auth-provider.ts`
- 布局登记表：`packages/runtime/src/layout/layout-registry.ts`
- 「先查表、没人再兜底」的写法：`packages/runtime/src/api/notifications/index.ts`、`packages/runtime/src/api/user/index.ts`
- 能注册的东西的完整类型定义：`packages/runtime/src/module-loader/types.ts`
- 可以直接抄的完整例子：`packages/cli/templates/web/src/notification/entry.ts`、`packages/cli/templates/api/src/notification/`、`packages/cli/templates/web/src/personal-center/entry.ts`（上传）
- 这套机制的设计与评审记录：`docs/prd/202609122224-layout-injection-and-notification-design.md`
