# 模块化改造需求文档

## 1. 背景与目标

### 1.1 现状

当前项目是一个单体架构的 React Antd Admin 管理后台，所有路由模块（home、access、system 等）通过 `import.meta.glob` 在编译时静态加载到主应用中。模块之间没有物理隔离，页面、组件、Store、翻译文件等都耦合在统一的 `src/` 目录下。

**核心痛点：**

- 所有模块在编译时确定，无法按需加载或动态增减
- 模块之间没有明确的边界，容易出现交叉依赖
- 新增业务模块需要修改主框架代码（路由注册、翻译文件等）
- 无法实现模块级别的独立开发、测试和部署

### 1.2 目标

将单体应用改造为**主框架 + 独立模块**的插件化架构：

- **主框架**：提供核心基础设施（路由、状态管理、布局、HTTP 客户端、i18n、认证鉴权等）
- **业务模块**：每个模块独立目录、独立编译、独立维护，通过标准化接口与主框架集成
- **动态加载**：主框架通过 `manifest.json` 配置启动时动态加载模块，运行时注册路由、注入资源
- **版本管理**：同一模块可存在多个版本，manifest 指定加载的版本，支持版本升级与回退

### 1.3 非目标

- 不改变现有的 UI/UX 交互和视觉风格
- 不改变现有的认证鉴权流程
- 不涉及后端 API 的改造

---

## 2. 架构概览

```
react-antd-admin/
├── src/                          # 主框架
│   ├── components/               # 共享组件
│   ├── layout/                   # 布局系统
│   ├── router/                   # 路由核心
│   ├── store/                    # 状态管理核心
│   ├── utils/                    # 工具库（HTTP 客户端等）
│   ├── locales/                  # i18n 核心 + 公共翻译
│   ├── hooks/                    # 共享 hooks
│   ├── plugins/                  # 插件（loading 等）
│   ├── module-loader/            # [新增] 模块加载器
│   └── ...
├── modules/                      # [新增] 业务模块目录
│   ├── home/                     # 首页模块
│   │   ├── entry.ts              # 模块入口
│   │   ├── pages/                # 模块页面
│   │   ├── locales/              # 模块翻译
│   │   └── package.json          # 模块元信息（含版本号）
│   ├── system/                   # 系统管理模块
│   ├── access/                   # 权限控制模块
│   ├── route-nest/               # 嵌套路由模块
│   ├── outside/                  # 外部链接模块
│   ├── exception/                # 异常页面模块
│   ├── personal-center/          # 个人中心模块
│   └── about/                    # 关于页面模块
├── scripts/                      # [新增] 构建脚本
│   └── build-modules.ts          # 统一的模块构建脚本
├── manifest.json                 # [新增] 模块清单配置
└── vite.config.ts                # 主框架构建配置（改造）
```

---

## 3. 模块接口设计

### 3.1 模块入口 `entry.ts`

每个模块必须提供一个 `entry.ts` 入口文件，导出标准化的模块配置：

```ts
// modules/<module-name>/entry.ts
import type { ModuleDefinition } from "#src/module-loader/types";

const mod: ModuleDefinition = {
 // 基础信息
 name: "system", // 模块唯一标识（kebab-case）
 description: "系统管理模块", // 模块描述
 version: "1.2.0", // 模块版本（语义化版本号）

 // 路由配置
 routes: [], // AppRouteRecordRaw[] — 模块路由定义

 // 生命周期钩子
 lifecycle: {
  beforeInit: async (ctx) => {}, // 模块初始化前（可进行依赖检查）
  onInit: async (ctx) => {}, // 模块初始化（注册 store、API 等）
  onActivate: async (ctx) => {}, // 模块被激活（路由首次匹配）
  onDeactivate: async (ctx) => {}, // 模块被停用
  onDestroy: async (ctx) => {}, // 模块卸载（清理资源）
 },

 // 国际化资源
 i18n: {
  "zh-CN": () => import("./locales/zh-CN"),
  "en-US": () => import("./locales/en-US"),
 },

 // 模块配置
 config: {
  requiredRoles: ["admin"], // 模块级别的角色要求
  requiredPermissions: [], // 模块级别的权限要求
  dependencies: [], // 依赖的其他模块 name
 },
};

export default mod;
```

### 3.2 TypeScript 类型定义

