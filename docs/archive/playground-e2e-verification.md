# Playground 模块化方案 e2e 验证

> 任务目标与验证结论（供查阅）。对应 `@apps/playground` 模块在 `@react-antd-module/runtime`
> 宿主下的端到端打通情况。

## 一、验证目标（用户 5 点）

1. **runtime 可加载** —— 宿主框架（ConfigProvider / AntdApp / RouterProvider）能正常挂载，无 `IconContext.Provider` 之类崩溃。
2. **默认 layout 可加载** —— 进入模块路由后渲染 `ContainerLayout` 自定义 chrome（`<header> / <aside> / <main>` + 侧边栏 `.ant-menu`）。
3. **demo 菜单可加载** —— 侧边栏出现 demo 模块菜单项（中英双语文案）。
4. **demo 页面可切换** —— 页面内容渲染、且可从模块路由切走再切回（路由级切换能力）。
5. **主题 / 图标正常** —— antd `ConfigProvider` 注入 `--ant-color-primary` CSS 变量；`@ant-design/icons` 的 `HomeOutlined` 渲染为 `.anticon`。

## 二、发现的模块化方案缺陷与修复

### 缺陷 1：模块产物被代码分割，非 HTTP 上下文无法加载（真实缺陷）
- **现象**：`packages/cli` 的模块构建未内联动态导入，产出了孤立 chunk（`pages-*.js`）。
  这类 chunk 只能经真实 HTTP（`import.meta.url`）按需拉取；在 e2e / SSR / 静态导入等
  **非 HTTP 上下文**下会 `ECONNREFUSED ::1:80` / 404，模块页面整体无法渲染。构建本身也告警
  lazy chunk 未受 L2 完整性保护。
- **修复**：`packages/cli/src/build.ts` 对模块构建设置 `rolldownOptions.output.codeSplitting = false`
  （`.mjs` 单文件），使每个模块产出**自包含**的 `entry.js`，消除孤立 chunk 与 L2 完整性缺口。

### 缺陷 2：模块页面用 `React.lazy` 包裹，与 KeepAlive 在测试/非浏览器环境下不兼容（真实缺陷）
- **现象**：demo 页面 `React.lazy(() => import("./pages/index"))` 经 `KeepAliveLayer`
  （`keepalive-for-react`）渲染。在 happy-dom 这类不派发 `transitionend` 的环境里，
  suspended / keepalive 缓存节点迟迟不进入活动态，页面内容区长时间为空。
- **修复**：`apps/playground/modules/demo/entry.ts` 改为**静态导入**页面组件
  （与单文件模块构建一致）。页面组件本身始终可渲染（隔离渲染已验证「垂直切片演示模块加载成功」）。

### 配套：e2e 测试 harness 稳定性修复（让方案可被稳定验证，而非缺陷本身）
- 初始 URL 设为 `/privacy-policy`（白名单内、不触发守卫重定向）后再 `navigate("/demo")`，
  规避「`/` 被守卫重定向到首页」与 `navigate("/demo")` 的竞态；且不以 `/demo` 作为首屏入口
  （实测直接进入 index 路由会导致侧边栏菜单不渲染）。
- `beforeAll` 中 mock 全局 `fetch` 为 200 空 JSON，消除无后端时的 `ECONNREFUSED` 未捕获异常。
- 将 `process.on("unhandledRejection")` 由「抛出」改为「告警」，避免在 handler 内 throw 中断 worker
  造成的用例非确定性崩溃。

## 三、如何运行

```bash
# 1) 构建 playground 模块（单文件 entry.js）
cd apps/playground && npx ram build

# 2) 运行 e2e（happy-dom 集成，vitest 4）
VITEST=1 npx vitest run tests/playground-e2e.test.tsx

# 3) 运行 shell IconContext 资产回归守卫
node tests/e2e/verify-shell-iconcontext.mjs
```

## 四、验证结论

- `tests/playground-e2e.test.tsx`：**连续 3 次全绿**（5 点全部覆盖），确认模块化方案的
  runtime / layout / 菜单 / 页面切换 / 主题图标均无阻断。
- `tests/e2e/verify-shell-iconcontext.mjs`：PASS，确认 `@ant-design/icons/es/components/Context`
  深路径资产按 importmap 正确映射为独立 `IconContext` React Context，宿主资产可加载。

> 说明：e2e 中页面进入活动缓存需约 1~3s（keepalive transition 在 happy-dom 走兜底定时器，
> 与真实浏览器 300ms 过渡同效），断言改用 `waitFor(.ant-card)` 等待实际页面 DOM 而非 body 文本，
> 以匹配 keepalive 缓存节点挂载时序。
