# 认证 Provider 注入实施计划（P5）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> 设计文档：`docs/prd/202609021446-auth-provider-injection-design.md`（§7 落地顺序）
> 分支：`feat/login-p4-reference-and-docs`（就地实施，不开 worktree）
> 基线：`npx vitest run tests/runtime` → 21 files / 97 passed

**Goal：** 让模块能经 `ctx.register.authProvider()` 接管 runtime 的登录 / 登出 / 取用户信息，未注册时行为与今日完全一致。

**Architecture：** 新增模块作用域的 provider 注册表（非 React），`useAuthStore` / `useUserStore` 的 action 在入口处查一次 provider——有则委托、无则走内置 `fetchLogin/fetchLogout/fetchUserInfo`。注册只能经模块生命周期 `ctx`，`unloadModule` 时自动注销。

**Tech Stack：** zustand（store，注册表**不用** zustand）、vitest 4 + happy-dom、pnpm monorepo、ESLint（`@antfu` 风格：tab 缩进、无分号、单引号）

**通用注意事项：**

- 仓库用 tab 缩进、无分号、单引号；新增文件先跑 `npx eslint --fix <file>`
- 测试别名：`#src` → `packages/runtime/src`（`vite.config.ts:35`）
- 测试文件若 import runtime 主入口，需 `vi.mock("@ant-design/pro-components", () => ({ ProTable: () => null }))`（见 `runtime-exports.test.ts:30`）
- provider 注册表是**模块级单例**：每个用例注册后用 `unregisterAuthProvider(name)` 反注册自己用的名字，否则「先到先得」会让后续用例的注册被忽略
- 每任务结束单独 commit；commit 信息用 conventional commits（`feat(runtime): …` / `test(runtime): …`）

---

## Task 1：provider 注册表

**Files:**
- Create: `packages/runtime/src/store/auth-provider.ts`
- Create: `tests/runtime/auth-provider.test.ts`

**Step 1：写失败测试**（只测注册表本身）

```ts
// tests/runtime/auth-provider.test.ts
import { describe, expect, it, vi } from "vitest";

import {
	getAuthProvider,
	registerAuthProvider,
	unregisterAuthProvider,
} from "#src/store/auth-provider";

const provider = (tag: string) => ({
	login: vi.fn().mockResolvedValue({ token: `t-${tag}`, refreshToken: `r-${tag}` }),
	logout: vi.fn().mockResolvedValue(undefined),
	getUserInfo: vi.fn().mockResolvedValue({ id: tag, roles: [] }),
});

describe("auth provider 注册表（P5）", () => {
	it("注册后可读回，反注册后回到未注册", () => {
		registerAuthProvider("m-a", provider("a"));
		expect(getAuthProvider()).toBeDefined();
		unregisterAuthProvider("m-a");
		expect(getAuthProvider()).toBeUndefined();
	});

	it("先到先得：第二个注册者被忽略并告警", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = provider("first");
		registerAuthProvider("m-b", first);
		registerAuthProvider("m-c", provider("second"));
		expect(getAuthProvider()).toBe(first);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		unregisterAuthProvider("m-b");
	});

	it("非持有者的反注册不影响当前注册者", () => {
		const first = provider("owner");
		registerAuthProvider("m-d", first);
		unregisterAuthProvider("m-other");
		expect(getAuthProvider()).toBe(first);
		unregisterAuthProvider("m-d");
	});
});
```

**Step 2：运行，确认失败**

Run: `npx vitest run tests/runtime/auth-provider.test.ts`
Expected: FAIL — 找不到模块 `#src/store/auth-provider`

**Step 3：最小实现**

```ts
// packages/runtime/src/store/auth-provider.ts
import type { AuthType, LoginInfo, UserInfoType } from "#src/api/user/types";

/**
 * 认证 provider（P5）：模块经 ctx.register.authProvider 接管登录链路。
 * 三者全必填——「接管认证」是全量接管，不做部分托管（半托管会让两条链路
 * 并存、状态不可推理）。
 */
export interface AuthProvider {
	login: (payload: LoginInfo) => Promise<AuthType>
	logout: () => Promise<void>
	getUserInfo: () => Promise<UserInfoType>
}

/**
 * 模块作用域注册表。刻意不用 zustand：slots.ts 用 store 是因为布局组件要
 * 订阅变化，而 provider 只在 store action / 守卫 effect 中被读（非渲染期）。
 */
interface Registration {
	moduleName: string
	provider: AuthProvider
}

let current: Registration | undefined;

export function registerAuthProvider(moduleName: string, provider: AuthProvider): void {
	if (current) {
		console.warn(
			`[auth] 重复的认证 provider 忽略：已由模块 "${current.moduleName}" 提供，`
			+ `忽略 "${moduleName}"（先到先得，与 login 路由去重同一规则）。`,
		);
		return;
	}
	current = { moduleName, provider };
}

export function getAuthProvider(): AuthProvider | undefined {
	return current?.provider;
}

export function unregisterAuthProvider(moduleName: string): void {
	if (current?.moduleName === moduleName) {
		current = undefined;
	}
}
```

