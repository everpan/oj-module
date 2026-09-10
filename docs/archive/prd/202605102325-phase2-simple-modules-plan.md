# Phase 2: 简单模块迁移 — 执行计划

> 关联 PRD: `docs/prd/modular-refactoring.md`
> 分支: `feature/modular-phase2-simple-modules`
> 创建时间: 2026-05-10
> 完成时间: 2026-05-10

---

## 1. 目标

将 4 个简单业务模块（about、home、route-nest、outside）从单体 `src/` 迁移到独立 `modules/` 目录。

---

## 2. 迁移策略

### i18n 处理

- 模块 i18n JSON 从 `src/locales/{lang}/{module}.json` 移到 `modules/{module}/locales/{lang}.json`
- JSON 内容保持不变（flat 结构），通过 `addResourceBundle(locale, moduleName, resources)` 注册为独立 namespace
- 页面组件中 `t("module.key")` → `t("module:key")`（namespace 语法）
- 公共翻译（`common.view` 等）保留在全局 `translation` namespace

### 路由处理

- 创建 `modules/{module}/entry.ts`，导出 `ModuleDefinition`
- 迁移后删除 `src/router/routes/modules/{module}.ts`
- 页面 `lazy(() => import("#src/pages/..."))` → `lazy(() => import("./pages/..."))`

---

## 3. 任务清单

### Task 2.1: about 模块迁移

**状态**: ✅ 已完成

- 迁移 2 个页面文件（index.tsx, constants.ts）
- 迁移 2 个 i18n 文件（zh-CN, en-US）
- 替换 10 处 `t("about.xxx")` → `t("about:xxx")`

---

### Task 2.2: home 模块迁移

**状态**: ✅ 已完成

- 迁移 5 个文件（index.tsx + 4 个 chart 组件）
- 迁移 2 个 i18n 文件
- 替换 35 处 `t("home.xxx")` → `t("home:xxx")`

---

### Task 2.3: route-nest 模块迁移

**状态**: ✅ 已完成

- 迁移 3 个页面文件（menu1-1, menu1-2, menu2）
- 无专属 i18n 文件，使用 `ParentLayout` 处理嵌套路由

---

### Task 2.4: outside 模块迁移

**状态**: ✅ 已完成

- 无独立页面目录，entry.ts 中直接使用 `Iframe` 组件和 `Outlet`
- 无专属 i18n 文件
- 引用自定义图标 `RiReactjsLine` 从 `#src/icons`

---

### Task 2.5: 验收

**状态**: ✅ 已完成

- [x] `pnpm typecheck` 通过
- [x] `pnpm lint` 通过（0 errors，2 warnings 均为既有代码）
- [x] `pnpm dev` 启动正常，HTTP 200
- [x] 4 个模块路由文件已从 `src/router/routes/modules/` 删除
- [x] 对应 `src/pages/` 目录已删除
- [x] 对应 `src/locales/` JSON 文件已删除

---

## 5. 总结

4 个简单模块（about、home、route-nest、outside）成功迁移到 `modules/` 独立目录。

**关键过程**:
- i18n namespace 迁移策略验证通过：`t("module:key")` 语法正确工作
- `route-nest` 和 `outside` 无专属 i18n 文件，entry.ts 不声明 `i18n` 字段
- `outside` 模块无页面目录，路由中直接使用 `Iframe` 组件引用 `#src/components/iframe`
- `package.json` 的 `jsonc/sort-keys` 规则要求 `type` 在 `version` 之前，通过 `--fix` 修复

**新增文件** (16 个):
| 模块 | entry.ts | pages/ | locales/ | package.json |
|------|----------|--------|----------|-------------|
| about | 1 | 2 | 2 | 1 |
| home | 1 | 5 | 2 | 1 |
| route-nest | 1 | 3 | 0 | 1 |
| outside | 1 | 0 | 0 | 1 |

**删除文件** (10 个):
- `src/router/routes/modules/` 下 4 个路由文件
- `src/pages/` 下 3 个目录（about, home, route-nest）
- `src/locales/` 下 4 个 i18n JSON 文件

---

## 6. 问题记录

| 编号 | 问题 | 分类 | 解决方案 |
|------|------|------|----------|
| P2-1 | `jsonc/sort-keys` 要求 `type` 在 `version` 前 | 常规 | `npx eslint --fix` 自动修复 |
| P2-2 | `outside` 模块引用 `#src/icons` 自定义图标 | 设计决策 | 保持直接引用，dev 模式下 alias 生效 |
