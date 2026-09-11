# `@oj-module` 双包整合与品牌改名 — 设计方案

> 创建时间: 2026-09-11 09:47
> 状态: 已评审（脑暴对话逐节确认），待实施
> 关联文档: `docs/archive/prd/202608291025-framework-npm-package-design.md`（现行 4 包架构的设计依据，本文修订其 D4 / §4.1）、`docs/prd/framework-development-guide.md`（对外手册，需同步改名）
> 前置已确认: `@oj-module` npm scope 已注册可用

---

## 1. 背景与动机

现行框架分为 4 个 npm 包（`@react-antd-module/{contract,runtime,cli,shell}`）。四包版本已各自漂移（cli 0.1.5 / contract 0.1.3 / runtime 0.1.4 / shell 0.1.4），而设计文档 D12 要求「模块工程里硬共享依赖版本与宿主**严格相等**」——版本漂移与严格相等门禁直接冲突，漂移后的旧版本会被门禁当成"真相"强加给下游（同 A25 教训）。

本次整合触发三个动机 + 一个品牌动作：

| # | 动机 | 现状痛点 |
|---|------|----------|
| M1 | 精简发布与版本管理 | 4 个包 4 个版本号、4 次发版、跨包版本对齐靠人为约束 |
| M2 | 消除 cli↔shell 隐性环 | **未声明**的互依 + 「先 build shell 才能用 cli」的顺序约束（详见 §2.2） |
| M3 | 降低外部工程安装负担 | 外部工程 devDeps 需装 4 个框架包 |
| M4 | 品牌改名 | `@react-antd-module` → `@oj-module`；命令 `ram` → `ojm` |

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

- **shell → cli**（已声明）：`packages/shell/scripts/build.mts` 从 `@react-antd-module/cli/shared-deps` 取共享表、从 `cli/esm-exports` 取导出完整性门禁。
- **cli → shell**（**未声明**）：`packages/cli/src/dev.ts:41`、`versions.ts:22`、`init.ts:209` 靠路径查找 `node_modules/@react-antd-module/shell/dist`，monorepo 下回退 `../../packages/shell/dist`。

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

## 6. 改名迁移（`@react-antd-module` → `@oj-module`，`ram` → `ojm`）

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
| R6 | 单 cli 包同时暴露 Node 工具 API 与浏览器产物，模块误 import 拉进 vite/esbuild | `exports` 硬分区；新增门禁测试：`modules/**`、`templates/modules/**` 不得 import `@oj-module/cli/*` |
| R7 | 改名面广，测试/模板/docs 三处不同步 | 全仓 `grep -rn "@react-antd-module\|\bram\b"` 作机械判据；CI 加"零残留"断言 |
| R8 | US-7「runtime 包无 `.ts`」被 contract 误破 | D5：contract 编成 dist；`npm pack --dry-run` 断言无 `.ts`、无 `src/` |
| R9 | 两包版本再次漂移 | cli 对 runtime 精确版本 + lockstep 发布；新增断言测试 |

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
    And 日志中无「找不到 @react-antd-module/shell 的预构建产物」

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
    When 全仓 grep "@react-antd-module"
    Then 零命中（docs/archive 历史文档除外）
```

---

## 9. 实施阶段

| Phase | 主题 | 主要任务 | 完成判据 |
|-------|------|----------|----------|
| **P0** | 前置 | 确认 `@oj-module` scope（已完成）；建分支 | scope 可发布 |
| **P1** | 包合并（结构） | contract 并入 runtime 子路径 + dist 构建；shell 迁入 cli；`resolveShellDist` 三处收敛；exports/files/bin 调整 | `pnpm --filter @oj-module/{runtime,cli} build` 通过；`ojm dev` 端到端跑通（说明符暂留旧名） |
| **P2** | 改名（scope） | 机械替换包名、import、模板、工程、根配置、测试、文档 | 全仓 `grep @react-antd-module` 零命中 |
| **P3** | 改名（bin + 内部前缀 + 兼容） | 双 bin；`.ojm-api-exempt.json`；指纹头双前缀；`Symbol.for` 双符号；日志前缀 | 存量工程升级演练通过 |
| **P4** | 守卫与验收 | 新增 §8.2 守卫测试；改造 §8.1 既有测试；`prepack` 断言 | 全部 BDD 场景通过；`pnpm test` 全绿 |
| **P5** | 发布演练 | `npm pack --dry-run` 校验两包内容；playground 与 playground-oj 端到端 | 两包同版本号发布演练成功；外部工程 2 包安装可用 |

每个 Phase 独立建分支、独立评审与回滚。

---

## 10. 待定事项

| # | 事项 | 处置建议 |
|---|------|----------|
| O1 | 两包是否强制同版本号（lockstep）还是允许 cli 快于 runtime | 建议 lockstep；cli 对 runtime 精确版本已能兜住，lockstep 进一步简化心智 |
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
