# 教案：从 `ojm init` 到市场安装验证——以 wiki 方案包为例

- 日期：2026-10-26
- 配套计划：`docs/plans/20261026-1715-ojm-init-wiki-market-lesson.md`（问题记录 P1–P5 的详版）
- 工具链：本仓 `@oj-module/cli` 0.2.42 + oj 0.1.87；方案工程：`../oj-wiki`（wiki 0.1.3）
- 全流程实测通过，本文所有命令与输出均来自该次实录（时长约 20 min）

## 教学目标

完成一条完整链路并理解每个闸门的存在理由：

```
ojm init（搭宿主） → ojm build --bundle（打方案包） → ojm market publish/build-index（发进宿主市场 CDN）
→ ojm install（市场源安装） → ojm trust confirm（TOFU 信任） → 冒烟验证
```

学完后应能回答：为什么必须签名？为什么首次安装会被信任闸拦住？为什么 `ojm dev` 下安装永远冒烟失败？

## 前置条件

| 项 | 要求 |
|---|---|
| 本仓 | `feat/ojm` 系工具链可用；本地 CLI 入口 `node packages/cli/bin/ojm.mjs`（spawn tsx 直跑 src TS） |
| 方案工程 | `../oj-wiki`，分支 main，工作区干净；自带 `bin/oj`（0.1.86+） |
| 依赖供给 | verdaccio 在 4873 运行且已发布 `@oj-module/cli@0.2.42`、`@oj-module/runtime@0.2.42`（`scripts/publish-verdaccio.mjs --publish`）；`~/.npmrc` 有 `@oj-module:registry=http://localhost:4873/` |
| 端口纪律 | 避开 9781/9782（lifecycle e2e 硬占）；本教案用 5174（dev）/ 9778（preview） |

> 依赖供给为什么是 verdaccio 而不是 `file:`？脚手架的 package.json 由 init 生成、钉 `@oj-module/*` 精确版本；pnpm v12 下 overrides 只能写 `pnpm-workspace.yaml`，且 file: 安装会把 `catalog:`/`workspace:*` 协议带出仓外解析直接报错。**模拟发布是唯一干净供给面**（计划文档 P2）。

## Phase 0 —— 变量约定

```bash
OJM="node /Users/ever/git/only-js/oj-module/packages/cli/bin/ojm.mjs"   # 本仓活代码 CLI
SCAFFOLD=/Users/ever/git/only-js/ojm-lesson-scaffold                    # 脚手架工程（宿主）
WIKI=/Users/ever/git/only-js/oj-wiki                                    # 方案工程（发布方）
```

> 用活代码而非脚手架 node_modules 里的 cli：本教案执行期修复了 `market verify` 的一个 bug（Phase 3 问题 1），verdaccio 里的 0.2.42 产物不含该修复。

## Phase 1 —— `ojm init` 搭脚手架（UC1）

```bash
$OJM init $SCAFFOLD --yes
```

预期要点：联网下载并安装 oj（本次 v0.1.87，≥ MIN_OJ_VERSION 0.1.86 过能力闸门）；「新增 248 项」；产物 = `src/<name>/{api,web}` 单树 + `config.yaml` + `config/` 证书三件套 + `seed.*.sql` + `package.json` + `bin/oj`。
（离线环境可预置 `bin/oj` + `bin/.oj-version` 再跑 init，幂等跳过下载。）

```bash
cd $SCAFFOLD && pnpm install        # @oj-module/* 经 ~/.npmrc scope 映射走 verdaccio
$OJM info                            # 能力探针 --module-root 可用、oj 0.1.87 ✅
```

**验收 AC1**：`ojm info` 显示「版本要求 >= v0.1.86 ✓ / 能力探针 --module-root 可用」。

## Phase 2 —— 方案工程打包（UC2）

```bash
cd $WIKI && pnpm bundle             # = ojm build --bundle
```

