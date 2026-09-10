# Layout E2E 基线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 执行约定（用户指定）：**最快方式实现，逐任务审查取消，审查统一放 Phase 5**；每 Phase 结束更新任务状态并在本文 §7 执行日志追加小结（关键过程与耗时）。

**Goal:** 建立 layout（header/footer/sidebar/tabbar/menu）真实浏览器行为基线，双环境（playground=HEAD、legacy=411e353b）可跑，闭环 HANDOFF §4 菜单空白并修复演进偏差。

**Architecture:** Playwright + 语义选择器（`header/aside/main/.ant-menu/.ant-tabs-tab/footer`），spec 零 import 源码；环境差异收敛于 `e2e/fixtures/env.ts`（`E2E_TARGET` 切换）；菜单断言数据驱动（DOM ↔ 路由一致性），不写死条目。

**Tech Stack:** @playwright/test（chromium）、ram dev(:5174)、vite dev(:3333, legacy worktree)。

**设计文档：** `docs/prd/202608311543-layout-e2e-baseline-design.md`（覆盖矩阵 S1-S5/H1-H4/T1-T5/F1/M1-M2 以此为准）

## Global Constraints

- spec 文件**禁止 import 任何源码**（`#src/*`、`@react-antd-module/*` 均不可）；只通过 DOM/URL/localStorage 观测。
- 菜单相关断言一律数据驱动，不出现硬编码菜单条目（唯一例外： playground 语言切换用例用「演示模块/Demo Module」对，其来自 HANDOFF §2 既定验收点）。
- 数值类断言（侧栏宽度等）读运行时计算样式，不硬编码像素。
- 等待一律用 `expect(...).toBeVisible()` / `waitForURL` 轮询，禁止固定 `waitForTimeout`（动画除外，允许一次性 500ms 过渡等待）。
- 分支：`feature/layout-e2e-baseline`；每 Task 末尾按步骤提交，commit 用 conventional commits（中文 scope 描述均可）。
- ESLint 为 antfu 规则：tab 缩进、双引号、分号；`e2e/` 下测试文件若报 `no-console` 等误报，用行内注释关闭。

## 已知事实（探索结论，直接可用）

- **playground 环境**：`pnpm --filter playground dev` = `ram dev 5174`（**注意：包名是 `playground`，非 HANDOFF 所写的 `@apps/playground`**——HANDOFF §7 命令已过时）；免登录（D5②）；菜单仅 demo 模块（当前 1 项 `/demo`）；dev 前需先构建：`pnpm --filter @react-antd-module/shell build && pnpm --filter playground build`。
- **legacy 环境**：worktree 检出 411e353b 至 `.e2e-legacy/`；`pnpm dev` = vite :3333（vite.config 内 `port: 3333`）；fake 登录预填 `admin / 123456789admin`（`src/pages/login/components/password-login.tsx` 的 `FORM_INITIAL_VALUES`），点提交即过；登录后跳 `/home`。
- **DOM 锚点**：antd Sider 收起态类 `.ant-layout-sider-collapsed`；菜单选中 `.ant-menu-item-selected`；submenu `.ant-menu-submenu`；页签 `.ant-tabs-tab` / 激活 `.ant-tabs-tab-active` / 关闭钮 `.ant-tabs-tab-remove`；页脚为语义 `<footer>`；折叠触发器为 header 内带 `.anticon-menu-fold`/`.anticon-menu-unfold` 图标的 button；偏好里页脚开关字段名 `enableFooter`。
- **demo 页面现状**：仅一张 `Card+Tag`，无状态组件 → T2（keepalive）需先在 demo 模块加第二页（Task 4 内完成）。

---

## Phase 1：骨架 + playground 冒烟（闭环菜单空白）

### Task 1: Playwright 骨架与环境适配器

**Files:**
- Modify: `package.json`（devDeps + scripts）
- Create: `e2e/playwright.config.ts`
- Create: `e2e/fixtures/env.ts`
- Create: `e2e/fixtures/enter-app.ts`
- Modify: `.gitignore`（追加 `.e2e-legacy/`、`e2e/test-results/`、`e2e/playwright-report/`——playwright 默认输出目录相对 config 所在目录）
- Create: `e2e/fixtures/menu.ts`

**Interfaces:**
- Produces: `getEnv(): { name: "playground" | "legacy"; baseURL: string; needsAuth: boolean; homePath: string }`（`e2e/fixtures/env.ts`）；`enterApp(page: Page): Promise<void>`（`e2e/fixtures/enter-app.ts`，完成 goto + 按需登录 + 等 header 可见）；`expandAllSubmenus(page: Page): Promise<void>`（`e2e/fixtures/menu.ts`，展开全部 collapsed submenu 使所有 `.ant-menu-item` 挂载——antd 收起态不渲染子项，凡按索引遍历菜单项的 spec 必须先调它）。后续所有 spec 只经这三个入口交互。

