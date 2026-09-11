# playground-oj P0 spike 记录（2026-09-04）

## 1. ram init 骨架
- `node packages/cli/bin/ram.mjs init apps/playground-oj --yes` 通过：生成 22 项（bin/oj 解包、证书签发、web 模板、modules/src/demo、pnpm-workspace.yaml 跳过因 allowBuilds 已含 esbuild）。
- 平台硬限 darwin arm64（init.ts:32），本机满足。

## 2. 端口与依赖（P0-1）
- `api/config.yaml` port 9778 → **9779**（F11，避开 playground 9778）。host 127.0.0.1、base /api 维持。
- `package.json` devDependencies 改回 `workspace:*`/`catalog:`（照 playground），并补 `@oj-module/runtime/contract`（否则 demo 契约 typecheck 挂）。`pnpm install` 通过（lockfile 1139 条目 supply-chain 通过，hooks 设置）。

## 3. 后端登录冒烟（P0-2，直跑 oj 无需前端）
- `./bin/oj server -c api/config.yaml --api-path api/src -b /api` 起服，health 200，certificate valid（2036 到期）。
- migrate auto 应用 `V1__create_users`（web 用 migrations 建表，无 schema.yaml 也启动正常）。
- `POST /api/auth/login {admin,123456}` → `{code:0, data.access_token, user:{id:"1",roles:["admin"]}}` ✅
- `GET /api/web/user-info`（Bearer）→ 返回 users 行（id string、roles、avatar 等）✅
- `GET /api/web/hello`（无 Bearer）→ **401 missing or invalid bearer token** ✅（Bearer 守卫生效）

## 4. spike 待确认项（后续 phase 闭环）
- **schema.yaml 强制程度**：本工程 web 仅用 migrations 建表、manifest 未声明 `tables:` 即启动正常 → schema.yaml 非启动强需；但 `oj build --check` 的 S005 要求 `manifest.tables` 与 `schema.yaml` 双向一致。=> P2 的 system 等「有表模块」建议同时补 `schema.yaml` + `manifest.tables`，避免 S 门禁告警。dev 用 `auto` 迁移、preview 用 `verify`。
- **oj build --check S 门禁**：本工程尚未跑（待 P5 `ram build` 触发）；初判跑 S001–S007 结构检查，违规 fail build。
- **contract.ts 进 dist 无害**：待 P1-D 写入契约后，`ram build` 验证契约文件无路由导出 → 不产生路由 → 属死代码无害（设计 §7 验收项）。

## 5. 已知注意
- 手动直跑 oj 仅用于 spike；`ram dev` 自行 spawn oj（同 9779），须先杀手动进程避免端口冲突。
- oj 缺省终端静默（console_log false），日志落 `api/logs/`；spike 用 `--console-log` 或看 health 即可。
