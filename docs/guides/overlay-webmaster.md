# 站长须知：overlay 物化后的清单文件（≥ 0.2.97）

## 一句话

`modules.json` 和 `overlay-cache.json` 是**自动算出来的产物，不是配置**——手改会被下次
物化覆盖；要启停模块、换版本，走市场页或 `ojm` 命令。

## 三层真相（改状态请改对层）

| 层 | 载体 | 谁写 | 你能不能动 |
|---|---|---|---|
| 基线 | 源码树构建产物（dist 里源码模块的 entry/integrity） | `ojm build` / `ojm dev` | 不能——构建期逐字节生成，是 SRI 信任根 |
| 叠加层 | `sys_module_overlay` 表（模块名/版本/启用/操作人/序号） | 市场页启停、安装、卸载 | **改这里**（经市场页/API，勿直改库） |
| 物化层 | `<dist>/web/modules.json` + `modules/.solutions/overlay-cache.json` | site-materialize（唯一写者） | 不能——派生物，手改即丢 |

## 日常运维

- **启停/换版**：市场页开关，或 `ojm` 生命周期 API。DB 是唯一真源，文件自动跟。
- **崩溃窗**（DB 改了文件没改）：不用管——下一个市场页请求自动 catch-up 自愈，
  日志看 `site-materialize`（正常）与 `site-materialize-alarm`（连续失败 5 次，要人介入）。
- **断网构建拒写**（`fail-stale` 报错）：本机缓存序号落后已知 DB 序号，联网跑一次
  `ojm build` 或任一市场操作后重试。
- **别手改的文件**：`modules.json`、`overlay-cache.json`、`modules/<name>/<version>/` 下的
  `.ojm-module.json` 旁车。坏了的修法是重装该方案（`ojm install <name>@<version>`），
  不是编辑文件。

## 双名过渡期说明（一个版本周期）

打包红线 C2-31 正处于双名过渡：`overlay-cache.json`（新名）与 `modules.json`（旧名）
**都禁入方案包**。过渡期结束后会单名化收编，届时再看本文件更新。

## 回滚与故障处置

见 `docs/runbooks/overlay-rollback.md`（含混布窗口、CDN 验收、速查表）。
