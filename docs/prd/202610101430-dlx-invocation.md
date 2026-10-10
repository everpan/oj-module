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

## 发布后实测排障（202610101456 初判，202610101503 修正）

0.1.12 发布后用户实测 `pnpm dlx @oj-module/cli -h` 仍装 0.1.8，且
`pnpm config get registry` 就是官方源——**初判「镜像/内网源滞后」错误，已推翻**。

### 真正根因：pnpm ≥11 默认 minimumReleaseAge=1440（供应链保护）

[pnpm 11.0 起](https://pnpm.io/blog/releases/11.0) 默认开启
`minimumReleaseAge: 1440`（分钟，1 天）：发布时间不足 1 天的版本**不参与裸版本号
解析**。完整因果链（两个时点同一根因）：

```
pnpm dlx @oj-module/cli            ← 裸版本号
  → latest 是 0.1.12，但发布仅 26 分钟 < 1 天 → 按「未成熟」跳过
  → 取次新成熟版本 0.1.11 → 其依赖 @plane/editor@0.1.10 在 npm 404
  → 解析回退（backtrack）到 0.1.8 → 装出旧版
```

用户首次报障（当时 latest=0.1.11）同理：0.1.11 的 @plane 依赖 404 → 回退 0.1.8。
**消费端日志 + 本机空白目录实测双重确证**；`minimumReleaseAge: 0` 后同一命令
立即解析 0.1.12。

时序：0.1.12 发布于 2026-10-10T06:36Z，**2026-10-11T06:36Z（北京时间 14:36）后
裸版本号自动指向 0.1.12，无需任何操作**。

### 现象 → 对策

| 现象 | 对策 |
|---|---|
| 新发布版本 24h 内裸版本号装出旧版 | 正常现象（pnpm≥11 供应链保护）。急用显式版本：`pnpm dlx @oj-module/cli@0.1.12 -h`（会写入 minimumReleaseAgeExclude，属预期） |
| 想立即让 latest 生效 | 工程 `pnpm-workspace.yaml`：`minimumReleaseAgeExclude: ["@oj-module/cli", "@oj-module/runtime"]`；或测试环境 `minimumReleaseAge: 0` |
| `Choose which packages to build` 交互提示卡住 dlx | 直接回车（不选）跳过：esbuild 无 postinstall 也能工作；工程内彻底放行：`pnpm-workspace.yaml` 加 `onlyBuiltDependencies: [esbuild]`；CI 非交互环境自动不构建，不卡 |

### 反常识记录（修正初判）

- **初判「解析源滞后」错误**：registry 是官方源、dist-tags 正确、dlx 每次都重新
  resolve——但「重新 resolve」不等于「拿到新版本」，年龄门禁在解析阶段就过滤了。
  教训：看到「装出版本低于 latest」先查 `npm view <pkg> time` 算包龄，再怀疑源。
- **显式版本 vs 裸版本号行为不同**：`pkg@x.y.z` 明确指定版本会绕过年龄门禁
  （非 strict 模式自动记入 exclude）；裸 `pkg` / `@latest` 被门禁拦。
- **依赖 404 会触发静默回退**：解析器对依赖树失败的候选版本不是报错而是回退到
  更老版本——0.1.11 的 @plane 404 让解析一路退到 0.1.8，表面「装成功」实则退化，
  极具迷惑性。

参考：[pnpm 11.0 release notes](https://pnpm.io/blog/releases/11.0)、
[minimumReleaseAge 默认 1 天的行为讨论](https://knowledgeforagents.com/problems/75022a60-7841-4024-958d-f3487c3a8379)、
[v12 strict 模式回归 issue](https://github.com/pnpm/pnpm/issues/14409)。

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
