# `@oj-module` 双包整合与品牌改名 — 设计方案

> 创建时间: 2026-09-11 09:47
> 状态: 已评审（脑暴对话逐节确认），待实施
> 关联文档: `docs/archive/prd/202608291025-framework-npm-package-design.md`（现行 4 包架构的设计依据，本文修订其 D4 / §4.1）、`docs/prd/framework-development-guide.md`（对外手册，需同步改名）
> 前置已确认: `@oj-module` npm scope 已注册可用

---

## 1. 背景与动机

现行框架分为 4 个 npm 包（`@oj-module/{contract,runtime,cli,shell}`）。四包版本已各自漂移（cli 0.1.5 / contract 0.1.3 / runtime 0.1.4 / shell 0.1.4），而设计文档 D12 要求「模块工程里硬共享依赖版本与宿主**严格相等**」——版本漂移与严格相等门禁直接冲突，漂移后的旧版本会被门禁当成"真相"强加给下游（同 A25 教训）。

本次整合触发三个动机 + 一个品牌动作：

| # | 动机 | 现状痛点 |
|---|------|----------|
| M1 | 精简发布与版本管理 | 4 个包 4 个版本号、4 次发版、跨包版本对齐靠人为约束 |
| M2 | 消除 cli↔shell 隐性环 | **未声明**的互依 + 「先 build shell 才能用 cli」的顺序约束（详见 §2.2） |
| M3 | 降低外部工程安装负担 | 外部工程 devDeps 需装 4 个框架包 |
| M4 | 品牌改名 | `@oj-module` → `@oj-module`；命令 `ram` → `ojm` |

---

## 2. 现状诊断

### 2.1 四个包是"四种产物"，混用了两条切分轴

| 包 | 物种 | 运行环境 | 关键特征 |
|---|---|---|---|
| `contract` | 叶子库 | Node + 浏览器双安全 | 仅依赖 zod；`./errors` 子路径刻意 zod-free，是浏览器里的硬共享单例（`packages/cli/src/shared-deps.ts:43`）；发 TS 源（`files: ["src"]`） |
| `runtime` | 浏览器库 | 浏览器 | 单入口 bundle（`codeSplitting:false`）；`z` 从 **zod 直接** re-export（`packages/runtime/src/index.ts:107`），与 contract 同源钉版但非同一路径 |
| `cli` | Node 工具链 | Node | 依赖 contract；`ram` bin；自带 vite/esbuild/redocly/tsx |
| `shell` | **构建产物**（预构建站点） | 浏览器产物 / 构建在 Node | ~60 个共享依赖单独打包 + importmap；`exports: {"./dist": "./dist"}` |

**诊断结论**：切分轴既含"产物类型"（库/站点/工具/DSL），又含"运行环境"（浏览器/Node）。**前者不是不变量**（所以它一直漂）；**后者才是真不变量**（浏览器必须单例、工具链只在 Node 跑）。

### 2.2 一处真正的互依：cli ↔ shell

```
contract ←─ cli
contract ←─ runtime
runtime  ←─ shell          （拷 dist + type import，packages/shell/scripts/build.mts）
cli      ←─ shell          （shell 构建 import cli/shared-deps、cli/esm-exports）
shell    ←─ cli            ← 未声明！
```

- **shell → cli**（已声明）：`packages/shell/scripts/build.mts` 从 `@oj-module/cli/shared-deps` 取共享表、从 `cli/esm-exports` 取导出完整性门禁。
- **cli → shell**（**未声明**）：`packages/cli/src/dev.ts:41`、`versions.ts:22`、`init.ts:209` 靠路径查找 `node_modules/@oj-module/shell/dist`，monorepo 下回退 `../../packages/shell/dist`。

环未在 package.json 表达，靠 workspace 提升 + 路径回退兜住，并强制「先 build shell 才能用 cli」。

---

## 3. 决策记录

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| D1 | 目标包数量与切法 | **双包，按「运行环境」切** | 环境是唯一真不变量；同时满足 M1/M2/M3（方案对比见 §3.1） |
| D2 | 浏览器面包名 | `@oj-module/runtime`（保留 `runtime` 语义名） | 模块 source 的公共契约 `import { defineModule } from "@oj-module/runtime"` 不变，仅换 scope |
| D3 | 工具链面包名 | `@oj-module/cli` | 沿用语义；`bin` 提供 `ojm` |
| D4 | `contract` 归属 | **并入 `runtime` 子路径**：`@oj-module/runtime/contract` 与 `.../contract/errors`；`@oj-module/contract` 名字取消 | 满足 M1（包数与版本数减到 2）；contract 属浏览器面（生成物在浏览器 `instanceof`），不应落在 Node 工具包 |
| D5 | `contract` 产物形态 | **编译为 dist**（`dist/contract/*.js` + `.d.ts`） | 保住现行 US-7「runtime 包内无 `.ts` 源文件」不变式；`npm pack --dry-run` 可断言 |
| D6 | `shell` 归属 | 源码与构建脚本迁入 `packages/cli/{shell,scripts}`；产物落 `packages/cli/shell-dist/`，不再独立发包 | 环消失（常量与消费者同包、宿主产物成为 cli 自带资源）；外部工程无需单独装 shell |
| D7 | 依赖方向 | 只剩一条边 `cli → runtime`；cli 对 runtime 写**精确版本** | D12「严格相等」在包层天然成立；两包同版本号 lockstep 发布 |
| D8 | 共享依赖单一真相 | 维持 `SHARED_DEPS` 单一常量源 + pnpm catalog；`versions.json` 仍由 shell 构建产出 | 该机制已被 A25/`host-version-drift` 验证有效，本次不动 |
| D9 | 改名深度 | **全改**（scope + bin + 用户可见文本 + 内部标识 + 文件名），并对**存量工程**保留兼容读取 | 用户拍板；兼容项见 §6.3 |
| D10 | `ram` 命令兼容 | 双 bin：`ojm` 为主，`ram` 为弃用别名（打印更名警告），下个 major 删除 | 存量工程 `scripts` 写死 `ram dev`，直接移除会当场挂掉 |

### 3.1 方案对比（为何选双包）

| 方案 | 形 | 满足 M1/M2/M3 | 代价 |
|---|---|---|---|
| A 单包 | 1 个包 + 全子路径 | ✅✅✅ | 模块 source 须改 `@oj-module/runtime/contract`；manifest 混 Node 工具依赖与浏览器 peerDeps；`ram` bin 挂 runtime 名下语义怪 |
| **B 双包按环境（选定）** | runtime(浏览器) + cli(Node) | ✅✅✅ | 仍是 2 包 2 版本（用精确版本 + lockstep 收敛） |
| C 保 4 包只解环 | 下沉 shared-deps 到新包 | ❌ 不满足 M1/M3 | 改动最小，但版本仍 4 个 |

---

## 4. 目标架构

### 4.1 目录与包边界

```
packages/
├── runtime/        @oj-module/runtime      ← 浏览器面
│   ├── src/              框架源码（原 packages/runtime/src 原样）
│   ├── contract/         ← 原 packages/contract/src 并入（构建产物进 dist/contract）
│   └── dist/             runtime.js + index.d.ts + contract/*.js + contract/*.d.ts
└── cli/            @oj-module/cli          ← Node 工具链面
    ├── src/              ram dev/build/init/api/vendor/info/merge/preview
    │   ├── shared-deps.ts    （原 cli 保留）
    │   └── esm-exports.ts    （原 cli 保留）
    ├── shell/            ← 原 packages/shell/{src,scripts,index.html} 迁入
    ├── shell-dist/       ← 原 packages/shell/dist（预构建宿主产物）
    └── bin/{ojm.mjs, ram.mjs}
```

### 4.2 exports 地图

| 包 | 子路径 | 内容 | 消费者 |
|---|---|---|---|
| runtime | `.` | `dist/runtime.js` + d.ts | 模块 source、shell 产物 |
| runtime | `./contract` | `dist/contract/index.js` + d.ts（含 zod re-export） | cli codegen、模块契约书写 |
| runtime | `./contract/errors` | `dist/contract/errors.js` + d.ts（zod-free） | 浏览器生成物（硬共享单例） |
| cli | `.` `./build` `./shared-deps` `./esm-exports` `./config` `./manifest` `./info` | 原样 | 程序化 build、shell 构建 |
| cli | `./shell-dist` | `shell-dist/`（index.html + assets/ + versions.json + favicon） | 外部工程 dev/build |
| cli | `bin: ojm`（+ 弃用 `ram`） | 命令 | 外部工程 |

