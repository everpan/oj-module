# registry 相关 CLI 子命令：全链路流程

本文覆盖 `ojm` 里与 registry（方案仓库）相关的全部子命令：**作者发版**（`keygen` / `sign` /
`publish` / `registry sign` / `registry sign --revocations`）、**消费安装**（`install` / `list` /
`view` / `trust` / `enable` / `disable` / `uninstall`）、**运维救站**（`registry export` /
`registry import`）。

重点讲**判定顺序**与**边界**（谁验自洽、谁验信任、失败时留下什么），因为这些才是排障时要看的东西。
协议与不变式见下游 `oj-registry` 的 `docs/registry-dev-manual.md`；本文只讲命令面。

---

## 0. 命令全景

```mermaid
flowchart LR
    subgraph Author["作者 / 发布流水线"]
        K["ojm keygen"]
        S["ojm sign<br/>包体签名 REG-CS3 v2"]
        P["ojm publish<br/>本地索引重算 + 签名"]
        RS["ojm registry sign<br/>服务端导出索引签名"]
        RR["ojm registry sign --revocations<br/>吊销清单签名"]
    end

    subgraph Consumer["站点运维 / 消费"]
        I["ojm install<br/>file / cdn / registry 三源"]
        L["ojm list<br/>已装清单"]
        V["ojm view<br/>目录键 ↔ 物理名"]
        T["ojm trust<br/>发布方 key 信任库"]
        EN["ojm enable / disable / uninstall"]
    end

    subgraph Ops["救站"]
        EX["ojm registry export"]
        IM["ojm registry import"]
    end

    subgraph Site["站点 / registry 服务端"]
        UP["POST /packages/{scope}/{name}<br/>上传五查"]
        UD["POST /index/unsigned<br/>渲染未签索引"]
        IS["POST /index/signature<br/>收签名翻代"]
        RVS["POST /revocations/signature"]
        READ["读面 /api/oj-registry/cdn/*"]
    end

    K --> S
    S --> UP
    UD --> RS --> IS
    RR --> RVS
    READ --> I
    I --> L
    I --> T
    EX --> READ
    EX --> IM
```

三条链的信任边界各不相同，混用会出「验了等于没验」的假安全感：

```mermaid
flowchart TB
    A["export：只验自洽<br/>正文 ↔ 它自己的 .sig"] -->|"不判公钥归属"| B["产物目录"]
    B --> C["import：验自洽 + 验归属<br/>公钥必须在本站 active 索引 key 集合里"]
    C -->|"过"| D["落盘到 cdn/registry 或 --out"]

    E["install：站点侧验签<br/>索引签名 + 包体签名 + 吊销清单"] -->|"未知发布方"| F["needs_trust（TOFU）"]
    F -->|"人工核对指纹后 confirm"| G["落库 + 重试安装"]

    H["sign / registry sign：私钥在本地<br/>服务端只验签"] --> I2["回传体"]
```

> export 不判归属的原因：它手上没有本站信任库。拿**源自己给的公钥**去验**源自己给的签名**，
> 攻击者换一对钥匙就全过。信任判定只能发生在有本地信任库的一侧（`import` 与安装侧）。

---

## 1. 作者发版链

### 1.1 全流程

```mermaid
sequenceDiagram
    autonumber
    participant Dev as 作者
    participant CLI as ojm
    participant Reg as registry 站点

    Dev->>CLI: ojm keygen --id acme.publisher
    CLI-->>Dev: 私钥 ~/.ojm/keys/acme.publisher/private.pem<br/>公钥 hex

    Dev->>Reg: POST /api/oj-registry/index/keys（登记 active 索引 key）
    Dev->>CLI: ojm sign demo-0.1.0.tgz --registry-id https://reg.example.com
    CLI-->>Dev: demo-0.1.0.tgz.sig（六字段，canon = 规范串）

    Dev->>Reg: POST /packages/acme/demo（multipart：tgz + .sig + version + license）
    Reg-->>Dev: 201 版本行（不可变）

    Note over Reg: 索引由 DB 生成（不是扫目录）：<br/>catalog + 各分片
    Dev->>Reg: POST /index/unsigned（admin）
    Reg-->>Dev: {gen, pending[], keys[]}
    Dev->>CLI: ojm registry sign export.json --id acme.index --out body.json
    CLI-->>Dev: {gen, signatures[]}
    Dev->>Reg: POST /index/signature -d @body.json
    Reg-->>Reg: 逐条验签 + 代次核对 → 翻代
```