```ts
// src/module-loader/types.ts

import type { AppRouteRecordRaw } from "#src/router/types";

/** 模块上下文 — 主框架向模块注入的能力 */
export interface ModuleContext {
 /** 当前模块的元信息 */
 module: {
  name: string
  version: string
 }
 /** 共享库引用 */
 libs: {
  react: typeof import("react")
  reactDom: typeof import("react-dom")
  reactRouter: typeof import("react-router")
  antd: typeof import("antd")
  zustand: typeof import("zustand")
  i18next: typeof import("i18next")
  reactI18next: typeof import("react-i18next")
  dayjs: typeof import("dayjs")
  ky: typeof import("ky")
  // ... 其他共享库
 }
 /** 主框架工具 */
 utils: {
  request: typeof import("#src/utils/request")
  getAppNamespace: typeof import("#src/utils/get-app-namespace")
 }
 /** 模块注册器 */
 register: {
  /** 注册额外的 Zustand store */
  store: (name: string, store: unknown) => void
  /** 注册 API 路由前缀 */
  apiPrefix: (prefix: string) => void
 }
}

/** 模块配置 */
export interface ModuleConfig {
 /** 模块级别要求的角色，用户须满足其一才能激活此模块 */
 requiredRoles?: string[]
 /** 模块级别要求的权限码，用户须全部满足才能激活此模块 */
 requiredPermissions?: string[]
 /** 依赖的其他模块 name 列表，须在 beforeInit 之前完成加载 */
 dependencies?: string[]
}

/** 生命周期钩子 */
export interface ModuleLifecycle {
 beforeInit?: (ctx: ModuleContext) => Promise<void>
 onInit?: (ctx: ModuleContext) => Promise<void>
 onActivate?: (ctx: ModuleContext) => Promise<void>
 onDeactivate?: (ctx: ModuleContext) => Promise<void>
 onDestroy?: (ctx: ModuleContext) => Promise<void>
}

/** i18n 资源声明 */
export interface ModuleI18n {
 [locale: string]: () => Promise<Record<string, unknown>>
}

/** 模块定义 — entry.ts 的导出类型 */
export interface ModuleDefinition {
 name: string
 description: string
 version: string
 routes: AppRouteRecordRaw[]
 lifecycle?: ModuleLifecycle
 i18n?: ModuleI18n
 config?: ModuleConfig
}

/** 运行时模块实例 */
export interface ModuleInstance {
 definition: ModuleDefinition
 status: "pending" | "loading" | "loaded" | "active" | "error"
 error?: Error
}

/** manifest.json 中的模块条目 */
export interface ManifestModuleEntry {
 /** 模块名称，需与 entry.ts 中 name 一致 */
 name: string
 /** 模块版本，需与 entry.ts 中 version 一致。用于区分同模块的不同版本产物 */
 version: string
 /** 模块资源路径（本地相对路径或远程 URL） */
 entry: string
 /** 是否启用 */
 enabled?: boolean
}

/** manifest.json 格式 */
export interface Manifest {
 modules: ManifestModuleEntry[]
}
```

### 3.3 生命周期时序

```
应用启动
  │
  ▼
读取 manifest.json
  │
  ▼
并行加载所有 enabled 模块的 entry chunk
  │
  ▼
校验 entry.ts 中的 name + version 与 manifest 条目匹配
  │
  ▼
按依赖拓扑排序执行 beforeInit()
  │   ├── 检查 config.requiredRoles 是否与用户角色匹配
  │   ├── 检查 config.requiredPermissions 是否满足
  │   └── 检查 dependencies 是否已加载
  │   └── 不满足则标记模块为 error，跳过后续步骤
  │
  ▼
按序执行 onInit()
  │   └── 模块注册 store、API 前缀等
  │   └── 模块的 i18n 资源合并到 i18next
  │
  ▼
注册所有模块的路由到 router
  │   └── router.patchRoutes(ROOT_ROUTE_ID, allModuleRoutes)
  │
  ▼
AuthGuard 正常运行（权限校验复用现有逻辑）
  │
  ▼
用户导航到某模块路由时
  │   └── 触发该模块的 onActivate()
  │
  ▼
用户离开某模块路由时
  │   └── 触发该模块的 onDeactivate()
  │
  ▼
应用卸载 / 模块热更新
    └── 触发 onDestroy()
```

### 3.4 角色与权限数据结构

#### 3.4.1 模块级别权限（声明式）

在 `ModuleDefinition.config` 中声明模块的准入条件，由加载器在 `beforeInit` 阶段校验：

```ts
config: {
  // OR 关系：用户拥有任一角色即可激活模块
  requiredRoles: ["admin", "super-admin"],

  // AND 关系：用户须拥有全部权限码才能激活模块
  requiredPermissions: ["module:system:access"],

  // 依赖的其他模块（须已成功加载）
  dependencies: ["access"],
}
```

**校验时机**：模块加载器的 `beforeInit` 阶段，在获取到用户信息后、路由注册前。

**校验逻辑**：

- `requiredRoles`：`userRoles.some(role => requiredRoles.includes(role))`
- `requiredPermissions`：`requiredPermissions.every(perm => userPermissions.includes(perm))`
- 校验失败 → 标记模块 `status: "error"`，不注册其路由和菜单

#### 3.4.2 路由级别权限（RouteMeta.handle）

