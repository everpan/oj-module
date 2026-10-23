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
| `bundles.yaml` / `manifests.yaml` 及其 `.sig` | ❌ 产物 |

## 生产怎么切出去

1. 删掉工程根 `config.yaml` 的 `mounts` 里这条（它就是本地挂载的全部）：

```yaml
  - prefix: /cdn
    web: ./cdn
```

2. 把真 CDN（对象存储 / nginx）的**绝对地址**写进系统设置 `framework.market_cdn_url`；
   命令行等价写法是 `ojm market setup --url <地址>`。
3. 索引（`bundles.yaml` / `manifests.yaml`）由 CDN 侧维护：`ojm market build-index` 在本地产出后自行上传。

## 签名与校验口径

- **包级（信任锚）**：每个 `<name>-<version>.tgz` 配一份 detached `.tgz.sig`，Ed25519，由发布方私钥签署。
  安装时逐字节校验，验不过即拒绝安装（fail-closed）。
- **索引级（只做完整性）**：`bundles.yaml` / `manifests.yaml` 各自一份 `.sig`，用于发现目录或索引被篡改；
  **它不是信任锚**——陌生发布方的取舍由信任库决定。
- **时效性**：服务端响应不带缓存头（只有 ETag），因此拉取索引**必须**由请求侧带 `cache-control: no-cache`。

## 陌生发布方（TOFU）

首次遇到未登记的发布方 key，安装会停在待信任状态，由管理员确认后才写入信任库；
信任库遵循**首次绑定不可改**（再次绑定同一个 key_id 会被拒绝）。
