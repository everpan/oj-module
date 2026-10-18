# 解决方案市场 · 功能验证剧本（Verification Playbook）

本文件是把「解决方案市场」文档（见 [README](./README.md) 的架构/开发/运维/产品四篇）里描述的**构建→发布→上架→安装→深检→升级→回滚→卸载**闭环，转成**可照做、可复现**的验证剧本。

两份验证路径：

- **路径 A（推荐，~30s，零外部依赖）**：直接跑仓库自带脚本 `scripts/lifecycle-e2e.mjs`，它在内存里合成完整 `demo-solution`、经 `_platform` 内部端点走完整状态机并断言全绿。适合「快速证明文档闭环是真的」。
- **路径 B（真·CLI 链，一键可重跑）**：仓库内置冒烟编排 `scripts/verify-solution-smoke/`——`bootstrap-host.mjs` 自举宿主、`make-solution.mjs` 造签名方案、`run.mjs` 串起 serve→签名→安装（含 TOFU）→核对清单，最后自动关服务。**一条命令即可复现并断言全绿**：

  ```bash
  pnpm verify:solution        # = node scripts/verify-solution-smoke/run.mjs
  OJ_BIN=/abs/oj PORT=9782 pnpm verify:solution   # 自定义运行时/端口
  ```

  该编排不依赖外部 `oj-market`，每次重跑幂等（清空 `/tmp/oj-smoke`、重建签名密钥、自动处理首登改密与 TOFU 确认）。下面 B1/B3 仍可单步手动跑，对应脚本即 `scripts/verify-solution-smoke/` 下文件。

> 关键前置结论：**本仓没有可直接安装的 `oj-market`**（它是独立仓、只读）。所有验证都用仓库内自带的 demo 方案或内存合成方案，不依赖外部 `oj-market`。

---

## 0. 前置条件

| 项 | 要求 | 本机确认 |
|---|---|---|
| `oj` 运行时 | ≥ 0.1.78（冒烟基准 0.1.74） | `/Users/ever/.local/bin/oj`（当前 0.1.80）✅ |
| Node / pnpm | `pnpm@11.24.0`（package.json 钉死） | node v22 / pnpm 11.24 ✅ |
| 数据库 | sqlite 默认即可（`db.default: 'sqlite://db.sqlite'`，自动建库） | `sqlite3` ✅；无需 mysql/pg |
| `ojm` | 未构建，从源码经 `tsx` 跑 | `packages/cli/bin/ojm.mjs` ✅ |

设置环境变量（后续命令复用）：

```bash
export OJ_BIN=/Users/ever/.local/bin/oj
export BASE=http://127.0.0.1:9781
export SITE=/tmp/oj-smoke/api
```

---

## 路径 A：零依赖自检脚本（首选）

```bash
cd /Users/ever/git/only-js/oj-module
node scripts/lifecycle-e2e.mjs
```

脚本自举宿主 → 合成 demo-solution（api+web+manifest+签名）→ 安装 → 深检 → 升级 → 回滚 → 卸载 → GC，逐条断言。**退出码 0 = 全绿**。真实运行结果（本次）：

```
PASS=35  FAIL=0   （exit=0）
```

覆盖的代表性验收点（与四篇文档一一对应）：

| 阶段 | 验证点（AC 编号） | 本次结果 |
|---|---|---|
| 安装 | AC-P1-1 合法 bundle 安装 done + 不重启出菜单/路由（ping=200） | ✅ routes=2 modules.json=1 行 ping=200 |
| 安装 | AC-P1-14 终态审计落 oplog | ✅ `solution.install` 行=1 |
| 安装 | AC-P1-8 恶意 tgz（`../` 越界成员）拒装零副作用 | ✅ stage=extracting dirs=0 |
| 安装 | AC-P1-10 权限键越空间拒装（failed@preflight，零审计） | ✅ routes=0 oplog=0 |
| 升级 | AC-P1-4 升级锁迁移 + 两版本目录共存（旧版永不 prune） | ✅ lock→0.2.0 dirs=0.1.0,0.2.0 |
| 升级 | AC-P1-7 kill/账本分歧 → 重启对账自愈（锁回指旧版） | ✅ index=200 lock 回指 0.1.0 |
| 深检 | AC-P2-6 深检报告 `{ok,checks,advise}` + `verify/last` | ✅ verify=200（API-only 站点如实报 routes error） |
| 签名链 | AC-P2-1 未签名包拒装（sig_missing fail-closed） | ✅ stage=verifying dirs=0 |
| 签名链 | AC-P2-3 陌生发布方 → needs_trust（指纹在场） | ✅ fingerprint 在场 staging 不清场 |
| 签名链 | AC-P2-4 TOFU 确认后重装 done | ✅ confirm=200 reinstall=done |
| 签名链 | AC-P2-5 吊销后拒装/拒升级 | ✅ needs_trust 版本不动 |
| 发布 | AC-P3-4 `ojm publish` 索引重算+签名 + 宿主验签装成功 | ✅ publish exit=0 install=done |
| GC | AC-P3-3 GC 内建保留 N=3（state 时间序，锁版本受保护） | ✅ dirs=3 个 journal.head=5 |
| 卸载 | AC-P3-1 影响面预检计数（affectedRoles/affectedUsers） | ✅ impacted=1/1 |
| 卸载 | AC-P3-2 superadmin 门：非 super 身份 → 403 | ✅ staff impact=403 uninstall=403 |
| 卸载 | AC-P3-5 卸载（四处同删+级联+业务表保留）→ 重装角色重建但授权不复活 | ✅ un=true retained=[demo_note] 重装 grants=0 |
| 取消 | AC-P3-6 cancel 置位 → failed/partial + cancelled + staging 清场 + 锁回退 | ✅ cancelled=true staging 已清 |

