# pnpm dlx 直接调用 ojm —— 验证与前置条件

## 需求

`pnpm dlx @oj-module/cli` 拉起即用，免在目标工程安装 devDependency。

## 结论

**无需改代码**。pnpm dlx 对「包内只有单个 bin」的包有 fallback：bin 名不必等于
包名（unscoped），直接执行唯一 bin。实测 pnpm v11.24.0（用户环境）与 v12.10.1 均如此。
真正的拦路虎是已发布的 0.1.11 装不上（@plane/editor 404，见
202610101405-cli-publish-private-deps-fix.md）——**发布 0.1.12 后 dlx 即通**。

## 反常识记录

- **pnpm dlx 不要求 bin 名 == 包名**：`@oj-module/cli` 的唯一 bin 是 `ojm`，
  dlx 照跑。业界通行认知（npm exec/npx 文档口径）是「scoped 包找 unscoped 名的 bin」，
  实测 pnpm 在单 bin 场景有 fallback。若未来给 cli 加第二个 bin，此 fallback
  可能失效——届时需补 unscoped 名 bin 别名（`"bin": { "cli": ... }`）。

## BDD 场景（已全部实测通过）

### 场景 1：单 bin fallback 探测（最小包）

```
Given 包 @oj-module/cli（version 9.9.9）bin 仅 { "ojm": "./bin.mjs" }
When pnpm dlx <tarball> hello world   # pnpm v11.24.0 与 v12.10.1
Then 输出 "BIN-OK hello world"
```

### 场景 2：真实产物端到端（安装态模拟）

```
Given /tmp 工程，pnpm-workspace.yaml overrides 把 @oj-module/runtime 指到本地 tarball
When pnpm add <cli-0.1.12.tgz>
Then 依赖树全部可解析（无 @plane 404）✅
When ./node_modules/.bin/ojm --help
Then 正常打印用法 ✅（tsx --import 加载 TS 源码在消费端环境成立）
```

### 场景 3：dlx 真实链路（发布后复验清单）

```
Given registry 已发布 runtime@0.1.12 与 cli@0.1.12（scripts/publish-packages.mjs 已保序）
When pnpm dlx @oj-module/cli --help
Then 正常打印用法
```

## 发布后即可用的命令

```bash
pnpm dlx @oj-module/cli init my-app   # 脚手架
pnpm dlx @oj-module/cli@0.1.12 --help
```

注意：dlx 安装 cli 会连带装其全部 dependencies（vite/esbuild/tsx 等，约百来个包），
首次较慢属正常；esbuild 的 approve-builds 警告不阻断（运行时经 optional dep 回退
解析平台二进制）。

## 任务

| # | 任务 | 状态 |
|---|---|---|
| 1 | pnpm v11/v12 dlx 单 bin fallback 探测 | ✅ |
| 2 | 0.1.12 真实 tarball 消费端安装 + ojm 可执行验证 | ✅ |
| 3 | 文档留档 | ✅ |

## 总结

- **关键过程**：先探测 dlx bin 解析规则（最小包 × 两版本 pnpm）→ 再对 0.1.12
  真实产物做消费端安装验证（overrides 指本地 runtime tarball 绕过未发布版本）→
  `ojm --help` 正常运行。全程无产品代码改动。
- **耗时**：约 15 分钟。
- **遗留动作**：在有 npm 权限的环境跑 `node scripts/publish-packages.mjs` 发布
  0.1.12 后，按场景 3 复验 `pnpm dlx @oj-module/cli --help`。
