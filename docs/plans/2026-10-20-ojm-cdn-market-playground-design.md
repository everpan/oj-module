# oj-market CDN 与全套市场操作模拟（脚手架内建）

> 日期 2026-10-20 ｜ 状态：设计（round1 + round2 评审后修订，2026-10-21 00:15；round3 spike 核验与代码再校对，2026-10-21 01:20）｜ 只描述，不含执行步骤
> 评审纪要：五位专家全量，采纳/驳回逐条可追溯——见本文 §9（round1：产品/安全/CXO）、§10（round2：架构师/工程师）。
> round3：**实机 spike（oj 0.1.84）结论见 §11**——推翻 1 项（A7 挂载声明序）、证实 2 项风险（§5.2 字节保真、§5.3 同进程自取）、新增 1 项阻断（§3.1.1 dev 形态 `/cdn` 不通），并据此落决策 **D-2（模板直发挂载，取消 setup 注入）**，同时修正若干引用失准（详见各节「round3 修订」标注）。

## 1. 背景与缺口

- templates 自身就是一个可运行工程，市场页消费 `framework.market_cdn_url`：该值为空时
  `GET /api/_platform/market/index` 按设计返 503（`market/api.ts:589`），前端卡片区显示
  「未配置市场地址」。模板种子里这个值就是空的 → **templates 与新工程都看不到市场卡片，更走不了安装**。
- CDN 目前只以「内建 Node 静态服务」的形式存在于 `scripts/lifecycle-e2e.mjs:120`（:9782），
  且只服务 e2e：仓内没有可提交、可被 oj 直出的 CDN 目录；`ojm init` 下发的新工程完全没有市场源。
- 结果：脚手架用户在本地无法模拟「发包 → 上架 → 索引 → 安装 → 升级/回滚 → 禁用/启用 → 深检 → 卸载」，
  也无从在不污染自身工程的前提下确认一个安装包与安装流程是否正确。〔主诉求〕

## 2. 目标 / 非目标

目标：
1. 新工程（`ojm init` 产出）默认自带一个可提交、可被 oj 直出的本地 CDN 目录。
2. 一条子命令把 bundle 产物（`.tgz` + 包级 `.sig`）落进该目录；另一条子命令扫描目录重建索引（D-1）。
3. 一条子命令模拟全套市场操作，每步原子、可单跑、自带清场，且**默认在隔离站点**跑（不打开发者真站点）。
4. 负面场景证明链路真的在验（篡改 / 缺签 / 坏索引 / 陌生发布方）。
5. **开发者环境**：离线验包（秒级、不装站点）+ 隔离试装（一次性站点/DB/密钥/凭据/信任库，跑完即销毁），
   便于确认安装包与安装流程的正确性。〔主诉求，评审 CXO F2/安全 F6〕

非目标：
- 不做真 CDN 的部署与运维（对象存储、nginx）——目录可搬，本设计只管本地。
- 不改 `_platform/market` 任何既有契约与端点，全部走既有 HTTP 面。
- 不动 `scripts/lifecycle-e2e.mjs`（端口纪律：9778 主线禁用，e2e 用 9781/9782）。

## 3. 设计

### 3.1 CDN 落点：工程根 `cdn/` + 站点同进程挂载

```
cdn/
├── README.md                       # 唯一进 init 白名单的文件（空仓保持）
├── bundles.yaml                    # 索引（ojm market publish 产出，不进仓）
├── manifests.yaml
├── bundles.yaml.sig / manifests.yaml.sig
└── <name>-<version>.tgz（+ .sig）
```

> **架构决策（D-2，2026-10-21，round3 spike 后）**：模板**直接发布** `/cdn` 挂载 + `cdn/README.md`，
> `ojm market setup` **不再改写 mounts**。三条理由：
> 1. **A3 因此消解**：注入路径依赖 `# ojm:mounts` 锚点，而 `insertAnchor` 实际在 **模板侧**
>    `templates/api/src/_platform/_lifecycle/text-edit.ts:11`（`packages/cli/src` 零引用），cli 复用它等于
>    新建 `cli → templates` 依赖边，违反 A6 依赖方向守恒；照抄一份又是重复劳动。
> 2. **目录必须先存在**：oj **启动时 fail-fast 校验挂载目录**（spike 实测报错
>    `oj serve: mounts[N]: 挂载目录 <path>: No such file or directory`）。活跃挂载必须伴随恒定存在的
>    `cdn/` —— 既然目录无论如何要随模板发布，再维护「补锚点 + insertAnchor + 幂等检测」便无收益。
> 3. 想保留注入，锚点照样得先写进模板发布出去——两头不讨好。

模板 `api/config.yaml`（`/cdn` 排在 `/api` 之后、注释块 `/` 之前；**此挂载不得设 `spa`**）：

```yaml
mounts:
  - prefix: /api # api 挂载：/api/<module>/...（目录相对 config 所在目录 → api/src）
    api: src
  - prefix: /cdn # 本地模拟 CDN（红线：生产换外部 CDN 时删此行并把市场地址指过去）
    web: ../cdn  # 相对 api/config.yaml → 项目根/cdn
  # 生产若由 oj 直出前端（前后端同进程，即 ojm preview 的生产形态），
  # 取消下一行注释并先 build 出 web/dist（preview 会自动注入等价挂载，无需手改）：
  # - prefix: "/"
  #   web: "../web/dist"   # 相对 api/config.yaml → 项目根/web/dist
  #   spa: true
```

模板仓库自身同样提交 `cdn/README.md`（它不走 `ojm init`，但可直接 `pnpm dev`）。

**spike 实测支撑**（oj 0.1.84，逐条见 §11）：

- **字节保真**（原 §5.2 风险已证伪）：`.tgz` / `.tgz.sig` / `.yaml` / 64KB 高熵二进制四类，
  isolate 侧 `arrayBuffer()` 算得的 sha256 与盘上文件**逐字节一致**。
- **挂载声明序降级为约定**（推翻 A7）：实测把 `/` SPA 挂在 `/cdn` **之前**，`GET /cdn/pkg.tgz` 仍返回真实
  tgz、`GET /cdn/缺文件` 仍返 404 JSON，未被 SPA 回落吞掉——oj 静态路由按**前缀特异度**（推测最长前缀优先）
  匹配，而非声明序首个命中。上述顺序仅为可读性保留。
- **404 语义**：`/cdn/缺文件` → `404 {"code":404,"msg":"no route matched"}`，即使存在 `/` SPA 挂载也不回落。
- **响应不带 `cache-control`**（只有 ETag）→ 请求侧 `no-cache`（D7/R15）是**必需**而非锦上添花。
- 路径穿越（`../` 与 `%2f`）一律 404；HEAD 可用；Range 被忽略（返 200 全量，安装器本就整包 GET）。
- preview 派生 config（`preview-config.ts:108-132`）只 upsert `/` web 挂载，`/cdn` 原样保留，行为正确。

#### 3.1.1 dev 形态：`/cdn` 不在 dev server 上〔round3 新增阻断〕

`ojm dev` 由 **Node dev server 在 5174**（`dev.ts:43`）受理全部请求，仅把 `${apiBase}/` 前缀反代给 oj
子进程（`dev.ts:129`），其余一律交 `createStaticHandler`——未命中即回落 index.html（**200 + text/html**，
`static-handler.ts` 的 `serveHtml`）。而 `web: ../cdn` 是 **oj 的挂载**，只在 `oj serve`（config.yaml
`server.port: 9778`）上成立。因此：

- 市场地址**必须写绝对 URL** `http://127.0.0.1:9778/cdn`；写成相对 `/cdn` 时 dev 下取到的是 HTML 而非
  YAML，报的是难懂的 YAML 解析错，不是干净 404。
- **无跨域问题**：index 聚合与 tgz 下载都在 isolate 内服务端完成，浏览器不直取 CDN（`oj-market` 前端只认
  `market/index` 的 503 空态），故跨「5174 页面 / 9778 CDN」不产生同源限制。
- `ojm market setup` 的 `--url` 默认值须由 **config 的 `server.port` + 挂载 prefix** 推导，不得硬编码 9778。
- preflight（§3.5）增一项：`GET <base>/bundles.yaml` 的 content-type 必须是 yaml 而非 `text/html`，否则人话
  提示「市场地址写成了相对路径，或站点跑在 dev 形态——请用站点真实端口的绝对地址」。
- CDN 基址 = `http://127.0.0.1:9778/cdn`（无尾斜杠：`market/api.ts:196` 按 `${base}/bundles.yaml` 拼）。
  **必须是绝对地址且端口取自 config**——依据与 dev 形态陷阱见 §3.1.1。〔round3〕
- `init.include.yaml` 增 `- cdn/README.md`（产物一律不进仓，与现有纪律一致）。
- 缓存契约：索引拉取恒带请求头 `cache-control: no-cache`（`api.ts:196` 已保证），
  故不依赖 oj 的响应缓存头；tgz 内容寻址可长缓存（D7/R15）。