告警信息必须含「已有持有者模块名 + 被忽略模块名 + 先到先得」，否则线上排查时无法定位是哪个模块没接管成功。

**Step 4：运行，确认通过**

Run: `npx vitest run tests/runtime/auth-provider.test.ts`
Expected: 3 passed

**Step 5：Commit**

```bash
git add packages/runtime/src/store/auth-provider.ts tests/runtime/auth-provider.test.ts
git commit -m "feat(runtime): p5 auth provider 注册表（先到先得 + 反注册）"
```

---

## Task 2：`login` 委托

**Files:**
- Modify: `packages/runtime/src/store/auth.ts:31-42`
- Modify: `tests/runtime/auth-provider.test.ts`（新增 describe）

**Step 1：追加失败测试**

新 describe，复用 `tests/runtime/auth-login-failure.test.ts:13-34` 的 localStorage 内存垫（happy-dom 下 `localStorage` 缺 `setItem`，persist 写库会炸）与 `vi.mock("#src/api/user")`：

```ts
describe("auth store 委托 provider（P5）", () => {
	// 同 auth-login-failure.test.ts 的 vi.hoisted localStorage 垫 + vi.mock
	it("有 provider 时 login 走 provider 并写入 token", async () => {
		registerAuthProvider("m-login", { login: async () => ({ token: "t", refreshToken: "r" }), logout: async () => {}, getUserInfo: async () => ({ id: "1", roles: [] }) as any });
		await useAuthStore.getState().login({ username: "a", password: "b" });
		expect(useAuthStore.getState().token).toBe("t");
		expect(fetchLogin).not.toHaveBeenCalled();
		unregisterAuthProvider("m-login");
	});

	it("provider 抛错 → login 拒绝且 token 不变", async () => {
		useAuthStore.setState({ token: "old", refreshToken: "old-r" });
		registerAuthProvider("m-throw", { login: async () => { throw new Error("口令错误"); }, logout: async () => {}, getUserInfo: async () => ({ id: "", roles: [] }) as any });
		await expect(useAuthStore.getState().login({ username: "a", password: "b" })).rejects.toThrowError(/口令错误/);
		expect(useAuthStore.getState().token).toBe("old");
		unregisterAuthProvider("m-throw");
	});

	it("无 provider → 走内置 fetchLogin（回归 F12）", async () => {
		vi.mocked(fetchLogin).mockResolvedValue({ code: 200, result: { token: "builtin", refreshToken: "br" }, message: "ok", success: true });
		await useAuthStore.getState().login({ username: "a", password: "b" });
		expect(useAuthStore.getState().token).toBe("builtin");
	});
});
```

**Step 2：** `npx vitest run tests/runtime/auth-provider.test.ts` → 2 个新用例 FAIL

**Step 3：改 `store/auth.ts:31-42`**

```ts
login: async (loginPayload) => {
	const provider = getAuthProvider();
	if (provider) {
		set(await provider.login(loginPayload));
		return;
	}
	const response = await fetchLogin(loginPayload);
	if (response.success === false) {
		message.error(response.message || "登录失败");
		throw new Error(response.message || "登录失败");
	}
	set({ ...response.result });
},
```

文件头补 `import { getAuthProvider } from "#src/store/auth-provider";`

**Step 4：** 通过；并跑 `npx vitest run tests/runtime/auth-login-failure.test.ts` 确认 F12 回归仍绿

**Step 5：** `git commit -m "feat(runtime): p5 login 委托 auth provider（无 provider 行为不变）"`

---

## Task 3：`logout` 无条件清理本地

**Files:**
- Modify: `packages/runtime/src/store/auth.ts:44-55`

**Step 1：追加失败测试**