- [x] **Step 1: 安装依赖与浏览器**

```bash
pnpm add -D -w @playwright/test
pnpm exec playwright install chromium
```

- [x] **Step 2: 写 `e2e/playwright.config.ts`**

```ts
import process from "node:process";
import { defineConfig } from "@playwright/test";

const target = (process.env.E2E_TARGET ?? "playground") as "playground" | "legacy";

const TARGETS = {
	playground: {
		baseURL: "http://localhost:5174",
		webServer: {
			command: "pnpm --filter playground dev",
			url: "http://localhost:5174",
			// ram dev 端口被占会顺延（HANDOFF §8 坑），不复用、撞车即报错
			reuseExistingServer: false,
			timeout: 120_000,
		},
	},
	legacy: {
		baseURL: "http://localhost:3333",
		webServer: {
			command: "pnpm --dir .e2e-legacy dev -- --strictPort",
			url: "http://localhost:3333",
			reuseExistingServer: false,
			timeout: 120_000,
		},
	},
} as const;

export default defineConfig({
	testDir: "./layout",
	timeout: 30_000,
	retries: 0,
	workers: 1, // 串行：tabbar/menu 用例有全局 UI 状态，并行会互相干扰
	reporter: [["list"]],
	use: {
		baseURL: TARGETS[target].baseURL,
		trace: "retain-on-failure",
	},
	webServer: TARGETS[target].webServer,
	projects: [{ name: target }],
});
```

- [x] **Step 3: 写 `e2e/fixtures/env.ts` 与 `e2e/fixtures/enter-app.ts`**

```ts
// e2e/fixtures/env.ts
import process from "node:process";

export interface EnvProfile {
	name: "playground" | "legacy";
	baseURL: string;
	needsAuth: boolean;
	homePath: string;
}

export function getEnv(): EnvProfile {
	const name = (process.env.E2E_TARGET ?? "playground") as EnvProfile["name"];
	return name === "legacy"
		? { name, baseURL: "http://localhost:3333", needsAuth: true, homePath: "/home" }
		: { name: "playground", baseURL: "http://localhost:5174", needsAuth: false, homePath: "/demo" };
}
```

```ts
// e2e/fixtures/enter-app.ts
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { getEnv } from "./env";

/** 进入主界面：goto → 按需登录 → 等布局与菜单就绪 */
export async function enterApp(page: Page): Promise<void> {
	const env = getEnv();
	await page.goto("/");
	if (env.needsAuth) {
		// legacy 登录表单已预填 admin/123456789admin，直接提交
		await page.locator("form").getByRole("button").first().click();
		await page.waitForURL(`**${env.homePath}**`);
	}
	// 布局 chrome 就绪是所有用例的公共前置（S1 的断言不放在这里，此处仅等渲染）
	await expect(page.locator("header")).toBeVisible();
}
```

```ts
// e2e/fixtures/menu.ts
import type { Page } from "@playwright/test";

/** 展开全部 collapsed submenu，使所有 .ant-menu-item 进入 DOM（antd 收起态不挂载子项） */
export async function expandAllSubmenus(page: Page): Promise<void> {
	const collapsed = page.locator(".ant-menu-submenu:not(.ant-menu-submenu-open) > .ant-menu-submenu-title");
	while (await collapsed.count() > 0) {
		await collapsed.first().click();
		// 点击后该项移出「未展开」集合，locator 自动重查；等待收敛防死循环
		await page.waitForTimeout(300);
	}
}
```

- [x] **Step 4: 更新 `package.json` scripts 与 `.gitignore`**

```json
"test:e2e": "playwright test --config e2e/playwright.config.ts",
"test:e2e:legacy": "E2E_TARGET=legacy playwright test --config e2e/playwright.config.ts",
"test:e2e:ui": "playwright test --config e2e/playwright.config.ts --ui"
```

`.gitignore` 追加：

```
.e2e-legacy/
e2e/test-results/
e2e/playwright-report/
```

- [x] **Step 5: 构建 shell 与 playground 产物（ram dev 前置）**

```bash
pnpm --filter @react-antd-module/shell build && pnpm --filter playground build
```

