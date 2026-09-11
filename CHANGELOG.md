# Changelog

本仓库为**双包 lockstep 发版**：`@oj-module/runtime`（浏览器面，含 `contract` 子路径）与 `@oj-module/cli`（Node 工具链面，含预构建宿主 `shell-dist`）**始终同版本号**一起发布。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。
设计依据、迁移记录与陷阱清单见 [`docs/prd/202609110947-oj-module-two-package-consolidation-design.md`](docs/prd/202609110947-oj-module-two-package-consolidation-design.md)。

## [0.1.8] - 2026-09-12

### Changed

- **模块工程布局硬切换 `modules/` → `web/`**：模块工程（`ojm init` 模板、playground）源码目录改为 `web/src` + `web/dist` 配对，配置文件 `modules.config.ts` 更名 `web.config.ts`；`layout.ts` 删除 legacy 分支，存量 `modules/` 工程会得到人话迁移报错。产物协议不变（`modules.json`、`dist/modules/<name>/<version>/` 照旧）。框架根仓平铺 `web/<name>/` 形态由 layout `flat` 分支支撑。设计见 [`docs/prd/202609112324-web-layout-and-codegen-guide-design.md`](docs/prd/202609112324-web-layout-and-codegen-guide-design.md)。
- **`ojm api` 生成目录 `api/` → `client/`**：生成物由 `web/src/<模块>/api/{client.ts,client.schemas.ts}` 调整为 `web/src/<模块>/client/{api.ts,api.schemas.ts}`，与后端顶层 `api/` 消歧；纯前端契约位置同步为 `web/src/<模块>/client/contract.ts`；runtime 内部 role client 同规迁移。契约发现、`--check` 对账与报错文案全部跟随。

### Added

- `api/.ojm-api-exempt.json` 新增 `_comment` 自说明字段（作用、`modules`/`paths` 配法、一层通配语义）。注意：豁免清单为严格 JSON，写 `//` 注释会解析失败并**静默回退空豁免**——说明文字一律走 `_comment`。
- 新增新人指南 [`docs/prd/ojm-api-codegen-guide.md`](docs/prd/ojm-api-codegen-guide.md)：契约 → evaluate → IR → 四产物 → stub → `--check` 三重对账 → 豁免清单全链路机制与排错速查。

## [0.1.7] - 2026-09-11

### Added

- `ojm init` 模板新增 **personal-center 模块**（前端 my-profile/settings 页 + 后端 `POST /api/personal-center/upload` 头像上传）——runtime 用户菜单固定导航 `/personal-center/my-profile`，此前脚手架工程点击必落空。配套：`users` 表新增 `avatar_base64` 列（`_platform` 迁移 0002）、`user-info` 改为 db 回读头像、模板 `env.d.ts` 补 `window.$message` 全局类型。设计见 [`docs/prd/202609112006-init-template-personal-center-design.md`](docs/prd/202609112006-init-template-personal-center-design.md)。
- 宿主版本矩阵（`versions.json`）收录 tooling 项 `typescript` / `@types/react`——`ojm init` 生成的 devDependencies 全部钉版，不再有 `*` 回退告警。

### Fixed

- **宿主链暗黑模式 footer 露白**：shell 宿主（`host.tsx`）误用 antd 原生 `App`，从未写入 `--oo-*` 主题变量（tailwind 语义色工具类的唯一来源）——亮色下透明≈白不可见，暗黑模式暴露。宿主改用 runtime 导出的 `AntdApp`（变量同步 + `window.$message/$modal/$notification` 静态函数一并补齐）。设计见 [`docs/prd/202609112121-shell-dark-css-vars-design.md`](docs/prd/202609112121-shell-dark-css-vars-design.md)。
- `ojm init` 生成 devDeps 缺 `@ant-design/pro-components`（personal-center 的 ProForm 类型来源），已补钉版。
- `apps/playground-oj`：`personal-center/upload` 回写不存在的 `users.avatar_base64` 列（上传必 500），补迁移与 `user-info` 回读。

### Changed

- `ojm vendor` / `ojm init`：oj 二进制下载源从 GitHub releases 切换为 **npm 包 `@oj-bin/oj`**（临时目录 `npm i` 后拷贝 `bin/` 进工程，零污染用户工程）。平台选择、完整性校验（npm dist.integrity）、registry 镜像均由 npm 承担；`GITHUB_TOKEN` 与代理指引随之退役。设计见 [`docs/prd/202609111926-vendor-npm-install-design.md`](docs/prd/202609111926-vendor-npm-install-design.md)。

