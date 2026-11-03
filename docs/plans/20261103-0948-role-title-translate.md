# 需求：solution 角色 title 落库时同步翻译（R1–R6）

日期：2026-11-03 09:48 · 分支：feat/role-title-translate · 版本：0.2.56 → 0.2.57

## 1. 背景与问题

- `installer.ts` `declOf()`（L297–301）把 manifest.yaml `roles[].title_key` **原样**写进 `title` 字段 → `upsertSolutionPerms` 落库 `sys_role.title = "pm:role.sales"`（裸 i18n key）。
- `sys_role.title` 的约定是可读文本（内置角色 seed 为中文）；solution 角色是唯一裸 key 来源。任何不走模块 locale 的消费方（其他模块 API、审计、导出）读到的角色名就是 `pm:role.sales`。
- `sys_permission` 已有 `title_key` 先例（只存 key，展示层 `t(title_key)` 实时翻译）；`sys_role` 无此列。

## 2. 需求（用户原文要点）

| # | 需求 |
|---|------|
| R1 | 注册时解析：落库前经模块 namespace 解析 title_key（`pm:role.sales` → 模块 pm 的 locale `role.sales`）；解析失败（缺文件/缺 key）回退存裸 key，**绝不失败安装** |
| R2 | 新增可空列 `sys_role.title_key`（对齐 sys_permission 先例）：title = 解析文本、title_key = 原文；迁移回填存量 solution 角色（title 命中 `^[a-z][\w-]*:` 形状） |
| R3 | 升级即重解析：安装器元数据覆盖（AC2-2）路径覆写 title = 新解析文本，title_key 同步刷新——模块 locale 改进随升级传播 |
| R4 | 语言取值 = 站点默认语言（站点设置，缺省 zh-CN）；单语落库是已知取舍，UI 多语言由 R2 title_key 承担 |
| R5 | 范围仅角色：sys_permission 不动（无 title 列） |
| R6 | code 全程不变：sys_role.name / sys_permission.code / 绑定关系不改 |

## 3. 现状勘察（关键事实）

1. **方案包里没有独立 locale JSON**：模块 locales 经 entry.ts 动态 `import("./locales/*.json")` 被 vite 内联进 JS chunk；`ojm bundle` 入包的是 `dist/web/modules/<name>`（构建产物），安装期读不到 `web/locales/zh-CN.json`。→ 需在 bundle 阶段把源码 `locales/{zh-CN,en-US}.json` 复制进包（bundle.ts 已有 `webSrcOf(layout, name)` + `checkLocales` 同源读取，增量极小）。
2. **staging 时序可行**：registering（stage #7）先于 deploying_web（#8），web 树整个 registering 段都还在 staging（`deployWebStage` 亦从 staging 读）→ 安装期可读 `<staging>/web/modules/<name>/locales/<lang>.json`。
3. **站点默认语言现状**：后端无 language 设置（语言是前端 preference，缺省 zh-CN，`preferences/index.ts:21`）→ 解析器查 `sys_setting key='site.language'`，无行回退 `zh-CN`（R4 的"站点设置，缺省 zh-CN"就位，未来加设置即自动生效）。
4. **schema/迁移惯例**：`schema.yaml`（sys_role L95–105，sys_permission 有 title_key L112）；迁移三方言 `.sql`(sqlite)/`.mysql.sql`/`.pg.sql`，最新序号 0017 → 新迁移 **0018__sys_role_title_key**。
5. **写库唯一出口**：`register.ts registerSolution` → `solution-perms.ts upsertSolutionPerms`（insert L45 / update L42 两处写 title）。测试夹具 `tests/fixture.ts` installDb()（真实迁移，node:sqlite 内存库，globalThis.db）。

## 4. 设计

### 4.1 bundle 侧（packages/cli/src/bundle.ts）

web 段入包时（cpSync ownWeb 之后）追加：源码 `webSrcOf(layout, name)/locales/{zh-CN,en-US}.json` 存在则复制到包内 `web/modules/<name>/locales/`。纯后端方案（无 web 段）不复制 → R1 回退兜住。

### 4.2 安装器侧（templates `installer.ts`）

- `declOf()` roles 映射补 `title_key`（此前丢弃）。
- 新增 `resolveDeclTitles(req, decl)`（exported，可测）：仅当 title 命中 key 形状 `^[a-z][\w-]*:` 才尝试；ns（冒号前段）`=== decl.module` 才查（跨 ns 不越界）；读 `<staging>/web/modules/<ns>/locales/<lang>.json` → JSON → dotted path 取值；**任何失败（无文件/坏 JSON/缺 key/非 string/空串）保留原 title，绝不抛错**（R1）。语言经 `siteLanguage()`。
- `registerStage` = `registerSolution(await resolveDeclTitles(req, declOf(req)))`。

### 4.3 落库出口（templates `solution-perms.ts`）