复用现有的 `RouteMeta` 接口，每个路由条目独立声明权限：

```ts
// 模块路由中的权限声明示例（system 模块）
const routes: AppRouteRecordRaw[] = [
 {
  path: "/system",
  Component: ContainerLayout,
  handle: {
   title: "系统管理",
   icon: "SettingOutlined",
   order: 100,
   // 路由级别：OR 关系，拥有任一角色可看到此菜单
   roles: ["admin"],
  },
  children: [
   {
    path: "/system/user",
    Component: User,
    handle: {
     title: "用户管理",
     roles: ["admin"],
     // 按钮级别：AND 关系，拥有全部权限码才能看到对应按钮
     permissions: [
      "permission:button:add",
      "permission:button:update",
      "permission:button:delete",
     ],
    },
   },
   {
    path: "/system/dept",
    Component: Dept,
    handle: {
     title: "部门管理",
     roles: ["admin"],
     permissions: ["permission:button:add"],
     keepAlive: false, // 不缓存此页面
    },
   },
  ],
 },
];
```

#### 3.4.3 完整数据流

```
用户登录
  │
  ▼
获取用户信息 → user.roles = ["admin"], user.permissions = ["permission:button:add", ...]
  │
  ▼
模块加载器校验 config.requiredRoles / config.requiredPermissions
  │   ├── system 模块：requiredRoles=["admin"] ✅ 匹配 → 继续加载
  │   └── report 模块：requiredRoles=["analyst"] ❌ 不匹配 → 跳过
  │
  ▼
注册通过校验的模块路由到 router
  │
  ▼
AuthGuard 逐条校验路由级别 handle.roles
  │   ├── /system → roles=["admin"] ✅ → 显示菜单
  │   └── /system/user → roles=["admin"], permissions=["permission:button:add", ...]
  │       └── 页面内通过 useAccess() 校验按钮权限
```

---

## 4. 模块目录结构

### 4.1 标准模块结构

```
modules/<module-name>/
├── entry.ts                  # 模块入口（必须）
├── pages/                    # 模块页面组件
│   ├── index.tsx             # 默认页面
│   └── <page-name>/
│       └── index.tsx         # 子页面
├── components/               # 模块私有组件（可选）
├── locales/                  # 模块翻译文件
│   ├── zh-CN.json            # 中文翻译
│   └── en-US.json            # 英文翻译
├── stores/                   # 模块私有 store（可选）
│   └── index.ts
├── api/                      # 模块 API 调用（可选）
│   └── index.ts
└── package.json              # 模块元信息（必须）
```

> 模块不需要独立的 `vite.config.ts`，统一由根目录构建脚本处理（见第 5 章）。

### 4.2 元信息管理（已废弃 package.json）

> **已废弃**：模块目录下不再创建 `package.json`（避免 IDE 将模块识别为独立项目）。

模块的 `name`、`description`、`version` 全部定义在 `entry.ts` 的 `ModuleDefinition` 中，构建脚本从 `entry.ts` 解析 name 和 version，无需额外文件。

### 4.3 模块对框架资源的引用

模块通过 `#src/` 前缀直接引用主框架资源（开发模式通过 Vite alias 解析，构建时 external 化）：

```ts
// 框架资源引用（通过 #src/ 前缀）
import { BasicContent } from "#src/components/basic-content";
import ContainerLayout from "#src/layout/container-layout";
import { useUserStore } from "#src/store/user";
import { useAccess } from "#src/hooks/use-access";
import { request } from "#src/utils/request";
import type { ModuleDefinition } from "#src/module-loader/types";

// 第三方库直接 import（运行时由主框架提供）
import { Button } from "antd";
import { useTranslation } from "react-i18next";

// 模块内部资源使用相对路径
const MyPage = lazy(() => import("./pages/my-page"));
```

> **类型引用**（`import type`）直接跨模块使用，编译后会被擦除。
>
> **构建时**：`#src/` 和 `#modules/` 均被 external 化，模块产物仅包含自身业务代码。

---

## 5. 构建系统设计

### 5.1 统一构建配置

所有模块共用一套 Vite library mode 配置，由根目录的构建脚本 `scripts/build-modules.ts` 统一驱动。模块目录中不需要 `vite.config.ts`。

构建脚本可以指定模块的名称，自动从 `modules/*/` 下寻找指定模块来构建

构建脚本扫描 `modules/*/` 目录，依次将每个模块编译为 ES module：

