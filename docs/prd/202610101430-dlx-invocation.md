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

## 发布后实测排障（202610101456 补充）

0.1.12 发布后用户实测 `pnpm dlx @oj-module/cli -h` 仍装 0.1.8。排查结论：
**官方源 registry.npmjs.org 与 npmmirror 的 latest 均已是 0.1.12，是用户环境
配置的 registry（公司内网代理源）上 latest 停留在 0.1.8**——dlx 日志里的
`resolved 227` 证明做了真实解析，结果来自那个滞后的源。

### 现象 → 对策

| 现象 | 对策 |
|---|---|
| `pnpm dlx @oj-module/cli` 装出旧版 | 显式版本：`pnpm dlx @oj-module/cli@0.1.12 -h`（绕过 dist-tag，最稳） |
| 内网源长期滞后 | 临时：`pnpm --registry=https://registry.npmmirror.com dlx @oj-module/cli -h`；治本：`pnpm config set registry https://registry.npmmirror.com` |
| 诊断当前源 | `pnpm config get registry`，再 `npm view @oj-module/cli dist-tags --registry=<该源>` 对比官方源 |
| `Choose which packages to build` 交互提示卡住 dlx | 直接回车（不选）跳过：esbuild 无 postinstall 也能工作；工程内彻底放行：`pnpm-workspace.yaml` 加 `onlyBuiltDependencies: [esbuild]`；CI 非交互环境自动不构建，不卡 |

### 反常识记录（追加）

- **dlx 不缓存解析结果**：每次执行都重新 resolve（日志 `resolved N`），所以
  "重试还是旧版" 不是缓存问题，而是**解析源上的 dist-tags 就是旧的**。
  这与 `npm install` 的 packument 缓存（有 TTL）不同，别用清缓存的思路排查 dlx。

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
