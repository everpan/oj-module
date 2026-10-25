# 解决方案市场 · 解决方案开发者文档（DEVELOPER）

> 状态：**权威开发者指南** · 日期：2026-10-18 · 适用范围：用 `ojm` 构建并发布「解决方案（solution）」的作者
> 真源：作者教学实录 `202610172100-solution-authoring-tutorial.md` + 契约 v1.3 `202610171254-lifecycle-manifest-contract.md` 为准；矛盾处见 §12。
> 配套文档：`ARCHITECTURE.md`（完整契约字段语义、RBAC 模型、安全模型）、devkit 手册「打包与分发」章节。本文**只讲作者如何动手**，不复制设计原理。

---

## 术语表（全文统一）

| 中文 | 英文 / 工具 |
|---|---|
| 解决方案 | solution |
| 清单 | `manifest.yaml` |
| 装载 / 挂载 | mount |
| 深检 | deep-check |
| 市场 | marketplace |
| 第一方 | first-party（oj 原生能力，不可被解决方案复制） |
| isolate | oj 的 JS 沙箱运行时 |
| bundles | CDN 上的发布清单 |
| `ojm build` | 构建命令 |
| integrity | sha384 资源指纹 |

---

## 1. 概览：你能构建什么、开发前置

一个「解决方案」= **后端 api 运行时（oj 模块）+ web 前端 + 原生模块 + `manifest.yaml` 契约清单** 的自包含包。它能：

- 声明独立后端 API 路由（前缀默认 `/api/<name>`）与匿名探针；
- 声明前端页面（进菜单 / 管理区 / 隐藏入口）与 i18n；
- 声明数据库表与增量迁移；
- 声明 RBAC 权限码 / 角色；
- 声明系统设置分组；
- 打包成确定性 tgz，安装到 oj 宿主即生效（不重启站点）。

### 开发前置

| 项 | 要求 | 说明 |
|---|---|---|
| oj 宿主 | ≥ **0.1.75** 原语；实录环境 0.1.78 | 生命周期链依赖 `exec.run` / `server.reloadConfig` / `yaml.parse` / `oj migrate --format json` |
| ojm 工具链 | `oj-module` 仓 `packages/cli/bin/ojm.mjs` | 已发布形态 = npm 包 `@oj-module/cli`（未发布前用仓内 bin 直跑，见 §5 坑①） |
| node / pnpm | 本机已有 | 方案工程**无需 node_modules**——共享依赖（react/antd/@oj-module/runtime）由宿主 importmap 外部化 |
| 数据库 | 由宿主提供 | sqlite / mysql / pg 均可；迁移走 `migrations/` 增量 |

> ⚠️ 本文所有真机命令与路径以 **oj 0.1.78 + oj-module `feat/lifecycle-p1`** 教学实录为准；不同宿主版本可能需微调。

---

## 2. 从脚手架起步

分两条线：**宿主持有方（运维）准备站点** + **作者侧工程初始化**。

### 2.1 宿主持有方准备（一次性）

作者若自己搭本地宿主验证，按此四步。生产由运维完成。

**① 脚手架宿主工程**

```bash
cd /tmp && ojm init ojm-tutorial-host
# 产出完整宿主工程（框架模板 + bin/oj + api/config.yaml）
```

**② 换二进制（关键：npm 渠道滞后）**

`ojm init/vendor` 从 npm 装的 `@oj-bin/oj` 往往落后于你本地已装版本，缺生命周期原语。必须替换为运维安装版本：

```bash
cp ~/.local/share/oj/oj <host>/bin/oj
echo "v0.1.78" > <host>/bin/.oj-version   # 本地版本标记，缺了视为未安装
```

**③ 改端口**

`api/config.yaml` 缺省 9778，多站共存时改掉（实录用 9781）。

**④ 补授权段（安装器两把钥匙）**

模板已带 `exec` 白名单与 `platform` 段；`fs` 段当前缺省缺失，需手补：

