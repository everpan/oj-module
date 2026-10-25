# registry 侧 CLI 子命令：离线包产出、吊销清单签名、已装清单

本文覆盖 0.3.3 新增/扩展的三条子命令，重点讲**判定顺序**与**边界**（谁验自洽、谁验信任、
失败时留下什么），因为这些才是排障时真正要看的东西。命令的历史动机见 `CHANGELOG.md`，
registry 侧的协议与不变式见下游 `oj-registry` 的 `docs/registry-dev-manual.md`。

| 命令 | 形态 | 一句话 |
|---|---|---|
| `ojm registry export` | 新增 | 从 registry 读面拉一个 `ojm registry import` 能直接吃的离线包 |
| `ojm registry sign --revocations` | 扩展（同一子命令加模式） | 签 `revocations:<seq>:<sha256(正文)>`，产出吊销签名回传体 |
| `ojm list` | 新增 | 列站点已装方案（版本 / 启用态 / 可升级 / 签名可信） |

---

## 0. 三条命令在链路里的位置

三条命令分属三个人群，互不依赖，只共享同一套「读面 / 站点 API」：

```mermaid
flowchart LR
    subgraph RegistrySite["registry 站点（oj-registry 模块）"]
        RS["读面 /api/oj-registry/cdn/*"]
        ADM["管理面 /api/oj-registry/*（assertAdmin）"]
    end

    subgraph Ops["运维 / 救站"]
        EXP["ojm registry export"]
        IMP["ojm registry import"]
    end

    subgraph CI["发布流水线"]
        SIGN_IDX["ojm registry sign（索引）"]
        SIGN_REV["ojm registry sign --revocations"]
    end

    subgraph Target["目标站点（装了方案的那台）"]
        LIST["ojm list"]
        MKT["GET /api/_platform/market/index"]
    end

    RS -->|"catalog / shards / revocations / 包体 + .sig"| EXP
    EXP -->|"离线包目录"| IMP
    IMP -->|"验签 + seq 护栏后落盘"| Target

    ADM -->|"未签索引导出"| SIGN_IDX
    SIGN_IDX -->|"回传 signatures"| ADM
    RS -->|"吊销清单正文"| SIGN_REV
    SIGN_REV -->|"回传六字段签名"| ADM

    LIST --> MKT
```

三条命令的信任边界各不相同，混用会出「验了等于没验」的假安全感：

```mermaid
flowchart TB
    A["export：只验自洽<br/>正文 ↔ 它自己的 .sig"] -->|"不判公钥归属"| B["产物目录"]
    B --> C["import：验自洽 + 验归属<br/>公钥必须在本站 active 索引 key 集合里"]
    C -->|"过"| D["落盘到 cdn/registry 或 --out"]

    E["sign：用本地私钥签<br/>服务端事后验签 + 验 key 登记"] --> F["回传体"]

    G["list：只读站点聚合视图<br/>不参与任何签名判定"] -.-> H["表格"]
```

> 为什么 export 不判归属：它手上没有本站信任库。拿**源自己给的公钥**去验**源自己给的签名**，
> 攻击者换一对钥匙就全过。信任判定只能发生在有本地信任库的一侧（`import` 与安装侧）。

---

## 1. `ojm registry export`

```
ojm registry export --site-url <registry 站点地址> [--out <目录>] [--dry-run] [--json]
```

### 1.1 时序：先把索引层拉齐并验完，再决定要不要下包体

