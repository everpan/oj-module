# Phase 3: 中等模块迁移 — 执行计划

> 关联 PRD: `docs/prd/modular-refactoring.md`
> 分支: `feature/modular-phase3-medium-modules`
> 创建时间: 2026-05-10
> 完成时间: 2026-05-10

---

## 1. 目标

迁移 3 个中等复杂度模块（personal-center、exception、access）到 `modules/` 独立目录。

---

## 2. 模块分析

### personal-center
- 2 个页面（my-profile, settings）
- `useUserStore` 直接依赖框架 store
- `@ant-design/pro-components` 依赖
- 有 i18n 文件（personal-center.json）— 页面中未实际使用

### exception
- **特殊**: 从 core 路由迁移到模块
- 4 个页面（403, 404, 500, unknown-component）
- fallback.ts 引用 404 页面，需更新路径为 `#modules/exception/pages/404`
- `generate-routes-from-backend.ts` 引用 unknown-component 页面，同样需更新

### access
- 5 个页面（access-mode, admin-visible, button-control, common-visible, page-control）
- 大量框架依赖（store/hooks/components），dev 模式下通过 `#src` alias 生效
- 34 处 i18n 引用，替换 `t("access.xxx")` → `t("access:xxx")`
- 有 i18n 文件（access.json）

---

## 3. 任务清单

### Task 3.1: personal-center 模块迁移
**状态**: ✅ 已完成

### Task 3.2: exception 模块迁移
**状态**: ✅ 已完成

**关键修改**:
- 从 `src/router/routes/core/index.ts` 移除 exception 路由引用
- 更新 `fallback.ts`: `#src/pages/exception/404` → `#modules/exception/pages/404`
- 更新 `generate-routes-from-backend.ts`: unknown-component 路径 + 移除 glob 排除规则

### Task 3.3: access 模块迁移
**状态**: ✅ 已完成

### Task 3.4: 验收
**状态**: ✅ 已完成

- [x] `pnpm typecheck` 通过
- [x] `pnpm lint` 通过（0 errors, 3 warnings 均为既有代码）
- [x] `pnpm dev` 启动正常，HTTP 200
- [x] 仅剩 `system.ts` 在 `src/router/routes/modules/`

---

## 5. 总结

3 个中等模块成功迁移。exception 模块从 core 路由迁移是本次最复杂的操作，需要更新 3 个额外引用点（core/index.ts、fallback.ts、generate-routes-from-backend.ts）。

**关键过程**:
- exception 的 fallback 和 backend route generator 都引用了 exception 页面，迁移时需同步更新为 `#modules/` 路径
- `#modules/` 路径通过 package.json `imports` 的 `"#*": "./*"` 规则解析，无需额外 Vite 配置
- access 模块页面有大量框架 store/hooks 依赖，dev 模式下通过 `#src` alias 直接引用，不影响功能
- personal-center 的 i18n 文件存在但页面未实际使用，仍作为模块资源迁移

---

## 6. 问题记录

| 编号 | 问题 | 分类 | 解决方案 |
|------|------|------|----------|
| P3-1 | exception 页面被 fallback.ts 和 generate-routes-from-backend.ts 引用 | 非预期依赖 | 更新引用路径为 `#modules/exception/pages/...` |
| P3-2 | `#modules/` 路径解析依赖 package.json `imports` 的 `#*` 规则 | 设计决策 | 利用已有机制，无需额外配置 |
| P3-3 | exception 模块迁移时遗漏 4 处 `t("exception.xxx")` → `t("exception:xxx")` 的 namespace 替换，导致菜单显示原始 i18n key | 迁移遗漏 BUG | Phase 3 迁移 exception 时未对页面文件执行 sed 替换。已修复并添加测试防护（`tests/module-i18n-consistency.test.ts`） |
| P3-4 | exception 模块未注册到 `manifest.json`，导致模块加载器无法加载 | 迁移遗漏 BUG | exception 从 core 路由迁移而非 `src/router/routes/modules/`，导致 manifest 注册被遗漏。已补充注册条目 |
| P3-5 | 页面迁移到 `modules/` 后，后端路由生成器 `generate-routes-from-backend.ts` 仍在 `/src/pages/` 查找组件，找不到则回退到 `ExceptionUnknownComponent`；且后端路由先于模块路由 push，`removeDuplicateRoutes` 保留了错误的后端路由版本 | 架构缺陷 BUG | 两处修复：(1) 模块路由加载移至后端/前端路由生成之前，确保 `removeDuplicateRoutes` 保留模块路由（含正确组件）；(2) `generate-routes-from-backend.ts` 的 `import.meta.glob` 新增 `/modules/*/pages/**/*.tsx` 搜索范围，`getComponentPathByRoute` 增加 `modules/` 回退查找。测试防护：`tests/module-route-priority.test.ts` |
