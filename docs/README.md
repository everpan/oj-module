# oj-module 文档索引

本目录是 `oj-module` 工程的文档根。文档分三类：**交付文档（devkit）**、**PRD / 设计文档（活跃）**、**归档（archive）**。

> 阅读顺序建议：先看 [DevKit 手册](#devkit-随-ojm-分发给业务工程) 上手开发；想了解某个功能为什么这么设计，再到 [PRD](#prd--设计文档活跃) 找对应的方案；历史方案与旧版中文指南在 [归档](#归档-archive)。

---

## DevKit（随 `ojm` 分发给业务工程）

`docs/devkit/` 是**源文件**，发布时整目录归置进 `bin/devkit/`，再由 `ojm init` 分发到各业务工程内。补的是 `oj-api-dev`（oj 后端 API 开发）之外的另一半：前端模块、契约、前后端接线。

| 文件 | 面向谁 | 用途 |
|---|---|---|
| [`devkit/README.md`](devkit/README.md) | 所有人 | 本索引的入口说明、DevKit 与 `ojm init` 的关系、素材来源 |
| [`devkit/manual.md`](devkit/manual.md) | 业务开发者 | 模块开发手册（10 章）：工程结构、写模块、契约与代码生成、接管框架内置功能、布局、i18n、构建发布、排查、CLI 子命令参考 |
| [`devkit/SKILL.md`](devkit/SKILL.md) | AI agent / 开发者 | agent skill 入口：工作流、红线、新模块 checklist、陷阱速查，按章节号引用手册 |
| [`devkit/framework-dev.md`](devkit/framework-dev.md) | 框架贡献者（**仅本仓**） | 改 `packages/runtime`、`packages/cli` 时的入口、红线、不变式索引、守卫测试索引 |

---

## PRD / 设计文档（活跃）

`docs/prd/` 与各顶层方案文档，记录功能的设计动机、方案与实现计划，是当前仍在参考的活跃资料。

| 文件 | 主题 |
|---|---|
| [`202609130035-provider-guide.md`](../202609130035-provider-guide.md) | Provider 上手指南（大白话版） |
| [`prd/framework-development-guide.md`](prd/framework-development-guide.md) | 框架开发手册：两个 npm 包（新人上手版） |
| [`prd/ojm-api-codegen-guide.md`](prd/ojm-api-codegen-guide.md) | ojm api 契约代码生成指南（新人向） |
| [`prd/oj-fullstack-tutorial.md`](prd/oj-fullstack-tutorial.md) | 实战演练：从零构建一个 oj 前后端应用（books 图书管理） |
| [`prd/framework-verification-playbook.md`](prd/framework-verification-playbook.md) | 框架端到端验证手册（可重复演练） |
| [`prd/202610062333-oj-0.1.50-alignment-review-and-plan.md`](prd/202610062333-oj-0.1.50-alignment-review-and-plan.md) | oj 0.1.50 对齐评审与更新计划（packages/cli） |
| [`prd/202609110947-oj-module-two-package-consolidation-design.md`](prd/202609110947-oj-module-two-package-consolidation-design.md) | `@oj-module` 双包整合与品牌改名 — 设计方案 |
| [`prd/202609111926-vendor-npm-install-design.md`](prd/202609111926-vendor-npm-install-design.md) | ojm vendor 改造：下载源从 GitHub releases 切换为 npm 包 `@oj-bin/oj` |
| [`prd/202609112006-init-template-personal-center-design.md`](prd/202609112006-init-template-personal-center-design.md) | ojm init 模板补全：personal-center 模块 + 钉版矩阵收尾 |
| [`prd/202609112121-shell-dark-css-vars-design.md`](prd/202609112121-shell-dark-css-vars-design.md) | 修复：shell 宿主链暗黑模式下 `--oo-*` 变量缺失（footer 白色） |
| [`prd/202609112324-web-layout-and-codegen-guide-design.md`](prd/202609112324-web-layout-and-codegen-guide-design.md) | web 布局改名 + ojm api 生成目录更名 + 豁免清单注释 |
| [`prd/202609122224-layout-injection-and-notification-design.md`](prd/202609122224-layout-injection-and-notification-design.md) | 布局注入与通知互动设计 |
| [`prd/202609130128-client-factory-design.md`](prd/202609130128-client-factory-design.md) | 生成 client 工厂化设计（`create<Module>Client(ctx)`，构造即 install） |
| [`prd/oj-release-binary-defect-report.md`](prd/oj-release-binary-defect-report.md) | oj 发布二进制缺陷报告：release 产物在非构建机不可用 |

---

## 归档（archive）

`docs/archive/` 收纳**历史方案与旧版文档**，仅供追溯，不再作为当前实现的依据：

- [`archive/prd/`](archive/prd/) — 各阶段的方案 / 计划 / 评审报告 / 交接文档（按日期命名）。
- [`archive/zh/guide/`](archive/zh/guide/) — 旧版中文开发指南（`introduction` / `fundamentals` / `advanced` / `other`）。
- [`archive/playground-e2e-verification.md`](archive/playground-e2e-verification.md)、[`archive/index.md`](archive/index.md) — 早期 playground 验证记录与旧索引。

> 新增文档时：活跃资料放进 `docs/prd/` 或顶层；一旦对应的功能稳定或方案被取代，移入 `docs/archive/` 对应子目录，并保持本索引更新。