- [x] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore e2e/
git commit -m "test(e2e): Playwright 骨架与双环境适配器"
```

### Task 2: S1 冒烟——菜单非空（HANDOFF 闭环）

**Files:**
- Create: `e2e/layout/sidebar.spec.ts`

**Interfaces:**
- Consumes: `enterApp`（Task 1）

- [x] **Step 1: 写冒烟用例（先跑，预期暴露 HANDOFF §4 白屏）**

```ts
// e2e/layout/sidebar.spec.ts
import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";

test.describe("sidebar", () => {
	test.beforeEach(async ({ page }) => {
		await enterApp(page);
	});

	// S1：布局 chrome 齐全且菜单非空（HANDOFF §4 闭环用例）
	test("S1: 布局 chrome 渲染且菜单非空", async ({ page }) => {
		await expect(page.locator("header")).toBeVisible();
		await expect(page.locator("aside")).toBeVisible();
		await expect(page.locator("main")).toBeVisible();
		await expect(page.locator(".ant-menu")).toBeVisible();
		await expect(page.locator(".ant-menu .ant-menu-item")).not.toHaveCount(0);
	});
});
```

- [x] **Step 2: 运行，观察结果**

```bash
pnpm test:e2e
```

Expected 两种结局：
- **PASS** → 说明 D5 修复在真实浏览器生效，HANDOFF §4 闭环（H1/H2 类环境幻觉），直接进 Step 4。
- **FAIL（菜单为空或跳转异常）** → 进 Step 3 修复。

- [x] **Step 3:（条件步骤，仅 FAIL 时）定位并修复菜单空白**

按 HANDOFF §4 排查清单执行，顺序：
1. `pnpm test:e2e -- --headed`（或 `pnpm test:e2e:ui`）肉眼确认现象；
2. 在 page 上取数：`page.evaluate` 读 `localStorage` 无菜单数据属正常——改在 `packages/runtime/src/module-loader/index.tsx` 的 `loadAll` 末尾临时 `console.log(useAccessStore.getState().wholeMenus)`，重建 shell（`pnpm --filter @react-antd-module/shell build`）后重跑，看 host 链路 `setAccessStore` 是否执行、`wholeMenus` 是否含 `/demo`；
3. 若 `wholeMenus` 为空 → 修 `module-loader`/`resolve-layout` 链路；若 `wholeMenus` 含 `/demo` 但视觉空白 → 查 `usePreferences` 默认收起态（H2）与 `LayoutSidebar` 渲染条件；
4. 修复后必须回归：`npx vitest run tests/playground-e2e.test.tsx tests/playground-no-auth.test.tsx` 全绿，再跑 `pnpm test:e2e` 至 PASS。

- [x] **Step 4: Commit**

```bash
git add e2e/layout/sidebar.spec.ts
# 若 Step 3 有修复，一并提交并注明根因
git commit -m "test(e2e): S1 布局 chrome 与菜单非空冒烟（HANDOFF §4 闭环）"
```

**Phase 1 收尾：** 在 §7 执行日志追加 Phase 1 小结（S1 初跑红/绿、若红根因与修法、耗时），勾掉 Task 1-2 复选框。

---

## Phase 2：菜单一致性 + sidebar 完整行为

### Task 3: M1/M2 菜单↔路由数据驱动一致性

**Files:**
- Create: `e2e/layout/menu-consistency.spec.ts`

**Interfaces:**
- Consumes: `enterApp`

- [x] **Step 1: 写用例**

```ts
// e2e/layout/menu-consistency.spec.ts
import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";
import { expandAllSubmenus } from "../fixtures/menu";