## [0.1.6] - 2026-09-11

### Added

- `@oj-module/cli`：`exports` 的 Node-only 子路径（`.`、`./build`、`./shared-deps`、`./esm-exports`、`./config`、`./manifest`、`./info`）新增 `browser` 条件，指向 `src/browser-guard.ts`——浏览器打包误引用时**显式报错**，不再静默拖入 Node 依赖；`./shell-dist/*` 是浏览器资产，不受此条件影响。

### Changed

- `@oj-module/runtime`：发布包的 `imports` 收窄为仅 `#src/*`（原 `#modules/*` 已无引用、`#manifest.json` 指向包外 `../../manifest.json`）。仓库 App 链对 `#manifest.json` 的解析改由本仓 `vite.config.ts` 提供——该需求属于仓库自身，不进入对外发布的包。

### Fixed

- `ojm api --check`：被删除的 stub 不再被静默放过（`create` 视为生成物过期，与 client/routes/openapi 口径一致）。
- `ojm api --check`：CRLF 检出（Windows `core.autocrlf=true`）不再把未改动的 stub 误报为「待更新」（指纹哈希本就按 LF 归一，字节比较同步归一）。
- `ojm api --check`：oj 路由表的短方法名 `del` 归一为 `DELETE`，uni-dev 工程里的 DELETE 端点不再误报 `routes-js-drift`。

### Internal

- 新增 `release-manifest.test.ts`：真跑 `pnpm pack` 守卫两包**发布态**——无 `workspace:`/`catalog:` 协议字面量、0 个 sourcemap、cli 对 runtime 精确且 lockstep 依赖、runtime 包内无 `.ts` 源（US-7）。版本断言改读源 `package.json`，发版不再需要改测试。
- 新增旧 scope 零残留测试与 runtime `imports` 边界断言。

## [0.1.5] - 2026-09-11

**`@oj-module` scope 首个版本**（由 `@react-antd-module` 全线迁移而来）。

### Added

- 命令 `ojm`（原 `ram` 保留为**弃用别名**：向 stderr 打印更名警告后转发，下个 major 移除）。
- 旧名兼容读取，存量工程升级无需手改：`api/.ram-api-exempt.json`（双名读）、stub 指纹头 `// ram-api:stub`（双前缀读）、端点品牌 `Symbol.for("ram.api.def")`（IR 双符号）、环境变量 `RAM_DEBUG`（`OJM_DEBUG` 优先）。

### Changed

- **架构：4 包并为 2 包，按运行环境切分**
  - `contract` 并入 `@oj-module/runtime`，作为 `./contract` 与 `./contract/errors` 子路径（编成 `dist`）。
  - 预构建宿主并入 `@oj-module/cli`（源码 `packages/cli/shell/`，产物 `packages/cli/shell-dist/`，随 cli 发布）。
  - 依赖方向只剩 `cli → runtime` 一条边；`cli` 对 `runtime` 写 `workspace:*`，发布时由 pnpm 改写为**精确版本**。
- **品牌与命名**：`@react-antd-module/*` → `@oj-module/*`；内部前缀 `ram-*` → `ojm-*`（日志 `[ojm]`/`[ojm-api]`、临时文件/DOM 标记、dev SSE 端点 `/__ojm_reload`、自动生成的子路径资产名等）。
- 两包对齐为同一版本号（lockstep）。

### Deprecated

- 旧 scope 的四个包（`@react-antd-module/{contract,runtime,cli,shell}`）**所有版本已在 npm deprecated**，安装时会打印迁移指引。

## 历史（迁移前的四包时代）

`@react-antd-module/{contract,runtime,cli,shell}` 的 0.1.x 系列为迁移前的四包形态（`contract` 0.1.3 / `runtime` 0.1.4 / `shell` 0.1.4 / `cli` 0.1.5），对应提交与开发方式见 [`docs/prd/framework-development-guide.md`](docs/prd/framework-development-guide.md)。自 `@oj-module` 首发起沿用 `0.1.5` 版本号，并进入双包 lockstep。

[0.1.8]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.8
[0.1.7]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.7
[0.1.6]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.6
[0.1.5]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.5
