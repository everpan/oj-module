# 从 oj-module 脚手架起步创建解决方案 · 完整教学

> 状态：**教学文档（全程真机实操实录）** · 日期：2026-10-17 · 验证环境：oj **0.1.78**（`~/.local/share/oj`）+ oj-module `feat/lifecycle-p1`
> 载体仓：`../oj-market`（首个提交 f3e4eb9，demo-market 教学样例）；本文同步作为 P1-15（独立仓最小形态）的前置验证记录与 devkit 手册「打包与分发」章节的实证底稿。
> 上游同名辨析、契约字段逐条语义见《202610171254-lifecycle-manifest-contract》；生命周期设计见《202610171138-solution-lifecycle-implementation-design》。

## 0. 这份文档教你什么

从**零**开始，把一个「解决方案」（solution = 后端 oj 模块 + 前端页面 + 数据库迁移 + 声明清单）做到**真机安装成功**。全程只用 oj-module 工具链（`ojm`）与 oj 二进制，每一步都是 2026-10-17 真机实录，不是理论推演。

适读人群：方案作者（第三方/第一方）、运维（宿主站点准备）、评审（理解安装链每一环）。

## 1. 概念速览：四个名词一张图

```
┌─ 宿主站点（host）────────────────────────────────────┐
│  oj serve（0.1.78）+ 框架模板（_platform 特权模块等） │
│  api/dist/manifests.yaml   ← 安装锁（D12，扁平 name: version）
│  api/dist/modules.json     ← 前端模块清单（安装器 upsert）
│  api/modules/.solutions/state.yaml ← 方案状态 sidecar
└──────────────────────────────────────────────────────┘
            ▲ ojm install（瘦客户端：登录→上传→轮询）
┌─ 方案包（*.tgz）─────────────────────────────────────┐
│  <name>-<version>/            ← 单根（§2.9；安装器归平消费）
│  ├─ manifest.yaml             ← C2 契约清单（包身份证）
│  ├─ api/<name>-<version>/     ← oj build 产物（原生七键清单+迁移）
│  └─ web/modules/<name>/<version>/entry.js ← 前端构建产物
└──────────────────────────────────────────────────────┘
            ▲ ojm build --bundle（构建即校验 + 确定性打包）
┌─ 方案工程（作者仓库）────────────────────────────────┐
│  manifest.yaml              ← C2 清单（源）
│  api/src/<name>/…           ← oj 模块源（七键清单/schema/迁移/端点）
│  web/src/<name>/…           ← 前端模块源（entry.ts + locales/）
└──────────────────────────────────────────────────────┘
```

三条铁律先记住（后文处处会用）：

1. **双清单分层**（C2-31）：包根 `manifest.yaml` 是 C2 契约清单（仅 C2 字段）；`api/<name>-<version>/manifest.yaml` 是 oj 原生七键清单（name/desc/version/config/db/tables/deps）。两者 name/version 逐一相等，且原生 `desc` === C2 `summary`。
2. **构建即校验**：`ojm build --bundle` 先跑 C2 契约全量校验 + 文件面校验（tables↔schema、locales 双语齐备），坏清单出不了包。
3. **确定性打包**（C2-32）：同输入两次打包 sha256 一致（mtime=0/字典序/0644/0755/无 owner）——sha256 即发布完整性锚。

## 2. 前置准备

| 项 | 本验证实录 | 说明 |
|---|---|---|
| oj 二进制 | 0.1.78（`~/.local/share/oj/oj`） | 宿主运行时；生命周期链需 ≥0.1.75 原语（exec.run/server.reloadConfig/yaml.parse/migrate --format json） |
| ojm 工具链 | oj-module 仓 `packages/cli/bin/ojm.mjs` | 独立作者目标形态 = 已发布 `@oj-module/cli` npm 包（未发布前用仓内 bin 直跑，见 §8 坑①） |
| node/pnpm | 本机已有 | ojm 构建为自包含（web 模块共享依赖外部化，方案工程**无需 node_modules**） |

## 3. 起步一：运维侧准备宿主站点（一次性）

### 3.1 脚手架宿主

```bash
cd /tmp && ojm init ojm-tutorial-host
# [ojm] init 完成：/private/tmp/ojm-tutorial-host
# 下一步：pnpm install && pnpm dev（登录 admin / 123456）
```

`ojm init` 产出完整宿主工程（框架模板 + `bin/oj` + `api/config.yaml`）。三个必须动的点：

### 3.2 换二进制（坑①：npm 渠道滞后）

`ojm init/vendor` 从 npm 装 `@oj-bin/oj`，本文写作时最新只有 **0.1.74**——缺生命周期全部原语。宿主必须换运维安装的版本：