预期：`方案包已生成 → dist/wiki-0.1.3.tgz`（835056 字节，sha256 `4a6beb33…4002d`）。
要点：契约真源是 `src/wiki/solution.yaml`（bundle 级，≠ api 模块的 manifest.yaml）；tgz 是**确定性打包**——同输入两次哈希一致，这是发布留痕与校验的基础。

**验收 AC2**：tgz 存在，名字 = `<name>-<version>.tgz`。

## Phase 3 —— 发布进脚手架的市场 CDN（UC3）

在 `$SCAFFOLD` 下执行（cdn/ 就在工程根）：

```bash
# ① 发布方密钥（一次性；私钥落 ~/.ojm/keys/lesson.pub/，0600，永不入仓）
$OJM keygen --id lesson.pub --yes
#    记录打印的 指纹（sha256(publicKey)）——TOFU 核对要用

# ② 打包 + 包级签名落 cdn/（--real 会进方案工程重跑 ojm build --bundle）
$OJM market publish --real ../oj-wiki --id lesson.pub --registry-id lesson.local
#    产出 cdn/wiki-0.1.3.tgz + cdn/wiki-0.1.3.tgz.sig（detached Ed25519）

# ③ 重建三级索引（catalog + shards，多人发布互不覆盖靠全量重建）
$OJM market build-index --id lesson.pub

# ④ 离线验包
$OJM market verify --rebuild-index
```

**验收 AC3**：verify 全绿（7 项）：完整性 / 包级签名 / manifest 结构 / 索引签名×2 / 索引同代 / 索引时效。

### 问题 1（工具链 bug，已修）：真实工程包验包必红「缺必填字段 archive」

- 现象：`--real` 发布的包 `✗ manifest 结构：缺必填字段 archive`，而 `--fixture` 合成包全绿。
- 根因（反常规：构建侧与校验侧契约自相矛盾）：`market verify`（REG-CS8 提交 c12626c7 引入）把 `archive` 当 manifest 必填；但契约 C2-29（`manifest-contract.ts`）明确 archive **可整体省略**（Form A 占位仅 file；sha256/size/signature 由索引侧填 Form B），且 `bundle.ts` 对真实方案逐字拷贝 solution.yaml、**从不注入** archive。
- 修复（TDD）：`market/__tests__/verify.test.ts` 加「摘 archive 重打包」回归用例（先红后绿）；`market/verify.ts` 必填集去掉 archive 并注释 C2-29 依据。市场套件 98 项全绿。**该修复需随下个 cli 版本发布。**

### 问题 2（用法约束）：`--registry-id` 必填

`market publish --real` 缺省报错退出。它是 REG-CS3 v2 规范串首段（`<registry_id>:<slug>@<version>:<sha256>`），防「A 签的包被 B 的 CDN 装」。站点未配 canonical_origin 时安装验签跳过该比对，本地可占位（lesson.local）；生产指向外部 registry 时必须等于该站 canonical_origin。

## Phase 4 —— 起站 + 市场源安装 + TOFU（UC4）

**必须用 release 形态验证**（`ojm build` + `ojm preview`），不能用 `ojm dev`——理由见问题 3。

```bash
# ① 给站点一个权威 origin（REG-CS6 fail-closed，绝不读请求头 Host）
#    config.yaml → vars.canonical_origin: "http://localhost:9778"

cd $SCAFFOLD && $OJM build           # 产 dist/api/versions.json 等 release 产物
$OJM preview                          # 单服务：http://localhost:9778（/api + SPA 同进程）
```

```bash
# ② 首次安装：被信任闸拦住（TOFU）
$OJM install wiki@0.1.3 --site-url http://localhost:9778 --user superadmin --pass 123456
#    → 待信任确认（发布方：lesson.pub）
#    → 指纹 6ab94df2 2c2449fa … 39742550   ← 与 Phase 3 keygen 打印值逐字核对！
#    → 确认命令：ojm trust confirm --task install-<ts>-<id>

# ③ 站点侧确认入库（superadmin；写市场安全设置要求 superadmin 角色，admin 会 403）
$OJM trust confirm --task install-<ts>-<id> --site-url http://localhost:9778 --user superadmin --pass 123456

# ④ 重跑安装
$OJM install wiki@0.1.3 --site-url http://localhost:9778 --user superadmin --pass 123456
#    → 安装完成：wiki 0.1.3
```

