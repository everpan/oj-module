# 交接：oj-market 本地 CDN 与市场链路

> 写给**下一个接手的人/代理**：读完这一份就能直接干活。历史论证在 `docs/plans/2026-10-20-ojm-cdn-market-playground-design.md`（设计+spike）、
> 施工记录在 `docs/plans/2026-10-21-0130-ojm-market-cdn-plan.md`（任务表+阶段小结）、
> 演练手册在 `docs/prd/framework-verification-playbook.md` §7.1–§7.4、教学文档在 `docs/devkit/module-dev-and-cdn-playground.md`。
> 本文不重复论证，只给**现状 / 代码地图 / 怎么跑 / 还差什么**。

## 1. 一句话现状

本地模拟 CDN（工程根 `cdn/` + `/cdn` 挂载）与 `ojm market` 六条子命令已打通，
真宿主上「开发方案模块 → 打包签名 → 发布 → 市场卡片 → 安装 11 段全 ok → 探活」两轮全绿；
版本 lockstep **0.2.13**，分支 `feat/ojm-market-cdn`（8 个提交，已并入 `feat/ojm`）。
**余量**：phase2 T12（neg-* 四条负面场景 + upgrade/rollback）未实现，骨架已就位。

## 2. 已交付（可直接用）

| 命令 | 作用 | 关键实现 |
|---|---|---|
| `ojm market setup` | 写 `framework.market_cdn_url`（首登改密闭环 + 绝对 URL） | `src/market/setup.ts` |
| `ojm market publish` | 合成 fixture 或 `--real` 真构建 → 确定性 tgz → 包级 `.sig`（**不碰索引**） | `src/market/publish.ts` + `fixture.ts` |
| `ojm market build-index` | 扫 `cdn/*.tgz` 提取内嵌 manifest，全量重建两份索引并签名 | `build-index.ts` + `scan.ts` + `index-builder.ts` |
| `ojm market verify` | 离线四类校验（完整性/包级签/索引签/manifest 结构）+ 漂移检出 | `verify.ts` |
| `ojm market trial` | 隔离站点试装，11 段全 ok ≈12s，跑完即毁（`--keep` 留现场） | `trial.ts` + `bootstrap.ts` |
| `ojm market walkthrough` | 隔离站点跑主链路 8 项出 AC 表，`--only` 单跑 | `walkthrough.ts` |

模板侧（`ojm init` 出的新工程自带，零手工补丁）：

- 工程根 `cdn/`（只提交 `README.md`）+ `api/config.yaml` 的 `- prefix: /cdn → web: ../cdn`
- `platform: {modules: [_platform], root: src}`（安装器 `reloadConfig` 特权）
- `fs: {root: ., readonly: false}`（安装器落盘面）
- `init.include.yaml` 收 `cdn/README.md`；`templates/.gitignore` 拦产物

## 3. 关键决策（别推翻，除非有更好的理由）

| 决策 | 内容 | 为什么 |
|---|---|---|
| **D-1** | publish 只落包，索引由 build-index **扫描全量重建** | 索引是共享单文件，增量合并会互相覆盖且 TOCTOU |
| **D-2** | 模板**直发** `/cdn` 挂载 + `cdn/README.md`，setup 不改写 mounts | oj 启动会校验挂载目录，缺失即 fail-fast；目录必须随模板发布 |
| **绝对 URL** | 市场地址必须 `http://127.0.0.1:9778/cdn`，端口取自 config | dev server 在 5174 只反代 `/api`；相对路径在 dev 下拿到 HTML |
| **release 形态安装** | 安装必须 `ojm build` + `--api-path dist` + `platform.root: dist` | 装到 `api/dist` 的模块在 dev（`--api-path src`）下不被发现 |
| **真实 config 起站** | 不要用 `ojm preview` 验证安装 | preview 服务派生 config，安装器热更改的是 `api/config.yaml` → 恒 `unchanged` |

## 4. 代码地图（`packages/cli/src/market/`）

| 文件 | 职责 | 别让它顺带做 |
|---|---|---|
| `cdn-layout.ts` | **单一真相**：cdn 目录 / 挂载前缀 / 基址（全取自 config） | 不做 IO、不签名 |
| `fixture.ts` | 合成最小合法方案树（name/version/manifest/routes/ping/migrations/web） | 不打包 |
| `publish.ts` | 编排：fixture 或 `--real` → 确定性 tgz → 包级签名 → 落盘 | 不碰索引 |
| `scan.ts` | tgz 读端（gunzip + 手写 ustar），取内嵌 manifest | 不聚合、不写盘 |
| `index-builder.ts` | 聚合 solutions/versions/latest + Form B（含 `archive.signature`） | 不解析 tar、不签名 |
| `build-index.ts` | 编排：扫目录 → 聚合 → 归一化 → 索引签名 → 写盘 | 不落包 |
| `verify.ts` | 离线四类校验 + 漂移；结论恒带边界声明 | 不起站点、不装 |
| `setup.ts` | 登录（含 must_change 闭环）→ 写 system 设置 | 不改 YAML |
| `bootstrap.ts` | 隔离站点：端口/DB/密钥/凭据/信任库/CDN 六项隔离 + cleanup + 信号防孤儿 | 不含 op 断言 |
| `trial.ts` / `walkthrough.ts` | 命令编排（op 注册表在 walkthrough） | 不重写 login/poll |
| `command.ts` | `ojm market <sub>` 参数面 | 不掺业务 |

