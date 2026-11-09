# 新人上路线：从空目录到第一个方案包

> **定位**： onboarding 主路径——**搭建脚手架 → 创建模块 → 模块自包含 → 编译 → 发布 → 升级**。
> 本文只讲「做什么、按什么顺序、在哪一步会踩什么」；细节按章号去同目录手册查：
> 工程与红线 → `manual.md`（14 章）；发布一条链 → `publish-walkthrough.md`（照做版）；
> 后端 handler 写法 → `.claude/skills/oj-api-dev/`；症状排错 → `SKILL.md`「常见陷阱速查」。
> 本文与这些文件随 `ojm init` 一起分发，**自包含**，不依赖任何仓库外文档。

## 0. 心智模型（先花十分钟，后面全是细节）

- **两个框架包**：`@oj-module/cli`（Node 工具链：`init/dev/build/api/bundle/new/publish`…）+
  `@oj-module/runtime`（浏览器运行时：路由/布局/store/请求）。**版本必须严格相等**——
  `ojm info` 的版本矩阵第一件事就是核对它，不等直接被门禁拒。
- **模块 = 一个目录**：前端侧 `src/<name>/web/`（`entry.ts` 必备），后端侧 `src/<name>/api/`，
  可只存在一侧。`entry.ts` 是模块元数据（name/version/routes/i18n/lifecycle）**唯一来源**，
  没有单独的 `package.json` / `meta.json`。
- **脚手架内置两个特殊模块**：`src/app`（框架页面：/home /login /system…）与 `src/oj-market`
  （方案市场编排面）。它们**上游自治**——本地改动会让 `ojm build` fail-fast（见 §4 末）。
- **运行态是双进程**：`pnpm dev` = 前端 devServer（默认 **5174**）+ oj 后端（默认 **9778**，
  端口以工程根 `config.yaml` 为准）。登录 `superadmin / aA123456`。
- **契约单向生成**：handler 动词挂 `.schema`（入参）+ 平级 `.response`（出参）→
  `oj openapi` 汇总成 `openapi.json` → `ojm api` 生成前端 `__client`。**不手写 client、
  不改生成物**。

## 1. 搭建脚手架

前置：Node 18+、pnpm、网络（首次下载 oj 二进制与 npm 包）。

```bash
pnpm dlx @oj-module/cli@latest init my-app --yes
cd my-app && pnpm install
pnpm dev        # 前端 5174 + 后端 9778；浏览器开 5174，登录 superadmin / aA123456
```

`--yes` 落位的关键产物（逐项 `ls` 确认）：

| 路径 | 是什么 |
|---|---|
| `src/app/` | 内置框架模块（web 六根 + api 六模块）：**不要改**，见 §4 门禁 |
| `src/oj-market/` | 方案市场编排面（api 内置 + web 仅生成物）：同上不要改 |
| `config.yaml` | 站点配置（端口/mounts/租户/授权） |
| `openapi.json` + `src/app/web/**/__client/` | 契约唯一事实源与预生成 client（`ojm api --check` 开箱即过） |
| `cdn/` | 随站 bundle（已签名的 oj-market 方案包三件套 + `bundles.json`）——出厂即装的来源 |
| `bin/oj` + `bin/devkit/` | oj 二进制与其 devkit（版本受 cli 门禁约束，`ojm vendor` 管理） |
| `.claude/skills/ojm-module-dev/` + `oj-api-dev/` | 两份 devkit skill（本目录的副本 + oj 侧） |
| `src/.ojm-builtin.json` + `src/README.md` | 内置模块自治名单（删了它 = 关掉 build 门禁，不建议） |

**验收四连**（每一条都要产物/输出对，不是只看退出码）：

```bash
pnpm exec ojm info         # 版本矩阵：cli 与 runtime 同号；宿主 versions.json 列出共享依赖
pnpm exec ojm api --check  # 末行 0 error / 0 warn
pnpm exec ojm build        # dist/api（后端产物）+ dist/web（站点产物）+ modules.json
pnpm exec ojm preview      # 可选：单服务 release 形态（migrate 账本校验 → 9778 单端口）
```