test.describe("menu-consistency", () => {
	test.beforeEach(async ({ page }) => {
		await enterApp(page);
	});

	// M1：每个菜单项可点击、URL 变化、内容区非空；数据全来自运行时 DOM
	test("M1: 全部菜单项可达且内容非空", async ({ page }) => {
		await expandAllSubmenus(page);
		const items = page.locator(".ant-menu .ant-menu-item");
		const count = await items.count();
		expect(count).toBeGreaterThan(0);
		for (let i = 0; i < count; i++) {
			const urlBefore = page.url();
			await items.nth(i).click();
			await page.waitForURL(url => url.toString() !== urlBefore);
			await expect(page.locator("main")).not.toBeEmpty();
		}
	});

	// M2：菜单项点击后，对应项高亮（当前路由 ↔ 菜单选中态一致）
	test("M2: 当前路由对应菜单项高亮", async ({ page }) => {
		await expandAllSubmenus(page);
		const items = page.locator(".ant-menu .ant-menu-item");
		for (let i = 0, count = await items.count(); i < count; i++) {
			await items.nth(i).click();
			await expect(page.locator(".ant-menu .ant-menu-item-selected")).toHaveCount(1);
		}
	});
});
```

- [x] **Step 2: 运行至 PASS**（红则按 Phase 1 Task 2 Step 3 同样流程定位修复；实际 M2 首跑红，根因与修复见 §7 Phase 2 小结）

```bash
pnpm test:e2e
```

- [x] **Step 3: Commit** `test(e2e): M1/M2 菜单↔路由数据驱动一致性`

### Task 4: demo 模块补第二页 + S2-S5 sidebar 行为

**Files:**
- Create: `apps/playground/modules/demo/pages/detail.tsx`
- Modify: `apps/playground/modules/demo/entry.ts`（routes 追加 `/demo/detail` 子路由）
- Modify: `apps/playground/modules/demo/locales/zh-CN.json`、`en-US.json`（加 `menu.detail` / `page.detail` 文案）
- Modify: `e2e/layout/sidebar.spec.ts`（追加 S2-S5）

**Interfaces:**
- Produces: demo 模块第二路由 `/demo/detail`，页面含一个受控 `Input`（`placeholder="detail-input"`）——Task 5 的 T2 keepalive 用例依赖它。

- [x] **Step 1: 写失败测试（S2-S5 追加到 sidebar.spec.ts）**

```ts
	// S2/S3：折叠触发器收起再展开
	test("S2-S3: 侧栏折叠与恢复", async ({ page }) => {
		const sider = page.locator("aside");
		const widthBefore = await sider.evaluate(el => el.getBoundingClientRect().width);
		const trigger = page.locator("header button:has(.anticon-menu-fold), header button:has(.anticon-menu-unfold)");
		await trigger.first().click();
		await expect(sider).toHaveClass(/ant-layout-sider-collapsed/);
		const widthCollapsed = await sider.evaluate(el => el.getBoundingClientRect().width);
		expect(widthCollapsed).toBeLessThan(widthBefore);
		await trigger.first().click();
		await expect(sider).not.toHaveClass(/ant-layout-sider-collapsed/);
	});

	// S4：当前路由对应菜单项高亮、父级 submenu 展开
	test("S4: 菜单选中态跟随路由", async ({ page }) => {
		await expect(page.locator(".ant-menu-item-selected, .ant-menu-submenu-selected").first()).toBeVisible();
	});

	// S5：submenu 点击只展开/收起，不跳转
	test("S5: submenu 展开不跳转", async ({ page }) => {
		const submenuTitle = page.locator(".ant-menu-submenu-title").first();
		test.skip(await submenuTitle.count() === 0, "当前环境无 submenu");
		const urlBefore = page.url();
		await submenuTitle.click();
		await page.waitForTimeout(500); // 展开动画
		expect(page.url()).toBe(urlBefore);
	});
```

- [x] **Step 2: 运行确认新增用例状态**（S2/S3/S4 应可直接 PASS；S5 取决于菜单层级；同时 M1 现在仍只覆盖 1 项）

- [x] **Step 3: demo 模块加 `/demo/detail` 页**

```tsx
// apps/playground/modules/demo/pages/detail.tsx
import { BasicContent } from "@react-antd-module/runtime";
import { Card, Input } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function DemoDetailPage() {
	const { t } = useTranslation();
	const [value, setValue] = useState("");
	return (
		<BasicContent>
			<Card title={t("demo:page.detail")}>
				<Input placeholder="detail-input" value={value} onChange={e => setValue(e.target.value)} />
			</Card>
		</BasicContent>
	);
}
```

`entry.ts` children 追加：

```ts
{
	path: "detail",
	Component: DemoDetailPage,
	handle: {
		title: "demo:menu.detail",
		keepAlive: true,
	},
},
```

locales 两个 json 各加 `menu.detail` 与 `page.detail`。重建：`pnpm --filter playground build`。

- [x] **Step 4: 全套 e2e 跑绿后 Commit**

```bash
pnpm test:e2e
git add apps/playground/modules/demo e2e/layout/sidebar.spec.ts
git commit -m "test(e2e): S2-S5 侧栏行为；demo 模块补 detail 页供 keepalive/多页签验证"
```

**Phase 2 收尾：** §7 追加小结（菜单项数、红绿过程、耗时），勾选 Task 3-4。

---

## Phase 3：header / tabbar / footer

### Task 5: T1-T5 tabbar（含 keepalive 行为等价验证）

**Files:**
- Create: `e2e/layout/tabbar.spec.ts`

**Interfaces:**
- Consumes: `enterApp`；demo 模块 `/demo` 与 `/demo/detail`（Task 4 产出，detail 页 `Input[placeholder="detail-input"]`）

- [x] **Step 1: 写用例**

```ts
// e2e/layout/tabbar.spec.ts
import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";
import { getEnv } from "../fixtures/env";
import { expandAllSubmenus } from "../fixtures/menu";

