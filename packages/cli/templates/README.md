# __PROJECT_NAME__

前后端一体化工程（前端模块 + oj 后端），由 `ojm init` 生成。

## 快速开始

```bash
pnpm install
pnpm dev        # 开发：前端 devServer + oj 后端（src 下 api.ts 保存即热更）
pnpm build      # 构建：oj build + 前端全站合并到 dist/web
pnpm preview    # 预览：oj migrate + server（release 产物）
```

登录账号：`superadmin` / `aA123456`（四个内置角色账号见 `src/app/api/_platform/seed.sql`）。

## 目录（一个 `src/app` 装下整个应用）

```
config.yaml                  站点/数据库/租户配置（init 现场签发证书到 config/）
src/app/api/<name>/          后端模块（模块名 = URL 前缀；目录镜像：<路径>/api.ts）
src/app/web/                 前端聚合模块（多根，一个 entry.ts 挂 /home /login /…）
  <root>/                    每个根：routes.ts + pages/ + locales/ + __client/
src/oj-market/web/           解决方案市场（第一方能力，独立模块，删目录即下线）
dist/api/                    oj build 后端产物
dist/web/                    站点产物（shell + modules + modules.json）
bin/                         oj 二进制（init 解压，不入库）
```

- **后端**按业务域分模块：`_platform` / `auth` / `notification` / `personal-center` /
  `system` / `web`，各自是独立 oj 模块（模块名即 `/api/<name>` 前缀），只是统一收在
  `src/app/api` 下——顶层不再散落同名目录。
- **前端** `src/app/web` 是一个**多根模块**：一个 `entry.ts` 里挂六个顶层路由，各根按
  `handle.order` 排菜单，页面按根分目录。新增业务页面时建议单独建模块
  （`pnpm exec ojm new <name>`），不要往聚合模块里塞。

## 契约与 `__client`

前端调后端一律走 `ojm api` 从 `openapi.json` 生成的 `__client/`（随模板分发，开箱即用）。
改了 handler 的 `.schema`（入参）/ `.response`（出参）后刷新：

```bash
bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json   # 重产契约
pnpm exec ojm api                                                         # 重生成 __client
```

生成物入口是 `__client/index.ts`（**不是 `api.ts`**：oj dev 会把模块目录下的
`api.ts` 当路由扫描）。页面里用 `from "../__client"` 导入。

多根聚合模块的 client 归属由 `web.config.ts` 的 `clientOwners` 决定（`system → app`），
生成物落 `src/app/web/system/__client`，与页面同级——页面相对导入不用改。
`ojm api --check` 可对账漂移（零漂移为发布门禁）。

## 注意

- 改 `src/app/api/**/api.ts` 保存即生效；**新增/删除模块目录、改
  schema/migrations/config.yaml 需重启 `ojm dev`**（oj 热更边界）。
- 后端开发请用 `/oj-api-dev` skill（`.claude/skills/oj-api-dev/`），手册按章节按需读。
- `config/` 下的证书为 init 现场签发的本地 dev 证书，不构成信任边界；
  生产环境用 oj 仓库 `oj-cert gen` 全新签发并替换公钥。

## 排障 / 常见问题

- **`pnpm dev` / `pnpm build` 报 `Could not resolve "../../__client"`**
  对应根的 `__client` 缺失——它是 `ojm api` 的生成物。在工程根跑一次即可补齐：

  ```bash
  pnpm exec ojm api      # dev 检测到 openapi.json 变化也会自动重生成
  ```

  改完后端契约后先重产契约再刷新：

  ```bash
  bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json
  pnpm exec ojm api
  ```

- **`__client/` 下的文件能直接改吗？**
  不能手改、也不入库——它是生成物，下次 `ojm api` 会覆盖。改接口就改 handler 的
  `.schema`/`.response`，再跑上面的命令刷新。

- **从旧版本升级（`__client/api.ts`）**
  0.2.54 起入口改名 `index.ts`（`api.ts` 会被 oj dev 当路由扫描）。重跑一次
  `pnpm exec ojm api` 即可：新文件写入、旧 `api.ts` 自动删除；页面导入改为
  `from "../__client"`。

- **`pnpm dlx @oj-module/cli@latest init` 生成的脚手架缺模块 / 看起来很旧**
  pnpm dlx 会按首次解析到的版本**缓存** CLI 可执行文件。排查：`ls src/app/api` 看是否缺预期模块。
  解决：清掉 dlx 缓存后显式指定版本重跑——

  ```bash
  rm -rf ~/Library/Caches/pnpm/dlx        # macOS；其它平台见 pnpm 文档的 dlx-store 路径
  pnpm dlx @oj-module/cli@<明确版本> init <工程名> --yes
  ```