```ts
it("provider 登出抛错 → 本地状态仍被清空", async () => {
	useAuthStore.setState({ token: "x", refreshToken: "xr" });
	registerAuthProvider("m-lo", { login: async () => ({ token: "", refreshToken: "" }), logout: async () => { throw new Error("后端挂了"); }, getUserInfo: async () => ({ id: "", roles: [] }) as any });
	await expect(useAuthStore.getState().logout()).rejects.toThrowError(/后端挂了/);
	expect(useAuthStore.getState().token).toBe("");
	expect(useAuthStore.getState().refreshToken).toBe("");
	unregisterAuthProvider("m-lo");
});

it("无 provider 且 fetchLogout 失败 → 本地状态仍被清空", async () => { /* 同构，mock fetchLogout reject */ });

it("正常登出 → 走 provider 且清空", async () => { /* logoutSpy 被调用 + token 清空 */ });
```

**Step 2：** 运行 → FAIL（当前实现 `await fetchLogout()` 抛错后 `reset()` 不执行）

**Step 3：改 `store/auth.ts:44-55`**

```ts
logout: async () => {
	/**
	 * 1. 退出登录（provider 优先，未注册回落内置契约）
	 * 2. 清空 token 等其他信息 —— 放 finally：后端不可用时本地也必须清
	 *    （此前 await fetchLogout() 一抛错，reset() 完全不执行，
	 *    playground 这类无后端场景点了退出登录毫无反应）
	 */
	try {
		const provider = getAuthProvider();
		if (provider)
			await provider.logout();
		else
			await fetchLogout({ refreshToken: get().refreshToken });
	}
	finally {
		get().reset();
	}
},
```

**Step 4：** 通过

**Step 5：** `git commit -m "fix(runtime): logout 本地清理不再受后端失败阻塞（finally reset）"`

---

## Task 4：`getUserInfo` 委托

**Files:**
- Modify: `packages/runtime/src/store/user.ts:29-35`

**Step 1：追加失败测试**（`tests/runtime/auth-provider.test.ts`）

```ts
it("有 provider 时 getUserInfo 走 provider 并写入 user store", async () => {
	registerAuthProvider("m-user", { login: async () => ({ token: "", refreshToken: "" }), logout: async () => {}, getUserInfo: async () => ({ id: "42", username: "Tom", roles: ["common"] }) as any });
	const result = await useUserStore.getState().getUserInfo();
	expect(result.id).toBe("42");
	expect(useUserStore.getState().username).toBe("Tom");
	unregisterAuthProvider("m-user");
});

it("无 provider → 走内置 fetchUserInfo（取 response.result）", async () => {
	vi.mocked(fetchUserInfo).mockResolvedValue({ code: 200, result: { id: "7", username: "Builtin", roles: [] }, message: "ok", success: true });
	await useUserStore.getState().getUserInfo();
	expect(useUserStore.getState().username).toBe("Builtin");
});
```

**Step 2：** 运行 → FAIL

**Step 3：改 `store/user.ts`**

```ts
getUserInfo: async () => {
	const provider = getAuthProvider();
	const result = provider
		? await provider.getUserInfo()
		: (await fetchUserInfo()).result;
	set({ ...result });
	return result;
},
```

`auth-guard.tsx:88` 的调用点**不动**（委托下沉到 store）。

**Step 4：** 通过

**Step 5：** `git commit -m "feat(runtime): p5 getUserInfo 委托 auth provider"`

---

## Task 5：生命周期注入口 + 卸载清理

**Files:**
- Modify: `packages/runtime/src/module-loader/types.ts:15-20`
- Modify: `packages/runtime/src/module-loader/index.ts:25-51`（createModuleContext）
- Modify: `packages/runtime/src/module-loader/index.ts:294-304`（unloadModule）
- Create: `tests/fixtures/auth-provider-entry.tsx`
- Modify: `tests/runtime/auth-provider.test.ts`

**Step 1：追加失败测试（集成）**

夹具 `tests/fixtures/auth-provider-entry.tsx` 照抄 `tests/fixtures/scoped-request-entry.tsx` 的结构：