```mermaid
sequenceDiagram
    autonumber
    participant CLI as ojm registry export
    participant R as registry 读面
    participant FS as 磁盘

    CLI->>R: GET /cdn/index
    R-->>CLI: catalog 正文
    CLI->>R: GET /cdn/index/signature
    R-->>CLI: catalog.sig
    Note over CLI: 验自洽 + 取签名声明的 seq

    loop catalog 钉的每个分片号
        CLI->>R: GET /cdn/shard/{no}
        R-->>CLI: shard 正文
        CLI->>R: GET /cdn/shard/{no}/signature
        R-->>CLI: shard.sig
        Note over CLI: 验自洽 + 校验 seq = catalog 钉值
    end

    CLI->>R: GET /cdn/revocations
    R-->>CLI: 吊销清单正文
    CLI->>R: GET /cdn/revocations/signature
    R-->>CLI: revocations.sig
    Note over CLI: 验自洽 + 取 seq（空清单也要签）

    alt 带 --dry-run
        CLI-->>CLI: 只列计划，不下载包体、零落盘
    else 正式导出
        loop 分片里声明的每个 slug@version
            CLI->>R: GET /cdn/package/{slug}/{version}
            R-->>CLI: tgz 字节
            CLI->>R: GET /cdn/package/{slug}/{version}/signature
            R-->>CLI: tgz.sig
            Note over CLI: 长度与 sha256 都要等于索引声明
            CLI->>FS: 写入隐藏暂存目录
        end
        CLI->>FS: 整体换位到 out/registry
        CLI->>FS: 最后写 out/source.json
    end
```

### 1.2 判定顺序与失败码

顺序是刻意的：**索引层全部验完之前，一个包体都不下载**。索引半代/半份时下载包体纯属浪费流量，
而索引问题恰恰是「正在重建」时最常见的状态。

```mermaid
flowchart TD
    S(["registry export 开始"]) --> U{"--site-url 合法？"}
    U -->|"否"| E2["用法错误 exit 2"]
    U -->|"是"| F1["取 catalog + catalog.sig"]

    F1 -->|"HTTP 非 2xx"| X1["export_fetch_failed"]
    F1 -->|"侧车 404 / 空"| X2["index_sig_missing"]
    F1 -->|"正文与侧车不符"| X3["index_sig_mismatch"]
    F1 --> V1["解析分片钉值"]
    V1 -->|"钉值为空 / 非 YAML"| X4["offline_format"]

    V1 --> L{"逐片：取片 + 片侧车"}
    L -->|"侧车缺失"| X2
    L -->|"验签不过"| X3
    L -->|"签名 seq ≠ 钉值"| X5["index_generation_mismatch"]
    L -->|"通过"| V2["解析片内 versions"]

    V2 -->|"slug / 版本号 / sha256 形态不合法"| X4
    V2 --> R1["取 revocations + revocations.sig"]
    R1 -->|"签名 404 / 空"| X6["revocations_sig_missing"]
    R1 -->|"验签不过"| X3

    R1 --> D{"--dry-run？"}
    D -->|"是"| DRY["返回计划文件清单，零落盘"]
    D -->|"否"| P["并发下载包体（默认 4）"]
    P -->|"HTTP 非 2xx"| X1
    P -->|"长度 ≠ archive.size"| X7["package_sha_mismatch"]
    P -->|"sha256 ≠ archive.sha256"| X7
    P -->|"缺包体 .sig"| X1
    P --> OK["换位 → out/registry + source.json"]
```

各码的含义与处置：

| 码 | 含义 | 处置 |
|---|---|---|
| `export_fetch_failed` | 读面取不到（非 2xx / 网络 / 缺包体侧车） | 查站点地址、索引是否已生成、网络与证书 |
| `index_sig_missing` | index/shard 的 `.sig` 缺失或空 | 站点还没签名，或静态载体没同时拷 `.sig` |
| `index_sig_mismatch` | 正文与侧车不符（含坏 JSON、alg/base64/seq 形态错） | 源正在重建或内容被改，重试/排查源 |
| `index_generation_mismatch` | 分片签名代次 ≠ catalog 钉值 | 源正在重建索引，等稳定后重跑（拿到的是半代产物） |
| `revocations_sig_missing` | 吊销清单没签过名 | 先走 `POST /revocations/signature` 签一次 |
| `offline_format` | 索引结构破损（钉值空、缺 solutions、slug/版本越界） | 源数据坏了；结构性错误，别重试 |
| `package_sha_mismatch` | 包体长度或摘要与索引不符 | 下载截断/串包/内容被替换；多半重试可解，持续则查源 |

### 1.3 产物结构与「不留半份包」

产物必须与 `ojm registry import` 的读取形态逐字节对齐，否则会出现「导出的包自己导不进去」：

