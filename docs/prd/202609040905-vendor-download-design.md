# ram vendor 子命令设计：oj vendor 按平台联网下载

- 日期：2026-09-04 09:05
- 状态：已确认（brainstorming 两轮问答定案）
- 关联：[[202609040105-playground-oj-design]]（D3 vendor 内置方案的本命令是其联网补充）

## 1. 背景与目标

现状：`ram init` 从 npm 包内置的 `vendor/oj-v0.1.0.tar.gz`（仅 macOS arm64，sha256 钉死）解包出 `bin/oj`。痛点：oj 升级必须重发 CLI；非 mac 平台不可用。

目标：新增 `ram vendor` 子命令，从 <https://github.com/everpan/only-js/releases> 获取**最新 release**，按当前平台下载对应资产安装到工程 `bin/`。init 的内置 tar.gz 路径**完全不动**（离线兜底）。

资产命名约定（用户确认 + 发版后实测）：`oj-<tag>-<triplet>.<ext>`，tag 带 `v` 前缀；**ext 按平台分：unix 为 `tar.gz`，Windows 为 `zip`**。每个资产附带同名 `.sha256` 文件（标准 `sha256sum` 格式：`<hex>  <filename>`）。

发版实测（v0.1.0）：已上架 `aarch64-apple-darwin.tar.gz`、`x86_64-pc-windows-msvc.zip`、`x86_64-unknown-linux-gnu.tar.gz`；darwin-x64 / linux-arm64 暂无资产，映射保留、缺资产时走 US-6 报错路径。

## 2. 决策表

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| V1 | 触发时机 | 独立子命令 `ram vendor` | 用户确认；init 保持离线可用 |
| V2 | 行为 | 检查 + 按需更新，幂等；`--force` 强制重装 | 用户确认 |
| V3 | 版本来源 | GitHub API `releases/latest` 的 `tag_name` | 官方唯一可信源 |
| V4 | 本地版本记录 | 安装后写标记文件 `bin/.oj-version`（内容即版本串） | 不依赖 `oj --version` 输出格式（未验证过） |
| V5 | 平台映射 | `process.platform/arch` → Rust target triplet，见 §4 表 | 与上游资产命名一致 |
| V6 | 认证 | `GITHUB_TOKEN` 存在则带 `Authorization: Bearer`，否则匿名 | 仓库当前 404（疑似私有/未发版），两种都支持 |
| V7 | 完整性校验 | **必做**：下载同名 `.sha256` 资产（`sha256sum` 格式，取首段 hex），与下载文件实际 sha256 比对，不符即删临时文件报错 | 上游已随 v0.1.0 提供 sums；沿用 vendor-meta.ts 的防篡改语义 |
| V8 | 解包 | 系统 `tar -xzf --strip-components=1`（unix）；Windows 用系统 `tar -xf`（Win10+ 自带 bsdtar，可读 zip）；chmod 755（win 跳过） | 复用 init 同款（init.ts L75），不加依赖 |
| V9 | 下载 | Node 原生 `fetch` + 流式写临时文件，成功后原子 rename | 零新依赖 |

## 3. 用户故事与用例（BDD）

### US-1 全新工程安装 oj

```gherkin
Given 工程 bin/oj 不存在
When 执行 ram vendor
Then 查询最新 release → 下载本平台资产 → 解压到 bin/ → 写 bin/.oj-version
And 输出安装的版本号
```

### US-2 已是最新，幂等跳过

```gherkin
Given bin/.oj-version 内容等于最新 release tag
When 执行 ram vendor
Then 不下载，输出 "已是最新 <version>"，退出码 0
```

### US-3 有新版，按需更新

```gherkin
Given bin/.oj-version 为 v0.1.0，最新 release 为 v0.2.0
When 执行 ram vendor
Then 下载 v0.2.0 并覆盖 bin/，.oj-version 更新为 v0.2.0
```

### US-4 强制重装

```gherkin
Given 本地已是最新
When 执行 ram vendor --force
Then 仍然下载重装（用于修复损坏的 bin/）
```

### US-5 不支持的平台

| platform | arch | triplet | 结果 |
|----------|------|---------|------|
| darwin | arm64 | aarch64-apple-darwin | ✓ |
| darwin | x64 | x86_64-apple-darwin | ✓ |
| linux | x64 | x86_64-unknown-linux-gnu | ✓ |
| linux | arm64 | aarch64-unknown-linux-gnu | ✓ |
| win32 | x64 | x86_64-pc-windows-msvc | ✓ |
| win32 | arm64 | — | 报人话错误，列出已支持组合 |

### US-6 资产缺失 / 网络失败

```gherkin
Given 最新 release 中没有本平台 triplet 对应的资产
When 执行 ram vendor
Then 报错并列出该 release 实际可用的资产名
```

```gherkin
Given API 返回 403（限流）或 404（私有仓库无 token）
When 执行 ram vendor
Then 人话报错，提示可设置 GITHUB_TOKEN
```

## 4. 组件设计

新增 `packages/cli/src/vendor.ts`，`src/index.ts` 注册 `case "vendor"`（`--force` 解析进 args.ts 同款风格）。

```
vendorCommand(projectRoot, { force }, deps?) 
  ├── resolveTriplet(platform, arch)        # 纯函数，全分支可测
  ├── fetchLatestRelease(deps.fetch)        # 注入 fetch，规避 happy-dom 垫片问题
  ├── pickAsset(assets, tag, triplet)       # 纯函数：匹配 oj-<tag>-<triplet>.<tar.gz|zip>，win32 选 zip
  ├── readLocalVersion(binDir)              # 读 bin/.oj-version，bin/oj 缺失视为未安装
  └── install(assetUrl, binDir, deps)       # 下载→.sha256 校验→tar 解包→chmod→写标记
```

**错误处理**：所有失败路径抛 `[ram] 前缀人话 Error`，由 index.ts 现有 catch 统一出口；临时文件在 finally 中清理。

**测试（TDD，Vitest）**：
- `resolveTriplet`：US-5 表格全分支
- `pickAsset`：命中 / 缺失（错误信息含可用资产列表）
- 版本比较跳过逻辑：相同跳过、不同更新、无标记安装、`--force` 重装
- `fetchLatestRelease`：注入假 fetch 覆盖 403/404 提示语
- 下载与解包：tmp 工程目录 + 本地假 tar.gz（数据 URL/文件 URL），不碰真网络

## 5. 明确不做（YAGNI）

- init 流程改动（仍用内置 tar.gz）
- 启动时自动检查更新 / 版本提醒
- Windows 实机验证（映射正确性靠单测，实机待有用户再说）
- 断点续传、下载进度条

## 6. 问题记录

| 分类 | 问题 | 处置 |
|------|------|------|
| ~~待验证~~ 已闭环 | `everpan/only-js` 曾 API 404 | 2026-09-04 已发 v0.1.0，匿名 API 可读，资产命名/`.sha256` 格式均与设计一致（Windows 为 zip，已修正 V7/V8） |
| 待验证 | oj 是否支持 `--version` 输出 | 不依赖，用 V4 标记文件 |
| 反常识 | Windows 资产用 zip 而非 tar.gz（Rust 社区惯例） | pickAsset 按平台选扩展名，勿写死 tar.gz |