```yaml
# api/config.yaml 节选
platform:
  modules: [_platform]
  root: dist
  exec:
    _platform:
      allow:
        - 'tar -tvzf ${path:archive}'
        - 'tar -xzf ${path:archive} -C ${path:dest}'
        - 'oj migrate --format json -d ${path:dir} ${raw:module}'

fs:
  root: .
  readonly: false
```

> 📌 **模板同步纪律（真机踩坑）**：`ojm init` 把模板**快照**进 `api/src`——此后模板更新不会自动到达已有站点。升级宿主 = rsync 模板 → 站点 `api/src/` → 重建 → **重启 serve**（oj 缓存已编译模块源，不重启跑旧代码）。

**⑤ 构建 + 起服务**

```bash
cd <host> && ojm build     # 后端 oj build → api/dist/<mod>-<ver>/；前端 → web/dist
ojm preview                # oj serve（release/js）+ 静态兜底反代
# oj serve listening on http://127.0.0.1:9781/api
```

**⑥ 首登改密（坑②）**

admin 首登强制改密，期间安装端点 403 `password change required`：

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:9781/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"123456"}' | jq -r .data.access_token)
curl -s -X PUT http://127.0.0.1:9781/api/auth/password \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"old_password":"123456","new_password":"<新口令>"}'
```

> 响应字段是 `data.access_token`（snake_case）；悬挂期 `restricted: true`，改密成功才换发正式 token。

### 2.2 作者侧工程初始化

```bash
# 当前：用仓内 bin 直跑（未发布）
node packages/cli/bin/ojm.mjs init my-solution
# 发布后：ojm init my-solution（npm 包形态）
```

最小起步五个文件见 §3。

---

## 3. 目录布局约定

### 3.1 方案工程（作者仓库）源码布局

```
my-solution/
├── package.json          # scripts: dev/build/preview（ojm）；无需 dependencies
├── web.config.ts         # 前端模块清单（name + entry 相对工程根）
├── manifest.yaml         # 方案清单（包身份证，C2 契约）
├── api/
│   ├── config.yaml       # 方案工程自己的 oj 配置（dev/serve 用）
│   └── src/<name>/       # oj 原生模块（目录名 === 方案名）
│       ├── manifest.yaml # 七键原生清单（C2-31 分层，作者一般不手写）
│       ├── schema.yaml   # 声明式表结构
│       ├── migrations/0001__init.sql
│       └── ping/api.ts   # 匿名健康探针
└── web/src/<name>/
    ├── entry.ts          # defineModule 单页
    └── locales/{zh-CN,en-US}.json
```

共享依赖一律不装——宿主 importmap 提供，构建期外部化。这就是方案工程零 node_modules 的原因。

### 3.2 打包产物（tgz 内布局，单根 `<name>-<version>/`）

```
<name>-<version>/
├── manifest.yaml                 # bundle 级契约清单（Form A）
├── api/
│   └── <name>-<version>/         # oj build 产物原样（仅 oj 原生七键）
│       ├── manifest.yaml         # 原生七键：name/desc/version/config/db/tables/deps
│       ├── schema.yaml
│       ├── migrations/
│       └── **/api.js             # 编译产物
└── web/
    └── modules/<name>/<version>/
        ├── entry.js
        └── *.css
