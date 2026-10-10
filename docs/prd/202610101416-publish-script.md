# 发布脚本（scripts/publish-packages.mjs）

## 背景

发布仓库：**registry.npmjs.org**（用户指定，与各包 `publishConfig.registry` 一致；
`.npmrc` 的 npmmirror 仅用于安装加速，与发布无关）。

现有发布流程是 `docs/prd/framework-development-guide.md` 附录 A 里的**手动内联 shell**，
依赖人肉按序执行，已两次出事故：

- 0.1.11 只升 cli/runtime、漏升 @plane/kit 与 @plane/editor → lockstep 测试在干净树上即红
  （docs/prd/202610101405-cli-publish-private-deps-fix.md）；
- 更早的 0.1.x 发布曾把私域 workspace 包泄漏进 dependencies → 消费端安装 404。

根因共性：**发布前检查没有可执行载体**，靠记忆。

## 需求

把附录 A 的流程固化为 `scripts/publish-packages.mjs`，发布前门禁全部脚本化：

1. **lockstep 校验**：cli / runtime / @plane/kit / @plane/editor 四包版本必须一致。
2. **产物重建**：runtime dist + cli shell-dist（含 @plane/kit 构建与版本矩阵）。
3. **守卫测试**：tests/cli + tests/shell/kit-shared（真跑 pnpm pack 的发布清单守护）。
4. **按依赖序发布**：runtime → cli（cli 精确依赖 runtime，先 cli 会悬空）。
   必须 `pnpm publish`（npm publish 会漏 `workspace:*` 字面量），
   `--access public --no-provenance`（本仓 .npmrc 写了 provenance=true 但本地无 CI OIDC）。
5. **发布后复核**：轮询官方 registry（非镜像）确认 dist-tags.latest 与 tarball 可达，
   处理 CDN 传播延迟；跳过镜像（`.npmrc` 指向 npmmirror，读它可能一直 404）。

## BDD 场景

### 场景 1：版本不一致拒绝发布

```
Given 四包版本不一致（如 cli=0.1.12、@plane/kit=0.1.10）
When 运行发布脚本
Then 在构建/发布前失败退出，并打印各包实际版本
```

### 场景 2：未登录官方 registry 拒绝发布

```
Given 本机对 registry.npmjs.org 无认证
When 运行发布脚本（非 --dry-run）
Then 在构建前失败退出，提示 npm login --registry
```

### 场景 3：正常发布

```
Given 工作区干净、四包同版本、已登录
When 运行发布脚本
Then 依次执行 构建 → 守卫测试 → publish runtime → publish cli → registry 复核
And  全程任一步失败即中止，不进入下一步
```

### 场景 4：演练模式

```
When 运行发布脚本 --dry-run
Then 执行 构建 → 守卫测试 → pnpm pack（release-manifest 测试即真 pack）
And  不执行 publish、不要求登录
```

数据表（旗标）：

| 旗标 | 行为 |
|---|---|
| `--dry-run` | 只构建 + 守卫测试，不发布、不查登录 |
| `--skip-tests` | 跳过守卫测试（应急用，发布前须手动补跑） |
| `--tag <t>` | 指定 dist-tag（默认 latest） |

## 用法

```bash
# 全流程发布（需已 npm login --registry=https://registry.npmjs.org）
node scripts/publish-packages.mjs

# 演练：构建 + 守卫测试，不发布
node scripts/publish-packages.mjs --dry-run

# 应急跳过测试 / 发预发 tag
node scripts/publish-packages.mjs --skip-tests
node scripts/publish-packages.mjs --tag beta
```

执行序：`lockstep 校验 → 工作区干净校验 → 登录校验 → 构建（runtime → shell）→
守卫测试（pnpm vitest run tests/cli tests/shell/kit-shared）→ publish runtime →
publish cli → registry 轮询复核（最长 3 分钟）`。任一步失败即中止。

## 任务

| # | 任务 | 状态 |
|---|---|---|
| 1 | scripts/publish-packages.mjs 实现场景 1–4 | 待办 |
| 2 | 脚本自检：--dry-run 在干净树跑通 | 待办 |
| 3 | docs/devkit/framework-dev.md §5 指向脚本 | 待办 |