## 2. 创建第一个模块

**宿主工程内的业务模块**（跟着宿主一起构建发布）用脚手架内建命令：

```bash
pnpm new books --layout container --api
# = ojm new books …：src/books/{solution.yaml, api/{manifest.yaml,api.ts}, web/{entry.ts,pages,locales}}
# 拒绝口径：重名 / 大写非 kebab / 保留名（auth）/ 内置名（home）——拒绝时零写入
```

然后按「对接四步流水线」把第一个接口跑通（每加接口都是这四步）：

```
① handler 动词挂 .schema（入参）+ 平级 .response（出参，可省略）
② 写业务逻辑（api.ts；数据访问走 db.table 构造器，见 oj-api-dev 的 db-guide）
③ ./bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json && pnpm exec ojm api
   → 生成 src/books/web/__client/{index.ts, api.schemas.ts}
④ entry.ts 的 lifecycle.onInit 里 createBooksClient(ctx) 一次；页面 import 裸函数调用
```

**新表 = 三件套，缺一不可**（`manual.md` §1.5）：`api/migrations/0001__*.sql`（DDL 真身）+
`api/schema.yaml`（声明，与 DDL 逐字段一致）+ `api/manifest.yaml` 的 `tables:`。且
`tenant.sql_guard: deny`（模板默认）下业务表**必须有 `tenant_id: {type: text, null: false}` 列**，
seed 行带 `'default'` 租户值——构造器 insert 自动注入当前租户，handler 不用手写。

**重启边界**（最容易卡住新人的一点，`manual.md` §1.4）：

| 改动 | 生效方式 |
|---|---|
| 已有 `api/**/api.ts` 的**文件内容** | 保存即热更 |
| **新增/删除**后端模块目录或端点文件 | 必须重启 `pnpm dev` |
| 改 `schema.yaml` / `migrations/` / `config.yaml` | 必须重启 |
| 前端 `src/<name>/web/**` | 模块重建 + 浏览器自动刷新 |

## 3. 让新模块自包含

「自包含」= 这个目录拔出来（或原样装进任何同版本宿主）就能跑，不依赖宿主的私货。
逐条过（每条都有门禁或运行时报错兜底）：

- [ ] **`entry.ts` 默认导出 `defineModule({ name, version, routes, i18n, lifecycle })`**——
      元数据唯一来源；`name` 与目录名一致，后端 `manifest.yaml` 的 `name` 同值
      （API 前缀 = 该 name，约定与目录一致）。
- [ ] **import 只有三类**：`@oj-module/runtime`、共享依赖裸说明符（react/antd…）、
      自身相对路径。**绝不 import 框架源码路径**（读用户/角色走 `useUserStore` /
      `useAuthStore` / `AccessControl`；写走契约 client 或 runtime 导出的 `api/rbac` /
      `api/user`，动机见 `manual.md` §2.8）。后端 handler 的跨模块引用走
      `#/<模块名>/…` 别名（不是相对路径），四红线见 `manual.md` §1.7。
- [ ] **i18n 双语齐备**：`locales/{zh-CN,en-US}.json` 都有；菜单标题用命名空间语法
      `"books:menu.books"`（ns = 模块名）。方案包的角色/权限 `title_key` 用
      `"<模块名>:role.<slug>"` / `"<模块名>:perm.<slug>"` 且双语都有（`manual.md` §11.5）。
- [ ] **client 一模块一建**：`createBooksClient(ctx)` 只在 onInit 创建一次；
      页面里直接 import 裸函数。A 模块不创建 B 模块的 client（越界 DEV 告警）——
      要别家能力走「B 注册 provider、A 消费」。
- [ ] **路由 handle 写对**：有页面的根路由 `layout: "container"`（不写 = 页面裸奔 +
      keepAlive 失效）；`home`/`login` 模块必须保留（shell 回跳依赖，`SKILL.md` 红线）。