```

红线：

- tgz **禁止携带 `modules.json`**（C2-31）——该文件由安装器在目标站点 upsert，携带即可能覆盖宿主清单。
- tgz **单根**；手搓打包易多一层 `dist/`（见 §10 坑⑧）。

---

## 4. 编写 manifest.yaml（作者填写清单 + 易错点）

> 完整字段语义、必填性矩阵、正则口径见 **`ARCHITECTURE.md`**。本节给「填写清单 + 易错点」。

### 4.1 填写清单（按块）

| 块 | 你填什么 | 易错点 |
|---|---|---|
| 身份 name/version | `name: demo-market`，`version: 0.1.0` | name 正则 `^[a-z][a-z0-9-]{0,63}$`；**`market` 是保留名，第三方不可用**（R9）；version 禁 `+`/`_`/`..` |
| summary | 单行非空 | 必须 === 原生清单 `desc`（C2-31 构建期核对） |
| changelog | **必填**（C2-08，R27） | string[] 每条对应一个用户可感知变更，勿写「修复若干问题」 |
| peerRuntime | 如 `">=0.1.78"` | P1 安装预检强制，对宿主 `versions.json` 比对，读不到即 fail-closed |
| api.module/prefix/tables | `api.module: <name>`，`api.tables: [note]` | `tables` 必须 === `schema.yaml` 表 keys |
| api.anonymous | 如 `[demo-market/ping]` | 首段必须 === 模块段；health 探针须匿名可达 |
| web.entry/integrity | `web.entry: modules/<name>/<version>/entry.js` | entry 版本段必须 === version；integrity 须手工回填（见 §5.2） |
| permissions/roles | code 强制 `<name>.` 前缀 | role name = `<name>.<role>`；权限码不得悬空引用 |
| routes | `category: main/admin/hidden` | `order` 建议 ≥200（框架项保留 <200 间隔带） |
| settings.groups | key 首段必须 === name | 禁止污染 `framework.*`（R24 所有权） |
| health | 可选，如 `/demo-market/ping` | 必须是 main 路由子路径 + 匿名可达（D14/Q-A：不强制） |

### 4.2 可运行样例（节选）

```yaml
name: demo-market
version: 0.1.0
summary: market 仓起步教学样例（C2 契约端到端验证）   # === 原生 manifest desc
changelog:
  - 初始化 note 表与 health 探针
peerRuntime: ">=0.1.78"

api:
  module: demo-market
  tables: [note]          # 必须 === schema.yaml 的表 keys
  anonymous: [demo-market/ping]

web:
  entry: modules/demo-market/0.1.0/entry.js
  integrity: sha384-KU1QC9B9tr+ytO94iON/LGpXt7y4FZgxLdtxEvHjW/3etI3GMiw2tvZFwHB+nbE1

routes:
  - path: /demo-market
    category: main
    order: 200
    title_key: demo-market:menu.main

settings:
  groups:
    - group: general
      label_key: demo-market:settings.group.general
      items:
        - key: demo-market.greeting
          type: string
          default: "hi"

health: /demo-market/ping
```

### 4.3 分层红线（OJ-X）

- bundle 级 `manifest.yaml`（C2 契约全字段）**≠** 原生级 `api/<name>-<version>/manifest.yaml`（仅 oj 原生七键）。
- **严禁把 bundle 字段混入原生级文件**——oj 对未知键静默忽略，上游收紧解析即全量炸装。
- 三处 name/version/desc 必须逐一相等：bundle `name/version`、bundle `summary`（→ 原生 `desc`）、原生 `name/version`。

---

## 5. 全栈构建

### 5.1 ojm build

```bash
cd my-solution && ojm build
# oj build: demo-market v0.1.0 → api/dist/demo-market-0.1.0
# [ojm] 已合并宿主站点 → web/dist
# [ojm] 清单已生成 → web/dist/modules.json
```

产物（布局逐字对齐，勿手搬）：

```
api/dist/demo-market-0.1.0/     # oj build 产物（原生清单+迁移+api.js+schema）
web/dist/modules/demo-market/0.1.0/entry.js
web/dist/modules.json           # 构建器写出的前端清单（integrity 真源）
```

> ⚠️ `api/dist/<name>-<version>.tgz` 是 oj build 顺手产的 per-module 包，**不是安装源**（坑⑥）。只认 `ojm build --bundle` 产物。

### 5.2 integrity 回填（坑④：当前须手工）

`ojm build --bundle` 目前只对 `web.entry` 做**存在性**复核，不自动回填 integrity（自动化随 P1-16 评估）。作者流程：从 `web/dist/modules.json` 把构建器算好的 integrity 镜像进 C2 清单：

```yaml
web:
  entry: modules/demo-market/0.1.0/entry.js
  integrity: sha384-<从 modules.json 复制>
