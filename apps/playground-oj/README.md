# playground-oj

前后端一体化工程（前端模块 + oj 后端），由 `ram init` 生成。

## 快速开始

```bash
pnpm install
pnpm dev        # 开发：前端 devServer + oj 后端（api/src 保存即热更）
pnpm build      # 构建：oj build + 前端全站合并到 modules/dist
pnpm preview    # 预览：oj migrate + server（release 产物）
```

登录账号：`admin` / `123456`（见 `api/src/web/seed.sql`）。

## 目录

```
bin/           oj 二进制（init 解压，不入库）
api/src/       后端模块源码（目录镜像路由：api/src/<模块>/<路径>/api.ts）
api/dist/      oj build 产物
modules/src/   前端模块源码
modules/dist/  构建产物（完整站点）
```

## 注意

- 改 `api/src` 下的 api.ts 保存即生效；**新增/删除后端模块目录、改
  schema/migrations/config.yaml 需重启 `ram dev`**（oj 热更边界）。
- 后端开发请用 `/oj-api-dev` skill（`.claude/skills/oj-api-dev/`），
  手册按章节按需读。
- `api/config.yaml` 的证书为 init 现场签发的本地 dev 证书，不构成信任边界；
  生产环境用 oj 仓库 `oj-cert gen` 全新签发并替换公钥。