- **`cdn/README.md` 内容标准**〔安全 F1/CXO F6〕：声明①这是本地模拟源、产物不进仓；
  ②生产切法（删 `/cdn` 挂载 + 把 `framework.market_cdn_url` 指向外部 CDN）；
  ③签名/校验口径（包级 + 索引级 Ed25519 detached `.sig`，索引恒带 no-cache）；
  ④陌生发布方走 TOFU 信任库（首次绑定不可改，C2-38）。

### 3.2 `ojm market setup`：打开市场地址（原 `ojm cdn init`）

种子 `framework.market_cdn_url` 保持空（生产默认市场关闭是对的），由命令显式打开：

1. 保证 `cdn/` 与 README 存在（幂等）。
2. 校验 `mounts` 已含 `/cdn` 条目（D-2 后由模板发布，缺失说明工程被手改过）：缺失时**报错并打印要粘回
   config 的两行**，不自行改写 config——下面 §3.2 会改 sys_setting，但改 YAML 不是 CLI 该揽的活。〔round3，替代原「注入」〕
3. `PUT /api/system/settings {key: framework.market_cdn_url, value: <url>}`——security 组
   superadmin 门禁，复用 `site.ts` 的 `resolveSite/login/callApi`（`--user/--pass` 或
   `OJM_USER/OJM_PASS`，与 `ojm install` 同纪律，凭据只走内存）。
4. 站点未起（连不上 9778）→ 人话报错「先 `ojm dev`」并退出，不落盘任何东西。

**首跑凭据 must_change 处理**〔产品 F1，E5 实证链路〕：seed admin `must_change=1`（`seed.sql:6`）
只能拿限权 token（`access.ts:72-73` 403 `code:must_change`），无法 PUT security 组 settings。setup
先 `login`（`site.ts:84`）→ 探测响应 `restricted:true`（`session.ts:143`，比试 PUT 遇 403 干净，E5）→
若受限则改密：`PUT /api/auth/password {old_password, new_password}`（`auth/api.ts:52-63`，悬挂期唯一
可用写端）→ 该端点验旧口令、清 `must_change=0`、`issueFor` 返**全权 TokenBundle**（`session.ts:149-164`，
E5 实证）→ 用全权 token `PUT /api/system/settings`。改密属一次性环境准备，口令进黑名单（见 §3.6.3），
不落 artifacts/日志。照 `lifecycle-walkthrough.mjs:236-243` 先例。

### 3.3 `ojm market publish` + `ojm market build-index`：产物落 CDN 与索引重建

> **架构决策（D-1，2026-10-21）**：索引模型从「发布时 ingest 增量合并」改为「扫描目录全量重建」。
> 起因：`bundles.yaml`/`manifests.yaml` 作为共享可变单文件，多人往同一 CDN 发布时是临界资源——
> `publish.ts:95-104` 读-改-写有 TOCTOU，`publish.ts:109-110` 索引签名用当前发布者 key 多人互相覆盖。
> 而 `api.ts:222-234 verifyIndexSig` 注释明说索引签名「仅做完整性，发布方信任由 TOFU/信任库承载」，
> `api.ts:242-257 fetchIndex` 对 `.sig` 缺失容忍——**索引签名本就不是信任锚，信任锚在包级 `.tgz.sig`+信任库**。
> 故把索引从「共享可变状态」降格为「独立派生产物」：每人只落自己的 tgz，索引由扫描重建。此决策修正
> round2 的 E1（ingest 轮廓）与 A4（并发纪律），见 §10.3 E1/A4 行末「D-1 修正」标注。

#### 3.3.1 `ojm market publish`：落包（不碰索引）

默认 fixture 路径——合成最小合法方案包（照 e2e 的 demo-solution 结构，逐键对齐 oj 模块单根布局规范）：

```
<name>-<version>/
├── manifest.yaml                  # name/version/summary/peerRuntime/archive/health
│                                  #   /api/web/routes/permissions/roles/settings —— 索引重建的唯一事实源（§3.3.2 扫描提取）
├── api/<name>-<version>/          # manifest.yaml + routes.js + ping/api.js + migrations/000N__*.sql
└── web/modules/<name>/<version>/  # entry.js + main.css
```

- 打包走 `createDeterministicTgz(dir, out)`（`packages/cli/src/deterministic-tar.ts:27`），
  不依赖外部 tar CLI，同输入字节一致。
- **职责收窄**〔D-1〕：publish 只做「构建确定性 tgz + 包级 detached `.tgz.sig`（发布方 key 签）+ 落
  `cdn/<name>-<version>.tgz`」。**不再碰 `bundles.yaml`/`manifests.yaml`**——既有 `publish.ts` 的
  recomputeIndex/signIndex 索引逻辑移至 build-index（§3.3.2）。这把 round2 E1 的 `ingestEntry` 增量
  合并函数**整体取消**：无合并则无共享可变状态。
- **多人并发天然支持**〔D-1 修正 A4〕：每人只写 `cdn/<name>-<version>.tgz`（文件名含 name+version，
  不同发布方/不同版本不冲突），无共享可变索引文件——round2 A4「不支持并发 publish」**撤销**。
  同 name+version 重发：确定性 tgz 保证字节一致（覆盖即幂等）；字节不一致则检测冲突并告警（同包两版
  须显式升 version，不得同 version 改字节）。
- `--rebuild-index`：publish 落包后顺带触发一次 build-index（单人 playground 便利；多人协作场景由
  维护者跑独立 `ojm market build-index`，见 §3.3.2）。
- `--real <module>` 可选：改走 `ojm build --bundle` 真构建后再落同一目录（下游完全相同）。
- 多版本：0.1.0 与 0.2.0 的迁移文件只增不改（oj 迁移 checksum 要求 `0001` 两版逐字节一致）。
- **发布方密钥纪律**〔安全 F7，E3 接口缺口〕：`--id <key-id>` 缺省取 `~/.ojm/keys/<id>/private.pem`
  （与 `ojm sign` 同身份体系）；**隔离试装/walkthrough 场景强制用一次性随机 keypair**（见 §3.6.2），
  永不读真 `~/.ojm/keys`，不得把私钥 PEM 写进工作目录（纠正 `lifecycle-e2e.mjs:681` /
  `lifecycle-walkthrough.mjs:348-349` 手法）。**私钥不落盘的解法**〔round3 修订 E3〕：不改 `--key` 语义，
  改为把 `publish.ts` 拆成内部纯函数 `publishCore({ privateKeyPem, keyId, dir, ... })` + 读 PEM 文件的 CLI
  薄壳（~15 行），隔离/一次性场景直接调 `publishCore` 传**内存 PEM 字符串**（§3.4 两参数语义不变）。
  比给 `--key` 加 `-` 读 stdin 干净：公开参数面零变更，也省掉管道 handshake。一次性 keypair 照
  `lifecycle/__tests__/fixtures/sig/gen-signed-fixtures.mjs:12-13` 先例——公开 seed 经 SHA-256 派生
  Ed25519，私钥只在内存、**永不入仓**（P2-12 纪律标准答案，不必新造）。

#### 3.3.2 `ojm market build-index`：扫描目录重建索引

- **全量扫描重建**〔D-1〕：扫 `cdn/*.tgz` → 逐个 `gunzipSync` + 手写 ustar 读端流式提取**内嵌**
  `manifest.yaml`（与 `createDeterministicTgz` 手写 ustar 写端对称，不依赖外部 tar 库；manifest 是
  tgz 内 `<name>-<version>/manifest.yaml`，单一事实源 DRY，无旁路文件漂移风险）→ 聚合：
  - `bundles.yaml`：`{ solutions: [{ name, versions: [{ version, sha256, size, file }], latest }] }`
  - `manifests.yaml`：`[{ name, version, ...manifest 字段 }]`
  - latest 按 semver 排序取 max（复用既有 semver 工具）；历史版本全保留（扫描天然不删）。
- **归一化与签名**（复用既有 `publish.ts` 原语）：`sortKeysDeep` → 确定性 stringify（`recomputeIndex`）
  → detached `.sig`（`signIndex`，重建者 key 签）。索引签名仍是完整性层（防 CDN 目录/索引被中间人
  篡改），语义与 `verifyIndexSig` 一致——**非信任锚**，信任锚在包级 `.tgz.sig` + 信任库。
- **幂等**：同批 tgz 扫描结果字节一致（确定性 tgz + 确定性 sortKeysDeep），重跑结果不变。
- **触发模型**：独立命令 `ojm market build-index`（多人协作/CI 中心化，维护者跑）；publish 的
  `--rebuild-index` 顺带触发（单人便利）。build-index 单次执行无并发（中心化），写回无 TOCTOU。
- **`--check`**：重建后离线自检（verifyCanonical 复核两份索引签名 + 逐包 `.tgz.sig` 复核）。

