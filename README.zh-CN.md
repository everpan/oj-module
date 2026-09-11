<div align="center">
	<a href="https://github.com/condorheroblog/react-antd-admin/">
		<img alt="React-antd-admin Logo" width="192" src="https://github.com/user-attachments/assets/1de76309-4cf5-4e34-a32f-92c361bace2a">
	</a>
	<br />
	<h1>React Antd Admin</h1>
	<br />
</div>

![GitHub license](https://img.shields.io/github/license/condorheroblog/react-antd-admin?style=flat)
![GitHub stars](https://img.shields.io/github/stars/condorheroblog/react-antd-admin?color=fa6470&style=flat)
![GitHub forks](https://img.shields.io/github/forks/condorheroblog/react-antd-admin?style=flat)

**中文** | [English](./README.md)

## 介绍

react-antd-module 是基于 [`react-antd-admin`](https://github.com/condorheroblog/react-antd-admin/) 构建的模块化开发的中后台解决方案。它旨在帮助您快速搭建企业级中后台项目，适合多团队按领域模块进行开发。

## 特性

- 前沿技术栈：[React Hooks](https://react.dev/)、[TypeScript](https://www.typescriptlang.org/)、[Vite](https://vitejs.dev/)、[ant design](https://ant.design/index-cn/)、[React Router](https://reactrouter.com/)、[Tailwind CSS](https://tailwindcss.com/docs/installation)
- 符合直觉的状态管理库：[Zustand](https://zustand-demo.pmnd.rs/)
- 国际化：[I18n](https://react.i18next.com/)
- Fetch 请求：[Ky](https://github.com/sindresorhus/ky)、[@tanstack/react-query](https://tanstack.com/query/latest/docs/framework/react/overview)
- 代码格式化：[ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files-new/)
- 路由级别组件缓存：[keepalive-for-react](https://github.com/irychen/keepalive-for-react)
- API 模拟：[vite-plugin-fake-server](https://github.com/condorheroblog/vite-plugin-fake-server)
- **模块化架构**：业务页面以独立模块组织，可独立开发、独立发布
- 权限路由：支持前端静态路由和后端动态路由，提供路由/菜单/按钮三级权限控制
- 主题配置：内置多种主题配置，支持暗黑主题，统一了 antd 和 Tailwind CSS 的颜色体系
- 模块化加载，版本管理

## 模块化带来的核心特性

1. 运行时远程模块加载（业务与宿主解耦）
   宿主（shell）不再打包任何业务代码，仅负责"加载模块 + 渲染容器"。业务模块通过 defineModule 声明元数据、loadAll(manifest) 在运行时按需拉取 modules.json 中登记的
   /modules/<name>/<version>/entry.js。模块可独立开发、独立部署、独立版本，宿主与业务彻底解耦，互不阻塞发布节奏。

2. 共享依赖单例（importmap + 单例约束）
   `react` / `react-dom` / `antd` / `@ant-design/pro-components` / `runtime` 等共享依赖在构建期由 `generateImportmap()` 统一外置为 `importmap` 精确键，宿主与所有模块经同一份 ESM
   资产解析，保证整站单实例。从根本上杜绝"多份 React / 多份 antd"导致的 context 断裂、hook 失效、findDOMNode 警告等经典微前端坑。

3. 宿主与业务布局边界清晰（避免双层嵌套）
   宿主路由根只渲染 <Outlet/>，整站 chrome（侧边栏 / 顶栏 / 页签 / 菜单）全部由模块自带的 ContainerLayout 提供（host.tsx
   刻意不叠加宿主侧栏）。模块化后"框架只管容器、模块管一切展示"，不存在宿主侧栏 + 模块侧栏双重嵌套的混乱布局，主题/暗黑/导航模式亦由模块统一控制，与 App 链路同源。

4. 构建期依赖闭环 + 导出完整性门禁（白屏前移）
   autoGenerateSubpathAssets 用不动点迭代自动发现共享资产内部的深路径裸说明符（如 antd/es/modal、dayjs/locale/zh-cn），现场构建"从父包再导出"的子路径资产（本次 antd/es/*
   修复即此机制）。assertSharedExportsComplete 门禁在构建期拦截三类白屏根因：具名导出缺失、Failed to resolve module specifier、未垫片的动态
   require。把运行期白屏整体前移到构建期失败，CI 直接拦截。

5. 安全纵深（信任根 + L2 完整性 + CSP）
- 信任根：assertTrustedModules 对 modules.json 做来源白名单校验，再加载/预载/注入 CSS；
- L2 完整性：非 lazy chunk 预载携带构建期 sha384 integrity + modulepreload，浏览器加载前校验；
- CSP：importmap 与 <meta http-equiv="Content-Security-Policy"> 注入随机 nonce，每次构建轮换。
  模块化加载链路在"谁能被加载、加载是否被篡改、加载是否被注入"三层都受控。

6. 版本矩阵门禁与 peerRuntime 契约（防漂移）
   checkSharedVersions 比对宿主 versions.json 与模块的 peerRuntime，共享依赖版本漂移在 ojm build 阶段直接拒绝。模块与宿主以"版本契约"对齐，避免"宿主升了
   antd、模块还是旧 antd 单例"的隐性不兼容。

7. 异构认证后端适配（归一，模块零改动）
   请求层 request/index.ts 以白名单（isAnonymousApi / anonymousApiPrefix）区分匿名通道； 
   统一信封归一（oj 的 code/data/access_token snake_case → code/result/token
   camelCase），消费方（auth-guard、refresh、user store）零改动即可对接不同认证后端。模块还可登记自有认证 provider，框架回落内置 auth/login，认证能力与模块化体系解耦。

8. 类型驱动的模块契约（defineModule 强类型）
   模块入口通过 defineModule({ name, version, routes, config, lifecycle, apiPrefix }) 强类型声明，路由、i18n、生命周期、依赖在编译期即受约束。模块间不互相
   import，仅靠契约通信，天然支持"仓库级模块（/modules/*）与工程内模块（modules/src）同源 dogfooding"的开发模式。

9. 防御式、字符集无关的请求层（健壮性的解耦体现）
   本次修复新增的 setHeaderSafe 封装，把 Authorization / X-Lang 等非 Latin1 值自动百分号编码，使 ky
   设置请求头与字符集无关——模块传入任何语言/用户名都不会让请求拦截器崩溃。这类"框架层兜底、业务无感"的防御式设计，使模块开发者无需关心宿主运行环境的字符集/header 边界。

---

一句话概括：模块化改造后，项目形成了"宿主只做容器、模块自包含、共享依赖单例、构建期闭环校验、加载链路可信任可校验、认证可归一适配"的微前端架构——业务模块与框架、模块与模
块之间高度解耦，且把大量运行期白屏/安全/版本风险前移到了构建期与契约层。


## 模块化架构

业务页面以独立模块的形式组织在 `modules/` 目录下。每个模块自包含路由、页面、国际化资源和生命周期钩子。

```
modules/
├── home/              # 首页模块
│   ├── entry.ts       # 唯一真实来源：名称、版本、路由、国际化
│   ├── pages/         # 页面组件
│   └── locales/       # 国际化资源 (zh-CN.json, en-US.json)
├── system/            # 系统管理（用户、角色、菜单、部门）
├── access/            # 权限演示页面
├── about/             # 关于页面
└── ...
```

**核心优势：**

- **独立开发** — 模块与框架、模块与模块之间完全解耦
- **独立发布** — 每个模块可通过 `pnpm build:modules` 单独构建和发布
- **动态注册** — 通过 `manifest.json` 启用/禁用模块，无需修改代码
- **路由优先级** — 模块路由优先于后端动态路由，重复路径自动过滤
- **快速脚手架** — 运行 `pnpm create-module` 通过交互式向导生成新模块

## 手册 todo