```text
<out>/
├── source.json                     # {origin, exported_at, catalog_seq, revocation_seq, shards, packages}
└── registry/
    ├── catalog.yaml
    ├── catalog.yaml.sig
    ├── shards/
    │   ├── 1.yaml
    │   └── 1.yaml.sig
    ├── revocations.yaml
    ├── revocations.yaml.sig
    ├── <slug>-<version>.tgz        # 平铺；文件名按 slug/version 构造，不采信 archive.file
    └── <slug>-<version>.tgz.sig
```

`source.json` 的 `origin` 是 import 给吊销 seq 账本分桶的键；没有它 import 会退化成
`offline:<绝对目录>`，目录一挪账本就跟丢。

落盘用「暂存目录 + 整体换位」，中途失败不会在 `out/registry/` 留下半份：

```mermaid
flowchart LR
    A["建 out/.ojm-registry-export-进程号"] --> B["索引文件 + 包体逐份写入暂存"]
    B -->|"任一步失败"| C["删除暂存目录<br/>目标目录不动"]
    B -->|"全部成功"| D["删旧 out/registry"]
    D --> E["rename 暂存 → out/registry"]
    E --> F["写 out/source.json"]
```

---

## 2. `ojm registry sign --revocations`

```
ojm registry sign <revocations.yaml> --revocations --id <index.key> [--key <pem>] [--out <file>] [--json]
```

索引签名与吊销签名共用一个子命令，靠 `--revocations` 切模式；信封里用 `data.kind`
（`index` / `revocations`）区分，CI 不用猜。

```mermaid
flowchart TD
    IN(["输入 revocations.yaml（或 - 读 stdin）"]) --> M{"带 --revocations？"}
    M -->|"否"| IDX["索引签名：export.json → signatures[]<br/>（原有逻辑，canon 字段 = v2）"]
    M -->|"是"| EMPTY{"正文为空？"}
    EMPTY -->|"是"| U1["用法错误 exit 2<br/>空清单也必须签，但空文件不是清单"]
    EMPTY -->|"否"| JSON{"首字符是左花括号？"}
    JSON -->|"是"| F1["revocation_sig_format<br/>这是 /revocations 的 JSON 导出，不是正文"]
    JSON -->|"否"| SEQ{"解析出顶层 seq ≥ 0？"}
    SEQ -->|"否"| F1
    SEQ -->|"是"| ID{"给了 --id 且合法？"}
    ID -->|"否"| U2["用法错误 exit 2<br/>这一处没有导出体可推断 key"]
    ID -->|"是"| KEY["读私钥 → 导出公钥 hex + 指纹"]
    KEY --> CANON["canon = revocations:seq:sha256(正文原文)"]
    CANON --> SIGN["Ed25519 签名"]
    SIGN -->|"verifyCanonical 不过"| F2["revocation_sig_mismatch"]
    SIGN --> OK["六字段回传体<br/>seq / alg / key_id / public_key / value / canon"]
    OK --> OUT{"--out 或 --json"}
    OUT -->|"都没有"| U3["用法错误 exit 2<br/>签名结果必须有去处"]
    OUT -->|"有"| DONE["落盘或打信封"]
```

两个容易踩的点，代码里都做了明确拒绝或说明：

```mermaid
flowchart TB
    A["服务端把收到的 canon 与<br/>自己按正文重算的串逐字比对"] --> B["客户端必须对同一串字节签名"]
    B --> C["不做解析再序列化<br/>换行/键序/缩进变了 sha 就变"]
    C --> D["所以命令原样吃文件<br/>并拒掉以左花括号开头的 JSON 导出"]
```

| 码 | 含义 |
|---|---|
| `revocation_sig_format` | 输入不是正文（JSON 导出）、没有合法 `seq` |
| `revocation_sig_mismatch` | 签完自检不过（PEM 不是 Ed25519 / 公私钥口径不一致） |

正文从哪里来：`ojm registry export` 产出的 `registry/revocations.yaml`，或直接
`GET /api/oj-registry/cdn/revocations` 的响应体。**不要**用 `GET /revocations`（管理端点，
返回 JSON 结构，服务端重算的 sha 会不同）。

---

## 3. `ojm list`

