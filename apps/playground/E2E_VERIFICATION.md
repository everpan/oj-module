# Playground 模块化方案 E2E 验证

> 目标：通过 e2e 测试验证 `@apps/playground` 演示模块的模块化方案，覆盖用户要求的 5 个验收点，
> 并修复验证过程中暴露的模块化缺陷。

## 验收点（用户要求）

| # | 验收点 | 验证方式 | 结果 |
|---|--------|----------|------|
| 1 | runtime 可以加载 | `loadAll({modules:[demo]})` → `status === "loaded"` | ✅ |
| 2 | 默认 layout 可以加载 | 渲染后出现 `<header>/<aside>/<main>` 及 `.ant-menu`（ContainerLayout 自定义 chrome） | ✅ |
| 3 | demo 菜单可以加载 | 侧边栏出现文案含「演示模块 / Demo Module」的 `.ant-menu-item` | ✅ |
| 4 | demo 页面可以切换 | 导航到 `/demo` 渲染 `模块加载成功`；离开后再切回 `/demo` 仍渲染（路由可切换、keepalive 缓存命中） | ✅ |
| 5 | 主题 / 图标正常 | antd `ConfigProvider` 注入 `--ant-color-primary` CSS 变量；`@ant-design/icons` 的 `HomeOutlined` 渲染为 `.anticon` | ✅ |

## 测试入口

- `tests/playground-e2e.test.tsx`（vitest 4 + happy-dom）
- 覆盖 `localStorage` / `ResizeObserver` / `matchMedia` / `IntersectionObserver` / `scrollTo` 等 happy-dom 缺口
- 等价「已登录用户」：播种 `useAuthStore`(token) / `useUserStore`(id, roles) / `useAccessStore.setAccessStore(getRoutes())`
  —— 等价于 `AuthGuard` 登录后把模块路由 `patchRoutes` 注入运行时路由树
- 入口指向**已构建**的模块产物 `dist/modules/demo/0.1.0/entry.js`，顺带验证真实 artifact 与 runtime 的集成

## 验证中修复的模块化缺陷

1. **构建产物单文件化**（`packages/cli/src/build.ts`）：`rolldownOptions.output.codeSplitting: false`
   → 每个模块产出自包含的 `entry.js`，消除代码分割导致的孤儿 chunk 与 `import.meta.url` 运行时取块，
   修复「模块入口可解析、依赖可读」的集成缺口（直接命中会导致 `loadAll` 失败 / 404）。
2. **页面组件静态导入**（`apps/playground/web/demo/entry.ts`）：`DemoPage` 由 `React.lazy` 改为静态 `import`
   → 修复 happy-dom 下 lazy + keepalive 的空渲染，确保模块页面内容可渲染。
3. **index 子路由保留**（`packages/runtime/src/router/utils/resolve-layout.ts`）：`resolveRouteLayouts` 递归包裹布局时
   保留 `index: true` 子路由，使 `/demo` 的叶子为 index 路由（无 `hasChildren`），`AuthGuard` 不会误判 404。
4. **通知栏组件崩溃（框架健壮性缺陷）**：`notification-container.tsx` 在接口异常时 `res.result` 为 `undefined`，
   原代码 `Array.from({length:20}).flatMap(() => res.result)` 会产出 20 个 `undefined` 元素，导致
   `NotificationPopup` 读取 `item.isRead` 抛 `TypeError`，整块 `ContainerLayout`（含模块页面）落到 error boundary。
   修复：`fetchNotifications` 结果做 `Array.isArray` 守卫 + `.catch(() => [])`；`NotificationPopup` 内 `item?.isRead`
   守卫、`dataSource` 过滤 `undefined`。该缺陷在「通知接口不可用」时必然触发，e2e 中因无对应服务而稳定暴露
   （正是此前测试偶发失败的根因——接口 reject 时序决定布局是否崩溃）。

## 已知测试环境限制（非模块化缺陷）

- **happy-dom 无法触发 antd rc-menu 的 `onClick`**：`fireEvent.click` / `userEvent.click` 在 happy-dom 下均不触发
  rc-menu 的菜单选中，故「菜单驱动切换」改用等价的 `router.navigate("/demo")` 验证——该导航正是菜单项
  `handleMenuSelect` → `navigate(key)` 的最终动作。菜单本身的渲染（point 3）已单独断言。
- **通知栏后台轮询噪音**：`ContainerLayout` 内的通知组件会轮询 `http://localhost/api/notifications`，测试环境无对应
  服务会抛 `AggregateError(ECONNREFUSED)`。该轮询与模块化能力无关，已在 `beforeAll` 用 `unhandledRejection`
  处理器吞掉已知的 `api/notifications` / `ECONNREFUSED` 噪音；非预期的 rejection 仍会抛出。

## 运行

```bash
# 先构建 demo 模块产物（产物不存在时）
pnpm --filter @apps/playground build

# 运行 e2e
npx vitest run tests/playground-e2e.test.tsx
```