### 3.4 子命令集（全部在 cli 包内，新增 `market/` 目录独立源文件）

**源文件落点**（A1）：既有每条非平凡命令均有独立源文件（`index.ts:34-172` 每命令
`await import("./xxx")`，install/publish/sign/keygen/enable/uninstall/trust 共 7 个）。market 命令面
体量大（walkthrough 400+ 行、trial 200+、verify 150+），沿用同纪律——新增 `packages/cli/src/market/`
目录（`setup.ts`/`publish.ts`/`build-index.ts`/`verify.ts`/`trial.ts`/`walkthrough.ts`/`bootstrap.ts`），
`index.ts` 加 `case "market":` 动态 import 入口。「无独立脚本文件」指无独立可执行脚本（仍是 `ojm`
单 CLI 子命令），非内联进 index.ts。

命令面整体更名 `cdn → market`〔产品 F7/CXO F8〕——CDN 是手段，市场是目的，统一归一个名词；
同时新增开发者环境两条子命令（§3.6）。

| 命令 | 作用 |
|---|---|
| `ojm market setup [--url <cdn-url>] [--user <u> --pass <p>] [--new-pass <p>]` | §3.2；默认 url = 站点地址 + `/cdn` |
| `ojm market publish [--fixture <name>@<version>] [--real <module>] [--id <key-id>] [--key <path>] [--check] [--rebuild-index]` | §3.3.1 落包（`--key` 为文件路径、给则须带 `--id`；`--rebuild-index` 顺带重建） |
| `ojm market build-index [--id <key-id>] [--key <path>] [--check]` | §3.3.2 扫描 cdn/*.tgz 重建索引+签名 |  
| `ojm market verify [--fixture <name>@<version>] [--file <path>] [--real <module>] [--rebuild-check]` | §3.6.1 离线验包（`--rebuild-check` 比对索引与目录） |
| `ojm market trial [--fixture <name>@<version>] [--real <module>] [--keep] [--strict]` | §3.6.2 隔离试装 |
| `ojm market walkthrough [--only <op>] [--keep] [--strict] [--progress] [--against <site-url>]` | §3.5 |

参数面收束〔产品 F9〕：`--keep`/`--strict` 跨命令统一语义（保留现场 / 首败即停）；去与既有 `ojm
install`/`ojm publish` 重复的 flag，复用既有解析。

**发布方密钥两参数**〔round3 修订：撤销「互斥」提案〕：保留既有契约——`--id` 指 key_id（C2-37 命名空间，
也是 `.sig` 的 `key_id` 字段来源），`--key` 指私钥**文件路径**。`publish.ts:78-82` 现状是「给了 `--key`
则 `--id` 必填」（缺则 throw），这正是一次性场景所需（签名必须同时知道私钥与 key_id），**不得改成互斥**——
那会破坏既有 `ojm publish --key` 行为并波及 `lifecycle/__tests__/publish.test.ts`。常规场景 `--id` 缺省即
`~/.ojm/keys/<id>/private.pem`；隔离场景不走 CLI 参数面，直接调 `publishCore`（§3.3.1）。

### 3.5 `ojm market walkthrough`：操作集与原子性

全部经真实 HTTP 面（与管理员点 UI 等价），不直连 DB 改态。每个 op 形态固定：
`setup → act → assert → cleanup`（cleanup 在 finally）。

**默认隔离站点**〔安全 F6/CXO F2〕：walkthrough 默认拉起隔离站点（§3.6.2 bootstrap）跑，
不打开发者真 9778 + 真超管 + 真 db + 真信任库。`--against <site-url>` 可显式指向已有站点
（受控逃生门，默认不开，须二次确认）。

> **端点路径约定**：下表与正文叙事用缩写 `market/<x>` / `solutions/<x>`，省略公共前缀
> `/api/_platform/`。涉及门禁/契约细节处用完整路径（如 `DELETE /api/_platform/market/trust/key`）。

| op | 端点 | 断言 |
|---|---|---|
| index | `GET market/index` | 卡片含目标方案与 latest（非空态） |
| install | `POST market/install {name,version,source:"cdn"}` → `GET market/task?id=` | done，十阶段全 ok |
| reinstall | 同上（同版本） | no-op 成功，锁/版本不变 |
| upgrade | install 0.2.0 | done，锁与 modules.json 推进 |
| upgrade `--from <v>`〔US-3〕 | 从指定已装版本升级到 latest | done，迁移链正向推进 |
| rollback | install 0.1.0（账本超前） | `failed@migrating` 且零副作用（AC5 口径），正道=对账自愈回指 |
| enable / disable | `POST market/enable {name,enabled}` | 锁摘挂 + 路由 + modules.json + sidecar 四处同写 |
| verify | `POST solutions/verify?name=` | 报告 ok，checks 齐全 |
| history | `GET market/history` | 版本记录 |
| uninstall | `POST market/uninstall` | 目录/锁/路由/modules.json 清除 |
| neg-tamper | 翻转 tgz 1B → install | `failed@verifying`，零落盘 |
| neg-nosig | 去掉 `.tgz.sig` → install | `failed@verifying`，msg 含 `sig_missing` |
| neg-badindex | bundles.yaml 追加字节 → install | 索引验签失败拒装 |
| neg-stranger | 未登记 key 的包 → install | `needs_trust` + 指纹在场 → `POST market/trust {task_id}` → 重装 done |
| neg-evil（可选） | 契约违规包（权限越空间 / 匿名越段） | `failed@preflight` |

**preflight 五项预检**〔产品 F8〕：进入任何 op 前，①隔离端口可用 ②凭据就绪（或一次性凭据已铸）
③CDN 可达 ④索引可验签 ⑤磁盘余量足；任一不过则人话报错退出，不进 op、不留半成品。

**输出契约**〔产品 F11/CXO F1〕：
- AC 表：`op | result | stage | evidence | pass/fail`，逐 op 一行。
- 汇总行：`PASS N / FAIL M / EXPECTED-FAIL K`，exit 0 当且仅当无非预期 FAIL。
- artifacts 落 `logs/walkthrough-<ts>.md`（照 `lifecycle-walkthrough.mjs` 先例）。
- `--progress` 切人话进度模式（逐 op 实时打钩），AC 表仍落盘。

**预期失败口径**〔CXO F11〕：neg-* 标「预期失败」——断言命中预期失败路径记 **PASS（预期）**，
未命中记 FAIL（链路没在验，比失败更严重）；非 neg op 失败记 FAIL。`--strict` 对非预期 FAIL 首败即停，
对预期失败不停。

**失败路径人话文案表**〔CXO F4〕：对标 `keygen.ts` 双段式（成因一句 + 下一步一句），逐失败码/阶段
一条，例如 `failed@verifying(sig_missing)` →「包缺签名文件：发布方未 detached 签名，或 CDN 目录
被裁剪；下一步：重发 `ojm market publish --check` 复核」。

**副作用清单**〔安全 F4/CXO F3〕：每个 op 披露站点态变更与不可还原项，例如升级后旧版本迁移
checksum 锁定（无法回退到改过的 `0001`）、`invalidateAllUsers()` 强退全站会话（uninstall 段）。
隔离站点下副作用随隔离根销毁，不外溢。

原子性契约：

1. `--only <op>` 可单跑：op 的 setup 自行建立前置态（如 upgrade 的 setup 确保 0.1.0 已装、
   0.2.0 未装），不依赖前序 op 的残留。
2. 字节级还原：负面 op 篡改的文件在 cleanup 里回抄原始字节（不重签，与 e2e 同手法）。
3. 站点态还原：每个 op 结束清掉自己装的东西（`--keep` 保留现场供人工查看）。
4. 默认 continue-on-fail（对非预期 FAIL），收尾打 AC 表 + 汇总行；`--strict` 首败即停。

**neg-stranger cleanup**〔安全 F3/CXO F3，阻断修复；E4 端点实证〕：
- 隔离信任库：neg-stranger 用的一次性随机 keypair 与信任库都落隔离根，cleanup 随隔离根销毁，
  不触开发者真 `.solutions/trusted-keys.yaml`（根除 `.bak` 复活与 C2-38 撞 409 破坏重跑）。
- **显式 revoke 走既有端点**（E4 推翻「需新增端点」假设）：`DELETE /api/_platform/market/trust/key?key_id=<id>`
  已存在（`api.ts:801-808`，`store.remove(keyId)` 返 `{ revoked }`，superadmin 门禁），不违反「不改既有
  契约」非目标。不靠 uninstall 兜底（`_lifecycle/uninstall.ts:101-114` 无 trustPath 字段，本就不摘信任）。
- 信任库快照 diff 断言：op 前后调 `GET /api/_platform/market/trust`（`api.ts:759-764`）取 key 集合快照，
  diff 断言相等（stranger key 无残留）。
- **非隔离场景（`--against`）的 .bak 复活**（E4）：cleanup 调 DELETE 摘 stranger key 后，`trust.ts:commit()`
  会把摘除前内容写进 `.bak`；若随后主文件损坏，`readDisk` 回落 `.bak`（`trust.ts:84-94`）会复活 stranger key。
  快照 diff 能检出泄漏但无法修复——故非隔离场景 cleanup 后须**重写一次主文件**（触发 .bak 刷新为摘除后状态），
  diff 断言失败时人话告警。隔离场景此风险随隔离根销毁消除。

**op 复用面**（E6）：walkthrough 各 op 统一经 `site.ts` 四函数（`resolveSite:51`/`login:84`/
`callApi:97`/`pollTask:129`）。install 类 op 不直接复用 `installCommand:207-259`（含渲染 + exitCode
副作用），而是拆底层 `installRaw(target, opts) → TaskRecord` + 高层 `installCommand = installRaw +
renderOutcome + exitCode`（保持既有行为）；walkthrough 用 `installRaw`。其余 op（index/enable/disable/
verify/history/uninstall/trust）走纯 `callApi`，trivial。

### 3.6 开发者环境（主诉求）〔CXO F2 / 安全 F6 / F7〕

两条独立路径，分别覆盖「确认安装包正确性」与「确认安装流程正确性」：

#### 3.6.1 离线验包 `ojm market verify`

- 不起站点、不装、不要凭据、不要 DB——秒级，纯本地校验。
- **复用面**（E2）：不复用 `market/api.ts` 的 `verifyEd25519Of:212`/`indexCanonical:206`（依赖 isolate
  全局 `crypto.verifyEd25519`/`sha256Hex`，Node 侧不存在）；改复用 cli 包内 Node 侧等价实现：
  包级验签 `lifecycle/sign.ts:55-69 verifyCanonical`、索引 sha256 `publish.ts:40-43 indexCanonical`、
  sha256 完整性 `node:crypto createHash`——均直接可用，工程量小。
- 校验项（**包级与索引级分列**，E2）：①tgz sha256 完整性 ②包级 Ed25519 detached 验签（tgz `.sig` vs
  tgz 字节）③索引级验签（index `.sig` vs index 字节，若带索引）④manifest 结构（字段齐 / peerRuntime /
  多版本迁移 checksum 逐字节一致）。round1 安全 F9 指出 `verifyIndexSig:222` 只内嵌 `.sig` 的 public_key
  重验（自证明不锚定信任）——验包口径明确区分「包级验签」与「索引级验签」两独立校验，输出分别列出。
- **`--rebuild-check`**（D-1）：扫描 `cdn/*.tgz` 重建索引（§3.3.2 同款扫描），与盘上 `bundles.yaml`/
  `manifests.yaml` 字节比对——检测「索引与目录漂移」（有人落了 tgz 但没跑 build-index，或索引被人手改过）。
  漂移则 ✗ 并列出差异（缺哪些 tgz 条目 / 多哪些）。
- 输出：✓/✗ 清单 + 一行结论；`--file <path>` 验任意 tgz，`--fixture`/`--real` 验本设计产物。
- **措辞边界**〔安全 F9〕：结论文案恒带「完整性 / 来源校验通过——不构成内容安全性背书」
  （验签过 ≠ 代码无恶意；内容安全属人工审计/沙箱职责，不在本期）。

#### 3.6.2 隔离试装 `ojm market trial` 与隔离站点 bootstrap

- 拉起隔离站点跑一次完整安装（十阶段），报阶段结果，跑完销毁（`--keep` 保留）。
- **bootstrap 库化**（A5）：既有 `lifecycle-e2e.mjs`/`lifecycle-walkthrough.mjs` 已覆盖全部手法
  （`mintDevCert:48`/`generateKeyPairSync("ed25519"):60`/`startSite:314`/`stopSite:343`/`patchConfig:356`/
  `startCdn:121`/`buildDemoTree:141`），但它们是独立脚本（spawn+kill 全在 main 内）。trial/walkthrough
  须提升为可编程库函数——新增 `market/bootstrap.ts` 导出：

  ```ts
  bootstrapIsolatedSite(opts: {
    port?: number;        // 缺省随机空闲端口（net.listen(0)）；显式给则用固定值（如 9783）
    keep?: boolean;       // 真=保留隔离根（打销毁清单），假=用后递归删
    fixture?: string;     // "@<version>" 形式，缺省 demo-solution@latest
  }): Promise<{ baseUrl: string; token: string; cdnDir: string; cleanup: () => Promise<void> }>
  ```

  封装端口/证书/DB/密钥/信任库/进程启停，返回 cleanup 句柄供 finally 链调用。照 `dev.ts:184-203` 先例
  注册 SIGINT/SIGTERM handler 确保隔离 `oj serve` 不孤儿化。复用 `mintDevCert`/`generateKeyPairSync`
  逻辑（从 e2e 提取为库函数或 cli/src 内重写，约 30 行）。
- 隔离站点 bootstrap 配置（trial 与 walkthrough 共用）：
  - **端口**：随机空闲端口（`net.createServer().listen(0)` 取 OS 分配，或固定 9783，与 e2e 9781/9782 区隔），绑 127.0.0.1。
  - **DB**：一次性 sqlite 临时文件，落隔离根，与开发者真 `db.sqlite` 物理隔离。
  - **密钥**：一次性 Ed25519 keypair（`generateKeyPairSync("ed25519")` 内存持有，照 `WALK_KEY:50`
    先例），**不写 PEM 到磁盘**；经 `publishCore`（§3.3.1）内存传私钥，**永不读真 `~/.ojm/keys`**，用后随隔离根销毁。〔安全 F7，round3〕
  - **信任库**：一次性 `.solutions/trusted-keys.yaml` 落隔离根，stranger key 不外溢。〔安全 F3〕
  - **凭据**：一次性 admin（随机口令 `randomBytes(16).toString("hex")`，`must_change` 现场清零），口令进黑名单不落报告。〔产品 F1〕
  - **CDN**：隔离站点 mounts `/cdn → 隔离 cdn 目录`；publish 用一次性 keypair 签。
  - **生命周期**：起 `oj serve`（隔离端口）→ **轮询 health 就绪**（照 `lifecycle-e2e.mjs:329-340`
    `/api/health` 至 ok，A2：避免冷启慢被默认超时截断）→ 跑 op → 销毁隔离根（递归删）+ kill oj child；
    bootstrap 失败 fail-fast 并清理半成品隔离根。
- `--against <site-url>`：trial 也可指向已有受控站点（逃生门，默认不开）。

#### 3.6.3 报告白/黑名单〔安全 F7 / CXO〕

- **白名单**（可公开/落 artifacts/日志）：key_id、公钥、指纹、task_id、AC 表、阶段结果、sha256。
- **黑名单**（禁落 artifacts/日志）：token、jwt_secret、口令、私钥 PEM、真 `~/.ojm/keys` 路径、
  真实站点凭据。报告写盘前过黑名单过滤。

#### 3.6.4 销毁

- 默认递归删隔离根（DB / 密钥 / 信任库 / CDN 产物同灭）。
- `--keep`：保留隔离根，打销毁清单（路径列表 + 手动销毁命令），供人工查看后清理。

### 3.7 术语表〔CXO F9〕

- **方案（solution）**：一组 api + web + manifest 的可安装单元，对应 `manifest.yaml` 的 name。
- **包（package / bundle）**：方案某版本的 `.tgz` 产物 + 双索引条目 + `.sig`。
- **模块（module）**：方案安装后在站点里注册的路由/菜单/i18n 单元（web 侧 `entry.ts` 登记）。

**文档内引用的既有决议/契约编号**（外部，非本文章节）：

- **C2-37**：key_id 命名空间校验（`keygen.ts:47 isValidKeyId`）。
- **C2-38**：信任库首次绑定不可改——陌生 key 首次登记后不可覆盖，重绑定撞 409（`trust.ts:139`）。
- **D7/R15**：tgz 内容寻址可长缓存、索引拉取恒带 no-cache 的缓存契约（`api.ts:196`）。

## 4. 数据流

```
[发布方各自] fixture / 真构建 → deterministic tgz + 包级 .tgz.sig（发布方 key）
                                → cdn/<name>-<version>.tgz + .tgz.sig       〔§3.3.1 publish，只落自己的包〕
                                      │
[CDN 维护者 / CI] build-index：扫描 cdn/*.tgz → gunzip+ustar 提取内嵌 manifest.yaml
                                → 聚合（name→versions[], latest by semver）→ sortKeysDeep 归一化
                                → bundles.yaml + manifests.yaml + .sig（重建者 key，完整性层）  〔§3.3.2〕
        │
        ├─[离线验包] verify：不起站点，本地 sha256+包级验签+索引验签+结构 → ✓/✗ 清单（边界声明）
        │             --rebuild-check：扫描重建比对盘上索引，检测漂移  〔3.6.1〕
        │
        └─[隔离试装/walkthrough] 隔离根 bootstrap（一次性端口/DB/密钥/凭据/信任库）→
                oj serve(隔离端口) mounts: /cdn → 隔离 cdn
                  │
                _platform/market：index → GET /cdn/bundles.yaml + manifests.yaml（恒带 no-cache）
                  │   索引签名=完整性层（非信任锚）；fetchIndex 对 .sig 缺失容忍  〔D-1〕
                  │
                install：GET /cdn/<name>-<version>.tgz → sha256 + 包级验签(fail-closed，信任锚) → 解压 → migrate
                  → 注册 → 热更 → smoke
                  │
                各 op → 同一批端点 → 断言 → 清场 → 销毁隔离根（--keep 保留）
```

## 5. 关键约束与风险

1. **同名冲突**：templates 已内建 oj-market 模块（`web.config.ts` 登记），fixture 方案名
   不得用 `oj-market` 或保留名 `market.*`；默认 `demo-solution`，与 e2e 一致。
2. ~~**oj web 挂载的静态能力需实测**~~ → **已实测通过**〔round3，见 §11〕：`.tgz` / `.tgz.sig` / `.yaml` /
   64KB 高熵二进制四类文件，isolate 侧 sha256 与盘上逐字节一致；缺文件返 404 JSON 而非 index.html。
   回落风险不在 oj 挂载而在 **dev 的 Node 静态层**——见新增的 §3.1.1。CDN 挂载仍不得设 `spa`（防御性）。
3. **同进程自取** → **已实测通过**〔round3，见 §11〕：isolate 内 fetch 自身 `/cdn` 四个资源全部 200/404
   正常，**无死锁、无截断**，耗时 0–9ms（命中的担忧点 `route_timeouts: []` 默认超时在同进程静态挂载路径上
   不成立）。实现约束保留：bootstrap 后仍**轮询 health 就绪**再发 market 请求
   （`lifecycle-e2e.mjs:329-340`）——防的是站点冷启而非内壁 timing；必要时仍可为
   `/api/_platform/market/*` 配宽松超时。逃生门（前置反代/独立端口）降级为预案，预期用不上。
4. **迁移 checksum**：多版本 fixture 的 migrations 只增不改（`0001` 两版逐字节一致），
   否则 `oj migrate` 报 missing → 整条升级链假失败。
5. **生产默认**：`/cdn` 暴露的是本就公开的分发目录，无损害；市场地址种子仍为空，不误开。
   config 注释里写明生产换外部 CDN 的切法（红线，§3.1）。
6. **隔离站点独立性**〔安全 F6〕：隔离端口/DB/密钥/信任库须与开发者真站点物理隔离；bootstrap
   失败须 fail-fast 并清理半成品隔离根。`--against` 显式指向真站点属受控逃生门，默认不开。
7. **一次性密钥纪律**〔安全 F7〕：隔离 keypair 用后即销，不得回写 `~/.ojm/keys`；publish 在
   隔离场景强制走一次性 keypair（经 `publishCore` 内存传参），报告黑名单兜底防私钥外泄。〔round3〕
8. **依赖方向守恒**（A6 确认）：market 命令面全在 cli 包内，所需 Node crypto/child_process/fs/
   site.ts 均已在 cli 包内，不引入 `cli → runtime` 之外依赖边。
9. **`/cdn` 与 SPA 回落**（A7 **已推翻**〔round3〕）：原假设「oj 按声明序首个命中，故 `/cdn` 必须排在 `/`
   SPA 之前」。实测把 `/` SPA 挂在 `/cdn` **之前**，`GET /cdn/pkg.tgz` 仍返真实 tgz、`GET /cdn/缺文件` 仍返
   404 JSON——oj 静态路由按**前缀特异度**匹配（推测最长前缀优先），声明序无关。该约束降级为可读性约定；
   冒烟仍保留 `curl /cdn/nonexistent.tgz` 必返 404 一条（防未来回归）。preview 派生 config 保留 `/cdn`
   无需特殊处理（`preview-config.ts:108-132`）。
10. **多人发布与索引时效**（D-1）：publish 只落自己的 tgz（并发安全），但索引时效取决于 build-index
    何时跑——有人落了 tgz 但没跑 build-index 时，`fetchIndex` 拿到的索引不含该包（`--rebuild-check`
    能检出漂移）。生产/多人协作场景须约定 build-index 的触发时机（CI 钩子或维护者定期跑）；单人
    playground 场景用 `publish --rebuild-index` 顺带重建即可。索引签名是完整性层非信任锚——即使索引
    过时，恶意包仍被包级 `.tgz.sig` + 信任库 fail-closed 拦住，过时只导致「装不上新包」不导致「装错包」。
11. **挂载目录缺失会炸**〔round3 新增，支撑 D-2〕：oj 启动即 fail-fast 校验 mounts 目录
   （`oj serve: mounts[N]: 挂载目录 <path>: No such file or directory`）。故活跃 `/cdn` 挂载必须伴随恒定
   存在的 `cdn/` 目录——模板仓库与 `ojm init` 白名单都得带 `cdn/README.md`，否则新手工程起不来。
12. **证书无绕过开关**〔round3 新增〕：`oj serve` 必须有 `server.public_key_path` + `certificate_path`，
   无任何 config/CLI 跳过开关（`oj-cert.ts:9-10` 已述）。隔离 bootstrap 须先签发开发证书
   （复用 `oj-cert.ts:25 mintDevCert` / `oj-cert.ts:63 ensureDevCert`），一步都不能省。

## 6. 验收

- **完整首跑序列**〔产品 F1〕：`pnpm install` → `ojm dev`（dev server 5174；其 oj 子进程按 config 在 9778）
  → `ojm market setup`（must_change 处理 + 开市场地址，**写出的必须是 9778 的绝对 URL**，§3.1.1）
  → `ojm market publish --rebuild-index`（落包+顺带重建索引）→ `ojm market verify` → `ojm market trial`
  → `ojm market walkthrough`，AC 表全 PASS（exit 0）。
- 每条 op `--only` 单跑均 PASS（原子性）。
- **索引重建**（D-1）：`ojm market build-index` 扫描 `cdn/*.tgz` 重建的 `bundles.yaml`/`manifests.yaml`
  与手写/旧索引比对，latest 与 versions 聚合正确；重建后 `.sig` 自检通过；多人各落各的 tgz 后跑一次
  build-index 索引即含全部包（无并发写冲突）。
- `ojm market verify --rebuild-check`：扫描重建比对盘上索引，检出漂移（落了 tgz 未重建）返 ✗ 列差异。
- `ojm market verify` 对篡改/缺签/坏索引包返 ✗ 且不装站点；结论带边界声明；包级与索引级验签分列（E2）。
- `ojm market trial` 跑完隔离根自动销毁；`--keep` 可查且打销毁清单。
- neg-stranger：op 前后信任库 key 集合快照 diff 相等（无残留陌生 key）。〔安全 F3〕
- 模板仓 `pnpm dev` 后市场页卡片区从「未配置市场地址」→ setup 后变可见 demo-solution 卡片；
  空态引导态可点「初始化市场」〔CXO F7〕（人工走查）。
- **D-2 模板自带挂载**：新工程 `ojm init` 后 `api/config.yaml` 的 `mounts` 已含 `/cdn → ../cdn` 且 `cdn/README.md`
  就位，`oj serve` 可直接起（不因缺目录 fail-fast）；模板仓库自身 `pnpm dev` 同样起得来。（原「A3 锚点前置」
  随 D-2 作废，setup 不再改写 mounts。）〔round3〕
- **dev 形态可用**〔round3 新增阻断〕：市场地址配置为**绝对 URL**（端口取自 `config.yaml` 的 `server.port`）时，
  `ojm dev` 下市场页能出卡片、能装成；配成相对 `/cdn` 时 preflight 报人话错误而非 YAML 解析崩。
- 冒烟（A7 降级后仍保留）：curl `/cdn/bundles.yaml` 与 `/cdn/<pkg>.tgz` 字节与仓内文件一致；
  `curl /cdn/nonexistent.tgz` 返 404 而非 index.html。**挂载声明序不再作为验收项**（§5.9 推翻）。
- 回归：根 / templates / cli 三套测试 + typecheck + lint 净。

### 6.1 测试基建落点（E7）

- **既有基线已被低估**〔round3 修订 E7〕：E7 称「cli 测试仅 `packages/cli/src/__tests__/versions.test.ts`」——
  但真正的重心在 `packages/cli/src/lifecycle/__tests__/`（**14 个 spec**：publish / deterministic-tar / trust /
  install / uninstall / keygen / sign / bundle / authoring / manifest-contract / smoke / sig-fixtures 等）。
  结论：market 命令面确实需要补测，但落点应是 `packages/cli/src/lifecycle/__tests__/`（沿用 Vitest node 环境，
  非 happy-dom），规模按「补充」而非「从零」。
- **可直接复用的存量资产**（round3 盘点，省掉大半 fixture 工作量）：
  `fixtures/sig/demo-solution-0.2.0.tgz` 及其 `.sig` / `.bad.sig` / `.unknown.sig` 三态签名夹具
  → 直接对应 neg-tamper / neg-nosig / neg-stranger；`fixture-valid/` 与 `fixture-invalid/` 树
  → 直接喂 build-index 扫描与 manifest 结构校验；`gen-signed-fixtures.mjs:12-13` 的「公开 seed → SHA-256
  派生 Ed25519」手法 → 直接充当隔离站点一次性 keypair（私钥不入仓）。
- 按 CLAUDE.md TDD/BDD：先写 BDD markdown 用例（多条件数据表格），再写实现。场景表见 §10.3 E7
  （build-index 扫描重建 / publish 落包 / verify / setup must_change / walkthrough op / neg-* /
  隔离 bootstrap / neg-stranger cleanup / 报告白黑名单九类），数据表格维度逐类定义。

## 7. 开放项（已拍板）

- `ojm market walkthrough` 默认跑**全量** op；`--only <op>` 取子集。〔产品 F11〕
- 输出形态：**AC 表 + 汇总行**默认（机读友好）；`--progress` 切人话进度（人读友好）；两者皆落盘
  artifacts。〔产品 F11 / CXO F1〕
- 预期失败 op（neg-*）按「预期失败」口径计 PASS（预期命中）/ FAIL（未命中）。〔CXO F11〕
- 是否把 `scripts/lifecycle-e2e.mjs` 的 CDN 也切到真 oj 挂载：**本期不动**（9778 主线禁用，
  9781/9782 纪律），隔离站点用 9783/随机端口区隔。〔原开放项保留〕

## 8. 后续与状态

- 本稿为 round1 + round2 五位专家全量评审 + **round3 实机 spike 与代码再校对**后的修订版
  （round1/round2 总览见 §10.1，spike 记录见 §11）。
- **round3 净变化**：推翻 1（A7 挂载声明序）、关闭 2 项风险（§5.2 字节保真、§5.3 同进程自取）、
  新增 1 项阻断（§3.1.1 dev 形态 `/cdn` 不通）、新落 1 项决策（D-2 模板直发挂载，取消 setup 注入）、
  修正引用失准 4 处（`insertAnchor` 真实落点、`--id`/`--key` 契约、E7 测试基线、`market/api.ts` 口径）。
- 进入代码实现前，按 CLAUDE.md 先建分支、先写 BDD 用例（§10.3 E7 场景表，多条件数据表格），再写实现；
  实现第一步建议：**先补 §3.1.1 的绝对 URL 处理**（dev 形态兜底），再做 P0 主链路（见请求方确认的分期）。

---

## 9. 评审纪要 round1（产品 / 安全 / CXO）

> 2026-10-20 23:37。对象为本设计原稿。裁决分级：阻断 / 重要 / 建议。阻断级均由 ≥2 位专家独立得出。

### 9.1 阻断共识索引（六项，均 ≥2 位专家独立得出）

根因与代码证据见下列 findings 表（level=阻断 行）；此处仅做阻断→修订节的路标。

| # | 阻断 | 主专家 | 同源 | 修订节 |
|---|---|---|---|---|
| 1 | 开发者环境零覆盖（主诉求） | CXO F2 | — | §3.6 |
| 2 | 隔离站点安全缺位 | 安全 F6 | CXO F2 | §3.6.2 |
| 3 | neg-stranger 污染信任库 | 安全 F3 | CXO F3 | §3.5 |
| 4 | publish 薄壳假设不成立 | 产品 F2 | — | §3.3 |
| 5 | 首跑凭据卡死 | 产品 F1 | — | §3.2 / §6 |
| 6 | walkthrough 输出契约缺失 | 产品 F11 | CXO F1 | §3.5 / §7 |

### 9.2 产品经理 findings

| ID | 摘要 | 级别 | 代码证据 | 裁决 | 修订映射 |
|---|---|---|---|---|---|
| F1 | 首跑凭据卡死：seed admin `must_change=1`，`cdn init`（现 `ojm market setup`）拿限权 token 无法 PUT settings；验收序列漏 install/dev | 阻断 | `seed.sql:6` must_change=1；`access.ts:72-73` 限权 403 | 采纳 | §3.2 setup 增 must_change 处理；§6 验收序列写全 |
| F2 | `ojm publish` 薄壳假设不成立：既有只重排+签名，无 ingest 合并新条目 | 阻断 | `publish.ts:68` recomputeIndex 只 sort+stringify | 采纳（D-1 演进） | §3.3：原 ingest 职责由 `build-index` 扫描重建取代（§3.3.2） |
| F7 | 命令更名 `ojm market setup\|publish\|walkthrough` | 建议 | 设计决策（命名一致性） | 采纳 | §3.4 命令面整体更名 `cdn → market`，新增 verify/trial |
| F8 | preflight 五项预检（端口/凭据/CDN/索引/磁盘） | 重要 | 设计决策（前置护栏） | 采纳 | §3.5 增 preflight 段 |
| F9 | 参数面微收（去冗余 flag） | 建议 | 设计决策（参数收敛） | 采纳 | §3.4 参数表收束 |
| F11 | walkthrough 输出形态未定义（§7 自承） | 阻断 | 设计缺口（§7 开放项） | 采纳 | §3.5 增输出契约段；§7 拍板 |
| US-3 | `--from <v>` 升级回归用例 | 建议 | 设计决策（回归覆盖） | 采纳 | §3.5 op 表增 upgrade `--from` 变体 |

### 9.3 安全专家 findings

| ID | 摘要 | 级别 | 代码证据 | 裁决 | 修订映射 |
|---|---|---|---|---|---|
| F1 | `/cdn` 注释升级红线 + `cdn/README.md` 内容标准（防误当生产源） | 重要 | `config.yaml:29` mounts 段 | 采纳 | §3.1 注释红线 + README 模板 |
| F3 | neg-stranger 陌生 key 永久写入信任库且 uninstall 不摘；`.bak` 复活；C2-38 撞 409 | 阻断 | `uninstall.ts:101-114` 无 trustPath；`trust.ts:84-94` .bak 回落复活；`trust.ts:139` 撞 409 | 采纳 | §3.5 neg-stranger cleanup 显式 revoke + 信任库快照 diff 断言 + 一次性随机 keypair；隔离信任库随隔离根销毁 |
| F4 | walkthrough 副作用清单 + 不可还原项披露 | 重要 | `uninstall.ts:236` invalidateAllUsers | 采纳 | §3.5 增副作用清单段 |
| F6 | 隔离站点安全设计缺位（打真站点/真超管/真 db/真信任库） | 阻断 | 设计缺位（原稿 §3.5 无隔离） | 采纳 | §3.6 开发者环境：隔离根一次性 DB/密钥/凭据/信任库 |
| F7 | 私钥 PEM 写进 WORK 目录 | 阻断 | `lifecycle-e2e.mjs:681-682` PEM 落盘 | 采纳 | §3.6：一次性随机 keypair，永不读真 `~/.ojm/keys` |
| F9 | 离线验包措辞边界：完整性/来源校验通过 ≠ 内容安全背书 | 重要 | `api.ts:222` verifyIndexSig 自证明 | 采纳 | §3.6.1 verify 输出文案加边界声明 |

### 9.4 CXO findings

| ID | 摘要 | 级别 | 代码证据 | 裁决 | 修订映射 |
|---|---|---|---|---|---|
| F1 | walkthrough 输出形态整体未定义 | 阻断 | 设计缺口（§7 开放项） | 采纳 | 同产品 F11 |
| F2 | 开发者环境主诉求零覆盖（离线验包 + 隔离试装 + 一次性凭据 + 销毁清单） | 阻断 | 设计缺位（原稿无 §3.6） | 采纳 | §3.6 开发者环境（本次修订核心） |
| F3 | neg-stranger 同安全 F3 | 阻断 | 同安全 F3 | 采纳 | 同安全 F3 |
| F4 | 失败路径人话文案表（对标 `keygen.ts` 双段式） | 重要 | `keygen.ts:86-87` 双段式先例 | 采纳 | §3.5 增失败文案表 |
| F6 | `/cdn` 注释 + README 同安全 F1 | 重要 | 同安全 F1 | 采纳 | 同安全 F1 |
| F7 | 市场页空态引导态（从「未配置」到「点此初始化」） | 重要 | `api.ts:589` 空态 503 | 采纳 | §6 验收 + 空态引导态描述 |
| F8 | 命令更名同产品 F7 | 建议 | 同产品 F7 | 采纳 | 同产品 F7 |
| F9 | 术语表：方案/包/模块 | 建议 | 设计决策（术语统一） | 采纳 | §3.7 术语表 |
| F11 | 预期失败 op 标「预期失败」（neg-* 的 fail = PASS） | 建议 | 采纳 | §3.5 输出契约：neg-* 预期失败口径 |

---

## 10. 评审纪要 round2（架构师 / 工程师）

> 2026-10-21 00:15。对象为 round1 修订稿。主诉：对 round1 修订稿做架构与工程可行性的增量校验——印证 / 补充 / 推翻。

### 10.1 评审总览

- **规模**：五位专家全量完成（round1 产品/安全/CXO + round2 架构师/工程师）。架构师 7 项（1 阻断 A3、3 重要、3 建议）；工程师 7 项（0 阻断、4 重要、3 建议）。
- **对 round1 的增量**：推翻 1（E4：`DELETE /market/trust/key` 端点已存在，neg-stranger cleanup 无需新增端点）；升级 1 为阻断（A3：`# ojm:mounts` 锚点缺失）；印证 5（E1→产品F2、E3→安全F7、E4→安全F3、E5→产品F1、E2→安全F9）；补充 9（A1/A2/A4/A5/A6/A7/E3/E6/E7）。注：E3 兼印证（安全F7 私钥不落盘）与补充（`--key` stdin 接口缺口）双维度，故在两类各计一次。
- **阻断合计**：round1 六项（§9.1）+ round2 A3 = 七项，均已映射到 §1-§8 修订。
- **结论**：设计假设经两轮校验整体成立——工程师「无阻断，既有代码面支撑所有设计要求」；架构师唯一阻断 A3 属锚点缺失实现前置项，非设计方向错误。
- **round3 增补**（实机 spike，2026-10-21，见 §11）：A3 由决策 D-2 整体消解（不再需要锚点与注入）；
  A7 的优先级假设被实测推翻；round2 遗留的两项「需实测」风险（§5.2 / §5.3）均已证实无碍；
  同时暴露出 round2 未覆盖的一项阻断——dev 形态下 `/cdn` 不在 dev server 上（§3.1.1）。
- **评审后架构决策（D-1，2026-10-21）**：用户议题「多人往同一 CDN 发布时索引如何合并」——经代码核查确认 ingest 增量模型在多人场景不成立（共享可变单文件 TOCTOU + 索引签名互相覆盖，而索引签名非信任锚），改为扫描重建：publish 只落包，`build-index` 扫描 `cdn/*.tgz` 全量重建索引。此决策**修正** round2 的 E1（ingest→scan）与 A4（撤销「不支持并发」），详见 §3.3 与 §10.2/§10.3 对应行「D-1 修正」标注。属「与原评审结论相左的后续修正」，单列于此以可追溯。

### 10.2 架构师 findings（A1-A7）

| ID | 摘要 | 级别 | 代码证据 | 裁决 |
|---|---|---|---|---|
| A1 | 「全部内联 cli，无独立脚本文件」措辞不成立——既有每条非平凡命令均有独立源文件，walkthrough 体量 400+ 行应独立 | 重要 | `index.ts:34-172` 每命令 `await import("./xxx")` 独立文件 | 采纳：措辞修正为「全部在 cli 包内，无独立可执行脚本」；新增 `market/` 目录，index.ts 加 `case "market":` |
| A2 | 同进程自取不死锁（`/cdn` 静态挂载不进 isolate，oj Rust 侧并发处理）但有默认超时截断风险 | 建议 | `api.ts:195-199` fetchText、`config.yaml:55` `route_timeouts: []` | 采纳：隔离 bootstrap 须等 health 就绪再发 market 请求 |
| A3 | `# ojm:mounts` 锚点当前不存在——config.yaml 仅有 `# ojm:reload`；`insertAnchor` 遇锚点缺失 throw，setup 会崩 | **阻断** | `config.yaml:59` 仅有 `# ojm:reload`；`text-edit.ts:15-16` throw；`text-edit.ts:33` 注释「S1-1 定稿安装无需改 mounts」 | 采纳→**round3 由 D-2 取代**：不再补锚点、不再注入。引文准确的补正是——`insertAnchor` 实际位于**模板侧** `templates/api/src/_platform/_lifecycle/text-edit.ts:11`（`packages/cli/src` 零引用），且 spike 证实 oj 对挂载目录缺失 fail-fast，故改为模板直发挂载 + `cdn/README.md`（见 §3.1） |
| A4 | publish ingest 边界清晰（ingest 合并 / recompute 归一 / sign 密码，三者正交），但全同步 IO 无文件锁，并发 publish 有 TOCTOU | 重要 | `publish.ts:68-70` recomputeIndex、`publish.ts:100-104` writeFileSync 无锁、`publish.ts:72` 同步函数 | **D-1 修正**：ingest 整体取消，publish 只落自己的 tgz（无共享可变状态），并发天然支持，原「不支持并发 publish」撤销 |
| A5 | 隔离 bootstrap 既有先例充分（mintDevCert/generateKeyPairSync/startSite/stopSite），但须从脚本模式提升为可编程库函数 | 重要 | `lifecycle-e2e.mjs:48-57/60-68/314-354`、`dev.ts:184-203` 进程管理先例 | 采纳：新增 `market/bootstrap.ts` 导出 `bootstrapIsolatedSite(opts)`（签名见 §3.6.2），注册 SIGINT/SIGTERM 防孤儿 |
| A6 | 依赖方向守恒——market 命令面全在 cli 包内，不引入 `cli → runtime` 之外依赖边 | 建议（确认无风险） | `cli/package.json` 唯一内部依赖 `@oj-module/runtime`；新增所需 Node crypto/child_process/fs/site.ts 均已在 cli 包内 | 确认无风险 |
| A7 | `/cdn` 挂载与 `/api` 无冲突，preview 派生 config 保留 `/cdn` 正确（`preview-config.ts:108-132` 只 upsert `/`）；但与 `/` SPA 回落的路径优先级需实测 | 建议 | `config.yaml:29-37`、`preview-config.ts:108-132` | **round3 实测推翻**：优先级不按声明序——把 `/` SPA 置于 `/cdn` 之前，`/cdn` 文件照常字节命中、缺文件仍返 404 JSON。约束降级为可读性约定（§5.9 / §11）。404 冒烟项保留 |

### 10.3 工程师 findings（E1-E7）

| ID | 摘要 | 级别 | 代码证据 | 裁决 | 工程量 |
|---|---|---|---|---|---|
| E1 | ingest 确为纯新增（recomputeIndex 只 parse→sort→stringify 无合并）；e2e `lifecycle-e2e.mjs:672-679` 已有手写 ingest 先证（find row → unshift version） | 重要 | `publish.ts:68/72-128`、`lifecycle-e2e.mjs:672-679` | **D-1 修正**：`ingestEntry` 增量合并函数取消，改为 `scanAndBuildIndex`（扫描 `cdn/*.tgz` 提取内嵌 manifest 全量重建，§3.3.2）；recompute/sign 原语复用 | 中（扫描+ustar 读端 ~100 行） |
| E2 | `market/api.ts` 验签依赖 isolate 全局 `crypto.verifyEd25519`（Node 侧不存在），但 `lifecycle/sign.ts:55-69 verifyCanonical` + `publish.ts:40-43 indexCanonical` 已有 Node 侧等价实现可直接复用 | 重要 | `api.ts:212-214/206-208` isolate 依赖；`sign.ts:55-69`/`publish.ts:40-43` Node 侧 | 采纳：verify 复用 sign.ts/publish.ts Node 侧函数；包级与索引级验签分列输出 | 小 |
| E3 | bootstrap 手法全可复用，但 `publish.ts:79` 的 `--key` 只接受文件路径——隔离场景无法保「私钥不落盘」纪律 | 建议 | `lifecycle-e2e.mjs:121-138/141-183/681-682`、`lifecycle-walkthrough.mjs:50-58/348-349/236-243/690-693`、`publish.ts:79` | 采纳→**round3 换解法**：不动 `--key` 语义（保留「给 `--key` 则 `--id` 必填」），改拆 `publishCore({ privateKeyPem, keyId, ... })` + CLI 薄壳（§3.3.1/§3.4），隔离场景内存传 PEM；原「`--key -` 读 stdin」方案废弃（§3.4 round3 修订） | 小 |
| E4 | `DELETE /market/trust/key?key_id=` 已存在（`store.remove` 返 `{ revoked }`，superadmin 门禁）；uninstall 不摘信任已确认；隔离场景 .bak 复活随隔离根销毁消除 | 重要 | `api.ts:801-808` del()、`uninstall.ts:101-114/149-256` 无 trustPath、`trust.ts:109-116/84-94/139` | 采纳：显式 revoke 走既有端点；快照 diff 走 `GET /market/trust`；非隔离场景 cleanup 后须重写主文件刷新 .bak | 小 |
| E5 | must_change 链路完全可实现——`PUT /api/auth/password` 返全权 TokenBundle（`session.ts:149-164` 验旧口令→must_change=0→issueFor 全权）；login 响应含 `restricted:true` 可探测 | 建议 | `seed.sql:6` must_change=1、`access.ts:72-73` 限权 403、`auth/api.ts:52-63` PUT password、`session.ts:149-164`、`site.ts:84-94/97-107`、`walkthrough.mjs:236-243` 先例 | 采纳：login→探测 restricted→改密→全权 token→PUT settings | 小 |
| E6 | `site.ts` 四函数（resolveSite/login/callApi/pollTask）是 walkthrough 核心复用面；`installCommand:207-259` 含渲染+exitCode 不宜直接复用，应拆底层 `installRaw` + 高层 | 建议 | `site.ts:51-58/84-94/97-107/129-146`、`install.ts:207-259/16-98` | 采纳：拆 `installRaw(target,opts)→TaskRecord` + `installCommand=installRaw+renderOutcome+exitCode` | 中 |
| E7 | CLI 包测试覆盖薄弱（`__tests__/` 仅 `versions.test.ts`）；market 命令面需完整 BDD 用例 + Vitest specs（node 环境，非 happy-dom） | 重要 | `packages/cli/src/__tests__/` 仅 versions.test.ts；模板 API 侧 specs 丰富但属宿主侧 | 采纳，**但前提被 round3 修正**：cli 真正重心是 `packages/cli/src/lifecycle/__tests__/`（14 个 spec + 已签夹具三态 + fixture-valid/invalid 树）。落点改为该目录沿用 Vitest node 环境；工程量由「大」下调「中」（大量 fixture 可复用，见 §6.1）；BDD 场景表见下 | 中 |

#### 10.3 E7 BDD 场景表（采纳，落实现前 BDD 文档）

| 场景类 | 用例 | 数据表格维度 |
|---|---|---|
| build-index 扫描重建 | 单包 / 多包多版本 / latest 聚合 / 历史版本全保留 / 同 name+version 幂等 / tgz 缺内嵌 manifest 报错 / 空目录 | tgz_set, expected_solutions, expected_latest, expected_versions_count |
| publish 落包 | fixture 落包 / `--real` 真构建 / `--rebuild-index` 顺带重建 / 同 name+version 重发字节一致 / 同 name+version 重发字节冲突告警 / 多人并发各落各包无冲突 | source, rebuild, version_conflict, expected_outcome |
| verify 离线验包 | sha256 通过/篡改、包级签名通过/篡改/缺签、索引签名通过/篡改/缺签、manifest 合法/缺字段/peerRuntime 不符、`--rebuild-check` 漂移检出/无漂移 | check_item, tamper_type, expected_result |
| setup must_change | happy（受限→改密→全权→PUT 成功）/ 旧口令错误 / 站点未起 / 改密后 PUT 仍 403 | scenario, expected_outcome |
| walkthrough op | 14 op 端点调用序+断言 | op, endpoint, method, expected_status, expected_stage |
| neg-* | tamper/nosig/badindex/stranger/evil | tamper_type, expected_failure_stage, expected_error_code |
| 隔离 bootstrap | 端口/DB/密钥/凭据/信任库隔离 + 销毁验证 | resource_type, isolation_mechanism |
| neg-stranger cleanup | 快照 diff 相等 / revoke 成功 / 隔离根销毁无残留 / diff 不等告警 / revoke 404 / .bak 复活检出 | assertion_type, expected_result |
| 报告白/黑名单 | token 不落 / 私钥不落 / key_id 可落 | field, in_whitelist, in_blacklist |


---

## 11. round3 实机 spike 记录（2026-10-21）

> **目的**：写代码前证实/证伪三件事——① oj `web` 挂载能否字节保真返回 `.tgz` / `.yaml` / `.sig`；
> ② 缺文件是否返 404 而非 index.html；③ isolate 内 fetch 自身 `/cdn`（同进程自取）是否死锁或被超时截断。
> 顺带验明挂载目录缺失与证书的行为。整个过程约 20 分钟，零代码改动。

### 11.1 环境与手法

- **oj 0.1.84**（`/Users/ever/.local/share/oj/oj`；cli 门禁 `MIN_OJ_VERSION = 0.1.73`，`vendor.ts:37`）。
- 一次性工程 `/tmp/ojm-cdn-spike`：`api/config.yaml` 只声明 `mounts: [- prefix: /cdn, web: ../cdn]`（**不设 spa**）
  + `server.port: 9790` + 证书三件套；`--api-path` 指向一个探针模块目录。
- **样本文件**（四类，覆盖真实形态）：repo 内既有签名夹具 `demo-solution-0.2.0.tgz`(472B) 与其 `.tgz.sig`(251B)、
  手写 `bundles.yaml`(53B)、64KB `/dev/urandom` 高熵 `random.bin`(65536B)。
- **探针**（唯一新增代码，用完即弃）：`src/cdnprobe/api.ts` + `manifest.yaml`，在 isolate 内
  `fetch(url, { headers: { 'cache-control': 'no-cache' } })` → `await res.arrayBuffer()` →
  `globalThis.crypto.sha256Hex(bytes)`，与盘上 `shasum -a 256` 逐字节比对。
- **证书**：本机无 node，用 `openssl genrsa` + `openssl dgst -sha256 -sign` 现场签 RS256 JWS，
  对齐 `oj-cert.ts:25 mintDevCert` 的格式（nbf/exp）。跑完已删除 spike 目录及其临时私钥。

### 11.2 结果

| # | 项 | 断言 | 结论 |
|---|---|---|---|
| 1 | **字节保真** | isolate 侧 sha256 == 盘上 sha256 | ✅ 四类全部一致：`f5ba648d…`(tgz) / `a1ab31ac…`(bin) / `8f836151…`(sig) / `398cbaf1…`(yaml) |
| 2 | content-type | yaml→`application/yaml`；tgz/bin→`application/octet-stream` | ✅ 正确 |
| 3 | 缓存头 | 响应是否下发 `cache-control` | ⚠️ **只有 `etag`，无 `cache-control`** → 请求侧 `no-cache`（D7/R15）是必需项，不是优化项 |
| 4 | **404 语义** | 缺文件返 404 而非 index.html | ✅ `404 {"code":404,"msg":"no route matched"}`；即便同时存在 `/` SPA 挂载也不回落 |
| 5 | **挂载声明序** | `/` SPA 在前时 `/cdn` 是否被吞 | ✅ 未吞——`/cdn/pkg.tgz` 仍返真实字节 → **推翻 A7**（§5.9） |
| 6 | 路径穿越 | `/cdn/../config.yaml`、`%2f` | ✅ 一律 404，无泄漏 |
| 7 | HEAD / Range | 是否可用 | HEAD ✅ 200；Range 被忽略（返 200 全量）——安装器本就整包 GET，无影响 |
| 8 | **同进程自取** | isolate 内 fetch 自身 `:9790/cdn` | ✅ 无死锁、无截断，**0–9ms**；`route_timeouts: []` 默认超时在该路径上不成立 → §5.3 关闭 |
| 9 | **挂载目录缺失** | 缺失时 oj 作何反应 | ⚠️ 启动 fail-fast：`oj serve: mounts[N]: 挂载目录 <path>: No such file or directory` → **活跃挂载必须随附目录**，即 §5 第 11 条（支撑 D-2） |
| 10 | 证书 | 能否绕过 | ⚠️ 必须 `server.public_key_path` + `certificate_path`，无 config/CLI 绕过开关；相对路径按 config 所在目录解析，从工程根 `-c api/config.yaml` 起正常 → §5 第 12 条 |

**顺带排除的隐患**：安装器既有读取方式是对的——`download.ts:75` 用 `new Uint8Array(await res.arrayBuffer())`，
并拿 `bytes.byteLength` 比对索引声明的 `archive.size` 后再算 sha256 fail-closed，**不存在 `.text()` 解二进制导致的损坏**。
（spike 里用 `res.text()` 探测时 65536B 的文件报了 62038，正说明这一步不能图省事。）

### 11.3 对设计的处置

| 结论 | 去向 |
|---|---|
| ①②③ 全部通过 | §5.2 / §5.3 关闭；§3.1「同进程挂载 + 直出静态目录」方案成立，**备选方案 B（把 e2e 的 Node 静态 CDN 提成库）降级为备用，本期不采纳** |
| A7 被推翻 | §5.9 改写 + §10.2 A7 行标注；声明序降为可读性约定，404 冒烟保留 |
| 挂载目录 fail-fast | 新增 §5 第 11 条；模板必须同时发布挂载与 `cdn/README.md`（决策 D-2） |
| 证书不可绕过 | 新增 §5 第 12 条；隔离 bootstrap 须先 `mintDevCert`（`oj-cert.ts:25`） |

**未覆盖**（有意留到实现期）：
1) 真实 `_platform/market` 全链路走查——需完整 api 模块 + DB + 鉴权，非本次静态 spike 范围；
2) `ojm dev` 5174 与 oj 9778 的双形态——已由代码走查确认为阻断（§3.1.1），待实现期用模板真跑验证。
