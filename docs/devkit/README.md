# oj-module DevKit——模块开发手册 + agent skill

面向用 `ojm` 开发前后端一体工程的开发者与 AI agent。本目录是**源文件**，
发布时整目录归置进 `bin/devkit/`，再由 `ojm init` 分发到工程内。

它补的是 `oj-api-dev`（oj 后端 API 开发）之外的另一半：**前端模块、契约、
前后端对接**。

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

# 后端 API 开发另装 oj 自带的 devkit（独立 skill，随 oj 二进制分发，不在此目录内）
mkdir -p .claude/skills/oj-api-dev
# 从 oj 二进制解压出的 .claude/skills/oj-api-dev/ 拷贝 SKILL.md 与 api-manual.md
```

安装后 Claude Code 里 `/ojm-module-dev` 触发，或直接说「用 ojm-module-dev 加个 xxx 模块」。

## 与 `ojm init` 的关系

`ojm init` 目前只分发 oj 的 devkit（`.claude/skills/oj-api-dev/`）。
把本目录接入 init 分发是**未做**的一步，见 `framework-dev.md` §7「待对接」。

## 更新

手册与 skill 随 `@oj-module/cli` 版本一起发布；升级后覆盖工程内旧拷贝。

> 本目录（devkit）是**自包含**的：所有内容都在这 4 个文件里，不需要工程仓库里的
> 其它文档即可读懂。维护者视角的内容来源整理在 `framework-dev.md`（仅本仓）。