```ts
import type { UserConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
// scripts/build-modules.ts
import { build, defineConfig } from "vite";

// 所有由主框架提供的共享库，模块编译时 external 化
const SHARED_EXTERNALS: (string | RegExp)[] = [
 // React 全家桶
 "react",
 "react-dom",
 "react/jsx-runtime",
 /^react\//,
 // 路由
 "react-router",
 /^react-router\//,
 // Ant Design 全家桶
 "antd",
 /^antd\//,
 /^@ant-design\//,
 // 状态管理
 "zustand",
 /^zustand\//,
 // i18n
 "i18next",
 /^i18next\//,
 "react-i18next",
 /^react-i18next\//,
 // 工具库
 "ky",
 "dayjs",
 /^dayjs\//,
 "ahooks",
 /^ahooks\//,
 // CSS-in-JS
 "react-jss",
 /^react-jss\//,
 /^@ant-design\/cssinjs/,
 // 动画
 "motion",
 /^motion\//,
 // 图表
 "echarts",
 /^echarts\//,
 "echarts-for-react",
 // 其他
 "nprogress",
 "keepalive-for-react",
 "simplebar-react",
 "tailwind-merge",
 /^@dnd-kit\//,
];

function isExternal(id: string): boolean {
 return SHARED_EXTERNALS.some(pattern =>
  typeof pattern === "string" ? id === pattern || id.startsWith(`${pattern}/`) : pattern.test(id),
 );
}

// 产物输出结构: build/modules/<name>/<version>/entry.js
function getOutputDir(moduleName: string, version: string): string {
 return path.resolve("build", "modules", moduleName, version);
}

async function buildModule(moduleDir: string) {
 const pkgPath = path.join(moduleDir, "package.json");
 const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
 const moduleName = pkg.name.replace("@app/module-", "");
 const version = pkg.version;

 const entryPath = path.join(moduleDir, "entry.ts");
 if (!fs.existsSync(entryPath)) {
  console.warn(`[build-modules] Skip ${moduleName}: entry.ts not found`);
  return;
 }

 console.log(`[build-modules] Building ${moduleName}@${version}...`);

 await build({
  root: moduleDir,
  build: {
   lib: {
    entry: entryPath,
    formats: ["es"],
    fileName: () => "entry.js",
   },
   outDir: getOutputDir(moduleName, version),
   emptyOutDir: true,
   rollupOptions: {
    external: id => isExternal(id),
   },
  },
  resolve: {
   alias: {
    "#src": path.resolve("src"),
   },
  },
  plugins: [react()],
  // 不生成 sourcemap（可选）
  build: undefined, // 由上面的 build.lib 接管
 } as UserConfig);

 console.log(`[build-modules] ✓ ${moduleName}@${version} → build/modules/${moduleName}/${version}/`);
}

// 主流程：遍历 modules/* 目录
async function main() {
 const modulesDir = path.resolve("modules");
 const entries = fs.readdirSync(modulesDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => path.join(modulesDir, d.name));

 for (const moduleDir of entries) {
  await buildModule(moduleDir);
 }

 console.log("[build-modules] All modules built.");
}

main().catch(console.error);
```

### 5.2 产物目录结构

```
build/
├── index.html                              # 主框架 HTML
├── assets/                                 # 主框架资源
│   ├── react-xxxxx.js                      # 共享库 chunks
│   ├── antd-xxxxx.js
│   └── ...
└── modules/
    ├── home/
    │   └── 1.0.0/
    │       └── entry.js                    # home 模块 v1.0.0 产物
    ├── system/
    │   ├── 1.0.0/
    │   │   └── entry.js                    # system 模块 v1.0.0 产物（旧版本）
    │   └── 1.2.0/
    │       └── entry.js                    # system 模块 v1.2.0 产物（当前版本）
    └── ...
```

**版本共存**：同一模块的不同版本产物并存于不同子目录中，`manifest.json` 指定实际加载的版本。

### 5.3 共享库清单

以下库由主框架提供，模块编译时作为 `external` 处理：

| 分类 | 包名 | 说明 |
|------|------|------|
| 核心 | `react`, `react-dom`, `react/jsx-runtime` | React 核心 |
| 路由 | `react-router`, `react-router/*` | 路由库 |
| UI | `antd`, `antd/*`, `@ant-design/*` | Ant Design 全家桶 |
| 状态 | `zustand`, `zustand/*` | 状态管理 |
| i18n | `i18next`, `react-i18next` | 国际化 |
| HTTP | `ky` | HTTP 客户端 |
| 日期 | `dayjs`, `dayjs/*` | 日期处理 |
| 工具 | `ahooks`, `ahooks/*` | Hooks 工具 |
| 样式 | `react-jss`, `@ant-design/cssinjs` | CSS-in-JS |
| 动画 | `motion`, `motion/*` | 动画库 |
| 图表 | `echarts`, `echarts/*`, `echarts-for-react` | 图表 |
| 其他 | `nprogress`, `keepalive-for-react`, `simplebar-react`, `tailwind-merge`, `@dnd-kit/*` | 辅助库 |

### 5.4 运行时共享机制