```

### 5.3 打包（确定性 tgz）

```bash
ojm build --bundle
# [ojm] 方案包已生成 → dist/demo-market-0.1.0.tgz
# [ojm] sha256：c4ec192c...（确定性：同输入两次打包字节一致）
```

**构建即校验两道闸**（坏清单出不了包）：

1. 契约校验（字段/白名单/保留名/键空间）→ 可读违规清单；
2. 文件面校验（`tables`↔`schema`、C2-25 `locales` 双语齐备）。

确定性打包（C2-32）：固定 mtime=0、成员字典序、权限 0644/0755、无 owner——sha256 即发布完整性锚。

---

## 6. 本地开发调试

### 6.1 本地起服务（宿主侧）

```bash
cd <host> && ojm build && ojm preview
# oj serve listening on http://127.0.0.1:9781/api
```

### 6.2 reload 热更与 isolate 沙箱调试

- 安装/升级走状态机，末端 `reloading` 触发 `server.reloadConfig()` 热更——**不重启站点**即生效（实测：装完刷新页面即见菜单）。
- isolate 缺面调试（真机踩过）：无 `structuredClone`/`copyFile`/`randomUUID`/`sha384`——这些是安装器内部适配点，作者一般不直接碰；若你写自定义原生模块逻辑用到，请自查 oj isolate 全局面。

### 6.3 安装期冒烟

安装器自动跑冒烟：优先打 `manifest.health` 端点；缺省打首个非匿名路由断言 200。任一失败按 §11 三分法处置（锁后失败 = 已生效/部分生效，先禁用或回滚，不盲目重装）。

### 6.4 日志与状态观测

| 观测点 | 动作 |
|---|---|
| health 探活 | `curl http://127.0.0.1:9781/api/<name>/ping` → `{"pong":true,...}` 200 |
| 迁移真跑 | 看 `api/db.sqlite.bak-<ts>` 与 `note` 表是否建好 |
| 锁与 sidecar | `api/dist/manifests.yaml` 增 `<name>: <version>`；`api/modules/.solutions/state.yaml` 有记录 |
| 前端落位 | `api/dist/modules.json` 含 `<name>` 条目（integrity 为部署产物重算值） |
| 幂等 | 再跑一次安装命令 → no-op 完成 |

### 6.5 常见报错解读

| 报错 | 含义 | 指向 |
|---|---|---|
| 403 `password change required` | 首登未改密 | §2.1⑥ |
| 500 `fs not configured` | 宿主缺 `fs:` 段 | §2.1④ |
| `C2-09 peerRuntime fail-closed` | 宿主 `versions.json` 读不到或不匹配 | §4.1 / §12 |
| 打包列出缺失 i18n key（zh+en 各一遍） | C2-25 双语 fail-fast | §6.6 |
| `sig_missing` 拒装零落盘 | 裸包缺签名（P2 起硬 fail-closed） | §8 / §12 |

### 6.6 i18n 双语齐备（C2-25，fail-fast）

entry/handle 引用的每个 i18n key，以及 manifest 引用的 perm/role/settings 全部 `title_key`/`label_key`，都要在 `locales/zh-CN.json` **和** `en-US.json` 里落齐。首次打包常因此 fail-fast（8 项违规全量列出）。

```json
// locales/zh-CN.json
{ "demo-market:menu.main": "教学样例", "demo-market:settings.group.general": "通用" }
// locales/en-US.json
{ "demo-market:menu.main": "Demo", "demo-market:settings.group.general": "General" }
```

---

## 7. 第一方特权面警告（R29）

