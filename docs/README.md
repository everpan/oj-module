# oj-module 文档索引

本目录是 `oj-module` 工程的文档根。文档分三类：**交付文档（devkit）**、**PRD / 设计文档（活跃）**、**归档（archive）**。

> 阅读顺序建议：先看 [DevKit 手册](#devkit-随-ojm-分发给业务工程) 上手开发；想了解某个功能为什么这么设计，再到 [PRD](#prd--设计文档活跃) 找对应的方案；历史方案与旧版中文指南在 [归档](#归档-archive)。

---

## DevKit（随 `ojm` 分发给业务工程）

`docs/devkit/` 是**源文件**，发布时由 cli 的 `prepack` 归置进 `packages/cli/devkit/`，再由 `ojm init` 分发到各业务工程内。一棵树覆盖前后端两侧，但是**两套独立分发的 skill**：

| 侧 | 位置 | 用户工程落点 | 分发链 |
|---|---|---|---|
| ojm 模块开发（前端模块、契约、前后端接线） | `devkit/` 顶层 13 个文件 | `.claude/skills/ojm-module-dev/` | `@oj-module/cli` 包 → `ojm init` 第 4b 步（分发其中 7 个） |
| oj API 开发（后端 handler、全局对象、配置、测试） | `devkit/oj-api-dev/`（oj devkit 快照，仅本仓参考） | `.claude/skills/oj-api-dev/` | oj 二进制自带 → `ojm init` 第 4 步 |

| 文件 | 面向谁 | 用途 |
|---|---|---|
| [`devkit/README.md`](devkit/README.md) | 所有人 | 整棵树的入口说明：两侧文件索引、安装、两条分发链、快照刷新 |
| [`devkit/manual.md`](devkit/manual.md) | 业务开发者 | 模块开发手册（14 章）：工程结构、写模块、契约与代码生成、接管框架内置功能、布局、i18n、构建发布、排查、CLI 子命令参考、方案包打包与分发、签名与信任、组织架构与通讯录 |
| [`devkit/SKILL.md`](devkit/SKILL.md) | AI agent / 开发者 | agent skill 入口：工作流、红线、新模块 checklist、陷阱速查，按章节号引用手册 |
| [`devkit/publish-walkthrough.md`](devkit/publish-walkthrough.md) | 业务开发者 | 方案包发布全流程（新手照做版）：构建打包 → 签名 → `market publish` → build-index → verify/trial → install |
| [`devkit/menu-rules.md`](devkit/menu-rules.md) | 业务开发者 | 方案菜单归组规则专题：单根模块、`web.route_prefix`、`category` 三值语义、admin 重写（手册 §13 展开版） |
| [`devkit/sql-builder-missing-capabilities-pr.md`](devkit/sql-builder-missing-capabilities-pr.md) | 框架贡献者（**仅本仓**） | 构造器能力缺口 PR 参考：7 项诉求的闭环记录 |
| [`devkit/framework-dev.md`](devkit/framework-dev.md) | 框架贡献者（**仅本仓**） | 改 `packages/runtime`、`packages/cli` 时的入口、红线、不变式索引、守卫测试索引 |
| [`devkit/module-dev-and-cdn-playground.md`](devkit/module-dev-and-cdn-playground.md) | 业务开发者 | 教学文档：开发态 vs 分发态、安装自己的模块会不会重复、本地 CDN 市场链路演练 |
| [`devkit/wecom-daikaifa.md`](devkit/wecom-daikaifa.md) | 业务开发者 / 部署运维 / 企业员工 | 企业微信代开发集成：凭据清单（八项 `vars`，Tier A/B/C + 可信域名/可信 IP）、首次开通顺序、用户 / 开发 / 部署三角色手册、与自建应用共存、错误文案速查 |
| [`devkit/wecom-internal-app.md`](devkit/wecom-internal-app.md) | 业务开发者 / 部署运维 / 企业管理员 / 企业员工 | 企业微信企业内部应用（自建）集成：五项 `wecom_corp_*` 凭据、回调只填通讯录同步一处、「验证并接入」四步自检、单企业私有化边界、共存配置、故障速查 |
| [`devkit/wecom-multi-corp-links.md`](devkit/wecom-multi-corp-links.md) | 平台运维 / 服务商运营 | 一套部署服务 N 家企业的**专属登录链接运维清单**（方案一，运维零代码改动）：逐企业接入、链接参数、验收打勾、故障速查、企微工作台内早跳透传修复 |
| [`devkit/wecom-customer-reauth-guide.md`](devkit/wecom-customer-reauth-guide.md) | 客户企业微信管理员（可直接转发） | 站点重新部署后的**重新授权与数据恢复操作单**：重新授权、组织架构同步、员工重新登录、角色权限重配、验收打勾 |
| [`devkit/oj-api-dev/api-manual.md`](devkit/oj-api-dev/api-manual.md) | 后端开发者 | 后端开发手册（14 章，oj 侧快照）：模块约定、全局对象 API、鉴权租户、测试、配置 |
| [`devkit/oj-api-dev/README.md`](devkit/oj-api-dev/README.md) | 后端开发者 | oj 侧索引 + v0.1.66→v0.1.82 逐版落地记录（查「某个能力哪版有的」） |

---

## PRD / 设计文档（活跃）

`docs/prd/` 与各顶层方案文档，记录功能的设计动机、方案与实现计划，是当前仍在参考的活跃资料。

| 文件 | 主题 |
|---|---|
| [`202609130035-provider-guide.md`](../202609130035-provider-guide.md) | Provider 上手指南（大白话版） |
| [`prd/framework-development-guide.md`](prd/framework-development-guide.md) | 框架开发手册：两个 npm 包（新人上手版） |
| [`prd/ojm-api-codegen-guide.md`](prd/ojm-api-codegen-guide.md) | ojm api 契约代码生成指南（新人向）— **⚠️ 旧口径（contract.ts），已过时** |
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
| [`prd/20261026-registry-cli-commands-design.md`](prd/20261026-registry-cli-commands-design.md) | registry 相关 CLI 命令全图（`keygen` / `sign` / `publish` / `registry sign` / `registry export` / `registry import` / `install` / `trust` / `view` / `list`）：判定顺序、十阶段状态机、信任边界，22 张 mermaid 图 |
| [`prd/oj-release-binary-defect-report.md`](prd/oj-release-binary-defect-report.md) | oj 发布二进制缺陷报告：release 产物在非构建机不可用 |

---

## 迁移指南 / Migration

存量工程的版本升级与口径切换方法，逐步 checklist + 丢失面说明。

| 文件 | 主题 |
|---|---|
| [`migration/contract-to-openapi-schema.md`](migration/contract-to-openapi-schema.md) | 旧 `contract.ts` / `defineApi` 工程 → 新 `openapi.json` + handler `.schema` 流水线的迁移方法论与检查清单 |
| [`migration/oj-requirement-response-outside-schema.md`](migration/oj-requirement-response-outside-schema.md) | 上游需求留档（✅ oj v0.1.72 已实现）：响应契约可声明在 `.schema` 之外（平级 `.response`），`.schema` 只承载入参 |
| [`migration/oj-requirement-delete-method-key.md`](migration/oj-requirement-delete-method-key.md) | 上游需求留档（✅ oj v0.1.73 已实现）：`oj openapi` 把 `del` 动词归一为 `delete` 操作键（旧版产出非法 `"del"` 致 `--check` 漂移） |
| [`migration/oj-requirement-mysql-two-step-id.md`](migration/oj-requirement-mysql-two-step-id.md) | 上游修复记录（✅ oj v0.1.120 已实现，`oj-bin@2550bd5`）：MySQL `returning(["id"])` 的 INSERT 与 `LAST_INSERT_ID()` 跨连接，返回值是别人的 id；含真库复现、根因坐标、两套修法、落地结果与回归用例 |
| [`migration/oj-requirement-seed-dialect.md`](migration/oj-requirement-seed-dialect.md) | 上游需求提案（待排期，2026-11-05）：seed 按运行时方言选文件 `seed.<dialect>.sql`（方言件胜出、通用件兜底不双跑）；含三方言实踩、代码坐标、行为契约、BDD 验收与分期 |
| [`guides/api-codegen-openapi.md`](guides/api-codegen-openapi.md) | 新口径总览：`.schema` 权威源 + `openapi.json` → `__client` 的日常用法与已知限制 |

---

## 归档（archive）

`docs/archive/` 收纳**历史方案与旧版文档**，仅供追溯，不再作为当前实现的依据：

- [`archive/prd/`](archive/prd/) — 各阶段的方案 / 计划 / 评审报告 / 交接文档（按日期命名）。
- [`archive/zh/guide/`](archive/zh/guide/) — 旧版中文开发指南（`introduction` / `fundamentals` / `advanced` / `other`）。
- [`archive/playground-e2e-verification.md`](archive/playground-e2e-verification.md)、[`archive/index.md`](archive/index.md) — 早期 playground 验证记录与旧索引。

> 新增文档时：活跃资料放进 `docs/prd/` 或顶层；一旦对应的功能稳定或方案被取代，移入 `docs/archive/` 对应子目录，并保持本索引更新。