### 1.2 `ojm keygen` / `ojm sign`

```mermaid
flowchart LR
    A["ojm keygen --id 发布方"] --> B["私钥落 ~/.ojm/keys/id/private.pem"]
    B --> C["打印公钥 hex"]
    C --> D["去 registry 登记（POST /index/keys）"]
    D --> E["ojm sign 包体 --registry-id 站点地址"]
    E --> F["tgz.sig 六字段"]
```

包体签名规范串是 **REG-CS3 v2**：`<registry_id>:<slug>@<version>:<sha256(tgz)>`。

- `registry_id` 必须是**目标站点的 `canonical_origin`**，否则上传时服务端 `registry_id_mismatch`；
  它的作用是让「A 仓库签的包」不能拿到 B 仓库的 CDN 上装。
- `slug` 是物理名（`acme-demo`），不是目录键（`@acme/demo`）。
- `--registry-id` 是必填项（0.3.1 起接线）：漏了等于签不出合法规范串。

### 1.3 上传五查（`POST /packages/{scope}/{name}`）

服务端按固定顺序判决，**顺序本身就是设计**：越便宜的闸越靠前，超限时一个字节都不读。

```mermaid
flowchart TD
    S(["multipart 上传"]) --> T1{"① token 有效？"}
    T1 -->|"否"| E1["401 unauthorized"]
    T1 -->|"是"| T2{"①' 有该 scope 的发布权？"}
    T2 -->|"否"| E2["403 scope_forbidden"]
    T2 -->|"是"| T3{"⑤ 体积 ≤ MAX_PACKAGE_BYTES？"}
    T3 -->|"否"| E3["413 package_too_large<br/>（此时未读包体）"]
    T3 -->|"是"| T4["解析 .sig 六字段"]
    T4 -->|"缺 / 形态错"| E4["400 sig_invalid"]
    T4 --> T5{"② 公钥是本站 active 索引 key？"}
    T5 -->|"否"| E5["403 registry_key_mismatch"]
    T5 -->|"是"| T6["读包体 → ③ 验签名"]
    T6 -->|"规范串/摘要不符"| E6["403 sig_mismatch"]
    T6 -->|"过"| T7{"④ 该版本已存在？"}
    T7 -->|"是"| E7["409 version_exists（版本行不可变）"]
    T7 -->|"否"| OK["写 reg_version（含 license）"]
```

要点：

- **版本行不可变**：只有 yank 能改 `state`/`yanked_*`，重发同版本一律 409（不做覆盖，避免索引与包体漂移）。
- 体积闸前置的原因：413 要在「还没读包体」时给出，否则大文件已经把进程打满才拒绝。
- `license` 是可选文段（`^[A-Za-z0-9.+ -]{1,64}$`），格式错 `license_invalid`；未声明不落字段。

### 1.4 索引生成与 `ojm registry sign`

索引**不由 CLI 渲染**：DB 是唯一真相（blob 无常驻目录，扫目录重建在共享存储上不成立）。所以链路切成两半——
服务端渲染并导出未签正文，CI 侧签名，再回传：

```mermaid
flowchart LR
    A["POST /index/unsigned（admin）"] --> B["{gen, pending: [{kind, no, seq, text, sha256}], keys}"]
    B --> C["ojm registry sign"]
    C --> D{"三条 fail-closed"}
    D -->|"公钥未登记 / 指纹不符"| D1["index_key_mismatch"]
    D -->|"正文 ≠ 声明 sha256"| D2["index_export_tampered"]
    D -->|"签完自检不过"| D3["index_sig_mismatch"]
    D -->|"通过"| E["{gen, signatures[]}"]
    E --> F["POST /index/signature（admin）"]
    F --> G["逐条验签 + 代次核对 → 翻代 live / superseded"]
```