### 4.3 依赖方向（无环）

```
@oj-module/cli  ──(dependencies, 精确版本)──▶  @oj-module/runtime
```

cli 的 `dependencies`：`@oj-module/runtime`(精确) + 原 cli 的 Node 依赖（vite/esbuild/typescript/redocly/tsx/faker/yaml/zod）。
runtime 的 `dependencies`：zod；`peerDependencies`：原浏览器共享依赖清单（不变）。

---

## 5. 构建与产物流水

### 5.1 runtime 包

```
vite build                → dist/runtime.js（单入口，zod 内联）
tsc -p tsconfig.dts.json  → dist/*.d.ts
rewrite-dts-specifiers    → 修正 d.ts 说明符
inline-css                → CSS 内联回 runtime.js
tsc -p tsconfig.contract.json（新增） → dist/contract/*.js + *.d.ts
```

- `exports` 由 `["."]` 扩为 `["." , "./contract", "./contract/errors"]`
- `files` 含 `dist`
- `peerDependencies` 不变；`dependencies` 含 zod（`. ` 内联 zod；`./contract` 再导出 zod）

### 5.2 cli 包

- `pnpm --filter @oj-module/cli build:shell` = 原 `packages/shell/scripts/build.mts`，产出 `packages/cli/shell-dist/`
- 流水顺序不变：runtime build → `buildSharedEntries()`（约 60 资产）→ 拷 runtime → `buildHost()`（注入 importmap + CSP nonce）→ `assertSharedExportsComplete()` → `writeVersionsJson()` → 拷 favicon
- `shared-deps.ts` / `esm-exports.ts` 与构建脚本同包，**import 改为包内引用**，环消失
- runtime 产物定位：`resolve(cliDir, "../runtime/dist/runtime.js")` → `import.meta.resolve("@oj-module/runtime")`（走包解析，不写死相对层级）
- `resolveShellDist()` 三处调用点（`dev.ts:41`、`versions.ts:22`、`init.ts:209`）统一为「cli 包根 + `/shell-dist`」，删除 `node_modules` 与 `../../packages/shell/dist` 两级回退
- `files` 增加 `shell-dist`；`dependencies` 从 `contract` 换成 `runtime`（精确版本）

### 5.3 外部工程形态

devDependencies 由 4 个框架包降为 2 个：

```jsonc
{
  "devDependencies": {
    "@oj-module/cli": "…",       // 命令 + 预构建宿主
    "@oj-module/runtime": "…",   // 类型 + 模块 source 唯一框架入口
    "react": "…", "antd": "…"   // 共享依赖，catalog 对齐
  }
}
```

---

## 6. 改名迁移（`@oj-module` → `@oj-module`，`ram` → `ojm`）

### 6.1 scope 层（机械、面广）

- 包名 4→2
- 源码 import：`packages/runtime/src/api/system/role/{contract.ts,api/client.ts}`、`packages/cli/src/contract/evaluate.ts`、`packages/cli/src/build.ts` 虚拟模块名、`esm-exports.ts` / `shared-deps.ts`
- 模板：`templates/package.json`、`templates/tsconfig.json` paths、`templates/modules/src/**` import、`templates/env.d.ts`
- 工程侧：`apps/playground`、`apps/playground-oj`
- 根配置：`tsconfig.json` paths、`vite.config.ts` alias、根 `package.json`
- 测试断言：`tests/cli/contract-emit-client.test.ts:146`、`tests/cli/shared-deps.test.ts`、`tests/shell/*`、`tests/integration/*`、`tests/playground/*`
- 文档：`README.md`、`README.zh-CN.md`、`CLAUDE.md`、`docs/prd/*`

### 6.2 命令层

- `packages/cli/package.json` 的 `bin` 键：`ojm` + 弃用 `ram`
- `bin/ram.mjs` → `bin/ojm.mjs`；`bin/ram.mjs` 保留为转发 shim（打印更名警告后 exec `ojm`）
- 工程 `scripts`：`"dev": "ram dev 5174"` → `"ojm dev 5174"`
- 全部 README / 模板 / 错误信息中的命令名

### 6.3 内部前缀层（全改 + 兼容读）

| 落点 | 处置 | 兼容策略 |
|---|---|---|
| `api/.ram-api-exempt.json` | 改名 `.ojm-api-exempt.json` | **双名读取**（新名优先、旧名回退）；`init` 只产新名 |
| `// ram-api:stub …` 指纹头（`emit-stub.ts:49`） | 改名 `// ojm-api:stub` | 读指纹**双前缀接受**，写用新前缀（否则存量生成物会被判为"人工编辑"而永不覆盖，见 `emit-stub.ts:181`） |
| `Symbol.for("ram.api.def")`（`define-api.ts:72`） | 改名 `Symbol.for("ojm.api.def")` | IR 识别**双符号**；新写只发新符号 |
| `[ram-api]` 日志/报错前缀 | 改 `[ojm-api]` | 纯文本，无兼容 |
| `.ram-shim-*` / `.ram-tmp-*` / `data-ram-css` | 改前缀 | 纯瞬时文件 / DOM 属性，无兼容 |
| esbuild 插件名 `ram-external-shared` / `ram-contract-runtime-guard`、命名空间 `ram-stub` | 改前缀 | 纯内部标识 |
| 生成物文件头「生成物：ram api …」 | 改 `ojm api` | 下次 codegen 重写 |

---

## 7. 风险与守卫

| # | 风险 | 守卫 |
|---|------|------|
| R1 | 存量工程 `scripts` 写死 `ram dev`，升级后 bin 消失即挂 | 双 bin：`ojm` 主 + `ram` 弃用别名（警告后转发），下个 major 删 |
| R2 | stub 指纹头换名 → 存量生成物被判"人工编辑"、永不覆盖 | 读指纹双前缀接受，写用新前缀 |
| R3 | `Symbol.for` 换名 → 存量产物定义不被新 codegen 识别 | IR 双符号识别 |
| R4 | `.ram-api-exempt.json` 改名 → 存量工程豁免失效、`--check` 误报 | 双名读取 |
| R5 | cli 内嵌 `shell-dist`，可能发布未构建 / 跨版本宿主 | `prepack` 断言：`shell-dist/` 存在，且其 runtime 版本 == `dependencies["@oj-module/runtime"]` 精确版本，不符即失败 |
| R6 | 单 cli 包同时暴露 Node 工具 API 与浏览器产物，模块误 import 拉进 vite/esbuild | **已硬化**：cli `exports` 的 Node-only 子路径（`.`/`build`/`shared-deps`/`esm-exports`/`config`/`manifest`/`info`）挂 `browser` 条件 → `./src/browser-guard.ts`（浏览器打包即显式抛错），`./shell-dist/*` 作为浏览器资产不加；另加门禁测试：`apps/*/modules/src`、根 `modules/src`、`templates/modules/src` 零 `import @oj-module/cli/*` |
| R7 | 改名面广，测试/模板/docs 三处不同步 | 全仓 `grep -rn "@react-antd-module"` 已有**零残留测试**（`docs/archive` 与两份迁移记录文档豁免）；`ram` 字样因兼容 shim 必须保留，无法做零残留判据——改为「兼容表 + 守卫用例」覆盖 |
| R8 | US-7「runtime 包无 `.ts`」被 contract 误破 | D5：contract 编成 dist；`npm pack --dry-run` 断言无 `.ts`、无 `src/` |
| R9 | 两包版本再次漂移 | cli 对 runtime 写 `workspace:*`（发布转精确版本），`release-manifest.test.ts` 真跑 `pnpm pack` 断言两包 manifest 无 `workspace:`/`catalog:` 字面量与精确版本；**lockstep 已落实：两包同版 `0.1.5`** |
| R10 | 走 `npm publish` 会把 `workspace:` / `catalog:` 字面量发出去 | `release-manifest.test.ts` 覆盖两包的发布态 manifest；文档（手册附录 A）明确必须走 `pnpm publish` |

