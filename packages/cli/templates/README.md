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