test.describe("tabbar", () => {
	test.beforeEach(async ({ page }) => {
		await enterApp(page);
		await expandAllSubmenus(page); // 按索引取菜单项前必须展开全部 submenu
	});

	// T1：经菜单连开两页，页签逐个出现且后者激活（playground 有 /demo、/demo/detail；legacy 菜单项更多，取前两项）
	test("T1: 打开页面产生页签并激活", async ({ page }) => {
		const items = page.locator(".ant-menu .ant-menu-item");
		test.skip(await items.count() < 2, "菜单项不足两个");
		await items.nth(0).click();
		await items.nth(1).click();
		await expect(page.locator(".ant-tabs-tab")).toHaveCount(2);
		await expect(page.locator(".ant-tabs-tab-active")).toHaveCount(1);
	});

	// T2：keepalive——detail 页输入态在来回切换后保留（验证 layout-content KeepAlive 上移的行为等价性）
	test("T2: 页签切换 keepalive 状态保留", async ({ page }) => {
		test.skip(getEnv().name !== "playground", "状态页锚点仅 playground 具备");
		await page.goto("/demo/detail");
		await page.getByPlaceholder("detail-input").fill("keepalive-check");
		await page.goto("/demo"); // 第二页：页签 [detail, demo]，demo 激活
		await page.locator(".ant-tabs-tab").first().click(); // 点 detail 页签切回
		await expect(page.getByPlaceholder("detail-input")).toHaveValue("keepalive-check");
	});

	// T3：关闭非激活页签，激活态不变
	test("T3: 关闭非激活页签", async ({ page }) => {
		const items = page.locator(".ant-menu .ant-menu-item");
		test.skip(await items.count() < 2, "菜单项不足两个");
		await items.nth(0).click();
		await items.nth(1).click();
		await page.locator(".ant-tabs-tab").nth(0).locator(".ant-tabs-tab-remove").click();
		await expect(page.locator(".ant-tabs-tab")).toHaveCount(1);
		await expect(page.locator(".ant-tabs-tab-active")).toHaveCount(1);
	});

	// T4：关闭激活页签后仍有唯一激活页签（落到剩余页签）
	test("T4: 关闭激活页签", async ({ page }) => {
		const items = page.locator(".ant-menu .ant-menu-item");
		test.skip(await items.count() < 2, "菜单项不足两个");
		await items.nth(0).click();
		await items.nth(1).click();
		await page.locator(".ant-tabs-tab-active").locator(".ant-tabs-tab-remove").click();
		await expect(page.locator(".ant-tabs-tab")).toHaveCount(1);
		await expect(page.locator(".ant-tabs-tab-active")).toHaveCount(1);
	});

	// T5：「关闭其他」后仅剩当前页签
	test("T5: 关闭其他页签", async ({ page }) => {
		const items = page.locator(".ant-menu .ant-menu-item");
		test.skip(await items.count() < 2, "菜单项不足两个");
		await items.nth(0).click();
		await items.nth(1).click();
		// TabOptions 下拉（tabbar 右侧更多按钮），点「关闭其他」
		await page.locator(".ant-tabs + * button, .ant-tabs-nav-operations button").first().click();
		await page.locator(".ant-dropdown-menu-item", { hasText: /关闭其他|Close [Oo]thers/ }).click();
		await expect(page.locator(".ant-tabs-tab")).toHaveCount(1);
	});
});
```

- [x] **Step 2: 运行至 PASS**；T5 的下拉入口选择器若失配，用 `--ui` 模式看运行时 DOM 调整（两处布局对 tabbar 操作区的 DOM 可能不同，以实际为准）
- [x] **Step 3: Commit** `test(e2e): T1-T5 页签行为与 keepalive 等价性`

### Task 6: H1-H4 header + F1 footer

**Files:**
- Create: `e2e/layout/header.spec.ts`
- Create: `e2e/layout/footer.spec.ts`

**Interfaces:**
- Consumes: `enterApp`

- [x] **Step 1: header 用例**

```ts
// e2e/layout/header.spec.ts
import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";
import { getEnv } from "../fixtures/env";