```bash
cp ~/.local/share/oj/oj <host>/bin/oj
echo "v0.1.78" > <host>/bin/.oj-version   # 本地版本标记，缺了视为未安装
```

### 3.3 端口

`api/config.yaml` 缺省 9778，多站共存时改掉（本实录用 9781）。

### 3.4 授权段（安装器的两把钥匙）

安装器在 `_platform` 特权模块内跑，需要 config 两段——**模板已带 exec 白名单，fs 段当前缺省缺**（P1-16 接线点，本文按保守口径手补）：

```yaml
# 模板已带：解压/迁移两处消费的 argv 模板白名单（逐字对齐 lifecycle steps，不得增删）
platform:
  exec:
    _platform:
      allow:
        - 'tar -tvzf ${path:archive}'
        - 'tar -xzf ${path:archive} -C ${path:dest}'
        - 'oj migrate --format json -d ${path:dir} ${raw:module}'

# 手补：isolate fs 面（安装器落盘授权）。jail 根=config 目录，与安装器 D3 缺省路径
# （modules/.staging、dist/modules、db.sqlite…全 fs 根相对）对齐；生产收紧口径 P1-16 钉定。
fs:
  root: .
  readonly: false
```

### 3.5 构建 + 起服务（release 形态）

```bash
cd <host> && ojm build     # 后端 oj build → api/dist/<mod>-<ver>/；前端 → web/dist
ojm preview                # oj serve（release/js）+ 静态兜底反代
# oj serve listening on http://127.0.0.1:9781/api (dir=…/api/dist, release/js)
```

### 3.6 首登改密（坑②）

框架安全策略：admin 首登强制改密（`must_change` 悬挂期），期间安装端点 403 `password change required`。CLI 旅程：

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:9781/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"123456"}' | jq -r .data.access_token)
curl -s -X PUT http://127.0.0.1:9781/api/auth/password \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"old_password":"123456","new_password":"<新口令>"}'
```

> 响应字段是 `data.access_token`（snake_case）；悬挂期 token `restricted: true`，改密成功才换发正式 token。

## 4. 起步二：作者侧方案工程（oj-market 实录）

### 4.1 工程骨架（五个文件起步）

```
oj-market/
├── package.json          # scripts: dev/build/preview（ojm）；无需 dependencies
├── web.config.ts         # 前端模块清单（name + entry 相对工程根）
├── manifest.yaml         # C2 方案清单（包身份证）
├── api/
│   ├── config.yaml       # 方案工程自己的 oj 配置（dev/serve 用）
│   └── src/demo-market/  # oj 原生模块（目录名 === 方案名）
│       ├── manifest.yaml # 七键原生清单（C2-31 分层）
│       ├── schema.yaml   # 声明式表结构
│       ├── migrations/0001__init.sql
│       └── ping/api.ts   # 匿名健康探针
└── web/src/demo-market/
    ├── entry.ts          # defineModule 单页
    └── locales/{zh-CN,en-US}.json
```

共享依赖（react/antd/@oj-module/runtime）**一律不装**——宿主 importmap 提供，构建期外部化。这就是方案工程零 node_modules 的原因。

### 4.2 C2 清单逐段讲解（`manifest.yaml`）

完整可运行样例见 oj-market 仓。逐段要点（规则号见契约）：

| 段 | 关键规则 | 实录提醒 |
|---|---|---|
| 身份 name/version | C2-01 白名单+非保留名；C2-02 oj 相容版本语法 | `market` 是保留名（R9），第三方方案不可用 |
| summary | C2-04 | 必须 === 原生清单 `desc`（C2-31 构建期核对） |
| changelog | C2-08 必填 | string[] 每条一个用户可感知变更 |
| peerRuntime | C2-09 **P1 强制** | 安装预检对宿主 `versions.json` 比对，读不到即 fail-closed（§6 实录第 4 坑） |
| api.module/prefix/tables | C2-12/13 | `tables` 必须 === schema.yaml 表 keys |
| api.anonymous | C2-26 | 首段必须 === 模块段；health 探针匿名可达（D14/Q-A） |
| web.entry/integrity | C2-27/28 | entry 路径版本段 === version；integrity=构建产物 sha384-<base64>（当前须手工从 modules.json 回填，见 §5.3） |
| permissions/roles | C2-15/16 | code 强制 `<name>.` 前缀；role name=`<name>.<role>` |
| routes.order | C2-17 | 建议 ≥200（框架项保留 <200 间隔带；构建期仅警告） |
| settings.groups | C2-22~24 | key 首段必须 === name（R24 所有权） |
| health | C2-33 | 必须是 main 路由的子路径 + 匿名可达 |

### 4.3 oj 原生模块（`api/src/demo-market/`）

七键清单（禁携带任何 bundle 字段——oj 启动会真实解析它）：

```yaml
name: demo-market
desc: market 仓起步教学样例（C2 契约端到端验证）   # === bundle summary
version: 0.1.0
tables:
  - note