完整逐条报告见 `logs/lifecycle-e2e-report.md`（脚本自动生成）。**只要该脚本 exit=0，即可断言文档描述的闭环在仓库当前代码上成立。**

---

## 路径 B：真·手动 CLI 链

### B1. Bootstrap 宿主（来自模板，与 e2e 同构）

把仓库模板 `packages/cli/templates/api` 拷出、补 config、签 dev 证书、`oj build`、写 `versions.json`。脚本已内置为 `scripts/verify-solution-smoke/bootstrap-host.mjs`（自动推导仓库根、可经 `OJ_BIN/SITE/PORT` 环境变量覆盖），直接：

```bash
node scripts/verify-solution-smoke/bootstrap-host.mjs
# 或自定义： OJ_BIN=oj PORT=9782 SITE=/tmp/oj-smoke/api node scripts/verify-solution-smoke/bootstrap-host.mjs
```

期望产物：`/tmp/oj-smoke/api/dist/` 含各模块目录 + `manifests.yaml`（含 `_platform: 0.1.0`）+ `versions.json`。

### B2. 起 `oj serve`

```bash
cd /tmp/oj-smoke/api
$OJ_BIN serve -c config.yaml -b /api --api-path dist --console-log > /tmp/oj-smoke/serve.log 2>&1 &
curl -fsS $BASE/api/health && echo " SERVE OK"   # 启动成功标志：逐行打印 module <name> v<ver>，且 /api/health 200
```

> 端口务必显式传空闲端口（9778/9779 常被占，占用会导致整组 skip）。关服务：`kill %1` 或 `pkill -f 'oj serve'`。

### B3. 造一个带 web 的签名方案

脚本已内置为 `scripts/verify-solution-smoke/make-solution.mjs`（产出 `/tmp/demo-solution-0.1.0.tgz`，含 api+web+manifest，逻辑镜像 e2e 的 `buildDemoTree`）。注意 ping 处理器必须调用 oj 运行时的全局 `json.ok(...)`（直接 `return` 对象会被忽略、空 body）：

```bash
node scripts/verify-solution-smoke/make-solution.mjs
# 产物： /tmp/demo-solution-0.1.0.tgz
```

### B4. 签名 + 安装

```bash
cd /Users/ever/git/only-js/oj-module
node packages/cli/bin/ojm.mjs keygen --id smoke.local            # 私钥落在 ~/.ojm/keys/smoke.local/
node packages/cli/bin/ojm.mjs sign /tmp/demo-solution-0.1.0.tgz --id smoke.local --check   # 产出 .tgz.sig 侧车

# 首登强制改密（否则安装报 403 password change required）
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])')
curl -s -X PUT $BASE/api/auth/password -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"old_password":"123456","new_password":"smoke-pass-123"}' >/dev/null
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"smoke-pass-123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])')

# 安装（.sig 侧车自动随包上传）
node packages/cli/bin/ojm.mjs install /tmp/demo-solution-0.1.0.tgz --url $BASE --user admin --pass 'smoke-pass-123'
```

若输出「待信任确认（发布方：smoke.local）」+ 指纹 → 进入 TOFU，确认后重装：