test.describe("header", () => {
	test.beforeEach(async ({ page }) => {
		await enterApp(page);
	});

	// H1：header 含 logo、折叠触发器、用户菜单
	test("H1: header 基本元素", async ({ page }) => {
		const header = page.locator("header");
		await expect(header.locator("img, .anticon").first()).toBeVisible(); // logo 或首图标
		await expect(header.locator("button:has(.anticon-menu-fold), button:has(.anticon-menu-unfold)").first()).toBeVisible();
		await expect(header.locator(".ant-avatar")).toBeVisible(); // 用户菜单
	});

	// H2：侧栏导航模式下 header 左区为面包屑且层级与路由一致
	test("H2: 面包屑与当前路由一致", async ({ page }) => {
		const crumb = page.locator("header .ant-breadcrumb");
		await expect(crumb).toBeVisible();
		await expect(crumb.locator("li").last()).not.toBeEmpty();
	});

	// H3：语言切换后菜单文案变化（数据驱动：取切换前首项文本对比）
	test("H3: 语言切换菜单文案变化", async ({ page }) => {
		const firstItem = page.locator(".ant-menu .ant-menu-item").first();
		const textBefore = await firstItem.textContent();
		await page.locator("header button:has(.anticon)").filter({ has: page.locator("[class*='global'], [class*='translation'], .anticon-translation") }).first().click();
		await page.locator(".ant-dropdown-menu-item, .ant-select-item").last().click(); // 切到另一种语言
		await expect(firstItem).not.toHaveText(textBefore ?? "");
	});

	// H4：主题切换后根元素 dark 类变化
	test("H4: 主题切换", async ({ page }) => {
		const html = page.locator("html");
		const darkBefore = await html.evaluate(el => el.classList.contains("dark"));
		await page.locator("header button").filter({ has: page.locator("[class*='sun'], [class*='moon']") }).first().click();
		await expect.poll(async () => html.evaluate(el => el.classList.contains("dark"))).toBe(!darkBefore);
	});
});
```

- [x] **Step 2: footer 用例（绑定偏好存储，不依赖设置面板 UI）**

```ts
// e2e/layout/footer.spec.ts
import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";