**核心事实**：`/api/_platform/market/*` 编排端点（meta/index/install/task）与十阶段状态机归 `_platform` 特权模块——依赖 `exec.run`、共享根 FS、`reloadConfig`，普通方案经 RBAC 隔离**拿不到**。

- **端点门（R9）**：`assertSuperAdmin` 独占 + module=market 已安装启用双重校验。
- **`market` 是保留名**（C2-01）：第三方取名 `market` 或自 declare `market.*` 权限码均被拒。
- **误用失效形态**：第三方页面照抄 oj-market 的编排调用 → superadmin 登录下「看起来能用」，admin/普通管理员一律 403——功能静默降级为仅超管可用，且你无法修复（门不在权限码层）。
- **正确接入面**：一切经契约——声明路由分类 / 权限 / 角色 / 设置分组 / 匿名路径（§4）+ `sys_setting` 键所有权（R24）+ i18n 命名空间（D4）。需要界面就声明 `admin`/`main` 路由进菜单，需要持久化就声明表与设置项。

> 样例义务：oj-market 对 `_platform` 调用处带「第一方专用」显式注记（R29）。你写方案时**不要**直呼特权端点。

---

## 8. 打包与发布

### 8.1 打包

```bash
ojm build --bundle        # 出包（只出包不签名，见下）
```

### 8.2 签名（Ed25519，P2 起）

主路径（P2 起带签名，G4 硬 fail-closed——裸包 `sig_missing` 拒装）：

```bash
# 没有密钥先生成（一次性）
ojm keygen --id <publisher>.<key-name>

ojm sign dist/demo-market-0.1.0.tgz --id <publisher>.<key-name> --check
# 写同目录 detached 侧车 demo-market-0.1.0.tgz.sig
```

签名规范串 = `<name>@<version>:<sha256>`（canon="v1"）；侧车字段 `alg/key_id/public_key/value/canon`。

> 首次向陌生站点发布会落 `needs_trust`（TOFU 双轨第二轨）：把安装输出里的公钥指纹发给运维核对，运维 `ojm trust confirm --task <id>` 后重跑安装。

### 8.3 上传 bundles / CDN（分发）

- **P1 过渡**：本地静态分发源——任意 oj 工程 `mounts` 加一行 `web:` 指向**独立分发目录**（严禁指向 `api/modules/` 或其父级，R13 泄漏红线）；索引 `bundles.yaml`/`manifests.yaml` 必须 `Cache-Control: no-cache`，tgz 内容寻址可长缓存（R15）。配好后 `ojm install name@version` 走真实下载/校验链。
- **P3 起**：`ojm publish` 填充 Form B archive 段 + 重算索引 + no-cache 头。

发布方无需自行精简旧版本（GC 保留 N=3 按安装时间序，R25）。

---

## 9. 安装十阶段实况（作者侧视角）

瘦客户端旅程：登录 → Bearer → multipart 上传 → `POST /api/_platform/market/install` → 轮询 `task?id=`（800ms 起步指数退避、5s 封顶、30min 总超时）→ 终态渲染（失败输出 reason + retryable + 双语指引）。

```bash
ojm install dist/demo-market-0.1.0.tgz \
  --site-url http://127.0.0.1:9781 --user admin --pass '<新口令>'
```

服务端状态机十阶段（实录全绿）：

```
preflight   ✅ manifest 满足 C2 契约（身份/兼容/占用/匿名/RBAC/路由/设置/health）
downloading ✅ upload.tgz → modules/.staging/upload.tgz
verifying   ✅ sha256 与索引一致（C2-29；P1 无签名阶段）
extracting  ✅ 单根归平解压（C2-31 复核）
migrating   ✅ 迁移已应用（备份 db.sqlite.bak-<ts> 保留 3 份；迁移成功才落锁，D11/R2）
lock_commit → 生效切换（写锁 + 四处同写）
registering → RBAC/路由/设置注册
deploying   → 前端产物落位 + modules.json upsert
reloading   → 热更生效断言
smoking     → 探活/integrity/注册一致性
```