- `SolutionRoleDecl` 增 `title_key?: string`。
- insert（L45）与 update（L42）均写 `title`（解析文本）+ `title_key`（原文，`?? null`）。update 路径即 R3：每次安装 declOf 给 raw key → 重解析 → 元数据覆盖。

### 4.4 schema + 迁移

- `schema.yaml` sys_role 增 `title_key: {type: text}`。
- `0018__sys_role_title_key` 三方言：ADD COLUMN + 回填 `UPDATE sys_role SET title_key = title WHERE builtin = 0 AND <title 命中 key 形状>`（pg `~ '^[a-z][A-Za-z0-9_-]*:'`；mysql `REGEXP`；sqlite 无 REGEXP → `GLOB '[a-z]*:*'` 近似——实际数据里含冒号的 title 只可能是裸 key（内置中文/管理员文本不含冒号），头注释说明近似口径）。

### 4.5 范围外（明确不做）

- roles API / roles-page 不新增 title_key 出参（AC5 仅要求无回归；页面渲染 title = 解析文本即正确）。列已就位，UI 多语言消费属后续可选。
- sys_permission 完全不动（R5）。

## 5. BDD 用例（映射验收 1–5）

| 用例 | 验收 |
|------|------|
| 首装：decl(title="pm:role.sales") 经 resolveDeclTitles + registerSolution → 行 `(title=销售, title_key=pm:role.sales)` | AC1 |
| 升级：存量行 title=旧文本，重装新 locale 文本 → title/title_key 均覆写 | AC2 |
| 缺 key：staging locale 缺 `role.admin` → 解析保留裸 key，注册 ok:true | AC3 |
| 内置角色：builtin=1 行迁移后 title_key 仍 NULL；solution 行被回填 | AC4 |
| 迁移一致性：0018 ADD COLUMN ↔ schema.yaml 声明一致（0.2.56 先例守卫） | AC4 |
| resolver 单元：site.language 取值 / 缺省 zh-CN / ns 不匹配 / 坏 JSON / dotted 缺失 / 非 string | R1/R4 |
| bundle：方案包含 `web/modules/<name>/locales/zh-CN.json`（源码双语） | R1 前提 |
| roles-page 既有用例不回归（title 列渲染） | AC5 |

## 6. 任务

- [x] T1 计划文档（本文档）
- [x] T2 分支 feat/role-title-translate
- [x] T3 测试先行（TDD）：templates 侧 role-title spec（12 用例）+ cli 侧 bundle locales 用例（红→绿）
- [x] T4 实现：bundle.ts locales 入包 → installer.ts resolveDeclTitles/declOf → solution-perms.ts title_key 落库 → schema.yaml + 0018 三方言
- [x] T5 全量验证：templates BDD 1034/1034 · cli 604 通过 + 1 skip · eslint 0 问题 · tsc 0 错误
- [x] T6 版本 bump 0.2.57（双 package.json + build:shell 重建 + host-versions 同步 68 项）
- [x] T7 计划文档补状态与总结

## 8. 总结（本阶段关键过程与耗时）

总耗时 ~55 分钟（09:48 计划 → 10:04 收尾）。关键过程：

1. **勘察定案（~20min）**：确认方案包内**没有**独立 locale JSON（vite 把动态 import 的 JSON 内联进 JS chunk）→ R1 的"打包的 web/locales"需要 bundle 侧补齐：从源码树复制双语进包 `web/modules/<name>/locales/`（安装期 staging 在 registering 段仍存活，时序成立）。后端无站点语言设置 → `siteLanguage()` 查 `sys_setting site.language` 缺省 zh-CN（R4 就位，未来加设置自动生效）。
2. **TDD（~15min）**：两个测试文件先红后绿。自踩两坑：测试 decl 的顶层 permissions 传成对象数组（sqlite 绑定对象报错→ ok:false 假象）；AC3 用例误用 locale 里**存在**的 key（改 `pm:role.viewer`）。均为测试自身错误，实现一次通过。
3. **实现（~10min）**：6 个文件、净增 ~90 行。关键取舍：resolver 收敛在 steps/register.ts（DIP：readFile 面注入，单测零真实 FS）；roles API/页面不新增 title_key 出参（AC5 仅要求无回归，列已就位供后续 UI 消费）；sqlite 回填用 GLOB 近似正则（真实数据含冒号即裸 key，pg/mysql 完整正则钉死）。
4. **收尾（~10min）**：全量验证绿；`pnpm build:shell` 重建宿主（0.2.57 矩阵 68 项）→ sync-host-versions 同步 vendor 快照。

关键决策回顾：安装期解析（非打包期）守住 R4"站点默认语言"语义；跨 ns 不越界解析守住包边界（只读本包 locale）。

## 7. 风险

- sqlite GLOB 回填口径比正则宽（`[a-z]*:*`）：首个字符小写字母 + 含冒号即回填；对真实数据（裸 key/中文）无差。
- 若站点未来加 `site.language` 设置且非 zh-CN，已装角色的存量 title 不会自动重翻译（单语落库取舍，升级重装即刷新——R4 已声明）。