---

## 8. 测试与验收

### 8.1 必须改造的既有测试

| 测试 | 改动 |
|---|---|
| `tests/runtime/runtime-declarations.test.ts:43` | `exports` 由 `["."]` 改为三子路径；`files` 含 contract dist |
| `tests/integration/monorepo-layout.test.ts:28,51` | 包路径、tsconfig paths 更新 |
| `tests/integration/vertical-slice.test.ts:49`、`uni-dev-smoke.test.ts:139` | `--filter` / `node_modules` 路径 |
| `tests/cli/shared-deps.test.ts` | 说明符改名 + 断言 shell-dist 归属 |
| `tests/shell/*`（6 个） | 路径 `packages/shell` → `packages/cli/shell` |
| `tests/playground/*` | devDeps 从 4 包断言改为 2 包 |
| `tests/cli/contract-emit-client.test.ts:146` | 生成物 import 名 |

### 8.2 新增守卫测试

- cli 的 `dependencies["@oj-module/runtime"]` 为**精确版本**（无 `^`/`~`）
- `shell-dist/versions.json` 存在且与 catalog 对齐
- runtime `npm pack --dry-run`：无 `.ts`、无 `src/`
- 兼容读取三连：旧 `.ram-api-exempt.json`、旧指纹头、旧 `Symbol.for`
- `bin` 同时提供 `ojm` 与弃用 `ram`
- 模块源码零 import `@oj-module/cli/*`

### 8.3 BDD 验收

```gherkin
Feature: 双包整合后外部工程形态
  Scenario: 新工程脚手架
    When ojm init my-app
    Then 工程 devDeps 只含 @oj-module/cli 与 @oj-module/runtime 两个框架包
    And scripts 使用 ojm dev / ojm build

  Scenario: 命令与宿主来源收敛
    Given 工程已安装 @oj-module/cli
    When 执行 ojm dev
    Then 宿主来自 cli 包内 shell-dist，不查询 node_modules/@oj-module/shell
    And 日志中无「找不到 @oj-module/shell 的预构建产物」

Feature: 兼容存量工程
  Scenario: 命令行层平滑升级
    Given 存量工程 scripts 仍写 ram dev
    When 升级到新版 cli
    Then ram dev 可运行且打印「已更名为 ojm」警告

  Scenario: 契约层平滑升级
    Given 工程内是 .ram-api-exempt.json 与 ram-api:stub 生成物
    When 执行 ojm api --check
    Then 不产生误报，且新生成 stub 头为 ojm-api:

Feature: 品牌零残留
  Scenario: 迁移完成判据
    When 全仓 grep "@oj-module"
    Then 零命中（docs/archive 历史文档除外）
```

---

## 9. 实施阶段

| Phase | 主题 | 主要任务 | 完成判据 |
|-------|------|----------|----------|
| **P0** | 前置 | 确认 `@oj-module` scope（已完成）；建分支 | scope 可发布 |
| **P1** | 包合并（结构） | contract 并入 runtime 子路径 + dist 构建；shell 迁入 cli；`resolveShellDist` 三处收敛；exports/files/bin 调整 | ✅ **完成 2026-09-11**（见 §12）；`typecheck` + 550 用例全绿 + `build:shell` 门禁通过 + playground `ram build` 端到端通过 |
| **P2** | 改名（scope） | 机械替换包名、import、模板、工程、根配置、测试、文档 | ✅ **完成 2026-09-11**（见 §12）；全仓 `@react-antd-module` 零命中；typecheck + lint + 550 用例 + 产物重建全部通过 |
| **P3** | 改名（bin + 内部前缀 + 兼容） | 双 bin；`.ojm-api-exempt.json`；指纹头双前缀；`Symbol.for` 双符号；日志前缀 | ✅ **完成 2026-09-11**（见 §12）；存量兼容三连（旧 exempt / 旧指纹头 / 旧 Symbol）有单测；`ram` 别名实测打印警告并转发 |
| **P4** | 守卫与验收 | 新增 §8.2 守卫测试；改造 §8.1 既有测试；`prepack` 断言 | ✅ **完成 2026-09-11**（见 §12）；新增 20 条守卫/兼容用例；`pnpm lint` 0 error |
| **P5** | 发布演练 | `npm pack --dry-run` 校验两包内容；playground 与 playground-oj 端到端 | ✅ **完成 2026-09-11**（见 §12）；两包 pack 演练通过（顺手修掉 sourcemap 误发布），两 playground `ojm build` + `ojm dev` 端到端通过 |

每个 Phase 独立建分支、独立评审与回滚。

---

## 10. 待定事项

| # | 事项 | 处置建议 |
|---|------|----------|
| O1 | 两包是否强制同版本号（lockstep）还是允许 cli 快于 runtime | **已决（2026-09-11）**：采用 lockstep，两包同版 `0.1.5` 一起发布（`@oj-module` scope 首次发布）；`cli` 对 `runtime` 精确依赖 `0.1.5` |
| O2 | `ram` 别名保留多久 | 建议保留到下一个 major（0.x → 1.0） |
| O3 | `docs/archive/` 内历史文档是否回写改名 | 不回写（历史留痕）；仅当前文档与 `docs/prd/framework-development-guide.md` 更新 |
| O4 | 是否顺手把 `runtime` 包名改为更中性的 `framework` | 不建议：公共契约改名收益低、成本高 |

---

## 11. 修订记录（对既有设计文档）

| 原决策 | 原文 | 本次修订 |
|---|---|---|
| D4 框架仓库组织 | 「需同时发布 runtime / shell / cli 三种形态」 | 改为**双包**：runtime(含 contract) + cli(含 shell 构建与产物)；shell 不再独立发版 |
| §4.1 包结构 | 列 4 个 packages 目录（含 create-module） | `create-module` 已在 P7 降级（原文档 D-P7-1），本次不再列；contract/shell 并入 |
| A11 子包 package.json 截断父包 imports | — | 合并后 `packages/cli/shell/*` 的 `#` 说明符需由 `packages/cli/package.json` 的 `imports` 兜住，迁移时按 A11 校验 |
| US-7 包内无 .ts | runtime 包只含 dist | 维持不变；contract 经 D5 编成 dist 后仍满足 |

---

## 12 实施记录

### P1 包合并（结构）— 完成 2026-09-11

**范围**：contract 并入 runtime 子路径（编成 dist）；shell 源码/构建迁入 cli（产物 `shell-dist/`）；`resolveShellDist` 三处收敛为包内定位；exports/files/bin 与根配置同步。**说明符仍为旧 scope**（`@oj-module`），改名留给 P2。

**落地结果**

| 项 | 结果 |
|---|---|
| 包数量 | 4 → 2（`packages/{runtime,cli}`） |
| runtime exports | `["." , "./contract", "./contract/errors"]`；新增 `tsconfig.contract.json` → `dist/contract/{index,errors,define-api,scoped-request-like}.{js,d.ts}` |
| runtime 构建顺序 | `vite build → tsc contract → tsc dts → rewrite-dts → inline-css`（contract d.ts 必须先于主 d.ts，否则主 d.ts 解析自引用子路径失败） |
| cli | 新增 `build:shell`；`files += shell-dist`、`exports += ./shell-dist`；devDeps 并入原 shell 的共享依赖；`dependencies` 由 contract 换成 runtime（`workspace:*`，发布转精确版本） |
| 宿主产物 | `packages/cli/shell-dist/`（119 资产 + index.html + versions.json + favicon；`.map` 不入库） |
| resolveShellDist | 合并为 `versions.ts` 单实现（删除 `dev.ts` 的重复实现），定位 `<cliRoot>/shell-dist`，无 node_modules / monorepo 回退 |
| 依赖方向 | 只剩 `cli → runtime` 一条边 |
| 版本矩阵 | `versions.json` 62 项；contract 子路径键记为 runtime 版本（0.1.4）；`vendor/host-versions.json` 由 prepack 重生成 |
| 生成器 | `sync-host-versions.mjs` 改为「校 shell-dist 存在 + 断言宿主 runtime 版本 == packages/runtime 版本（R5）+ 落 vendor 快照」 |
| lint | 新增 `**/shell-dist/**` 忽略（新目录名不在 antfu 默认 `dist` 忽略内，否则 `eslint --fix` 会改写预构建产物） |