**状态机（install → upgrade → downgrade → enable/disable → uninstall）**：

- 升级/降级 = 同命令不同 version；
- 同版本重装 = no-op（前向-only 账本去重，AC-P1-3）；
- 降版被 rollbackGuard 拒（R12 红线：仅「迁移无差异」降级放行）。

> 终局实录（oj 0.1.78 全绿）：`[ojm] 安装完成：demo-market 0.1.0`——十段全绿 + 幂等重装二次 done。
> 已知接线缺口（P1-16）：装后 `GET /api/<name>/ping` 当前 404——安装器版本目录落 `modules/` 而 release serve 读 `dist/`，市场端点全绿但路由上线需 sharedRoot 与 serve 根对齐（接线后删此注）。

---

## 10. 常见坑速查表（九坑，现象→原因→解决）

| # | 现象 | 原因 | 解决 |
|---|---|---|---|
| ① | `ojm init/vendor` 装 `@oj-bin/oj` 缺原语 | npm 渠道滞后 | 宿主换 `~/.local/share/oj/oj` + `.oj-version` 标记（§2.1②） |
| ② | install 报 403 `password change required` | 首登强制改密 | 先经 `/api/auth/password` 改密（§2.1⑥） |
| ③ | install 报 500 `fs not configured` | config 缺 `fs:` 段 | 补 `fs: {root: ., readonly: false}`（§2.1④） |
| ④ | 打包只存在性复核，无 integrity | 自动化未接线 | 从 `modules.json` 镜像 integrity 进清单（§5.2） |
| ⑤ | 打包列出缺失 i18n key | C2-25 双语 fail-fast | manifest 引用的 perm/role/settings/menu key 在两份 locales 落齐（§6.6） |
| ⑥ | `api/dist/<name>-<version>.tgz` 误当安装源 | per-module 包非安装源 | 只认 `ojm build --bundle` 产物 |
| ⑦ | preflight C2-09 fail-closed | 宿主 `versions.json` 缺失 | 宿主 `api/dist/versions.json` 补 `{"@oj-module/runtime":"…"}` |
| ⑧ | 手搓 `tar czf x.tgz dist` 解压非合法根 | 多一层 dist/ | 只用 `ojm build --bundle`（内部单根组装） |
| ⑨ | 裸包被拒 `sig_missing` | P2 起 G4 硬 fail-closed | `ojm sign dist/x.tgz` 生成同目录 `.sig` 侧车后重装 |

---

## 11. 与上游 oj-bin 的关系（影响开发者的点）

来自 `202610161500-oj-bin-feature-requests-pr.md`（OJ-1~9），终裁状态如下：

| 编号 | 原始诉求 | 终裁状态 | 对开发者的意义 |
|---|---|---|---|
| OJ-1 / PR-2 | tgz 解压内建 | ✅ 已落地（oj 0.1.75，形态 = `exec.run` + 系统 tar 三步范式） | 安装器解压已可用；Windows 缺 tar 仍受限（见 OJ-8） |
| OJ-2 / PR-3 | 热更进程内触发 | ✅ 已落地 `server.reloadConfig()`（限 platform 特权模块） | 安装末端热更不重启生效 |
| OJ-3 / PR-5 | YAML 只读解析 | ✅ 已落地 `yaml.parse`（**异步须 await**，三预算防炸弹） | 安装器读 manifest/config 已用；作者不直接碰 |
| OJ-4 / PR-1 | Ed25519 验签 | ✅ 已落地 `crypto.verifyEd25519` | 支撑 P2 签名 fail-closed |
| OJ-5 / PR-6 | 远程 api mount | ❌ 维持远期（不提） | 不阻塞；CDN 只做下载源 |
| OJ-6 / PR-4 | migrate 内化 | ❌ **未采纳**——exec 子进程即永久主路径 | 迁移走 `exec.run oj migrate`，超时 `timeoutMs ≤ 600_000`（10min），超请分块 |
| OJ-7 | 表级写守卫 | 持续跟踪；`_platform` 为结构性豁免面 | 方案间写隔离由框架保证 |
| OJ-8 / PR-7 | Windows 缺 tar 报错契约 | ❌ **未采纳（2026-10-17）** | Windows 走显式 `cmd /c tar ...`；优先 macOS/Linux 验收，Windows 是已知限制 |
| OJ-9 / PR-8 | down 迁移支持 | ❌ **未采纳——前向-only 定版** | 回退 = 作者手写补偿迁移 + `oj migrate --format json` 读账本人工决策；R12 降级仅「迁移无差异」放行 |
| PR-9 | isolate 补 sha384 原语 | 待提（非阻塞） | P1-13b 用纯 JS 过渡 `sha384.ts` 顶住；作者无需关心（web.integrity 自动计算） |

