# ojm vendor 改造：下载源从 GitHub releases 切换为 npm 包 @oj-bin/oj

- 日期：2026-09-11 19:26
- 状态：已确认（用户指定：`npm i @oj-bin/oj` 用于下载，参看 <https://www.npmjs.com/package/@oj-bin/oj>）
- 关联：[[202609040905-vendor-download-design]]（旧 GitHub 方案，本文档取代其下载通道部分）

## 1. 背景与目标

现状：`ojm vendor` 走 GitHub API（`api.github.com/repos/everpan/only-js/releases`）查 release、下载资产、自管 `.sha256` 校验。痛点：国内直连 github 常受限需代理；自管校验/解包/平台选资产一整套代码都是重复造轮子。

目标：下载通道切换为 npm 包 `@oj-bin/oj`（上游已发布 0.1.13，含 optionalDependencies 平台子包 + postinstall 落盘 `bin/`）。`ojm vendor` 壳出 `npm i @oj-bin/oj`，平台选择、完整性校验（npm integrity/sha512）、镜像加速全部由 npm 承担。

上游包行为（实测 0.1.13 postinstall.js）：

- 以 `INIT_CWD`（调 npm 时的 cwd）为落盘根，拷 `oj`/`oj.exe` + `plugins/` + `devkit/` 到 `<cwd>/bin/`，文件级原子替换 + chmod 755；
- **所有「装不上」路径只打 WARN 并 exit 0**（绝不炸掉 npm i）→ 安装后必须自行验证 `bin/oj` 存在；
- 不写 `.oj-version` 标记 → 由 cli 侧写；
- 平台面：`linux-x64` / `darwin-arm64` / `win32-x64`（darwin-x64、linux-arm64 暂无，缺失时 postinstall WARN 明示）；
- postinstall 可裸跑：`node node_modules/@oj-bin/oj/postinstall.js`。

## 2. 决策表

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| N1 | 下载通道 | 壳出 `npm i --no-save --no-package-lock --no-audit --no-fund @oj-bin/oj@<version>` | 用户指定；平台选择/完整性/镜像全交给 npm |
| N2 | 安装目录 | **临时目录**安装，再 `fs.cpSync` 临时目录 `bin/` → 工程 `bin/` | 避免在用户工程留 node_modules/package-lock 副作用（用户工程可能是 pnpm 项目） |
| N3 | 版本解析 | tag 缺省：`npm view @oj-bin/oj version`（跟随用户 registry/镜像配置）；显式 tag 去 `v` 前缀后直接使用 | 镜像友好（解决 GitHub 直连受限）；parseVendorArgs 的 v 前缀规范化不动 |
| N4 | 完整性校验 | 删除自管 `.sha256` 流程，由 npm dist.integrity（sha512）承担 | npm 原生能力，不重复造 |
| N5 | 安装后验证 | `bin/oj` 缺失 → 裸跑一次 postinstall.js 兜底（脚本被禁用场景）→ 仍缺失则人话报错（平台不受支持/版本不存在） | 上游 postinstall 失败也 exit 0，必须自查 |
| N6 | 版本标记 | `.oj-version` 保持 `vX.Y.Z` 格式（与存量标记一致） | 兼容旧标记，info.ts 不变 |
| N7 | 删除面 | Release/ReleaseAsset/pickAsset/assetExt/resolveTriplet/TRIPLETS/authHeaders/GITHUB_TOKEN/fetchGuarded/RELEASE_LATEST_API/releaseApiUrl/fetchLatestRelease/fetchRelease/installFromRelease/FetchLike/formatSize 全删；VendorDeps 从 `{fetchFn, token}` 改为 `{run}` | GitHub 通道整体退役 |
| N8 | 探针 | probeOjRuntime 保留不动（release 二进制缺陷与下载通道无关） | 缺陷报告仍有效 |

## 3. 用户故事与用例（BDD）

### US-1 全新工程安装 oj

```gherkin
Given 工程 bin/oj 不存在
When 执行 ojm vendor
Then npm view 查最新版本 → 临时目录 npm i @oj-bin/oj@<latest> → 拷贝 bin/ 到工程 → 写 bin/.oj-version
And 输出安装的版本号
```

### US-2 已是最新，幂等跳过

```gherkin
Given bin/.oj-version 内容等于最新版本（v 前缀）
When 执行 ojm vendor
Then 不执行 npm i，输出 "已是 <version>"，退出码 0
```

### US-3 有新版，按需更新

```gherkin
Given bin/.oj-version 为 v0.1.0，npm 最新为 0.2.0
When 执行 ojm vendor
Then 安装 0.2.0 并覆盖 bin/，.oj-version 更新为 v0.2.0
```

### US-4 强制重装

```gherkin
Given 本地已是最新
When 执行 ojm vendor --force
Then 仍然重装（用于修复损坏的 bin/）
```

### US-5 显式指定版本

| 输入 tag | npm 目标版本 |
|----------|-------------|
| v0.1.13 | 0.1.13 |
| 0.1.13 | 0.1.13 |
| abc | parseVendorArgs 报「非法版本号」（不变） |

### US-6 安装失败（平台不支持 / 版本不存在 / 脚本被禁）

```gherkin
Given npm i 退出码为 0 但临时目录 bin/oj 不存在
When 裸跑 postinstall.js 兜底后仍不存在
Then 报人话错误：平台不受支持或包结构异常，列出上游支持的平台组合
```

```gherkin
Given npm i 本身失败（版本不存在 / 网络失败）
When 执行 ojm vendor
Then 报人话错误，带 npm stderr 首行
```

## 4. 问题记录

| # | 问题 | 分类 | 处置 |
|---|------|------|------|
| P1 | 上游 postinstall **装不上也 exit 0**（只打 WARN）——`npm i` 成功 ≠ bin/oj 落盘 | 反直觉（npm 生命周期惯例是失败即非零） | N5：安装后必查 `bin/oj`，缺失先裸跑 postinstall.js 兜底再报人话错 |
| P2 | postinstall 以 `INIT_CWD` 定位落盘根——只能在调 npm 时以 cwd 控制 | 外部约束 | N2：临时目录执行 npm，落盘后 cpSync 进工程（顺带零污染用户工程） |
| P3 | npm 版本号无 `v` 前缀，与存量 `.oj-version`（vX.Y.Z）及用户输入习惯不一致 | 格式差异 | N3/N6：入口统一去 `v`，标记统一补 `v` |

## 5. 总结

- 关键过程：摸清上游包行为（下载 tarball 直读 postinstall.js，确认 INIT_CWD 落盘、exit 0 语义、三平台支持面）→ 文档定案（N1–N8）→ TDD 重写 `tests/cli/vendor.test.ts`（12 例）→ 重写 `packages/cli/src/vendor.ts`（GitHub 通道整体删除，净删约 130 行）→ 同步 usage/args/init 注释与 cli README、CHANGELOG → 真机冒烟：临时目录 `npm i @oj-bin/oj@0.1.13` 落盘 `bin/oj`（darwin-arm64，106MB）+ plugins + devkit，`--version` 正常。
- 验证：`pnpm typecheck` 通过；`pnpm lint` 改动文件零 error；全量 `pnpm test` 90 文件 567 例全过。
- 耗时：约 20 分钟（19:20–19:40，含真机下载验证）。