**验证（全部通过）**

- `pnpm typecheck`
- `pnpm exec vitest run`：87 文件 / **550 用例全绿**
- `pnpm --filter @oj-module/cli build:shell`：共享资产门禁通过（119 资产：裸说明符 0 未覆盖、具名导出 0 缺失、动态 require 0 未覆盖）
- `pnpm --filter playground build`（`ram build`）：宿主合并 + 版本门禁 + 10 个模块产物 + modules.json 全通
- `ram dev`：HTTP 200，importmap 三键（`runtime`、`runtime/contract`、`runtime/contract/errors`）均由 cli 内置 `shell-dist` 提供，日志确认为内置宿主

**关键过程与耗时**

- 耗时约 **25 分钟**（09:49–10:14，含 3 轮构建/测试返工）。分三个阶段：contract 归并 → shell 迁入 → 守卫与验证。
- 返工点：
  1. `buildHost()` 的 vite `outDir` 仍写死 `"dist"`（相对 shellDir），产物落错目录 → 改为绝对 `distDir`。
  2. 用 `import.meta.resolve("@oj-module/runtime")` 取 runtime 产物，在 **tsx** 下命中根 tsconfig `paths`，解析成 `src/index.ts` —— 拷进宿主的 `runtime.js` 只有 4KB TS 源码。改回显式相对路径。
  3. 契约子路径引发 30 个用例失败：根 `node_modules` 失去 `@oj-module/*`（原为 contract）**且** tsconfig `paths` 让 esbuild 内联契约源码、把 `zod` 裸露成裸说明符。修复 = 去掉 contract 的 tsconfig `paths` + 根 devDeps 恢复 `@oj-module/runtime` + 修一处测试夹具 `resolveDir`（仍指向已删除的 `packages/contract`）。

**偏离设计的记录**

| # | 设计原文 | 实际 |
|---|---|---|
| 1 | §5.2「runtime 产物定位改 `import.meta.resolve`」 | **未采纳**，改显式相对路径（理由见返工点 2）。已回写 §5.2 的教训到 §13 |
| 2 | §4.2 未提根 devDeps | **根 package.json 必须保留 `@oj-module/runtime`**：测试夹具在 `node_modules/.cache` 下建临时工程，裸说明符需从仓库根解析 |
| 3 | — | 顺带修复既有类型错误 `packages/cli/src/vendor.ts` 的 `resolveDeps` 返回类型（声明 `Required<VendorDeps>` 却漏 `probe`，由 commit `bd09be3` 引入，与本次合并无关） |
| 4 | §6.1 文档改名归 P2 | README / 手册 / CLAUDE.md 的**说明符文本**与 `ram→ojm` 一律留给 P2；P1 只更新了 `CLAUDE.md` 的结构段 |

### P2 scope 改名 — 完成 2026-09-11

**范围**：`@react-antd-module` → `@oj-module`（包名、源码 import、模板、工程 devDeps、根配置、测试断言与夹具、文档）。命令 `ram` 与内部 `ram-` 前缀按计划留给 P3。

**落地结果**

| 项 | 结果 |
|---|---|
| 包名 | `@oj-module/runtime`、`@oj-module/cli` |
| 机械替换命中的文件 | 167 个（排除 `docs/archive`、`**/dist/**`、`build/`、`pnpm-lock.yaml`、`shell-dist/`） |
| 生成产物重建 | `shell-dist`（importmap 三键 → `@oj-module/runtime`、`.../contract`、`.../contract/errors`；`versions.json` 62 项）；根 `build/`（importmap 118 键）；`apps/playground*` 模块产物 |
| 模板与脚手架 | `templates/modules/src/**` 的 `defineModule` import、`init.ts` 生成的 devDeps（`@oj-module/cli` + `@oj-module/runtime`） |
| 文档 | 手册 `framework-development-guide.md` 的导读/包表/依赖图/构建顺序/契约章/宿主章/发布清单已改写为「两包」；`framework-verification-playbook.md`、`oj-fullstack-tutorial.md` 说明符同步；`apps/playground-oj` 的 phase 文档同步；`docs/archive` 保留历史 |
| 版本号 | **未 bump**（改名即新包名，0.1.4 可复用）；是否 lockstep 同版本发版见 O1 |

**验证（全部通过）**

- 全仓 `@react-antd-module` 零命中（含 `pnpm-lock.yaml` 与 `build/`）
- `pnpm typecheck`、`pnpm lint`（0 error / 63 既有 warning）
- `pnpm exec vitest run`：87 文件 / **550 用例全绿**
- `pnpm --filter @oj-module/cli build:shell`：共享资产门禁通过（119 资产）
- `pnpm build`（主应用 + 模块 + importmap 注入）：118 键注入成功
- `pnpm --filter playground build` 与 `ram dev`：HTTP 200，importmap 三键均为新 scope

**关键过程与耗时**

- 耗时约 **12 分钟**（10:15–10:27），机械替换 + 产物重建 + 一轮门禁返工。
- 返工点：**根 `build/`（主应用产物）未随改名重建**，其裸说明符仍是旧 scope，与新建的 shell importmap 不匹配 → `inject-importmap` 门禁报红，连带 `tests/cli/prod-importmap.test.ts`（在 import 期执行 main）失败。重建 `pnpm build` 后恢复。见 §13 A32。

**仍欠的文档债**（不阻塞 P2）

- 手册 `framework-development-guide.md` 的深层章节（3.4–3.8、2.x、附录 B）仍以「宿主/shell」为叙事主体，未逐句改写为「cli 内置 shell-dist」；已在文首加「结构变更」提示指向本文档。完整重写列为后续文档任务。

---

### P3 命令与内部前缀改名 — 完成 2026-09-11

**范围**：命令 `ram` → `ojm`（双 bin + 弃用别名）；内部 `ram-` 前缀全改（文件名、指纹头、Symbol、日志前缀、临时文件/DOM 标记、esbuild 插件与命名空间、自动生成的子路径资产名前缀），并**兼容读旧名**。

**落地结果**

| 项 | 结果 |
|---|---|
| bin | `bin/ojm.mjs`（主入口，原 `ram.mjs` 内容）；`bin/ram.mjs` 改为 6 行 shim：stderr 打印更名警告后 `import("./ojm.mjs")` 原地转发；`package.json#bin` 同时提供 `ojm` + `ram` |
| 机械替换面 | 127 个文件（`\bram\b` → `ojm`，`__ram_reload` → `__ojm_reload`，`RAM_DEBUG` → `OJM_DEBUG`）；`docs/archive`、设计文档、生成物（`build/`、`shell-dist/`、`dist/`、redoc 文档站）排除 |
| 豁免清单 | 模板 `templates/api/.ram-api-exempt.json` → `.ojm-api-exempt.json`；`apps/playground-oj/api/` 同步 `git mv`；`loadExemption` 新增 `resolveExemptPath`：新名优先、旧名回退（R4） |
| stub 指纹 | 写 `// ojm-api:stub`；读正则 `(?:ojm\|ram)-api:stub`（R2）——旧头不会被判「人工编辑」，且重跑会把旧头刷成新头 |
| 端点品牌 | `API_DEF = Symbol.for("ojm.api.def")`；新增只读 `API_DEF_LEGACY = Symbol.for("ram.api.def")` 并从 `contract` 子路径导出；`buildIr` 双符号识别（R3）；`defineApi` 新写只发新符号 |
| 日志/报错前缀 | `[ram]` → `[ojm]`、`[ram-api]` → `[ojm-api]`（纯文本，无兼容） |
| 瞬时/内部标识 | `.ram-shim-*`/`.ram-tmp-*`/`data-ram-css`/`data-ram-runtime-css` → `ojm`；esbuild 插件 `ram-external-shared`、`ram-contract-runtime-guard`、`ram-*-stub`、命名空间 `ram-stub`、`ram:collect-chunks` → `ojm-*`；`.gitignore` 的 `.ram-tmp-*` → `.ojm-tmp-*` |
| 自动子路径资产名 | `subpathAssetName()` 前缀 `ram-` → `ojm-`（`ojm-antd-es-modal.js`、`ojm--ant-design-icons-*` 等）；`shell-dist` 全量重建 |
| 生成物重跑 | runtime 内置 role client（`scripts/gen-internal-role-client.ts`）、`apps/{playground,playground-oj}`（`ojm api`）重跑均 0 写入，证明机械替换与生成器输出一致 |
| 额外改名（§6.2/6.3 未列，按「全改」精神补） | `__ram_reload(.js)` → `__ojm_reload(.js)`（dev SSE 端点）；`RAM_DEBUG` → `OJM_DEBUG`（旧名回退读）；`playbook` 的 `RAM_REPO` → `OJM_REPO` |