- 这一代没有待签文件时命令是**幂等**的：不碰私钥，产出空 `signatures`（CI 重跑不会因为机器上没 key 变红）。
- 沿用旧分片按导出给的旧代次签（`seq < gen`），不会自作主张签成新代次。
- 服务端只有 verify，没有任何签名原语——私钥永远不进服务端。

### 1.5 `ojm publish`：本地索引目录的重算 + 签名

`ojm publish` **不负责上传**，它与 `registry sign` 是两件事：

| | `ojm publish <dir>` | `ojm registry sign <export.json>` |
|---|---|---|
| 输入 | 本地索引目录（`catalog.yaml` + `shards/<n>.yaml`） | 服务端导出的未签正文 |
| 做什么 | 重算规范化正文（消弭格式漂移）→ 盖代次/时效 → 签 catalog + 各分片 → 原子写回 | 只签名，不改正文 |
| 谁产生索引 | 本地（`ojm market build-index` 扫 `cdn/*.tgz`） | 服务端（DB 渲染） |
| 典型场景 | 市场 CDN 目录、补签本地索引、离线站点 | registry 服务的索引 |

```mermaid
flowchart TD
    A(["ojm publish dir --id 索引key"]) --> B{"目录有 catalog.yaml？"}
    B -->|"否"| E1["错误：发布目录须含 catalog.yaml"]
    B -->|"是"| C["重算 catalog 规范化文本"]
    C --> D["读 shards 钉值"]
    D --> F{"每片存在？"}
    F -->|"否"| E2["错误：钉了却缺文件"]
    F -->|"是"| G{"片 .sig 代次 = 钉值？"}
    G -->|"否"| E3["index_generation_mismatch<br/>源正在重建，不替它签字"]
    G -->|"是"| H["盖 seq / issued_at / expires_at"]
    H --> I["签 catalog + 各分片"]
    I --> J["原子落盘：先分片、后 catalog（catalog 是提交点）"]
    J --> K{"--check？"}
    K -->|"是"| L["本地自检，不过则 exit 1"]
    K -->|"否"| M["完成"]
```

### 1.6 吊销链

```mermaid
sequenceDiagram
    autonumber
    participant Admin as 仓库管理员
    participant Reg as registry 站点
    participant CLI as CI 侧
    Admin->>Reg: POST /keys/{id}/revoke {severity: retire | malicious, reason}
    Reg-->>Reg: 追加 reg_revocation（seq 单调 +1）<br/>该 key 不能再发布
    CLI->>Reg: GET /api/oj-registry/cdn/revocations
    Reg-->>CLI: 清单正文（YAML，顶层 seq）
    CLI->>CLI: ojm registry sign rev.yaml --revocations --id 索引key
    CLI-->>CLI: canon = revocations:seq:sha256(正文原文)
    CLI->>Reg: POST /revocations/signature -d @rev.json
    Reg-->>Reg: 验签 + 代次核对 → 落 reg_revocation_sig
    Note over Reg: 读面/静态载体开始发 revocations.yaml + .sig
```

- `severity` 两档：`retire` 只挡**新装**；`malicious` 同样挡新装，并让已装端在信任核对里强告警
  （**不自动卸载**，裁决权留给人）。
- 清单**每变一次 seq +1**，安装端记录每源最大 seq，回退或同代替换都拒（`revocations_not_monotonic`）。
- 空清单也必须签（seq=0）：把「没签」当「没吊销」是 v2.1 漏掉的绕过。

---

## 2. 消费安装链（`ojm install`）

### 2.1 三源分流

```mermaid
flowchart TD
    T(["ojm install target"]) --> P{"目标形态"}
    P -->|"本地 .tgz 路径"| F["file 源<br/>multipart：tgz + 可选 .sig"]
    P -->|"name[@version]"| C["cdn 源<br/>JSON {source: cdn}"]
    P -->|"@scope/name[@version] --registry URL"| R["registry 源<br/>JSON {source: registry, registry: origin}"]

    F --> F1["CLI 同目录探测 tgz.sig<br/>有则随包上传（第二文件）"]
    F1 --> SITE
    C --> SITE
    R --> R1["CLI 校验站点 apiVersion ≥ 0.2.0"]
    R1 -->|"过低"| X1["明确报错：升级站点或用 cdn/file 源"]
    R1 -->|"够"| R2["CLI 归一目录键 → slug（唯一一处）"]
    R2 --> SITE
    SITE["站点侧校验 + 十阶段安装"] --> POLL["登录 → 提交任务 → 轮询至终态"]
    POLL --> OUT{"终态"}
    OUT -->|"done"| OK["exit 0"]
    OUT -->|"needs_trust"| TOFU["打印指纹 + ojm trust confirm --task"]
    OUT -->|"partial / failed"| NG["打印原因与指引，exit 1"]
```