使用 **Import Maps**（浏览器原生 API）将模块中 `external` 的裸模块标识符映射到主框架的共享模块 chunk：

```html
<!-- 主框架 HTML 中注入的 import map -->
<script type="importmap">
{
  "imports": {
    "react": "/assets/react-Dxxxxxxxx.js",
    "react-dom": "/assets/react-dom-Dxxxxxxxx.js",
    "react-router": "/assets/react-router-Dxxxxxxxx.js",
    "antd": "/assets/antd-Dxxxxxxxx.js",
    "@ant-design/icons": "/assets/icons-Dxxxxxxxx.js",
    "zustand": "/assets/zustand-Dxxxxxxxx.js",
    "i18next": "/assets/i18next-Dxxxxxxxx.js",
    "react-i18next": "/assets/react-i18next-Dxxxxxxxx.js",
    "dayjs": "/assets/dayjs-Dxxxxxxxx.js",
    "ky": "/assets/ky-Dxxxxxxxx.js"
    // ... 其他共享库
  }
}
</script>
```

主框架构建时自动生成此 import map，确保所有模块在运行时共享同一份库实例（单例保证）。

### 5.5 主框架构建改造

主框架的 `vite.config.ts` 需要改造：

1. **构建时**：将共享库通过 `manualChunks` 独立输出为单独的 ES module chunk
2. **生成 import map**：构建后自动生成 import map 文件
3. **HTML 注入**：在 `index.html` 中注入 import map script 标签
4. **manifest 集成**：构建时将 `manifest.json` 中的模块路径注入到应用代码中

### 5.6 构建命令

在 `package.json` 中新增脚本：

```json
{
 "scripts": {
  "build": "vite build && tsx scripts/build-modules.ts",
  "build:framework": "vite build",
  "build:modules": "tsx scripts/build-modules.ts",
  "build:module": "tsx scripts/build-modules.ts --module=<name>"
 }
}
```

- `pnpm build`：先构建主框架，再构建所有模块
- `pnpm build:module --module=system`：只构建单个模块（开发调试用）

---

## 6. manifest.json 格式

### 6.1 格式定义

```json
{
 "modules": [
  {
   "name": "home",
   "version": "1.0.0",
   "entry": "/modules/home/1.0.0/entry.js",
   "enabled": true
  },
  {
   "name": "system",
   "version": "1.2.0",
   "entry": "/modules/system/1.2.0/entry.js",
   "enabled": true
  },
  {
   "name": "access",
   "version": "1.0.0",
   "entry": "/modules/access/1.0.0/entry.js",
   "enabled": true
  },
  {
   "name": "route-nest",
   "version": "1.0.0",
   "entry": "/modules/route-nest/1.0.0/entry.js",
   "enabled": true
  },
  {
   "name": "outside",
   "version": "1.0.0",
   "entry": "/modules/outside/1.0.0/entry.js",
   "enabled": true
  },
  {
   "name": "exception",
   "version": "1.0.0",
   "entry": "/modules/exception/1.0.0/entry.js",
   "enabled": true
  },
  {
   "name": "personal-center",
   "version": "1.0.0",
   "entry": "/modules/personal-center/1.0.0/entry.js",
   "enabled": true
  },
  {
   "name": "about",
   "version": "1.0.0",
   "entry": "/modules/about/1.0.0/entry.js",
   "enabled": true
  },
  {
   "name": "report",
   "version": "2.1.0",
   "entry": "https://cdn.example.com/modules/report/2.1.0/entry.js",
   "enabled": false
  }
 ]
}
```

### 6.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 模块唯一标识，kebab-case 格式 |
| `version` | `string` | 是 | 模块版本号（语义化版本），需与 `entry.ts` 和 `package.json` 中的 version 一致 |
| `entry` | `string` | 是 | 模块入口文件路径，支持本地相对路径和远程 URL |
| `enabled` | `boolean` | 否 | 是否启用，默认 `true` |

### 6.3 路径解析规则

- 以 `/` 开头的路径：相对于主框架部署根目录
- 以 `./` 开头的路径：相对于 manifest.json 文件位置
- 以 `http://` 或 `https://` 开头的路径：远程模块 URL
- 其他：视为 npm 包名，从 node_modules 解析（开发模式）

### 6.4 版本管理策略

**产物目录包含版本号**：构建产物按 `{module}/{version}/entry.js` 组织，同一模块的不同版本可同时存在。

**版本切换**：修改 `manifest.json` 中的 `version` 和 `entry` 字段即可切换版本，无需重新构建主框架。

```json
// 从 v1.0.0 升级到 v1.2.0
{
  "name": "system",
  "version": "1.2.0",
  "entry": "/modules/system/1.2.0/entry.js",
  "enabled": true
}

// 回退到 v1.0.0
{
  "name": "system",
  "version": "1.0.0",
  "entry": "/modules/system/1.0.0/entry.js",
  "enabled": true
}
```