- [ ] **依赖进 `devDependencies`** 并遵守两档分工：宿主 importmap 单例（react/antd/dayjs…
      不得打包副本）vs 模块自打包（echarts/vditor…宿主不提供），口径见 `manual.md` §2.6；
      `peerRuntime` 声明与宿主相容的版本范围。
- [ ] **接管 provider 就整套接管**：`ctx.register.*Provider` 的方法一个不能少
      （如通知 provider 四个方法），「只接管读」是半成品。
- [ ] **一切 `ctx.register.*` 在 `onInit` 内、返回前完成**（onInit 是 async）。

## 4. 编译

```bash
pnpm build              # = ojm build：oj build 全部后端模块 → dist/api；合并宿主站点 → dist/web
pnpm typecheck          # tsc --noEmit（含生成的 __client，类型对不上这里先炸）
pnpm typecheck:api      # 仅后端侧的 TS 投影检查
pnpm exec ojm api --check   # 三腿对账：生成物同步 / route 双向 / routes.js drift → 0 error / 0 warn
```

产物判据（`manual.md` §7）：`dist/api/versions.json` 存在；`dist/web/` 有
`index.html`/`assets/`/`modules/`/`modules.json`/`versions.json`；`modules.json` **必含
`app`**（/home /login 在其中，缺了登录回跳落错误边界）。

**方案包形态**（要把模块分发出去时才需要）：

```bash
pnpm exec ojm build --bundle            # 全部用户方案 → dist/<name>-<version>.tgz（自带模块不出包）
pnpm exec ojm build --bundle books      # 只打一份；同输入重复打包 sha256 逐字节一致
```

**内置模块自治门禁**（`manual.md` §1.9）：`src/app`、`src/oj-market` 与上游模板逐文件比对，
改内容/缺失/多出都 fail-fast 零产物。恢复 = `pnpm exec ojm init . --yes`（**只**覆盖这两个
目录，会丢弃其本地改动——先备份/提交）；下游自定义模块与工程配置不碰。

## 5. 发布（方案包 → 市场 → 站点）

完整一条链（含期望输出与判据）照 `publish-walkthrough.md` 敲，这里只列决策点：

1. **拿发布身份**（一次性）：站点「方案市场 → 发布管理」申请凭证 →
   `ojm keygen --credential <token>`（兑换即作废，key_id = `<产品名>.<账号>`）；
   **没有发布管理页**才用离线旁路 `ojm keygen --id <publisher> --yes`（指纹要人工核对）。
   私钥只活在 `~/.ojm/keys/<id>/`，不入仓不入包。
   **⚠️ 产品名 = 方案应用名，必须一致**：申请凭证时填的「产品名」就是将来方案包的名字——
   key_id 的产品名段、签名 `--id`、市场目录里的 publisher 归属全链按它对齐；填错名字
   （如凭证申请填 `books`、方案包叫 `bookstore`）不会当场报错，但信任核对、安装归属、
   多方案排查时全链对不上号。**改名 = 重新申请凭证**。
2. **每次发布**：`ojm sign dist/<name>-<ver>.tgz --id <kid> --key ~/.ojm/keys/<kid>/private.pem --registry-id <reg> --check`。
3. **进市场**：`ojm market publish --real …`（单方案工程一条命令；**多方案工程被拒**，
   走显式四步 `build --bundle <name>` → `sign` → `cp tgz+.sig cdn/` → `ojm market build-index`）。
4. **验包**：`ojm market verify --rebuild-index`（离线，七项全 ✓）。
5. **装上站点**：`ojm install <name>@<ver> --site-url … --user … --pass …`，或站点市场页点装。
   首装必停 `needs_trust`——**逐字核对指纹**后超管 `ojm trust confirm --task <id> …`，
   重试同一条到 `status=done`；oj 0.1.122+ 首装终态 `partial`（restart_pending）属正常语义：
   重启 `oj serve` 后 retry 即 done。新装方案的数据面（路由/seed）要冷启动才全量生效。

## 6. 升级

**A. 脚手架升级**（cli/runtime 必须同号动）：

