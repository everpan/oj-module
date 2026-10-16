# __PROJECT_NAME__

前后端一体化工程（前端模块 + oj 后端），由 `ojm init` 生成。

## 快速开始

```bash
pnpm install
pnpm dev        # 开发：前端 devServer + oj 后端（api/src 保存即热更）
pnpm build      # 构建：oj build + 前端全站合并到 web/dist
pnpm preview    # 预览：oj migrate + server（release 产物）
```

登录账号：`admin` / `123456`（见 `api/src/_platform/seed.sql`）。

## 系统管理模块

`web/src/system/`（用户管理 / 成员资格 / 角色权限 / 操作日志 / 站点设置 / 登录方式）
的前端 API 客户端 `__client/` **已随模板分发**（与 auth/notification 等一致），`pnpm dev`
开箱即用、「系统管理」菜单直接可见。

`__client` 是从 `openapi.json`（模板自带，由 `api/src/system` 契约产出）生成的产物；
契约变更后刷新一次即可：

```bash
bin/oj openapi -c config.yaml -d api/src -b /api -o openapi.json   # 重产契约
pnpm exec ojm api                     # 重新生成 web/src/*/__client（dev 检测到 openapi.json 变化也会自动重生成）
```

成员资格页仅 superadmin 可见。改了 `api/src` 的 handler `.schema`/`.response` 后重跑这两条保持同步
（`ojm api --check` 可对账，零漂移为发布门禁）。

## 目录

```
bin/           oj 二进制（init 解压，不入库）
api/src/       后端模块源码（目录镜像路由：api/src/<模块>/<路径>/api.ts）
api/dist/      oj build 产物
web/src/   前端模块源码
web/dist/  构建产物（完整站点）
```

## 注意

- 改 `api/src` 下的 api.ts 保存即生效；**新增/删除后端模块目录、改
  schema/migrations/config.yaml 需重启 `ojm dev`**（oj 热更边界）。
- 后端开发请用 `/oj-api-dev` skill（`.claude/skills/oj-api-dev/`），
  手册按章节按需读。
- `api/config.yaml` 的证书为 init 现场签发的本地 dev 证书，不构成信任边界；
  生产环境用 oj 仓库 `oj-cert gen` 全新签发并替换公钥。

## 排障 / 常见问题

- **`pnpm dev` / `pnpm build` 报 `Could not resolve "./__client/api"`**
  某前端模块的 `entry.ts` 引用了 `web/src/<模块>/__client/api`，但该目录不存在——它是
  `ojm api` 从 `openapi.json` 生成的产物。在工程根跑一次即可补齐：

  ```bash
  pnpm exec ojm api      # 生成 web/src/*/__client（dev 检测到 openapi.json 变化也会自动重生成）
  ```

  改完后端 `api/src` 的契约后，重产契约再刷新：

  ```bash
  bin/oj openapi -c config.yaml -d api/src -b /api -o openapi.json
  pnpm exec ojm api
  ```

- **`__client/` 下的文件能直接改吗？**
  不能手改、也不入库——它是生成物，下次 `ojm api` 会覆盖你的手改。需要改接口就改
  `api/src` 的 handler `.schema`/`.response`，再跑上面的命令刷新。
  `ojm api --check` 可对账契约与产物的漂移（零漂移为发布门禁）。

- **`pnpm dlx @oj-module/cli@latest init` 生成的脚手架缺模块 / 看起来很旧**
  pnpm dlx 会按首次解析到的版本**缓存** CLI 可执行文件。若某次 `@latest` 指向的是旧版
  （例如早于系统管理模块的 `0.1.x`），之后重跑仍可能命中旧缓存，生成的脚手架就会缺新模块、
  模板偏旧（典型表现：`web/src` 下没有 `system` 目录）。
  排查：`ls web/src` 看是否缺预期模块。
  解决：清掉 dlx 缓存后重跑——

  ```bash
  rm -rf ~/Library/Caches/pnpm/dlx        # macOS；其它平台见 pnpm 文档的 dlx-store 路径
  # 或：pnpm dlx clear @oj-module/cli
  pnpm dlx @oj-module/cli@<明确版本> init <工程名> --yes   # 显式指定版本最稳
  ```

  养成显式带版本号（如 `@oj-module/cli@0.2.2`）的习惯，可避免 `@latest` 缓存歧义。
