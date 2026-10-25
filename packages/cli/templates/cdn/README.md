# cdn/ —— 本地模拟市场源

本目录是**本地模拟 CDN**：`ojm market publish` 把分发包落在这里，站点通过工程根 `config.yaml` 里的挂载
（`- prefix: /cdn` → `web: ./cdn`）把它直出成分发源。市场按系统设置 `framework.market_cdn_url` 读取，
**seed 缺省值即相对路径 `/cdn`（本站点自供），新工程免 `ojm market setup`**；指向外部真 CDN 时才改设置。

> **目录缺失会让站点起不来**：`oj serve` 启动即校验挂载目录，缺失就报错退出。
> 所以本 README 进模板、进发布包、进新工程——它的存在就是目录存在的理由，**不要删**。

## 这是本地模拟源，不是生产 CDN

- 服务于本地开发与演示：想看市场卡片、想走一遍安装链路，就用它。
- 目录与挂载都随模板发布，`ojm init` 出的新工程自带可用。
- 目录里没有包也没关系：空目录只意味着市场页暂时没有卡片。

## 进仓边界

| 类型 | 是否进仓 |
|---|---|
| 本 README | ✅ 唯一进仓的文件 |
| `<name>-<version>.tgz` 及其 `.tgz.sig` | ❌ 产物 |
| `catalog.yaml` / `shards/<n>.yaml` 及其 `.sig` | ❌ 产物 |

## 索引布局（REG-CS5 三级化）

发布面（`ojm market build-index` / `ojm publish`）落盘三件套，读面按同一布局消费：

```
catalog.yaml        总目录（提交点）：{seq, issued_at, expires_at,
                   shards: {<片号>: <代次钉值>}, solutions: [{name, shards: [<片号>...]}]}
                   ——只记「包名 → 分片号」与代次/时效，无版本明细
shards/<n>.yaml     分片（纯内容无 meta）：{solutions: [{name, latest,
                   versions: [<Form B 条目>]}]}——版本条目即 manifest，
                   新版本进新高片（装箱）；byte 相同的分片可跨代复用
```

- 每份索引各配一份 detached `.sig`，Ed25519，**签名覆盖 `(kind, seq)`**——换文件种类或换代都验不过。
- 安装侧读 `catalog.yaml` → 按包名拿分片号 → **只拉命中那片**（latest 安装 ≤ 1 catalog + 1 shard）；
  市场页要 `available` 全集，才拉 catalog 指向的全部分片。
- 同代校验是**钉值**口径：分片签名 seq 必须等于 catalog 对该片的钉值，不等即拒（`index_generation_mismatch`，
  提示源在重建索引）——不是恒等于 catalog 代次。

## 缓存口径（读面）

- 挂载带 `Cache-Control: max-age=60, stale-while-revalidate=60`（见工程根 `config.yaml`）：
  60s 新鲜窗口 + 60s 陈旧可用窗口——yank 最坏 120s 生效（Q8）。
- oj 静态层原生支持 ETag / If-None-Match → 304：读取器第二轮起发条件请求，未变则不重传正文。
- **读取器不再发 `cache-control: no-cache`**（旧口径已删）：新鲜度由服务端缓存头 + 条件请求承载，
  索引自身的 `expires_at`（过期即拒）与 `seq` 水位（防回放）仍是硬闸。

## 生产怎么切出去

1. 删掉工程根 `config.yaml` 的 `mounts` 里这条（它就是本地挂载的全部）：

```yaml
  - prefix: /cdn
    web: ./cdn
    headers:
      Cache-Control: "max-age=60, stale-while-revalidate=60"
```

2. 把真 CDN（对象存储 / nginx）的**绝对地址**写进系统设置 `framework.market_cdn_url`；
   命令行等价写法是 `ojm market setup --site-url <地址>`。
3. 索引（`catalog.yaml` / `shards/*.yaml`）由 CDN 侧维护：`ojm market build-index` 在本地产出后自行上传。
   真 CDN 侧自行配等价缓存头与 ETag（对象存储默认带 ETag；nginx 可复用上面的 Cache-Control 值）。

## 签名与校验口径

- **包级（信任锚）**：每个 `<name>-<version>.tgz` 配一份 detached `.tgz.sig`，Ed25519，由发布方私钥签署。
  安装时逐字节校验，验不过即拒绝安装（fail-closed）。
- **索引级（只做完整性）**：`catalog.yaml` / `shards/<n>.yaml` 各自一份 `.sig`，用于发现目录或索引被篡改；
  **它不是信任锚**——陌生发布方的取舍由信任库决定。
- **fail-closed**：索引缺签名/签名不符/跨文件不同代/结构破损，一律拒载（502），不降级、不静默跳过。

## 陌生发布方（TOFU）

首次遇到未登记的发布方 key，安装会停在待信任状态，由管理员确认后才写入信任库；
信任库遵循**首次绑定不可改**（再次绑定同一个 key_id 会被拒绝）。