**作者侧规模约束（oj 0.1.78 文档化）**：安装器经 `exec` 跑 `oj migrate`，平台硬上限 `timeoutMs ≤ 600_000`（10 min）、输出 10 MiB——单次迁移须 10 min 内完成，超限请分块（多个顺序迁移文件）。

---

## 12. 已知限制与待确认（需人工拍板的矛盾）

以下为各真源间**未完全收口**或**需人工确认**的点，按来源标注，未静默篡改：

1. **OJ-8 状态矛盾**：教学实录正文（§8 坑⑦/§2.1 上下文）将 OJ-8 记作「P1-16 接线点 / 手工补 fs 段」之一；而 oj-bin PR 文本与设计 §6.2 均标注 **OJ-8 终裁未采纳（Windows 报错契约）**。本文 §2.1④ 与 §10 坑③按「fs 段需手工补」的**真机实操口径**写（不影响 OJ-8 自身终裁状态）；两处指的不是同一件事，但命名易混，已单列说明，建议文档层面厘清命名。

2. **版本目录落位 404（P1-16 接线缺口）**：装后 `GET /api/<name>/ping` 当前 404——安装器版本目录落 `modules/`（sharedRoot 缺省）而 release serve 读 `dist/`。市场端点/安装链全绿但路由上线需 sharedRoot 与 serve 根对齐。来源：教学实录 §6 终局注记。

3. **integrity 自动回填缺口**：`ojm build --bundle` 当前只做存在性复核，不自动将 integrity 写回清单（§5.2）。自动化随 P1-16 评估。来源：教学实录 §5.2 + devkit 提纲 §1.3。

4. **versions.json 接线**：宿主 `api/dist/versions.json` 当前需手工补（坑⑦），P1-13b 合入后自动接线。来源：教学实录 §8 坑⑦ + 契约附录 B-11。

5. **OJ-9 与 R12 措辞**：设计 §6.2 与 PR 文本均确认「前向-only 定版，down 迁移不采纳」；但部分 PRD 旧片段仍残留 down 迁移增强讨论，本文以**终裁不采纳**为准。

6. **peerRuntime 真源路径**：契约 C2-09 称比对宿主 `versions.json`；devkit 提纲 §1.1 写 `api/dist/versions.json`；教学实录坑⑦写宿主 `api/dist/versions.json`。三处一致，但**作者工程侧无此文件**，由宿主持有——作者在 manifest 声明 `peerRuntime` 即可，无需自建。

7. **发布形态分期**：P1 = 本地 tgz + 手工静态分发源；P3 起 `ojm publish` 自动化。本文 §8.3 已分述，作者当前预期应以 P1 过渡口径为准。

---

> 本文与 `ARCHITECTURE.md`（完整契约字段语义、RBAC/安全模型）及 devkit 手册「打包与分发」章节互为配套。凡本文未尽的字段语义，一律以 `ARCHITECTURE.md` 与契约 v1.3 为准。
