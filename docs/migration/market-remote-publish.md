# 迁移指南：市场远程发布与 DB 目录（0.3.0）

适用：从「文件索引市场」（`ojm market build-index` + `catalog.yaml`/shards 时代）迁移到
「DB 目录 + 远端签名推送」。旧 CLI / 旧站点的组合行为见文末 2×2 矩阵。

---

## 1. 变了什么（一句话）

市场目录的真源从 **CDN 上的索引文件**（`catalog.yaml` + `shards/*.yaml`，需人工重建签名）
换成**站点自己的数据库**（`market_release` 表）：发布 = 签名推送两件（`.sig` 旁车 + `.tgz`）
到站点上传端点，服务端配对成功直写目录行；安装解析直读目录行。索引文件、`build-index`
命令、纯静态 OSS 桶市场源整建制退役。

## 2. 检测当前形态

| 检测 | 命令/现象 | 结论 |
|---|---|---|
| 站点形态 | `curl <站点>/api/oj-market/catalog?page=1&size=1` | 200（信封 `code:0`）= DB 目录版；404 = 旧版（文件索引） |
| CLI 形态 | `ojm market publish --help` 里有 `--site-url` | 有 = 新版（远端推送）；只有 `--rebuild-index` = 旧版 |
| 组合探测 | 新 CLI 对旧站点推送 | 人话报错「站点版本过旧（无 /api/oj-market/catalog）」+ 指向本指南 |

## 3. 迁移步骤（站点管理员）

1. **备份**：`cp db.sqlite db.sqlite.bak`（目录真源 = 库；备份只覆盖 sqlite，配置/字节另算）。
2. **升级站点**：用新模板发布站点——`0003__market_catalog.sql` 迁移随站点升级自动应用
   （对既有 `market_release` ALTER 扩 `sig_alg/sig_value/sig_public_key/manifest` 四列，
   同 0002 机制）。**升级时顺手删除站点 `cdn/catalog.yaml`、`cdn/shards/`**——旧 CLI 见到
   残留索引会「静默陈旧」（停在本升级瞬间的快照），删掉让它显式报错而非半工作。
3. **配 registry_id**：站点 `config.yaml` 的 `vars` 增加 `registry_id: <站点身份>`
   （签名 canonical 首段 = 站点身份，防跨站重放；推送/下线都依赖它）。**改 config 须重启**
   （启动冻结段）。
4. **匿名面**：`auth.anonymous_paths` 与 `tenant.anonymous_paths` 增加
   `/oj-market/catalog/**`、`/oj-market/cdn/upload` 与 `/oj-market/yank`
   （新模板自带；老工程手工补，**重启生效**。yank 同签名制——漏列则 oj-auth 守卫在
   handler 前硬 401，签名下线永远到不了处理器）。
5. **回填存量**：升级后跑一次 `curl -X POST -H 'Authorization: Bearer <superadmin token>' \
   <站点>/api/oj-market/backfill`——扫描 `cdn/` 存量 tgz + 旁车 .sig，upsert 目录行
   （幂等可重入，兼作灾备恢复与对账）。`.sig` 缺失的存量包照常入库但签名四列为 NULL，
   安装时 `sig_missing` 拒装（fail-closed）——要可装须先补 `.sig`。
6. **迁移信任库**（**最重一句**）：把旧市场源（纯静态桶/旧站点）的
   `.solutions/trusted-keys.yaml` **原样**放到新站点同路径。**key_id 不能断**——目录行与
   `.sig` 旁车都按 key_id 关联信任库，换库/改 key_id 等于全部历史包的验签锚被拔，
   已装方案升级、重装全崩。key 的增删照旧走 `ojm trust add/revoke` 或市场信任页。

## 4. 发布方（CLI 用户）要改什么

| 旧习惯 | 新命令 |
|---|---|
| `ojm market publish --real . --rebuild-index`（落本地 cdn/ + 重建索引） | `ojm market publish --real . --site-url <站点> --id <key> --registry-id <站点 registry_id>` |
| `cp dist/*.tgz* cdn/ && ojm market build-index` | 同上一条（多方案工程先 `ojm build --bundle <name>` + `ojm sign`） |
| `ojm market verify --rebuild-index` | `ojm market verify --file dist/<name>-<version>.tgz`（验单包） |
| 下线 = 删文件/改索引 | `ojm market yank <name> <version> --site-url <站点> --id <key>`（`--restore` 恢复） |

推送/下线的鉴权不经账号口令：`X-OJM-Key-Id`/`X-OJM-Signature` 头 + 站点信任库 + Ed25519。
目标站点须先信任你的 key（`ojm trust add` 或市场信任页），否则 403。

## 5. 回滚口径

- **升级后回滚旧站点**：`cdn/` 索引文件已按 §3.2 删除 → 旧站点须重新跑旧 CLI
  `ojm market build-index` 收编（升级后经新端点上传的包，旧站点只有字节没有索引）。
- yank 只写 DB 行：回滚后 yanked 版本「复活」可见——回滚窗口内注意核对待装列表。
- 回滚再升级：重跑 backfill 对账即可（幂等）。

## 6. 2×2 兼容矩阵

| | 旧站点（文件索引） | 新站点（DB 目录） |
|---|---|---|
| **旧 CLI** | 现状（遗留索引若被删则报索引缺失） | 静默陈旧：残留 catalog.yaml 使它停在升级瞬间快照；删残留 → 显式报错 |
| **新 CLI** | 目录探测 404 → 「站点版本过旧」人话 + 指向本指南 | 目标态：签名推送 / yank / verify --file |

## 7. 纯静态 OSS 桶市场源

`framework.market_cdn_url` 指向纯静态桶（无站点 API）的模式**退出支持**：新版安装解析
直读站点目录库，桶里没有库。迁移 = 按 §3 搭 oj 模板站点接管该桶的 `cdn/` 字节 + 回填。