```tsx
import { defineModule } from "#src/index";

const definition = defineModule({
	name: "auth-provider-fixture",
	description: "auth provider 集成测试夹具",
	version: "1.0.0",
	routes: [],
	lifecycle: {
		async onInit(ctx) {
			ctx.register.authProvider({
				login: async payload => ({ token: `tok:${payload.username}`, refreshToken: "r" }),
				logout: async () => {},
				getUserInfo: async () => ({ id: "fixture", username: "Fixture", roles: ["admin"] }) as any,
			});
		},
	},
});

export default definition;
```

测试（关键：证明「不挂载登录页、仅 loadAll 后直接登出」也走 provider）：

```ts
describe("auth provider 生命周期注入（P5）", () => {
	beforeAll(async () => {
		const { loadAll } = await import("#src/module-loader");
		await loadAll({ modules: [{ name: "auth-provider-fixture", entry: pathToFileURL(`${PROJECT_ROOT}/tests/fixtures/auth-provider-entry.tsx`).href }] });
	});

	it("loadAll 后未渲染任何页面即可走 provider 登录/登出", async () => {
		await useAuthStore.getState().login({ username: "admin", password: "x" });
		expect(useAuthStore.getState().token).toBe("tok:admin");
		await useAuthStore.getState().logout();
		expect(useAuthStore.getState().token).toBe("");
	});

	it("unloadModule 后退回内置实现", async () => {
		const { unloadModule } = await import("#src/module-loader");
		await unloadModule("auth-provider-fixture");
		expect(getAuthProvider()).toBeUndefined();
	});
});
```

**Step 2：** 运行 → FAIL（`ctx.register.authProvider` 不存在）

**Step 3：实现**

`types.ts` 的 `register` 加一行（记得 import `AuthProvider` 类型）：

```ts
register: {
	store: (name: string, store: unknown) => void
	apiPrefix: (prefix: string) => void
	/** 接管登录/登出/用户信息（P5）；先到先得，模块卸载时自动注销 */
	authProvider: (provider: AuthProvider) => void
}
```

`createModuleContext` 里与 `registerSlot` 同构地闭包 `definition.name`：

```ts
authProvider: (provider: AuthProvider) => {
	registerAuthProvider(definition.name, provider);
},
```

`unloadModule` 中与 `removeModuleSlots(name)` 并列加 `unregisterAuthProvider(name);`

**Step 4：** 通过

**Step 5：** `git commit -m "feat(runtime): p5 ctx.register.authProvider 注入口 + 卸载清理"`

---

## Task 6：出口冻结契约同步

**Files:**
- Modify: `packages/runtime/src/index.ts`（在 store 导出区附近加类型导出）
- Modify: `tests/runtime/runtime-exports.test.ts:1-19, 153`

**Step 1：** 先只改测试（把 `AuthProvider` 加进 type import 列表与 `RuntimeTypeSurface` 联合），运行 `npx vitest run tests/runtime/runtime-exports.test.ts` → FAIL（类型不存在，运行时用例仍绿）

**Step 2：** `index.ts` 加：

```ts
// 认证 provider 注入契约（P5）：模块经 ctx.register.authProvider 实现
export type { AuthProvider } from "./store/auth-provider";
```

**注意：只导类型。** 注册函数不导出——否则模块可绕过生命周期乱注册。
**`packages/cli/src/build.ts` 的 `RUNTIME_STUB_SOURCE` 不需要改**：它按 `export const (\w+)` 比对运行时符号，纯类型导出不产生运行时符号（`runtime-exports.test.ts:137-147` 会守住这点）。

**Step 3：** 运行 `npx vitest run tests/runtime/runtime-exports.test.ts` → 通过

**Step 4：** `git commit -m "feat(runtime): p5 主入口导出 AuthProvider 类型（冻结契约同步）"`

---

## Task 7：playground login 模块落地

**Files:**
- Modify: `apps/playground/modules/src/login/entry.ts`
- Create: `apps/playground/mock/auth.mock.mjs`

**Step 1：** 先写 mock（dev server 在 `mock/*.mock.mjs` 未命中时回 404，可先 curl 验证）

```js
// playground 工程 mock：login 模块自有认证接口（模块命名空间 /login，
// 与框架内置 auth/* 无交集）。形态对齐 fake/auth.fake.ts。
export default [
	{
		url: "/login/login",
		method: "post",
		response: ({ body }) => {
			if (!body.username || !body.password) {
				return { code: 401, result: null, message: "账号或密码错误", success: false };
			}
			return { code: 200, result: { token: `mock-token-${body.username}`, refreshToken: `mock-refresh-${body.username}` }, message: "ok", success: true };
		},
	},
	{ url: "/login/logout", method: "post", response: () => ({ code: 200, result: {}, message: "ok", success: true }) },
	{ url: "/login/user-info", method: "get", response: () => ({ code: 200, result: { id: "1", avatar: "", username: "Admin", email: "", phoneNumber: "", description: "manager", roles: ["admin"] }, message: "ok", success: true }) },
];
```