### 问题 3（环境约束，两个连环坑）：为什么 ojm dev 下安装必败

| 坑 | 报错 | 原因 |
|---|---|---|
| canonical_origin 缺失 | 安装 503，REG-CS6 | 相对市场基址 /cdn 要补全为同源绝对 URL，fail-closed 不猜 Host |
| 未 build 就装 | 预检 C2-09 拒装 | peerRuntime 比对读**磁盘** `dist/api/versions.json`，dev 形态没有 |
| dev 下重试 | 冒烟 /api/wiki/status 404 | oj dev 只供给 src（--module-root），安装器写入 dist/ 的 api 不在服务面 |

**结论：市场安装链路的验证形态 = `ojm build` + `ojm preview`（release 布局），与 lifecycle e2e 同口径。**

### 验收 AC4

```bash
$OJM list --site-url http://localhost:9778 --user superadmin --pass 123456
#    NAME  INSTALLED  ENABLED  LATEST  UPGRADABLE  TRUST
#    wiki  0.1.3      yes      0.1.3   no          trusted

curl -s http://localhost:9778/api/wiki/status
#    {"code":0,"msg":"ok","data":{"module":"wiki","ok":true,"oj_version":"0.1.87"}}

curl -o /dev/null -w "%{http_code}" http://localhost:9778/wiki/space     # 200（SPA 深链回落）
curl -o /dev/null -w "%{http_code}" http://localhost:9778/modules/wiki/0.1.3/entry.js   # 200
```

## 全链路 AC 汇总

| AC | 内容 | 结果 |
|---|---|---|
| AC1 | `ojm init` + install + `ojm info` 能力探针通过 | ✅ |
| AC2 | `ojm build --bundle` 产出确定性 wiki-0.1.3.tgz | ✅ |
| AC3 | publish + build-index 后 `market verify --rebuild-index` 7 项全绿 | ✅（含问题 1 修复） |
| AC4 | install + TOFU confirm 后 list=trusted、冒烟 ok、前端路由 200 | ✅ |

## 排错速查（按报错关键词）

| 报错关键词 | 归属 | 处置 |
|---|---|---|
| `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` / `catalog: isn't supported` | 依赖供给 | 用 verdaccio，别用 file: overrides（见前置条件） |
| `缺少签发方身份：--registry-id` | Phase 3 | 加 `--registry-id <id>`（本地占位，生产 = 站点 canonical_origin） |
| `缺必填字段 archive` | Phase 3 | cli ≤0.2.42 的 verify bug；用活代码或等下一版 |
| `安装需要站点 canonical origin`（503） | Phase 4 | config.yaml 配 `vars.canonical_origin` 并重启 |
| `C2-09 无法读取宿主 runtime 版本` | Phase 4 | 先 `ojm build`（产 dist/api/versions.json） |
| `冒烟 ... /api/wiki/status 返回 HTTP 404` | Phase 4 | 换 `ojm preview`，别用 `ojm dev` |
| `待信任确认（发布方 ...）` | Phase 4 | 非错误：核对指纹 → `ojm trust confirm --task <id>` → 重跑 install |

## 附录：远程站点怎么发布（ojm init 的产物部署到服务器之后）

发布方操作全部不变（本机打包、本机签名），**只有 `--site-url` 指向远程**。变的只是「市场面在哪里」与远程站点的一次性部署前提。

### 远程站点一次性前提（部署流水线）

1. 服务端跑过 `ojm build`（`dist/api/versions.json` 等 release 产物随部署走，C2-09 预检要读）；
2. `config.yaml` 配 `vars.canonical_origin: "https://<真实对外域名>"`——**必须是公网 origin**，REG-CS6 不读 Host 头、fail-closed，配内网地址会导致市场基址补全与深检探针全挂；
3. release 形态运行（oj serve 单服务，等价 `ojm preview`）；
4. 服务端 oj ≥ 0.1.86。