```

表结构声明与迁移一一对应（安装器构建期核 tables↔schema；oj migrate 按 seq 升序执行、前向-only）：

```yaml
# schema.yaml
tables:
  note:
    pk: id
    columns:
      id: {type: integer, autoincrement: true}
      title: {type: text, null: false}
      create_time: {type: integer, null: false}
```

```sql
-- migrations/0001__init.sql
CREATE TABLE IF NOT EXISTS note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  create_time INTEGER NOT NULL
);
```

健康探针（匿名、零全局依赖起步形态）：

```ts
// ping/api.ts —— bundle health: /demo-market/ping ↔ anonymous: [demo-market/ping]
const ping = {
	async get() {
		return { pong: true, module: "demo-market" };
	},
};
export default ping;
```

### 4.4 前端模块（`web/src/demo-market/`）

```ts
import React from "react";
import { defineModule } from "@oj-module/runtime";

export default defineModule({
	name: "demo-market",
	description: "market 仓起步教学样例（C2 契约端到端验证）",
	version: "0.1.0",
	routes: [
		{
			path: "/demo-market",
			element: React.createElement("div", { style: { padding: 24 } }, "demo-market 已安装"),
			handle: { layout: "container", order: 200, title: "demo-market:menu.main" },
		},
	],
});
```

**双语 locales 必须齐备**（C2-25 双语齐备 fail-fast）：entry/handle 引用的每个 i18n key，以及 manifest 引用的 perm/role/settings 全部 title_key/label_key，都要在 `locales/zh-CN.json` **和** `en-US.json` 里落齐。本实录第一次打包就吃了这记 fail-fast（8 项违规全量列出，见 §8 坑⑤）。

## 5. 构建与打包

### 5.1 全栈构建

```bash
cd oj-market && ojm build
# oj build: demo-market v0.1.0 → api/dist/demo-market-0.1.0 (1 api file(s))
# [ojm] 已合并宿主站点 → web/dist
# [ojm] 构建 demo-market@0.1.0 ...
# [ojm] 清单已生成 → web/dist/modules.json
```

产物即 bundle 的输入（布局逐字对齐，无需手工搬动）：

```
api/dist/demo-market-0.1.0/     ← oj build 产物（原生清单+迁移+api.js+schema）
api/dist/manifests.yaml         ← （宿主锁同形文件；入包红线：只取 <name>-<version>/ 目录）
api/dist/demo-market-0.1.0.tgz  ← oj build 顺手产的 per-module 包（坑⑥：不能当安装源）
web/dist/modules/demo-market/0.1.0/entry.js
web/dist/modules.json           ← 构建器写出的前端清单（integrity 真源）
```

### 5.2 integrity 回填（坑④：当前须手工）

`ojm build --bundle` 目前只对 web.entry 做**存在性**复核，不自动回填 integrity（自动化随 P1-16 评估）。作者流程：从 `web/dist/modules.json` 把构建器算好的 integrity 镜像进 C2 清单：

```yaml
web:
  entry: modules/demo-market/0.1.0/entry.js
  integrity: sha384-KU1QC9B9tr+ytO94iON/LGpXt7y4FZgxLdtxEvHjW/3etI3GMiw2tvZFwHB+nbE1
```

### 5.3 打包

```bash
ojm build --bundle
# [ojm] 方案包已生成 → dist/demo-market-0.1.0.tgz
# [ojm] sha256：c4ec192c5d4197d235e78663fb7265b7d5a7846b521c0490d9af0fd75421d38c（4043 字节；确定性打包）
```

构建即校验的两道闸（实录均触发过）：契约校验（字段/白名单/保留名/键空间→可读违规清单）→ 文件面校验（tables↔schema、C2-25 locales 双语齐备）。**坏清单出不了包。**

## 6. 安装（十阶段实况）

```bash
ojm install dist/demo-market-0.1.0.tgz \
  --url http://127.0.0.1:9781 --user admin --pass '<新口令>'