注意分工：

- **归一（`@scope/name` → `slug`）只在 CLI 做一次**。服务端收到含 `@` 或 `/` 的名字直接
  `invalid_physical_name`，防止绕过 CLI 传两种形态造成物理名/目录键混淆。
- **白名单在服务端**：`config.yaml` 的 `vars["oj-registry.allowlist"]`，缺省空 = 不信任任何外部源。
  CLI 的 `--registry` 只是传值，可被绕过，所以服务端必须再校一次。

### 2.2 registry 源的站点侧判定顺序

```mermaid
sequenceDiagram
    autonumber
    participant CLI as ojm install
    participant Site as 目标站点
    participant Reg as registry 源

    CLI->>Site: GET /market/meta（apiVersion）
    CLI->>Site: POST /market/install {source: registry, registry: origin, name, version}
    Site->>Site: 归一/校验：URL 形态、白名单（403 registry_not_allowed）
    Site->>Reg: GET /cdn/index（跨源 3xx 拒）
    Reg-->>Site: catalog + catalog.sig
    Site->>Site: 验签 + 代次 + 时效（index_* 码）
    Site->>Reg: GET /cdn/shard/{no}（按钉值逐片）
    Reg-->>Site: shard + shard.sig
    Site->>Site: 验签 + 钉值同代 + latest 不回退 + yank + file 名加固
    Site->>Reg: GET /cdn/revocations
    Reg-->>Site: 清单正文
    Site->>Reg: GET /cdn/revocations/signature
    Reg-->>Site: 清单 .sig
    Site->>Site: 验签 + seq 单调（fail-closed：拿不到就拒装）
    Site->>Site: 命中吊销条目？（发布方 key 或 包+版本）
    Site->>Site: runInstall（十阶段）
    Site->>Reg: GET /cdn/package/{slug}/{version}
    Reg-->>Site: tgz
    Site->>Site: 验包体签名（REG-CS3 v2）+ TOFU
```

顺序上的三个「先」值得记住：

1. **索引全绿才解析版本**：catalog 与分片任一份验签/代次/时效不过，直接 502，不猜版本。
2. **版本确定后才查吊销**：包不存在就没必要查清单（少一次失败面）；包存在则必须查。
3. **吊销不可达即拒装**：`revocations_unreachable` / `revocations_sig_missing` /
   `revocations_sig_mismatch` / `revocations_not_monotonic` 四个码各自独立，绝不降级成「没有黑名单」。

### 2.3 十阶段安装与验签分流

```mermaid
stateDiagram-v2
    [*] --> preflight
    preflight --> downloading
    downloading --> verifying
    verifying --> extracting
    extracting --> migrating
    migrating --> lock_commit
    lock_commit --> registering
    registering --> deploying_web
    deploying_web --> reloading
    reloading --> smoke
    smoke --> audit
    audit --> [*]

    state 失败语义 {
        lock_commit之前: 清场（零改锁零改库）
        lock_commit之后: partial（部分生效 + 指引）
    }
```

`verifying` 段是签名判定集中地，六码分流（CLI 侧按 `hintKey` 渲染人话）：

| 码 | 含义 | 处置 |
|---|---|---|
| `sig_missing` | 包体缺 `.sig` | 发布方没签，或上传时没带第二文件 |
| `sig_format` | 六字段形态错（alg/base64/seq） | 签名文件坏了，重签 |
| `sig_alg` | 算法不是 Ed25519 | 用了别的钥匙体系 |
| `sig_key` | 签名公钥与信任库登记的不一致 | 换过钥匙，需核对 |
| `tampered` | 正文与签名不符（含规范串 registry_id 不符） | 包被改过，或签给了别的站点 |
| `unknown_key` | 公钥不在信任库 | 走 TOFU（下面第五节） |