**版本校验**：模块加载器在加载 entry chunk 后，校验 `entry.ts` 导出的 `version` 与 manifest 声明是否一致。不匹配时输出警告并拒绝加载：

```ts
// 模块加载器中的版本校验
if (mod.version !== manifestEntry.version) {
 console.error(
  `[module-loader] Version mismatch for "${mod.name}": `
  + `manifest=${manifestEntry.version}, module=${mod.version}`
 );
 return null;
}
```

---

## 7. 模块加载器设计

### 7.1 加载流程

```
1. 读取 manifest.json
2. 过滤 enabled 的模块
3. 并行加载模块 entry chunk（动态 import）
4. 校验 name + version 与 manifest 匹配
5. 解析模块依赖图（config.dependencies），拓扑排序
6. 按拓扑序依次执行：
   a. beforeInit(ctx)  — 校验 requiredRoles / requiredPermissions / dependencies
   b. onInit(ctx)      — 模块初始化（注册 store、合并 i18n）
   c. 收集 routes
7. 批量注册所有模块路由到 router
8. 通知 AuthGuard 路由已就绪
```

### 7.2 模块加载器接口

```ts
// src/module-loader/index.ts

export interface ModuleLoader {
 /** 加载所有 manifest 中启用的模块 */
 loadAll: (manifest: Manifest) => Promise<ModuleInstance[]>

 /** 加载单个模块（指定 name + version） */
 load: (name: string, version: string) => Promise<ModuleInstance>

 /** 卸载指定模块 */
 unload: (name: string) => Promise<void>

 /** 获取已加载的模块 */
 getModules: () => ModuleInstance[]

 /** 获取指定模块 */
 getModule: (name: string) => ModuleInstance | undefined

 /** 获取所有模块的路由（合并后） */
 getRoutes: () => AppRouteRecordRaw[]
}
```

### 7.3 模块 chunk 加载方式

**本地模块**：使用动态 `import()` 加载。

```ts
const module = await import(/* @vite-ignore */ manifestEntry.entry);
```

**远程模块**：通过 `import()` 加载，import map 确保裸模块标识符能正确解析。

```ts
const module = await import(/* @vite-ignore */ remoteUrl);
```

### 7.4 版本相关的加载逻辑

```ts
// 加载模块时校验版本
async function loadModule(entry: ManifestModuleEntry): Promise<ModuleDefinition | null> {
 const modImport = await import(/* @vite-ignore */ entry.entry);
 const mod: ModuleDefinition = modImport.default;

 // 版本校验
 if (mod.version !== entry.version) {
  console.error(
   `[module-loader] Version mismatch: manifest=${entry.version}, actual=${mod.version}`
  );
  return null;
 }

 // 名称校验
 if (mod.name !== entry.name) {
  console.error(
   `[module-loader] Name mismatch: manifest=${entry.name}, actual=${mod.name}`
  );
  return null;
 }

 return mod;
}
```

---

## 8. 与现有架构的集成

### 8.1 路由系统集成

**现有流程（保留不变）：**

```
coreRoutes + externalRoutes → baseRoutes → AuthGuard → fetchUserInfo → setAccessStore → router.patchRoutes()
```

**新增模块路由注入点：**

```
模块加载器完成加载 → 收集所有模块 routes → 注入到 accessStore.setAccessStore()
```

具体改造：

- `src/router/routes/index.ts`：已移除 `import.meta.glob("./modules/**/*.ts")`，模块路由由加载器提供
- `AuthGuard`：在 `fetchUserInfoAndRoutes()` 中按以下顺序合并路由（模块路由优先于后端/前端路由，避免 `removeDuplicateRoutes` 保留后端路由的错误组件）：
  1. 模块路由（`loadAllModules` → `addRouteIdByPath(getModuleRoutes())`，设置 `id = path` 确保菜单展开状态正确）
  2. 过滤后端路由（`filterBackendRoutes` 移除已被模块覆盖的路径，避免组件解析失败和重复路由告警）
  3. 后端路由（`generateRoutesFromBackend`，仅剩模块未覆盖的路径）
  4. 前端路由（`generateRoutesByFrontend`）
- `accessStore.setAccessStore()`：复用现有逻辑不变
- `generate-routes-from-backend.ts`：`import.meta.glob` 已扩展为同时搜索 `/src/pages/` 和 `/modules/*/pages/`，确保后端路由也能正确解析已迁移到 modules 的页面组件

### 8.2 状态管理集成

- 模块可通过 `ctx.register.store()` 注册自己的 Zustand store
- 主框架提供 store 注册表，其他模块可通过名称访问
- 模块 store 不使用 `getAppNamespace()` 前缀，而是使用模块名作为命名空间

### 8.3 i18n 集成