```
ojm list [--site-url <u>] [--user <u>] [--pass <p>] [--all] [--json]
```

```mermaid
sequenceDiagram
    autonumber
    participant CLI as ojm list
    participant S as 目标站点
    CLI->>S: POST /api/auth/login
    S-->>CLI: access_token
    CLI->>S: GET /api/_platform/market/index（Bearer）
    S-->>CLI: 索引行数组
    Note over CLI: 缺省只留 installed 非空<br/>按 name 排序
    alt 空清单
        CLI-->>CLI: 「还没有已装方案」+ 指路 --all（exit 0）
    else 有行
        CLI-->>CLI: 表格 + 可升级 / 签名不受信 汇总行
    end
```

每列的口径都不是 CLI 现算的，而是站点聚合好的：

```mermaid
flowchart LR
    subgraph Site["GET /_platform/market/index 行"]
        I["installed"]
        E["enabled"]
        L["latest"]
        U["upgradable"]
        T["trust_state"]
    end

    I --> C1["已装版本"]
    E --> C2["启用态"]
    L --> C3["索引最新版"]
    U --> C4["可升级"]
    T --> C5["签名可信（trusted / untrusted / absent）"]

    C1 --> TBL["表格 + --json data.solutions"]
    C2 --> TBL
    C3 --> TBL
    C4 --> TBL
    C5 --> TBL
```

输出形态（表格为 ASCII 对齐，`-` 表示该列对这批数据不适用）：

```text
[ojm] 站点 http://127.0.0.1:9778：已装 2 个方案
NAME             INSTALLED  ENABLED  LATEST  UPGRADABLE  TRUST
acme-demo        2.0.0      no       2.0.0   no          untrusted
demo-solution    0.1.0      yes      0.1.2   yes         trusted
[ojm] 可升级：demo-solution（ojm install <name> 装最新版）
[ojm] 签名不受信：acme-demo（先 ojm trust add 确认发布方公钥）
```

`--all` 连未安装的索引行一起列（`installed` 显示 `-`），用于「这台机器上能装什么」。
清单为空仍是成功（exit 0）：没装东西不是错误。

---

## 4. 退出码与信封（三条命令统一）

```mermaid
flowchart LR
    A["命令执行"] --> B{"参数形态错？<br/>缺 --site-url / 缺凭据<br/>缺 --id / 结果无处可去"}
    B -->|"是"| E2["exit 2 · usage_error<br/>补参数能解决"]
    B -->|"否"| C{"域判定失败？<br/>验签 / 代次 / 摘要 / 站点报错"}
    C -->|"是"| E1["exit 1 · 稳定机器码<br/>CI 按 code 分支"]
    C -->|"否"| E0["exit 0 · code = ok"]

    E0 --> J["--json：stdout 只有一行信封<br/>ok / command / code / msg / data"]
    E1 --> J
    E2 --> J
```

`--json` 下 stdout 只有一行 JSON，人话一律走 stderr——`JSON.parse(stdout)` 永远成立。
信封的 `command` 是 `registry export` / `registry sign` / `list`，`data` 形状见各节；
`registry sign` 用 `data.kind` 区分索引与吊销两种产出。

---

## 5. 三个常见组合

```mermaid
flowchart LR
    subgraph A["private 站点救站"]
        A1["export --site-url https://reg"] --> A2["import ./pkg --site 站点数据根 --keys active-key.json"]
    end
    subgraph B["发布流水线（索引）"]
        B1["POST /index/unsigned"] --> B2["sign 导出的 export.json --id k --out body.json"] --> B3["POST /index/signature -d @body.json"]
    end
    subgraph C["发布流水线（吊销）"]
        C1["GET /cdn/revocations 存成 rev.yaml"] --> C2["sign rev.yaml --revocations --id k --out rev.json"] --> C3["POST /revocations/signature -d @rev.json"]
    end
```

- 救站链：`export` → 拷到内网 → `import`。全程只有 export 那一步触网。
- 索引链与吊销链都遵循同一条纪律：**私钥不进服务端**，服务端只做验签与落库。
- `list` 不在这两条链上，它是升级前/卸载前的确认动作。