### 2.4 TOFU：未知发布方

```mermaid
flowchart LR
    A["verifying：公钥不在信任库"] --> B["任务终态 needs_trust<br/>（不是失败、不是成功）"]
    B --> C["CLI 打印 key_id + 指纹<br/>（公钥 sha256，8 位一组）"]
    C --> D{"人工与发布方核对"}
    D -->|"一致"| E["ojm trust confirm --task <id>"]
    D -->|"不一致"| F["停止，不要确认"]
    E --> G["trust 库落库"]
    G --> H["重跑 ojm install 继续"]
```

- 指纹口径统一为 **sha256(公钥 32 字节)**；按 hex 文本算会让同一把钥匙在 `ojm keygen`、
  站点信任库、registry 吊销清单三处显示三个值，吊销清单会静默失效。
- 首装可通过第一方 bootstrap key 免 TOFU；运维显式吊销的 key 不会被重新播种覆盖。

---

## 3. 运维救站链（`registry export` / `import`）

### 3.1 `ojm registry export`

```
ojm registry export --site-url <registry 站点地址> [--out <目录>] [--dry-run] [--json]
```

```mermaid
sequenceDiagram
    autonumber
    participant CLI as ojm registry export
    participant R as registry 读面
    participant FS as 磁盘

    CLI->>R: GET /cdn/index + /cdn/index/signature
    Note over CLI: 验自洽 + 取签名声明的 seq
    loop catalog 钉的每个分片号
        CLI->>R: GET /cdn/shard/{no} + /signature
        Note over CLI: 验自洽 + seq = 钉值
    end
    CLI->>R: GET /cdn/revocations + /signature
    Note over CLI: 空清单也要签
    alt 带 dry-run
        CLI-->>CLI: 只列计划，不下载包体、零落盘
    else 正式导出
        loop 分片里声明的每个 slug@version
            CLI->>R: GET /cdn/package/{slug}/{version} + /signature
            Note over CLI: 长度与 sha256 都要等于索引声明
            CLI->>FS: 写入隐藏暂存目录
        end
        CLI->>FS: 整体换位到 out/registry
        CLI->>FS: 最后写 out/source.json
    end
```

判定顺序（**索引层全部验完之前，一个包体都不下载**）：

```mermaid
flowchart TD
    S(["registry export 开始"]) --> U{"site-url 合法？"}
    U -->|"否"| E2["用法错误 exit 2"]
    U -->|"是"| F1["取 catalog + catalog.sig"]
    F1 -->|"HTTP 非 2xx"| X1["export_fetch_failed"]
    F1 -->|"侧车 404 / 空"| X2["index_sig_missing"]
    F1 -->|"正文与侧车不符"| X3["index_sig_mismatch"]
    F1 --> V1["解析分片钉值"]
    V1 -->|"钉值空 / 非 YAML"| X4["offline_format"]
    V1 --> L{"逐片：取片 + 片侧车"}
    L -->|"侧车缺失"| X2
    L -->|"验签不过"| X3
    L -->|"签名 seq ≠ 钉值"| X5["index_generation_mismatch"]
    L -->|"通过"| V2["解析片内 versions"]
    V2 -->|"slug / 版本号 / sha256 形态不合法"| X4
    V2 --> R1["取 revocations + revocations.sig"]
    R1 -->|"签名 404 / 空"| X6["revocations_sig_missing"]
    R1 -->|"验签不过"| X3
    R1 --> D{"dry-run？"}
    D -->|"是"| DRY["返回计划文件清单，零落盘"]
    D -->|"否"| P["并发下载包体（默认 4）"]
    P -->|"HTTP 非 2xx"| X1
    P -->|"长度 ≠ archive.size"| X7["package_sha_mismatch"]
    P -->|"sha256 ≠ archive.sha256"| X7
    P -->|"缺包体 .sig"| X1
    P --> OK["换位 → out/registry + source.json"]
```

