# oj-module DevKit——模块开发手册 + agent skill

面向用 `ojm` 开发前后端一体工程的开发者与 AI agent。本目录是**源文件**，
发布时整目录归置进 `bin/devkit/`，再由 `ojm init` 分发到工程内。

它补的是 `oj-api-dev`（oj 后端 API 开发）之外的另一半：**前端模块、契约、
前后端接线**。

| 文件 | 用途 |
|---|---|
| `SKILL.md` | Claude Code 等 agent 的 skill 入口：工作流、红线、新模块 checklist、陷阱速查，按章节号引用手册 |
| `manual.md` | 模块开发手册（9 章）：工程结构、写模块、契约与代码生成、provider 抢活、布局、i18n、构建发布、排查 |
| `framework-dev.md` | 框架贡献者路线（**仅本仓**）：改 `packages/runtime`、`packages/cli` 时的入口与红线 |

## 安装（业务工程）

```sh
# agent 用：拷入工程的 Claude Code skill 目录
mkdir -p .claude/skills/ojm-module-dev
cp devkit/SKILL.md devkit/manual.md .claude/skills/ojm-module-dev/

# 后端 API 开发另装 oj 的 devkit
mkdir -p .claude/skills/oj-api-dev
cp devkit/oj-api-dev/SKILL.md devkit/oj-api-dev/api-manual.md .claude/skills/oj-api-dev/
```

安装后 Claude Code 里 `/ojm-module-dev` 触发，或直接说「用 ojm-module-dev 加个 xxx 模块」。

## 与 `ojm init` 的关系

`ojm init` 目前只分发 oj 的 devkit（`.claude/skills/oj-api-dev/`）。
把本目录接入 init 分发是**未做**的一步，见 `framework-dev.md` §7「待接线」。

## 更新

手册与 skill 随 `@oj-module/cli` 版本一起发布；升级后覆盖工程内旧拷贝。
源文件与反馈入口在本仓库 `docs/devkit/`。

## 素材来源（维护者看）

本目录由以下文档整理而成，改内容时注意同步：

| 源 | 贡献 |
|---|---|
| `docs/202609130035-provider-guide.md` | provider 抢活、案例、踩坑表、排查清单 |
| `docs/prd/ojm-api-codegen-guide.md` | 契约 → client 生成管线、`--check` 对账、豁免清单 |
| `docs/prd/oj-fullstack-tutorial.md` | 端到端上手流程 |
| `docs/prd/202609130128-client-factory-design.md` | `create<Module>Client(ctx)` 工厂语义 |
| `apps/playground-oj/docs/phase*.md` | 各阶段实战记录 |
| `packages/cli/templates/` | 可直接抄的模板形状 |
| `docs/prd/framework-development-guide.md` | 框架贡献者路线 |
