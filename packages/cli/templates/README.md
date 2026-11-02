# __PROJECT_NAME__

前后端一体化工程（前端模块 + oj 后端），由 `ojm init` 生成。

## 快速开始

```bash
pnpm install
pnpm dev        # 开发：前端 devServer + oj 后端（src/*/api 保存即热更）
pnpm build      # 构建：oj build + 前端全站合并到 dist/web
pnpm preview    # 预览：oj migrate + server（release 产物）
```

登录账号：`admin` / `aA123456`（见 `src/_platform/api/seed.sql`）。

## 目录（一目录 = 一个模块）

```
config.yaml              站点/数据库/租户配置（init 现场签发证书到 config/）
src/<name>/api/          后端模块（目录镜像路由：src/<name>/api/<路径>/api.ts）
src/<name>/web/          前端模块（entry.ts 是入口；页面 / locales / __client 同目录）
src/app/web/             框架内置页面聚合模块（多根：/home /login /personal-center /notification /system）
src/oj-market/web/       解决方案市场（第一方能力，独立模块，删目录即下线）
dist/api/                oj build 后端产物
dist/web/                站点产物（shell + modules + modules.json）
bin/                     oj 二进制（init 解压，不入库）
```

`src/app/web` 是一个**多根模块**：一个 `entry.ts` 里挂五个顶层路由，各根按
`handle.order` 排菜单（与拆分时逐项一致），页面按根分目录
（`<root>/routes.ts` + `pages/` + `__client/`）。新增业务页面时建议单独建模块
（`pnpm exec ojm new <name>`），不要往聚合模块里塞。

## 契约与 `__client`

前端调后端一律走 `ojm api` 从 `openapi.json` 生成的 `__client/`（随模板分发，开箱即用）。
改了 handler 的 `.schema`（入参）/ `.response`（出参）后刷新：

```bash
bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json   # 重产契约
pnpm exec ojm api                                                         # 重生成 */web/*/__client
```

多根聚合模块的 client 归属由 `web.config.ts` 的 `clientOwners` 决定（`system → app`），
生成物落 `src/app/web/system/__client`，与页面同级——页面相对导入 `../../__client` 不用改。
`ojm api --check` 可对账漂移（零漂移为发布门禁）。

## 注意

- 改 `src/*/api` 下的 api.ts 保存即生效；**新增/删除模块目录、改
  schema/migrations/config.yaml 需重启 `ojm dev`**（oj 热更边界）。
- 后端开发请用 `/oj-api-dev` skill（`.claude/skills/oj-api-dev/`），手册按章节按需读。
- `config/` 下的证书为 init 现场签发的本地 dev 证书，不构成信任边界；
  生产环境用 oj 仓库 `oj-cert gen` 全新签发并替换公钥。

## 排障 / 常见问题

- **`pnpm dev` / `pnpm build` 报 `Could not resolve "../../__client/api"`**
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

- **`pnpm dlx @oj-module/cli@latest init` 生成的脚手架缺模块 / 看起来很旧**
  pnpm dlx 会按首次解析到的版本**缓存** CLI 可执行文件。排查：`ls src` 看是否缺预期模块。
  解决：清掉 dlx 缓存后显式指定版本重跑——

  ```bash
  rm -rf ~/Library/Caches/pnpm/dlx        # macOS；其它平台见 pnpm 文档的 dlx-store 路径
  pnpm dlx @oj-module/cli@<明确版本> init <工程名> --yes
  ```
