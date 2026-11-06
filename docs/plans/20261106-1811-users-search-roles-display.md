# 用户列表搜索 + 成员资格角色语言化分组显示 + 0.2.71 发版

- 日期：2026-11-06 18:11
- 分支：`feat/users-search-roles-display`（基于 `feat/ojm`）
- 需求来源：用户反馈两项新特性

## 需求

1. **用户管理 `/system/users`**：增加依据「昵称与 display」的搜索。
2. **`/system/users/:uid/roles` 成员资格**：角色显示为**语言名称（key）**形式（按当前语言解析 title_key / 内置角色 locale），且**按模块分组**。
3. **bump version**：lockstep 发版 0.2.70 → 0.2.71。

## 需求澄清与口径

- users 表与 `GET /system/users` 出参**无 nickname 列**（字段：username/display_name/email/position/employee_no/phone_number）。「昵称与 display」按 **username（账号）+ display_name（显示名/昵称）** 关键词匹配实现，大小写不敏感；纯前端过滤（与部门筛选同口径：名单一页全量）。
- 「语言名称（key）」复用角色页（roles/index.tsx R2）既有渲染先例：solution 角色 `t(title_key, { defaultValue: title })`；内置角色 `t('system:rolesPage.roleTitle.<name>', { defaultValue: title ?? name })`；custom 角色原样 title。该逻辑提升为共享纯函数 `roleLabel`，角色页与成员资格页同用（DRY）。
- 分组键 = 角色行已有的 `module` 字段；组标题显示模块名原文（不新增 locale）。

## 影响面

- `packages/cli/templates/src/app/web/system/pages/users/index.tsx` — 搜索框 + 过滤
- `packages/cli/templates/src/app/web/system/pages/users/match-keyword.ts` — **新增** 纯函数
- `packages/cli/templates/src/app/web/system/pages/roles/role-label.ts` — **新增** 纯函数
- `packages/cli/templates/src/app/web/system/pages/roles/index.tsx` — 改用 roleLabel
- `packages/cli/templates/src/app/web/system/pages/users/roles.tsx` — 按模块分组 + roleLabel
- `packages/cli/templates/src/app/web/system/locales/{zh-CN,en-US}.json` — `users.searchPlaceholder`
- `packages/cli/src/__tests__/users-roles-display.test.ts` — **新增** 单测（cli vitest 收 packages/cli 下 src/**/*.test.ts；templates 自身 vitest 只跑后端 spec）
- 发版：`packages/cli/package.json`、`packages/runtime/package.json` → 0.2.71；`packages/cli/vendor/host-versions.json` 3 处 runtime 版本；`pnpm --filter @oj-module/cli build:shell` 重建宿主（shell-dist/versions.json 新鲜度守卫）

## 任务清单（BDD）

### 特性 1：用户关键词搜索

- [x] **场景：关键词命中用户名** —— given 关键字 `zhang` when 过滤 then 命中 username 含 zhang 的行（数据表见测试）
- [x] **场景：关键词命中显示名** —— given 关键字 `张` when 过滤 then 命中 display_name 含 张 的行
- [x] **场景：大小写不敏感 / 空白关键字** —— `ZHANG` ≡ `zhang`；trim 后为空 → 全部可见
- [x] **场景：display_name 为 null** —— 不抛错、不匹配

### 特性 2：成员资格角色语言化 + 模块分组

- [x] **场景：title_key 解析** —— given title_key=`wiki:role.editor` when roleLabel then 返回 t(key) 的译文，缺译文回退 title
- [x] **场景：内置角色 locale 键** —— given builtin 且无 title_key when roleLabel then 查 `system:rolesPage.roleTitle.<name>`，缺键回退 title→name
- [x] **场景：custom 角色** —— given 非 builtin 无 title_key when roleLabel then 原样 title，title 空回退 name
- [x] **场景：按模块分组** —— given 混合 module 的角色列表 when 渲染 then 同 module 聚为一组、组标题为模块名

### 发版

- [x] 两包版本 0.2.71 + host-versions.json 同步 + build:shell 重建 + 相关测试全绿

## 问题记录

- 「昵称」字段不存在：users 表无 nickname 列，按 display_name 口径实现并在本文档钉住解释；若后续加列，扩展 matchUserKeyword 即可。

## 总结

全部完成（2026-11-06 18:11–18:16，约 5 分钟编码 + 3 分钟发版）：

1. **用户搜索**：`pages/users/match-keyword.ts` 纯函数（username + display_name，大小写不敏感，空白全可见）+ 用户页搜索框（zh「按用户名/显示名搜索」/ en 对应）；users 表无 nickname 列，「昵称/display」按 display_name 口径实现（见问题记录）。
2. **成员资格角色语言化分组**：`pages/roles/role-label.ts` 纯函数抽出角色页 R2 渲染口径（title_key → 内置 locale → title → name），角色页与成员资格页共用；成员资格页按 `module` 分组渲染（每组独立 Checkbox.Group，整集替换保存语义不变）。
3. **发版 0.2.71**：cli + runtime lockstep 升版，`vendor/host-versions.json` 3 处同步，`build:shell` 重建宿主（版本矩阵 68 项，runtime 三入口 0.2.71）。

关键过程：TDD 先落 15 个 BDD 用例再实现；`useMemo` 初次落在提前 return 之后（hooks 违规）已上移；eslint 修复把续行改出 mixed-spaces，拆变量消续行（与既往 eslint 续行坑一致）。验证：cli 测试 672 过 1 跳过、tsc 干净、eslint 干净。

提交：`feat(system): …`（35e62cbe 前序）+ `chore(release): 0.2.71`，已并入 feat/ojm。