| 码 | 含义 | 处置 |
|---|---|---|
| `export_fetch_failed` | 读面取不到（非 2xx / 网络 / 缺包体侧车） | 查站点地址、索引是否已生成、网络与证书 |
| `index_sig_missing` | index/shard 的 `.sig` 缺失或空 | 站点还没签名，或静态载体没同时拷 `.sig` |
| `index_sig_mismatch` | 正文与侧车不符（含坏 JSON、alg/base64/seq 形态错） | 源正在重建或内容被改，重试/排查源 |
| `index_generation_mismatch` | 分片签名代次 ≠ catalog 钉值 | 源正在重建索引，等稳定后重跑 |
| `revocations_sig_missing` | 吊销清单没签过名 | 先走 `POST /revocations/signature` 签一次 |
| `offline_format` | 索引结构破损（钉值空、缺 solutions、slug/版本越界） | 源数据坏了；结构性错误，别重试 |
| `package_sha_mismatch` | 包体长度或摘要与索引不符 | 下载截断/串包/内容被替换；持续则查源 |

产物必须与 `ojm registry import` 的读取形态逐字节对齐：

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

`source.json` 的 `origin` 是 import 给吊销 seq 账本分桶的键；没有它 import 退化成
`offline:<绝对目录>`，目录一挪账本就跟丢。落盘用「暂存 + 整体换位」，中途失败不在目标目录留半份。

### 3.2 `ojm registry import`

```
ojm registry import <dir> [--site <站点数据根>] [--out <目标目录>] [--keys <active-index-key.json>] [--dry-run] [--json]
```

```mermaid
flowchart TD
    A(["读 dir/registry/"]) --> B{"catalog.yaml + .sig 在？"}
    B -->|"否"| E1["offline_format / index_sig_missing"]
    B -->|"是"| C["验签（公钥必须在本站 active 索引 key 集合里）"]
    C -->|"不在"| E2["index_key_mismatch"]
    C -->|"不符"| E3["index_sig_mismatch"]
    C --> D["逐片验签 + 签名 seq = catalog 钉值"]
    D -->|"不符"| E4["index_generation_mismatch"]
    D --> F["验吊销清单 + 本地 seq 账本比代次"]
    F -->|"回退 / 同代替换"| E5["revocations_not_monotonic"]
    F --> G["落盘：public 用 --site 落 cdn/registry<br/>private 用 --out"]
    G --> H["推进本地 seq 账本"]
```

- 全程**不触网**：源已经挂了才需要这条命令，它只读本地文件、验签、落盘。
- 信任源是本地账本：`--keys` > `~/.ojm/registry/<origin>/index-keys.json`；取不到活跃 key 即
  fail-closed（`index_key_mismatch`）——没法离线判定「这把钥匙是不是 registry 的」就不能导。
- `--registry` 是**账本源标识**（多源各记各的 seq），不是仓库地址；缺省取 `source.json` 的 `origin`。

---

## 4. 查询与生命周期面

### 4.1 `ojm list`

```mermaid
sequenceDiagram
    autonumber
    participant CLI as ojm list
    participant S as 目标站点
    CLI->>S: POST /api/auth/login
    S-->>CLI: access_token
    CLI->>S: GET /api/_platform/market/index（Bearer）
    S-->>CLI: 索引行数组
    Note over CLI: 缺省只留 installed 非空，按 name 排序
    alt 空清单
        CLI-->>CLI: 「还没有已装方案」+ 指路 --all（exit 0）
    else 有行
        CLI-->>CLI: 表格 + 可升级 / 签名不受信 汇总行
    end
```

每列都取自站点聚合行，不在 CLI 现算：

```mermaid
flowchart LR
    subgraph Row["GET /_platform/market/index 行"]
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

`--all` 连未安装的行一起列（`installed` 显示 `-`）。清单为空仍是 exit 0：没装东西不是错误。

### 4.2 `ojm view`

```mermaid
flowchart LR
    A["ojm view @acme/demo"] --> B["CLI 校验目录键形态<br/>（裸 slug 直接拒：换算不可逆）"]
    B --> C["登录 → GET /api/oj-registry/packages/acme/demo"]
    C --> D["并排打印目录键 @acme/demo<br/>物理名 acme-demo<br/>建立时间"]