**验证（全部通过）**

- `pnpm typecheck`；`pnpm lint` **0 error / 63 warning**（与 P2 基线一致）
- `pnpm exec vitest run`：**87 文件 / 550 用例全绿**（与 P2 同基线：改名未增删用例）
- `pnpm --filter @oj-module/cli build:shell`：119 资产门禁通过，子路径资产名为 `ojm-*`
- 根 `pnpm build`：importmap 118 键注入成功
- `pnpm --filter playground build`、`pnpm --filter playground-oj build`（含 oj 后端 7 模块）：全通
- `ojm dev 5188`：HTTP 200，importmap 三键指向 `runtime.js`/`contract.js`/`contract-errors.js`，日志「宿主来自 @oj-module/cli 内置 shell-dist」
- `node bin/ram.mjs`（无参）：stderr 打印更名警告、stdout 为 `ojm` 用法、exit 0；`node bin/ojm.mjs` 无警告

**关键过程与耗时**

- 耗时约 **40 分钟**（10:28–11:0x），大头在产物链重建与一次 lint 返工。
- 返工点：`usage.ts` 用模板字符串承载用法文本，新增的「`ram` 是弃用别名」一句里含反引号 → 截断模板字面量（TS1005）。改为普通文本。
- lint 返工：P2 把根 `.gitignore` 的 `bin/` 锚定为 `/bin/`（修 A33）后，`apps/*/bin/**` 不再被根 `.gitignore` 命中；而 eslint 只读根 `.gitignore`（不读 `apps/*/` 内的嵌套 `.gitignore`），于是把联网落盘的 `bin/devkit/global.d.ts` 当源码 lint → 一次冒出 343 error。**对策**：eslint `ignores` 补 `apps/*/bin/**`。见 §13 A35。

**与 P2 遗留文档债的关系**

- P2 记录的「手册深层章节仍以宿主/shell 叙事」仍未重写；本次仅顺带修掉 `packages/cli/README.md`、`packages/cli/shell/README.md`、`packages/runtime/README.md` 里与双包/命名直接冲突的段落（`@oj-module/shell` 消费者、`ram` 命令、`.bin` 提示）。

---

### P4 守卫与验收 — 完成 2026-09-11

**范围**：把 §8.2 的守卫落成测试；确认 §8.1 既有测试已在 P1/P2 改造完毕（复核通过，无需再改）。

**落地结果**

| 新增用例 | 断言 |
|---|---|
| `tests/cli/package-guards.test.ts`（8） | cli `dependencies["@oj-module/runtime"]` 非 `^`/`~`（R9）；`shell-dist/versions.json` 的 runtime/contract/contract-errors 版本 == `packages/runtime` 版本（D12）；`bin` 双入口且文件存在；`ram` shim 含更名警告与转发；`versions.json` 覆盖全部硬共享；runtime `files == ["dist"]` 且 dist 无裸 `.ts`（R8/US-7）；cli `files` 含 `bin`/`shell-dist`/`src`/`templates`/`vendor` 且含 sourcemap 取反模式；模块源码（两 playground + 模板）零 `import @oj-module/cli`（R6） |
| `tests/cli/rename-compat.test.ts`（12） | R4 旧名豁免读取 + 新名优先 + 双缺失空豁免；R2 旧指纹头被判 update（契约变/未变两种）且**不**放大权限（内容被改仍 skip）；纯前缀升级 `prefixUpgrade=true` 且 `checkApi` 不误报过期、重跑刷为新头；R3 `defineApi` 只发新符号、`buildIr` 认旧符号、无符号被忽略；R1 usage 用 `ojm` 并标注 `ram` 弃用 |

**兼容语义补强（E2E 暴露）**

- 纯指纹头前缀差异（旧 `ram-api:stub` + 正文与新生成内容逐字节一致）不再计入 `--check` 过期：`planStubWrites` 打 `prefixUpgrade` 标记，`check.ts` 忽略该 update；`ojm api` 仍把它刷成新头。
- 否则存量工程升级后首次 `ojm api --check` 会对每个 stub 报 `stub 待随契约更新`（BDD 要求「不产生误报」）。
- 实测：旧名豁免 + 旧指纹头工程 `ojm api --check` → `0 error / 0 warn`、exit 0；随后 `ojm api` 首行变为 `// ojm-api:stub …`。

**既有测试改造复核（§8.1）**

- 表格中 7 项在 P1/P2 已完成：`runtime-declarations`（exports 三子路径 + contract dist）、`monorepo-layout`（包路径）、`vertical-slice`/`uni-dev-smoke`（路径与 `@oj-module/cli` 内置宿主）、`shared-deps`、`tests/shell/*`、`tests/playground/*`、`contract-emit-client`。
- 本次仅随改名更新断言文本与夹具：`contract-emit-stub`（指纹前缀）、`contract-exempt`（豁免文件名默认值）、`init`（`.ojm-api-exempt.json`）、`cli-build`（`.bin/ojm`）、`uni-dev-smoke`（`OJM` 常量 + `bin/ojm.mjs`）等。
- `prepack` R5 断言（宿主 runtime 版本 == `packages/runtime` 版本 + shell-dist 必须存在）在 P1 已落在 `scripts/sync-host-versions.mjs`，本次复核通过。

**验证（全部通过）**

- `pnpm lint`：0 error / 63 warning；`pnpm typecheck` 干净；`pnpm exec vitest run` 89 文件 / 570 用例全绿。
- 兼容语义补强后重跑：`rename-compat` 12 条（含前缀升级 E2E）全绿。


---

### P5 发布演练 — 完成 2026-09-11

**范围**：`npm pack --dry-run` 校验两包内容；两 playground 端到端；外部工程可用性以 BDD 场景回归。

**pack 演练结果**

| 包 | 条目 | 体积 | 关键断言 |
|---|---|---|---|
| `@oj-module/runtime` | 184 | ~305 KB | 无 `src/`；无非 `.d.ts` 的 `.ts`；`exports` 三子路径声明文件齐全 |
| `@oj-module/cli` | 199 | ~3.85 MB | `bin/{ojm,ram}.mjs`、`shell-dist/index.html`+`versions.json`、119 个资产、`templates/api/.ojm-api-exempt.json` 均在；**0 个 `.map`** |

**演练发现并修复：sourcemap 会被误发布**

- 现象：首次 pack 出 117 个 `shell-dist/assets/*.map`，体积 10.8 MB（3 倍）。
- 根因：设计 P4.4 要求「`.map` 不发版」，但排除依据只是仓库**根** `.gitignore`；npm 的 `gitignore-fallback` 只读**包根**的忽略文件，`packages/cli` 没有 `.npmignore` → 不生效。又因 npm 规则「列入 `files` 的文件无法被 `.npmignore` 排除」，补 `.npmignore` 亦无效。
- 修复：`package.json#files` 用取反模式 `"!shell-dist/**/*.map"`。**但顺序有语义**：npm 按出现顺序应用模式、**后者优先**，取反项必须排在 `shell-dist` **之后**才生效（实测排前面 117 个 map 照发，排后面 0 个）。该顺序与 `jsonc/sort-array-values` 的字典序要求冲突 → 对 `packages/cli/package.json` 单独关掉该规则，并在守卫用例中断言取反项位于 `shell-dist` 之后。见 §13 A34。
- 结果：cli pack 由 316 条 / 10.8 MB → 199 条 / 3.85 MB。

**端到端（全部通过）**