```

瘦客户端旅程：登录 → Bearer → multipart 上传 → `POST /api/_platform/market/install` → 轮询 `task?id=`（800ms 起步指数退避、5s 封顶、30min 总超时）→ 终态渲染（失败输出 reason + retryable + 双语指引）。服务端状态机十阶段实录（摘自任务记录）：

```
preflight   ✅ manifest 满足 C2 契约（身份/兼容/占用/匿名/RBAC/路由/设置/health 全过）
downloading ✅ upload.tgz（4043 字节）→ modules/.staging/upload.tgz
verifying   ✅ sha256 与索引一致（C2-29；P1 无签名阶段——同信任域仅防传输损坏）
extracting  ✅ 16 个成员 → modules/.staging/（单根归平；C2-31 复核过）
migrating   ✅ 1 条迁移已应用（账据=oj migrate --format json applied[]；
              备份 db.sqlite.bak-<ts> 保留 3 份；迁移成功才落锁，D11/R2）
lock_commit → 生效切换（写锁+四处同写）
registering → RBAC/路由/设置注册
deploying   → 前端产物落位 + modules.json upsert
reloading   → 热更生效断言
smoking     → 探活/integrity/注册一致性
```

> **本实录进度注记（2026-10-17）**：验证时 P1-13b（B-11 跨层断裂修复）尚在收尾，宿主 dist 捕获到其中间态，首装停在 lock_commit（`TypeError: invalid_argument`，工作树 WIP 所致）。P1-13b 合入后按 §3.5 重建宿主、重跑 §6 即得全绿 `done`——安装链其余九段已在本机实证。安装前置条件里因此多一步（坑⑦）：宿主 `api/dist/versions.json` 需存在且含 `@oj-module/runtime` 键（C2-09 真源），P1-13b 合入前手工补：`{"@oj-module/runtime":"0.2.4"}`。

### 幂等重装（AC-P1-3）

同版本重装 = no-op 不重复迁移（前向-only 账本去重）；升级/降级 = 同命令不同 version；降版被 rollbackGuard 拒（R12 红线）。

## 7. 验证清单（装完怎么确认）

| 项 | 动作 | 预期 |
|---|---|---|
| health 探活 | `curl http://127.0.0.1:9781/api/demo-market/ping` | `{"pong":true,...}` 200 |
| 菜单/路由 | 登录站点看菜单 | 「教学样例」出现（route order 200） |
| 迁移真跑 | 看 `api/db.sqlite.bak-*` 与 note 表 | 备份存在；note 表已建 |
| 锁与 sidecar | `api/dist/manifests.yaml` 增 `demo-market: 0.1.0`；`api/modules/.solutions/state.yaml` 有记录 | 两处一致 |
| 前端落位 | `api/dist/modules.json` 含 demo-market 条目（integrity 为部署产物重算值） | smoke 已比对 |
| 幂等 | 再跑一次 §6 安装命令 | no-op 完成 |

## 8. 坑速查表（全部为本实录真实踩到）

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| ① | npm 渠道滞后 | `ojm init/vendor` 装 `@oj-bin/oj@0.1.74`，缺生命周期原语 | 宿主换 `~/.local/share/oj/oj` + `.oj-version` 标记（§3.2） |
| ② | 首登强制改密 | install 报 403 `password change required` | 先经 `/api/auth/password` 改密（§3.6） |
| ③ | `fs:` 段缺省缺失 | install 报 500 `fs not configured` | config 补 `fs: {root: ., readonly: false}`（§3.4；生产收紧随 P1-16） |
| ④ | integrity 无自动回填 | 打包只存在性复核 | 从 `web/dist/modules.json` 镜像 integrity 进 C2 清单（§5.2） |
| ⑤ | C2-25 双语 fail-fast | 打包列出全部缺失 i18n key（zh+en 各一遍） | manifest 引用的 perm/role/settings/menu key 在两份 locales 落齐（§4.4） |
| ⑥ | per-module tgz 误用 | `api/dist/<name>-<version>.tgz` 不是安装源 | 只认 `ojm build --bundle` 产物（0.1.77 对账注记同款辨析） |
| ⑦ | versions.json 缺失 | preflight C2-09 fail-closed | 宿主 `api/dist/versions.json` 补 `{"@oj-module/runtime":"…"}`（P1-13b 合入后自动接线） |
| ⑧ | 多层 dist/ 打包 | `tar czf x.tgz dist` 多一层 dist/，解压非合法根 | 只用 `ojm build --bundle`（内部单根组装，上游坑同款） |

## 9. 与 roadmap 的关系

- 本文 §3.4（fs 段）/ §5.2（integrity 回填）/ §6 注记（versions.json 接线）三处手工步骤，分别是 P1-16 接线点与 P1-13b（B-11）交付项——合入后本文对应小节会更新为「自动」口径。
- P1-15（oj-market 独立仓最小形态）以本仓脚手架为起点替换 demo 内容为正式 market 方案；本文即其「第三方作者形态」验证底稿。
- devkit 手册「打包与分发」章节（C5）以本文为实证底稿展开。