```

换算不可逆（`acme-x-demo` 可能来自 `@acme-x/demo` 或 `@acme/x-demo`），所以命令只接受目录键，不接受裸 slug。

### 4.3 `ojm trust`

| 子命令 | 作用 | 端点 |
|---|---|---|
| `ojm trust ls` | 列信任库（含 `.bak` 回落提示） | `GET /api/_platform/market/trust` |
| `ojm trust add <key_id> <pubkey_hex>` | 手工登记发布方公钥（首次绑定不可改，撞绑定 409） | `POST /market/trust/key` |
| `ojm trust revoke <key_id>` | 吊销信任库条目 | `DELETE /market/trust/key` |
| `ojm trust confirm --task <id>` | TOFU 确认（从任务记录重取公钥复算指纹） | `POST /market/trust` |

**这里管的是「发布方包体签名 key」**，不是 registry 的索引签名 key。索引 key 登记走
`POST /api/oj-registry/index/keys`（admin），CLI 目前没有对应命令——建站/换钥匙时按运维手册用 HTTP 登记。

### 4.4 `ojm enable` / `disable` / `uninstall`

```mermaid
flowchart LR
    A["enable / disable"] --> B["POST /market/enable {name, enabled}"]
    B --> C["四处同写：锁 / sidecar / 路由清单 / modules.json"]
    D["uninstall"] --> E["POST /market/uninstall {name}"]
    E --> F["四处同删 + 权限级联清理 + 版本目录移除"]
    F --> G["站点至少保留一个已锁模块"]
```

两者都不涉及仓库源：包已经在站点上，来源不影响删除范围，所以 `uninstall` 明确**不接** `--registry`
（给了即 exit 2 并说明原因）。

---

## 5. 退出码与信封

```mermaid
flowchart LR
    A["命令执行"] --> B{"参数形态错？<br/>缺 site-url / 缺凭据<br/>缺 --id / 结果无处可去"}
    B -->|"是"| E2["exit 2 · usage_error<br/>补参数能解决"]
    B -->|"否"| C{"域判定失败？<br/>验签 / 代次 / 摘要 / 站点报错"}
    C -->|"是"| E1["exit 1 · 稳定机器码<br/>CI 按 code 分支"]
    C -->|"否"| E0["exit 0 · code = ok"]

    E0 --> J["--json：stdout 只有一行信封<br/>ok / command / code / msg / data"]
    E1 --> J
    E2 --> J
```

`--json` 下 stdout 只有一行 JSON，人话一律走 stderr——`JSON.parse(stdout)` 永远成立。
信封的 `command` 是命令名（`install` / `list` / `registry export` / `registry sign` …），
`registry sign` 用 `data.kind`（`index` / `revocations`）区分两种产出。

`ojm install` 的终态另有语义层次：

| status | 退出码 | 含义 |
|---|---|---|
| `done` | 0 | 装完并冒烟通过 |
| `needs_trust` | 1 | 未知发布方，等人工 TOFU 确认（不是失败，但**没装完**） |
| `partial` | 1 | 锁后阶段失败，部分生效（包已落、注册/热更/冒烟未过） |
| `failed` | 1 | 锁前阶段失败，已清场 |

---

## 6. 四个常见组合

```mermaid
flowchart LR
    subgraph A["private 站点救站"]
        A1["export --site-url https://reg"] --> A2["import ./pkg --site 站点数据根 --keys active-key.json"]
    end
    subgraph B["发版（包体）"]
        B1["keygen"] --> B2["sign tgz --registry-id 站点"] --> B3["POST /packages（multipart tgz + .sig）"]
    end
    subgraph C["发版（索引 / 吊销）"]
        C1["POST /index/unsigned"] --> C2["registry sign"] --> C3["POST /index/signature"]
        C4["GET /cdn/revocations"] --> C5["registry sign --revocations"] --> C6["POST /revocations/signature"]
    end
    subgraph D["升级前确认"]
        D1["list --all"] --> D2{"可升级 / 签名不受信？"}
        D2 -->|"可升级"| D3["install name"]
        D2 -->|"不受信"| D4["trust add / trust confirm"]
    end
```

- 救站链：`export` → 拷到内网 → `import`。全程只有 export 那一步触网。
- 包体链与索引链都遵循同一条纪律：**私钥不进服务端**，服务端只做验签与落库。
- `list` 不在任何签名链上，它是升级前/卸载前的确认动作。
