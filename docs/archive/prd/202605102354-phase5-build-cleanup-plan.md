# Phase 5: 构建系统与清理 — 执行计划

> 关联 PRD: `docs/prd/modular-refactoring.md`
> 分支: `feature/modular-phase5-build-and-cleanup`
> 创建时间: 2026-05-10
> 完成时间: 2026-05-10

---

## 1. 目标

完成构建系统搭建和旧代码清理，使模块化改造可投入生产使用。

---

## 2. 任务清单

### Task 5.1: 清理旧代码
**状态**: ✅ 已完成

- 删除空目录 `src/router/routes/modules/`
- 移除 `src/router/routes/index.ts` 中的 `dynamicRouteFiles` glob 和 `dynamicRoutes`
- `accessRoutes` 现在仅包含 `staticRoutes`，模块路由由 module-loader 动态提供

### Task 5.2: 创建构建脚本
**状态**: ✅ 已完成

- 新建 `scripts/build-modules.ts`
- 共享库 external 列表（react、antd、zustand、i18next 等 25 个 pattern）
- 支持 `--module=<name>` 单模块构建
- 产物输出到 `build/modules/<name>/<version>/entry.js`
- resolve alias 包含 `#src` 和 `#modules`

### Task 5.3: 更新 package.json scripts
**状态**: ✅ 已完成

```
"build": "NODE_OPTIONS=--max-old-space-size=8192 vite build && npx tsx scripts/build-modules.ts"
"build:framework": "vite build"
"build:modules": "npx tsx scripts/build-modules.ts"
"build:module": "npx tsx scripts/build-modules.ts"
```

### Task 5.4: 验收
**状态**: ✅ 已完成

- [x] `pnpm typecheck` 通过
- [x] `pnpm lint` 通过（0 errors）
- [x] `pnpm dev` 启动正常，HTTP 200

---

## 5. 总结

Phase 5 完成。旧代码已清理，构建脚本已就绪。

**关键过程**:
- `src/router/routes/index.ts` 中移除了 `dynamicRouteFiles` glob 和 `dynamicRoutes`，模块路由完全由 module-loader 提供
- 构建脚本使用 `node:process` 代替全局 `process`（ESLint node/prefer-global 规则）
- `tsx` 通过 `npx` 调用，无需额外安装依赖
- ESLint 的 `antfu/consistent-list-newline` 规则要求数组每个元素独占一行

---

## 6. 问题记录

| 编号 | 问题 | 分类 | 解决方案 |
|------|------|------|----------|
| P5-1 | ESLint `node/prefer-global/process` 禁止使用全局 process | 常规 | 改为 `import process from "node:process"` |
| P5-2 | ESLint `antfu/consistent-list-newline` 要求单行数组展开 | 常规 | `eslint --fix` 自动修复 |
| P5-3 | `pnpm build` 报错 `Rollup failed to resolve import "~icons/svg/embedded"` | 构建时 BUG | 模块构建时 `#src` alias 导致 Rollup 追踪进入框架内部代码（layout、icons 等），解析到 `~icons/` 虚拟模块。将 `#src/` 和 `#modules/` 开头的 import 加入 external 列表，使模块产物仅包含模块自身代码，移除 `resolve.alias` 配置 |