- `pnpm --filter playground build`（`ojm build`）与 `pnpm --filter playground-oj build`（oj 后端 7 模块 + 前端 11 模块）
- `ojm dev 5188`：HTTP 200 + 118 键 importmap + 三键新资产；退出无孤儿进程
- BDD 场景回归：`ram dev`（存量 scripts 写法）实测打印警告并转发；旧 `.ram-api-exempt.json` + 旧 `ram-api:stub` 由 P4 单测覆盖「不误报 + 新头升级」

**遗留（不阻塞发布）**

- `apps/playground/docs/api/index.html`、`apps/playground-oj/api/docs/index.html` 是 `ojm api --docs` 生成的离线 redoc 单文件；已核查**不含旧品牌文本**（首轮 grep 的 `ram` 命中全是 redoc 供应商代码里的 `parameter` / `frame` 等子串），无需重新生成。
- ~~手册深层章节仍以「宿主」为叙事主体~~ → **已改写**：`framework-development-guide.md` 逐句核对（见 §12「手册改写」）。
- 两包版本：**已对齐 `0.1.5`**（lockstep，见 §12「v0.1.5 发布」）。

---

### 独立评审与采纳 — 2026-09-11

P3–P5 完成后，请**架构评审**（独立上下文，只读）与**开发评审**（独立上下文，只读）各出一份报告，结论：**架构成立、可合并**；原 `cli ↔ shell` 环在代码层确实消除（`shell/scripts/build.mts` 相对 import cli 内部；`resolveShellDist` 单实现无回退）。下表为采纳情况。

| # | 来源 | 发现 | 处置 |
|---|---|---|---|
| 1 | 架构 P1 | `npm publish` 会把 `workspace:*` 原样发布（`pnpm` 才改写），而守卫测试**接受** `workspace:*`，等于没守护 | ✅ 采纳：新增 `tests/cli/release-manifest.test.ts`，真跑 `pnpm pack` 解 tarball manifest，断言无 `workspace:`、runtime 为精确版本、无 `.map`、bin 双入口；守卫测试注释指向它 |
| 2 | 架构 P1 | R6「exports 硬分区」实为测试约束，且守卫漏了根 `modules/src`（vite alias 也把它当模块树） | ✅ 采纳并硬化：守卫补根 `modules/src`；`exports` 加 `browser` 条件 → `browser-guard.ts`（见「旧 scope 下架与边界收尾」4b） |
| 3 | 架构 P1 | lockstep 声称与实际不符（`cli@0.1.5` / `runtime@0.1.4`）且无守卫 | ✅ 采纳：两包对齐并同发 `0.1.5`（见下「v0.1.5 发布」）；O1 由待决转为已决 |
| 4 | 架构 P2 | `"./shell-dist": "./shell-dist"` 是死出口（目录不可 import，无消费者） | ✅ 采纳：删除该 export，保留 `./shell-dist/*` |
| 5 | 架构 P2 | `API_DEF_LEGACY` 扩进 runtime 公共出口属过度设计 | ✅ 采纳：从 runtime 出口移除，改由 `cli/src/contract/ir.ts` 自行声明旧符号（公共出口不变） |
| 6 | 架构 P2 | runtime 已发布 `imports` 仍声明 `#modules/*`、`#manifest.json`（逃出包边界） | ✅ 已处理：核清 `#modules/*` 是死配置、`#manifest.json` 只服务仓库 App 链（不在 lib/dts 产物内）→ 二者从包内删除，App 链改由仓库 vite alias 解析；加门禁断言（见「旧 scope 下架与边界收尾」4a） |
| 7 | 架构 P2 | 根 `pnpm build` 读 `packages/cli/shell-dist`（app→cli 产物的隐式边） | ⏸ 记录：这是「根 App 复用宿主产物」的既有设计，非本次引入 |
| 8 | 架构 P2 | R7「CI 零残留」无测试；CI 触发分支不含 `refactor/*` | ✅ 部分采纳：新增 `@react-antd-module` 零残留测试（`docs/archive` 与迁移记录文档豁免）；CI 分支策略属仓库配置，记录待办 |
| 9 | 开发 P1 | `check.ts` 的 stub **报错分支**（`update && !prefixUpgrade`）零覆盖——改坏 `prefixUpgrade` 会静默放过过期 stub | ✅ 采纳：`contract-check.test.ts` 增「契约变更 → stub 过期报 error」用例锁定该分支 |
| 10 | 开发 P2 | `check.ts` 忽略 `action === "create"`，删掉 stub 仍 `--check` 通过 | ✅ 采纳：stub 缺失改判 `artifact-stale` error，并补用例 |
| 11 | 开发 P2 | CRLF 检出（Windows `autocrlf`）会使指纹哈希通过、字节比较失败 → 误报「待更新」 | ✅ 采纳：`emit-stub.ts` 逐字节比较前统一 LF（`toLf`），并补 CRLF 用例 |
| 12 | 开发 P2 | 守卫按数组下标断言 `files` 顺序，耦合 npm 实现细节；`resolveExemptPath` 损坏 JSON 分支无测试 | ⏸ 保留断言（npm「后者优先」是已实测的发布契约，去掉就没人防 10.8MB 回归）；损坏 JSON 已在 `contract-exempt.test.ts` 覆盖新名场景 |
| 13 | 自行发现（E2E） | `check.ts` 的 `parseRoutesJs` 把 oj 的短方法名 `del` 大写成 `DEL`，与契约 `DELETE` 不等 → 任何 DELETE 端点都误报 `routes-js-drift`（playground-oj 实测） | ✅ 采纳：按同文件 `VERB_OF` 口径归一（`del` → `DELETE`），并补 DELETE 用例 |

**评审给出的「可合并」结论与本次处置一致**；未采纳项均已在表内写明理由或转待决。

**手册改写（§12）**

`framework-development-guide.md` 不再有「独立 shell/contract 包」「`ram` 命令」口径：文首声明升级为「P1–P3 已全量落实」；术语表补 `ojm`/宿主/`SHARED_DEPS`；§2.10 修正 runtime 构建链；§4.2 目录树补 `bin/ram.mjs`、`shell/`、`shell-dist/`；§4.3 钉版来源与 dev 静态解析次序改成与代码一致；§4.5 边界改为「只有 cli→runtime 一条边 + prepack R5 断言」；新增 §4.9 改名与兼容读取表；附录 A 增「发布内容演练」与 sourcemap `files` 取反踩坑；附录 B 补 3 条排障。

---

### v0.1.5 发布（lockstep 对齐 + `@oj-module` 首发）— 完成 2026-09-11

**前置对齐**：`packages/runtime` 版本 `0.1.4` → **`0.1.5`**，与 `cli@0.1.5` 对齐（§10 O1 由待决转已决）。重建链：runtime dist（`getAppInfo` 内嵌版本）→ `cli build:shell`（`shell-dist/versions.json` 记 runtime `0.1.5`）→ `sync-host-versions.mjs`（vendor 快照 + R5 断言）→ 根 `pnpm build`。

**发布前守卫**

| 检查 | 结果 |
|---|---|
| `pnpm pack` 两包 manifest（`tests/cli/release-manifest.test.ts`） | 无 `workspace:`/`catalog:`/`link:`/`file:` 字面量；cli→runtime 为精确 `0.1.5`；runtime 25 条 peer 全为真实 semver 范围 |
| cli tarball | 0 个 `.map`；含 `shell-dist/index.html`、`templates/api/.ojm-api-exempt.json`；bin 双入口（`ojm` + `ram`） |
| runtime tarball | 无 `src/`、无非 `.d.ts` 的 `.ts`；`dist/contract/*` 齐全 |
| prepack R5 | 宿主 runtime 版本 == `packages/runtime` 版本 == `0.1.5` |

**发布**（`@oj-module` scope 首次）：`pnpm --filter "@oj-module/<pkg>" publish --access public --no-provenance --no-git-checks`，顺序 **runtime → cli**（先发 runtime，避免 cli 的精确依赖悬空）。

| 包 | 版本 | registry 复核 |
|---|---|---|
| `@oj-module/runtime` | 0.1.5 | `dist-tags.latest=0.1.5`；`exports=[".","./contract","./contract/errors"]`；peer 已改写；dep `zod:^4.5.4` |
| `@oj-module/cli` | 0.1.5 | `dist-tags.latest=0.1.5`；`dependencies["@oj-module/runtime"]="0.1.5"`；bin 双入口 |

