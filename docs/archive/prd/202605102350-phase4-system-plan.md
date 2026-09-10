# Phase 4: system 模块迁移 — 执行计划

> 关联 PRD: `docs/prd/modular-refactoring.md`
> 分支: `feature/modular-phase4-system`
> 创建时间: 2026-05-10
> 完成时间: 2026-05-10

---

## 1. 目标

迁移最复杂的 system 模块（4 个 CRUD 子页面、权限控制、API mock）到 `modules/system/`。

---

## 2. 模块分析

- **页面**: user, role, menu, dept（含子组件 detail.tsx, constants.tsx, tree-menu.tsx）共 10 个文件
- **框架依赖**: `#src/api/system/*`, `#src/components/*`, `#src/hooks/use-access`, `#src/utils/*`, `#src/constants/*`
- **i18n**: system.json, 36 处 `t("system.xxx")` → `t("system:xxx")`
- **权限**: `roles: ["admin"]`, 按钮级 permissions, dept 的 `keepAlive: false`
- **模块 config**: `requiredRoles: ["admin"]` — 首次使用模块级权限声明

---

## 3. 任务清单

### Task 4.1: system 模块迁移
**状态**: ✅ 已完成

### Task 4.2: 验收
**状态**: ✅ 已完成

- [x] `pnpm typecheck` 通过
- [x] `pnpm lint` 通过（0 errors）
- [x] `src/router/routes/modules/` 已清空
- [x] `src/pages/` 仅剩 login, privacy-policy, terms-of-service

---

## 5. 总结

system 模块成功迁移，所有 8 个业务模块已完成从 `src/` 到 `modules/` 的迁移。

**关键过程**:
- entry.ts 中首次使用 `config.requiredRoles: ["admin"]` 模块级权限声明
- route handle.title 使用字符串 `"common.menu.system"` 而非 `$t()` 调用（与原路由一致）
- 36 处 i18n 引用批量替换
- 页面中大量框架依赖（API、组件、hooks）通过 `#src` alias 在 dev 模式下直接引用

**迁移完成后状态**:
- `src/router/routes/modules/` — 空（所有模块路由已移除）
- `src/pages/` — 仅剩 login, privacy-policy, terms-of-service
- `modules/` — 8 个独立模块目录（about, home, route-nest, outside, personal-center, exception, access, system）

---

## 6. 问题记录

| 编号 | 问题 | 分类 | 解决方案 |
|------|------|------|----------|
| P4-1 | menu/constants.tsx 有未使用的 `getBooleanOptions` import | 既有代码 | `eslint --fix` 自动移除 |
