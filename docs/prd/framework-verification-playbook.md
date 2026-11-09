# 框架端到端验证手册（可重复演练）

> **用途**：框架升级（`contract`/`runtime`/`shell`/`cli` 发新版，或 oj 升级）后，**从零**跑通「脚手架 → 依赖 → 契约 → 后端 → 前端 → 构建 → 运行」，一次确认整条链路没有回归。
> **配套**：[`framework-development-guide.md`](./framework-development-guide.md)（原理）、[`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md)（跟做）。
> **原则**：每一步都有**可判定通过/失败的检查点**，不要只看命令退出码，要核对产物。

## 先选一条线

| 线 | 覆盖 | 用时 | 何时跑 | 入口 |
|---|---|---|---|---|
| **快线** | 本仓 `packages/cli/templates/` 工程：版本矩阵 → 契约对账 → 构建 → dev 起服 → 登录/业务接口 → 发布凭证兑换 | ~5 min | 每次改 `templates/`、`runtime`、发布链路 | §0.3 |
| **全量线** | 快线 + `pnpm pack` 发布包 → 新工程 `ojm init` → 依赖安装 → §1–§7 全套 | 15–20 min | 发版前、oj 升级后 | §0 → §0.5 → §1… |
| **市场线** | §7.1–§7.5：方案骨架 → 发布 CDN → 安装/TOFU/升级 → walkthrough 14 项 | ~10 min | 动 `market`/安装器/签名时 | §7.1 |
| **市场 Phase B 线** | §7.6：出厂即装态核对（dev/preview 就绪自动收敛）→ 降级守护 → 卸载墓碑（动安装器/编排面/模板 config 时必跑——单测注入面绕不过平台授权与装配层，见文首） | ~10 min | 动安装器/`oj-market` 编排面/模板 config 时 | §7.6 |
| **市场闭环线** | §7.7：`ojm new` 造方案 → 签名发布进目录 → 按名从市场安装 → 两段式终态（复用 §7.6 装好市场的站点） | ~10 min | 动发布链路/安装器/市场目录时 | §7.7 |

判据只有一条：**每节的检查点逐条打勾**——退出码 0 只是入场券，产物与响应体才算数。
历史演练记录集中在文末 [附录 A](#附录-a-历史基线从新到旧逐条可追溯)，日常执行不用读。

> **上次演练结论（2026-11-08 全量线，cli/runtime 0.2.76 打包态 / oj 0.1.126）**：**通过**——
> §0.5 pack（prepack 收编已签名 oj-market-0.2.3，只留最高版本）→ §1 `init --yes`（bundle 三件套
> cdn 落位）→ §2 依赖（本地 registry 滞后 → `pnpm-workspace.yaml` overrides 钉 cli+runtime 两个本地
> tgz）→ §3 oj 探针 → build/info/api --check 全绿 → §6 dev（登录/通知/无 token 401/SPA/importmap/
> 市场 entry 200）→ 浏览器实测市场卡（停用 + 卸载均 disabled 且带说明）→ §7 preview 单服务（迁移账本
> / 静态 / 编排端点 / api --check 第三腿全绿）→ §7.6 A dev 出厂即装收敛（state 0.2.3 / trusted /
> modules.json 并入 / api 锁零变更）、B 纯 `oj serve` 首请求 riding 收敛（全新工程，无 TOFU）、
> C 幂等 + 降级守护 + 第一方卸载保护 → §7.4 walkthrough 13/13 → §6.5 `pnpm test` 992/992
> + templates 1160/1160。实锤并修复 **1 个数据面缺陷**：安装落盘的 `web.integrity` 成了
> `sha384-sha384-…`（sha384 面自带前缀 + 三处调用各拼一次，三方自洽互相掩护），见 §9。
>
> **上次演练结论（2026-11-07 第二轮，cli/runtime 0.2.71 打包态 / oj 0.1.124）**：**市场全链路闭环通过**——
> 发布形态 pack → `init --yes` → 收敛装市场（信任空窗 needs_trust → 推公钥 → 收敛 done、api 锁零变更、
> 双轨目录并存）→ `ojm new` 造 books 方案 → `market publish --real` 进目录 → `ojm install books`
> 按名从市场装（两段式：reloading partial → 重启 oj serve → retry → done）→ 锁/版本目录/ping/index
> 四重落点核对全绿。实锤一个拓扑坑：module-root 工程 `oj serve --api-path dist/api` 缺省把 API 绑在
> `/v1/api`，而框架（web 应用 + market/install CLI）一律走 `/api`——必须 `-b /api` 起站（§7.7 / §9）。
>
> **上次演练结论（2026-11-07 第一轮，cli/runtime 0.2.71 工作区 / oj 0.1.124）**：**市场线 Phase B 增量演练（§7.6）通过**——
> 发布形态 pack → `init --yes` 随站 bundle 落位 → 出厂未装态 → index 端点收敛首装（11 段全 ok——
> 该轮仍是首装期口径；当日稍后策略已变更为出厂即装，见 §7.6）→
> 页面/编排双活 → 降级守护 skip → 卸载墓碑闭环。演练实锤 **6 个真机缺陷**（单测全注入 exec/reload/fetch
> 绕过平台授权与 oj 装配层，此前从未真机暴露）并全部 TDD 修复：exec 授权、platform 特权、web-only 部署
> 段回落、web-only 锁零变更、卸载版本解析 sidecar 优先、双轨同名 reload 断言豁免（详见附录 A 首条与 §9）。
> 11-06 基线（快线 + 门禁 + 仓库回归）结论仍有效，见附录 A 次条。

> **退出码会被管道吞掉**：`node ojm.mjs xxx 2>&1 | tail` 之后 `$?` 是 `tail` 的退出码。
> 判「命令是否失败」时先落文件再看 `$?`（`cmd > out 2>&1; echo $?`），别用管道末尾的值。

> **演练为什么能抓到单测抓不到的缺陷**（2026-11-07 总结，六连修的共同根因）：生命周期单测全走
> DIP 注入（exec/reload/fetch/fs stub），验证的是**编排逻辑**；而 oj 平台的**授权层**（per-module
> exec / platform 特权）与**装配层**（锁驱动 parse_one）只在真机存在。改编排链路后必须跑一次
> §7.6 真机形态。

---

## 0. 准备（干净目录）

```bash
export VERIFY_DIR=/tmp/ojm-verify
export OJM_REPO=/Users/ever/git/only-js/oj-module   # 按实际改
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
```

需要：Node 18+、pnpm、**网络**（下载 oj 与 npm 包）。全量线预计 15–20 分钟；日常回归用 §0.3 快线（约 5 分钟）。

> **npm 通道滞后时的两条旁路**（2026-10-15 演练实测）：
> 1. **oj**：`MIN_OJ_VERSION` 门禁钉最新发布版（0.1.20 起为 **0.1.73**），而 npm `@oj-bin/oj` 的 latest 可能仍低于门禁 → `ojm vendor`/`ojm init` 的下载步被拦。旁路：先把本机 oj（≥ 门禁）连同 `devkit/`、`plugins/`、`.oj-version` 预置进工程 `bin/`，`ojm init` 对已有 `bin/oj` 会跳过 vendor（init.ts：bin/oj 存在即 `report.skipped`），效果等价。（2026-10-19 实测：oj latest 已 0.1.80 ≥ 门禁，本条旁路未触发。）
> 2. **框架包自身**：待发版本（如 0.1.20 未上 npm）`pnpm install` 会 `ERR_PNPM_NO_MATCHING_VERSION`。旁路：删 devDeps 里的 `@oj-module/cli`（CLI 用源码 bin 直跑），`@oj-module/runtime` 装好后手工 symlink 到仓库 `packages/runtime`（其内部依赖经 realpath 回落仓库 node_modules 解析，与 playground-oj 的 workspace 链接等效）。注意 `file:` 链接不行：两个包都用了 pnpm `catalog:` 协议，只对 workspace 成员解析。
>    **cli 与 runtime 双双未发版时**（2026-10-19 实测形态）：两个 devDep 都要删，再 `ln -s $OJM_REPO/packages/runtime node_modules/@oj-module/runtime`。Node 侧只有 `@oj-module/runtime/contract` 子路径会被真正求值（`ojm api` 用）；浏览器包本体 import `antd/locale/*` 在裸 Node 下报 extensionless 是**预期**，不影响链路。另：本机 pnpm store 已预热时 `pnpm install --offline` 可绕开 registry 限速（实测 1.6s，见 §9）。

## 0.3 快线：本仓模板工程（每次改动都跑）

不新建工程、不 pack，直接在 `packages/cli/templates/` 上跑，覆盖「契约 → 构建 → 运行 → 发布身份」四段。
**一律用源码 CLI**：`node ../bin/ojm.mjs`（它用 `import.meta.resolve("tsx")` 直接加载 TS 源码，与仓库代码同步）。

> 为什么不用全局 `ojm` / `pnpm exec ojm`：宿主与工程的 runtime 必须**版本严格相等**（C4/D12 门禁）。
> 本机全局可能是旧版（实测 0.2.25 vs 工程 0.2.66），`ojm dev` 会直接拒跑并报「严格相等校验失败」——
> 那不是回归，是门禁在拦混用。要跑发布包形态请走 §0.5 全量线。

```bash
cd "$OJM_REPO/packages/cli/templates"
node ../bin/ojm.mjs info           # 版本矩阵：宿主 runtime 与工程安装版本应一致
node ../bin/ojm.mjs api --check    # 契约 / 生成物 / routes.js 三方对账
node ../bin/ojm.mjs build          # → dist/api（后端产物）+ dist/web（站点产物）
```

- [ ] `info` 的 runtime 版本 === `node_modules/@oj-module/runtime/package.json` 的 `version`
- [ ] `api --check` 末行 `0 error / 0 warn`（dist 已存在时第三腿 routes.js 生效）
- [ ] `dist/api/versions.json` 存在；`dist/web/modules.json` 是数组且含 `app`

起 dev（真实 HTTP）：

```bash
# 迁移账本压平后，老库会报「applied migration V1__create_users is different than filesystem one V1__baseline」。
# 真库路径是 templates/db.sqlite（config.yaml 的 sqlite://db.sqlite 相对 config 所在目录）；
# api/db.sqlite 是历史残留，不要删它当解法。压平不提供 shim，删库重建是唯一解。
rm -f db.sqlite db.sqlite-shm db.sqlite-wal
node ../bin/ojm.mjs dev
```

- [ ] 日志出现 `routes: N method-row(s)` 与 `input contracts: M ...`（本机实测 90 / 86），末尾 `oj serve listening`
- [ ] `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9778/api/auth/login` → **405**（路由在，只是方法不对）
- [ ] 登录 `superadmin / aA123456` 返回 `code:0` 且 `data.access_token` 非空
- [ ] 拿**普通用户**走一遍发布身份（发布凭证是登录用户就能申请，不要求超管；也验证建号→改密链路）：

```bash
TK=$(curl -s -X POST http://127.0.0.1:9778/api/auth/login \
  -H 'content-type: application/json' -H 'X-TENANT-ID: default' \
  -d '{"username":"superadmin","password":"aA123456"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.access_token')

# 1) 超管建普通用户（默认 must_change=1，即首次登录必须先改密）
curl -s -X POST http://127.0.0.1:9778/api/system/users \
  -H 'content-type: application/json' -H 'X-TENANT-ID: default' -H "authorization: Bearer $TK" \
  -d '{"username":"publisher01","password":"pub123456","displayName":"普通发布者"}'
# 期望 code:0 + data.id

# 2) 普通用户首次登录 → 改密（不改密，所有写接口都是 403 password change required）
PT=$(curl -s -X POST http://127.0.0.1:9778/api/auth/login \
  -H 'content-type: application/json' -H 'X-TENANT-ID: default' \
  -d '{"username":"publisher01","password":"pub123456"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.access_token')
curl -s -X PUT http://127.0.0.1:9778/api/auth/password \
  -H 'content-type: application/json' -H 'X-TENANT-ID: default' -H "authorization: Bearer $PT" \
  -d '{"old_password":"pub123456","new_password":"pub654321"}'
# 期望 code:0 + 新的 access_token；用它替换 $PT

# 3) 普通用户申请凭证 → key_id 的人名段必须是本账号
TOKEN=$(curl -s -X POST http://127.0.0.1:9778/api/publish/credential \
  -H 'content-type: application/json' -H 'X-TENANT-ID: default' -H "authorization: Bearer $PT" \
  -d '{"product":"quickline-demo"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.token')

# --out 用绝对路径：相对路径按进程 cwd 解析，脚本里容易落到仓库根
node ../bin/ojm.mjs keygen --credential "$TOKEN" \
  --site-url http://127.0.0.1:9778 --out /tmp/quickline-keys --yes
```

- [ ] 改密前直接申请凭证 → **403 `password change required`**（悬挂期只放行改密）
- [ ] 申请返回 `key_id=quickline-demo.publisher01`（人名段 = 账号归一化，不是超管）
- [ ] 打印 `凭证已兑换：产品 quickline-demo / 申请人 普通发布者（publisher01）`，`/tmp/quickline-keys/` 有 `private.pem` + `public.hex`
- [ ] 同一 token 再兑一次 → 打印「发布凭证无效或已失效…」且**退出码 1**、不写入任何密钥文件
- [ ] 列表可见性：普通用户看到自己的 1 条、**没有** `owner_tenant` 字段；超管看到全部且带 `owner_tenant`
- [ ] 列表中该条 `status=used`、`used_at` 非空
- [ ] 用这把密钥做签名自检（没有用户方案包时，拿 `dist/<模块>-0.1.0.tgz` 代替即可）：

```bash
node ../bin/ojm.mjs sign dist/web-0.1.0.tgz --id quickline-demo.publisher01 \
  --key /tmp/quickline-keys/private.pem --registry-id oj-registry --check
# 期望：[ojm] 自检通过：签名与包体匹配（指纹 …）
```

- [ ] 停服：`pkill -f "bin/ojm.mjs dev"`

> 快线覆盖不到打包差异（prepack 同步 devkit、`.gitignore` 被 pack 剥离、shell-dist 无 sourcemap）——
> 这些只在 §0.5 的 tarball 形态里才现形，所以发版前仍必须走全量线。

## 0.5 发布形态准备（默认；与发包逐字节一致）

> **为什么必须有这一步**（2026-10-19 0.2.5 实测教训）：源码树跑演练会漏掉**打包差异**——npm/pnpm pack 会剥离 `.gitignore` 等 VCS 点文件、prepack 才同步 `devkit/` 与 `vendor/host-versions.json`、`shell-dist` 不带 sourcemap。源码树里 `templates/.gitignore` 存在、演练全绿；发布包里它不存在，`readInitInclude` fail-fast 把 `ojm init` 整个打挂（用户工程只剩空目录）。**演练用源码树 = 没验到用户真正装到的东西。**

```bash
export CLI_PKG=/tmp/ojm-verify/cli-pkg          # 解包后的 cli 发布包（后续 ojm 调用一律走它）
mkdir -p /tmp/ojm-verify
pnpm --dir "$OJM_REPO/packages/cli" pack --pack-destination /tmp/ojm-verify
tar -xzf /tmp/ojm-verify/oj-module-cli-*.tgz -C /tmp/ojm-verify
mv /tmp/ojm-verify/package "$CLI_PKG"

# pnpm ≥11：cli 依赖 esbuild，postinstall 默认被拦（ERR_PNPM_IGNORED_BUILDS）。解包目录先放 allowBuilds
printf 'allowBuilds:\n  esbuild: true\n' > "$CLI_PKG/pnpm-workspace.yaml"

# 双包未发版时（npm 上还是旧版本）：runtime 先 pack，再把 cli 的精确版本依赖改成本地 tgz
pnpm --dir "$OJM_REPO/packages/runtime" pack --pack-destination /tmp/ojm-verify
node -e "const fs=require('fs');const f='$CLI_PKG/package.json';const p=JSON.parse(fs.readFileSync(f,'utf8'));p.dependencies['@oj-module/runtime']='file:../oj-module-runtime-<ver>.tgz';fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')"

pnpm install --dir "$CLI_PKG"                    # 发布包 manifest 已被 pnpm pack 改写为真实 semver，可独立安装
```

后续所有 `ojm` 命令走 `$CLI_PKG/bin/ojm.mjs`（**不要**再走 `$OJM_REPO/packages/cli/bin/ojm.mjs`）。runtime 未发版时：在 my-books 里 `pnpm add -D <runtime 本地 tgz>`（同样先 `pnpm --dir packages/runtime pack`）——**务必 `-D` 装进 devDependencies**，否则 `ojm build` 的 C4/D12 门禁会拒（`@oj-module/runtime` 是硬共享依赖，禁止进 `dependencies`，由宿主 importmap 统一提供，自带产生双实例）；§0 旁路 2 的 symlink 仅作 store 不全时兜底。**pnpm ≥11 的 overrides 只认 `pnpm-workspace.yaml` 的 `overrides:` 段，写在 `package.json` 的 `pnpm.overrides` 会被忽略**（2026-11-02 实测：只改 package.json 仍去 npm 找 0.2.53 报 404）。整体通过后如需确认 registry 形态，再 `pnpm dlx @oj-module/cli@<ver> init` 复跑一次 §1。

> **本机 registry 滞后时的最省事形态（2026-11-08 实测两次）**：`ojm init` 生成的 devDeps 和 cli 自身的
> `dependencies` 都是**精确版本**，verdaccio/npm 没同步该版本时两处都会 `ERR_PNPM_NO_MATCHING_VERSION`。
> 在工程 `pnpm-workspace.yaml` 的 `overrides:` 里**同时**钉住 `@oj-module/cli` 与 `@oj-module/runtime`
> 指向本地 tgz 即可（`package.json` 的 `pnpm.overrides` 在 pnpm ≥11 被忽略）；只钉 runtime 不够——
> 工程 devDeps 里的 cli 精确版本仍会去 registry 找。

## 1. 脚手架（`ojm init`）

```bash
# 发布形态（默认，§0.5 准备）：与用户 `pnpm dlx @oj-module/cli@x.y.z init` 装到的逐字节一致
node "$CLI_PKG/bin/ojm.mjs" init my-books --yes
# 仅当明确要验证「源码树当前代码」时才用源码 bin（注意：会漏打包差异，如 .gitignore 被 pack 剥离，见 §9）
# node "$OJM_REPO/packages/cli/bin/ojm.mjs" init my-books --yes
```

**检查点**

- [ ] 退出码 0，末行提示 `登录 superadmin / aA123456`（角色账号见 devkit 手册 §1.1）
- [ ] 目录齐全（**module-root 布局，0.2.54+ 收敛到 `src/app`**）：`src/app/api/<name>`（六个后端模块：`_platform/auth/notification/personal-center/system/web`）+ `src/app/web`（六根）+ `src/oj-market/api`（编排面）+ `src/oj-market/web/{__client,publish/__client}`（**仅双 `__client` 生成物，无页面源码**——市场 UI 是第一方方案包**出厂即装**，web 面经版本目录重物化并入 modules.json，不经源码树）；顶层不再有 `src/<name>/{api,web}`。工程根 `.ojm-api-exempt.json`、`config.yaml`、`web.config.ts`、`tsconfig.json`、`global.d.ts`、`env.d.ts`、`bin/{oj,.oj-version,plugins,devkit}`、`.claude/skills/{oj-api-dev,ojm-module-dev}/`
- [ ] **（0.2.71+，Phase B）`init --yes` 随站 bundle 落位**：`cdn/<name>-<ver>.tgz` + `.sig` + `cdn/bundles.json` 意图标记（`{solutions:[{name,version,file}]}`）；交互式 init 零动作；bundle 源缺失告警不失败。发布后 cli 包内应有 `shell-dist/bundles/`（prepack `sync-bundles.mjs` 只收**已签名** tgz——`tar -tzf <cli-pkg>.tgz | grep bundles/` 核对）
- [ ] **（0.2.71+）模板 config 双授权就位**：`platform.exec` 有 `_platform` 与 `oj-market` **同集合** allow 条目（YAML 锚点 `&INSTALLER_EXEC_ALLOW` 同源）；`platform.modules: [_platform, oj-market]`（编排面 reload 特权）。守卫：`tests/lifecycle/exec-grant.spec.ts`
- [ ] **工程根有 `.gitignore`**（发布包不携带模板 `.gitignore`——npm/pnpm pack 剥离点文件，改由 init 现场生成，`ensureGitignore`；0.2.5 曾因 include 清单收录它而 fail-fast，见 §9）
- [ ] **工程根有 `openapi.json`**（新流水线唯一事实源，模板随附）+ `src/app/web/<root>/__client/` 预生成（`ojm api --check` 开箱即过）
- [ ] handler 契约为新约定：动词挂 `.schema`（params/query/body 入参）+ **平级 `.response`**（出参，oj v0.1.72+）；无 `contract.ts` / `routes.json` / `openapi.yaml`
- [ ] **分发的 devkit 自包含**：`.claude/skills/ojm-module-dev/` 三件套含 manual.md **§3.10 旧 contract.ts 工程迁移指南**；grep `docs/migration|docs/plans|../oj-api-dev` 应**零命中**（devkit 随 init 进业务工程，不能引用框架仓内部路径）；oj 侧 devkit 落在 `.claude/skills/oj-api-dev/`
- [ ] `package.json` 的 devDependencies **含** `@oj-module/{cli,runtime}`（两包时代；`contract` 是 runtime 子路径、shell 已并入 cli），且值**不是 `*`**
- [ ] 若出现「`@types/react` / `typescript` 回退 `*`」告警 → 记下，安装后必须钉版
- [ ] **未出现「oj 二进制自检失败」告警**（cli ≥ 0.1.4 安装后自动冒烟）；若出现，按 §3 换自建二进制
- [ ] npm 通道 oj 低于门禁时按 §0 旁路 1 预置 `bin/oj` 后重跑（init 幂等）
- [ ] **`src/.ojm-builtin.json` 存在**（内置模块自治名单，0.2.68+；删了它门禁就关——见 §1.5）
- [ ] **`src/README.md` 存在**（人话契约：默认模块上游自治、build 拦截、`--yes` 恢复、`enabled: false` 下线姿势）

## 1.5 内置模块自治门禁与 `--yes` 恢复（0.2.68+）

> 默认模块（`src/app` 内置模块、`src/oj-market`）**上游自治**：`ojm build` 先与**当前 CLI 包内 templates**
> 逐文件比对（门禁开关 = `src/.ojm-builtin.json` 存在），三类漂移（内容被修改 / 缺失 / 多出）都
> fail-fast 零产物。CLI 升级后，工程内旧版默认模块即使没手改也会与新模板不一致——**先 `ojm init --yes` 再 build**。
> `--yes` 只动 `src/app/**` 与 `src/oj-market/**`（覆盖白名单文件、删模板没有的文件、重写名单），
> 下游自定义模块与工程级配置（config.yaml / web.config.ts / package.json）不碰；会丢弃这些目录的本地修改，先备份。
> 门禁不是安全边界：无绕过开关，但删名单文件即退回旧行为（不建议）。

```bash
node "$CLI_PKG/bin/ojm.mjs" build; echo $?          # 新脚手架基线：门禁开、零漂移 → 0
printf '// drift\n' >> src/app/web/system/routes.ts # 篡改默认模块 + 造 extra
touch src/app/web/extra-page.tsx
node "$CLI_PKG/bin/ojm.mjs" build; echo $?          # 期望 1：分组列出「内容被修改 / 多出」，
                                                    # 报错含「上游自治」与「ojm init --yes」，且无新产物
node "$CLI_PKG/bin/ojm.mjs" init . --yes            # 恢复：覆盖白名单、删 extra、重写名单
node "$CLI_PKG/bin/ojm.mjs" build; echo $?          # 期望 0
rm src/.ojm-builtin.json                            # 旧行为退路：门禁关
node "$CLI_PKG/bin/ojm.mjs" build; echo $?          # 期望 0（篡改也放行——门禁已关）
node "$CLI_PKG/bin/ojm.mjs" init . --yes            # 名单重写回来，门禁重新生效
```

**检查点**

- [ ] 新脚手架 `.ojm-builtin.json` + `src/README.md` 就位，基线 build 通过（零漂移）
- [ ] 篡改默认模块（改内容 + 加 extra）→ build 退出码非 0，按「内容被修改 / 缺失 / 多出」分组列文件、指路 `ojm init --yes`，dist/ 无新产物
- [ ] `ojm init . --yes` 后：篡改恢复为模板内容、extra 被删；下游自定义模块（`src/crm`，须 `defineModule({name,version,…})` + `locales/` 齐备）与工程配置原样，且能进 `modules.json`
- [ ] 删 `src/.ojm-builtin.json` → 门禁关（旧工程语义，篡改也放行）；`init --yes` 后名单恢复
- [ ] §0.3 快线（templates 树自身）无 `.ojm-builtin.json`，门禁关——build 不受影响（预期）

> 自定义模块被 build 拦下时先看是不是自己的问题：entry 缺 `name`/`version`（必须 `defineModule`）
> 或缺 `locales/` 会先被 buildModules 校验拦——拦的是你的模块，不是门禁。

## 2. 安装依赖

```bash
cd my-books && pnpm install
```

**检查点**

- [ ] `node_modules/.bin/tsc` 存在；`@oj-module/runtime` 可解析（发行版走 npm；源码验证按 §0 旁路 2）
- [ ] 安装日志里 `@oj-module/{cli,runtime}` 版本与 `versions.json` 一致（源码验证时 cli 以 bin 直跑、`ojm info` 显示 `cli: unknown` 属预期）
- [ ] `pnpm exec ojm info`（或 `node "$CLI_PKG/bin/ojm.mjs" info`）输出宿主版本矩阵 + 模块清单，无报错
- [ ] 处理 §1 的 `*` 告警：把 `@types/react` / `typescript` 钉成实际安装版本

## 3. oj 二进制可用性（检查点）

```bash
./bin/oj --version                              # 期望：oj ≥ 0.1.73（MIN_OJ_VERSION 门禁；平级 .response 需 0.1.72+，del→delete 操作键归一需 0.1.73+）
strings bin/oj | grep -oE '/Users/runner/work/only-js/only-js/[^"]*\.js'
# 期望：**空**（无泄漏的 JS 构建路径）。注意：`grep -c "/Users/runner"` 不再适用于判据——
# 即便修复后仍会命中 cargo registry 的 panic 路径（如 h2/unsafe-libyaml），属正常。
```

**已知缺陷（v0.1.12 已修复）**：GitHub release 的 oj 二进制曾由 CI 构建，JS 扩展源码被标记为
`LoadedFromFsDuringSnapshot` 且把**构建机路径**烤进二进制；在非 CI 机器上
初始化 JS 运行时报：

```
Failed to initialize a JsRuntime: No such file or directory (os error 2)
```

`./bin/oj --version` **仍会成功**（Rust 侧），所以 v0.1.12 之前必须向下走一步才会暴露。
**v0.1.12 起 JS 源已内嵌进二进制**（`ext:bridge_ext/bootstrap.js` 不再指向构建机路径），
release 产物在非构建机可用。

**最小复现探针**（必须有至少一个 `api.ts`，否则 `oj build` 不会初始化 JsRuntime）：

```bash
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello
printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts
printf 'name: web\ndesc: probe\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml
./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out 2>&1 | head -5
# 期望：oj build: web v0.1.0 → ... (1 api file(s))
# 坏二进制（≤ v0.1.11）：Failed to initialize a JsRuntime: No such file or directory (os error 2)
```

**处置**：优先 `ojm vendor` 拉 **≥ v0.1.12**（下载源为 npm 包 `@oj-bin/oj`）。若仍报 ENOENT（版本过旧或未换包），
用**自建** oj 覆盖 `bin/oj`（`cargo build --release`，产物在 `only-js/target/release/oj`），
然后重跑这些检查点直到通过。

> **自 cli 0.1.4 起已自动化**：`ojm vendor` / `ojm init` 安装后（以及「已是该版本，跳过」时）
> 会自动执行等价的 `probeOjRuntime` 冒烟；失败打印人话告警与处置指引，**不阻断**安装
> （便于用户直接替换 `bin/oj`）。本节手工探针用于 CI 与不经 cli 的场景。

> 完整根因与修复方案（可转上游）：[`oj-release-binary-defect-report.md`](./oj-release-binary-defect-report.md)。

> 通过后可继续；否则后面的 `ojm build` / `ojm dev` 必然失败。

## 4. 契约 → 前端 client

在 `src/books/api/` 下补 6 个后端文件（manifest/schema/migration/seed + 2 handler），
handler 按**新约定**写契约——**无 `contract.ts`**：入参挂 `.schema`（params/query/body），
出参挂**平级 `.response`**（oj v0.1.72+；范本照 `packages/cli/templates/src/app/api/notification/api.ts`、
`packages/cli/templates/src/app/api/home/line/api.ts`）：

```ts
// src/books/api/list/api.ts
const list = {
	async get() { /* ...db.query...; json.ok(rows) */ },
};
list.get.schema = { query: { type: "object", properties: { keyword: { type: "string" } } } };
list.get.response = { type: "array", items: { /* data payload */ } };
export default list;
```

然后：

```bash
# module-root 工程（0.2.20 起默认布局）：config.yaml 在工程根，源码树 = src/
./bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json
# 旧平铺树工程（api/src 布局）才用：./bin/oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json
node "$CLI_PKG/bin/ojm.mjs" api                            # 或 pnpm exec ojm api
node "$CLI_PKG/bin/ojm.mjs" api --check
```

> **oj 版本要求**：`--module-root` 需 oj ≥ v0.1.85；且 openapi 的裸包解析截断缺陷
>（module-root 下预生成 `__client` 内省 fail-fast，见 §9）修复在 v0.1.86——此前用
> 本地构建（oj-bin `fix/openapi-module-root-project-root`）或先 `ojm vendor` 装
> 0.1.85 后再换修过的 `bin/oj`。症状：`oj openapi --module-root` 报
> `dev routes: …web/__client/index.ts: cannot resolve '@oj-module/runtime/contract/errors'`。

**检查点**

- [ ] `oj openapi` 退出码 0，`openapi.json` 含 `/api/books/list`、`/api/books/create`
- [ ] `ojm api` 输出「契约 N 份；写入 2 个文件」——产物 `src/books/web/__client/{index.ts, api.schemas.ts}`（**入口是 `index.ts`**，旧 `api.ts` 会被 oj dev 当路由扫描）
- [ ] client 导出 **operationId 派生名**：`booksListGet` / `BooksListGetQuery` / `BooksListGetData` / `booksCreatePost`（= `camelCase(路径_方法)`，**不是**旧 `defineApi` 的人类命名如 `listBooks`）
- [ ] **出参类型存活**：`BooksListGetData` 非 `unknown`（`.response` 经 `responses.200.content` 信封进 client——新约定与旧 `.schema.response` 的等价性验证点）
- [ ] **不生成** `src/books/api/routes.json` / `openapi.yaml`（旧产物已清理；`docs/openapi.yaml` 仅 `--docs` 时产生）
- [ ] `ojm api --check` 退出码 0：`0 error / 0 warn`（无 dist 时第三腿 routes.js 对账给 hint 不判违规）
- [ ] 工程根存在 `api/.ojm-api-exempt.json`（`{"modules":["web","notifications"],"paths":["/auth/*"]}`，内置 `auth`/`web`/`notifications` 端点有意无业务契约；init 自 cli 0.1.5 起内置）

> `ojm api` 只认 `openapi.json`（项目根或 `api/`）：找不到即报错指引先跑 `oj openapi`。
> 若报 `Cannot find package '@oj-module/runtime'` → 依赖未装/未链接（§0 旁路 2）。

## 5. 前端模块

补 `src/books/web/{entry.ts,pages/index.tsx,locales/双语}`。**module-root 布局（0.2.20 起）
以 `src/<name>/web/entry.ts` 扫描为真源，无需登记 web.config.ts**（登记退化为可选覆盖，
仅影响加载顺序；漏登记不会漏构建）。旧平铺工程（`web/src/<name>/`）仍是显式清单，
必须在 `web.config.ts` 的 `allModules` 加一行 `{ name: "books", entry: "web/src/books/entry.ts" }`
（该清单是显式的，漏登记则 build 静默跳过，2026-10-20 实踩）：

```bash
pnpm exec ojm build
pnpm exec tsc --noEmit -p tsconfig.json     # typecheck
```

**检查点**

- [ ] `ojm build`：`oj build` 列出全部后端模块（0.2.55 实测 7 个：`_platform/auth/books/notification/personal-center/system/web`——内置模块在 `src/app/api/<name>`，用户模块 `books` 在 `src/books/api`；**0.2.66 起多一个 `publish`，共 8 个**；books `2 api file(s)`、notification `2 api file(s)`）
- [ ] 输出「已合并宿主站点 → dist/web」「构建 books@0.1.0」「清单已生成」
- [ ] `dist/web/` 含 `index.html`、`assets/`、`modules/`、`modules.json`、`versions.json`（**产物根是 `dist/web`，不是 `web/dist`**）
- [ ] `dist/web/modules/books/0.1.0/entry.js` 存在（带 `integrity`）
- [ ] `modules.json` 含 `app`（框架内置页面多根模块：/home /login /personal-center /notification /system）+ 用户模块。**`app` 不可少**：shell 预构建把 `VITE_BASE_HOME_PATH` 定为 `/home` 且不挂 runtime 内置登录兜底，缺 `/home` / `/login` 则登录回跳 / 登出 / 点 logo 落错误边界
- [ ] `modules.json` 中 books 条目 `peerRuntime` 与宿主 runtime 版本相容
- [ ] **typecheck 0 error**（含生成的 `__client/index.ts`——页面 import 的 `booksListGet`/`BooksListGetData` 等 operationId 派生名须对得上）

## 6. 运行与联调（`ojm dev`）

```bash
pnpm exec ojm dev        # 默认 5174；oj 9778
# 另一个终端：
TOKEN=$(curl -s -X POST http://127.0.0.1:9778/api/auth/login \
  -H 'content-type: application/json' -H 'X-TENANT-ID: default' \
  -d '{"username":"superadmin","password":"aA123456"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.access_token))")
curl -s "http://127.0.0.1:9778/api/books/list?keyword=设计" -H "authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:9778/api/books/create -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"title":"重构","author":"Martin Fowler","year":2019}'
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9778/api/books/list   # 期望 401
curl -s http://127.0.0.1:9778/api/notifications -H "authorization: Bearer $TOKEN"  # 通知铃兜底（期望数组）
```

**检查点**

- [ ] dev 日志：`seed ok module="books"`、`routes: N method-row(s)`（纯模板 0.2.55 实测 84 row / 40 api file）、`input contracts: M route-method(s) validated before reaching JS`（纯模板实测 80；`.schema` 入参校验激活）、`oj serve listening`
- [ ] 登录返回 `code:0` 且 `data.access_token` 非空
- [ ] 登录成功后回跳 `/home` 正常渲染（不落 React Router 错误边界），页面含统计卡片 + 折线/柱/饼图（共享依赖矩阵演示）
- [ ] 列表过滤按关键字命中（注意种子数据：`keyword=设计` 会同时命中「设计数据密集型应用」与「领域驱动设计」——用更独特的关键字如 `数据密集型` 验证单条过滤）
- [ ] 新增返回 `code:0` 且 `data` 与 `create.post.response` 声明一致（tutorial 的 handler 声明 `{ok:true}`；自建 handler 按自身声明核对），全量列表条数 +1
- [ ] 通知链路（module-root 模板口径，2026-10-23 起）：`notification` web 模块注册 `notificationsApi` provider → `GET /api/notification/notifications`（带 token）返回 `code:0` + 数组；旧判据「root 级 `/api/notifications` 兜底数组」随 root 级模块在 module-root 改写中移除，该路径 404 属预期（仅当 provider 未注册时通知铃才回落到它）
- [ ] 无 token 返回 **401**
- [ ] `http://localhost:5174/` 200，importmap 含 `@oj-module/runtime`，`/modules/books/0.1.0/entry.js` 200
- [ ] `/login` 能渲染登录页（登出后可跳回）。**登录页属 `app` 多根模块**——0.2.7x 起
      `/modules/login/0.1.0/entry.js` 是 404（旧稿判 200 已过时，实测 modules.json 只有
      `app` + `oj-market`）；要探模块面就探 `/modules/app/0.1.0/entry.js`

> **curl 打路由路径 404 不是缺陷**：SPA history 回落要求 `Accept: text/html`（浏览器天然带），
> curl 默认 `*/*` 不触发回落。curl 验证请带 `-H 'Accept: text/html'`。

用完停服：`pkill -f "ojm dev"; pkill -f "bin/oj"`。

## 6.5 仓库内回归套件（runtime 修复的演练层）

§6 的浏览器检查点覆盖不到的 runtime 行为，由仓库内两套套件钉住；框架改动后至少跑这两条：

```bash
pnpm test          # vitest 单测（含 admin 重写全管线、resolveRoutePath 单路由+祖先链、门禁/init）
pnpm test:e2e      # playwright 浏览器套件（真实 shell-dist + templates：登录/菜单/侧栏/系统页）
```

**检查点**

- [ ] `pnpm test` 全绿（0.2.68 起：admin 子树 id 与 `/system/<模块根>/admin/*` 同空间、`resolveRoutePath(route[, ...ancestors])` 祖先链结果 === 框架全管线重写后 id、`category:"admin"` 未声明 layout 默认 `container`、门禁三态漂移、`--yes` 恢复范围）
- [ ] `pnpm test:e2e`：侧栏主菜单与底部「系统设置」同时展开互不遮挡、各自可滚（`sidebar-menu-overflow` 用例）；系统页登录/渲染/i18n 通过
- [ ] e2e 已知挂账：**4 个既有 wecom 失败**（W1/W6 登录页企微 tab、W4/W5 `/system/wecom` 404）——非本批回归，修复前每次演练如实核对失败清单是否仍为这 4 条，多了才算回归

## 7. 预览（可选，验证 release 形态）

```bash
pnpm exec ojm preview    # oj migrate（verify 门禁）→ 单服务 release 形态（9778：API + 静态 SPA 同进程）
```

**检查点**：migrate 成功（账本落后会拒启，先 `oj migrate -c api/config.yaml -d api/dist`）；
站点可访问（9778 根 200 + `/modules/books/0.1.0/entry.js` 200；preview 自 0.2.5 起为单服务，
旧基线记的 4173 双服务已过时）；
release 下路由来自 `api/dist/**/routes.js`（目录镜像不存在）；
API 全链路再通一遍（登录/列表/新增）；
**带 dist 后重跑 `ojm api --check`**——第三腿（routes.js vs openapi.json 契约路由表）此时激活，
应 `0 error / 0 warn`（注意尾斜杠规范化与豁免对称过滤，2026-10-15 已修，见 §9）。

## 7.1 开发一个方案模块（作者视角）

> 与 §4–§5 的区别：§4/§5 是在**宿主工程里**写业务模块（跟着宿主一起构建）；本节写的是**可分发**的
> 方案模块——独立工程、独立构建、打成包发布到市场。两者共用 oj 的 handler 与清单约定。
> **0.2.23 起首选 `ojm new` 骨架**（module-root）：手写六文件只在需要完全控制目录形状时用。

### 7.1.0 骨架生成（推荐）

> **0.2.68+ 守卫**：`ojm new` 必须在 **ojm 工程内**跑（独立目录被「不是 ojm 工程」拒，零写入；
> 2026-11-06 演练实测）。宿主内多方案分发走显式四步：`ojm build --bundle <name>` → `ojm sign` →
> `cp tgz+.sig cdn/` → `ojm market build-index`（= devkit publish-walkthrough §4.2；`publish --real`
> 仅限单方案工程，多方案明确拒绝并指路 §7.5 F；**`publish --fixture` 是合成测试包，不是发布通道**）。

```bash
# 在宿主工程根内：
node "$CLI_PKG/bin/ojm.mjs" new demo-solution --layout none --api
# → src/demo-solution/solution.yaml
#    src/demo-solution/api/{manifest.yaml,api.ts}
#    （--layout container|none 决定是否带 web/{entry.ts,pages,locales}）
```

- [ ] `solution.yaml` 含 `name/version/summary` + `peerRuntime` + `archive`（后两项是 `market verify`
      结构检查的必填项，手写容易漏）
- [ ] `api/api.ts` 是**嵌套组** `export default { ping }`——裸具名导出会被 oj 路由内省静默忽略
      （零路由且构建期不报错，故障延迟到安装 smoke 才现形）
- [ ] 升版本要**四处同步**：`solution.yaml` 的 `version` / `web.entry` / `archive.file`、
      `api/manifest.yaml` 的 `version`、`web/entry.ts` 的 `version`（漏改会被 C2-27/C2-29 点名）

### 7.1.1 构建与打包

```bash
node "$CLI_PKG/bin/ojm.mjs" build              # 站点 + 后端产物（module-root：dist/api、dist/web）
node "$CLI_PKG/bin/ojm.mjs" build --bundle     # → dist/<name>-<version>.tgz
```

- [ ] `dist/api/<name>-<version>/` 含 `manifest.yaml`、`routes.js`、`ping/api.js`、`migrations/`、`schema.yaml`
- [ ] `routes.js` 出现自己声明的路由行（空表 → handler 不是 `.ts`，见 §9）
- [ ] `build --bundle` 退出码 0，tgz 存在且两次打包 sha256 一致
- [ ] 没有 C2-25 / C2-12a 违规（有则按提示补 locales / schema）

### 7.1.2 旧平铺形态（存量工程）

```text
solution-demo/
├── manifest.yaml                      # C2 契约清单（Form A，包身份证）
├── api/src/<name>/{manifest.yaml,schema.yaml,routes.js,migrations/,ping/api.ts}
└── web/src/<name>/locales/{zh-CN,en-US}.json
```

```bash
<host>/bin/oj build -d api/src -o api/dist     # module-root 工程改用 --module-root src
```

## 7.2 发布到市场源（CDN）

```bash
# 0) 发布身份二选一。站点有「方案市场 → 发布管理」页时优先用一次性凭证（key_id 由站点按产品名+账号下发；
#    它只定身份归属，不预置信任——首装仍会 needs_trust）：
node "$CLI_PKG/bin/ojm.mjs" keygen --credential <token> --site-url http://127.0.0.1:9778
#    凭证来自 方案市场 → 发布管理 → 申请发布凭证（填产品名），明文只显示一次；兑换即作废，失败不落盘。
#    站点地址优先级 --site-url > OJM_SITE_URL > http://127.0.0.1:9778；兑换端点匿名可达，不需要账号口令。
#    拿到 key_id 形如 <产品名>.<编码用户名>，落点 ~/.ojm/keys/<key_id>/。

# 1) 旁路：只在没有「发布管理」页（纯自建/离线 CDN）或 CI 临时密钥时自建身份；
#    站点侧没有这条身份记录，只能靠超管为陌生指纹手工确认信任
node "$CLI_PKG/bin/ojm.mjs" keygen --id demo.publisher --out ./keys --yes
#   记下 fingerprint（市场卡片与 trust confirm 都要核对它）
#   两条路都产出同一形状的私钥；--credential 与 --id 互斥（同时给 exit 2）。

# 2) 落包 + 重建索引（--real 走真构建；发布方密钥与 --id 必须同时给；
#    --registry-id 是 REG-CS3 v2 规范串首段（防跨仓库重放），必填——往 registry 发布时
#    须等于该站 canonical_origin，本地自供 CDN 任意值即可（站点未配 registryId 则安装侧跳过比对））
cd <host>
node "$CLI_PKG/bin/ojm.mjs" market publish --real ../solution-demo \
  --id demo.publisher --key ../keys/private.pem --registry-id oj-registry --rebuild-index

# 3) 离线验包（不起站点、不装、不要凭据）
node "$CLI_PKG/bin/ojm.mjs" market verify --rebuild-index
```

**检查点**

- [ ] 走凭证时：打印「凭证已兑换：产品 … / 申请人 …」，`~/.ojm/keys/<key_id>/` 出现 `private.pem`（0600）+ `public.hex`；同一 token 二次兑换报「发布凭证无效或已失效」且不落盘
- [ ] `cdn/` 下 v2 索引件齐全：`<name>-<version>.tgz`、`.tgz.sig`、`catalog.yaml`、`catalog.yaml.sig`、`shards/`（分片带代次）
- [ ] `market verify` 七项全 ✓（完整性 / 包级签 / manifest 结构 / 索引签 ×2 / 索引同代 / 索引时效），末行带边界声明
- [ ] `curl <站点>/cdn/catalog.yaml` 返回 YAML（不是 index.html）——v2 索引真名是 `catalog.yaml`（`bundles.yaml` 是旧称，0.2.68 实测 404）；dev 形态陷阱见 §9
- [ ] 重发同版本且字节一致 → 幂等；字节不同 → 报冲突并提示升 version

## 7.3 市场链路验证（安装 → TOFU → 装成）

> **前置**：宿主必须以 **release 形态 + 真实 config** 起站（见坑 ⑤⑥）。dev（`--api-path src`）与
> `ojm preview`（派生 config）都**不能**完成安装的热更段。
> **module-root 宿主口径**（0.2.20 起 init 产物）：config.yaml 在工程根，构建产物在 `dist/api`，
> 故起站为 `--api-path dist/api` 且 `platform.root: dist/api`（写 `dist` 会撞反抢占 tripwire，
> 与 api 挂载重叠直接被拒）。另两条 module-root 专属注意：① 宿主 `bin/oj` 与 `bin/plugins/*`
> 必须 rustc 版本一致（本地 rustc 构建的 oj 配 npm 拉来的 plugins 会指纹不符拒载，同源拷贝即可）；
> ② 安装新方案的**新路由**要 oj serve 重启才注册——reload 由 manifests 锁 diff 驱动装配（oj 0.1.122+），
> 但新模块的路由/模块注册（modules.json、sys_solution_route）属 **restart_pending**，热改不即时生效，装后探活前先重启。

```bash
cd <host>
node "$CLI_PKG/bin/ojm.mjs" build                      # dist/api + web/dist（含 dist/api/versions.json）
# config：platform.root 改为 dist/api（module-root release 形态；平铺宿主才是 dist）
#   platform:
#     modules: [_platform]
#     root: dist/api
(../bin/oj serve -c config.yaml -b /api --api-path dist/api --console-log &)

node "$CLI_PKG/bin/ojm.mjs" market setup --site-url http://127.0.0.1:9778 --user superadmin --pass aA123456 --new-pass <新口令>
# → 市场页（或 GET /api/_platform/market/index）出现方案卡片

# 安装（首次必然停在待信任）
curl -s -X POST http://127.0.0.1:9778/api/_platform/market/install \
  -H "authorization: Bearer $TOKEN" -H 'X-TENANT-ID: default' -H 'content-type: application/json' \
  -d '{"name":"demo-solution","version":"0.1.0","source":"cdn"}'
# → {data:{task_id:"install-..."}}；轮询 GET /api/_platform/market/task?id=<task_id> 到 status=needs_trust
#   响应的 trust.fingerprint 必须与 keygen 输出逐字一致（install/task 探询都要带 X-TENANT-ID）

node "$CLI_PKG/bin/ojm.mjs" trust confirm --task <task-id> --site-url http://127.0.0.1:9778 --user superadmin --pass <新口令>
# 重试同一条 install → 期望 status=done，11 段全 ok

# 只验「这个包能不能装」、不想搭宿主时（隔离站点，12s 内出结果）
node "$CLI_PKG/bin/ojm.mjs" market trial --fixture <name>@<version>
```

**检查点**

- [ ] `market/index` 卡片含目标方案与 latest 版本（空则回看 setup 写入的市场地址）
- [ ] 首次安装 `status=needs_trust`，`trust.fingerprint` 与发布方公布值一致（**逐字核对再确认**）
- [ ] `trust confirm` 后重试，11 段全 `ok`：`preflight / downloading / verifying /
      extracting / migrating / lock_commit / registering / deploying_web / reloading / smoke / audit`。
      **oj 0.1.122+ 终态语义**：首装 11 段全 ok 但 `status=partial`（`restart_pending`——新路由/模块注册要宿主重启，
      message 明示「请重启 oj serve 后生效」）；重启后再 retry 同一条 install → `status=done` 且冒烟三项全过
- [ ] 装后探活：`curl /api/<name>/ping` 返回 `code:0`（匿名端点，无需 token）
- [ ] 安装锁 `dist/api/manifests.yaml`（module-root；平铺宿主为 `api/dist/manifests.yaml`）出现 `<name>: <version>`；`dist/api/<name>-<version>/` 存在
- [ ] 再装同版本 → 走重装路径而非「方案名已被占用」；`market verify --rebuild-index` 无漂移

## 7.4 全套操作自检（`ojm market walkthrough`）

装一次只证明「能装」；要证明「装了以后每个操作都对」、以及「恶意输入都被预期拒在边界上」，跑
walkthrough——它在隔离站点上按固定形状（setup → act → assert → cleanup）逐项验证，输出 AC 表，
收尾把报告（AC 表 + 失败文案表）脱敏后落盘 `logs/walkthrough-<ts>.md`。

```bash
# 无参数即可：walkthrough 自建隔离站点与合成 fixture（0.1.0 → 自产 0.2.0 做 upgrade/rollback）。
# ⚠️ `--fixture` 是 publish / trial 的旗标，不是 walkthrough 的（2026-11-08 实测：help 里就有，
#    旧稿把它写进 walkthrough 命令是错的）。
node "$CLI_PKG/bin/ojm.mjs" market walkthrough
# 主链路 9 项：✓ index / ✓ install / ✓ reinstall / ✓ enable / ✓ verify / ✓ history /
#              ✓ upgrade（0.1.0→0.2.0）/ ✓ rollback（账本超前拦截）/ ✓ uninstall
# 负向 4 项（预期失败口径，全 PASS = 每道防线都真的拦住了）：
#   ✓ neg-tamper（翻转 tgz 1B → failed@verifying，零落盘）
#   ✓ neg-nosig（删 .sig 重建索引 → sig_missing）
#   ✓ neg-stranger（未登记 key → needs_trust → confirm → done；cleanup 显式 revoke + 信任库快照 diff 为空）
#   ✓ neg-evil（手造 zip-slip tgz file 源上传 → 400 拒在解包前，R1 三步范式）
# 全部通过（13 项）：13 PASS / 0 FAIL
#   · neg-badindex 已随索引机制退役删除（写通道门禁由 cdn-upload.spec 承接），旧稿的「14 项」作废

node "$CLI_PKG/bin/ojm.mjs" market walkthrough --only neg-evil    # 单跑某项（setup 自建前置态）
```

**检查点**

- [ ] AC 表全 PASS（退出码 0）；任一 FAIL 退出码 1，`--strict` 首败即停
- [ ] `--only <op>` 单跑同样 PASS（原子性：不依赖前序 op 的残留）
- [ ] `enable` 项验证 disable → enable 双向（含路由/锁/modules.json 三面同写）
- [ ] `upgrade` 项：`installed` 推进 + 双版本目录共存（旧版不 prune）+ `0001` 迁移逐字节一致
- [ ] `rollback` 项：`failed@migrating` 且 `api/dist` 内容快照零变化（禁降版 OJ-9，宿主层预锁或 oj migrate 双层拦截之一）
- [ ] `uninstall` 项验证装后清场（目录不存在 + 锁摘除）
- [ ] 负向项是**预期失败口径**：防线没拦住（装成了）记 FAIL，比失败更严重
- [ ] `verify` 项断言**报告结构完整**（ok/checks/advise 字段在场）；`checks` 是问题清单——
      **零问题站点恒为空数组是健康态**，不是端点异常（深检全绿即如此）
- [ ] `neg-stranger` 收尾：`DELETE /market/trust/key` 返回 `{revoked:true}`，op 前后
      `GET /market/trust` 快照 diff 相等（陌生 key 无残留；不靠 uninstall 兜底——它本就不摘信任）
- [ ] 报告落盘且过黑名单脱敏：`grep -E "Bearer |BEGIN .*PRIVATE" logs/walkthrough-*.md` 恒空
      （token / PEM 不得出现在报告里；指纹、sha256、key_id 属白名单，原样保留）

## 7.5 新命令特性演练（0.2.23 多方案：`ojm new` / 多方案打包 / `info` 折叠）

> 与 §7.1 的区别：§7.1 在**独立方案工程**里手写契约打包；本节演练 0.2.23 起脚手架内建的
> **多用户方案工作流**——`ojm new` 生成骨架、`.ojm-builtin.json` 排除自带方案、
> `ojm build --bundle` 复数化打包、`ojm info` 折叠自带模块。全程在 §1–§2 的 my-books 工程内进行。

前置：§1–§2 完成（依赖已装、`bin/oj` 就位、工程可 `ojm build`）。

**A. 脚手架 scripts 与自带名单**

```bash
node -e "console.log(Object.keys(require('./package.json').scripts).join(' '))"
cat src/.ojm-builtin.json        # 名单 + 「//」注释键；由 ojm init 从模板白名单派生
```

- [ ] scripts 含 `new`（= `ojm new`）与 `bundle`（= `ojm build --bundle`）与 `typecheck:api`
- [ ] `src/.ojm-builtin.json` 存在，`modules` 含 `_platform/auth/system/notification/personal-center/web`

**B. `ojm info` 自带折叠**

```bash
node "$CLI_PKG/bin/ojm.mjs" info
node "$CLI_PKG/bin/ojm.mjs" info --all
```

- [ ] 默认输出：自带模块折叠为一行「框架自带：N 个（ojm info --all 展开）」，不逐条平铺（0.2.55 实测 N=2：`app` + `oj-market`——内置后端模块在 `src/app/api/<name>`，不单独成 web 模块）
- [ ] `--all`：自带模块平铺可见
- [ ] module-root 下未登记 `web.config.ts` 的模块也在清单（扫描并集数据源）

**C. `ojm new` 生成两份用户方案 + 守卫拒绝**

```bash
node "$CLI_PKG/bin/ojm.mjs" new crm --layout container
node "$CLI_PKG/bin/ojm.mjs" new erp --layout none --api
node "$CLI_PKG/bin/ojm.mjs" new crm          # 重名 → 拒绝
node "$CLI_PKG/bin/ojm.mjs" new CRM          # 大写 → 拒绝（kebab-case）
node "$CLI_PKG/bin/ojm.mjs" new auth         # 保留名 → 拒绝（先于内置名命中）
node "$CLI_PKG/bin/ojm.mjs" new home         # 框架自带名 → 拒绝（命中内置名单）
node "$CLI_PKG/bin/ojm.mjs" new              # 非交互无 name → 用法报错（cac usage，退出码 2）
```

- [ ] `src/crm/`：solution.yaml + web/{entry.ts,pages/index.tsx,locales/双语}
- [ ] `src/erp/`：额外含 api/{manifest.yaml,api.ts}（`--api`），solution.yaml 含 `api:` 段
- [ ] 五类拒绝各命中对应文案（注意 auth 是**保留名**先触发、home 才是内置名路径）；
      拒绝时**零写入**（目标目录不存在）
- [ ] 重跑 `ojm info`：crm / erp 出现在用户区（生成即被扫描收录，无需登记 web.config.ts）

**D. 构建 + 多方案打包**

```bash
node "$CLI_PKG/bin/ojm.mjs" build              # 骨架编进产物（erp 带 api 侧 ping）
node "$CLI_PKG/bin/ojm.mjs" build --bundle     # 无参 = 全部用户方案
ls dist/*.tgz
node "$CLI_PKG/bin/ojm.mjs" build --bundle crm   # 只打一份；--bundle=crm 等价
sha256sum dist/crm-0.1.0.tgz && node "$CLI_PKG/bin/ojm.mjs" build --bundle crm && sha256sum dist/crm-0.1.0.tgz
```

- [ ] 无参打包：出 `crm-0.1.0.tgz` + `erp-0.1.0.tgz` 两份，末行「共打包 2 份方案包」；
      自带方案零出包
- [ ] 每份独立校验（契约 + 表集 + 双语）；`--bundle crm` 只出 crm 一份
- [ ] 同输入重复打包 sha256 逐字节一致（确定性）
- [ ] tgz 内固定 `manifest.yaml` 命名；`tar -tzf` 无私钥形态文件（`*.pem/*.key/.env*` 等）

**E. 自带排除与负向口径**

> **0.2.68+ 口径（2026-11-06 实测）**：「给自带模块塞临时契约」会**先被 §1.5 门禁拦下**（`src/app`
> 受保护，塞文件即 extra 漂移，build 拒绝零产物）——双层防御的第一层。删 `src/.ojm-builtin.json`
> 绕行会**同时失去自带排除**（门禁名单与排除名单同一真源）：实测 `app` 被打进包并在 `dist/` 残留
> `app-0.1.0.tgz`。故 E1/E2 的对抗路径验证到「门禁拦截」为止；正常路径「自带不参与打包」由 D 的
> 无参打包份数（仅用户方案）证明。

```bash
# 给自带模块塞一份临时契约：无参打包必须跳过它、按名打包必须拒绝
printf 'name: app\nversion: 0.1.0\ntitle: app\nsummary: x\nchangelog:\n  - 0.1.0 x\nweb:\n  route_prefix: /app\n  entry: modules/app/0.1.0/entry.js\n' > src/app/solution.yaml
node "$CLI_PKG/bin/ojm.mjs" build --bundle          # 日志注明「跳过框架自带方案：app」
node "$CLI_PKG/bin/ojm.mjs" build --bundle app      # 拒绝：框架自带方案不参与用户打包
rm src/app/solution.yaml

# 两段式：混入坏契约（name ≠ 目录名）→ 校验失败 dist 零增量、报错指名失败方案
mkdir -p src/bad && printf 'name: not-bad\nversion: 0.1.0\ntitle: x\nsummary: x\nchangelog:\n  - 0.1.0 x\nweb:\n  route_prefix: /bad\n  entry: modules/bad/0.1.0/entry.js\n' > src/bad/solution.yaml
ls dist/*.tgz | wc -l   # 记当前份数
node "$CLI_PKG/bin/ojm.mjs" build --bundle            # 失败：指名 bad（name 须 === 目录名）
ls dist/*.tgz | wc -l   # 与上相等 = 零增量（两段式）
rm -rf src/bad

# 零用户方案：临时移走全部用户契约 → 友好报错指路 ojm new
mkdir -p /tmp/ojm-verify/_stash
mv src/crm/solution.yaml /tmp/ojm-verify/_stash/crm.yaml
mv src/erp/solution.yaml /tmp/ojm-verify/_stash/erp.yaml
node "$CLI_PKG/bin/ojm.mjs" build --bundle            # 报错：没有可打包的用户方案…ojm new
mv /tmp/ojm-verify/_stash/crm.yaml src/crm/solution.yaml
mv /tmp/ojm-verify/_stash/erp.yaml src/erp/solution.yaml
```

- [ ] 自带契约被跳过且有逐条日志；`--bundle app` 明确拒绝（不静默、不出包）。注意内置**后端**模块在 `src/app/api/<name>`，契约扫描只看 `src/<dir>/solution.yaml`，故只能拿顶层自带模块（`app` / `oj-market`）演示
- [ ] 坏契约 fail-fast 指名 `bad`；失败前后 `dist/*.tgz` 份数不变（两段式零增量）
- [ ] 零用户方案报错文案指向 `ojm new`；恢复契约后重跑打包恢复两份

**F. `market publish --real` 多方案拒绝**

```bash
node "$CLI_PKG/bin/ojm.mjs" market publish --real . --id demo.publisher
```

- [ ] 多方案工程给出明确拒绝与显式链路指路（`build --bundle <name>` → `sign` → `build-index`），
      不静默只发一份

## 7.6 出厂即装与随站 bundle 收敛（Phase B，0.2.71+；**2026-11-07 策略变更：出厂即装**；动安装器/编排面/模板 config 时必跑）

> **策略变更（2026-11-07， supersedes 本节下文「出厂未装」历史口径）**：市场方案**默认安装好**，
> 后期经发布途径升级。三支柱（设计 docs/plans/20261107-1150-market-factory-install.md）：
> ① `ojm dev` 物化 `dist/api/versions.json`（dev 形态补 C2-09 真源——此前 dev 下收敛被
> preflight fail-closed 永久拒装，`ojm init --yes` 是死路）；② 重建合并已装方案登记
> （deploy-web 落 `.ojm-module.json` 条目旁车，dev/build 重建 modules.json 时重物化 web 面
> 并并入；双轨同名 fail-fast）——根治「例行 build/dev 冲掉已装方案 web 面」；③ 出厂安装时机：
> `ojm dev`/`ojm preview` 后端就绪后 fire-and-forget 触发收敛（服务端 isolate 无定时器，只能
> riding 请求）；BOOTSTRAP_KEY 已回填 platform.release，首装免 TOFU。superadmin「方案安装」
> 首装页已整建制退役（出厂未装态 UI 随之退役）。真机验收基线（/tmp/ojm-vv/drill 全绿）：
> 全新 init --yes 工程 `pnpm dev` 数秒内 state.yaml 落 oj-market、modules.json 并入、目录可见；
> dev 重启/重复 `pnpm build` 登记不丢、告警静默；`pnpm preview` SPA/face/index 全 200。
>
> 市场 UI（oj-market）自 Phase B 起是**第一方纯 web 方案包**：**出厂即装**（0.2.72+ 策略），`api`
> 编排面随脚手架内置（市场方案未装时 `/api/oj-market/*` 端点仍在）。`ojm init --yes` 把已签名
> bundle 落位 `cdn/` 并写 `bundles.json` 意图标记；**`ojm dev`/`ojm preview` 后端就绪后自动触发
> 收敛安装**（上拉不下拉：未装→装、bundle 新→升级、bundle ≤ 已装→跳过不降级）；纯 `oj serve`
> 起站（CLI 不在环）由首个市场编排请求（index 端点「对账即服务」）riding 收敛。卸载后重装走
> 方案市场页或 `ojm install <name>@<version>`。
>
> **为什么单测不够**：编排/安装器单测全走 DIP 注入（exec/reload/fetch/fs stub），验证编排逻辑；
> oj 的**授权层**（per-module exec、platform 特权）与**装配层**（锁驱动 parse_one）只在真机存在。
> 2026-11-07 首跑本节连抓 6 个真机缺陷（见 §9 表「2026-11-07 六连修」），全部 TDD 修复并钉守卫。

前置：§0.5 发布形态（prepack 收编已签名 bundle 进 `shell-dist/bundles/`）+ §1 脚手架 + §2 依赖 +
`ojm build` 产物就位。签名是发布期手工动作（私钥不出 `~/.ojm/keys/`，devkit walkthrough §7.5）：
源码树演练时若 `templates/dist/<name>-<ver>.tgz` 无 `.sig` 旁车，先 `ojm sign <tgz> --id <kid>
--key <pem> --registry-id <reg> --check` 再重新 pack。

### A. 出厂即装态核对

```bash
node -e "const m=require('./dist/web/modules.json');console.log(m.map(x=>x.name).join(','))"
# 期望含 oj-market——例行 build/dev 重建 modules.json 时从版本目录重物化 web 面并并入已装登记
# （条目旁车 .ojm-module.json 双落点持久化）
ls cdn/   # bundles.json + <name>-<ver>.tgz + .sig（init --yes 落位）
grep -A1 "oj-market:" modules/.solutions/state.yaml   # 出厂收敛后已装行在位（0.2.3、trusted）
```

> **两轨版本互不相干，别拿一轨的号去要求另一轨**（2026-11-08 实测）：web/方案轨 = 随站 bundle
> 版本（本基线 **0.2.3**，见 `cdn/bundles.json`）；api 轨 = **平台内置编排面**（本基线
> **0.2.2**，`dist/api/oj-market-0.2.2/`），它随脚手架内置、不因方案包升降。
> `dist/api/manifests.yaml` 出现 `oj-market: 0.2.2` 属预期，不是市场 UI 版本。

- [ ] `modules.json` **含** `oj-market`（重建合并登记——例行 build/dev 不再冲掉已装方案的
      市场菜单）；`src/oj-market/web` 仍只有 `__client`（+ `publish` 空壳占位，web 面重物化自
      版本目录，非源码树）
- [ ] **编排端点出厂即在**：`GET /api/oj-market/index?page=1&size=5`（superadmin token + `X-TENANT-ID`）
      返回 `code:0`，list 见 `oj-market installed=0.2.3 enabled=true trust_state=trusted`
      （`ojm dev`/`ojm preview` 就绪即自动收敛；纯 oj serve 形态由首请求 riding 收敛，
      收敛完成前 list 无该条目属预期）
- [ ] **落盘 integrity 是 C2-28 单前缀形态**：`node -e "const it=require('./dist/web/modules.json').find(x=>x.name==='oj-market');console.log(it.integrity)"`
      → 必须匹配 `^sha384-[A-Za-z0-9+/]{64}$`（`sha384-sha384-…` 是 2026-11-08 修掉的双前缀缺陷，
      见 §9）
- [ ] **读面降级（R9 修订，2026-11-07）**：非 superadmin（如 `admin`）token 打同一 `index` 亦返回
      `code:0`；`GET /api/oj-market/task?id=__none__` 对非 superadmin 仍 403（写面 superadmin 独占不变）

### B. 收敛路径验证（release 形态起站：§7.3 前置同——`platform.root: dist/api` + `vars.canonical_origin`；页面探活另需解开 config 的 `"/"` web 挂载三行，`spa: true`）

> 新策略下主路径已由文首「出厂即装」覆盖（dev/preview 就绪自动收敛，BOOTSTRAP_KEY 免 TOFU）。
> 本节定位 = 纯 `oj serve` 形态（CLI 不在环）/ 收敛失败愈合 / 手工触发验证。needs_trust 信任空窗
> 子路径现仅可达于 BOOTSTRAP_KEY 被运维吊销（G5 不复活语义）或旧工程信任库预置但缺
> `platform.release` 的场景。

```bash
# 0) 先把 config.yaml 的 platform.root 从 `src` 改成 `dist/api`（与 api 挂载同源）。
#    漏改则起站直接拒：`platform.root (…/src) must be mounted as an api mount …`（2026-11-08 实测；
#    这不是缺陷，是装配层要求 root 与托管目录同源）。
# 1) 起站（module-root release 形态；基座必须钉 /api——缺省 /v1/api 会让框架侧请求全打穿到 SPA，见 §9）：
./bin/oj serve --api-path dist/api -b /api --daemon

# 信任空窗子路径（BOOTSTRAP_KEY 已被运维吊销，或旧工程信任库预置但缺 platform.release）→
# 收敛验签停在 needs_trust（预锁段即停）：
curl "http://127.0.0.1:9778/api/oj-market/index?page=1&size=5" -H "authorization: Bearer $TK" -H 'X-TENANT-ID: default'
curl "http://127.0.0.1:9778/api/oj-market/history?page=1&size=3" -H "authorization: Bearer $TK" -H 'X-TENANT-ID: default'
# 期望 index 仍 code:0（收敛失败吞咽）；任务文件 modules/.install-tasks/install-*.json 终态 needs_trust、
# stage=verifying（信任空窗属第五终态，**不写冷却文件**；冷却只在 failed 硬失败时写——次日六连修期
# 首跑全是 NotCapable 硬失败，故有 failed 行 + 冷却，勿当唯一口径）

# 信任播种（superadmin 推送发布方公钥）+ 重触发（无冷却则无需清）：
PUB=$(cat ~/.ojm/keys/<publisher>/public.hex)
curl -s -X POST http://127.0.0.1:9778/api/oj-market/trust/key \
  -H "authorization: Bearer $TK" -H 'X-TENANT-ID: default' -H 'content-type: application/json' \
  -d "{\"key_id\":\"<publisher>\",\"public_key\":\"$PUB\"}"     # 期望 {"result":"added"}
curl "http://127.0.0.1:9778/api/oj-market/index?page=1&size=5" -H "authorization: Bearer $TK" -H 'X-TENANT-ID: default'
```

- [ ] 信任空窗期：收敛停在 needs_trust（任务落盘、stage=verifying）、index 响应仍 `code:0`
      （不吞咽消费端）；**needs_trust 无冷却文件**（冷却仅 failed 硬失败写，二者别混判）
- [ ] 信任播种后：index list 出现 `oj-market installed=0.2.3 enabled=true trust_state=trusted`；
      安装任务 11 段全 ok（`modules/.install-tasks/install-*.json` 的 stages 全 `ok`，终态 `done`）
- [ ] **api 锁零变更**：`grep "oj-market: 0.2.3" dist/api/manifests.yaml` 恒 0 条（web-only 包不写
      api 锁——锁是 oj 装配真源，写锁会让 oj 拿 C2 清单装配 reload 400，且双轨同名遮蔽内建编排模块）；
      内建 `oj-market: 0.2.2` 锁条目保留
- [ ] 页面双活：`/modules/oj-market/0.2.3/entry.js` 200；`/oj-market`（带 `Accept: text/html`）200；
      编排端点仍 200（装方案不毁编排面）
- [ ] **浏览器加载面零错误**（HTTP 探活不可见盲区，2026-11-07 drill3 实锤——U5 修复前
      entry.js 200 / SPA 200 全绿但浏览器 `Failed to resolve module specifier`）：headless Chrome
      真实表单登录后侧边栏出现「方案市场」、`/oj-market` 全按钮渲染、
      console 零 module-loader 报错（脚本样例 /tmp/ojm-vv/ui-check.mjs）

### C. 对账语义（幂等 / 降级守护 / 卸载保护）

```bash
# 幂等：已对齐后再请求 index → 不产生新安装任务（.install-tasks 下 install-* 计数不变）
ls modules/.install-tasks/ | grep -c install

# 降级守护：bundle 版本改低 → 不降级（OJ-9：降级唯一入口 = 站点回滚）
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('cdn/bundles.json','utf8'));j.solutions[0].version='0.1.0';fs.writeFileSync('cdn/bundles.json',JSON.stringify(j,null,'\t'))"
curl "http://127.0.0.1:9778/api/oj-market/index?page=1&size=1" -H "authorization: Bearer $TK" -H 'X-TENANT-ID: default' > /dev/null
grep -A1 "oj-market:" modules/.solutions/state.yaml   # 版本仍 0.2.3；无新任务

# 第一方保护（0.2.3+）：oj-market 的卸载/停用一律拒绝（业务拒绝，HTTP 200 + code:0 + data.ok=false）
curl -s -X POST http://127.0.0.1:9778/api/oj-market/uninstall \
  -H "authorization: Bearer $TK" -H 'X-TENANT-ID: default' -H 'content-type: application/json' \
  -d '{"name":"oj-market"}'
# 期望 data.ok=false，message 含「禁止卸载」；锁/state/版本目录/modules.json 四态原样
```

- [ ] 幂等：对齐后 index 不再产生安装任务；降级守护：改低 bundle 版本后 installed 仍高版、零任务
- [ ] **卸载保护（0.2.3 起替代原「卸载墓碑」）**：`oj-market` 卸载被拒（`data.ok=false` +
      「禁止卸载」），`cdn/bundles.json` 不被摘除、`modules/.solutions/state.yaml` 仍 0.2.3、
      `dist/api/oj-market-0.2.3/` 仍在、内建 `dist/api/oj-market-0.2.2/` 与锁条目在、
      `modules.json` 仍含 `oj-market`；前端卡片「卸载/停用」按钮 `disabled` 且带说明 tooltip
      （headless 实测：`卸载 disabled=true`、`停用 disabled=true`）。
- [ ] 墓碑语义（**第一方包已不可达**）：`pruneBundledMarker` 只在卸载成功时摘 `cdn/bundles.json`
      条目；第三方方案没有 bundle 条目，故墓碑路径现由单测覆盖，真机走 §7.4 walkthrough 的
      `uninstall` 项（第三方包卸载清场）。

> **判据变更说明（2026-11-08）**：原检查点是「卸载 oj-market → 墓碑 → 不再重装」。0.2.3 起
> oj-market 是**第一方市场自身**，卸载会让全站失去方案安装/启用/卸载能力且无法从市场装回，
> 故后端硬拒（uninstall.ts / installer.ts 各一枚守卫，配 uninstall.spec 用例）。别再照旧脚本
> 判「卸载成功」，那不是回归。

### D. 已知边界（本节演练裁决，勿当缺陷重复上报）

- 升级路径（bundle > installed → upgrade）与收敛失败冷却自愈由 `bundle-converge.spec` 数据表
  （10 用例）+ 市场线 §7.4 walkthrough（api 包升级）覆盖；第一方包升级演练需真发 0.3.0 包，发布期做。
- web-only 方案的市场内**回滚**不可用（锁零变更设计使然）——符合双轨裁决：降级唯一入口 = 站点回滚。
- 冷却窗内（10 分钟）收敛失败不重试；演练加速手段 = 删 `modules/.install-tasks/.bundle-converge-cooldown.json`
  （信任空窗 needs_trust 无冷却，推公钥后直接重触发即可）。

## 7.7 从市场安装解决方案（作者侧发布 → 目录 → 按名安装闭环；0.2.71+ 实证）

> 覆盖「方案进市场目录 + 运维按名从市场拉装」整条业务闭环——§7.6 只装市场本身，本节装**第三方/用户方案**。
> 复用 §7.6 出厂即装站点（市场已装、编排面、信任库、冷却语义全部在位）。2026-11-07 第二轮全绿。
> **第三轮（2026-11-07，cli 0.2.73 drill3）五点全链路验收通过**：①出厂即装菜单浏览器实证
> （真机登录侧边栏「方案市场」+ 零 module-loader 错误）②发布凭证申请 → `keygen --credential`
> 兑换落盘（一次性语义重兑 exit 1 实证）③books 0.1.x 签名发布进目录 ④安装迁移+seed 实证
> （`_oj_migrations` 双段 + 冷启动 `seed ok module="books-0.1.4"` + 表内 3 行）⑤`/books` 页
> Table 渲染 3 行、console 零错误。轮内两个新发现：**迁移不可变纪律**（改已应用的 0001 内容即
> `applied migration V1__init is different than filesystem one`，修法 = 新增 0002，§9 表已载）与
> **seed 冷启动才重放**（安装触发热重载不灌 seed，新装方案数据要等下次冷启动——已列 §11 U7）；
> 方案页禁逐请求 `prefixUrl`（ky v2 已改名 `prefix`，scoped client 自带 apiPrefix，§9 表新增行）。

前置：§7.6 站点（市场已装、发布方 key 已在信任库）+ 发布身份（§7.2；本机自签旁路 key 亦可，
但须先把它的公钥推进站点信任库，否则 publish 403）。**起站基座钉 `/api`**：

**首选（config 挂载形态，零 CLI 旗标；2026-11-07 drill-dev 实证重启持久可达）**——config 做两处
「手写部署」钦定改动（模板注释自带指引，非探索性改动）：`platform.root: dist/api` + 加 api 挂载：

```yaml
mounts:
  - prefix: /api
    api: dist/api      # 锁驱动装配：dist/api 整树含已装方案版本目录，重启后仍服务
  - prefix: "/"
    web: /abs/path/dist/web   # 页面静态要第三处改动；api 可达性不需要它
    spa: true
```

```bash
./bin/oj serve -c config.yaml --daemon   # 无 -b 无 --api-path：基座 = 挂载前缀 /api，绕过 U4/U6
```

**备选（CLI 旗标形态）**：`oj serve --api-path dist/api -b /api --daemon`——config 零改动但旗标两枚，
且 web 挂载必须绝对路径（相对路径 + -b 组合静态层落空，§9 表/U6）。判据同下。

两形态共同判据：POST /api/auth/login 返回 JSON（401/400 都是 API 应答）；若返回 HTML doctype 或
「web mounts serve GET/HEAD only」405 = 基座错了（§9 表首行新坑）。

### A. 作者侧：造方案 → 签名 → 发布进目录

```bash
ojm new books --api                      # 骨架：src/books/{solution.yaml, api/, web/}
ojm build && ojm build --bundle books    # dist/books-0.1.0.tgz（sha256 确定性）
ojm sign dist/books-0.1.0.tgz --id <kid> --key <pem> --registry-id <reg> --check
ojm market publish --site-url http://127.0.0.1:9778 --real . \
  --id <kid> --key <pem> --registry-id <reg>
# 期望末行「发布完成：books@0.1.0 已进 … 市场目录（DB 目录行 + cdn/ 字节）」
```

- [ ] `GET /api/oj-market/catalog`（匿名可达）列出 books：`latest=0.1.0`、`publisher=<kid>`、
      `versions_count=1`；`cdn/` 下 `books-0.1.0.tgz(+.sig)` 与 bundles.json 并存
- [ ] publish 幂等：同字节重跑不 409（目录行唯一约束按 product+version）

### B. 运维侧：按名从市场安装（cdn 源）→ 两段式终态

```bash
ojm install books --site-url http://127.0.0.1:9778 --user superadmin --pass <口令>
# 首跑预期 partial（stage=reloading，restart_pending 段列出待重启模块）——oj 0.1.122+ 正常语义：
./bin/oj serve --api-path dist/api -b /api --daemon   # 重启宿主
ojm install books --site-url ... --user superadmin --pass <口令>   # retry 同一条
# 期望「安装完成：books 0.1.0」
```

- [ ] 两段式：首跑 reloading partial（非失败）→ 重启 → retry → done；任务文件终态 `done`、stages 全 ok
- [ ] **四重落点**：`dist/api/manifests.yaml` 出现 `books: 0.1.0`；`dist/api/books-0.1.0/` 版本目录在；
      `curl -H "Authorization: Bearer $TK" -H 'X-TENANT-ID: default' /api/books/ping` →
      `{"code":0,...,"data":{"pong":true,"module":"books"}}`；市场 index 视图 books `enabled: true`
- [ ] 市场自身未受影响：`GET /api/oj-market/index` 仍 200、oj-market 仍 `enabled: true`
      （装第三方方案不碰第一方市场轨）

### C. 已知边界（本节演练裁决）

- `--api-path` 缺省基座 `/v1/api` 与框架 `/api` 约定不符（web 应用请求 prefixUrl、
  `ojm market/install/trust` 瘦客户端、消费面全部按 `/api` 寻址）——module-root release 起站必须
  `-b /api`；config 里手写 `- prefix: "/api" api: dist/api` 挂载与 `--api-path` 同给会报
  「module 重复声明」，二选一（选 `-b /api`，勿写挂载）。属 oj 侧默认基座与框架约定错位，已列 §11 候选。
- 本节点未覆盖：升级（发 0.2.0 包收敛/按名装）与 yank 后在架性——由 §7.4 walkthrough 的
  upgrade/rollback/yank 项与 §7.6 C 降级守护覆盖。
- **`oj serve -c config.yaml` 纯 config 形态：模板零改动不可行（无 api 供给，拒启），但「手写部署」
  两改动（api 挂载 + platform.root）即完全可达**（drill-dev 实证：file 直传不卡 canonical_origin、
  重装 done、重启后 `/api/books/ping` 仍 200——api 挂载是锁驱动装配，与 CLI 旗标形态等价且更省心）；
  页面静态另需解开 web 挂载（第三处）。**module-root（dev）形态装包「装而不达」，不可作安装验证形态**（2026-11-07 drill-dev 实证）：
  file 直传零配置改动可十阶段走到 done（file 源不卡 canonical_origin——503 只卡 cdn 源；
  preflight 需先 `pnpm build` 出 versions.json），落盘/锁/state 全就位；但 `--module-root src`
  只挂载 src 树，重启后 dist 装好的 api 不服务（`/api/books/ping` 404）、web 资产也需解开
  web 挂载才有。更隐蔽的是同进程安装时热更让探活短暂通过（重启即失效），且启动对
  「src+dist 同名模块」fail-fast（重复声明）、「只在 dist 的模块」静默忽略——三种表现都不可用。
  安装验证必须 release 形态（`--api-path dist/api` + `platform.root: dist/api`）。

## 8. 一次通过判据（汇总清单）

- [ ] `ojm init` 成功：devDeps 含 `@oj-module/{cli,runtime}`（非 `*`）、根级 `openapi.json` + `__client` 预生成、handler 为新约定（`.schema` 入参 + 平级 `.response`，无 `contract.ts`/`routes.json`/`openapi.yaml`）、`env.d.ts` 在 include
- [ ] （0.2.68+）§1.5 门禁全过：篡改拦截 / `init --yes` 恢复 / 自定义模块共存 / `.ojm-builtin.json` 开关语义
- [ ] （0.2.68）§6.5 仓库回归：`pnpm test` 全绿；`pnpm test:e2e` 通过数不降、失败清单仍为既有 4 条 wecom
- [ ] `pnpm install` 成功，`cli`/`runtime` 两包版本一致（未发版按 §0 旁路 2）
- [ ] oj 二进制通过 §3 探针（JsRuntime 能初始化），版本 ≥ 门禁 0.1.73
- [ ] `ojm api` 生成 `src/books/web/__client`（`index.ts`；operationId 派生名、出参类型存活）；`--check` 无 drift（内置 `auth`/`web`/`notifications` 经 `api/.ojm-api-exempt.json` 豁免，见 §4）
- [ ] `ojm build` 产出全部后端模块 + 合并站点 + `modules.json`（含 `app` + 用户模块）
- [ ] `typecheck` 0 error
- [ ] `ojm dev`：登录 / 列表过滤 / 新增 / 401 / 通知兜底全对
- [ ] （可选）`ojm preview` 通过 migrate、服务与带 dist 的 `--check` 三腿
- [ ] 〔方案链路〕
  - [ ] 发布身份：普通用户（新建 → 改密 → 申请）凭证兑换成功、`~/.ojm/keys/<key_id>/` 落盘、key_id 人名段 = 该账号；同一 token 重兑被 400 拒且不落盘（或离线 `--id` 的 fingerprint 已记录）
  - [ ] 方案工程 `oj build` 出 `api/dist/<name>-<version>/`（含路由行）、`ojm build --bundle` 出 tgz（sha256 稳定）
  - [ ] `ojm market publish --real --rebuild-index` 后 `cdn/` 的 v2 索引件齐全（`catalog.yaml(+.sig)` + `shards/` + tgz(+.sig)），`market verify --rebuild-index` 末行「全部校验通过（N 项）」（N 随包数/分片数变化，不按固定条数核对）
  - [ ] 宿主 `ojm build` 后 `api/dist/versions.json` **存在**（C2-09 前置；缺则该步是回归）
  - [ ] 市场卡片可见 → 首装 `needs_trust`（指纹逐字核对）→ `trust confirm` → 重试 `status=done` 且 11 段全 ok
  - [ ] 装后 `curl -H 'X-TENANT-ID: default' /api/<name>/ping` 返回 `code:0`；`api/dist/manifests.yaml` 出现 `<name>: <version>`
  - [ ] （§7.4）walkthrough 14 项 AC 表全 PASS，含 neg-* 五项负向防线与 neg-stranger 信任库快照 diff 为空
  - [ ] （§7.5，0.2.23 起）`ojm new` 守卫四拒零写入；`info` 默认折叠自带 / `--all` 平铺；
        `build --bundle` 无参只出用户方案（自带跳过有日志）、`--bundle <name>` 单份、
        坏契约两段式零增量、零方案报错指路 `ojm new`；重复打包 sha256 一致
  - [ ] （§7.6，0.2.72+ Phase B 出厂即装）modules.json **含** oj-market（重建合并登记，例行 build 不冲
        掉）、state.yaml 已装行在位、编排端点 200；init --yes bundle 落位三件套（tgz + .sig +
        bundles.json）；dev/preview 就绪自动收敛 11 段 done + **api 锁零变更**；
        信任空窗期 needs_trust 任务落盘（无冷却）/硬失败 failed+冷却；页面/编排双活；幂等零任务；
        降级守护不降级；卸载后内建编排面完好（目录 + 锁条目 + 端点 200）+ 墓碑零重装；
        模板 config 双授权（exec grant 同集合 + platform.modules 含 oj-market）
  - [ ] （§7.7，0.2.71+ 闭环）起站 `-b /api` 基座正确（login 返回 JSON）；catalog 匿名列出方案
        （latest/publisher/versions_count）；`market publish --real` 目录行 + cdn 字节就位；
        按名安装两段式（reloading partial → 重启 → retry done）；四重落点（锁/版本目录/ping
        `pong:true`/index 视图 enabled）；市场自身不受装方案影响

## 9. 已知坑与处置

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| 安装方案后 `dist/web/modules.json` 条目 integrity 是 `sha384-sha384-…`（双前缀，不匹配 C2-28 `^sha384-[A-Za-z0-9+/]{64}$`） | `_lifecycle/sha384.ts` 的 `sha384B64` 返回**完整** `sha384-<b64>`，而 installer / smoke / verify-checks 三处都写成 `` `sha384-${sha384B64(x)}` `` 又拼一次；三处互相比对自洽（都错成一样）+ 单测注入的 stub 是裸摘要，故 2026-11-07 全绿也未暴露（2026-11-08 全量线实锤） | 已修（0.2.76+ 模板源码）：`sha384B64` 回归裸 base64，三处调用保持拼前缀；守卫 = `sha384.spec`（裸摘要形态）+ `installer.spec`（落盘 C2-28 单前缀）。安装器代码随 init 复制进工程，旧工程重新 init 即修复；已有安装重装/升级会重写条目 |
| release 起站后 CLI 推送/登录全打穿到 SPA（`Unexpected token '<'…`、POST 405「web mounts serve GET/HEAD only」、探活 200 但返回 index.html） | oj 0.1.124 `oj serve --api-path` 缺省把 API 绑在 `/v1/api`，而框架一律按 `/api` 寻址（U4） | 起站加 `-b /api`：`oj serve --api-path dist/api -b /api`；判据 = `POST /api/auth/login` 返回 JSON。config 手写 `- prefix: "/api" api: dist/api` 挂载与 `--api-path` 同给会报「module `_platform` declared in multiple places」——二选一，选 `-b /api` 勿写挂载 |
| `-b /api` 起站后 API 正常但**静态文件全 404**（`/modules/<name>/<ver>/entry.js`、index.html 返回 API 信封 `no route matched`；去掉 `-b` 或换绝对路径即恢复） | oj 0.1.124：`-b` 基座覆盖与 web 挂载**相对路径**组合时静态层路径解析落空（web 挂载只接住 SPA 回落的 HTML 请求）；`ojm preview` 派生 config 一律写绝对路径 `web: /…/dist/web` 即为此规避 | web 挂载路径写**绝对路径**（照抄 `ojm preview` 运行期 `.ojm-preview.yaml` 的写法）；判据 = 起站后 `curl /modules/app/0.1.0/entry.js` 200 |
| 站点例行 `pnpm build`（`ojm build`）或跑过 `pnpm dev` 后，已装方案的市场菜单/页面全消失（modules.json 只剩 app；`dist/web/modules/` 只剩 app） | **0.2.72+ 已根治**（U5 修复，出厂即装支柱②：条目旁车 + 版本目录重物化 + 重建合并登记）——例行 build/dev 自动并入已装方案 web 面，症状不再出现。旧版根因：两者都会重生成 `dist/web/modules.json` 与 `dist/web/modules/` 且只收录**源码树模块**，安装器登记/部署的方案 web 面被整体冲掉；安装态本身完好（`modules/.solutions/state.yaml`、锁、api 版本目录都在） | 升 0.2.72+ 后零愈合动作。旧版愈合两步：① `POST /api/oj-market/backfill` 扫 `cdn/` 补目录行（随站 bundle 包不在市场目录，backfill 会补录）；② 对 each 方案重装同名同版本（`ojm install <name>[@version]`）——web-only 包锁零变更，重装只补 web 面 |
| `oj serve` 启动报 `config uses removed server.* site keys (v0.1.58): api_prefix` | oj v0.1.58 起删除 `server.api_prefix`/`app_spa_fallback`/`app_path`/`app_prefix`/`static_sites`，改顶层 `mounts:`（出现旧键即 fail-fast，并输出迁移 YAML） | `api/config.yaml` 用 `mounts:`（ojm init 自本轮起已生成）；老工程把 `server.api_prefix: /api` 改为 `mounts: [{prefix: "/api", api: "src"}]`（devkit `api-manual.md` §10）；ojm dev/preview 的 SPA 深链回落由 ojm 自建静态层负责，无需旧 `app_spa_fallback` |
| `Failed to initialize a JsRuntime: No such file or directory` | ≤ v0.1.11 的 release oj 二进制烤了构建机路径（v0.1.12 已修复） | 用 ≥ v0.1.12 的 release（`ojm vendor`）；旧版用自建 oj 覆盖 `bin/oj`（§3） |
| `ojm init` / `ojm vendor` 末尾出现「oj 二进制自检失败」告警 | release 二进制缺陷，cli ≥ 0.1.4 的安装后冒烟主动暴露 | 同上；v0.1.12 起不应再出现。告警不阻断，`ojm init` 仍已产出工程 |
| `ojm api --check` 报 `handler 未登记`（`auth/*`、`web/*`） | 内置模块有意无契约，而工程缺豁免清单 | cli ≥ 0.1.5 的 `ojm init` 已内置 `api/.ojm-api-exempt.json`；旧工程手工补（`{"modules":["web"],"paths":["/auth/*"]}`，§4） |
| 登出 / 回跳登录落空，`/login` 空白或 404 | 工程缺 `login` 根——shell 宿主只消费模块路由，不挂 runtime 内置登录兜底 | 保留 `src/app/web/login`（0.2.55 起随 `app` 模块下发；模块根在 `src/app/web/entry.ts`，§5） |
| 登录后 / 点 logo 跳 `/home` 落 React Router 错误边界 | shell 预构建把 `VITE_BASE_HOME_PATH` 定为 `/home`，而工程缺 home 根 | 保留 `src/app/web/home`（0.2.55 起随 `app` 模块下发，§5） |
| 通知铃请求 404 / `no route matched` | 旧平铺模板缺 root 级 `/api/notifications` 端点（runtime 未注册 provider 时走内置兜底）。**module-root 模板（0.2.20 起）口径已变**：root 级模块不再随附，由 `notification` web 模块注册 provider，端点为 `/api/notification/notifications`——root 路径 404 属预期，验 provider 端点 | module-root 工程验 `/api/notification/notifications`；旧平铺工程才需要补 root 级模块（见 2026-10-16 基线新增验证点） |
| `oj openapi --module-root` 报 `dev routes: … web/__client/index.ts: cannot resolve '@oj-module/runtime/contract/errors'（node_modules installed?）` | oj ≤ 0.1.85 缺陷：openapi dev 分支 loader `project_root` 锚了源码树根 src，裸包 node_modules 行走被截断（工程根 node_modules 在 src 外），模板预生成 `web/__client/index.ts` 内省 fail-fast。**oj serve --module-root 无恙**（锚 config_dir），故只有 openapi/契约链中招 | **已修并发版**：oj `0.1.86`（2026-10-23 第三次基线实证 npm 通道直过，免本地构建旁路）。ojm `MIN_OJ_VERSION` 已抬至 0.1.86（0.2.26 起，含门禁 RED 回归）；≤ 0.1.85 用本地构建 oj 覆盖 `bin/oj` |
| `ojm api` 报 `Cannot find package '@oj-module/runtime/contract'` | 工程 devDeps 缺 `contract` | 新版 `ojm init` 已内置；旧工程手动加并 `pnpm install` |
| `typecheck` 报 `Property 'env' does not exist on type 'ImportMeta'` | 缺 `env.d.ts` / 未进 tsconfig include | 新版 `ojm init` 已内置；旧工程补 `env.d.ts` 并加进 `include` |
| `@types/react` / `typescript` 为 `*` | 宿主 versions.json 未收录 | 安装后钉成实际版本 |
| 登录 401 且非 `invalid credentials` | `/auth/*` 不在 `anonymous_paths` | 补进 `api/config.yaml` 后重启 |
| 反复失败登录（含首登改密前）后登录恒 401 `invalid credentials`，但口令正确 | per-IP 登录限速 `sys_rate_window`（阈值 30/min，见 `api/src/auth/_shared/login-throttle.ts` 的 `rateLimit("login:ip:${ip}", 30, 60_000)`）被压满，`guardLoginThrottle` 在窗口超限时抛 401 并复用 "invalid credentials" 文案掩盖 | 复跑前清表：`sqlite3 api/db.sqlite "DELETE FROM sys_login_throttle; DELETE FROM sys_rate_window;"`；或冷起新 db（`rm -f api/db.sqlite*` 后 `ojm dev` 重建 seed）一次性成功登录 |
| 新增后端模块目录后接口 404 | 目录镜像路由未热加载 | 重启 `ojm dev` |
| DELETE 请求 405 | 方法名写成 `delete` | 改为 `del` |
| `ojm api` 报 apiPrefix 与目录名不符 | 违反 AC-D9 | 改 `apiPrefix` 或移动契约目录 |
| 迁移账本落后拒启（M004） | release `verify` 门禁 | 先 `oj migrate -c api/config.yaml -d api/dist` |
| 方案工程 `oj build` 报 `S005: <mod>/manifest.yaml: tables 声明 "x" 不在 schema.yaml` | oj 用 schema.yaml 做表结构真源，manifest.tables 只是引用面 | 在 `api/src/<name>/schema.yaml` 按声明式格式补该表（`tables: {<table>: {pk, columns}}`），与 migrations 的建表语句对齐 |
| 方案包 `ojm build --bundle` 报 `C2-25 缺少 web/src/<name>/locales/{zh-CN,en-US}.json` | manifest 只要引用了 `title_key`/`label_key` 这类 i18n key，就必须提供双语 locale（后端方案同样要） | 建两份 locale JSON；key 必须**嵌套**（`{"menu":{"main":"…"}}`），平铺 dotted key（`"menu.main"`）查不到 |
| `ojm build --bundle` 报 `C2-12a`（tables 与 schema 不一致） | 同上：清单声明与 schema.yaml 表集必须逐一相等 | 改 manifest.tables 或 schema.yaml，二者取并集后保持一致 |
| 方案装了但路由 404 / `routes.js` 是空表 | `oj build` 只编译 `.ts` handler；直接放 `ping/api.js` 不会进 dist | 方案工程 handler 写 `api.ts`（由 oj build 编译成 dist 里的 `api.js`） |
| 安装 POST 返回 200、但 `GET market/task?id=` 恒 404 | 宿主 config 缺 `fs:` 段 → 安装器落盘被 jail 拒，失败发生在任务文件写入之前 | cli ≥ 0.2.13 的模板自带 `fs: {root: ., readonly: false}`；旧工程手补后重启 |
| 安装卡在 `preflight`：`C2-09 无法读取宿主 runtime 版本` | 安装器读 `api/dist/versions.json`（B-11 与 manifests.yaml 同层），而早期 `ojm build` 只写 `web/dist/versions.json` | cli ≥ 0.2.13 的 `ojm build` 已双落点；旧版手抄一份 `cp web/dist/versions.json api/dist/versions.json` |
| 安装卡在 `reloading`：`NotCapable: module '_platform' is not platform-privileged` | 宿主 config 的 `platform.modules` 未列 `_platform` | 模板自 0.2.13 起自带 `platform: {modules: [_platform], root: src}`；旧工程手补 |
| 安装卡在 `reloading`：`reloadConfig 返回 unchanged` | 用 `ojm preview` 起站——它服务派生 config（`.ojm-preview.yaml`），而安装器热更改的是 `api/config.yaml`，被监视文件没变 | 安装验证必须对**真实 config** 起站：`(cd api && ../bin/oj serve -c config.yaml -b /api --api-path dist)`，并把 `platform.root` 改成 `dist` |
| 安装卡在 `smoke`：探活 404 | dev 形态（`--api-path src`）起站，装好的模块落在 `api/dist`，不被发现 | 安装目标恒为 release 部署；先 `ojm build`，再以 `--api-path dist` 起站 |
| 安装卡在 `smoke`：探活 401（方案声明了 `api.anonymous`） | auth 守卫在**装配期**读 `anonymous_paths`，安装器刚注册进去的匿名路径要重启才生效 | 重启站点后重试安装即可（装成的模块与锁都在，重试走重装路径）；或安装前把该路径预置进 `config.anonymous_paths`。`ojm market trial` 已在隔离站点预置（验机制而非重启时序） |
| 深检报 `ledger` / `ledger.stale`，但 `_oj_migrations` 里明明有该模块的行 | `journalHeadOf` 走 `db.table("_oj_migrations")`，而该表未在模块 `schema.yaml` 声明 → 查询被元数据校验拒 → 返回 null → 判定为「落后」 | **已修**（0.2.13 工作区）：`_platform/schema.yaml` + `manifest.yaml` 声明 `_oj_migrations`（列与 oj 真表逐列对齐，DDL 仍归 oj 自建自管），`db.table` 元数据校验放行 → 深检 ledger 项零误报、安装器账本 head 真源恢复。若旧宿主复现：给 `_platform` 补同样的表声明后重启 |
| 想确认「这个包到底能不能装」又不想碰自己的工程 | 手工起站试装要清场、还会污染信任库 | `ojm market trial --fixture <name>@<version>`：一次性隔离站点（随机端口 / 一次性 DB/密钥/凭据/信任库/CDN）跑完整安装，跑完即毁；`--keep` 保留现场。实测 11 段全 ok 约 12s |
| `oj serve` 报 `platform.root (...) must be mounted as an api mount` | release（`--api-path dist`）下 `platform.root` 仍指 `src`，与生效的模块根不一致 | 把 `platform.root` 改成 `dist`（`ojm preview` 派生 config 时会自动改写） |
| `ojm init`/`ojm vendor` 报「上游 @oj-bin/oj 的 latest 是 vX，低于 ojm 要求的最低版本 v0.1.81」 | npm 通道发布滞后于 `MIN_OJ_VERSION` 门禁（门禁钉模板硬需求版本，ojm 不做兼容分支；0.1.81 起因模板 `solution-perms` 依赖 `startswith` 操作键，旧 oj 卸载方案会 `unknown variant startswith` fail-closed） | 本机已装 ≥ 门禁的 oj 时：把 `bin/{oj,devkit/,plugins/,.oj-version}` 预置进工程再跑 init（bin/oj 存在即跳过 vendor）；否则等上游发布或降级 cli |
| `pnpm install` 报 `ERR_PNPM_NO_MATCHING_VERSION ... @oj-module/cli@0.1.20` | 验证的是未发布版本，npm 上没有 | 删 devDeps 的 cli（源码 bin 直跑）+ 用 §0.5 的 `pnpm add <runtime 本地 tgz>` 把 runtime 装进 devDependencies（双包均未发版时 cli/runtime 都要处理）；**勿用 `ln -s` 把裸 runtime tarball 链进 `node_modules`**——裸包无 `node_modules`，`export { z } from "zod"` 解析成 `any`，会让生成物 `__client/index.ts` 的 `.map(i => …)` 全报 TS7006，typecheck 假红。也勿用 `file:` 链 cli（两包的 `catalog:` 依赖只对 workspace 成员解析，报 `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`） |
| `oj build` 报 `module '_shared' missing manifest.yaml` | 模板里残留**空目录**（git 不跟踪空目录，删文件不删目录），init 连空目录一起拷进工程，oj 把每个 api/src 子目录当模块 | 删模板里的空目录；cli ≥ 0.1.20 的 `copyTemplates` 已加空目录跳过防护（`dirHasFiles`） |
| `ojm api --check` 报 `routes.js 与契约路由表不一致——dist 缺：GET notifications/` | 契约侧 fullPath 对模块根路径带尾斜杠（`stripBase` 的 `rel || "/"` → `/notifications/`），dist pattern 无斜杠（`notifications`），键不等误报；且豁免原只过滤「dist 多」 | cli ≥ 0.1.20 已修：第三腿双侧尾斜杠规范化 + 豁免对「dist 缺/dist 多」对称过滤（回归测试见 `tests/cli/contract-check.test.ts`） |
| 手工改过 `openapi.json`（`del`→`delete`、operationId 改名）后 `--check` 漂移 | oj ≤ 0.1.72 的 `oj openapi` 产出非法 `"del"` 操作键 | 升级 oj ≥ 0.1.73（`del`→`delete` 归一）后删手工改动重生成；client 用原生 operationId 派生名 |
| `pnpm install` 卡死：20min+ 无 lockfile、`node_modules` 近空、pnpm 进程低 CPU 干等 | 直连 `registry.npmjs.org` 被限速（实测 ~18KB/s，单个 tarball 30s 下不完），pnpm 卡在元数据解析段 | 本机 pnpm store 已预热（装过同版本矩阵）时 `pnpm install --offline`，实测 1.6s 完成；store 不全时换镜像源或等限速恢复。**环境问题，非框架缺陷** |
| 新模块 `entry.ts` 被 `tsc` 拦：`TS2322 (ctx) => void 不匹配 (ctx) => Promise<void>` | `lifecycle.onInit` 签名要求返回 Promise；照抄老模块时容易漏 `async` | 写 `async onInit(ctx)`（范本：模板 `src/app/web/notification/entry.ts`；devkit SKILL「注册时机」红线已补明） |
| `ojm init` 报 `init.include.yaml 收录了不存在的路径：.gitignore`，工程只剩空目录 | npm/pnpm pack 剥离 `.gitignore` 点文件（npm-packlist always-exclude，`files` 字段绕不过）；include 白名单收录它 → 安装包缺文件 → `readInitInclude` fail-fast 在拷贝任何文件前中断。**演练盲区**：playbook 当时用源码树 CLI 演练，源码树里该文件存在故全绿——演练形态 ≠ 发包形态 | cli ≥ 0.2.6 已修：`.gitignore` 改由 init 现场生成（`ensureGitignore`，与 `pnpm-workspace.yaml` 同型），include 清单移除该条目；守卫：`tests/cli/release-manifest.test.ts` 逐条核对清单条目落在 tarball 内；演练按 §0.5 用本地 pack 的发布包 |
| 通知「全部已读」在 sqlite 开发库 500：`markAllRead` 用 `db.table(...).fromSelect(...).orIgnore()` | oj 0.1.81 在 sqlite 上 `orIgnore` 的 upsert 子句只跟随 VALUES，不支持 SELECT 源（实测 `orIgnore with fromSelect is not supported on sqlite`）——构造器无法表达「`INSERT OR IGNORE ... SELECT`」。oj **0.1.125** 复测仍被拒 | 退回裸 `db.exec("INSERT OR IGNORE INTO ... SELECT ...")`；**`orIgnore` + `fromSelect` 组合在 sqlite 上不可用**，别用。**更正（诚实账，2026-11-09）**：本行原写「三方言通用」系误判——`OR IGNORE` 是 sqlite 专属，MySQL 8.4.11 报 1064、PG 16.15 报语法错，`db.exec` 不改写方言；通知铃「清除」在 MySQL 真机即因此失败。完整闭环需求见 `docs/devkit/sql-builder-missing-capabilities-pr.md` **§7**，跟踪见 §11 **U3**。**更新（2026-11-09 二轮）**：上游 `oj 0.1.128` 已补齐 sqlite `fromSelect().orIgnore()` 并改 mysql 为 `INSERT IGNORE`、pg 裸 `$n` 类型推断；模板两处已迁移到构造器、补 0006 唯一约束、`MIN_OJ_VERSION` 抬 0.1.128，三方言真机 + e2e 5 passed 全绿，U3 已闭环（见 §7.8）。本行「退回裸 db.exec / 0.1.125 仍被拒」为 0.1.125 及以前的历史状态，勿再据此回退 |
| `ojm dev` 报 `@oj-module/runtime: 安装版本 0.2.66 与宿主严格相等校验失败（期望 0.2.25）` | 全局 `ojm` 与本机工程的 runtime 版本不一致——C4/D12 门禁要求严格相等，防双实例 | 用与仓库同版本的源码 CLI（`node packages/cli/bin/ojm.mjs`，或模板工程里的 `node ../bin/ojm.mjs`）；发版形态用与工程同版本的 cli。**不要改工程 runtime 去迁就旧 cli**（那只是把门禁哄过去，跑的不是你要验的代码） |
| `oj serve` / `ojm dev` 报 `module _platform: at seq 19: applied migration V1__create_users is different than filesystem one V1__baseline` | 迁移账本压平后老 dev 库仍记着旧文件名，与文件系统新基线不一致 | 删**真库** `packages/cli/templates/db.sqlite`（连带 `-shm`/`-wal`）重启重建。`packages/cli/templates/api/db.sqlite` 是历史残留，删它没用。压平不提供 shim，也不做双基线兼容 |
| `ojm keygen --out ./keys` 把密钥写进了仓库根 | `keygenCommand` 按 `opts.cwd ?? process.cwd()` 解析相对路径，脚本的 cwd 未必是你以为的目录 | 脚本里一律给绝对路径（`--out /tmp/xxx-keys`）；测试用例同理 |
| `keygen --credential` 返回 `400 发布凭证无效或已失效（可能已兑换、已过期或已撤销）` | 凭证是**一次性令牌**，兑换成功即 `used=1`；过期/撤销同文案 | 回站点「发布管理」重新申请；同一 token 不能给第二台机器或第二次 CI 复用 |
| 新建用户申请凭证返回 `403 password change required` | 建号默认 `must_change=1`，「悬挂期」只放行改密，其它写端一律 403 | 先 `PUT /api/auth/password`（本人 + 旧口令）改密，用返回的新 token 再申请 |
| 安装返回 `503 安装需要站点 canonical origin` | `config.yaml` 缺 `vars.canonical_origin`，而市场基址是相对路径 `/cdn`；REG-CS6 不读 Host 头 | 本地演练填 `http://127.0.0.1:9778`（模板默认注释掉），重启后重试 |
| 安装 partial：`reloading` 阶段 `reloadConfig 返回 unchanged` | 对着 `ojm dev` 装——dev 的文件监听先在安装器之前 reload 了 config，安装器自己 reload 时已无变化 | 安装验证只对 `oj serve` release 形态做（`ojm preview` 同理不行：它服务派生 config） |
| 装完 `curl /api/<name>/ping` 返回 `400 missing tenant header` | 漏了 `X-TENANT-ID` | 探针加 `-H 'X-TENANT-ID: default'`；这是缺参数，不是安装失败 |
| 方案页 ErrorBoundary：`Error: The 'prefixUrl' option has been renamed 'prefix' in v2 ...`（ky v2 抛错，页面整页崩） | 方案页代码对 runtime scoped `request` 再传逐请求 `prefixUrl`（ky v2 已改名 `prefix`）；D11/P6.3 本就禁止逐请求 prefix 覆盖——scoped client 出厂已带 apiPrefix | 去掉第二参数直写 `request.get("books/list")`（2026-11-07 drill3 0.1.4 实证：改后 Table 正常渲染、console 零错误） |
| 同版本重发被 409「.sig 已与 tgz 配对入库，不接受换签」拒（未改任何源码） | **装过该方案的工程**重发同版本：installed-merge 的运行期旁车 `.ojm-module.json` 躺在 `dist/web/modules/<name>/<ver>/`（与 api 版本目录同病），`ojm market publish` 的 `cpSync(recursive)` 把旁车 swept 进包 → 包字节漂移（实测 5558→5722 B）→ .sig canon 绑 sha256 变 → 服务端按换签拒。同字节幂等重推的前提（确定性打包）被旁车打破 | 已修（cli 0.2.74，2026-11-07 drill3 实锤）：bundle 组装 `copyPackageDir` 过滤点文件（api/web 两处同 helper）；修复后已安装工程重发包 sha256 与首发**逐字节一致**（0740314e… 复现）。守卫 `market-bundle.test` 旁车不入包断言 |
| 两个账号用同一产品名各申请一张凭证都成功 | 站点只保证 **key_id 唯一**（`<product>.<username>`），产品名不是独占命名空间 | 文档不得宣称「站点替你裁决产品归属」；同名方案的发布权靠团队约定 + 市场包名/版本冲突拦截 |
| MySQL 上 `ojm dev` 启动即退：`1064 ... near 'AUTOINCREMENT, category TEXT NOT NULL DEFAULT ...'`（`module=home`） | `home`/`notification` 的建表迁移只有 sqlite 基础件（`INTEGER PRIMARY KEY AUTOINCREMENT`），却各自已有 0002/0005 的 `.mysql.sql` 覆盖——覆盖是**按版本号替换**，0001 仍回落基础件；pg 侧同样缺 0001/0003/0004 | 已修（工作区，随下一版发布）：补齐 `home/{0001.mysql,0001.pg,0002.pg}`、`notification/{0001,0003,0004}.{mysql,pg}`、`0005.pg` 与四份方言 seed。守卫 `templates-migration-schema-parity` **m-5**：方言实际执行的迁移/seed 不得含 `AUTOINCREMENT`、`INSERT OR IGNORE`、mysql 的 `CREATE INDEX IF NOT EXISTS` |
| MySQL/PG 上 `_platform` seed 报语法错，或整段设置不生效 | **oj 0.1.120 及以前只读 `seed.sql`**（`seed.rs:17` 是常量），不按方言回落 `seed.<dialect>.sql`（旧观察：把 `seed.sql` 移走后 `_platform` seed 被静默跳过、无告警）。当时方言 seed 只有**部署期手工替换**约定（devkit 手册树结构写着「部署到 mysql/pg 用」） | 已修（oj `0.1.121`，2026-11-05）：方言件存在即胜出、`seed.sql` 兜底且绝不双跑，起服日志打 `file=` / `dialect=`，缺匹配与错名都会 warn，`oj check` S003/S006 覆盖全部变体——**不再需要覆盖文件**。见 §11 **U1** 与 [`migration/oj-requirement-seed-dialect.md`](../migration/oj-requirement-seed-dialect.md) |
| `_platform/seed.mysql.sql` / `seed.pg.sql` 里一条 `sys_setting` 都没有 | 手抄基线时漏了 8 条设置默认值（`sys_setting` 的 `key`/`group` 在 mysql 要反引号、pg 要双引号，整段跳过），部署后设置页与登录方式发现缺默认值 | 已修：两份方言 seed 补齐 8 条；守卫 **m-6**：方言 seed 与基础 seed 的表×条数必须一致，且一行只允许一个语句终止符（`; ON CONFLICT` 这类拼接会切出孤立语句） |
| PG 上登录恒 500：`db exec: integer out of range`（`INSERT INTO sys_rate_window`） | `_platform` 的 pg 基线把毫秒 epoch 列声明成 `INTEGER`（int4 上限 2.1e9，`Date.now()` 是 1.7e12），mysql 同名列是 `BIGINT`；同病：`sys_login_throttle.blocked_until`、`sys_oplog.create_time`、`sys_setting.update_time` | 已修：pg 基线这批列与 `sys_refresh_token.{expires_at,created_at,user_id}`、`sys_user_role.user_id`、`sys_oplog.user_id` 统一 `BIGINT`；守卫 **m-7**：mysql 为 BIGINT 的时间列在 pg 不得收窄为 INTEGER |
| PG 上通知列表 500：`UNION types integer and text cannot be matched` | `noticesFor` 的 UNION 第 4 列左分支是 `is_read`（整数）、右分支取 `read_time`（文本）；sqlite/mysql 宽松放行，pg 严格要求同型 | 已修：广播分支改 `CASE WHEN r.read_time IS NULL THEN 0 ELSE 1 END AS is_read`，`mapItem` 统一按整数判已读（三方言同一份 SQL） |
| MySQL 上新建用户/推送广播返回的 id 与真实行不符（建号返回 59 实际 5；广播返回 `b:58` 实际 `b:1`） | `returning(["id"])` 在 mysql 走两步 `SELECT LAST_INSERT_ID()`，宿主在**连接池**上执行第二步，取到别的连接最后一次插入值（日志里 INSERT 与 LAST_INSERT_ID 是两条独立 SQL）；pg 原生 `RETURNING` 无此问题 | **已由上游修复**（oj `0.1.120`，`oj-bin` 提交 `2550bd5` / tag `v0.1.120`）：池路径自开短事务（`Exec::Owned`），insert 与 `SELECT LAST_INSERT_ID()` 钉同一连接，事务外也安全；取 id / commit 失败整条回滚。本仓处置=升级 oj ≥ 0.1.120，模板无需改动（此前也未做绕行）。复验：MySQL 冷库连发两次 `POST /api/system/users`，`data.id` 必须落在 `SELECT id FROM users` 的新行上（2026-11-05 已在 oj 0.1.120 上实测：串行 3/3、并发 30/30、广播 10/10 一致，见附录 A「补充复验」）。见 §11 **U2**（已关闭） |
| 同一份模板在 mysql/pg 上跑，`key`/`group` 等保留字列让 seed 无法三方言共用一份 | sqlite/pg 用双引号当标识符，mysql 只在 `ANSI_QUOTES` 下才认双引号；`key` 在 mysql 是保留字 | 方言 seed 必须整段重写这三类语句（只改 `INSERT OR IGNORE` 前缀不够）；基础 `seed.sql` 仍是唯一真源，方言件靠 m-6 对齐 |
| **2026-11-07 六连修（§7.6 市场线 Phase B 演练实锤，common root：单测注入面绕不过 oj 平台授权/装配层）**：① 首装/收敛 `NotCapable: module 'oj-market' is not authorized for exec` → 模板 config `platform.exec` 补 `oj-market` 授权（与 `_platform` 同集合，YAML 锚点同源；守卫 exec-grant.spec）。② 装到 reloading 段 `NotCapable: not platform-privileged` → `platform.modules: [_platform, oj-market]`（编排面 reload 特权；迁移自 _platform 端点时代）。③ web-only 包 `deploying_web` 必败（`web.entry 在 staging 不可读`）→ lock_commit 对无 api 段包**整体 rename** staging 致部署段读空；deployWebStage 回落**版本目录**读 web 树。④ web-only 包写锁致 `reloadConfig 400: parse .../oj-market-0.2.0/manifest.yaml: missing field desc`（oj 拿 C2 方案清单当原生七键清单装配）+ 锁条目遮蔽同名内建编排模块 → lock_commit web-only **api 锁零变更**（版本目录仍归位作回滚素材）。⑤ 卸载 oj-market 方案把**内建编排模块**的锁条目与 `dist/api/oj-market-0.1.0/` 目录删了（版本解析「锁优先」）→ 解析 **sidecar 优先** + 锁条目归属裁决（同名不同轨不摘）。⑥ 双轨同名卸载 reload 报 `unchanged` 被「卸载空转」守卫误拒 → `assertReloadApplied` 增 `lockRemoved` 豁免（锁条目保留时 unchanged 属预期）。守卫：exec-grant/preflight/uninstall/installer 四 spec 共 6 新用例；旧工程升级须手工补 config 双授权（exec grant + platform.modules） |
| 改了 `packages/runtime/src/**` 源码后跑 e2e / `ojm dev` 手验，前端仍是旧样式或旧逻辑，新回归用例假失败、旧用例假通过（本轮 N5：源码已带 `dark:hover:bg-gray-700`，`html.dark` 与 CSS 规则都在，页面 `List.Item` 的 className 却还是旧 `hover:bg-gray-100`） | `ojm dev`（`dev.ts` 的 `resolveShellDist()`）服务的是 CLI 预构建宿主 `packages/cli/shell-dist/assets/runtime.<hash>.js`，**不是** `packages/runtime/dist/runtime.js`。shell-dist 是 gitignored 预打包产物，只在 `pnpm --filter @oj-module/cli build:shell`（或发布流水线）时从 runtime 源码重建；单跑 `pnpm --filter @oj-module/runtime build` 不刷新它，而 dev 每次只经 `buildModules()` 重编本地模块、不重编 shell 资产 | 验 runtime 源码改动（含 e2e）前先 `pnpm --filter @oj-module/cli build:shell`（约 6s，内部先重建 runtime 再把 `dist/runtime.js` 拷进 shell-dist 并重新内容哈希）；用 `grep -o '"@oj-module/runtime": "[^"]*"' packages/cli/shell-dist/index.html` 拿到新资产名，确认其中含你改的 className/样式。CI 发布流水线（`scripts/publish-packages.mjs`）本就重建 shell-dist，源码合入后 CI 全绿；假象只出现在本地「改了源码没 rebuild shell」的场景（2026-11-09 实证，N5 复开后 `build:shell` 即转绿） |
| `oj exec` 直连租户表（`tenant.enable` + `sql_guard: deny`）验证时，构造器查询恒报 `tenant guard: … require tenant context (missing tenant header; use db.asSystem() for system tasks)`；`db.asTenant("default")` 被拒「only allowed on anonymous requests」，给 `globalThis.http` 赋 `tenantId` / `headers["X-TENANT-ID"]` 均不生效 | `oj exec` 没有 HTTP 请求上下文，守卫从请求租户头取值（JS 层 `http` 只是只读投影），`asTenant` 又只认匿名请求 | 真机探针开头调一次 `db.asSystem()`（请求级绕过，devkit 明定的系统任务通道）即可查租户表；**但它同时关掉本请求全部构造器 tenant 注入**，故该形态只覆盖方言渲染/幂等/列对齐，tenant 自动注入与源 select 租户收窄必须另用真实 HTTP（e2e 带 `X-TENANT-ID`）补验。另：`oj exec -e` 内联代码不支持相对 import（无基准目录），但 `import("file:///abs/path/to/module.ts")` 可加载真实源码模块（2026-11-09 三方言探针实证） |

### 9.1 构造器迁移后的 L1/L2 边界与 vitest 190 红基线（2026-10-20）

**架构定论**：`db.table()` 构造器是 oj 二进制内的**纯 Rust 实现**，无 JS 模块可导出——Node 侧
（vitest 夹具）原理上垫不出真 `table()`，任何 JS 复刻都是会漂移的第二真相。两层测试因此定型：

- **L2（`tests/*.spec.ts`，vitest + node:sqlite 夹具）**：夹具 `g.db` 只给
  `{query, exec, tx, dialect}`（见 `tests/fixture.ts` 头注）。构造器面用**记录型假 builder**
  （记 `where/orderBy/limit` 调用序列做编排断言，样板 `query-utils.spec.ts` / `rbac-settings.spec.ts`）；
  真 SQL 执行断言走 `db.query` 直查内存库。
- **L1（`tests/*.test.ts`，`oj test` 收集）**：真 v8 + 真路由/鉴权 + 真迁移/seed/fixtures +
  真构造器，守 SQL 渲染/过滤/转义的真执行面（样板 `tests/l1-builder.test.ts`；方法论
  devkit `oj-test-guide.md`）。

**vitest 基线（2026-10-20，单一可复现命令）**：
`npx vitest run -c packages/cli/templates/api/vitest.config.ts --reporter=json` →
**190 failed | 409 passed (599)，19/33 文件**。按报错文本归类（判据：failure message 含
`table is not a function`）：**86 直接**（`db.table`/`tx.table` TypeError）+ **104 级联**
（89 AssertionError——handler 500 信封致 `data` undefined；13 其他 TypeError——undefined
读数；2 Error——lifecycle 步骤副作用断链）。**单一根因族**：模板 src 全面迁构造器后，
L2 夹具没有 builder 面。这是结构性欠账，**不是本轮新增回归**（迁移前同源码的红随迁移推进
等比扩大）。

**处置政策（逐条修复时按此分轨，勿整体 L2 化）**：

1. handler 对构造器的使用是** incidental**（真逻辑在别处）→ L2 化：记录型假 builder（见上样板）；
2. 行为**就是** SQL 渲染/过滤/转义 → 属 L1，补 `*.test.ts`（见上样板）；
3. 两条都不沾（纯 orchestration）→ 修夹具数据准备，不给 builder。

**L1 契约坑速查（本轮实测）**：

| 现象 | 原因与解法 |
| --- | --- |
| `client.get("/api/x")` 恒 404（日志 `/api/api/x`） | `client` 路径**相对 base**（base=`/api`），多写一层前缀即翻倍；正确写法 `client.get("/x")`。`client.login` 同理（内部 POST `/auth/login`） |
| `expect(...).toHaveLength is not a function` | L1 `expect` 只支持 `toBe/toEqual/toBeTruthy/toBeFalsy/toContain`（api-manual §9 契约）；改 `expect(x.length).toBe(n)` |
| 登录后打鉴权端点恒 403 `must_change` | 该账号处于强制改密悬挂（`must_change=1`，见 users 表）；`currentAccess()` 悬挂期全拒。seed 四个角色账号现均为 `must_change=0`（2026-10-22 口径），悬挂只可能来自「管理员重置口令 / 新建账号」路径；L1 用 fixtures 专用账号（`l1tester`，`must_change=0`，`src/_platform/fixtures/l1-test-user.sql`，仅 `oj test` 灌入、additive 不动 seed 账号） |
| 口令正确却登录 401 `invalid credentials` | dev 库 admin 口令被首登改密流程改过（seed 重放 `INSERT OR IGNORE` 不复位既有行）；本地重置 `rm -f api/db.sqlite*` 后重跑（迁移+seed+fixtures 重建），或直接用 fixtures 账号 |
| 重复跑 L1 断言飘 | `oj test` 每轮重放 迁移→seed→fixtures 且 INSERT 类只增不改；断言按**自己推的行**收敛（push→拿回 id→按 id 断言，样板见 `l1-builder.test.ts` 通知用例） |
| 可选过滤传 `""` 仍发出 `= ''` 条件 | `whereIf` 跳过集是 `undefined/null/false/[]`，**`""`/`0` 是合法值会保留**（api-manual §whereIf）；缺失值必须归一化为 `undefined`（`oplog.ts` 2026-10-20 修复同款坑） |

## 10. 复跑脚本（TL;DR）

> 日常回归跑 §0.3 快线；下面是从零的全量线（发版前 / oj 升级后）。

```bash
set -e
export VERIFY_DIR=/tmp/ojm-verify OJM_REPO=/Users/ever/git/only-js/oj-module
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
# §0.5 发布形态：pack → 解包 → 安装（演练与发包逐字节一致，防打包差异漏网）
export CLI_PKG="$VERIFY_DIR/cli-pkg"
pnpm --dir "$OJM_REPO/packages/cli" pack --pack-destination "$VERIFY_DIR"
tar -xzf "$VERIFY_DIR"/oj-module-cli-*.tgz -C "$VERIFY_DIR" && mv "$VERIFY_DIR/package" "$CLI_PKG"
pnpm install --dir "$CLI_PKG"
# npm 通道 oj 低于门禁时先预置（§0 旁路 1）：mkdir my-books/bin && cp ~/.local/share/oj/oj my-books/bin/oj
#   && cp -R ~/.local/share/oj/{devkit,plugins} my-books/bin/ && printf 'v0.1.74\n' > my-books/bin/.oj-version
node "$CLI_PKG/bin/ojm.mjs" init my-books --yes
# §1.5 门禁演练（0.2.68+）：篡改 src/app 一文件 → build 应 exit 1 并指路 --yes；init --yes 后 build 应过
cd my-books && pnpm install
./bin/oj --version
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello \
  && printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts \
  && printf 'name: web\ndesc: probe\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml \
  && ./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out   # §3 探针（坏二进制约在此 panic）
# …补 books 后端（.schema 入参 + 平级 .response 出参）→ ./bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json
#   → ojm api（+ --check）→ 补前端 →
node "$CLI_PKG/bin/ojm.mjs" build && npx tsc --noEmit -p tsconfig.json && node "$CLI_PKG/bin/ojm.mjs" dev
```

> 每次框架发版后跑一遍本文档，把 §「最近一次基线」更新为新版本与结果。

## 11. 向上游改进需求（本仓绕不过去的 oj 内核缺口）

> 只收录**本仓模板/CLI 侧无法自行修好**的项；能就地修的已写进 §9。编号稳定，§9 与附录 A 按编号引用。

| 编号 | 诉求 | 现状与影响（实测） | 验收口径 |
| --- | --- | --- | --- |
| U1 | **seed 按 db 方言选择文件**：方言件 `seed.<dialect>.sql` 存在即胜出，通用 `seed.sql` 只兜底（✅ 已修复 oj `0.1.121`，2026-11-05，`oj-bin` 提交 `7d70b90`） | 修复前：oj 0.1.120 只读 `seed.sql`（`seed.rs:17` 是常量），不认 `seed.mysql.sql` / `seed.pg.sql`；`seed.sql` 移走后**静默跳过 seed 且无告警**，模板只能让方言 seed 走「部署期手工覆盖」约定（2026-11-05 已两次踩中，其中一次是根级坏副本只含 4 条设置且裸写 `key`）。修复后：`seed.<sqlite\|mysql\|pg>.sql` 存在即胜出、`seed.sql` 兜底、绝不双跑；只有别的方言件 → warn 点名，标签拼错（`seed.postgres.sql` / `Seed.Sql`）→ warn + 忽略 | 起服日志打 `file=` / `dialect=`；单测 8 条 + S006 3 条；`oj check` 的 S003/S006 覆盖全部变体且幂等判据按文件方言。**真库已验**（2026-11-05）：同一模块三份 seed，mysql 起服只落 `seed.mysql.sql` 的行、pg 只落 `seed.pg.sql` 的行，通用件零执行。`ojm` 的 `MIN_OJ_VERSION` 已同步抬到 0.1.121。**提案见 [`docs/migration/oj-requirement-seed-dialect.md`](../migration/oj-requirement-seed-dialect.md)（2026-11-05）** |
| U2 | **mysql `returning(["id"])` 两步取 id 钉同一连接**（✅ 已修复 oj `0.1.120`，2026-11-05） | 修复前：构造器 `.returning(["id"])` 在 mysql 上渲染为 `INSERT` + `SELECT LAST_INSERT_ID()` 两条独立 SQL，第二步在**连接池**上执行，可能落到别的连接 → 取到别人的 id（实测建号返回 59、真实 id 5；广播返回 `b:58`、真实 `b:1`）。修复后（`oj-bin` `2550bd5`）：`Exec::Owned` 短事务把两条语句钉在同一连接，取 id / commit 失败整条回滚；核心 `SqlxAccessor` 与 FFI 插件一处修两边 | 两条 SQL 在同一连接内执行；回归用例 `query_tests.rs` 三条（钉同连接 / 取 id 失败回滚 / insert 失败回滚）——移除修复必红 |
| U3 | **构造器支持可移植的幂等 `INSERT … SELECT`**（或给 `orIgnore` + `fromSelect` 补 sqlite 实现）。**✅ 已闭环（上游 oj 0.1.128 + 模板侧迁移，2026-11-09 二轮）**（复开需求与三方言真机证据见 [`docs/devkit/sql-builder-missing-capabilities-pr.md` §7.8](../devkit/sql-builder-missing-capabilities-pr.md)） | oj 0.1.81 起 sqlite 上 `orIgnore` 只跟随 VALUES，`fromSelect` 直接报 `orIgnore with fromSelect is not supported on sqlite`；oj **0.1.125** 真机复测仍被拒。模板「全部已读 / 清除」只能退回裸 `db.exec("INSERT OR IGNORE … SELECT")`。**更正（诚实账）**：原记「三方言通用 / 三方言拼 SQL」系误判——该裸 SQL 仅 sqlite 可用，MySQL 8.4.11 报 **1064**、PG 16.15 报语法错，`db.exec` 不改写方言；用户实测「清除」在 MySQL 即失败。另：两张回执表无 `(tenant_id,broadcast_id,user_id)` 唯一约束，`OR IGNORE` 实为空操作。附带子项：pg 的 `lit` 列渲染 `CAST($ AS TEXT)` 写不进 BIGINT、mysql 的 `ON DUPLICATE KEY UPDATE id = id` 源含 `id` 时报 1052 | ① 同一段 `fromSelect(src, cols).orIgnore()` 在 sqlite / mysql / pg 三者都构造并执行成功（`src` 含 `lit` 注入的 uid/时间戳）；② `notify.ts` 两处裸 `db.exec` 删除、`保留 db.exec` 注释归零；③ 「清除 / 全部已读」在 mysql/pg 真机不再 1064/语法错、连点两次不产生重复行；④ 模板单测 / e2e / `ojm api --check` 全绿。**本仓未在模板内加方言分支绕过**（按裁定走上游需求）；上游 0.1.128 修复后模板已迁移，上述四条验收口径 2026-11-09 二轮全部达成（三方言探针 + e2e 5 passed + `ojm api --check` 0/0，证据表见 §7.8） |
| U4 | **`oj serve --api-path` 缺省 API 基座与框架 `/api` 约定对齐**（2026-11-07 §7.7 实锤） | oj 0.1.124 `--api-path` 缺省绑 `/v1/api`（`server.base` 旧键 v0.1.58 已删，config 改不了）；而框架侧全部按 `/api` 寻址（web 应用请求 prefixUrl、`ojm market publish/install/trust` 瘦客户端、消费面）——module-root release 直起后，CLI 推送打穿到 SPA 兜底（返回 HTML doctype，报「Unexpected token '<'」），登录 POST 405「web mounts serve GET/HEAD only」。唯一正解 = 起站加 `-b /api`；config 手写 api 挂载与 `--api-path` 同给又报「module 重复声明」 | 两选一：① oj 缺省基座改 `/api`（或与 config `mounts` 的 api 前缀一致）；② `--api-path` 与 api 挂载同给时去重而非 fail。验收：module-root 工程 `oj serve --api-path dist/api` 直起后 `POST /api/auth/login` 得 JSON 应答 |
| U5 | **`ojm build`/`ojm dev` 合并已装方案的 web 登记**（✅ 已修复 oj-module cli `0.2.72`，2026-11-07 出厂即装支柱②，实现见 `docs/plans/20261107-1150-market-factory-install.md`） | 修复前：例行 `ojm build` 与 `ojm dev`（dev 启动即重建模块产物）都会重生成 `dist/web/modules.json` + `dist/web/modules/` 且只收录源码树模块，已装方案（含第一方 oj-market）的 web 面被整体冲掉——任何例行构建/开发态运行后市场菜单消失，愈合只能靠 backfill+逐方案重装（§9 对应行）。修复后：重建清单时 `restoreInstalledFaces`（版本目录重物化 web 面 + 条目旁车 `.ojm-module.json` 双落点持久化）+ `mergeInstalledModules`（state.yaml 真源并入、双轨同名 fail-fast），连续 build 告警静默 | 装方案后 `pnpm build`/`pnpm dev` 重启，modules.json 仍含方案条目、`/modules/<name>/<ver>/entry.js` 200、市场菜单不消失——2026-11-07 真机（/tmp/ojm-vv/drill）已验；守卫 `packages/cli/src/__tests__/installed-merge.test.ts` 9 例 |
| U6 | **`-b` 基座覆盖下 web 挂载相对路径静态解析落空**（2026-11-07 实锤） | oj 0.1.124：`web: "./dist/web"` 相对路径 + `-b /api` 组合时静态层解析落空——非 HTML 请求全落进 API 路由报 `no route matched`，SPA 回落（HTML）却正常，极具迷惑性；`ojm preview` 派生 config 全写绝对路径故不踩 | 两选一：① `-b` 下相对路径按 config 目录解析（与无 `-b` 行为一致）；② 启动 fail-fast 校验 web 挂载目录可达。验收：`-b /api` 起站后 `curl /modules/app/0.1.0/entry.js` 200 |
| U7 | **安装触发热重载应重放新装方案的 seed**（2026-11-07 §7.7 drill3 实锤，oj 0.1.124） | 种子重放只在**冷启动**执行（`oj-bin/oj/src/app.rs`：`if !reused { seed::replay_all(...) }`，注释「热更复用时不重放，种子是一次性初始化」）；而安装器 migrating 段显式跑 `oj migrate`（迁移随装随生效），seed 却不跑——新装方案的 seed 数据要等**下次冷启动**才落库，期间方案页数据面空。与业界安装器预期不符（安装完成即应数据就绪）。模板侧绕不过（seed 时机在 oj 内核 boot 路径） | 两选一：① 新增 `oj seed <module>` 子命令，安装器 migrating 段后对目标模块重放一次（方案 A，推荐）；② 热重载编排对新装模块触发一次 seed 重放，旧模块不重放。验收：装带 seed 的方案后不重启，`select count(*)` 即得 seed 行；重复执行行数不翻倍。**上游已交付（oj 0.1.125，`oj migrate --with-seed`，2026-11-07 第四轮 drill3 实机验证通过：幂等重灌/门禁负例/安装链路边界均实证；ojm 安装器接线 = buildMigrateCmd 加旗标 + platform.exec 白名单 + MIN_OJ_VERSION 联动，仍待办）**。提案见 [`docs/migration/oj-requirement-seed-replay-on-install.md`](../migration/oj-requirement-seed-replay-on-install.md)（2026-11-07） |

---

## 附录 A 历史基线（从新到旧，逐条可追溯）

> 基线的价值是「某版本当时到底验了什么、踩了什么」，属于事实档案，不参与日常执行；
> 新基线追加在本节最前面，最近一次的结果同时摘到文首「上次演练结论」。

### 全量线基线（2026-11-08，oj 0.1.126 / cli+runtime 0.2.76 **打包态**；§0.5 → §7.6 全链 + §7.4 walkthrough）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-08（feat/ojm；发布形态 `pnpm pack` 直出，含 prepack 的 sync-bundles 版本对账） |
| 框架包版本 | 打包态 cli/runtime 0.2.76；随站 bundle = **oj-market 0.2.3**（签名者 `platform.release` / `oj-registry`，sha256 `98bd8a11…aedf`，20934 B）；内建 api 编排面 0.2.2 |
| oj | 0.1.126（init vendor 进 `bin/oj`；`strings` 无构建机路径；JsRuntime 探针通过） |
| 工程 | `/tmp/ojm-verify`：`cli-pkg`（0.2.76 解包）+ `my-books`（dev/preview 线）+ `book2`（纯 `oj serve` 线）+ `book3`（sha384 修复后复验） |
| 范围 | §0.5 pack/解包/装依赖 → §1 init --yes → §2 依赖 → §3 oj 探针 → §4/§5 build 与 api --check → §6 dev 联调 + headless 浏览器 → §7 preview 单服务 → §7.6 A/B/C → §7.4 walkthrough → §6.5 仓库回归 |
| 结果 | **通过**。① §1 检查点全绿（cdn 三件套 + bundles.json 0.2.3、`.ojm-builtin.json`、devDeps 0.2.76、`bin/oj` 0.1.126）。② §6 dev：`routes: 94 / input contracts: 89`、登录 200、通知 200、无 token 401、SPA 200 + importmap、`/modules/oj-market/0.2.3/entry.js` 200；headless 实测市场卡 `升级/停用/卸载 disabled=true`、`回滚/历史` 可用、无 module-loader 报错。③ §7 preview：migrate ok、9778 单服务、根/entry/SPA/编排端点全 200、`api --check` 0 error/0 warn（第三腿激活）。④ §7.6 A：dev 就绪数秒内 state.yaml 落 `0.2.3/trusted`、modules.json 并入、11 段全 ok 终态 done、内建锁 `oj-market: 0.2.2` 不变。⑤ §7.6 B：全新工程纯 `oj serve --api-path dist/api -b /api` 首请求 riding 收敛，index 即返 `installed=0.2.3/trusted`，无 TOFU。⑥ §7.6 C：幂等零新任务；bundle 改 0.1.0 不降级；oj-market 卸载被拒且四态原样。⑦ §7.4 walkthrough **13 PASS / 0 FAIL**。⑧ §6.5 `vitest run` 992/992 + templates 1160/1160 |
| 本次发现并处置 | **① 数据面缺陷（已修）**：安装落盘 `modules.json` 的 `web.integrity` 为 `sha384-sha384-<b64>`——`sha384.ts` 的 `sha384B64` 自带前缀，而 installer / smoke / verify-checks 三处调用又各拼一次；三方互相自洽 + 单测 stub 用裸摘要，故历史演练全绿。修法 = `sha384B64` 回归裸 base64（名字本义），补 `sha384.spec` 形态断言与 `installer.spec` 的 C2-28 单前缀钉子；book3 真机复验 `integrity=sha384-88p421…`、`solutions/verify` 深检 ok。**② 手册漂移**：§7.6 旧稿 `0.2.0`/`0.1.0` → 0.2.3（bundle）/ 0.2.2（内建 api 面）；§7.6 C「卸载墓碑」已被第一方卸载保护替代（0.2.3 起硬拒）；§7.4 实为 13 项且 `--fixture` 不适用 walkthrough；§6 `/modules/login/0.1.0/entry.js` 404 属预期（登录页归 app 多根模块）；§7.6 B 漏写 `platform.root: dist/api` 前置（漏改即拒启）。**③ 环境**：本机 5174 被常驻服务占用 → dev 自动顺延 5175（检查点须用日志里的实际端口）。 |
| 手册同步 | 文首结论换本轮；§6 登录模块判据；§7.4 项数与命令；§7.6 A/B/C 版本、前置与卸载保护；§9 增 sha384 双前缀行；附录 A 增本条 |
| 遗留 | ① §7.7（发布 → 按名安装）本轮未重跑（2026-11-07 第二轮全绿，本轮只跑 §7.4 walkthrough 覆盖装/卸/升级/回滚/负向）。② `pnpm test:e2e` 未跑：5174 被常驻 oj-wiki 占用，playwright 的 reuseExistingServer 会挂到错误服务上。③ 本地 verdaccio 未同步 0.2.76 → 工程安装需在 `pnpm-workspace.yaml` 的 `overrides` 同时钉 cli 与 runtime 两个本地 tgz（建议补进 §0.5/§2）。 |
### 市场闭环基线（2026-11-07 第二轮，oj 0.1.124 / cli+runtime 0.2.71 **打包态**；新增 §7.7 的首轮实跑）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-07（feat/ojm @ f7fe8951e；发布形态 pack 直出，非工作区 bin——六连修后的模板首跑即打包态） |
| 框架包版本 | 打包态（`pnpm pack` cli 0.2.71，prepack sync-bundles 收编已签名 oj-market-0.2.0；runtime 复用同日 tgz）；**六连修的真机首验**：首轮 §7.6 是手工 patch 的 cli 包，本轮 templates 与包内逐字节一致（diff 5 文件零漂移） |
| oj | 0.1.124（init vendor 进 `bin/oj`） |
| 范围 | §7.6 B 复跑（drill-site 全新 init --yes → bundle 三件套落位 → 信任空窗收敛 needs_trust 任务落盘 → 推 platform.release 公钥 → 收敛 done、锁零变更、内建 0.1.0/方案 0.2.0 双轨目录并存）+ **§7.7 新闭环**（`ojm new books --api` → build/--bundle/sign（drill.publisher）→ `market publish --real` 进目录 → `ojm install books` 按名 cdn 源装 → reloading partial → 重启 → retry done → 四重落点） |
| 结果 | **通过**。① 收敛：needs_trust（verifying 预锁即停）→ trust added → 再触发 index `installed=0.2.0 enabled=true`；任务终态 done；`manifests.yaml` 无 `oj-market: 0.2.0`（锁零变更），内建 `oj-market: 0.1.0` 保留。② 闭环：catalog 匿名 `books latest=0.1.0 publisher=drill.publisher`；publish 末行「目录行 + cdn/ 字节」；install 首跑 partial（restart_pending）→ 重启 → retry「安装完成：books 0.1.0」；锁 `books: 0.1.0`、版本目录在、`/api/books/ping` `pong:true`、index 视图双方案 enabled；市场自身 index 仍 200 |
| 本次发现并处置 | **拓扑坑（未修，已列 §11 U4）**：module-root `oj serve --api-path dist/api` 缺省基座 `/v1/api` ≠ 框架 `/api`——`market publish` 推送到 `<site>/api/oj-market/cdn/upload` 打穿 SPA 兜底（`Unexpected token '<'`）、登录 POST 405；正解 = `-b /api` 起站。config 手写 api 挂载 + `--api-path` 同给报「module `_platform` declared in multiple places」（fail-fast）。另修正 §7.6 B 信任空窗口径：needs_trust 第五终态**不写冷却文件**（冷却仅 failed 硬失败写）——六连修期首跑全是 NotCapable 硬失败故有冷却，两口径并存已分写 |
| 手册同步 | 新增 **§7.7**（A 作者侧发布 / B 按名安装两段式 / C 边界）；§先选一条线表加市场闭环行；§7.6 B 补 `-b /api` 起站命令 + 信任空窗 needs_trust 无冷却口径修正；§8 汇总补 §7.7 判据；§9 表首行补基座坑；§11 增 U4；文首结论换本轮 |
| 遗留 | ① 升级闭环（books 0.2.0 发包 → 收敛/按名装 upgrade）仍待验——本轮只验首装。② U4 待上游裁决，本仓文档层已双写正解。③ drill-site 起站形态 = `-b /api`（非 init 直出），init 直出 config 的完整 release 起站脚本待沉淀进 §7.6/§7.7 前置 |

### 市场线 Phase B 增量基线（2026-11-07，oj 0.1.124 / cli+runtime 工作区 0.2.71；新增 §7.6 的首轮实跑）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-07（分支 fix/market-exec-grant，基于 feat/ojm @ be96658c9 合并后） |
| 框架包版本 | 工作区态（cli/runtime 0.2.71，未发版）；发布形态演练（§0.5 本地 pack，cli 依赖 patch 本地 runtime tgz） |
| oj | 0.1.124（init vendor 进 `bin/oj`） |
| 范围 | §7.6 全节：发布形态 pack（prepack sync-bundles 收编**已签名** oj-market-0.2.0 bundle——源码树 templates/dist 的 tgz 无 .sig，先 `ojm sign --id platform.release --registry-id oj-registry --check` 再 pack）→ init my-books --yes（bundle 三件套落位核对）→ pnpm install（旁路 2 本地 runtime tgz）→ ojm build → release 起站（platform.root: dist/api + canonical_origin + 解开 "/" web 挂载）→ 出厂未装态核对 → 信任空窗期收敛失败（history + 冷却文件实测）→ trust/key 推送 platform.release → 清冷却 → **收敛首装 11 段全 done** → 页面/编排双活 → 幂等零任务 → 降级守护 skip → 卸载 → 内建编排面完好 + 墓碑零重装 |
| 结果 | **通过（6 缺陷发现 → 6 TDD 修复闭环）**。终态全链：收敛首装 `installed=0.2.0 enabled=true trust=trusted`，任务 11 段全 ok 终态 done；`/modules/oj-market/0.2.0/entry.js` 200、`/oj-market` SPA 200、编排 index 200；api 锁零变更（`oj-market: 0.2.0` 0 条，内建 `0.1.0` 保留）；幂等对账零新任务；bundle 改 0.1.0 后 skip（状态保持 0.2.0）；卸载 ok 后内建目录/锁条目存活、编排端点仍 200、marker 摘除为空、再请求 index 零重装、modules.json 回 `app`。套件：templates 1158/1158（+6 新守卫用例）、tsc×2 零错 |
| 本次发现并处置（**六连修**，commit f808036ef → a418af413 → a5d5bc7d0） | 共同根因：生命周期单测全 DIP 注入（exec/reload/fetch/fs stub），验证编排逻辑；**oj 平台授权层（per-module exec、platform 特权）与装配层（锁驱动 parse_one）只在真机存在**——Phase B 把编排面从 `_platform` 迁到 `oj-market` 模块后，六个面从未真机验证过。① exec 授权缺失（首装即 NotCapable，history 落 failed+冷却实测捕获）→ config `platform.exec` 补 oj-market（锚点同集合，守卫 exec-grant.spec 2 用例）。② platform 特权缺失（reloading NotCapable）→ `platform.modules: [_platform, oj-market]`。③ web-only 包 deploying_web 必败（lock_commit 整体 rename 后 staging 读空——此前所有演练包都带 api 段，web-only 路径零真机覆盖）→ deployWebStage 版本目录回落（守卫 installer.spec web-only 全绿路径）。④ web-only 包写锁 → oj 拿 C2 清单装配 reload 400 + 双轨同名锁遮蔽内建编排模块 → lock_commit web-only api 锁零变更。⑤ 卸载「锁优先」版本解析把内建 oj-market-0.1.0 目录+锁条目删了（编排端点全灭，演练当场复现）→ sidecar 优先 + 锁条目归属裁决（守卫 uninstall.spec 双轨同名）。⑥ 双轨同名卸载 reload unchanged 被「卸载空转」误拒 → assertReloadApplied lockRemoved 豁免 |
| 手册同步 | 新增 **§7.6**（出厂未装与随站 bundle 收敛全节 A–D）；§先选一条线表加市场 Phase B 行；§1 检查点补 bundle 落位/双授权/oj-market 形态；§8 汇总补 Phase B 判据；§9 表加「2026-11-07 六连修」行；文首结论 + 「演练为什么能抓到单测抓不到的缺陷」方法论段 |
| 遗留 | ① 旧工程升级须手工补模板 config 双授权（exec grant + platform.modules）——无自动迁移。② 第一方包升级（0.2.0→0.3.0 收敛 upgrade 路径）需真发包，发布期验。③ web-only 方案市场内回滚不可用（锁零变更设计使然，符合双轨裁决）。④ 演练脚手架 config 是 perl/手工 patch 的（非 init 产物直出），下轮 §0.5 全量线验证 init 直出 config 的 exec 锚点/platform.modules 形态 |

### 市场线补段（2026-11-06 同日，oj 0.1.124 / cli+runtime 工作区 0.2.68；§7.1–§7.5）

| 项 | 值 |
| --- | --- |
| 宿主 | §1.5 门禁演练同一脚手架（`/tmp/ojm-verify-guard/guard-drill`，0.2.68 init 产物 + runtime symlink；release 形态 `platform.root: dist/api` + `vars.canonical_origin: http://127.0.0.1:9778`） |
| 范围 | §7.1 `ojm new demo-solution --layout none --api` → build → `--bundle`（sha256 两次一致、routes.js 有路由行、tgz 无密钥形态文件）；§7.2 `keygen --id demo.publisher` 离线身份 → `market publish --fixture demo-solution@0.1.0 --rebuild-index` → `market verify` 8 项全过 → 幂等重发；§7.3 release 起站 → `market setup` → install → `needs_trust`（指纹逐字一致）→ `trust confirm` → 重装 → 重启宿主 → 复检 done → ping；§7.4 `market walkthrough --fixture demo-solution@0.1.0`；§7.5 A–F 全步 |
| 结果 | **通过**。① §7.1/§7.2：骨架五必填齐；包 `oj-registry:demo-solution@0.1.0:6e9d7c6b…`、发布方指纹 `77937f63…000f48`；CDN v2 件齐（catalog.yaml+.sig / tgz+.sig / shards）；verify「全部校验通过（8 项）」；幂等重发无冲突。② §7.3：首装 11 段全 ok 但 `status=partial`（restart_pending，message 明示待重启段 `[auth]`）→ 重启宿主 → retry **done** 冒烟三项全过；`manifests.yaml` 锁 `demo-solution: 0.1.0`；`/api/demo-solution/ping` → `pong:true`。③ §7.4：**14 PASS / 0 FAIL**（主链 9 + 负向 5），报告落盘且脱敏 grep 零命中。④ §7.5：scripts 含 new/bundle/typecheck:api；自带折叠 N=2、`--all` 平铺；五类拒绝全命中且零写入（重名 / kebab / 保留名 auth / 内置名 home / usage rc=2）；无参打包仅用户方案、`--bundle crm` 单份、sha256 确定性；E3 坏契约 fail-fast 指名 `bad` 且 tgz 零增量（3→3）；零用户方案报错指路 `ojm new`；F 多方案 `--real` exit 1 并给出显式链路（`--bundle <name>` → `sign` → `build-index`） |
| 本次发现并处置 | ① **§7.1.0 独立工程形态被 0.2.68 守卫拦下**（`ojm new` 要求工程上下文，独立目录拒且零写入）→ 链路改为宿主内 new → `--bundle <name>` → `publish --fixture`，§7.1.0 已补注。② **首装终态是 partial 不是 done**（oj 0.1.122+ restart_pending 语义，11 段全 ok、待重启段明示）→ §7.3 检查点已改为「partial → 重启 → retry done」两段口径。③ **§7.2 检查点 `/cdn/bundles.yaml` 过时**：v2 索引真名 `catalog.yaml`（200），`bundles.yaml` 文件不存在（404）→ 检查点已改名。④ **§7.5 E 与 §1.5 门禁双层交互**：塞自带契约先被门禁拦（extra 漂移）；删名单绕行会**同时失去自带排除**（同一真源），实测 `app` 被打包且 `dist/app-0.1.0.tgz` 残留 → E 已补 0.2.68 口径注。⑤ `market setup --new-pass` 只设了市场地址，superadmin 口令未变（setup 输出未提改密结果）——观察项，不阻断（trust confirm 用原口令通过）。⑥ install/task 探询漏 `X-TENANT-ID` 得 400——§8 既有发现④再次命中，§7.3 脚本已补头。⑦ 演练 fixture 教训：`--layout none` 方案被塞进 `api:` 段而 api/ 不存在时，打包 fail-fast「缺少 oj build 产物 dist/api/<name>」——契约声明与目录必须同源。 |
| 手册同步 | §7.1.0 补 0.2.68 守卫注与新链路；§7.2 检查点 bundles.yaml → catalog.yaml；§7.3 install 脚本补租户头、检查点补 partial→done 两段语义；§7.5 E 补门禁双层口径注；文首结论并提市场线 |

#### 市场线补段之二：真实骨架包闭环 + `ojm new` 骨架缺陷修复（同日晚）

> 首轮市场线的安装/装成验的是 `publish --fixture` **合成的最小合法包**（fixture.ts 现场合成，
> 非 §7.1 真实骨架）；文档口径核对时发现并当场用 §4.2 显式四步把真实骨架包重走了一遍。

- **发现并修复（框架缺陷）**：`ojm new --api` 骨架的 `solution.yaml` 漏了 `api.anonymous` 声明——
  ping 匿名可达但契约未声明，安装预检 **`anonymous_residual`** 拒装（合成 fixture 因声明了
  `anonymous: ["<name>/ping"]` 而装得进，正好构成对照）。已修 `new.ts` 模板（补声明一行），
  TDD 用例钉住（`new-scaffold.test.ts`，红→绿）。
- **真实包闭环**：`ojm build` → `build --bundle demo-solution` → `sign --check`（指纹 `77937f63…`）→
  `cp tgz+.sig cdn/` → `build-index`（第 3 代）→ `install` → **`安装完成：demo-solution 0.1.0`** →
  重启宿主 → `/api/demo-solution/ping` pong。途中复证两条既有判罚：**卸载会把
  `dist/api/<name>-<ver>` 版本目录一并移除**（重发同版本前必须先 `ojm build`，手册 §7 已有该行的
  药方被实测命中）；契约声明 `api:` 段而产物缺失 → 打包 fail-fast「缺少本方案的站点产物」。
- **手册同步**：publish-walkthrough §0 前提补「匿名端点须在 `api.anonymous` 声明」与「保护根」两条；
  §4.1 补 `--fixture` 非发布通道警示；§6 补首装终态两段式与 setup 改密实情；§7 表补
  `anonymous_residual` / restart_pending 两行、卸载删产物并进「缺少站点产物」行；manual §11.3 补
  partial 两态语义与 anonymous_residual 预检；playbook §7.1.0 链路更正（`--fixture` 非发布通道）。 |

### 最近一次基线（2026-11-06，oj 0.1.124 / cli+runtime 工作区 0.2.68；快线 + 脚手架门禁 + 仓库回归）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-06 |
| 框架包版本 | 工作区态 `feat/ojm` @ `cc1e70f94`（cli/runtime/shell 均 0.2.68；未发版） |
| oj | 0.1.124（`ojm init` vendor 进演练工程 `bin/oj`） |
| 验证动机 | 下游反馈六项修复/新增后回归：admin 路由 id 同步（菜单选中态）、侧栏主/底菜单遮挡、`resolveRoutePath` 公开导出（含 admin 子树后代祖先链扩展）、admin 默认 `layout: "container"`、脚手架完整性门禁、`ojm init --yes` 恢复语义 |
| 范围 | §0.3 快线（templates：`info` / `api --check` / `build` / 删库重建 dev + HTTP 检查点）；§1.5 门禁演练（`/tmp` 全新脚手架，源码 CLI + §0 旁路 2 symlink runtime）；§6.5 仓库回归（`pnpm test` + `pnpm test:e2e`）。全量线 §0.5/§1–§7 本轮未跑（打包面无改动，发版前补） |
| 结果 | **通过**。① 快线：`info` cli/runtime/shell 三行 0.2.68；`api --check` **0 error / 0 warn**；build 产物 `modules.json` = `app,oj-market`、`dist/api/versions.json` 在；dev `routes: 91 method-row(s), 75 pattern(s), 43 api file(s)`、`input contracts: 87`；`GET /api/auth/login` → 405；登录 token 156 字符；带租户头 `GET /api/system/users` code:0、`GET /api/notification/notifications` code:0 数组、无 token **401**。② §1.5 门禁：新脚手架 `.ojm-builtin.json` + `src/README.md` 就位、基线零漂移 build 过；篡改 `system/routes.ts` + 造 `extra-page.tsx` → build **exit 1**，分组列出「内容被修改（1）/ 多出（1）」并指路「上游自治 / `ojm init --yes`」；`init . --yes` 后篡改恢复、extra 删除；自定义 `src/crm`（`defineModule` + locales）全程保留并进 `modules.json`（`app,oj-market,crm`）；删 `.ojm-builtin.json` → 门禁关（篡改也放行 exit 0）；`init --yes` 后名单恢复、门禁重新生效（final build 0）。③ §6.5 回归：单测全绿（含 `resolveRoutePath` 祖先链 17 例，其中真实树一致性用例钉住「链式结果 === rewriteAdminPaths 重写后子树 id」）；e2e **21 通过 / 4 失败**，失败均为既有 wecom 用例（W1/W6 登录页企微 tab、W4/W5 `/system/wecom` 404），与 0.2.67 基线完全一致，非本批回归。 |
| 本次发现并处置 | ① 演练 fixture 教训（非缺陷）：自定义模块 entry 必须是 `defineModule({name,version,…})` + `locales/{zh-CN,en-US}.json`，缺了被 buildModules 校验拦（「default 导出缺少 name 或 version」）——拦的是你的模块不是门禁，已写进 §1.5 末注。② 快线 HTTP 探活别臆测端点：`/api/home/stats` 404（模板无此路由），改用 `/api/system/users` 判鉴权链路。③ `init --yes` 的恢复行为正确（篡改内容被还原、extra 被删），但控制台汇总只打「新增 N 项，跳过 M 项」，`恢复（--yes 覆盖）`逐文件行未输出——行为已由终态验证，输出措辞记为待打磨，不阻断。 |
| 手册同步 | 新增 **§1.5**（门禁 + `--yes` 恢复演练）；§1 检查点补 `.ojm-builtin.json` / `src/README.md`；新增 **§6.5** 仓库回归套件（runtime 修复的演练层 + wecom 4 例既有失败挂账）；§8 补两条判据（门禁 / 仓库回归）；§10 TL;DR 加 §1.5 一行；文首「上次演练结论」换为本条 |

### 补充复验（2026-11-05，oj 0.1.120；MySQL 两步取 id 修复实测）

> 只验 §11 **U2** 的修复，不重跑整条快线（其余段落沿用上一轮结论）。

| 项 | 值 |
| --- | --- |
| oj | `0.1.120`（`oj-bin` tag `v0.1.120` / 提交 `2550bd5`；本机 `bin/oj` 与 `~/.local/share/oj` 同版本） |
| 框架包 | 工作区 `feat/ojm`（cli/runtime 0.2.67，未发版） |
| 环境 | `oj-test-mysql`（`mysql:8.4`，`192.168.64.2:3306`，root/root）；`DROP/CREATE DATABASE ojtest` 冷库；`config.local.yaml` 只覆盖 `db.default` 指向该库 |
| 注意 | **U1 当时未修**（后续已由 oj `0.1.121` 修复）：oj 0.1.120 只读 `seed.sql`，故本次演练按部署口径把三份 `seed.mysql.sql` 覆盖成 `seed.sql`（`_platform` / `home` / `notification`），跑完还原（`git status` 干净）——**0.1.121 起方言件直接生效，这套覆盖步骤已废弃** |
| 起服 | `routes: 91 method-row(s), 75 pattern(s), 43 api file(s)`；`input contracts: 87 route-method(s)` |
| 串行建号 | 连发 3 次 `POST /api/system/users` → 返回 `id` = **5 / 6 / 7**；`SELECT id,username FROM users` = `5 idprobe1 / 6 idprobe2 / 7 idprobe3` → **3/3 一致** |
| 并发建号 | 30 路并发（不同用户名）→ 返回 id 是 8…37 的一个乱序排列，逐条与库内 `(username,id)` 对照 → **30/30 一致**（0 mismatch） |
| 并发广播 | 10 路并发 `POST /api/notification/push-broadcast` → `b:11…b:20` 是 11…20 的乱序排列，按 `title` 逐条对照 `notifications_broadcast.id` → **10/10 一致** |
| SQL 追踪 | 单条广播的 `_sql.events`：`INSERT INTO notifications_broadcast …` 与 `SELECT LAST_INSERT_ID() AS id` **均 `inTx: true`**（同一短事务，即 `Exec::Owned`）——旧版两条都是 `inTx: false` 且各自 acquire |
| 结论 | **修复生效**：§9 中「所有依赖 insert 返回 id 的端点返回值不可信」可下线；模板无需改动 |

### 最近一次基线（2026-11-07 第四轮，oj 0.1.125；`oj migrate --with-seed` 安装期 seed 重放特性验证）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-07（第四轮，U7 上游特性落地后的专项验证） |
| 框架包版本 | drill3 站点 = cli/runtime 0.2.73 发布态（feat/ojm @ `7a7a8657b`，机制未动，纯验证轮） |
| oj | **0.1.125**（`~/.local/share/oj/oj`；drill 模板 bin/oj 仍 0.1.124——安装器链路用它，--with-seed 调用显式用 0.1.125） |
| 验证动机 | U7 上游已交付 `oj migrate --with-seed`（v0.1.125，devkit api-manual §10）：迁移成功后对同一批模块同批重放 seed.sql。本轮验证特性行为契约 + 与 ojm 安装链路的衔接现状 |
| 环境 | drill3（ojm preview :9778，superadmin/aA123456）；books 方案 canonical 源 `/tmp/ojm-vv/books-src` @ 0.1.5（seed.sql = 单条 `INSERT OR IGNORE` 3 行，gate 合规） |
| 范围 | A. 特性直验（幂等基线 / 清库重灌 / fail-closed 门禁负例）；B. 安装全链路（卸载 → 清表 → 安装 → 验证边界 → --with-seed → API + 浏览器实证） |
| A 结果 | **通过**。① 幂等基线：`oj migrate --with-seed --format json -c config.yaml -d dist/api books-0.1.5` → `applied:[]` + `seed.results[{ok,file:"seed.sql",dialect:"sqlite",stmts:1}]`，行数仍 3。② 清库重灌：`delete from books_books`（0 行）→ 重跑同命令 → 3 行种子回库（`seed 重放 1/1 模块`），**无需冷启动**。③ 门禁负例：临时模块 `gate-0.0.1` 的 seed.sql 含 `DELETE` + 合规 INSERT → stderr 前置诊断「第 0 条语句被 --with-seed 运行期门禁拒绝：语句类型 "DELETE" 不在白名单」+ 重试指引，**exit=1**，books_books 行数与内容零变化（预扫整轮拒绝、零副作用） |
| B 结果 | **通过**。① 卸载 books@0.1.5（业务表 books_books 按设计保留）→ 手工 drop books/books_books 模拟全新环境 → POST /api/oj-market/install（source=cdn）→ 11 段全绿（verify 段 Ed25519 验签过 books.publisher01）。② **边界实证**：装完 books_books 存在但 **0 行**——安装器 `buildMigrateCmd` 未传 `--with-seed`（上游 v0.1.125 明确交付边界），「装完即数据就绪」闭环待 ojm 侧接线。③ `oj migrate --with-seed -d dist/api books-0.1.5` → 3 行落库。④ API `GET /api/books/list` → total=3；books-check.mjs 浏览器实证：books 菜单在栏、页面入框架 layout 容器、表格渲染 3 行种子 |
| 本次发现并处置 | ① **schema.yaml reconcile 会替「账本已应用但表缺失」的模块建表**（oj migrate 单模块路径 `migrate_cmd.rs:146-173`：refinery 后接 schema reconcile，只进 apply 路径）：探针 drop books_books 后跑安装器同款 `oj migrate --format json -d <svc> books-0.1.5`，`applied:[]` 却重建出表（列序按声明规范化，非迁移 DDL 原文）。行为于安装链路有益（保表存在），但意味着「drop 表重跑 migrate」不等于「重放迁移」——数据重建仍须 seed。② 期间探针遗留空表，已重跑 --with-seed 恢复 3 行（幂等重试安全，佐证特性契约）。③ U7 提案文档的「临时绕行（重启 preview）」在 0.1.125 后应改写为「安装后跑一次 `oj migrate --with-seed -d dist/api <module>-<version>`」——ojm 侧接线（buildMigrateCmd 加旗标 + platform.exec 白名单 + MIN_OJ_VERSION 联动）仍是后续工作 |
| 手册同步 | §11 U7 行追加「0.1.125 已交付 CLI 侧（2026-11-07 第四轮实机验证）；ojm 安装器接线待办」 |

### 上一次基线（2026-11-05 第三轮，oj 0.1.118 / cli+runtime 工作区 0.2.67；MySQL 与 PostgreSQL 双真库演练）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-05（第三轮） |
| 框架包版本 | 工作区态 `feat/ojm` @ `03f911698`（cli/runtime/shell 均 0.2.67；本轮修复未发版，随下一版发布） |
| oj | 0.1.118（PATH 上的 release；模板 `bin/oj` 同版本） |
| 验证动机 | 此前所有基线都跑在 sqlite 上，mysql/pg 方言件从没被真实执行过。用本机容器里的两个真库各跑一遍 §0.3 快线，回答「模板换库到底能不能起站」 |
| 环境 | `container list -a` → `oj-test-mysql`（`mysql:8.4.11`，`192.168.64.2:3306`，root/root）、`oj-test-postgres`（`PostgreSQL 16.15`，`192.168.64.3:5432`，postgres/postgres）。两条线各自 `DROP/CREATE DATABASE ojtest`，`config.local.yaml` 的 `db.default` 分别指向 `mysql://…/ojtest` 与 `postgres://…/ojtest` |
| 范围 | §0.3 快线（双线各一遍）：`ojm dev` 起服 → 迁移与 seed → 超管登录 → 建 `publisher01` → 首登改密 → 申请发布凭证 → `keygen --credential` → 同 token 重兑 → 可见性（普通用户 vs 超管）→ `sign --check` → `/api/home/pie`、`POST /api/home/line` → 通知列表 / 推送广播 / 已读 |
| 结果 | **通过（两条线）**。① 迁移账本一致：`_platform 2 / auth 3 / home 2 / notification 5 / publish 1`，两库均 **29 张表**、`sys_setting` **8 条**、`publish_credential.used=1`。② 起服行数 `routes: 91 method-row(s), 75 pattern(s), 43 api file(s)`；`GET /api/auth/login` → 405（路由在）。③ 登录 token 156 字符；MySQL 建号返回 id 不可信（见发现 6），PG 建号 id=5 正确。④ 改密前申请凭证 **403 `password change required`**，改密后成功，`key_id=quickline-demo.publisher01`、7 天有效期。⑤ `keygen` 落 `/tmp/quickline-keys/{private.pem,public.hex}`，MySQL 指纹 `15be072a…f9150`、PG `82633a42…`；同 token 重兑 **exit=1** 且不落文件。⑥ 普通用户列表 1 条、无 `owner_tenant`；超管列表带 `owner_tenant=default`。⑦ `sign dist/web-0.1.0.tgz --check` 通过。⑧ `/api/home/pie` 200、`POST /api/home/line` → `[71,84,93,99,100,97,90]`；通知列表 4 条；广播 + 已读在 PG 上 `isRead:true`。⑨ PG `sys_rate_window.window_start` 实为 `bigint`，`notifications 4 / broadcast 1 / read 1` |
| 本次发现并处置 | ① **MySQL 起站即 1064**：`home`/`notification` 只有 sqlite 基础迁移，0001 没方言件（覆盖按版本号替换，0002 有 `.mysql.sql` 不会救 0001）；pg 侧同样缺 0001/0003/0004 → 补齐 10 个方言迁移 + 4 份方言 seed，守卫 **m-5**。② **`_platform` seed 在 mysql/pg 上整段 1064 或被静默跳过**：oj 0.1.118 只读 `seed.sql`，不按方言回落 → 演练期按部署口径覆盖（用后还原），长期诉求记 §11 **U1**。③ **两份 `_platform` 方言 seed 一条 `sys_setting` 都没有** → 补齐 8 条，守卫 **m-6**（表×条数对齐 + 一行只允许一个语句终止符，防 `; ON CONFLICT` 拼接）。④ **PG 登录恒 500 `integer out of range`**：基线把毫秒 epoch 列写成 `INTEGER`（int4 上限 2.1e9 vs `Date.now()` 1.7e12）→ 8 组时间/用户 id 列改 `BIGINT`，守卫 **m-7**。⑤ **PG 通知列表 500 `UNION types integer and text cannot be matched`**：广播分支第 4 列取 `read_time`（文本）→ 改 `CASE WHEN … THEN 0 ELSE 1 END AS is_read`，`mapItem` 统一按整数判已读。⑥ **MySQL `returning(["id"])` 返回错 id**（建号 59→5、广播 `b:58`→`b:1`）：两步 `SELECT LAST_INSERT_ID()` 跑在池上不同连接，**上游缺陷未修**，记 §11 **U2**（后续已由 oj `0.1.120` 修复，见 §9）。⑦ 保留字 `key`/`group` 让 seed 无法三方言共用一份（mysql 须反引号、pg/sqlite 双引号）→ 方言 seed 整段重写 |
| 手册同步 | §9 新增 7 条（MySQL 1064 / seed 无方言回落 / 方言 seed 缺 sys_setting / PG int4 溢出 / PG UNION 异型 / MySQL 两步取 id / 保留字 seed）；新增 **§11 向上游改进需求**（U1 seed 方言回落、U2 mysql 两步取 id 钉连接、U3 `orIgnore`+`fromSelect`）；回归守卫 3 条（m-5/m-6/m-7） |

### 上一次基线（2026-11-05 第二轮，oj 0.1.118 / cli+runtime 工作区 0.2.66；普通用户凭证 → 落包 → 安装）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-05（第二轮） |
| 框架包版本 | 工作区态 `feat/ojm` @ `0cde80c37` 之后（cli/runtime/shell 均 0.2.66；未发版） |
| oj | 起站用 PATH 上的 `0.1.118`（模板 `bin/oj` 为 0.1.116；本轮未验 vendor 形态） |
| 验证动机 | 发布身份文档改为「站点凭证为主、离线 `--id` 为旁路」后，用**普通用户**（非超管）走一遍申请 → 兑换 → 发包 → 安装，核对文档口径 |
| 范围 | §0.3 快线扩展：删库重建 dev → 超管建 `publisher01` → 首登改密 → 普通用户申请凭证 → `keygen --credential` → 重兑复核 → `market publish --fixture normal-user-demo@0.1.0 --rebuild-index` → `market verify` → 安装（先 dev 后 release）→ `needs_trust` → `trust confirm` → 重装 → ping |
| 结果 | **通过**。① 建号 `publisher01`（id=5，`must_change=1`）；改密前申请凭证 **403 `password change required`**，`PUT /api/auth/password` 后 `must_change=false`。② 申请返回 64 位 token、`key_id=normal-user-demo.publisher01`、TTL **7.00 天**；普通用户列表只见自己 1 条且**无** `owner_tenant` 字段，超管列表带 `owner_tenant=default`。③ `keygen --credential` 打印「凭证已兑换：产品 normal-user-demo / 申请人 普通发布者（publisher01）」，落 `/tmp/normal-user-keys/{private.pem,public.hex}`，指纹 `56ad85af…e15464`；同 token 重兑 **exit=1**、目标目录未创建；列表 `status=used`、`used_at` 非空。④ `market publish --fixture normal-user-demo@0.1.0 --id normal-user-demo.publisher01 --rebuild-index --check`：1092 字节、sha256 `9d1fc92b…`、规范串 `oj-registry:normal-user-demo@0.1.0:9d1fc92b…`，索引第 1 代 1 片。⑤ `market verify --rebuild-index` **8 项全 ✓**（完整性 / 包级签名 / manifest×2 / catalog 签名 / 分片签名 / 同代 / 时效）。⑥ 首装 `needs_trust`，指纹与 keygen **逐字一致**；`trust confirm` → 重装 **`安装完成：normal-user-demo 0.1.0`**；`curl -H 'X-TENANT-ID: default' /api/normal-user-demo/ping` → `{"pong":true,"version":"0.1.0"}`。 |
| 本次发现并处置 | ① **新建账号必须先改密**：`must_change=1` 悬挂期除改密外写端全 403——已写进 playbook §0.3/§9 与 walkthrough §2。② **本地 `/cdn` 自供安装需要 `vars.canonical_origin`**（模板默认注释）：缺了 install 503 REG-CS6——已写进 walkthrough §6/§7 与 §9。③ **不能对着 `ojm dev` 装**：dev 的文件监听先吃掉 config 改动，安装器 reload 判 `unchanged` → partial（reloading）——安装只对 `oj serve` release 形态做，已写进 §9 与 walkthrough §6。④ **ping 要带 `X-TENANT-ID`**，否则 400 `missing tenant header`——已写进 §8 与 walkthrough §6。⑤ **产品名不是独占命名空间**：另建 `publisher02` 用同名 `normal-user-demo` 申请**同样成功**（得到 `normal-user-demo.publisher02`），文档原先「不会撞名或冒用别人的产品」是错的，已改为「只保证 key_id 唯一，产品归属靠团队约定 + 市场包名/版本冲突」；跨租户同名账号共用 key_id 的风险记入 §9。⑥ `market publish --rebuild-index` 先打「索引未重建」再打「索引已重建」，自相矛盾——已修 `publish.ts`（带 `rebuildIndex` 时不打印）。⑦ 复证仓库态坑：`dist/api/manifests.yaml` 残留 `demo: 0.1.0` 会让 `oj serve` 报 `lock points to missing version dir`，清除后 `ojm build` 重建即愈（§9 已有条目）。 |
| 手册同步 | §0.3 快线改为「普通用户」主路径（建号/改密/申请/key_id 归属/可见范围五个检查点）；§8 判据补普通用户、租户头、N 项口径；§9 新增 6 条；walkthrough §2 补「谁能申请 + 产品名不独占」、§6 补 canonical_origin / 别对 dev 装 / 租户头、§7 新增 5 行速查 |

### 2026-11-05 第一轮（oj 0.1.116 / cli+runtime 工作区 0.2.66；快线 + 发布凭证通道）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-05 |
| 框架包版本 | 工作区态 `feat/ojm` @ `b88ad1519`（cli/runtime/shell 均 0.2.66；未发版） |
| oj | 0.1.116（`packages/cli/templates/bin/oj`，dev 起服 `oj serve listening`） |
| 验证动机 | 新增「发布管理页 + 一次性凭证换发布身份」后回归快线；同时把剧本从「只有全量线」改成三条线 |
| 范围 | §0.3 快线：`info` → `api --check` → `build` → 删库重建 dev → 登录 → 申请凭证 → `keygen --credential` → 一次性复核 → `sign --check`。§0.5/§1–§7 全量线本轮未跑（模板与打包面无改动） |
| 结果 | **通过**。① `info`：cli/runtime/shell 三行均 0.2.66，importmap 单例矩阵正常。② `api --check` **0 error / 0 warn**（生成物、route 双向、routes.js 三方无 drift）。③ `build`：后端 **8 模块**（`_platform 11 / auth 7 / home 2 / notification 2 / personal-center 2 / publish 1 / system 15 / web 3` api file），`dist/api/versions.json` 存在，`dist/web/modules.json` 2 模块（`app` / `oj-market`），`app` 产物含 `publish` 页 73 处。④ dev：`routes: 90 method-row(s), 74 pattern(s), 43 api file(s)` / `input contracts: 86`。⑤ 登录 `superadmin/aA123456` token 长度 156；`GET /api/auth/login` → 405（路由在）。⑥ 凭证：申请返回 64 位 token + `key_id=quickline-demo.superadmin` + `expires_at`，SQL 事件可见 `INSERT INTO publish_credential`（13 列）；`keygen --credential` 打印「凭证已兑换：产品 quickline-demo / 申请人 superadmin」，落 `/tmp/quickline-keys/{private.pem,public.hex}`，指纹 `e479e207…74afe`；同一 token 重兑 **exit=1**、`/tmp/quickline-keys2` 未创建；列表该条 `status=used`、`used_at` 非空。⑦ `sign dist/web-0.1.0.tgz --id quickline-demo.superadmin --check` 自检通过，规范串 `oj-registry:web@0.1.0:0f5e7885…`。 |
| 本次发现并处置 | ① **快线可省掉全量线的 80% 时间**：模板工程直接跑，无需 pack/init/装依赖，适合每次改动后回归（发版仍须全量线，打包差异只有 tarball 形态能暴露）。② **全局 `ojm` 与工程 runtime 版本不等会拒跑**（C4/D12 严格相等）：本机全局 0.2.25 vs 工程 0.2.66，必须用源码 CLI `node ../bin/ojm.mjs`——已写进 §0.3 与 §9。③ **迁移压平后老 dev 库必删**：`templates/db.sqlite` 记着旧 `V1__create_users`，与文件系统 `V1__baseline` 冲突；`api/db.sqlite` 是历史残留，删它无效（已写进 §0.3 与 §9）。④ **管道吞退出码**：`… \| tail` 后 `$?` 是 `tail` 的，一度把「重兑 exit=1」看成 0；判失败要落文件再看 `$?`（已写进文首原则）。⑤ `publish` 后端模块进 build 后，后端模块数 7 → **8**，§5 的「0.2.55 实测 7 个」按历史值保留。 |
| 手册同步 | 新增 §0.3 快线；文首加「先选一条线」与退出码陷阱；§7.1 改为 `ojm new` 骨架优先（旧平铺形态降为 §7.1.2）；§7.2 补凭证通道与对应检查点；§8 判据补发布身份、v2 索引七项；§9 补四条（版本矩阵门禁 / 迁移压平删库 / `--out` 相对路径 / 凭证一次性）；历史基线整体移入附录 A |

### 上一次基线（2026-11-03，oj 0.1.116 / cli+runtime 0.2.57 打包态；重点=§7.1–§7.4 发布市场全链路）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-03 |
| 框架包版本 | `cli`/`runtime` **0.2.57**（§0.5 双包 pack；均未发 npm → 工程 `pnpm-workspace.yaml` overrides 双双指 `file:` tgz——注意模板 overrides 段已有 `@redocly/cli` 钉版，**合并进既有段**，重复键会被 pnpm 拒） |
| oj | `0.1.116`（npm 通道，init 自动装；探针无告警。0.2.57 新特性实证：init/vendor 装后 **oj devkit 10 文件覆盖同步进 `.claude/skills/oj-api-dev/`**） |
| 验证动机 | 0.2.57（角色 title 落库翻译 + vendor devkit 同步）发布前演练；重点补 2026-11-02 基线未跑的 §7.1–§7.4 市场链路 |
| 范围 | §0.5 双包 pack → §1 init（320 项）→ §2 安装（本地 tgz overrides）→ **§7.1 方案骨架 → §7.2 发布 CDN → §7.3 安装/TOFU/升级/重装 → §7.4 walkthrough**。§4/§5 宿主内开发面未跑（本轮不动该面，同 2026-10-26 先例） |
| 结果 | **通过**。① init 320 项、`.claude/skills/{oj-api-dev(10 文件),ojm-module-dev(6 文件)}` 双 skill 落地、devkit 零内部引用、devDeps 精确 0.2.57。② `ojm new erp --layout none --api` 骨架 → `ojm build` → `build --bundle erp` 两次 sha256 一致（C2-32）。③ keygen → `market publish --real .` → cdn 落 `catalog.yaml(+sig)/shards/tgz(+sig)`，`market verify` **7 项全 ✓**；同版本重发幂等（0 片重写）。④ release 起站（`platform.root: dist/api` + `--api-path dist/api` + `vars.canonical_origin`）→ `/cdn/catalog.yaml` 200 application/yaml → setup → 首装 needs_trust（指纹与 keygen 逐字一致）→ trust confirm → 重试 **11 段全 ok** → 升级 0.1.1（11/11、双版本目录共存、锁推进）→ 重启后匿名 `/api/erp/ping {pong:true}` → 同版本重装走重装路径。⑤ walkthrough `--fixture erp@0.1.0` **14/14 PASS**；`--only neg-evil` 1/1（原子性）；两份报告脱敏 grep 恒空 |
| 本次发现并处置（手册漂移 5 处 + 已知坑复证 4 条） | ① **§7.2 publish 缺 `--registry-id`**（REG-CS3 v2 规范串首段，防跨仓库重放，必填；REG-CS6：站点 env.registryId 未配置则安装侧跳过比对，本地演练任意值可用）——手册命令行已补。② **§7.2 cdn 六件套口径过期**：`bundles.yaml/manifests.yaml` 已被 **v2 索引**（`catalog.yaml(+.sig)` + `shards/` 分片，带代次）取代；`market verify` 由 5 项扩为 **7 项**（增「索引同代」「索引时效」）——手册检查点已改。③ **§7.3 install 响应字段是 `data.task_id`**（手册写 `id`）——已改。④ **§7.4 `--fixture` 必须 `@0.1.0`**：主链硬编码 0.1.0→0.2.0（upgrade 自产 0.2.0、rollback 回装 0.1.0），给 0.1.1 时 upgrade/rollback 两项 FAIL（首跑 12/2 即此因）——**非框架缺陷**，手册已补一句口径。⑤ **§7.1 手写六文件形态已被 `ojm new` 骨架替代**（module-root：`src/<name>/{solution.yaml,api,web}`）；骨架**不声明 `api.anonymous`**——匿名探活需作者自加（C2-26：相对路径、首段=方案段，如 `[erp/ping]`）；升版本要同步 4 处（solution.yaml `version`+`web.entry`+`archive.file`、`api/manifest.yaml` version、web/entry.ts `version`），漏改被 C2-27/C2-29 fail-fast 点名（全量列出，行为正确）。已知坑复证：⑥ 匿名表/新方案路由**不热更**，装后必须重启进程再探活（10-26 ①）；⑦ seed superadmin `must_change=0`，`market setup` 不改密、`--new-pass` 后旧口令仍可登录（10-23 ⑥）；⑧ **9778 被占时 serve 直接退出而 health 200 来自旧进程**——演练前先 `lsof -ti :9778` 清场，判活必须看 serve.log 而非 curl；⑨ `vars.canonical_origin` 手写部署必须自配（REG-CS6 fail-closed，模板注释占位默认注释着），缺它 install 503 |
| 手册同步 | §7.2 命令补 `--registry-id oj-registry`、六件套→v2 索引口径、verify 5→7 项；§7.3 `data.id`→`data.task_id`；§7.4 补 fixture 版本口径一句 |

### 上一次基线（2026-11-02，oj 0.1.116 / cli+runtime 0.2.55 打包态；src/app 全量收敛 + 模板契约 x-oj-file 校正）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-02 |
| 框架包版本 | `cli`/`runtime` **0.2.55**（§0.5 双包 pack；runtime 未发 npm → cli 依赖改 `file:` tgz + 工程 `pnpm-workspace.yaml` overrides） |
| oj | `0.1.116`（`ojm init` 自动安装；探针 `web v0.1.0 (1 api file(s))` 通过，构建机路径零泄漏） |
| 验证动机 | 0.2.55 发布前全链路回归：0.2.54 只并了前端（`src/app/web`），本版把六个后端模块并进 `src/app/api/<name>`、生成 client 入口改 `__client/index.ts`、修超管路由重登记；同时校正模板 `openapi.json` 的 `x-oj-file`（仍指旧布局） |
| 范围 | §0.5 双包 pack + 安装 → §1 init（311 项，预置 bin/oj 跳过 vendor）→ §2 安装（本地 tgz + overrides）→ §3 探针 → §4 `oj openapi` + `ojm api`（6 契约 / 0 error）→ §5 build（6 后端 + app/oj-market）+ web/api 双侧 tsc → §6 dev（84 routes / 80 input contracts）+ Playwright 超管菜单 → §7 preview（release/js，带 dist `--check` 0/0）→ §7.5 A–F（`ojm new` 五拒、`build --bundle` 确定性、自带排除与两段式零增量、多方案发布拒绝）。§7.1–§7.4 市场安装链路本轮未跑 |
| 结果 | **通过**。① 脚手架：`src` 顶层只有 `app` + `oj-market`；`src/app/api/{_platform,auth,notification,personal-center,system,web}` 六个后端模块、`src/app/web` 六根（home/login/personal-center/notification/system + entry）；旧 `src/<name>/{api,web}` **零残留**，`__client` 全部是 `index.ts`（`api.ts` 零个）。② 契约：`ojm api` 6 契约 / 写入 0 / 跳过未变 12；`--check` 0 error / 0 warn。③ 构建：后端 6 模块（_platform 11 / auth 7 / notification 2 / personal-center 2 / system 15 / web 3 api file）+ 前端 2 模块（app 1.7MB 单 chunk、oj-market），`modules.json` 均带 integrity；importmap 115 项、无 echarts/editor/vditor、`react-countup` 为共享资产；`dist/web/index.html` 内联 `data-ojm-entry`（静态 module 标签 0）；web/api 两侧 `tsc` 0 error。④ dev：`routes: 84 method-row(s)` / `input contracts: 80`；superadmin 登录后 **SPA 点击**「站点设置 / 企微集成」正常渲染（`/system/settings`、`/system/wecom`，无 catch-all）；`system/settings` superadmin 200 / admin **403**；无 token 401；通知 provider 200；5174 根、`/login`、app/oj-market entry.js 全 200。⑤ preview：migrate 通关，release 路由来自 `dist/api`，API 链复跑全对，带 dist `--check` 0/0。⑥ §7.5：scripts 八键（含 `new`/`bundle`/`typecheck:api`）、`info` 折叠「框架自带：2 个」（app + oj-market）、`--all` 平铺；`ojm new` 五类拒绝（重名/大写/保留名/内置名/none-name）零写入；`build --bundle` 两份 + sha256 两次一致（7fef8550…/987e5fba…）；自带 `app` 契约被跳过、`--bundle app` 明确拒绝；坏契约两段式零增量（2→2）；零方案报错指路 `ojm new`；`market publish --real .` 多方案拒绝并指路显式链路。 |
| 本次发现并处置 | ① **模板 `openapi.json` 的 `x-oj-file` 仍是旧布局（已修）**：86 个端点全部写着 `<mod>/api/...api.ts`，与新 `src/app/api/<mod>/...` 不符——随包下发的契约与工程实际文件对不上（`ojm api` 不受影响，但重跑 `oj openapi` 会整份 diff）。修法 = 在 `packages/cli/templates` 重跑 `oj openapi --module-root src` 后按仓库缩进（tab）回写，diff 收敛为 86 行 `x-oj-file`。② **init 产出的 `openapi.json` 与 `oj openapi` 重产仅差缩进**：init 裁剪后按 tab 序列化，oj 输出 2 空格；语义（paths/operations/tags）逐条相等，哈希不同不是漂移。③ **`ojm new` 无 name 的退出码是 2**（cac usage），手册原写 1——已改。④ **§7.5 自带排除演示改用顶层 `app`**：内置后端模块在 `src/app/api/<name>`，而契约扫描只看 `src/<dir>/solution.yaml`，把 `solution.yaml` 放进 `src/app/api/system` 不会被识别（报「未找到契约」而非「自带方案」）；顶层自带模块 `app`/`oj-market` 才是有效演示路径。⑤ 观察：错误文案仍写「期望 `src/<name>/solution.yaml`」——对用户模块正确，对内置嵌套模块不可达（本轮未改代码，登记备查）。 |
| 手册同步 | §1 目录判据（`src/app/{api,web}`）、§4/`§8` client 产物（`index.ts`）、§5/`§6` 的 home/login 位置、§7.5 B（自带 2 个）/C（exit 2）/E（`src/app/solution.yaml` + `--bundle app`）、§9 三处旧 `web/src/*` 引用全部按 0.2.55 实际产物改写 |

### 上一次基线（2026-11-02，oj 0.1.116 / cli+runtime 0.2.54 打包态；脚手架收敛到 src/app + 契约全覆盖回归）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-02 |
| 框架包版本 | `cli`/`runtime` **0.2.54**（§0.5 双包 pack；runtime 未发 npm → cli 依赖改 `file:` tgz + 工程 `pnpm-workspace.yaml` overrides） |
| oj | `0.1.116`（`ojm init` 自动安装；探针 `web v0.1.0 (1 api file(s))` 通过，构建机路径零泄漏） |
| 验证动机 | 0.2.54 发布前全链路回归：前端五个内置模块聚合为 `src/app/web` 多根模块、后端六个模块收进 `src/app/api/<name>`（顶层只剩 app / oj-market）、生成 client 入口改 `__client/index.ts`、`i18nNamespaces` / `clientOwners`、86 端点 `.schema`+`.response` 全覆盖、`apps/playground*` 下线、shell 路由重登记修复 |
| 范围 | §0.5 双包 pack + 安装 → §1 init（312 项）→ §2 安装（本地 tgz + overrides）→ §3 探针 → §4 `oj openapi` + `ojm api`（6 契约 / 0 error）→ §5 build（6 后端 + 2 前端模块）+ tsc → §6 dev（84 routes / 80 input contracts）→ §7 preview（release/js，带 dist `--check` 0/0）→ §7.5 C/D/E（`ojm new` 四类拒绝、`build --bundle` 确定性打包、内置排除与两段式零增量）。§7.1–§7.4 市场链路本轮未跑 |
| 结果 | **通过**。① 脚手架：`src` 顶层只剩 `app` 与 `oj-market`；`src/app/api/{_platform,auth,notification,personal-center,system,web}` 六个后端模块（模块名=URL 前缀、各自独立 oj 模块），`src/app/web` 六根齐全（home/login/personal-center/notification/system）；旧 `src/<name>/{api,web}` 与 demo-only 模块零残留。② 契约：模板 7 契约、生成物入口 `__client/index.ts`；`ojm api --check` **0 error / 0 warn**（无 dist 时第三腿跳过，preview 后带 dist 复跑仍 0/0）。③ 构建：后端 6 模块（_platform 11 / auth 7 / notification 2 / personal-center 2 / system 15 / web 3 api file）+ 前端 2 模块（app、oj-market），app 单 chunk + integrity；web / api 两侧 `tsc` 均 0 error。④ dev：`routes: 84 method-row(s), 69 pattern(s), 40 api file(s)`、`input contracts: 80`；superadmin 登录后 **SPA 点击**「站点设置 / 企微集成」正常渲染（修复前落 catch-all 404）；`system/settings` superadmin 200 / admin **403** / 无 token 401；通知 provider `/api/notification/notifications` 200；5174 根、`/login`、app/oj-market entry.js 全 200。⑤ preview：migrate 门禁过、release 路由来自 `dist/api`、根/login/entry 全 200。⑥ 菜单序轴与拆分时逐项一致（`/home` 1、`/personal-center` 110、`/oj-market` 200、`/system` -100）。 |
| 本次发现并处置 | ① **superadmin 登录后「站点设置 / 企微集成」点击 404（已修）**：Boot 期无 token 按演示角色 `admin` 建路由表（`/system` 存在、超管专属子项被过滤）；登录后 shell 只调 `patchRoutes`（只增不删），同 path 的旧树遮蔽新树 → 菜单有、点击落 catch-all。修法 = 重登记先 `_internalSetRoutes` 重建根再整棵补回（与 runtime `resolveLoginRoute` 同源）；`tests/e2e/templates/system-route-repatch.spec.ts` 增 superadmin 用例（本机缺 `sqlite3` CLI 未跑，改用 Playwright 手工复验通过）。② **oj dev 把模块目录下任何 `api.ts` 当路由扫描**：`src/app` 同时含 `api/` 与 `web/` 时，`web/<root>/__client/api.ts` 被误导入（workspace 下 runtime 软链 realpath 出根 → 直接报错）。处置 = 生成 client 入口改 `__client/index.ts`（`ojm api` 自动删除旧 `api.ts`，`--check` 报旧文件）。③ **init 产出 `openapi.json` 的顶层 `tags` 未随路径裁剪（已修）**（同前）。④ 首次 `ojm init` 报告「跳过 global.d.ts」属预期（devkit 版优先）。⑤ 上游既有：oj 0.1.116 的 `api-manual.md:267` 引用仓内 `docs/migration.md`（非本轮回归）。⑥ 观察：`oj-market` 未声明 `peerRuntime`，`modules.json` 该条无版本门禁（第一方可选模块，沿用）。 |
| 未改代码的观察 | §4 中「init 随附 openapi.json 重新生成后哈希不同」的差异**仅**是本次修复的 stale tag（paths/operations 逐条相等），非契约漂移。 |

### 上一次基线（2026-11-02，oj 0.1.116 / cli+runtime 0.2.53 打包态；内联早跳 + 路由级角色过滤回归）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-02 |
| 框架包版本 | `cli`/`runtime` **0.2.53**（§0.5 双包 pack；runtime 未发 npm → cli 依赖改 file: tgz + 工程 pnpm-workspace overrides） |
| oj | `0.1.116`（`ojm init` 自动安装；探针 `web v0.1.0 (1 api file(s))` 通过） |
| 验证动机 | 0.2.53 发布前全链路回归：首屏内联早跳（P0）、CJS require 构建门禁、`handle.roles` 路由级过滤（企微集成/站点设置仅超管）、react-countup 共享化 |
| 范围 | §0.5 双包 pack + 安装 → §1 init（315 项）→ §2 安装（本地 tgz + overrides）→ §3 探针 → §4 openapi + `ojm api`（6 契约 / 0 error）→ §5 build（6 后端 + 7 前端模块）+ tsc → §6 dev（9778/5175）→ §7 preview（release/js）。§7.1–§7.5 市场链路本轮未跑 |
| 结果 | **通过**。构建产物核对：`dist/web/index.html` 含内联 `data-ojm-entry`（静态 module 标签 0 个）；modules.json 7 模块；importmap 无 echarts/editor/vditor，react-countup 为 `/assets/react-countup.js` 共享资产；home entry 无 rolldown require 桩；tsc 0 error；dev/preview 根 200、login 200（tenant 头）、settings superadmin 200 / admin **403**、users admin 200 |
| 本次发现并处置（手册） | ① §0.5 `pnpm install --dir cli-pkg` 在 pnpm ≥11 因 esbuild postinstall 未审批失败 → 补 `allowBuilds` 步骤；② 未发版时 cli 的精确 runtime 依赖需改 `file:` tgz，且 overrides 必须写 `pnpm-workspace.yaml`（package.json 的 `pnpm.overrides` 被 pnpm ≥11 忽略）；③ §6 登录 curl 缺 `X-TENANT-ID: default`（租户默认开启，否则 400）；④ §10 探针 manifest 缺 `desc` 字段（`oj build` 直接 parse 失败）；⑤ §1/§4 目录判据仍是旧平铺布局（`api/src`、`web/src`）→ 全部改 module-root（`src/<name>/{api,web}`） |
| 未改代码的观察 | dev 在 5174 被占用时自动改用 5175（按 `ojm dev` 输出判断端口，勿硬编码） |
| 演练后变更 | 按产品要求**彻底下线 demo**：删模板 `src/demo`、`init.include.yaml` 3 条、`web.config.ts` demo 条目；init 由 315 项降为 305 项，白名单校验与 18 项 init 测试全过 |

### 上一次基线（2026-10-31，oj 0.1.115 本地 / cli+runtime 0.2.45 工作区态；发布门禁验证 + walkthrough 14/14）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-31 |
| 框架包版本 | 工作区态（`feat/ojm` @ e5e2bdcc + 7 处修复未 bump；0.2.45） |
| oj | 0.1.115（本地 `~/.local/share/oj`）；演练按 playbook 默认走 npm 通道 0.1.110 |
| 验证动机 | 验证 0.2.45 发布门禁；顺带跑 §0.5 发布态 + §1–§7 全链路 |
| 范围 | §0.5 双包 pack + 安装 → §1 脚手架 → §2 依赖 → §3 探针 → §4 契约/client → §5 前端 → §6 dev 联调 → §7 preview + market walkthrough |
| 结果 | **通过（含 7 处缺陷修复）**。walkthrough **14/14**（此前 8/14）；模板 vitest 835、cli vitest 582 全绿；根+模板 tsc、eslint、`verify-subpath` 24/0 全绿。 |
| 本次发现并处置 | ① **CLI 内置 HTTP 客户端缺 `X-TENANT-ID`**（租户化后服务端强制要租户头）：`ojm install/enable/list/market setup/trial/walkthrough` 全线 400；`site.ts` 的 `callApi`/`login` 及 4 处裸 fetch 统一注入 `tenantHeaders()`（新增 `site-tenant-header.test.ts`，RED→GREEN）。② **trial 隔离站点派生 config 缺 `vars.canonical_origin`**：`bootstrap.ts` 补注入。③ **安装器冒烟探针不报租户头**：租户化站点匿名健康端点一律 400；`smoke.ts` 探针注入 `X-TENANT-ID: default`。④ **`SmokeContext.deferredAnonymous` 死代码**：全仓从未赋值，导致 reinstall/upgrade 对匿名健康端点 401 误判失败；改为 health 探针 401 一律判 restart_pending deferred（非 401 仍判失败）。⑤ **walkthrough harness 三处隔离缺陷**：`NEG_VERSION` 由 `9.9.9` 改 `0.0.9`（低于主链路 latest 0.2.0，不再触发 REG-CS2 单调性回退守卫）；`neg-stranger` 的 `signCommand`/`buildIndex` 补 `registryId: "trial.registry"`（REG-CS3 v2 规范串首段）；neg 用例改用独立方案名 `neg-solution` 避免与主链路 `demo-solution` 共享迁移账本（OJ-9 降级守卫误拦）。 |

### 上一次基线（2026-10-26，oj 0.1.87 / cli+runtime 0.2.43 工作区态；精简后 config.yaml 必要性验证）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-26 |
| 框架包版本 | 工作区态（`feat/ojm` @ 5e9a5401：config.yaml 注释简练化 + 0.2.43 bump；shell-dist 本地重建） |
| oj | 0.1.87（init 联网下载） |
| 验证动机 | 模板 config.yaml 注释从 152 行压到 105 行（只动注释、键值零改），用本 playbook 确认没丢必要项 |
| 范围 | §1 脚手架 → §2 依赖 → build/preview 起服 → 探针 → 市场安装全受力（有意跳过 §4/§5 契约与前端编写：本轮不动那些面） |
| 结果 | **通过**。① 静态必要键核对全 ✓（/cdn 挂载、server 四键、migrate_on_start、reload_api、db、platform.modules/root/exec 三命令、fs 段、anonymous_paths 五条；jwt_secret 已 ENC 密封 + secrets 键对追加，非缺项）。② init/install/build/preview 起服，`/`、`/versions.json`、`/api/_system/health`、login、market/index（setup 指向外部 CDN 后）全 200。③ **安装全受力**：market setup → install wiki@0.1.3 → TOFU（新信任库，指纹核对 lesson.ui）→ confirm → 重试 → 装完 trusted——platform.exec 逐字白名单、fs jail、迁移门禁、热更端点（锁 diff 触发装配，不再依赖 config 哨兵）全程无 NotCapable/404。 |
| 本次发现并处置 | ① **匿名准入不热更（P6 归因修正）**：运行中的 preview 进程**首次安装** wiki 后，匿名端点 `/api/wiki/status` 也 401（此前只观测到「进程内卸载后重装」触发，曾误判为重装特有）；重启进程即 200。结论改为：**匿名表只在进程启动时加载，任何运行中写入都不热更**——9778 站首装通过是因为 dev 时代的部分安装已把注册写进 manifests.yaml。规避不变：安装后重启（生产滚动发布天然满足）。② 升 runtime 后未重建 shell-dist 会触发 `ojm build` 漂移保护（`pnpm --filter @oj-module/cli build:shell` 解决；shell-dist 已改为构建期生成不入库）。③ 新工程空 cdn/ + seed 缺省 `/cdn` 自供时 market/index 报 502「catalog 拉取失败」属预期（同 10-23 基线 ②）。 |

### 上一次基线（2026-10-23 第三次，oj **0.1.86 npm 通道**（module-root 修复转正） / cli+runtime 0.2.25 verdaccio 复用；教程 DDD 形态实演 + --check 模块根缺陷捕获修复）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-23（第三次，当日第二次之后数小时；期间合入仅 docs + 本修复） |
| 框架包版本 | `cli`/`runtime` `0.2.25`（**verdaccio 发布态复用**：双包位自第二次基线未变，npm pack 自 verdaccio 取 tgz 解包——再次验证 registry 通道；`--check` 步因验证修复改用源码 bin，其余全部走发布包） |
| oj | **`0.1.86`（npm `@oj-bin/oj` 通道，`ojm init` 自动安装）——`0f8a6e2` openapi module-root 修复已进发布版，`oj openapi --module-root src` 免本地构建旁路首演即过**。ojm `MIN_OJ_VERSION` 随后已抬至 0.1.86（见 chore/min-oj-version-0186） |
| 验证动机 | 教程改 DDD 形态（books 模块根单文件聚合 + `db.table` 构造器优先）后按新教程实演一遍，确认所教代码全链路可跑；同时做 0.2.25 全链路回归 |
| 结果 | **§1–§7 全链路通过**：init 248 项 → install 845ms（runtime/cli 0.2.25 verdaccio 解析 + 供应链 lockfile 323 项过）→ `ojm info` 三版对齐 → §3 探针 1 api file(s)（release 0.1.86 无 JsRuntime 缺陷）→ §4 **按新教程形态**写 books（单 `src/books/api/api.ts`，模块根动词键 GET/POST `/api/books`，`whereIf`+`or`+`contains` 构造器过滤，`.insert().run()`）→ `oj openapi --module-root`（**0.1.86 通道直过，无旁路**）→ `ojm api` 出 `__client`（**派生名实证为 `booksGet`/`booksPost`/`BooksGetData`**，与教程一致）→ §5 前端按教程（`createBooksClient(ctx)` 接线）→ `ojm build`（8 后端模块含 books 1 api file、modules.json 8 模块含 books、dist/api versions.json）→ **tsc 0 error** → §6 dev：seed ok books 3 条、routes 52 / input contracts 38、登录 → 全量 3 条 → `keyword=数据密集型` 单条命中 → 新增 `{ok:true}` 总数 4 → 无 token 401 → 缺 `year` **.schema 拦 400**（handler 未执行）→ trim 空**手写兜底 400** → 通知 provider `/api/notification/notifications` 200、root 级 404 属预期 → 5174 根 200 + importmap + books/login entry.js 200 → §7 preview：migrate 过、release 路由来自 `dist/api/books-0.1.0/routes.js`、API 链复跑全对、**带 dist 三腿 --check 0/0**（修复后，模块根路由第三腿同样命中）。§7.4 walkthrough 未重跑（cli 位与第二次基线逐字节一致，14/14 结论沿用）。 |
| 本次发现并处置 | ① **`ojm api --check` 模块根动词误报 `route-params-mismatch`（cli 缺陷，已修）**：模块根单文件聚合形态（契约 route `/`）的 ojFull 带尾斜杠（`books/`）与 handler 全路径（`books`）精确腿落空，掉进模糊兜底误报。修复 = 精确腿对模块根路由做尾斜杠规范化（`fix/api-check-root-route`，RED 回归测试锁定，15/15 + 关联 21/21 绿）。**该形态（教程现教形态）在 0.2.25 及之前 `--check` 必红，修复随下个版本发布**。② `/cdn/bundles.yaml` 404（新工程空市场，未发布过方案）——seed `/cdn` 缺省 + 反代拿干净 404 的预期形态，非缺陷。 |
| 与上一基线差异 | oj 0.1.85+本地旁路 → **0.1.86 发布通道**（openapi module-root 修复转正）；books 形态从目录镜像（`/api/books/{list,create}`）→ 模块根聚合（`/api/books`，GET/POST）；捕获并修复 cli `--check` 缺陷 1 个 |

### 上一次基线（2026-10-23 第二次，oj 0.1.85+0f8a6e2 本地修 / cli+runtime 0.2.25 **verdaccio 发布态**；免 setup 特性首演 + walkthrough 14/14）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-23（第二次） |
| 框架包版本 | `cli`/`runtime` `0.2.25`（**verdaccio 发布态**：双包 `scripts/publish-verdaccio.mjs --publish` 上本地 verdaccio，演练工程从 verdaccio 取 `@oj-module/cli-0.2.25.tgz` 解包 + `pnpm install` 解析 runtime/cli 0.2.25——比 §0.5 pack 态多验了 prepack 产物与 registry 通道；npmjs 复核 0.2.25 缺席（latest 仍 0.2.23），模拟零污染） |
| oj | `0.1.85` + 本地构建 `0f8a6e2`（openapi module-root 修；npm latest 0.1.85 无此修，契约链仍需换 bin/oj 旁路，**0.1.86 发布后抬 MIN_OJ_VERSION 回归**） |
| 验证动机 | 0.2.25（market CDN 相对路径 `/cdn` 本站点自供 + 脚手架免 setup）发布前演练；`publish-verdaccio.mjs` 固化后首跑 |
| 结果 | **§1–§7 全链路通过**：init 248 项（module-root 齐、`.gitignore`/`openapi.json` 在根）→ install 1.5s（**runtime+cli 0.2.25 均走 verdaccio scope 映射**，零旁路）→ info 三版全 0.2.25 对齐 → §3 探针 1 api file(s) + 零 runner 路径泄漏 → §4 books 六文件 → `oj openapi --module-root src`（0f8a6e2 修复实证，含 `/api/books/{list,create}`）→ `ojm api` 出 `src/books/web/__client`（派生名 + `BooksListGetData` 存活）→ `--check` 0/0 → §5 `ojm build` 7 后端模块 books 2 api file(s)、`dist/web` 产物齐（modules.json 8 模块含 books）、tsc 0 error → §6 dev：5174 登录 superadmin/aA123456 → user-info ok → `/api/books/list` 种子 2 条（迁移+种子经反代真跑）→ **§7 market 免 setup 首演**：起站后**未跑任何 setup**，市场 index 直接报「`/cdn/bundles.yaml` 返回 HTTP 404」（seed 缺省 `/cdn` 生效 + dev 反代拿到干净 404，非 index.html 的 YAML 解析错）→ fixture 发布 + build-index 后 index 出卡片 → install → needs_trust（TOFU，指纹 949dbd75… 一致）→ trust confirm → 重装推进至 smoke 段（仅因「新方案路由要 oj serve 重启才注册」停 partial——既有已知口径，非缺陷）→ walkthrough **14/14 PASS**（隔离站点内跑全链）→ §7 preview 单服务 index/deep/api 全 200。 |
| 本次发现并处置 | ① **免 setup 闭环实证**（0.2.25 特性）：seed `/cdn` 缺省 + 消费侧 `withSiteOrigin` 按请求源补全 + `ojm dev` `/cdn` 反代三件套在真站点全通；`market setup` 降级为外部真 CDN 可选步骤。② **npm scope 映射压过显式 `--registry`**：`npm view @oj-module/cli --registry https://registry.npmjs.org` 仍查 verdaccio（映射优先级高于 --registry）——核官方源须 curl registry URL 直查（本轮差点误判「真发布泄露」）。③ **client 调用需显式空参**：`booksListGet({})`（query 无 required 时形参仍必填），`booksListGet()` 是 TS2554——写演练页时注意。④ 手册 §5/§6 判据两处小漂移（本轮实踩）：产物根是 `dist/web`（非 `web/dist`）；后端模块 7 个（notifications 为 web 模块，不进 oj build 列表）。均已在本轮核对中按实改口径记录，未改手册正文（判据随模板组合浮动，以输出实查为准）。 |
| 与上一基线差异 | 0.2.24 → 0.2.25 增量 = market CDN 相对路径（本站点自供）+ 脚手架免 setup + `publish-verdaccio.mjs`；演练形态从 §0.5 pack 态升级为 verdaccio 发布态（多验 prepack + registry 通道） |

### 上一次基线（2026-10-23，oj 0.1.85+0f8a6e2 本地修 / cli+runtime 0.2.24 打包态；module-root 后 §1–§7.4 首轮回排 + §7.5 复跑）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-23 |
| 框架包版本 | `cli`/`runtime` `0.2.24`（**打包态**：§0.5 双包 pack → cli-pkg 解包直跑；双包经 verdaccio 模拟通道安装——`~/.npmrc` `@oj-module:registry` 映射首次在演练中担任安装源，零 package.json 改动） |
| oj | `0.1.85` + 本地构建 `fix/openapi-module-root-project-root`（`0f8a6e2`，见发现 ①；npm latest 0.1.85 无此修，**module-root 工程契约链在 oj 0.1.86 发布前持续中招**） |
| 验证动机 | 0.2.24（cac 全面化 + 双语 + 发布钉死）发布前全链路演练；module-root 改写（0.2.20）后 §1–§7.4 从未整轮回排（上轮发现 ③ 挂账），本轮补齐 |
| 结果 | **§0.5–§7.5 全链路通过**：§0.5 pack → `ojm --help` 分组双语正常 → §1 init 248 项（module-root：`src/<name>/{api,web}`、根级 `.gitignore`/`openapi.json`/`.ojm-builtin.json` 10 模块/devkit 零内部引用）→ §2 install 935ms（**包走 verdaccio 解析 0.2.24**，npmjs latest 仅 0.2.23）→ §3 探针零泄漏（注：grep 经管道时 `$?` 是管道的，须看输出行数）→ §4 books 六文件（`.schema`+平级 `.response`）→ `oj openapi --module-root src`（**新口径**，见发现 ①）出 `/api/books/{list,create}` → `ojm api` 生成 `src/books/web/__client`（operationId 派生名、`BooksListGetData` 存活）→ `--check` 0/0 → §5 前端模块扫描即收录（web.config.ts 登记退化为可选覆盖）→ `ojm build` 8 后端模块 books 2 api file(s)、modules.json 8 模块含 books（带 integrity）、**tsc 0 error** → §6 dev：seed ok books 3 条、`routes: 52 / input contracts: 38`、登录/关键字单条过滤/新增 {ok:true}/全量 4 条/无 token 401/缺字段 400、5174 根 200 + importmap + books/login entry.js 200 + `/login` html 200 → §7 preview：migrate 门禁过、release API 链复跑全对、**带 dist 三腿 --check 0/0** → §7.1–§7.4 **market 链路全通**（本轮重点，见下）→ §7.5 A–F 复跑全过（scripts 七键 / info 折叠 7 个 / `new` 双骨架 + 五拒文案全中零写入 exit=1 / 无参打包 2 份 + sha256 重复一致 + tar 零私钥 / 自带跳过+按名拒绝 / 坏契约两段式零增量 exit=1 / 零方案指路 `ojm new` / `market publish --real .` 多方案拒绝指路显式链路 exit=1）。**§7.1–§7.4 market 链路**：§7.1 erp 方案 `ojm new` 骨架起步 → 手写 `erp/ping` 契约 → `ojm build --bundle` 出包 → §7.2 keygen + `market publish --real .`（单方案流；同版本字节冲突防线实证：篡 1B 重发被拒「同版本号只允许一份字节」，删 tgz 重发解围）+ `market verify --rebuild-index` 5/5 ✓ → §7.3 release 起站（`--api-path dist/api` + `platform.root: dist/api`）→ setup 写市场地址 200 → 首装 needs_trust（指纹 d1909578… 逐字一致）→ trust confirm → 重试 11/11 段 done → 匿名 `/api/erp/ping` `{pong:true}`（`api.anonymous: [erp/ping]`，C2-26 首段=方案段）→ 同版本重装路径 ✓ → 卸载→净装路径 ✓ → 篡改包安装侧同样判 tampered ✓ → §7.4 walkthrough **14/14 PASS**（主链 9 + 负向 5 全中）。 |
| 本次发现并处置 | ① **`oj openapi --module-root` 裸包解析截断（oj 上游 bug，已修）**：openapi_cmd dev 分支 loader `project_root` 锚了 `dir`（src），裸包 node_modules 行走被截断在 src（工程根 node_modules 在其外）→ 模板预生成 `web/__client/index.ts`（import `@oj-module/runtime/contract/errors`）内省 fail-fast，「openapi → ojm api」契约链在 module-root 工程整体不可用；`oj serve --module-root` 无恙（app.rs 锚 config_dir）。**修复**（oj-bin `0f8a6e2`，分支 `fix/openapi-module-root-project-root`，287 lib 测试全过 + 新回归用例）：discover_routes 增 `project_root` 参数锚 config_dir + 修 regen 提示 module-root 下误给 `-d`（与 `--module-root` 互斥）。**待 oj 0.1.86 发布后 ojm 抬 MIN_OJ_VERSION 并回归**。② **§6 通知铃判据过期（手册问题，非缺陷）**：module-root 模板（0.2.20 起）的 root 级 `/api/notifications` 模块未随迁，改由 `notification` web 模块注册 `notificationsApi` provider（端点 `/api/notification/notifications`，实测 code:0 数组）——§6/§8 的「`/api/notifications` 兜底数组」判据已不适用，判据改 provider 口径。③ **手册 §4 命令过期**：`-d api/src` 系平铺树口径，module-root 工程须 `oj openapi -c config.yaml --module-root src -b /api -o openapi.json`（config.yaml 在工程根）；§10 TL;DR 同步。④ zsh 不对变量做分词，`OJM="node …"` + `$OJM …` 会报 no such file；管道后 `$?` 是被管道末命令的退出码——演练脚本里两个都踩了，判据核对要绕开。⑤ **market 链路实踩修复 4 处（均 TDD + 合入 feat/ojm）**：(a) `ojm new --api` 骨架 ping handler 是裸具名导出——oj 路由内省只读 default export + METHODS 白名单，裸导出零路由且**构建期零报错**（故障延迟到安装 smoke 才现形），骨架改嵌套组 `export default { ping }` + 回归测试；(b) `ojm new` solution.yaml 缺 `peerRuntime`/`archive`——market verify 结构检查 5 必填（严于契约 C2-29 允许缺 archive），骨架补齐；(c) trial/walkthrough 隔离站点起站路径写死 `api/dist`（平布局），module-root 产物在 `dist/api`，起站即挂——改 `resolveLayout(root).apiDist` 同源取值；(d) trial/walkthrough 两处 setup 后登录恒用 newPass，而 seed must_change=0 不改密 → 401——按 `setupMarketUrl` 返回的 `changedPassword` 二选一（`loginPasswordAfterSetup`）。⑥ **手册 §7.3 口径过期已改**：module-root 宿主 `--api-path dist/api` + `platform.root: dist/api`、安装锁 `dist/api/manifests.yaml`；补两条 module-root 专属坑（bin/oj 与 bin/plugins rustc 一致、新方案路由要重启才注册）。 |
| 与上一基线差异 | 上一基线（0.2.23，§7.5 首跑）后 0.2.24 增量 = CLI 全面 cac 化 + 双语帮助 + 发布目标 `--registry` 钉死（publishConfig.registry 移除）；module-root 后 §1–§7.4 首轮全排，捕获 oj 上游 openapi 缺陷 1 个（已修未发）+ 手册判据过期 2 处（已改） |

### 上一次基线（2026-10-22，oj 0.1.85 / cli+runtime 0.2.23 打包态；新增 §7.5 新命令特性演练并首跑）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-22 |
| 框架包版本 | `cli`/`runtime` `0.2.23`（**打包态**：§0.5 双包 pack → cli-pkg 解包直跑；runtime 经 `file:` tgz 装进 devDependencies） |
| oj | `0.1.85`（本机预置旁路：npm `@oj-bin/oj` latest 停在 0.1.84，低于 `MIN_OJ_VERSION` 0.1.85 门禁，按 §0 旁路 1 预置 `bin/`） |
| 验证动机 | 0.2.23 多方案特性首发（`ojm new` / `build --bundle` 复数化 / `.ojm-builtin.json` 排除 / `info` 折叠）：手册新增 **§7.5 新命令特性演练环节**并首跑验收 |
| 结果 | **§7.5 A–F 全过**：A scripts 七键（含 `new`/`bundle`/`typecheck:api`）+ `.ojm-builtin.json` 10 模块名单（含 web-only 的 demo/home/login/oj-market）；B `info` 默认折叠「框架自带：7 个」、`--all` 平铺 7 个 web 模块；C `ojm new crm --layout container` + `erp --layout none --api` 双骨架（erp 含 api manifest/handler + 契约 api 段）、五类拒绝（重名/大写/保留名 auth/内置名 home/无 name exit=1）各命中文案且零写入、生成即被扫描收录（info 用户区可见）；D `ojm build --bundle` 无参出 crm+erp 两份 + 「共打包 2 份」、自带零出包、`--bundle crm` 与 `--bundle=crm` 单份、重复打包 sha256 逐字节一致（c63454e…/865beb61…）、tgz 内固定 `manifest.yaml` 命名且零私钥形态文件；E 塞 `src/system/solution.yaml` 后无参跳过有逐条日志 + `--bundle system` 明确拒绝、坏契约（name≠目录名）fail-fast 指名 bad 且 dist 份数零增量（两段式）、移走全部用户契约报错指路 `ojm new` 且恢复后重跑复原；F `market publish --real .` 对多方案工程拒绝并指路显式链路 |
| 本次发现并处置 | ① **npm 通道双重滞后**：`@oj-bin/oj` latest 0.1.84 < 门禁 0.1.85（§0 旁路 1 预置本机 0.1.85）；`@oj-module/*` latest 0.2.20 < 0.2.23（strip 两 devDeps + runtime `file:` tgz；cli-pkg 自身依赖同样 sed 为 `file:../oj-module-runtime-0.2.23.tgz`，同 2026-10-20 基线发现 ③）。② **`ojm new auth` 命中保留名而非内置名**（守卫顺序：保留名先于内置名单触发）——§7.5 已改用 `home` 演示内置名拒绝路径。③ **init 产物已是 module-root 布局**（`src/<name>/{api,web}`，0.2.20 起）：本手册 §1/§4/§5 检查点仍描述旧 `api/src`+`web/src`+`web.config.ts allModules` 登记流程——**登记为待重写项**，本轮未动（§7.5 全部步骤已按 module-root 口径编写）。④ `pnpm install --offline` 650ms（store 预热）。 |
| 与上一基线差异 | 上一基线（0.2.13）后 0.2.14–0.2.23 主要增量 = module-root 布局（0.2.20）+ 契约优先级 solution.yaml（0.2.21）+ 多方案工作流（0.2.23）+ dev 底栏（0.2.22）；本轮演练范围 = 新命令特性（§7.5），旧 §1–§7.4 链路未复跑（module-root 改写后需整轮重排，见发现 ③） |

### 上一次基线（2026-10-21 第二次，oj 0.1.84 / cli+runtime 0.2.13 工作区态；walkthrough 负向防线 + pitfall 10 修复）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-21（当日第二次） |
| 框架包版本 | `cli`/`runtime` `0.2.13`（工作区态，源码 bin 直跑） |
| oj | `0.1.84`（本机根与 templates 各一份，`ojm vendor v0.1.84` 重装） |
| 验证动机 | T12 收尾：walkthrough 补齐 upgrade/rollback 与 neg-tamper/nosig/badindex/stranger/evil 共 6 op（当日首轮已交付），本轮消灭遗留风险项——pitfall 10（`_oj_migrations` 未进 schema 致深检 `ledger.stale` 误报 + 预锁 guard 空转）、neg-stranger 信任库残留（revoke + 快照 diff）、失败文案表、报告白黑名单 |
| 结果 | **`ojm market walkthrough` 14 项全 PASS / 0 FAIL**（主链路 9 + 负向 5）：upgrade（installed 推进/双版本目录共存/0001 逐字节一致）、rollback（failed@migrating + dist 快照零变化）、neg-tamper（failed@verifying 零落盘）、neg-nosig（sig_missing）、neg-badindex（POST 即 502）、neg-stranger（needs_trust→confirm→done + `{revoked:true}` + 信任库快照 diff 空）、neg-evil（zip-slip 手造包上传即 400）。`--only` 单跑 neg-evil / neg-stranger / upgrade / rollback 均 PASS（原子性）。报告脱敏落盘 `logs/walkthrough-<ts>.md`（14 行 AC 表 + 6 条失败文案表）。单测 297 passed（+5：fixture 迁移阶梯 3 / evil tgz 1 / 文案表 traceability / 报告脱敏） |
| 本次发现并处置 | ① **pitfall 10 根因实证**：`_oj_migrations` 表与数据都在，`db.table` 被元数据校验拒 → `_platform/schema.yaml` + `manifest.yaml` 声明该表（复合 PK `[module, version]`，列与 oj 真表逐列对齐）→ 深检 ledger 项零误报（verify op 的 checks 从「恒有 1 条误报」变「零问题空数组」，op 断言同步改为结构 + ok 字段）；构造器纪律：不修 raw SQL 绕行。② **verify op 曾寄生在误报上**：旧断言「checks 非空」靠 ledger.stale 误报撑住，pitfall 一修即露馅——教训：断言不要依赖被测对象的缺陷。③ **「零落盘」断言的两次踩坑**（rollback / neg-evil）：目标目录可能是前序 op 的**合法产物**，正确口径是「本次操作前后 dist 清单快照零变化」。④ **MIN_OJ_VERSION 0.1.73 → 0.1.81**：模板 `solution-perms` 用 `startswith`（oj v0.1.81），旧 vendored oj 0.1.80 卸载方案必 fail-closed；`vendor.test` 硬编码字面量改引用常量。⑤ neg-evil 的手造 ustar 用 `node:zlib` gzipSync——与 `deterministic-tar.ts` 同范式（手写 ustar + node 压缩），模板（oj 运行时）侧无 node 环境才走 exec tar，cli 侧不混 |
| 与上一基线差异 | 上一基线（当日首轮）交付市场六命令 + walkthrough 骨架与主链路 8 op；本轮把 walkthrough 扩到 14 op（含全部 neg 防线）、修复 pitfall 10 存量误报、抬 MIN_OJ_VERSION，手册 §7.4 重写为「主链路 + 负向预期失败」双轨检查点 |

### 上一次基线（2026-10-21，oj 0.1.84 / cli+runtime 0.2.12 工作区态；市场链路首演）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-21 |
| 框架包版本 | `cli`/`runtime` `0.2.12`（工作区态，源码 bin 直跑） |
| oj | `0.1.84`（`ojm vendor` 装进演练宿主） |
| 验证动机 | 新增「开发方案模块 → 发布到本地 CDN → 市场安装 → TOFU → 装成」三段（§7.1–§7.3），并修掉演练暴露的宿主侧缺口 |
| 结果 | **两轮全绿**：① `ojm init` 新工程自带 `cdn/` + `/cdn` 挂载 + `platform.modules` + `fs:` 段（零手工补丁）→ `ojm build`（api/dist + web/dist + `api/dist/versions.json`）→ 方案工程 `oj build` + `ojm build --bundle`（同输入两次同 sha256）→ `keygen`/`sign --check` → `market publish --real --rebuild-index` → `market verify`（5 项全 ✓）→ `market setup`（首登改密闭环）→ `market/index` 出卡片 → 安装 `needs_trust`（指纹与发布方一致）→ `trust confirm` → 重试 `status=done`（11 段全 ok）→ `/api/demo-solution/ping` 返回 `{pong:true}` → 安装锁含 `demo-solution: 0.1.0`。② 换全新 `host2` 零手工补丁复跑同样 done（唯一人工步骤 = `platform.root` 由 `src` 改 `dist`，见 §7.3 前置） |
| 本次发现并处置 | ① **`ojm build` 不写 `api/dist/versions.json`** → 新工程装方案在 preflight 报 `C2-09`；**已修** `build.ts` + `src/__tests__/build-backend.test.ts`。② **模板 `platform:` 缺 `modules`/`root`** → 卡 `reloading`（`NotCapable: module '_platform' is not platform-privileged`）；**已修**模板并在 `preview-config` 派生时把 `root` 改写为 `api/dist`。③ **模板缺 `fs:` 段** → 安装器落盘被 jail 拒，且失败在任务文件写入前（POST 200 但 task 恒 404）；**已修**模板。④ **`oj build` 只收 `.ts` handler**：`.js` 不进 dist、`routes.js` 生成空表。⑤ **`manifest.tables` 必须与 `schema.yaml` 对齐**（`S005`）；缺 `schema.yaml` 直接失败。⑥ **引用 i18n key 必须有 locales 双语且嵌套**：平铺 dotted key 查不到。⑦ **dev 形态装不上**：`--api-path src` 时装到 dist 的模块不被发现（smoke 404）。⑧ **`ojm preview` 不能完成安装**：派生 config 与安装器热更目标（`api/config.yaml`）不同文件 → `reloadConfig` 恒 `unchanged`。 |
| 与上一基线差异 | 上一基线只覆盖「宿主工程内开发模块」（§4–§5）；本轮新增可分发方案的开发/发布/安装三段（§7.1–§7.3），并把 7 项宿主侧缺口（①–③ 已修代码，④–⑧ 入坑表）纳入手册 |

### 上一次基线（2026-10-20 第二次复跑，oj 0.1.82 / cli+runtime 0.2.10 打包态；devkit 文档树合并 + 0.2.10 发布前演练）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-20（当日第二次，补上首轮未跑的打包态 e2e 全链路） |
| 框架包版本 | `cli`/`runtime` `0.2.10`（**打包态**：§0.5 双包 pack → 解包直跑 `cli-pkg/bin/ojm.mjs`；双包均未发版，安装须 file: tgz + pnpm overrides，见发现 ③） |
| oj | `0.1.82`（npm `@oj-bin/oj` latest，init 自动下载、探针无告警，无需旁路 1） |
| 验证动机 | ① devkit 文档树合并（`docs/devkit/` 唯一入口 + `oj-api-dev/` 快照迁入为 devkit 子目录、`docs/` 下旧顶层 `oj-api-dev/` 目录删除）后验证 init 分发不受影响；② 0.2.10 发布前按 §0.5 打包形态跑 §1–§7 全链路 |
| 结果 | **全链路通过（§0.5–§7）**：§0.5 双包 pack（cli 5.6MB / runtime 331KB）+ cli-pkg 解装（`ojm --version` 0.2.10，devkit 恰 5 文件、子目录跳过）→ `ojm init` 全检查点（目录树齐全、`.gitignore` 在包内且 `templates/.gitignore` 不在、openapi 新约定全中、devDeps 全家 + `typescript@~6.0.3`、`__client` 预生成、无 `contract.ts`/`routes.json`/`openapi.yaml`）→ 依赖安装（file: tgz + overrides + `--offline` 2s）→ oj 探针通过（无构建机路径泄漏、JsRuntime 冒烟 OK）→ books 模块（后端 manifest/schema/migration/seed + list/create 两 handler，全构造器 + `.schema`/平级 `.response`；前端 entry/pages/双 locale）→ `oj openapi` + `ojm api` + `--check` 0 error / 0 warn（`BooksListGetData` 解析为 `z.array(z.object({id,title,author}))`，非 `unknown`）→ `ojm build`（后端 8 模块 + 前端 8 模块含 books@0.1.0，见发现 ④）→ `tsc` **0 error** → `ojm dev`：`seed ok module="books"`、`routes: 52 method-row(s), 25 api file(s)`、`input contracts: 37`、登录 code:0、过滤命中、新增 `data.id`、缺字段 400（`.schema` 拒收）、无 token 401、通知兜底数组、5174 根 200 + importmap runtime + books/login entry.js 200 → `ojm preview`（**单服务 9778**，release/js）：migrate 门禁过、API 链复跑全对、**带 dist 三腿 `--check` 0/0** |
| 本次发现并处置 | ① **devkit 上游引用 1 条**：npm 0.1.82 二进制的 `api-manual.md:226` 引用 `docs/migration.md`（上游 oj 仓内部路径）——0.1.80 同样存在（grep -c 1），上游长期缺口非本轮回归；ojm 侧 5 文件零命中。② **npm 0.1.82 devkit 只有 9 文件**（缺 `oj-test-guide.md`；本机 `~/.local/share/oj` 本地构建 10 文件领先 npm 发布）——init 对缺失文件优雅跳过，行为正确；文档版本对照：0.1.80=8 文件、0.1.82 npm=9、0.1.82 本地=10。③ **打包态双包依赖死结**：pack 时 cli tarball 内 manifest 被改写为 `@oj-module/runtime@0.2.10` 精确版而 npm latest 停 0.2.8——解包后须 sed cli-pkg 依赖为 `file:<runtime tgz>`；工程安装时因 cli 也来自 tarball，还须在工程 `package.json` 加 `pnpm.overrides` 把整棵树的 `@oj-module/runtime` 统一改写到本地 tgz（单点 add 不够）。④ **`web.config.ts` 是显式模块清单**：books 前端目录建好后必须在 `allModules` 加一行 `{ name: "books", entry: ... }` 才进 modules.json（首轮构建 books 缺席即此因，登记后正常）——已补进 §5 步骤。⑤ 首次带 dist `--check`（preview 刚启动即跑）报一次性 `MODULE_NOT_FOUND`，未复现（随后连跑两次 0 error / 0 warn）；疑与 preview 进程瞬时状态相关，记录备查 |
| 与上一基线差异 | 上一基线（同日首轮）因模板契约面无改动未跑打包态 e2e；本轮补全 §0.5–§7 且发现 ③④ 两条打包态/清单类新知；devkit 分发行为与合并前逐字节一致（init 分发 5 文件） |

### 上一次基线（2026-10-20 首次复跑，oj 0.1.82；范围=0.1.81/0.1.82 构造器迁移收尾 + L1 通道建立）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-20 |
| 框架包版本 | `cli`/`runtime` `0.2.9`（工作区态；本轮改动随 **0.2.10** 发出，见 CHANGELOG） |
| oj | `0.1.82`（`listTables(prefix?)` / `truncate()` / `count(distinct)` 随本轮迁移用上） |
| 验证动机 | 把 0.1.81 迁移收尾到 0.1.82（`uninstall` IN→`startswith`、`rate` 改 `truncate`、`solution-perms` 最后一处裸 SQL、`query`/`oplog` 工厂化分页），并建立模板 **L1（`oj test`）回归通道**——构造器是 oj 二进制内纯 Rust 实现，vitest 夹具原理上够不着真 `table()`，真执行面必须走 L1（边界论证见 §9.1） |
| 结果 | ① 模板 api `tsc --noEmit` **0 error**；② 模板 L1（`oj test -c config.yaml -d src -t tests`，5 用例：login-methods 匿名 / todos 无 keyword·keyword=契约·keyword=% / notification join+UNION+lit）**5/5 passed，连跑三次幂等**；③ `tests/cli/init.test.ts` **14/14**（两份 0.1.82 新指南随 init 分发，旧 devkit 缺文件时容忍）；④ 模板 L2 vitest 基线 **190 failed \| 409 passed (599)，19/33 文件**——单一根因族（夹具无 builder 面，86 直接 TypeError + 104 级联），本轮按 §9.1 政策记录不硬修；⑤ 6 处 stale `MARKET_HISTORY_DDL` 全清（market_history 真源=平台迁移 0012）；⑥ vendored devkit 与上游 0.1.82 全量对齐（`docs/devkit/oj-api-dev/` 10 文件） |
| 本次发现并处置 | ① **`oplog.ts` whereIf `""` 归一化真 bug**：可选过滤缺失值被归一成 `""`，而 whereIf 的跳过集是 `undefined/null/false/[]`——`""` 是合法值会照发 `action = ''` 把结果过滤空（与旧 `if (filter.x)` 语义相悖）；修为归一化 `undefined`（api-manual §whereIf 契约）。② **L1 登录 401 排查**（本地 dev 库口令被首登改密流程改成 `aA12345678` → seed 重放 `INSERT OR IGNORE` 不复位 → admin/aA123456 恒 401）：处置不是改 seed，而是按框架正道加 **fixtures 专用账号**（`src/_platform/fixtures/l1-test-user.sql`，`l1tester`/`l1test1234`，additive `INSERT OR IGNORE` + superadmin 绑定，仅 `oj test` 灌入）——seed 的 admin 是 `must_change=1` 生产语义（判权端点恒 403）且口令必然随用户首登漂移，L1 不能绑它。③ L1 三处契约坑（client path 相对 base 多写 `/api` 即 404；L1 `expect` 无 `toHaveLength`；`oj test` 每轮重放 迁移→seed→fixtures，断言须按唯一键收敛到自己行）——全部记入 §9.1。④ `docs/devkit/sql-builder-missing-capabilities-pr.md` 闭环：7 项诉求全闭（6 项随 0.1.81/0.1.82 落地 + 1 项 sqlite 组合限制 sanctioned 绕行），并订正原文档一处误判（`like` 的 escape 逃生舱本就存在，上游复核同判「1 条误报」） |
| 与 0.2.9 基线差异 | 0.2.9 记录的是 0.1.81 改造的端到端回归（打包态 §1–§7）；本轮模板 api.ts 契约面无改动，未重跑全套打包态 e2e，改以「tsc + L1 + L2 基线 + init 单测」四件套验证迁移收尾；L2 的 190 红是 L1/L2 边界结构性欠账（非本轮新增回归），政策见 §9.1 |

### 上一次基线（2026-10-19 复跑，oj 0.1.80 / cli+runtime 0.2.8 打包态）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-19 |
| 框架包版本 | `cli`/`runtime` `0.2.8`（**打包态**：`pnpm --dir packages/cli pack` 后解包直跑 `cli-pkg/bin/ojm.mjs`，与发版逐字节一致；双包均未发版，`pnpm install` 须 `pnpm add <runtime 本地 tgz>` 入 devDependencies，见本基线发现 ②） |
| oj | `0.1.80`（`@oj-bin/oj` latest ≥ 门禁 0.1.73，init 自动下载、探针无告警） |
| 验证动机 | 上阶段 `db.query`→`db.table()` SQL builder 迁移后，端到端复跑捕捉回归；并验证 §0.5 发布形态（pack 而非源码树） |
| 结果 | **全链路通过（§1–§7）**：`ojm init`（**236 项新增**）→ `pnpm install`（`@oj-module/runtime` 经 `pnpm add <本地 tgz>` 入 devDependencies，`--offline` 秒级）→ JsRuntime 探针通过 → books 模块（后端 6 文件 + 前端 4 文件，`.schema` 入参 + 平级 `.response`）→ `oj openapi` + `ojm api`（`--check` 0 error / 0 warn）→ `ojm build`（后端 8 模块 books 2 api file(s)、前端 8 模块含 books@0.1.0，modules.json 含 home/login/books 且 books entry 带 integrity）→ `tsc` **0 error** → `ojm dev`：seed ok（_platform/books/notification）、`routes: 52 method-row(s)`、`input contracts: 37`（`.schema` 入参校验激活）、登录返回 token、关键字过滤命中、新增 `{ok:true}`、全量 5 条、无 token 401、通知兜底返 4 条数组；5174 根 200、importmap 含 `@oj-module/runtime`、books/login/home entry.js 200、`/login`（Accept: text/html）200 → `ojm preview`（单服务 release 形态，端口 9778）：migrate 门禁过、路由来自 `api/dist`、9778 根 200、API 链复跑全对、**带 dist 三腿 `--check` 0/0** |
| 本次发现并处置 | ① **登录 500 `unknown table 'sys_rate_window'`**：上阶段 `rate.ts` 由 `db.query` 迁 `db.table()`，但 `sys_rate_window`/`sys_login_throttle` 仅 V9 迁移创建、从未在 `schema.yaml`/`manifest.yaml` 登记，oj 表元数据校验拒绝；**修复**：模板 `_platform/{schema,manifest}.yaml` 双向登记两表（提交 `aa9a3f63`），重打包后 fresh init + build + preview 登录通过。② **§0 旁路 2 的 symlink 会让 typecheck 炸 41 个 TS7006**：裸 runtime tarball 无 `node_modules`，`export { z } from "zod"` 解析成 `any`，生成物 `__client/index.ts` 的 `.map(i => …)` 全变隐式 any；须改用 §0.5 `pnpm add <runtime 本地 tgz>` 把 runtime 装进 devDependencies（zod 随之可解析）。③ oj 0.1.80 起 `oj serve` 对 `/api/health` 打 deprecated WARN（建议 `/api/_system/health`）——oj 上游信息项，本仓无需动作。④ `ojm preview` 端口已为 **9778**（单服务：API + 静态 SPA 同进程），旧基线记的 4173 已过时。⑤ **2026-10-20 复跑：v0.1.81 构造器扩展改造的回归**——把模板 `todos/uninstall/contacts/session/notify` 的手写 SQL 改写为 v0.1.81 构造器（`contains`/`whereIf`/`count` 聚合/`union`/`join`/`lit`/`as`/`select("*")`/`orIgnore`）后，端到端复跑发现 `notify.markAllRead` 的 `fromSelect`+`orIgnore` 在 sqlite 上 500（`orIgnore with fromSelect is not supported on sqlite`）——**已回退为裸 `INSERT OR IGNORE ... SELECT`**（三方言通用，提交 `e1b81e74`）；其余 `contains`+`or`/`union`+`join`/`orIgnore(VALUES)`/`select("*")`/`whereIf`/`count`/`orderBy` 全部运行时验证通过（含临时探针验证 `whereIf` 双分支、idempotency 复跑）。注意 `ojm init` 当时从 npm 拉到 oj 0.1.80（0.1.81 尚未上 latest），按 §0 旁路 1 换入本地 0.1.81 验证；回退后的 `markAllRead` 在 0.1.80 上同样安全。另：`pnpm add` runtime 须 `-D`，否则 C4/D12 硬共享依赖门禁失败（见 §0.5） |
| 与 0.2.5 基线差异 | 0.2.5 基线当时 `tsc` 0 error 系未触发本回归（`db.table` 迁移尚未引入）；本次 0.2.8 捕捉并修复 `sys_*` 表声明缺失；init 新增项 216 → 236；preview 由 4173 双服务变为 9778 单服务 |

### 上一次基线（2026-10-19 复跑，oj 0.1.80 / cli+runtime 0.2.5 工作区态）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-19 |
| 框架包版本 | `cli`/`runtime` `0.2.5`（**工作区态，均未发版**——npm latest 仍停在 0.2.2；双包 lockstep 不变） |
| oj | `0.1.80`（npm `@oj-bin/oj` latest，**首次无需 §0 旁路 1**：latest 已 ≥ 门禁 0.1.73，`ojm init` 自动下载且安装后探针无告警） |
| 验证动机 | `ojm init` 模板拷贝由**排除清单反转为白名单**（`templates/init.include.yaml`，见 CHANGELOG Unreleased）后的首次全链路演练 |
| 结果 | **全链路通过（§1–§7）**：`ojm init`（**216 项新增**，白名单下 demo-only 模块与模板自运行产物零泄漏）→ `pnpm install`（§0 旁路 2「双包均未发版」形态 + `--offline`，1.6s）→ JsRuntime 探针通过 → books 模块（后端 6 文件 + 前端 4 文件，handler `.schema` 入参 + 平级 `.response`）→ `oj openapi`（books 2 端点）+ `ojm api`（契约 8 份、写入 2 文件）+ `--check` 0 error / 0 warn → `ojm build`（后端 8 模块，books 2 api file(s)、notifications 1、system 10；前端 7 模块，modules.json 含 home/demo/login/personal-center/notification/system/books，books entry 带 integrity）→ `tsc` 0 error → `ojm dev`：seed ok（_platform/books/notification）、52 路由方法、24 个入参校验激活、登录返回 token、关键字过滤命中 1 条、新增 `{ok:true}`、全量 4 条、无 token 401、通知兜底返 4 条数组；5174 根 200、importmap 含 `@oj-module/runtime`、books/login/home entry.js 200、`/login`（Accept: text/html）200 → `ojm preview`（release 形态）：migrate 门禁过、路由来自 `api/dist`、4173 根 200、API 链复跑全对、**带 dist 三腿 `--check` 0/0** |
| 白名单专项核对 | 脚手架实际落盘 204 个模板文件，与 `init.include.yaml` 遍历模拟集合**逐文件一致（无缺无多）**；`web/src/{demo,home}` 页面源码在册而 `__client` 不拷（其 api 模块是 demo-only）；`api/node_modules` 与 `init.include.yaml` 自身零泄漏——旧排除逻辑的这两处漏洞随之修复 |
| 本次发现并处置 | ① `pnpm install` 直连 registry 被限速（实测 ~18KB/s）卡死在解析段 20min——**环境问题非框架缺陷**，处置与旁路补进 §0/§9；② books `entry.ts` 的 `onInit` 漏 `async` 被 tsc 拦（TS2322：void 不匹配 Promise<void>）——devkit SKILL「注册时机」红线补明 async 签名（模板 `web/src/notification/entry.ts` 早有此形，文档没写明）；③ oj 0.1.80 起 `oj serve` 对 `/api/health` 打 deprecated WARN（建议 `/api/_system/health`）——oj 上游信息项，本仓无需动作，记录备查 |
| 与 0.2.1 基线差异 | init 新增项 76 → 216（模板扩容：system 模块、notification/notifications 拆分、`api/tests` 全量、lifecycle 全套）；排除清单 → 白名单（拷贝结果逐文件等价，另修两处泄漏）；oj 下载通道不再滞后于门禁 |

### 历史基线（2026-10-16 复跑，oj 0.1.74 / cli+runtime 0.2.1 提交态 `34ac3d09`）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-16 |
| 框架包版本 | `cli`/`runtime` `0.2.1`（**双包 lockstep**：runtime 自 0.2.0 升 0.2.1 与 cli 对齐，提交 `34ac3d09`；宿主 shell-dist 已重建，versions.json 记录 runtime 0.2.1） |
| oj | `0.1.74`（本机预置 `bin/`，同 §0 旁路 1） |
| 结果 | **全链路通过（§1–§6）**：`ojm init`（76 项新增）→ `pnpm install`（§0 旁路 2：本地 tgz 覆盖 cli+runtime）→ JsRuntime 探针通过 → `oj openapi` + `ojm api` + `--check` 0 error / 0 warn → `ojm build`（后端模块含 system 13 端点、modules.json 含 home/demo/login/personal-center/notification/system）→ `tsc` 0 error → `ojm dev`：seed ok、21 路由方法入参校验、登录/系统管理联调全对。`ojm preview`（§7）本次未跑（dev 已验证，避免端口冲突），列为可选。 |
| 本次新增验证点（用户要求：验证模板内置模块） | **系统管理模板模块 + 核心模块存在性联调**：以 `admin/aA123456` 登录（首登 `must_change=1` → 改密 `PUT /api/auth/password` 清悬挂）→ 带 token 直打 `system/settings`(200, items.module ∈ {framework,ldap,market,sso})、`system/users`(1)、`system/roles`(4)、`system/oplog`(4 条)、`system/permissions`(200)、`system/login-methods`(200)、`notifications`(4 条) 全部 200，无 token 返回 401；`web/hello`、`web/user-info`(admin/superadmin)、`web/get-async-routes` 全部 200；`modules.json` 注册 6 模块（home/demo/login/personal-center/notification/system）且各自 `entry.js` 可达（notification 版本 0.0.2，路径非空）。 |
| 与 0.1.20 基线差异 | 除双包升 0.2.1 与 shell-dist 重建外，无任何功能回退；本次模板已内置完整 `system` 模块（13 系统端点 + 6 页面），无需手动补 books 演示模块即可验证「模块存在」诉求。 |
| 复跑关键坑（新增已知项，见 §9） | 登录限速：`sys_rate_window`（per-IP 30/min）+ `sys_login_throttle`（per-(IP,user) 连败阻断）在反复失败登录后会以 `401 invalid credentials` 掩盖，并非口令错误。复跑前 `DELETE FROM sys_login_throttle; DELETE FROM sys_rate_window;` 清表，或冷起新 db（`rm -f api/db.sqlite*` 后 `ojm dev` 重建 seed）即可一次性成功登录。 |

### 历史基线（2026-10-15 二次演练，oj 0.1.74 / cli+runtime 0.1.20 提交态 `41fadd39`）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-15（当日第二次全链路演练；首次见下） |
| 框架包版本 | `cli`/`runtime` `0.1.20`（**已提交态** `41fadd39`，含 lint 15 处修复、cli 包 vitest config 锚定 + `pnpm test:cli` 接 CI、根 tsc 23→0；源码 CLI 验证） |
| oj | `0.1.74`（本机安装预置进 `bin/`；npm 通道 `@oj-bin/oj` 仍滞后于 `MIN_OJ_VERSION` 0.1.73 门禁，按 §0 旁路 1 绕过） |
| 结果 | **全链路通过（§1–§7），无新问题**。`ojm init`（76 项新增）→ `pnpm install`（§0 旁路 2）→ JsRuntime 探针通过 → books 模块（新约定）→ `oj openapi` + `ojm api` + `--check` 0 error / 0 warn → `ojm build`（7 后端模块、books 2 api file(s)、modules.json 含 home/login/books）→ `tsc` 0 error → `ojm dev`：seed ok、8 路由方法入参校验、登录/过滤(1 条)/新增 `{ok:true}`/401/通知兜底全对 → `ojm preview`：migrate 门禁过、release 路由来自 `api/dist`、API 与静态兜底正常、带 dist 的三腿 `--check` 0 error / 0 warn。 |
| 二次演练新增验证点 | **devkit 分发自包含性**（同日文档更新后）：业务工程 `.claude/skills/ojm-module-dev/` 拿到含 **§3.10 旧 `contract.ts` 工程迁移指南**的手册，grep 确认零仓库内部引用（`docs/migration`、`../oj-api-dev` 等已清）；oj 侧 devkit 落在 `.claude/skills/oj-api-dev/`，与手册内新引用一致。 |
| 与首次演练差异 | 无功能差异；首次演练发现并修复的 4 项（npm 滞后旁路、空 `_shared` 目录、routes.js 尾斜杠误报+豁免不对称、未发版安装旁路）在提交态全部保持修复，本次复跑逐项回归通过。 |

### 基线：2026-10-15 首次演练（oj 0.1.74 / cli+runtime 0.1.20 工作区态）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-15 |
| 框架包版本 | `cli`/`runtime` `0.1.20`（源码 CLI 验证；宿主 versions.json 钉版） |
| oj | `0.1.74`（本机安装预置进 `bin/`；npm 通道 `@oj-bin/oj` 当时 latest 仍是 0.1.71，低于 `MIN_OJ_VERSION` 门禁 0.1.73，`ojm vendor`/`ojm init` 的下载步会被门禁拦下——见 §9 新增行） |
| 结果 | **全链路通过（§1–§7）**：`ojm init`（76 项新增，预置 bin/oj 跳过 vendor 下载）→ `pnpm install` → JsRuntime 探针通过 → books 模块（新约定 `.schema` 入参 + 平级 `.response` 出参）→ `oj openapi` 重生成 → `ojm api` 生成 `web/src/books/__client`（导出 `booksListGet`/`booksCreatePost`，`BooksListGetData` 出参类型完整）→ `ojm api --check` 0 error / 0 warn → `ojm build`（7 后端模块含 books 2 api file(s)、6 前端模块、modules.json 含 home/login/books）→ `tsc --noEmit` 0 error → `ojm dev`：migrate/seed 正常、8 个路由方法入参校验激活、登录返回 token、列表/关键字过滤/新增/无 token 401/通知兜底全对 → `ojm preview`（release 形态）：migrate 门禁过、路由来自 `api/dist/**/routes.js`、API 与静态兜底正常、带 dist 的 `--check` 三腿全过。 |
| 新约定检查点 | 契约不再有 `contract.ts`/`routes.json`/`openapi.yaml`：handler 挂 `.schema`（params/query/body）+ 平级 `.response`（oj v0.1.72+），`oj openapi` 产出工程根 `openapi.json` 为唯一事实源；client 函数名 = `camelCase(operationId)`（如 `booksListGet`），非旧人类命名。 |
| 演练中发现并修复 | ① npm 通道 oj 滞后于门禁（预置本机二进制绕过，init 对已有 bin/oj 跳过 vendor）；② 模板残留空目录 `api/src/_shared` 被 init 拷进工程、`oj build` 报 "module '_shared' missing manifest.yaml"——删空目录 + `copyTemplates` 加空目录跳过防护；③ `--check` 第三腿误报：契约侧 fullPath 尾斜杠（`notifications/`）vs dist pattern（`notifications`）键不等，且豁免只过滤「dist 多」不过滤「dist 缺」——双侧规范化 + 豁免对称过滤（含 2 条回归测试）；④ 未发布版本的 `pnpm install` 需 file: 链接 + 手工 symlink（catalog: 协议只对 workspace 成员解析）。 |

### 历史基线（2026-10-11 演练，oj 0.1.60 / cli+runtime 0.1.12）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-11 |
| 框架包版本 | `cli`/`runtime` `0.1.12`（源码 CLI 验证；宿主 versions.json 钉版） |
| oj | `0.1.60`（`@oj-bin/oj` 通道；本环境无 npm registry 网络，把本机 0.1.60 安装预置进 `bin/` 以绕过 `ojm vendor` 下载，效果等价） |
| 结果 | **后端全链路通过**：`ojm init` → 生成 `mounts:` 配置 → `oj serve` 正常启动（migrations/seed 应用、6 模块/12 路由注册、证书有效、`/api/health` 200）→ 登录 `admin/aA123456` 返回 token、无 token 401、带 token 读 `/notifications`/`/web/hello` 200。`pnpm install` 因沙箱无 npm 网络未完成，§4–§7 前端链路待联网复跑。 |
| 新增验证点 | oj v0.1.58 起 `server.api_prefix` 等 5 键已删除、改顶层 `mounts:`（旧键 fail-fast，见 §9）；`readOjApiPrefix` 改读 `mounts:`，`ojm info` 显示 `base: /api` 正确。 |

### 历史基线（2026-09-11，记录用，后续对照）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | `cli`/`runtime` `0.1.6`（本次验证跑在 `refactor/vendor-npm-install` 分支源码 CLI 上：**vendor 下载源从 GitHub releases 切换为 npm 包 `@oj-bin/oj`**，见 `202609111926-vendor-npm-install-design.md`） |
| oj | `0.1.13`（**npm `@oj-bin/oj` 通道**首验：`ojm init` 临时目录 `npm i` → 落盘 `bin/oj` + `bin/plugins/` + `bin/devkit/`，无构建机路径泄漏，探针通过） |
| 结果 | 全链路通过（§1–§7）。发现并修正 3 处手册判据过期（§1/§2/§8 的四包时代 devDeps 表述 → 两包时代只有 `cli`+`runtime`；§6 curl 直打 `/login` 404 系 SPA 回落需 `Accept: text/html`，非缺陷，已补判据说明）。`@types/react`/`typescript` 回退 `*` 告警依旧，安装后需钉版（本次钉 `19.3.0` / `7.0.2`） |

<details>
<summary>上一次基线（0.1.6 四包收尾 / oj 0.1.12 GitHub release 通道）</summary>

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | `cli` `0.1.5`（本次模板修复：home/login 前端模块 + notifications 端点 + 豁免清单；home 用统计卡片 + 折线/柱/饼图演示共享依赖矩阵）+ `runtime`/`shell` `0.1.4` + `contract` `0.1.3`（四包均已按本手册复跑） |
| oj | `0.1.12`（**官方 release**）——v0.1.11 及更早的 release 二进制有构建机路径缺陷，v0.1.12 已修复（见 §3） |
| 结果 | 全链路通过（§1–§7）：release 二进制在非构建机可用，`ojm dev` / `ojm preview` 均正常。发现并修复 4 个脚手架缺陷（模板缺 `api/.ojm-api-exempt.json` → `ojm api --check` 误报；模板缺 `web/src/login` → `/login` 无路由可跳；模板缺 root 级 `api/src/notifications` → 通知铃 404；模板缺 `web/src/home` → 登录回跳 `/home` 落错误边界，见 §4/§5）与 2 处手册判据过期（§3 泄漏计数、§4 未注明豁免文件） |

</details>

<details>
<summary>更早基线（0.1.3 / oj 0.1.11 自建）</summary>

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | 首次全链路：四包均 `0.1.3`；其后发布 `runtime`/`cli`/`shell` `0.1.4`（`contract` 保持 `0.1.3`） |
| oj | `0.1.11`（**自建**，见 §3 高危检查点） |
| 结果 | 0.1.3 全链路通过；发现并修复 2 个脚手架缺陷（缺 `contract` 依赖、缺 `env.d.ts`），并给 cli 增加 oj 二进制自检探针（0.1.4 起随 `ojm vendor`/`ojm init` 自动执行） |

</details>
