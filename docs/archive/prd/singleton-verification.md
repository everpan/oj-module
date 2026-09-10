# Shell 单例契约与浏览器验证

> 关联：设计文档 §4.3（共享依赖表）/ §4.4（预构建宿主）/ D5（单例不变量）。
> 验收项：P1 垂直切片中 `__REACT_INSTANCE_COUNT__ === 1` 等价的结构前置条件。

## 1. 不变量（D5）

宿主（shell）与每个外部模块**必须命中同一份**共享实例：

- `react` / `react-dom` —— 否则 Context（QueryClient、ConfigProvider、i18n）、
  hooks 规则全部失效；
- `@react-antd-module/runtime` —— 否则 `loadAll` 注册的 store/apiPrefix、i18n
  合并、路由收集彼此看不见；
- `antd` / `@ant-design/cssinjs` —— 否则 cssinjs `hashPriority` 样式哈希不统一、
  `StyleProvider` 作用域错位。

## 2. 实现手段（已在 P1.2 / P1.4 落地）

- **宿主侧**：`packages/shell/scripts/build.mts` 手写 16 项 importmap
  （9 硬共享 + 7 软共享），宿主本身 `external` 全部共享裸说明符 → 共享依赖经
  importmap 解析到 `assets/<name>.js` 单入口 ESM。
- **模块侧**：`ram build` 的 `external` 列表（`isSharedDep`）与同一张表对齐，
  模块产物只保留 `import ... from "react"` 等裸说明符，由宿主 importmap 解析。
- **结果**：宿主与模块对 `react` / `runtime` / `antd` / `react-i18next` 等
  解析到**同一 URL**，浏览器按 URL 去重 → 同一模块实例（天然单例）。

## 3. 自动化验证（已落地，`tests/vertical-slice.test.ts`）

不依赖浏览器，直接断言结构单例前置条件：

- importmap 覆盖全部 `HARD_SHARED_DEPS`；
- 宿主与模块对 `react` / `runtime` / `antd` / `react-i18next` 命中**同一 URL**；
- `modules.json` 字段完整且 `integrity`(sha384) 与文件一致；
- 无 `blob:` / `data:` 导入；`react` 未被内联进模块 chunk。

```bash
npx vitest run tests/vertical-slice.test.ts
```

## 4. 手动浏览器验证

### 4.1 澄清：`__REACT_INSTANCE_COUNT__` 不是 React 暴露的全局

> 注意：**React 19 的 development 构建并不会写入 `window.__REACT_INSTANCE_COUNT__`**
> （已在 `node_modules/react/cjs/react.development.js` 中确认无此符号）。P1 验收里
> 提到的「`__REACT_INSTANCE_COUNT__ === 1`」是**单例意图**的别名，真正的可观测信号
> 见下方方法 A / C。若团队坚持要一个字面量全局，可在 shell 启动处自行维护（见 4.4）。

两个 React 副本的真实症状：hook 报 `Invalid hook call` / `Cannot read properties
of null (reading 'useState')`、Context 跨模块取不到。下面方法能在出问题前给出确定性结论。

### 4.2 方法 A（推荐，零额外构建）—— 实例同一性探测

`ram dev` 启动后，打开页面，在 DevTools Console 粘贴：

```js
// 同一说明符两次 import；因 importmap 指向同一 URL，浏览器按 URL 去重 → 同一实例
const a = await import("react");
const b = await import("react");
console.log("react identity:", a === b, a.default === b.default); // 期望 true true

// 同理验证 runtime 与 antd（它们也必须命中同一份）
const r1 = await import("@react-antd-module/runtime");
const r2 = await import("@react-antd-module/runtime");
console.log("runtime identity:", r1 === r2); // 期望 true
```

三项全 `true` 即证明宿主与模块共享同一份实例（importmap 去重生效，D5 满足）。

### 4.3 方法 B —— React DevTools「多副本检测」

安装 React DevTools，其「Detect multiple copies of React」应**无提示**；若单例
破裂会明确高亮「X copies of React found」。

### 4.4 方法 C（可选）—— 框架自维护的 `__REACT_INSTANCE_COUNT__`

若验收流程要求字面量 `window.__REACT_INSTANCE_COUNT__ === 1`，在
`packages/shell/src/host.tsx` 顶部加一段 dev-only 计数（仅壳加载一次，故恒为 1）：

```ts
// host.tsx —— 仅 development 下累计「宿主 React 加载次数」用于单例自检
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, number>;
  w.__REACT_INSTANCE_COUNT__ = (w.__REACT_INSTANCE_COUNT__ ?? 0) + 1;
}
```

> 该计数反映「宿主入口执行次数」，并非 React 内部副本数；它配合方法 A 一起使用，
> 不能单独作为单例证明。

## 5. 单例破裂的早期信号

- 模块内 `useTranslation()` 取不到宿主的 i18n 资源；
- 模块主题 / `ConfigProvider` token 不生效；
- QueryClient 的 cache 在宿主与模块间互不共享；
- 控制台出现 React「multiple instances」警告。

上述任何一条出现，**先跑 `tests/vertical-slice.test.ts`**——结构层面的
importmap / 共享表漏配会被该测试先于浏览器暴露。