**外部安装冒烟**：干净目录 `npm install @oj-module/cli@0.1.5 @oj-module/runtime@0.1.5` → 231 包安装成功；两包版本正确，`runtime/dist/contract/*`、`cli/bin/{ojm,ram}.mjs`、`cli/shell-dist/{index.html,versions.json,assets}` 均在。**BDD「外部工程 2 包安装可用」至此闭环。**

**两点实测坑**：见 §13 A45（安装源≠发布源）、A46（发布确认手段）。

---

### 旧 scope 下架与边界收尾 — 完成 2026-09-11

**（一）旧 scope 全量 deprecate**（npm：`npm deprecate <pkg>@* <msg> --registry https://registry.npmjs.org`）

| 旧包 | 版本 | 迁移指引 |
|---|---|---|
| `@react-antd-module/runtime` | 0.1.0–0.1.4 全部 | → `@oj-module/runtime@0.1.5` |
| `@react-antd-module/cli` | 0.1.0–0.1.5 全部 | → `@oj-module/cli@0.1.5`（命令 `ojm`，`ram` 为弃用别名） |
| `@react-antd-module/contract` | 0.1.3 全部 | → `@oj-module/runtime/contract` 子路径 |
| `@react-antd-module/shell` | 0.1.0–0.1.4 全部 | → 宿主并入 `@oj-module/cli` 包内 `shell-dist/` |

复核：四包所有版本的 `deprecated` 字段均已写入（读 packument 验证）。旧包不删除、不打新版本，安装时 npm 会打印迁移提示。

**（二）4a：runtime 发布包的 `imports` 不再逃出包边界**

`packages/runtime/package.json#imports` 原有 `#modules/*`、`#manifest.json` 指向 `../../`（包外路径）。核查：`#modules/*` 已无任何 src/dist 引用（历史白名单失效）；`#manifest.json` 只被 **App 链入口** `src/index.tsx` 使用，而该文件不在 lib 产物（`build.lib.entry = src/index.ts`）也不在 dts 构建（`include` 仅 `src/index.ts` + `src/types`）内 —— 它只服务仓库自己的 `index.html`。故：

- 删除 `imports` 中两条包外映射，只留 `#src/*`；
- 把 App 链的解析需求移到**仓库自己的 vite 配置**：`vite.config.ts` 增 `{ find: "#manifest.json", replacement: path.resolve("manifest.json") }`；
- 新增门禁断言：runtime `imports` 的键必须恰为 `["#src/*"]`。

验证：`pnpm typecheck`、runtime build、根 `pnpm build`（App 链仍能解析并打入 manifest）、`tests/module/module-bootstrap.test.ts`（该测试本就断言 `#manifest.json` 只允许出现在 `index.tsx`）全部通过。

**（三）4b：R6 从「测试兜底」升级为 exports 硬分区**

新增 `packages/cli/src/browser-guard.ts`（顶层 throw + `export {}`）。cli `exports` 的 7 个 Node-only 子路径改为：
`{ "browser": "./src/browser-guard.ts", "default": "./src/<原有>.ts" }`。浏览器打包器（默认含 `browser` 条件）一旦解析到即**显式报错**；Node/tsx 与 TS（不认 `browser` 条件）仍走 `default`，CLI 自身与测试不受影响。`./shell-dist/*` 是浏览器资产，保持不加守护。守卫用例：断言 7 个子路径的 `browser` 条件、`shell-dist/*` 未被拦，并实测 import 守护模块会抛错。

> 注：4a/4b 均为**下个版本**才触达消费者（`0.1.5` 已发布）；本条记录以便发版时随 CHANGELOG 说明。

---

### v0.1.6 发布准备（首发 4a/4b 与评审期缺陷修复）— 2026-09-11

**内容**：4a（runtime `imports` 收窄，不再逃出包边界）+ 4b（cli `exports` 加 `browser` 硬分区）+ 评审期修复的四项缺陷（stub 缺失/过期判定、CRLF 归一、`routes.js` 的 `del` 归一）。

**对齐**：两包 `0.1.5 → 0.1.6`（lockstep）；重建 runtime dist、`shell-dist`（`versions.json` 记 runtime `0.1.6`）、`vendor/host-versions.json`、根 `build/`；prepack R5 断言通过。

**发布前守卫**（`pnpm pack` 实测，非 dry-run 推断）

| 检查 | `@oj-module/runtime` | `@oj-module/cli` |
|---|---|---|
| 版本 | 0.1.6 | 0.1.6 |
| 包管理协议泄漏（`workspace:`/`catalog:`/`link:`/`file:`） | 无 | 无 |
| sourcemap | 0 | 0 |
| lockstep 依赖 | — | `@oj-module/runtime: 0.1.6`（精确） |
| exports | `[".","./contract","./contract/errors"]` | 7 个 Node-only 子路径挂 `browser: ./src/browser-guard.ts`；`./shell-dist/*` 不拦 |
| 关键文件 | `dist/contract/*` | `bin/{ojm,ram}.mjs`、`shell-dist/index.html`、`templates/api/.ojm-api-exempt.json`、`src/browser-guard.ts` |

**守门测试增强**：`release-manifest.test.ts` 的版本断言改为读源 `package.json`（发版不再需要改测试），并新增 **lockstep 断言**——cli 发布的 runtime 精确依赖必须等于 runtime 包版本。

**验证**：`typecheck` 干净；`lint` 0 error；根 `pnpm build` 通过；**88 文件 / 556 用例全绿**。

**发布命令**（runtime → cli）：`pnpm --filter "@oj-module/<pkg>" publish --access public --no-provenance --no-git-checks`。

---

## 13 反常识 / 陷阱记录（P1–P5 新增）