```bash
pnpm up -D @oj-module/cli@<新版本> @oj-module/runtime@<新版本>   # 精确版本，勿用 latest/*
pnpm install
pnpm exec ojm init . --yes   # 同步模板默认模块（src/app、src/oj-market 本地改动会被覆盖——先提交）
pnpm exec ojm info           # 版本矩阵再核对：cli === runtime，oj ≥ MIN_OJ_VERSION
pnpm exec ojm build          # 门禁零漂移才算升完
```

- oj 二进制：`pnpm exec ojm vendor`（低于 cli 门禁会被 init/vendor 拦）。
- 市场自身（oj-market 方案包）**随站 bundle 上拉**：出站 bundle 比已装新 → 自动升级；
  比已装旧 → 跳过不降级（降级唯一入口 = 站点回滚）。

**B. 模块升版本（四处同步，漏任何一处打包校验直接点名方案）**：`solution.yaml` 的
`version` / `web.entry` / `archive.file`、`api/manifest.yaml` 的 `version`、
`web/entry.ts` 的 `version`。

**C. 迁移纪律**：已应用的迁移文件**一个字不能改**（账本校验拒启/拒装），变更 = 新增
`0002__*.sql`；`seed.sql` 每次启动都重放，必须幂等（`INSERT OR IGNORE`，注释里别有分号）。

**D. 已装方案升级**：发新版进市场（走 §5）→ 站点侧 `ojm install <name>@<新版本>` 或等
bundle 收敛自动 upgrade；回滚 = 重装旧版本（账本超前会被 OJ-9 拦，属保护不是缺陷）。

## 7. 排错第一站

1. `SKILL.md`「常见陷阱速查」按症状查表（模块不加载/请求未绑定/405/401…几乎都在）。
2. `manual.md` §8 排查五步；`ojm info` 的输出**完整粘贴**报障（它就是干这个的）。
3. 后端行为疑问先查 `.claude/skills/oj-api-dev/`（全局对象/鉴权/配置/测试的权威文档）。

## 8. 学习路径（按序读，按需跳读）

| 阶段 | 读 |
|---|---|
| 现在 | 本文（主路径） |
| 第一次建模块前 | `SKILL.md`（红线 + checklist + 陷阱速查）→ `manual.md` §1 工程结构、§2 写模块、§3 契约 |
| 第一次发包前 | `publish-walkthrough.md`（照做版全流程）+ `SKILL.md`「发布身份」 |
| 接管通知/上传/菜单 | `manual.md` §4 provider |
| 换布局/加插槽、i18n、构建细节 | `manual.md` §5 / §6 / §7 |
| 方案包契约、签名信任、菜单归组 | `manual.md` §11 / §12 / §13 |
| 接企业微信 | `wecom-daikaifa.md`（代开发/SaaS）或 `wecom-internal-app.md`（自建/私有化） |

## 命令速查

| 要做什么 | 命令 |
|---|---|
| 建新工程 | `pnpm dlx @oj-module/cli@latest init <名> --yes` |
| 起开发（双进程） | `pnpm dev`（前端 5174 / 后端 9778） |
| 建新模块 | `pnpm new <名> --layout container --api` |
| 契约再生成 | `./bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json && pnpm exec ojm api` |
| 编译 | `pnpm build`；方案包 `pnpm exec ojm build --bundle [name]` |
| 类型检查 | `pnpm typecheck` / `pnpm typecheck:api` |
| 预览 release 形态 | `pnpm preview`（9778 单服务） |
| 恢复内置模块 | `pnpm exec ojm init . --yes`（覆盖 src/app、src/oj-market，先备份） |
| 发布身份 | `ojm keygen --credential <token>`（站点凭证）/ `--id <publisher>`（离线旁路） |
| 发布方案 | `ojm sign … --check` → `ojm market publish --real …` → `ojm market verify --rebuild-index` |
| 安装方案 | `ojm install <name>@<ver> --site-url … --user … --pass …` |
| 升级 oj 二进制 | `pnpm exec ojm vendor` |
| 版本矩阵/报障 | `pnpm exec ojm info` |