test.describe("footer", () => {
	// F1：footer 可见性与偏好持久化中的 enableFooter 一致（数据驱动，两环境默认不同也能过）
	test("F1: footer 显隐与偏好一致", async ({ page }) => {
		await enterApp(page);
		const enableFooter = await page.evaluate(() => {
			const key = Object.keys(localStorage).find(k => k.includes("preferences"));
			if (!key)
				return undefined;
			try {
				return JSON.parse(localStorage.getItem(key) ?? "")?.state?.enableFooter;
			}
			catch {
				return undefined;
			}
		});
		const footer = page.locator("footer");
		if (enableFooter === false)
			await expect(footer).toHaveCount(0);
		else
			await expect(footer).toBeVisible();
	});
});
```

- [x] **Step 3: 运行至 PASS**；H3/H4 的按钮选择器按运行时 DOM 校准（语言/主题按钮图标名两环境可能不同）
- [x] **Step 4: Commit** `test(e2e): H1-H4 header 与 F1 footer`

**Phase 3 收尾：** §7 追加小结（keepalive 等价性结论、选择器校准点、耗时），勾选 Task 5-6。

---

## Phase 4：legacy 双环境 + 偏差修复

### Task 7: legacy worktree 接入，全套双绿

**Files:**
- Create: `.e2e-legacy/`（worktree，gitignored，不入库）

**Interfaces:**
- Consumes: 全部 spec（Task 2-6）；`enterApp` 的 legacy 登录分支（Task 1）

- [x] **Step 1: 建 worktree 并装依赖**

```bash
git worktree add .e2e-legacy 411e353b
pnpm --dir .e2e-legacy install
```

- [x] **Step 2: 跑 legacy 全套**

```bash
pnpm test:e2e:legacy
```

- [x] **Step 3: 处理失败，逐条分类**（写进 §7 执行日志）：

| 分类 | 含义 | 动作 |
|------|------|------|
| 选择器失配 | spec 对 legacy DOM 定位不准（如登录按钮、语言按钮） | 改 spec/fixture 选择器使其两环境兼容（语义优先） |
| 真偏差 | legacy 绿 / playground 红，或反之 | 按设计 §5：修 playground 侧至双绿；除非证明 legacy 行为本身是 bug，则修 legacy 行为定义并更新 spec |
| legacy 环境自身问题 | worktree 依赖/端口 | 修环境，不改 spec |

- [x] **Step 4: 双环境全绿后回归 vitest，Commit**

```bash
pnpm test:e2e && pnpm test:e2e:legacy
npx vitest run tests/playground-e2e.test.tsx tests/playground-no-auth.test.tsx tests/tabs-store.test.ts tests/container-layout-jss-theme.test.tsx
git add -A && git commit -m "test(e2e): legacy(411e353b) 双环境基线贯通，修复演进偏差"
```

**Phase 4 收尾：** §7 追加小结（发现的偏差清单与处置、耗时），勾选 Task 7。

---

## Phase 5：文档回写 + 审查（用户指定放最后）

### Task 8: 文档回写

**Files:**
- Modify: `HANDOFF.md`（§4 未闭环现象标记已闭环，记录实际根因）
- Create: `e2e/README.md`（运行方式、环境矩阵、数据驱动约定）
- Modify: 本计划（§7 执行日志收尾段：总耗时、遗留问题）

- [x] **Step 1: 写 `e2e/README.md`**（内容：双环境命令、`.e2e-legacy` 建法、spec 零 import 约定、菜单数据驱动原则）
- [x] **Step 2: 更新 `HANDOFF.md`** §4 结论与 §2 验收表（补「浏览器级 e2e」列）
- [x] **Step 3: Commit** `docs(e2e): e2e README 与 HANDOFF 闭环回写`

### Task 9: 审查

- [x] **Step 1:** 调 `superpowers:requesting-code-review`（或 code-review 技能）对分支全量 diff 审查：spec 零 import 约束、选择器脆弱点、等待策略
- [x] **Step 2:** 按审查意见修复并回归双环境
- [x] **Step 3:** Commit `refactor(e2e): 审查意见修复`

**Phase 5 收尾：** §7 追加总结段（本阶段关键过程与总耗时），勾选 Task 8-9。

---

## 7. 执行日志

> 每 Phase 结束追加一段：状态、关键过程、耗时。

- [x] Phase 1 小结：骨架一次成型；`pnpm add` 把全部 devDeps 迁入 catalog 触发 yaml/sort-keys，已排序修复（反常规：pnpm 11 的 catalog 迁移副作用）。S1 首跑即暴露 HANDOFF §8 坑——5174 被 pid 90710（交接期残留进程）占用，`reuseExistingServer:false` 正确拦截；kill 后**真实浏览器一次通过**，证实「菜单空白」是残留进程/缓存幻觉（H1），非代码缺陷，HANDOFF §4 闭环。耗时约 25 分钟（含 chromium 下载与构建）。
- [x] Phase 2 小结：M1/M2 一次成型，但 **M2 首跑红，捕获演进偏差 1（真缺陷）**——host.tsx 链路（ram dev）路由无 `id`，菜单选中态依赖 `useMatches().match.id`，`addRouteIdByPath` 只在 auth-guard 里做，宿主链不经守卫 → 菜单永远无高亮。修复取单点根因：`getRoutes()` 出口统一 `addRouteIdByPath`（幂等，auth-guard 双重应用无害），并加单元回归断言 `getRoutes()[0]?.id === "/demo"`。S1/M1 因 demo 模块新增 detail 子路由使 `/demo` 变 submenu，`.ant-menu` 同时匹配根菜单与弹层 → 全部收敛为 `.ant-menu-root`（反常规：antd Menu 嵌套时类选择器有歧义）。S2-S3 揭示实现与常规 antd 布局不同（与业界不符类）：侧栏是自绘 `<aside>`（无 `.ant-layout-sider-collapsed` 类），折叠态 = aside 宽度收缩 + 菜单 `ant-menu-inline-collapsed`；PC 折叠触发器在侧栏底部 SiderTrigger，header 内折叠按钮仅移动端渲染——spec 按实现校准。demo 模块补 `/demo/detail`（keepAlive + 受控 Input）供 T2。playground 6/6 绿（5.0s）。耗时约 45 分钟。
- [x] Phase 3 小结：**本阶段价值最高——e2e 连续揪出三个真缺陷（偏差 2/3/4）**。T1-T5 首轮暴露两个夹具层事实：index 子路由在父路由有其他子路由时不再渲染为独立菜单项（菜单叶子=详情/关于，断言全部改为数据驱动探测）；home 页签 closable:false 无关闭钮（T3-T5 据此设计）。T2 keepalive 用例否决了计划中的 page.goto 方案（整页刷新摧毁缓存必假红），改为全程客户端导航+页签标题定位。T5 首红牵出**偏差 2**：shell host 以空 resources 自行 init i18next，框架 translation 命名空间全丢（tabbar 菜单裸奔成 key）——修复：runtime 出口补 setupI18n、CLI stub 同步、host 改调 runtime 初始化。H3/H4 首红牵出**偏差 3（最严重）**：几何探测发现 header 操作按钮 y=59 落在页签栏带区（y56-109）被页签 remove 按钮拦截，截图证实整链视觉崩坏——根因是 runtime 预构建产物零样式（lib 入口不含 styles/index.css 且缺 tailwind 插件），修复为产物自携带 CSS（34KB 内联注入 + 契约测试冻结）。H4 再牵出**偏差 4**：html.dark/动态标题/NProgress 副作用只活在 LayoutRoot（带 AuthGuard），宿主免登录链路全部失效——抽取 LayoutEffects 双链共用。playground 16/16 绿，布局视觉复核对齐设计。反常规记录：①e2e 语义断言（visible/count）对 CSS 缺失完全免疫，S1 冒烟「绿」不代表布局对——几何/视觉断言（boundingBox、elementFromPoint、截图）是必要补充；②ThemeButton 用 onPointerDown 而非 onClick。耗时约 100 分钟。
- [x] Phase 4 小结：legacy 接入顺带修了 4 个 spec 侧环境缺陷，全程未改产品代码。①worktree webServer 三连坑：playwright 的 webServer cwd 是 config 目录（命令需 ../）、worktree 的 .git 是文件致 simple-git-hooks prepare 必失败、pnpm 11 run 前自动 install（verify-deps-before-run）拖死启动——命令统一 `--config.verify-deps-before-run=false`；②**全量假红根因**：登录页是懒加载 chunk，`load` 事件时表单未挂载，`count()>0` 判断恒 0 从未点击（曾以「点了但导航失败」误诊，绕了远路）——改 waitFor 等表单；③**手风琴模式**（legacy preferences.accordion 默认开，同层互斥、祖先保留）宣判 expandAllSubmenus 全量展开在该环境不可能成立：M1/M2 改深度优先逐组访问、tabbar 只挂载首组；「当前路由所在组自动展开、点击反而收起」吃掉三轮绿红反复，isOpen 守卫三处统一；④legacy closeOthers 在 openTabs.size===2 时禁用 → T3/T4/T5 改按导航数点击。legacy 假菜单含无组件路由（/route-nest/menu2）空白属数据特性，M1 以 allowBlankRoutes 区分。期间 38.8 分钟超长跑与 15 连假红均定位到上述根因后消除。**双环境全绿：playground 16/16（9.8s）、legacy 15 过 + 1 跳（T2 仅 playground 夹具）（1.3min）**。耗时约 130 分钟。
- [x] Phase 5 总结：**文档回写（Task 8）**：`e2e/README.md`（双环境命令、worktree 建法、六条 spec 约定、环境噪音）；HANDOFF 头部状态/§1/§2（补浏览器级 e2e 列）/§4（闭环结论 + 偏差 1-4 清单 + 假设存档）/§7（修正 playground 包名、补 e2e 命令）/§9 重写。**审查（Task 9）**：subagent 首次因默认模型 400 失败，换显式 sonnet 成功；结论「With fixes」——无 Critical，硬约束①-⑥逐条验证通过，夹具（手风琴感知 DFS）获评出色。按意见修复：**Important 2 项**——①设计矩阵 M2 的「直接 URL 访问」路径缺覆盖 → 新增 **M3 深链接用例**，连带揪出两个真产品缺陷并根因修复：host 相对路径 `fetch("./modules.json")` 在深链接下 404（改 BASE_URL 绝对路径）+ ram dev 无 SPA history fallback（按 Accept: text/html 补齐，对齐 vite dev）；②host 链语言偏好不同源（刷新回退 zh-CN）→ 语言同步抽入 LayoutEffects 双链共用。**Minor 9 项**：setupI18n 幂等守卫、host 去 await、auth-guard 两处冗余 addRouteIdByPath 移除（id 单一所有权在 getRoutes 出口）、inline-css 缺 CSS 改响亮失败、assetsInlineLimit:0 风险注释、header H1 空 filter 无效断言移除、tabbar T5 下拉按钮限定页签区、tsconfig include 补 e2e、`test.deps.inline` → `test.server.deps.inline` 修复**先前已存在**的 `pnpm typecheck` 报错（现全绿且 typecheck 覆盖 e2e）。附带发现并修正：vitest 误收 e2e spec（include 收敛 tests/）；**`tests/cli-build.test.ts`「多 chunk」契约已过期**——P7.x 已刻意决策单文件模块（build.ts codeSplitting:false 注释详尽），契约反转更新（审查者「分支门禁漏跑全量单测」的提醒成立，该回归在分支上存在了 6 个提交）。双绿回归：playground 17/17（12s）、legacy 16 过 + 1 跳（2.2min）、vitest 45 文件 233 用例全绿、typecheck 全绿。M3 两环境调试沉淀断言语义：叶子路由 item 恰 1、组落地页（index 子路由）submenu 恰 1、兜底页不属不变量。已知边界（记录于 e2e/README.md）：host 链 antd 暗色算法/地域包未与偏好同源，属后续工作。Phase 5 耗时约 100 分钟；**全计划累计约 445 分钟**。
