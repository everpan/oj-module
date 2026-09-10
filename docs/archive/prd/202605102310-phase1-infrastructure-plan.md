# Phase 1: 基础设施搭建 — 执行计划

> 关联 PRD: `docs/prd/modular-refactoring.md`
> 分支: `feature/modular-phase1-infrastructure`
> 创建时间: 2026-05-10
> 完成时间: 2026-05-10

---

## 1. 目标

搭建模块化改造的基础设施层，使主框架具备加载、校验、初始化独立模块的能力。完成后，空模块可通过 manifest.json 被加载，生命周期钩子正确执行，现有功能不受影响。

---

## 2. 任务清单

### Task 1.1: 类型定义 `src/module-loader/types.ts`

**状态**: ✅ 已完成

**产出文件**: `src/module-loader/types.ts`

**类型清单**:
- `ModuleContext` — 框架注入能力（utils、register）
- `ModuleConfig` — 角色权限依赖声明
- `ModuleLifecycle` — 5 个生命周期钩子
- `ModuleI18n` — i18n 资源声明
- `ModuleDefinition` — entry.ts 导出类型
- `ModuleInstance` — 运行时模块实例（含 status）
- `ManifestModuleEntry` — manifest.json 模块条目
- `Manifest` — manifest.json 根结构

**依赖**: `src/router/types.ts` 中的 `AppRouteRecordRaw`

**备注**: `utils.request` 类型使用 `typeof import("#src/utils/request").request` 引用具体的 ky 实例类型，避免模块级类型不匹配。

---

### Task 1.2: 模块加载器 `src/module-loader/index.ts`

**状态**: ✅ 已完成

**产出文件**: `src/module-loader/index.ts`

**已实现接口**:
- `loadAll(manifest)` — 加载所有 enabled 模块，含并行加载、版本校验、拓扑排序、生命周期执行、i18n 合并
- `getModules()` / `getModule(name)` — 查询已加载模块
- `getRoutes()` — 收集所有非 error 模块的路由
- `getRegisteredStore(name)` / `getRegisteredApiPrefix(moduleName)` — 访问模块注册的资源

---

### Task 1.3: manifest.json 创建

**状态**: ✅ 已完成

**产出文件**: `manifest.json`

7 个模块条目，dev 模式下 entry 指向 `modules/<name>/entry.ts` 源码路径。

---

### Task 1.4: 集成到 AuthGuard

**状态**: ✅ 已完成

**修改文件**: `src/router/guard/auth-guard.tsx`

**集成位置**: `fetchUserInfoAndRoutes()` 中，前端路由生成后、`setAccessStore()` 前，用 try/catch 包裹模块加载，失败不影响现有流程。

---

### Task 1.5: 路由加载改造

**状态**: ✅ 已完成（无修改）

**决策**: Phase 1 保留 glob 加载（`import.meta.glob("./modules/**/*.ts")`）不变。模块加载器作为额外路径并行工作，不替换现有路由加载。Phase 5 清理时移除 glob。

---

### Task 1.6: i18n 改造准备

**状态**: ✅ 已完成（无修改）

**验证**: 模块加载器通过 `i18next.addResourceBundle(locale, moduleName, resources)` 注册模块 namespace，无需修改 `src/locales/index.ts`。

---

### Task 1.7: Vite 配置调整（dev 模式）

**状态**: ✅ 已完成（无修改）

**验证**: `#*` alias 通过 `package.json` 的 `imports` 字段解析，Vite 自动支持。`modules/` 在项目根目录下，dev server 默认可访问和转换 TS 文件。

---

### Task 1.8: 验收

**状态**: ✅ 已完成

**验收结果**:
- [x] `pnpm typecheck` 通过
- [x] `pnpm lint` 通过（新文件无错误）
- [x] `pnpm dev` 启动正常，HTTP 200，现有功能不受影响
- [x] 模块加载器类型正确，接口完整

---

## 3. 关键设计决策

| 决策 | 方案 | 原因 |
|------|------|------|
| 模块加载时机 | AuthGuard fetchUserInfoAndRoutes 中 | 复用现有权限流程，模块路由在用户信息获取后注册 |
| i18n namespace | 模块名作为 i18next namespace | i18next 原生支持，避免 key 冲突 |
| 路由加载过渡 | 保留 glob + 新增模块加载器 | 渐进式改造，降低风险 |
| dev 模式 entry | 指向源码 `.ts` 文件 | Vite dev server 直接处理，支持 HMR |
| ModuleContext.utils.request | 使用 `typeof import().request` | request 是 ky 实例而非整个模块 |

---

## 4. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 模块加载失败阻塞应用 | 单模块失败仅标记 error，不阻塞其他模块 |
| glob 与模块加载器路由重复 | Phase 1 先不启用模块加载器注入路由，仅搭建基础设施 |
| `handle.title` 中 `$t()` 时序 | 模块 entry 在 onInit 阶段 import，i18next 已初始化 |

---

## 5. 总结

Phase 1 基础设施搭建已完成。新增 3 个文件（`src/module-loader/types.ts`、`src/module-loader/index.ts`、`manifest.json`），修改 1 个文件（`src/router/guard/auth-guard.tsx`）。

**关键过程**:
- 类型定义中对 `utils.request` 的类型推导遇到 TSC 报错，原因是 `typeof import()` 推导为整个模块类型而非单个导出，修正为 `typeof import().request`
- ESLint 规则要求 interface 属性间不使用分号（`style/member-delimiter-style`），通过 `--fix` 自动修复
- `console.log` 不在 ESLint 允许列表中，改为 `console.warn`
- Vite 配置无需修改：`#*` alias 通过 Node.js subpath imports 机制解析，Vite 自动支持

**产出文件总览**:
| 文件 | 操作 |
|------|------|
| `src/module-loader/types.ts` | 新建 |
| `src/module-loader/index.ts` | 新建 |
| `manifest.json` | 新建 |
| `src/router/guard/auth-guard.tsx` | 修改（新增模块加载集成） |

---

## 6. 问题记录

| 编号 | 问题 | 分类 | 解决方案 |
|------|------|------|----------|
| P1-1 | `typeof import("#src/utils/request")` 类型与 KyInstance 不匹配 | 常规 | 改为 `typeof import("#src/utils/request").request` 引用具体导出 |
| P1-2 | `pnpm dev` 报错 `Failed to resolve import "#src/layout/container-layout" from "modules/system/entry.ts"` | 运行时 BUG | 模块目录下有独立 `package.json`，Vite 解析 `#src` 时查找最近的 `package.json` 的 `imports` 字段，模块目录下无 `#*` 映射。在 `vite.config.ts` 添加 `resolve.alias: { "#src": path.resolve("src"), "#modules": path.resolve("modules") }` 显式指定路径 |