复用纪律（改动前先看）：站点调用一律走 `src/site.ts`（`resolveSite/login/callApi/pollTask`）；
签名一律走 `src/sign.ts` 与 `src/lifecycle/sign.ts`；打包一律走 `src/deterministic-tar.ts`。
**禁止** `packages/cli/src` import `packages/cli/templates/**`（依赖方向红线；templates 只能运行期读文件）。

## 5. 怎么跑（本机实测路径）

```bash
# 0) 工具链：本机 PATH 无 node，用 fnm 里的 v22.18.0
export PATH='/Users/ever/Library/Application Support/fnm/node-versions/v22.18.0/installation/bin:$PATH'

# 1) 模板仓自身跑起来（首次需装 oj 二进制，它在 .gitignore 里）
cd packages/cli/templates && pnpm ojm vendor     # → bin/oj（v0.1.84）
pnpm --filter @oj-module/template-demo dev        # 5174 前端 + 9778 oj

# 2) 纯 CLI 链路（在任意宿主工程根）
OJM=packages/cli/bin/ojm.mjs
node $OJM market setup --url http://127.0.0.1:9778 --user admin --pass 123456 --new-pass <新口令>
node $OJM market publish --fixture demo-solution@0.1.0 --id demo.publisher --rebuild-index   # 需先 keygen 或给 --key
node $OJM market verify --rebuild-index
node $OJM market trial --fixture demo-solution@0.1.0        # 最省事：11 段全 ok ≈12s
node $OJM market walkthrough                                 # 主链路 8 项 AC 表
```

## 6. 验证口径（提交前跑这几条）

```bash
export PATH='/Users/ever/Library/Application Support/fnm/node-versions/v22.18.0/installation/bin:$PATH'
node node_modules/vitest/vitest.mjs run --config packages/cli/vitest.config.ts --silent   # 289 passed / 1 skipped
node node_modules/vitest/vitest.mjs run tests/cli/release-manifest.test.ts tests/cli/devkit-docs.test.ts tests/cli/package-guards.test.ts --silent  # 26 passed
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json                            # 净
node node_modules/eslint/bin/eslint.js packages/cli/src/market packages/cli/src/build.ts  # 净
```

> 根套件另有 2 个**存量**失败（`tests/shell/no-fake-in-dist` / `tests/cli/prod-importmap`），原因是 `build/` 未构建，
> 跑 `pnpm build:framework` 后即过——与本期改动无关，别去改它们。

## 7. 已知坑（详情见 playbook §9，新增代码前请扫一眼）

1. `oj build` 只收 `.ts` handler；`.js` 静默丢弃（`routes.js` 空表）
2. `manifest.tables` 必须与 `schema.yaml` 对齐，否则 `oj build` 直接失败
3. manifest 引用 i18n key ⇒ 必须 `web/src/<name>/locales/{zh-CN,en-US}.json`，且 key **嵌套**
4. 安装 POST 返回 200 但 task 恒 404 ⇒ 宿主缺 `fs:` 段（0.2.13 起模板自带）
5. 安装卡 preflight「无法读取宿主 runtime 版本」⇒ `api/dist/versions.json` 缺失（0.2.13 起 `ojm build` 双写）
6. 安装卡 reloading `NotCapable ... not platform-privileged` ⇒ 缺 `platform.modules`
7. 安装卡 reloading `unchanged` ⇒ 用了 `ojm preview`（派生 config），改用真实 config 起站
8. 安装卡 smoke 404 ⇒ dev 形态（`--api-path src`），装好的模块在 `dist`
9. 安装卡 smoke 401 ⇒ 方案声明了 `api.anonymous`，`anonymous_paths` 需重启才生效（trial 站点已预置）
10. 深检 `ledger.stale` 是**存量误报**（`_oj_migrations` 未进 schema，取不到 head）——不要据此改安装逻辑

## 8. 还差什么（T12，建议下一步就做）

`walkthrough.ts` 的 op 注册表已就位，补四个 op 即可（每个 op 自己 setup → act → assert → cleanup）：

| op | 做法 | 断言 |
|---|---|---|
| `neg-tamper` | 翻转 `cdn/<pkg>.tgz` 一个字节（先备份） | 安装 `failed`/`partial` 且 `stage=verifying`，零落盘 |
| `neg-nosig` | 删 `.tgz.sig` 后重建索引 | 失败信息含 `sig_missing` |
| `neg-badindex` | 向 `bundles.yaml` 追加字节 | 索引验签失败拒装 |
| `neg-stranger` | 用未登记 key 重签 + 重建索引 | `needs_trust` → `trust confirm` → 重装 done |

另外两个主链路 op：

- `upgrade`：先装 0.1.0，再发布 0.2.0 并安装 → 断言锁与 `state.yaml` 版本推进、`0001` 迁移逐字节一致
- `rollback`：装 0.1.0 时账本已超前 → 断言 `failed@migrating` 且零副作用（AC5 口径）

实现注意：负面 op 篡改的文件必须在 `finally` 里**回抄原始字节**（不要重签），否则后续 op 全挂。

## 9. 环境与协作注意

- 本机无 node 在 PATH：所有命令前加 §5 的 `export PATH=...`；`git commit` 的 pre-commit 钩子也需要它（否则报 `npx: command not found`）
- `packages/cli/shell-dist/` 与 `packages/cli/devkit/` 是**构建产物**（被 gitignore）：改 devkit 请改 `docs/devkit/` 再 `cp` 过去
- 版本 lockstep：`packages/runtime/package.json`、`packages/cli/package.json`、`shell-dist/versions.json`、`vendor/host-versions.json` 四处同号，改一处要全改（`tests/cli/package-guards.test.ts` 守着）
- 提交信息走 conventional commit；`docs/plans` 下的日期前缀文档是施工记录，别删