### 三条发布通道（按市场面位置选）

| 通道 | 适用 | 发布方动作 | 远程动作 |
|---|---|---|---|
| **A. 文件直传**（无需任何市场设施） | 首发、内网、应急 | `ojm build --bundle` → `ojm sign dist/wiki-<v>.tgz --id <pub> --registry-id <id>` → `ojm install dist/wiki-<v>.tgz --site-url https://remote --user superadmin --pass ***`（CLI 自动探测同目录 .sig 随包上传） | 无 |
| **B. 站点自供 /cdn** | 单站点常规升级 | 在 **CDN 工作副本**（本地 git 副本即可）跑 `ojm market publish --real ../oj-wiki --id <pub>` + `ojm market build-index --id <pub>`，把 `cdn/` 目录随部署 **rsync/CI 同步到远端**（保持 config.yaml 的 /cdn 挂载） | 免 setup；`ojm install wiki@<v> --site-url https://remote` 即从 https://remote/cdn 拉取 |
| **C. 外部真 CDN** | 多站点共享一个市场 | 同 B，但 cdn/ 目录由 nginx/OSS 静态托管 | `ojm market setup --site-url https://remote --user ... --pass ...` 把 `framework.market_cdn_url` 改写为 CDN 绝对地址（superadmin 角色；首跑自动处理 must_change 改密期） |
| **D. 外部 registry 源** | 多租户目录分发 | `ojm publish <dir> --registry <url>` 上传目录 + 重建索引 | `ojm install @<scope>/<name>@<v> --registry <url> --site-url https://remote` |

通道 A 已于 2026-10-26 实测：uninstall → `ojm sign` → `ojm install <tgz>`（file 上传 + .sig 随包）→ `TRUST=trusted`、冒烟 ok。

### 远程发布的四个注意

1. **签名 `--registry-id`**：站点侧该比对当前**未从 config 接线**（模板里 `env.registryId` 只有类型与透传，无配置来源），CDN/文件源实际跳过 REG-CS3 比对；但**往外部 registry 发布时服务端有 `registry_id_mismatch` 硬闸**——签名必须等于该 registry 的 canonical_origin。稳妥做法：一律让 registry-id = 目标市场面的 canonical_origin。
2. **TOFU 信任确认也是远程的**：首次安装报 `待信任确认` 后，`ojm trust confirm --task <id> --site-url https://remote ...` 在发布方本机对远程执行即可，无需登服务器。
3. **凭据别上命令行**：生产用环境变量 `OJM_SITE_URL` / `OJM_USER` / `OJM_PASS`（install/list/enable/disable/uninstall/trust 全部已支持 `--site-url`，天然远程）。
4. **回滚远程可用**：`ojm disable wiki --site-url https://remote`（四处同步停用，秒级恢复原状）或 `ojm uninstall wiki --site-url https://remote`（业务表保留需运维手工清理）。

## 清理

```bash
# 停 preview：杀后台 ojm preview 进程即可（派生 config .ojm-preview.yaml 自动清理）
# 卸载 wiki（教案复跑前）：
$OJM uninstall wiki --site-url http://localhost:9778 --user superadmin --pass 123456
# verdaccio 可常驻（storage 在 ~/.local/share/verdaccio/）
```

## 板书：一图记住信任模型

```
发布方                          宿主站点（市场）
────────                        ──────────────
keygen ──私钥签名(.sig)──► cdn/ ──build-index 签索引──► catalog+shards
                                     │ install: 验 sha256 → 验 Ed25519 规范串
                                     │   ├─ 签名不符 → 拒（sig_missing / sig_tampered…）
                                     │   └─ 签名过但 key 未入库 → needs_trust（TOFU）
trust confirm（核对指纹后入库）──► 重跑 install → 装 + 冒烟 → enabled/trusted
```
