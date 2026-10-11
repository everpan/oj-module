# cli 发布包私域依赖泄漏修复（@plane/editor 404）

## 背景

用户在外部工程执行安装时报错：

```
pnpm i -D @oj-module/cli        # 解析到 0.1.8（latest 指向问题）
pnpm i -D @oj-module/cli@0.1.11 # ERR_PNPM_FETCH_404: @plane/editor@0.1.10 Not Found
```

## 根因

`packages/cli/package.json` 的 **dependencies** 声明了 `@plane/editor`、`@plane/kit`
（`workspace:*`）。pnpm 发布时把 `workspace:*` 改写为仓内精确版本（`0.1.10`），
（彼时）这两个包是**私域 workspace 包、尚未发布到 npm** → 消费端安装 cli 时按依赖树
去 registry 拉取 → 404。

> **现状已变**：`@plane/kit`、`@plane/editor` 现已发布到 npm（见发布脚本 `LOCKSTEP`
> 守卫与 `packages/kit`、`packages/editor-standalone` 的 `publishConfig.registry`），
> 不再 404。详见文末「后续变更：与 cli 彻底解耦」。

而这两个包对消费端**根本不是运行时依赖**：

- `@plane/kit` / `@plane/editor` 的代码在 `prepack` 阶段被 esbuild 打包进
  `shell-dist/assets/{kit,editor}.js`（随包发布）；
- cli 已发布源码（`src/`）对二者**零 import**（仅 `shared-deps.ts` 中的
  importmap 说明符字符串，经 shell-dist 资产解析，不走 node_modules）；
- 宿主构建脚本 `shell/scripts/build.mts` 不在 `files` 白名单内，不随包发布。

→ 当时正解：二者从 `dependencies` 移到 `devDependencies`（仓内构建期可用，
发布包不再声明）。**后续进一步彻底解耦**：二者已从 cli 的 `devDependencies` 移除，
构建期改由 `shell/scripts/build.mts` 从 monorepo 同级包目录
（`packages/kit`、`packages/editor-standalone`）解析并打包进 `shell-dist`；
cli 的 `package.json` 不再声明这两个包为任何依赖。

## 反常识记录

- **pnpm 发布不校验 workspace:* 目标是否已发布**：`pnpm publish` 会把
  `workspace:*` 一律改写为精确版本并放行，私域包泄漏到发布产物没有任何告警。
  防护只能靠在仓内加守卫测试。
- `pnpm i <pkg>` 解析到旧版（0.1.8）而 registry `latest` 已是 0.1.11：属用户侧
  registry 镜像同步滞后，仓库侧无改动可做；新版本发布后镜像同步即恢复。

## BDD 场景

### 场景 1：发布包依赖树可解析（核心回归）

```
Given @oj-module/cli 的 package.json
When 断言其 dependencies 与 devDependencies
Then 不得包含任何 @plane/* 包（构建期从 monorepo 同级包解析，不声明为依赖）
And  @plane/editor、@plane/kit 不得出现在 dependencies 或 devDependencies（彻底解耦）
```

数据表（泄漏判定）：

| 包 | 在 npm registry | 允许位置 |
|---|---|---|
| @plane/editor | 存在（已发布） | cli 不声明（构建期从 monorepo 同级包解析，宿主经 shell-dist 资产消费） |
| @plane/kit | 存在（已发布） | cli 不声明（同上） |
| @oj-module/runtime | 存在 | dependencies（workspace:*，发布转精确版） |

### 场景 2：已发布源码零运行时引用

```
Given cli/src 与 runtime/src 全部源码
When 扫描 import/require 说明符
Then 零条以 @plane/ 开头的运行时导入
And  shared-deps.ts 中的说明符字符串不影响该结论（importmap 键，非模块解析）
```

### 场景 3：打包产物验证

```
When 执行 pnpm --filter @oj-module/cli pack（dry-run）
Then 产物 package.json 的 dependencies 不含 @plane/*
And  shell-dist/assets/editor.js、kit.js 仍在产物内
```

## 任务

| # | 任务 | 状态 |
|---|---|---|
| 1 | package-guards.test.ts 新增「dependencies 零 @plane/*」守卫（先红） | ✅ |
| 2 | cli package.json：@plane/editor、@plane/kit 移至 devDependencies（转绿） | ✅ |
| 3 | cli/runtime lockstep 升版 0.1.12 | ✅ |
| 4 | pnpm pack dry-run 验证发布产物依赖树 | ✅ |
| 5 | 全量测试回归 | ✅ |

## 总结

- **关键过程**：定位根因（workspace 私域包进 dependencies，pnpm 发布把 `workspace:*`
  改写为精确版并放行，消费端拉取 404）→ 守卫测试先红 → 两包移入 devDependencies
  → 升版 0.1.12 触发 lockstep 门禁 → 重建宿主产物转绿 → `pnpm pack` 实包验证
  dependencies 已无 @plane/* 且 `editor.js`/`kit.js` 资产仍在 → 全量 715 测试通过。
- **追加发现（问题记录）**：0.1.11 发布时只升了 cli/runtime，漏升 @plane/kit 与
  @plane/editor → `tests/shell/kit-shared.test.ts` lockstep 断言在干净树上即红。
  本次一并补齐到 0.1.12。
- **遗留（与本修复无关，预存）**：`pnpm typecheck` 在 tests/cli/preview.test.ts:299
  有 OjProcess 类型错误，干净树上同样存在，未处理。
- **耗时**：约 25 分钟（含 shell 重建 ×2、全量测试 ×2）。
- **发布动作**：本机无 npm 认证，需在有权限的环境执行 `pnpm --filter @oj-module/cli publish`
  （prepack 会自动跑 sync-host-versions 门禁）。发布后 `latest` 指向 0.1.12，
  用户侧 registry 镜像同步后 `pnpm i @oj-module/cli` 即恢复正常。

## 后续变更：与 cli 彻底解耦

上文是 2026-10-10 的修复记录（把 `@plane/kit`/`@plane/editor` 从 `dependencies` 移到
`devDependencies`）。后续进一步把 cli 与这两个包彻底解耦：

- **现状**：`@plane/kit`、`@plane/editor` 现已发布到 npm（不再 404），并被纳入发布脚本的
  `LOCKSTEP` 同版守卫；二者与 cli 的版本在每次发布时通过 `versions.json` 钉齐。
- **改动**：cli 的 `package.json` 不再把二者列于 `dependencies` 或 `devDependencies`；
  `shell/scripts/build.mts`（`build:shell`）新增同级包目录解析——构建期直接读
  `packages/kit` / `packages/editor-standalone` 的入口（`dist/kit.js` / `dist/editor.js`，
  均随仓提交）来打包 `shell-dist/assets/{kit,editor}.js`，不再依赖 cli 的 `node_modules`
  解析这两个包。
- **宿主侧无感**：宿主工程消费的是 cli 预置的 `shell-dist` 资产（经 importmap 命中
  `/assets/{kit,editor}.js`），`checkSharedVersions` 只对宿主已安装的包比对版本，
  故宿主工程**无需**安装 `@plane/kit`/`@plane/editor`，也无新增版本锁定约束。
- **守卫测试**：`tests/cli/package-guards.test.ts` 的断言已加强为「cli 的 `dependencies`
  与 `devDependencies` 均不含 `@plane/kit`/`@plane/editor`」。