- 模块 i18n 资源以模块名为命名空间注册到 i18next

```ts
// 模块加载器执行 i18n 合并（注意使用 resources.default）
for (const [locale, loader] of Object.entries(module.i18n)) {
 const resources = await loader();
 i18next.addResourceBundle(locale, module.name, resources.default || resources);
}
```

> **注意**：Vite 动态 `import()` JSON 返回 `{ default: {...} }`，必须使用 `resources.default` 获取实际内容，否则以数字开头的 key（如 `403SubTitle`）无法被 i18next 查找。

- 模块内翻译使用命名空间限定：`t("system:menu.user")`
- 主框架公共翻译保持全局命名空间：`t("common.view")`、`t("form.required")` 等
- 菜单翻译由模块自管理（`modules/<name>/locales/*.json` 的 `menu` key），不再使用框架的 `common.json`

### 8.4 认证鉴权集成

AuthGuard 逻辑保持不变，模块路由中的 `handle.roles`、`handle.permissions`、`handle.ignoreAccess` 仍然生效。

模块级别的角色/权限要求在 `config.requiredRoles` / `config.requiredPermissions` 中声明，加载器在 `beforeInit` 阶段检查（详见 3.4 节）。

### 8.5 布局系统集成

模块路由的 `Component` 统一使用主框架提供的 `ContainerLayout` 包裹，复用现有的 keepAlive、tabbar、sidebar 等功能。

---

## 9. 开发体验设计

### 9.1 主框架内统一开发（主要模式）

开发时模块源码放置在 `modules/<name>/` 目录下。主框架 dev server 通过 Vite 配置将模块目录加入模块解析：

```ts
// vite.config.ts (dev 模式)
export default defineConfig({
 resolve: {
  alias: {
   // 开发时直接解析模块源码，不走构建产物
   ...moduleAliases,
  },
 },
 server: {
  watch: {
   // 监听模块目录变化，实现 HMR
   ignored: ["!**/modules/**"],
  },
 },
});
```

开发时模块不走编译产物，而是通过 Vite 的模块热替换直接加载源码。模块修改后主框架自动热更新。

开发时 `manifest.json` 的 `entry` 指向模块源码（如 `/modules/home/entry.ts`），由 Vite dev server 直接提供。

### 9.2 模块独立开发（辅助模式）

每个模块目录是一个独立的 Vite 项目，可单独启动 dev server：

```bash
cd modules/system
pnpm dev    # 启动模块独立 dev server
```

独立开发时需要一个轻量的宿主应用（host），提供主框架的基础能力。方案：

1. 提供 `module-dev-host` 模板项目，内含主框架的最小运行时
2. 模块 dev server 代理到 host 的共享库端点
3. 或使用 Vite 的 `module-federation` 能力在 dev 时共享依赖

### 9.3 调试与日志

模块加载器在 dev 模式下输出详细日志：

```
[module-loader] Loading 8 modules from manifest...
[module-loader] ✓ home@1.0.0 loaded in 45ms
[module-loader] ✓ system@1.2.0 loaded in 82ms
[module-loader] ✗ report@2.1.0 failed: NetworkError
[module-loader] Registering 24 routes from 8 modules...
[module-loader] Merging i18n resources for 8 modules...
```

---

## 10. 模块拆分计划

### 10.1 拆分对应关系

| 序号 | 模块名 | 原路由文件 | 原页面目录 | 复杂度 |
|------|--------|-----------|-----------|--------|
| 1 | `home` | `routes/modules/home.ts` | `pages/home/` | 低 |
| 2 | `about` | `routes/modules/about.ts` | `pages/about/` | 低 |
| 3 | `personal-center` | `routes/modules/personal-center.ts` | `pages/personal-center/` | 低 |
| 4 | `route-nest` | `routes/modules/routeNest.ts` | `pages/route-nest/` | 低 |
| 5 | `outside` | `routes/modules/outside.ts` | `pages/outside/` | 低 |
| 6 | `exception` | `routes/modules/exception.ts` | `pages/exception/` | 中 |
| 7 | `access` | `routes/modules/access.ts` | `pages/access/` | 中 |
| 8 | `system` | `routes/modules/system.ts` | `pages/system/` | 高 |

### 10.2 迁移顺序与状态（由简到难）

1. ~~**Phase 1 — 基础设施**~~：✅ 已完成 — 模块加载器、类型定义、manifest.json、AuthGuard 集成、构建脚本
2. ~~**Phase 2 — 简单模块先行**~~：✅ 已完成 — 迁移 `about` → `home` → `route-nest` → `outside`
3. ~~**Phase 3 — 中等模块**~~：✅ 已完成 — 迁移 `personal-center` → `exception` → `access`
4. ~~**Phase 4 — 复杂模块**~~：✅ 已完成 — 迁移 `system`
5. **Phase 5 — 清理**：⏳ 待完成 — 移除旧代码、完善构建产物、import map 注入

