# shell 构建 import-is-undefined 告警治理

## 现象

`pnpm --filter @oj-module/cli build:shell` 输出 32 条
`▲ [WARNING] Import "default" will always be undefined because there is no matching
export in <pkg> [import-is-undefined]`，淹没真实问题。

## 根因

共享资产垫片（`starShim` / `explicitForwardingShim` 等）的 default 兜底模式：

```js
import * as __ns from "react-router";   // 真实 ESM、无 default 导出
export default (__ns.default ?? __ns);  // 有真实 default 用 default，否则回退命名空间
```

`??` 特性探测是**有意设计**（CJS/ESM interop 策略，代码注释早已说明），但 esbuild
在打包时静态解析 external 目标文件、确知其为「无 default 导出的 ESM」，对一切
`.default` / `["default"]` 静态访问都报 import-is-undefined（实测两种访问形式都触发）。
垫片对共享表 121 个资产逐个构建 → 每个无 default 导出的包刷一条告警。

最小复现（/tmp 探针确认）：`mod.mjs` 只有具名导出，垫片 `export default (__ns.default ?? __ns)`
→ esbuild 0.28.2 必报；改 `Reflect.get` 或方括号访问均无效。

## 反常识记录

- **特性探测写法触发静态告警**：`ns.default ?? ns` 是 JS 生态通行的 interop 兜底，
  esbuild 却按「必然 undefined」告警——它只看到了 `??` 左半边的静态事实，看不到
  右半边兜底。告警语义对「无 default 的 ESM」是误报，对「真的写错的 default 导入」
  才是实报，二者无法靠文本区分。

## 对策

四处共享资产 esbuild 调用（bundleShim / buildAntdSubpathAsset / buildSubpathAsset /
buildIconsSubpathAsset）统一加：

```ts
logOverride: { "import-is-undefined": "silent" }
```

只静默**这一个告警种类**，构建其余告警（未覆盖裸说明符、导出缺失等）不受影响。
不用 `logLevel: "silent"` 全局压制的理由：资产构建有真实的门禁类告警
（如 A23 require 垫片缺失），不能一刀切。

## BDD 场景

### 场景 1：构建零 import-is-undefined 告警（核心回归）

```
When 运行 pnpm --filter @oj-module/cli build:shell
Then 输出不含 "▲ [WARNING]"（import-is-undefined 静默）
And  输出仍含真实的构建告警（如有）
```

### 场景 2：资产产物行为不变

```
When 对比修复前后 shell-dist/assets/*.js
Then 字节级一致（logOverride 只影响日志，不影响产物）
```

### 场景 3：可执行回归（opt-in，防再犯）

```
Given 环境变量 OJM_RUN_SHELL_BUILD=1
When pnpm vitest run tests/shell/build-no-warnings.test.ts
Then 真跑 build:shell 并断言零 WARNING
```

注：场景 3 默认跳过——真跑会刷新 shell-dist（CSP nonce 轮换弄脏工作区），
不能在常规 `pnpm test` 里默认启用（会撞发布脚本的干净树门禁）。

## 任务

| # | 任务 | 状态 |
|---|---|---|
| 1 | opt-in e2e 测试先红（真跑 build:shell 断言零 WARNING） | ✅（先假绿：execFileSync 只回 stdout，esbuild 告警走 stderr——改 spawnSync 后真红 31 条） |
| 2 | 四处 esbuild 调用加 logOverride（转绿） | ✅ |
| 3 | 产物字节级一致比对 | ✅（240 个资产仅 runtime.js 的 lastBuildTime 时间戳不同，其余字节一致） |
| 4 | 全量回归 | ✅（715 通过 + 1 opt-in 跳过） |

## 总结

- **关键过程**：复现 31 条告警 → 定位到共享资产垫片 `?? __ns.default` 兜底模式
  （有意 interop 设计）被 esbuild 静态误判 → /tmp 最小探针确证 `.default` 与
  `["default"]` 访问都触发 → 文档先行 + opt-in e2e 测试先红 → 四处 esbuild 调用
  统一 `logOverride: { "import-is-undefined": "silent" }`（只静默该种类，require 垫片
  等真实门禁告警保留）→ 转绿、产物字节级一致、全量回归通过。
- **耗时**：约 25 分钟（含 3 次完整 shell 构建、1 次全量测试）。
- **遗留**：runtime vite.config.ts 有一条单行的 JSON import attributes 提示
  （`(!) Your Vite config uses features...`），与本次告警无关，未处理。
