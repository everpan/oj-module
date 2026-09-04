# Phase 0 — 骨架与 spike（教学记录）

> 日期：2026-09-04 | 分支：`feat/playground-oj` | 提交：`4a38611`
> 目标：用 `ram init` 生成 playground-oj 骨架，跑通 oj 后端登录冒烟与 `ram dev` 反代联调。

## 0.1 阶段目标

- 生成可运行骨架（`apps/playground-oj/`）
- 端口避开 playground 的 9778 → 改 9779（F11）
- 依赖形态改回 `workspace:*`/`catalog:`（D11，仓内 dogfooding 验证本地代码）
- 后端登录链冒烟（admin/123456）+ `ram dev` 静态/反代联调
- spike 确认 oj 结构门禁待办项

## 0.2 执行步骤

### 步骤 1：`ram init` 骨架
```bash
node packages/cli/bin/ram.mjs init apps/playground-oj --yes
```
- 生成 22 项：`bin/oj`（vendor 解包，sha256 命中）、`api/config/{public.pem,cert.jws}`（现场签发）、`api/src/web/{manifest.yaml,seed.sql,migrations,hello,user-info,get-async-routes}/api.ts`、`modules/src/demo`、`global.d.ts`、`pnpm-workspace.yaml`（跳过，因 root 已含 allowBuilds）等。
- 平台硬限 darwin arm64（init.ts:32）。

### 步骤 2：端口与依赖改写（P0-1）
- `api/config.yaml`：`server.port: 9778 → 9779`（F11）。
- `package.json` devDependencies：照 `apps/playground` 改回 `workspace:*`/`catalog:`，并补 `@react-antd-module/contract`（否则 demo 契约 typecheck 挂）。
- **关键坑**：init 把模板 `pnpm-workspace.yaml` 拷进 `apps/playground-oj/`，会遮蔽 root 的 `catalog:`（从子目录跑 `pnpm install` 报 `No catalog entry '@ant-design/icons'`）。解决：**删除本地 `pnpm-workspace.yaml`**，归 root catalog 管辖（root 已有 `allowBuilds.esbuild: true`）。

### 步骤 3：后端登录冒烟（P0-2，直跑 oj 无需前端）
```bash
cd apps/playground-oj
./bin/oj server -c api/config.yaml --api-path api/src -b /api &
curl -s http://127.0.0.1:9779/api/health          # → {status:"OK",certificate_status:"valid"}
curl -s -X POST http://127.0.0.1:9779/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"123456"}'
# → {code:0,data:{access_token,...,user:{id:"1",roles:["admin"]}}}
curl -s http://127.0.0.1:9779/api/web/user-info -H "authorization: Bearer $TOKEN"
# → {code:0,data:{id:"1",username:"admin",roles:["admin"],...}}
curl -s http://127.0.0.1:9779/api/web/hello        # → 401 missing or invalid bearer token（守卫生效）
```

### 步骤 4：`ram dev` 反代联调（P0-3）
```bash
pnpm dev 5191      # 构建 demo 模块 + spawn oj(9779) + 静态服(5191)
```
- 验证（用 `127.0.0.1` 而非 `localhost`，避免 IPv6 解析失败）：
  - `GET http://127.0.0.1:5191/` → 200 text/html（shell 静态）
  - `GET http://127.0.0.1:5191/api/health` → 200（反代 oj）
  - `POST http://127.0.0.1:5191/api/auth/login` → 200（反代 + 登录链）

## 0.3 踩坑记录（教学重点）

1. **本地 `pnpm-workspace.yaml` 遮蔽 root catalog**：init 模板为「独立外部工程」拷贝了 `pnpm-workspace.yaml`，导致从子目录 `pnpm install` 找不到 `catalog:` 条目。仓内 dogfooding 应删除本地文件，由 root 统一管辖。
2. **后台进程存活**：用 `&` 后台启动的服务在 Bash 工具调用结束后会被回收；长期运行的服务须用工具自身的 background 模式（`run_in_background: true`）。
3. **证书不入库**：`api/config/*.pem` / `cert.jws` 含私钥，加入 `.gitignore`（本地 `ram init` 现铸，不共享）。
4. **`global.d.ts` eslint**：oj devkit 的第三方类型声明用 shorthand method signature，与本项目 `ts/method-signature-style` 冲突；加 `/* eslint-disable */` 整文件豁免（re-init 跳过已存在文件，改动持久）。
5. **commitlint subject-case**：subject 首字母须小写（`p0` 非 `P0`），否则 sentence-case 拒绝。

## 0.4 阶段小结

P0 完成：骨架可用、端口 9779、依赖回 workspace、oj 登录链与 `ram dev` 反代全绿。
**耗时**：约 1 个会话单元（init + 联调 + 3 处配置坑修复 + 提交）。
**待 P5 闭环**：`oj build --check` S 门禁、`contract.ts` 进 dist 无害（见 `notes-spike.md`）。
**下一步**：P1（前端迁移 + D9 注入机制 + ram `--check` 豁免）。