### 10.3 每个 Phase 的验收标准

- **Phase 1**：✅ 模块加载器可运行，manifest.json 可被解析，空模块可加载，版本校验通过
- **Phase 2-4**：✅ 每个模块迁移后功能不变，包括：
  - 路由正确注册和导航
  - 菜单正确显示
  - 权限控制正常（模块级别 + 路由级别）
  - keepAlive 缓存正常
  - i18n 翻译正常（namespace 语法 `t("module:key")`）
  - HMR 热更新正常
- **Phase 5**：⏳ 所有旧代码清理完毕，`pnpm build` / `pnpm typecheck` / `pnpm lint` 全部通过

### 10.4 实施偏差记录

| PRD 计划 | 实际实现 | 原因 |
|----------|----------|------|
| 模块通过 `ModuleContext.libs` 访问框架库 | 模块通过 `#src/` 直接 import | 开发模式下 Vite alias 直接解析更简单，构建时 external 化效果一致 |
| Import Map 注入实现运行时共享 | 尚未实现，待 Phase 5 | 开发模式不需要 import map，构建产物暂由构建脚本处理 |
| `ctx.register.store()` 注册模块 store | 已实现但模块暂未使用 | 当前模块直接通过 `#src/store/` 引用框架 store |
| 后端路由生成仅搜索 `/src/pages/` | 扩展为同时搜索 `/modules/*/pages/` | 页面迁移到 modules 后需确保后端路由也能找到组件 |

### 10.5 已发现并修复的问题

| 编号 | 问题 | 根因 | 影响 |
|------|------|------|------|
| P1-1 | `typeof import("#src/utils/request")` 类型不匹配 | KyInstance vs request 导出类型 | 编译错误 |
| P1-2 | `#src/` alias 在模块目录下不生效 | 模块有自己的 package.json 但无 `#*` 映射 | dev 启动失败 |
| P3-3 | exception 模块 i18n namespace 语法错误 | 迁移遗漏 `t("exception.xxx")` → `t("exception:xxx")` | 菜单显示原始 key |
| P3-4 | exception 未注册到 manifest.json | 从 core 路由迁移，跳过了标准注册流程 | 模块无法加载 |
| P3-5 | 所有模块页面显示"未知组件" | 模块路由加载顺序在后端路由之后，`removeDuplicateRoutes` 保留了错误组件 | 全站页面不可用 |

---

## 11. 非功能性要求

### 11.1 性能

- 模块采用懒加载（路由级别 `lazy import`），不影响首屏加载时间
- 共享库单例保证，不会出现多个 React 实例
- manifest 解析和模块加载应在 1s 内完成（同源本地场景）

### 11.2 容错

- 单个模块加载失败不应阻塞整个应用
- 模块加载失败时在菜单中隐藏该模块，控制台输出错误信息
- 版本校验失败时拒绝加载，不影响其他模块
- 可选：在页面中显示"模块加载失败"的友好提示

### 11.3 安全

- 远程模块的 entry URL 需要在 manifest 白名单中（不允许动态注入）
- 模块只能通过 `ModuleContext` 访问主框架能力，不能直接修改全局状态
- 模块的 `beforeInit` 中进行依赖和权限的前置校验

### 11.4 类型安全

- `ModuleDefinition` 接口提供完整的 TypeScript 类型约束
- 模块开发时通过 `import type` 引用主框架类型
- 模块独立编译时，共享类型通过 npm peer dependency 或本地路径引用

---

## 12. 关键技术决策记录

| 决策 | 方案 | 原因 |
|------|------|------|
| 运行时模块共享 | Import Maps | 浏览器原生支持，无需额外框架，可精确映射裸模块标识符 |
| 模块构建方式 | 统一构建脚本 + Vite Library Mode (ES) | 消除模块间构建配置重复，维护一份 external 清单 |
| 模块版本管理 | 产物路径含版本号 + manifest 指定版本 | 同一模块多版本共存，切换版本只改 manifest，无需重新构建 |
| 模块加载方式 | 动态 `import()` | 浏览器原生支持，配合 import map 实现共享库单例 |
| 路由注册 | 复用 `router.patchRoutes()` | 现有架构已支持动态路由注入，改造量最小 |
| 权限模型 | 模块级 (config) + 路由级 (handle) 两层 | 模块级控制加载与否，路由级控制菜单可见性和按钮权限 |
| i18n 命名空间 | 模块名为 namespace | i18next 原生支持命名空间，避免翻译 key 冲突 |
| 远程模块加载 | 直接 `import(url)` | 依赖 import map 解析裸模块，避免手动拼接 URL |
| 开发模式 | 源码直连 + HMR | 避免开发时每次修改都重新编译模块 |