| # | 现象 | 说明与对策 |
|---|---|---|
| A27 | **tsconfig `paths` 会污染 esbuild 的 `packages:"external"`** | `evaluateContract` 用 esbuild + `packages:"external"`，本意让 `@oj-module/runtime/contract` 保持 external。但 esbuild 会读 `tsconfig.json` 的 `paths`，把包名改写成仓内相对文件后再内联 → 契约源码进 bundle，其 `import { z } from "zod"` 变成裸说明符，从夹具目录解析失败。**对策**：不要给「应由 Node/包解析」的说明符加 tsconfig `paths`。 |
| A28 | **tsx 下 `import.meta.resolve` 同样命中 tsconfig `paths`** | 在 `build.mts` 里 `import.meta.resolve("@oj-module/runtime")` 得到的是 `src/index.ts` 而非 `dist/runtime.js`（tsx 读根 tsconfig paths）。**对策**：构建脚本取跨包产物用显式相对路径，不用 `import.meta.resolve`。 |
| A29 | **vite alias 是前缀匹配** | `{ find: "@oj-module/runtime" }` 会连带改写 `@oj-module/runtime/contract`，得到 `.../src/index.ts/contract`。**对策**：更具体的子路径别名必须排在前面（`vite.config.ts` 已按此排序）。 |
| A30 | **测试夹具依赖仓库根 `node_modules` 的框架包** | 夹具建在 `<repo>/node_modules/.cache/**`，靠 Node 上溯到 `<repo>/node_modules` 解析裸说明符。根 package.json 一旦不再声明 `@oj-module/runtime`，大量 CLI 契约用例会以「Cannot find package」失败，且报错发生在夹具而非断言处，定位成本高。 |
| A31 | **构建产物目录改名会让 lint 忽略失效** | `.gitignore` 的 `dist/**` 与 eslint 默认忽略都按目录名匹配；新名 `shell-dist` 不在其中。而 `lint-staged` 对**所有** staged 文件跑 `eslint --fix` —— 会把预构建产物当源码重排。**对策**：新增产物目录名时，同步补 `.gitignore` 白名单与 eslint `ignores`。 |
| A32 | **改名后要重建的不止 `packages/*/dist`** | 「嵌了裸说明符」的产物还有根 `build/`（主应用 chunk + 注入的 importmap）与 `apps/*/modules/dist`（模块产物）。只重建 runtime/shell 的话，`inject-importmap` 的「裸说明符必须被 importmap 全覆盖」门禁会立刻报红——表现为 `tests/cli/prod-importmap.test.ts` 失败（该测试在 **import 期**执行 `main()`，一旦门禁抛错就 `process.exit(1)`，整文件 9 个用例一起消失）。**对策**：改名后的重建顺序 = runtime → `cli build:shell` → `apps/*` 模块产物 → 根 `pnpm build`。 |
| A33 | **「已跟踪但被 .gitignore 命中」的文件会卡死 lint-staged** | `.gitignore` 的 `bin/` 未锚定根目录，连带命中 `packages/cli/bin/`（`ram.mjs` 是历史上 `git add -f` 强加进来的）。lint-staged 跑完 task 后要 `git add` 这些路径，git 以「paths are ignored」拒绝 → 提交整体失败，且 lint-staged 默认只报 `failed due to a git error`，真实原因要 `npx lint-staged --debug` 才看得到（现象是进入暂存阶段才失败）。**对策**：忽略规则锚定根目录（`/bin/`）；不要 `git add -f` 造出「跟踪且忽略」的文件。 |
| A34 | **`files` 白名单里的文件无法被 `.npmignore` 排除，且取反模式有顺序语义** | 想不发布 `shell-dist/**/*.map`，加 `packages/cli/.npmignore` 完全无效（117 个 map、10.8 MB 照发）。npm 规则：`package.json#files` 列出的目录/文件优先级最高，`.npmignore`/`.gitignore` 只能过滤**未被 `files` 显式包含**的路径；而 `gitignore-fallback` 只读**包根**的忽略文件（仓库根 `.gitignore` 不管用）。**对策**：用 `files` 内的取反模式 `"!shell-dist/**/*.map"`，且**必须排在 `shell-dist` 之后**——npm 按顺序应用、后者优先，排前面不生效（实测 117 → 排后 0）。副作用：与 `jsonc/sort-array-values` 的字典序冲突，需对该文件关掉排序规则（`eslint.config.js` 里已单独配置）。 |
| A35 | **eslint 只读根 `.gitignore`，不读子目录 `.gitignore`** | P2 把根 `.gitignore` 的 `bin/` 锚成 `/bin/`（修 A33）后，`apps/playground-oj/bin/` 虽仍被该工程的 `.gitignore` 忽略（git 层面干净），但 eslint 的 gitignore 集成只看根文件 → 把联网落盘的 `bin/devkit/global.d.ts` 当源码 lint，一次 343 error。**对策**：eslint `ignores` 补 `apps/*/bin/**`。教训：改 `.gitignore` 的锚定/范围时，要同步核对 eslint 的忽略面（反之亦然）。 |
| A36 | **`pnpm install` 不会因 workspace 包 `bin` 字段变化而重建 app 的 `.bin`** | cli 的 `bin` 从 `{ram}` 改成 `{ojm, ram}` 后，`apps/playground/node_modules/.bin/` 里仍只有 `ram`；`pnpm install` 甚至 `--force` 都报 “Already up to date”，删掉 `.bin` 目录也不重建。**对策**：删掉该 app 的整个 `node_modules` 再 install（会重新解析 bin 并创建 shim）。否则依赖 `.bin/ojm` 的用例会以 ENOENT 失败。 |
| A37 | **模板字面量里写反引号会截断字符串** | `usage.ts` 的用法文本是模板字面量；新增一句「`ram` 是 `ojm` 的弃用别名」里的反引号把字符串提前闭合 → `TS1005`。**对策**：模板文本里不要用反引号，或转义 `\``。 |
| A38 | **机械改名要“改源码 + 重跑生成器”双向对齐，不能只改一边** | 生成的 `client.ts`/`stub` 也含品牌文本与指纹头。只机械替换磁盘文件的话，下次 codegen 会与已提交内容分叉（`--check` 报 `artifact-stale`）。**验证手法**：改完源码后重跑 `ojm api`（与 `gen-internal-role-client.ts`），若输出「写入 0 / 跳过（未变）」，即证明机械替换与生成器输出逐字节一致。 |
| A39 | **MAC 上 `grep -E '\bram\b'` 不可靠** | BSD grep 的 ERE 不支持 `\b` 词边界（静默不匹配），用它做「零残留」判据会漏。**对策**：改名扫描用 ripgrep（`\b` 受支持）或 `perl -ne '/\bram\b/'`；`git grep -E` 同理不可靠。 |
| A40 | **改名让 `--check` 对旧指纹头误报「生成物过期」** | 双前缀读取后，旧 `ram-api:stub` 文件指纹匹配但内容（头文本）与新建期望不一致 → `planStubWrites` 判 `update`，而 `check.ts` 把 `update` 一律当过期 error。结果是存量工程升级后首次 `ojm api --check` 对每个 stub 报「stub 待随契约更新」，与 BDD「不产生误报」冲突（手动 E2E 才暴露，单测只断言了 action）。**对策**：区分「纯前缀升级」——旧头 + 正文与新内容逐字节一致时打 `prefixUpgrade` 标记，`runApi` 刷头、`check` 忽略。教训：兼容读旧名时，要想清楚「读旧名成功」之后各下游对状态的判定是否仍成立。 |
| A41 | **`workspace:*` 只有 pnpm 发布路径会改写** | `pnpm pack/publish` 把 `workspace:*` 改写为精确版本，而 `npm publish` **原样发布**——消费者拿到 `"@oj-module/runtime": "workspace:*"` 直接装不上。守卫测试若只断言「不是 `^`/`~`」等于放行。**对策**：`tests/cli/release-manifest.test.ts` 真跑 `pnpm pack` 解出 tarball 内 manifest 断言无 `workspace:`；文档明确「必须走 `pnpm publish`」。 |
| A42 | **oj 路由表用短方法名（`del`），直接大写会与契约 `DELETE` 不等** | `routes.js` 里是 `method: "del"`；`check.ts` 的 `parseRoutesJs` 若只做 `toUpperCase()` 得到 `DEL`，而契约 IR 是 `DELETE` → 任何 DELETE 端点都误报 `routes-js-drift`（playground-oj 实测）。同文件的 `VERB_OF` 早已有 `del: "DELETE"` 映射，属实现不一致。**对策**：`parseRoutesJs` 也走 `VERB_OF` 归一。 |
| A43 | **CRLF 检出会让指纹「哈希通过、字节比较失败」** | 指纹哈希走 `hashContent`（内部把 CRLF 归一为 LF），但 `existing === content` 与 `isPrefixOnlyUpgrade` 是逐字节比较。Windows `core.autocrlf=true` 检出后每个 stub 都被判「待更新」（`--check` 恒红）。**对策**：比较前统一 LF（`toLf`）。 |
| A44 | **`check` 只认 `update`/`skip`，删掉的 stub 静默通过** | `planStubWrites` 的 `create`（文件不存在）此前被 `check` 忽略，而 client/routes/openapi 的同类缺失是 error → 删掉 stub 后 `--check` 仍绿。**对策**：`create` 也判 `artifact-stale`（「stub 缺失」），与其余生成物口径一致。 |
| A45 | **安装源 ≠ 发布源** | 仓库 `.npmrc` 的 `registry=https://registry.npmmirror.com` 只用于**安装加速**；**发布**走各包 `publishConfig.registry`（`registry.npmjs.org`）。于是 `npm view <新包>`（读镜像）会 404 甚至长期 404，容易被误判成「发布失败」。**对策**：判断发布结果不要读镜像；用 `curl https://registry.npmjs.org/<scope>%2f<name>` 看 200，或干脆再发一次同版本。 |
| A46 | **发布后立刻读 registry 会 404（CDN 传播）** | 新 scope 首发尤其明显：`pnpm publish` 已打印 ✅，但 `npm view` / `curl registry.npmjs.org` 仍 `404 Not found`（实测约 1 分钟后 200）。**对策**：最可靠的确认是**重发同版本**——返回 `403 You cannot publish over the previously published versions: x.y.z` 即证明已发布成功（本次即用此法确认，且不会产生副作用）。另注意 `provenance=true` 写在本仓 `.npmrc`，本地发布需 `--no-provenance` 覆盖，否则会因无 CI OIDC 而失败。 |