**Step 2：** `entry.ts` 加 lifecycle（注意 `ctx.utils.request` 是 scoped client，**必须先 `register.apiPrefix`**）：

```ts
lifecycle: {
	async onInit(ctx) {
		ctx.register.apiPrefix("/login");
		ctx.register.authProvider({
		async login(payload) {
			const res = await ctx.utils.request.post("login/login", { json: payload }).json<ApiResponse<AuthType>>();
			if (res.success === false)
				throw new Error(res.message || "登录失败");
			return res.result;
		},
		async logout() {
			await ctx.utils.request.post("login/logout").json();
		},
		async getUserInfo() {
			const res = await ctx.utils.request.get("login/user-info").json<ApiResponse<UserInfoType>>();
			return res.result;
		},
		});
	},
},
```

类型从 runtime 主入口取：`import type { AuthProvider, AuthType, UserInfoType } from "@react-antd-module/runtime";`
（`ApiResponse` 若未从主入口导出，就在模块内自己声明一个最小信封类型，不要为此扩出口。）

**Step 3：验证**

```bash
pnpm --filter playground build          # 重建模块产物（改了 entry.ts）
pnpm --filter playground dev            # 起 dev server（默认 5174）
curl -s -X POST localhost:5174/api/login/login -H 'content-type: application/json' -d '{"username":"admin","password":"1"}'
# 期望：{"code":200,"result":{"token":"mock-token-admin",...},"success":true}
```

浏览器验证（shell 宿主链**无 AuthGuard**，见设计文档 §5 已知边界）：
1. 打开 `/login`，输入任意非空账号密码 → 提交后跳转 `/home`，DevTools → Application → Local Storage 出现 `react-antd-admin:access-token` 且 token 为 `mock-token-*`
2. 点顶栏头像 → 退出登录 → 该 key 被清空，顶栏头像回落默认人形图标

**Step 4：** `git commit -m "feat(playground): login 模块经 onInit 注入真实认证实现 + auth mock"`

---

## Task 8：全量验证与文档

**Files:**
- Modify: `docs/prd/module-development-guide.md`（新增「认证 Provider 注入」章节）

**Step 1：全量验证**

```bash
npx vitest run tests/runtime tests/module tests/shell      # 目标：全绿（基线 97 + 新增）
pnpm typecheck                                             # tsc --noEmit，守住类型出口面
npx eslint packages/runtime/src/store/auth-provider.ts apps/playground/modules/src/login/entry.ts --fix
```

**Step 1.5：dist 同步（收尾必做，见设计文档 §10）**——改 `packages/runtime/src` 后必须重建并提交 dist，否则 checkout 后 dev 加载旧 `runtime.js` 缺 `authProvider` 方法：

```bash
pnpm --filter @react-antd-module/runtime build
pnpm --filter @react-antd-module/shell build
git add packages/runtime/dist packages/shell/dist   # 与源码一起提交
```

**Step 2：** 手册补章节，内容要点（对齐手册既有编号风格）：
- provider 三方法与返回契约
- 只能经 `lifecycle.onInit` 的 `ctx.register.authProvider` 注册，先到先得
- `ctx.utils.request` 需先 `register.apiPrefix`
- 未注册时回落框架内置 `auth/login`、`auth/logout`、`web/user-info`
- 登出失败也会清本地

**Step 3：** `git commit -m "docs: 模块手册补认证 provider 注入章节"`

---

## 验收清单

- [ ] 未注册 provider 时，`login`/`logout`/`getUserInfo` 行为与改造前完全一致（`auth-login-failure.test.ts` 全绿）
- [ ] 注册后三者全部走 provider
- [ ] provider 登出抛错，本地 token/用户/权限/tabs 仍被清空
- [ ] `unloadModule` 后 provider 注销，退回内置实现
- [ ] 主入口只新增 `AuthProvider` **类型**导出，cli `RUNTIME_STUB_SOURCE` 无需改动
- [ ] playground：登录真写 token、登出真清 token（Local Storage 可观测）