```bash
node packages/cli/bin/ojm.mjs trust confirm --task <上一步 task id> --url $BASE --user admin --pass 'smoke-pass-123'
node packages/cli/bin/ojm.mjs install /tmp/demo-solution-0.1.0.tgz --url $BASE --user admin --pass 'smoke-pass-123'   # 期望 [ojm] 安装完成：demo-solution 0.1.0
```

---

## 验证核对清单（curl）

服务起好、方案装好后，逐项核对（对照路径 A 的 AC 点）：

```bash
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"smoke-pass-123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])')

echo "① 平台握手";        curl -s $BASE/api/_platform/market/meta -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo "② 深检(admin 域)";  curl -s -X POST "$BASE/api/_platform/solutions/verify?name=demo-solution" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo "③ 深检最近报告";    curl -s "$BASE/api/_platform/solutions/verify/last?name=demo-solution" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo "④ 匿名健康探针";    curl -s $BASE/api/demo-solution/ping; echo
echo "⑤ 磁盘扁平锁";      grep demo-solution /tmp/oj-smoke/api/dist/manifests.yaml
echo "⑥ 健康/代际";       curl -s $BASE/api/health | python3 -m json.tool
```

期望：① `data.apiVersion` 非空；② `data.ok` 布尔、`data.checks` 数组（API-only 站点 routes 可能报 error，那是检测能力证据）；③ 同②有 `last` 报告；④ 200 且包体 `data.pong===true`（`{"code":0,"msg":"ok","data":{"pong":true,...}}`）；⑤ 锁含 `demo-solution: 0.1.0`；⑥ 200 且带 generation。

---

## 已知会失败的点 & 规避

| 现象 | 原因 | 规避 |
|---|---|---|
| 安装/登录 403 `password change required` | 首登强制改密 | 先 `PUT /api/auth/password` 改密再用新口令 |
| 安装 500 `fs not configured` | config 缺 `fs:` 段 | B1 脚本已补 `fs: {root: ., readonly: false}` |
| 安装 `exec ... NotCapable` | 缺 `platform.modules:[_platform]` 或白名单被改 | B1 已注入；U6 加固还可能要求 `platform.trusted_paths` 指向 `.solutions` 目录 |
| 安装 `sig_missing` / 验签失败 | G4 硬 fail-closed，未签名或未知密钥 | 必须 `ojm sign`；未知密钥走 `trust confirm` / `trust add` |
| 安装 `peerRuntime fail-closed` | 宿主 `dist/versions.json` 缺失 | B1 已写 `{"@oj-module/runtime":"0.1.0"}` |
| `oj serve` 拒启 / 报缺锁 | `oj build` 未生成 `dist/manifests.yaml` | 确认 `oj build` 成功、dist 含 `_platform-0.1.0/` |
| ping 401（非 200） | `anonymous_paths` 未含该路由 | B1 已预加 `/demo-solution/ping`；若漏加需重启 serve |
| 端口冲突导致整组 skip | 9778/9779 被占 | 显式传空闲端口（本剧本用 9781） |

---

## 关键注意（避免误判）

1. **`manifests.yaml` 是磁盘文件，不是 HTTP 端点**：本仓脚本均从磁盘读 `api/dist/manifests.yaml`（扁平锁），未发现任何把它当 HTTP 暴露的路由。`GET /api/manifests.yaml` 大概率 404。市场卡片索引走 `GET /api/_platform/market/index`（读 CDN 源），`ojm install <file.tgz>` 装的方案**不会**出现在 index。`ojm publish` 走 CDN 的方案才进 index（见 AC-P3-4）。
2. **`oj-market` 是独立仓**：本仓验证不依赖它；要验证「市场 UI 展示第三方方案」，用路径 A 的 `lifecycle-e2e.mjs`（自带内存 CDN）。
3. **`health` 路径**：带 `-b /api` 时前缀为 `/api/health`（路径 A 实测）。文档里若写 `{base}/_system/health` 也预期可用，但仅 `-b /api` 下前缀为 `/api`。
4. **`pnpm build` 对 API 冒烟非必需**：它产出 Web 壳/共享资产，不产生可运行宿主；可运行宿主来自 `oj build`（在宿主工程 `api/` 上跑）。

---

## 与四篇文档的对应

- 安装状态机 / 十阶段 / 幂等 / 失败语义三分 → [ARCHITECTURE.md §7](./ARCHITECTURE.md)
- 构建打包 / `ojm build` / 本地调试 → [DEVELOPER.md](./DEVELOPER.md)
- 引导链 / 失败码 / 故障恢复 / 迁移 → [OPERATIONS.md](./OPERATIONS.md)
- 产品能力地图 / 演进路线 → [PRODUCT.md](./PRODUCT.md)
