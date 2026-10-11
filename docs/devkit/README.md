# oj-module DevKit——模块开发手册 + agent skill

面向用 `ojm` 开发前后端一体工程的开发者与 AI agent。本目录是**源文件**，
发布时整目录归置进 `bin/devkit/`，再由 `ojm init` 分发到工程内。

它补的是 `oj-api-dev`（oj 后端 API 开发）之外的另一半：**前端模块、契约、
前后端对接**。

> **oj v0.1.58 起站点挂载迁移**：`server.api_prefix` / `app_path` / `app_prefix` /
> `static_sites` / `app_spa_fallback` 这五个站点键已被删除，改由顶层 **`mounts:`** 扁平表
> 承载（一行=一个 URL 前缀+一个目录，`api`/`web` 恰好其一）。旧键出现即被 `oj serve` fail-fast 拒绝。
> 仓库内 `ojm init` 模板已是 `mounts:`；oj 侧挂载、密钥信封、vars、cors、schema 校验等完整用法见
> [`docs/oj-api-dev/`](../oj-api-dev/README.md)。

| 文件 | 用途 |
|---|---|
| `SKILL.md` | Claude Code 等 agent 的 skill 入口：工作流、红线、新模块 checklist、陷阱速查，按章节号引用手册 |
| `manual.md` | 模块开发手册（10 章）：工程结构、写模块、契约与代码生成、provider 接管（覆盖框架内置功能）、布局、i18n、构建发布、排查、CLI 子命令参考（ojm 原生命令 vs oj 透传命令） |
| `framework-dev.md` | 框架贡献者路线（**仅本仓**）：改 `packages/runtime`、`packages/cli` 时的入口与红线 |

## 安装（业务工程）

```sh
# 本 devkit（ojm 模块开发）：拷入工程的 Claude Code skill 目录
mkdir -p .claude/skills/ojm-module-dev
cp SKILL.md manual.md .claude/skills/ojm-module-dev/

# 后端 API 开发另装 oj 自带的 devkit（独立 skill，随 oj 二进制分发，不在此目录内）。
# 仓库里也同步了一份权威副本在 docs/oj-api-dev/（随 oj 版本更新，覆盖时以 oj 源为准）：
mkdir -p .claude/skills/oj-api-dev
cp ../oj-api-dev/SKILL.md ../oj-api-dev/api-manual.md .claude/skills/oj-api-dev/
```

安装后 Claude Code 里 `/ojm-module-dev` 触发，或直接说「用 ojm-module-dev 加个 xxx 模块」。

## 与 `ojm init` 的关系

`ojm init` 目前只分发 oj 的 devkit（`.claude/skills/oj-api-dev/`）。
把本目录接入 init 分发是**未做**的一步，见 `framework-dev.md` §7「待对接」。

## 更新

手册与 skill 随 `@oj-module/cli` 版本一起发布；升级后覆盖工程内旧拷贝。

> 本目录（devkit）是**自包含**的：所有内容都在这 4 个文件里，不需要工程仓库里的
> 其它文档即可读懂。维护者视角的内容来源整理在 `framework-dev.md`（仅本仓）。
