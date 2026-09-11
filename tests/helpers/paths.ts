import path from "node:path";

/**
 * 测试共用的路径常量。
 *
 * 框架源码位置在 P0 从 `src/` 迁到 `packages/runtime/src/`，
 * 后续 Phase 仍可能调整目录结构，测试一律通过此文件引用，避免硬编码散落各处。
 */
export const PROJECT_ROOT = path.resolve(__dirname, "../..");

/** 框架源码目录 */
export const RUNTIME_DIR = path.join(PROJECT_ROOT, "packages/runtime/src");

/** 预构建宿主产物目录（P1 起宿主并入 cli，产物在其 shell-dist/） */
export const SHELL_DIST_DIR = path.join(PROJECT_ROOT, "packages/cli/shell-dist");

/** 预构建宿主源码目录（构建脚本 + host.tsx 等） */
export const SHELL_SRC_DIR = path.join(PROJECT_ROOT, "packages/cli/shell");

/** 模块目录 */
export const MODULES_DIR = path.join(PROJECT_ROOT, "modules");

/** 模块清单 */
export const MANIFEST_PATH = path.join(PROJECT_ROOT, "manifest.json");

/** 模拟外部工程（playground）目录 */
export const PLAYGROUND_DIR = path.join(PROJECT_ROOT, "apps/playground");

/** playground 构建产物目录（D11 新布局：modules/dist） */
export const PLAYGROUND_DIST_DIR = path.join(PLAYGROUND_DIR, "modules", "dist");
