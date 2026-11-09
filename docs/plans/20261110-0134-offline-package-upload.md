# 离线包上传——内网手动上传升级方案（round 3）

- 日期：2026-11-10 01:34
- 分支：`feat/ojm-offline-upload`（自 `feat/ojm` 切出，完成后 `--no-ff` 并回并删）
- 前置：bump 0.2.81（lockstep 三文件）先行提交 `feat/ojm`

## 0. 需求原话与解读

> bump version；实现新需求，可让拥有指纹的用户，手动上传对应指纹产品的开发包，用于在内网模式的一种手动上传包升级方案。

解读：内网模式发布方私钥不出安全区，包在外签好由运维带入。运维持有**已签分发包（tgz + .sig 旁车）**却无私钥——现 `cdn/upload` 的鉴权锚是推送者私钥（`X-OJM-*` 头签名），包送不进目录。需要一个页面入口把已签包送进站点目录（`cdn/` + `market_release` 行），之后安装/升级照走既有 cdn 源十阶段管线。

## 1. 定界结论（AskUserQuestion 三答案）

| 问题 | 结论 |
|---|---|
| 方案锚点 | **B：发布管理页「离线包上传」区 + 新端点 `POST /api/oj-market/upload`（superadmin）**，一次入库，后续装/升走 cdn 本地源 |
| 未审指纹 | **允许未审指纹入库**——目录 ≠ 信任，安装才是信任闸（verify unknown_key → needs_trust → 页面审核）；`trusted` 字段如实暴露 |
| CLI 面 | **不做**；浏览器页面即可，CLI file 源安装已覆盖纯装包场景 |

## 2. 调研结论

| 面 | 现状 |
|---|---|
| CLI 安装 | `ojm install <本地.tgz>` file 源已有：multipart tgz + 同目录 `.sig` → 十阶段 → 轮询终态 |
| 验签 | verify 段六码分流；`sig_missing` 双源硬 fail-closed；unknown_key → needs_trust（round 2 页面审核口径） |
| 发布推送 | `POST /oj-market/cdn/upload`：匿名 + 头签名鉴权；sig 先行 pair → 旁车与实收字节绑定验签（服务端重算 sha256 重构 canonical）→ name 所有权 → 同版本幂等/异字节 409 不碰盘 → manifestOfUpload（R1 三步 + REG-CS8）→ 原子落盘 → db.tx 写行 → 审计 |
| 目录自愈 | `POST /market/backfill` 扫 cdn/ 重建行（要求文件已在服务器 FS） |
| UI | 发布管理页只有凭证表 + 信任审核区，**零上传面** |

**缺口**：① 入库面断私钥（内网运维送不进目录）；② UI 无上传入口。

## 3. 设计

### 3.1 端点 `POST /api/oj-market/upload?name=<name>-<version>.tgz`（superadmin）

multipart 双文件（oj http 面不透出文件名——cdn 先例 query 传名 + files 顺序约定）：
`files[0]` = tgz 字节、`files[1]` = `.sig` 旁车字节。

处理序（**钉死**，全部复用既有件；新逻辑只有「superadmin 鉴权锚 + trusted 探测」两处）：

1. `assertSuperAdmin()`
2. `parseUploadFile(query.name)` 白名单（须 `sig:false`），非法 400
3. 双文件闸：`http.files.length < 2` → 400 人话；tgz 超闸 413（`MAX_PACKAGE_BYTES` 单源）
4. `parseSidecarSig(sigText)` 五字段结构，非法 400
5. 服务端重算 sha256 → `verifyCanonicalSig(sig.public_key, packageCanonicalOf(sig.registry_id, name, version, sha256), sig.value)` → false 409「旁车与包体不绑定」（终审 I2 语义；canonical 首段 = 旁车自带签发方身份，与站点 registry_id 无关）
6. 查库同 name+version：同字节 → 幂等 heal 补缺双文件 + 200 `{idempotent:true}`；异字节 → 409 **不碰盘**
7. name 所有权：既有行 key_id 非 NULL 且 ≠ `sig.key_id` → 409（换主 = superadmin 操作；事务内复核同 cdn）
8. `manifestOfUpload`（staging 抽 manifest；坏包/zip-slip/体积闸在此拒）；`m.name/m.version` 与文件名不一致 400
9. `trusted = await createTrustStore(env.trustPath).get(sig.key_id) !== null`——**未审照样入库**
10. `atomicWriteBytes` 落 `cdn/<name>-<version>.tgz` + `.sig` 双文件
11. `db.tx` 写 `market_release` 行（`published_at_source: "upload"`，sig_* 五字段照抄 cdn 语义）
12. `recordHistory(action:"publish", operator = 登录人)`，message 注明「离线上传」+ trusted 状态

响应 200：`{ ok, name, version, sha256, size, key_id, fingerprint, trusted, idempotent }`（fingerprint = sha256(sig.public_key)，供 superadmin 与信任审核/凭证表逐字核对）。

错误码：400（缺文件/文件名/旁车结构/manifest 不一致/坏包）、403（非 superadmin）、409（不绑定/异字节/所有权）、413（体积闸）。全走 `respond` 收口。

实现落位：新文件 `oj-market/api/upload.ts` 导出 `uploadPackageBody(env)`（api.ts import——非路由入口件，同 backfill.ts 纪律）；路由组 `"upload"` 挂 `createMarketApi`；契约 `marketApi.upload.post.schema`（query name 必填；出参宽松）。

### 3.2 Web（发布管理页「离线包上传」区）

新组件 `publish/pages/offline-upload.tsx`（`OfflineUploadSection`），挂凭证表与信任审核区之间（或凭证表下方、信任审核上方）：

- 两个 Upload（beforeUpload return false 手动收集）：tgz + .sig 各一个；前端预校验文件名 `<name>-<version>.tgz` 与 `<同名>.sig` 一致才放行
- 提交 → `client.uploadPackage({ name, tgz, sig })`（defaultClient 手写 FormData multipart POST，append 顺序 [tgz, sig]——生成器 __client 只会 JSON body，multipart 不经它）
- 成功渲染：`name@version` + 发布方 key + 指纹（code copyable）+ `trusted` Tag（已入库=绿 / 未入库=橙 warning「安装时将停待信任确认，审核后重试」）+ idempotent 提示；失败 Alert errorText

类型：`types.ts` 增 `UploadPackageResult`；`client.ts` 增 `uploadPackage`；fake 增 `uploadPackageResult/uploadPackageError` + calls 记录。

### 3.3 安全锚小结

门禁人（superadmin 登录）+ 包身份（旁车 Ed25519 与实收字节绑定）双锚；信任判定不在此层（安装 verify 兜底，TOFU 闭环照旧）。匿名面零扩大（走登录态 Bearer）。审计落 `market_history`。

### 3.4 非目标（有意裁剪）

- CLI 命令（`ojm market upload`）——用户拍板不做
- 上传即生成信任审核项——信任审核列表仍来自安装任务；未审包入库后靠安装触发 TOFU
- 驳回/删除目录行、断点续传/分片、多包批量、registry 源替代——均不动

## 4. 任务清单

- [x] T0 bump 0.2.81：`packages/cli/package.json` + `packages/runtime/package.json` + `vendor/host-versions.json`（3 行 runtime），`chore(release): 0.2.81` 落 `feat/ojm`
- [x] T1 切分支 + 本计划文档
- [x] T2 服务端 TDD：`tests/lifecycle/upload-package.spec.ts` 红 → `upload.ts` 实现 → 绿
- [x] T3 web TDD：fake + `OfflineUploadSection.test.tsx` 红 → 组件/client/defaultClient/types/locales → 绿
- [x] T4 契约链：`oj openapi -c config.yaml --module-root src -b /api -o openapi.json` → `eslint --fix` → `ojm api` → `ojm build` → 漂移守卫双绿
- [x] T5 文档：manual §11.2 邻域 / publish-walkthrough / solution-dev-build-publish / OPERATIONS（devkit 双份 sync，产物不提交）
- [x] T6 全门禁矩阵 + 并回 `feat/ojm`（`--no-ff`）+ 删分支 + 本文总结

## 5. BDD 用例

### 服务端 `tests/lifecycle/upload-package.spec.ts`

| # | 前置 | 动作 | 期望 |
|---|---|---|---|
| 1 | key A 在信任库；A 签合法 pair | superadmin 上传 | 200；行落库（sha256/size/key_id/sig_* 五字段）；cdn/ 双文件在；`trusted:true`；fingerprint=sha256(pk) |
| 2 | key B 不在信任库 | superadmin 上传 | 200 `{trusted:false}`；行照落 |
| 3 | 登录 user.id=2 | 上传 | 403 |
| 4 | 只传 1 个文件 | 上传 | 400 人话 |
| 5 | `?name=` 非白名单形态 | 上传 | 400 |
| 6 | 换 tgz 字节（sig 仍旧字节签） | 上传 | 409；cdn/ 无痕（不碰盘） |
| 7 | 行已存在同字节 | 重传 | 200 `{idempotent:true}` + heal 补缺 |
| 8 | 行已存在异字节 | 重传 | 409 |
| 9 | 既有行 key_id=A，以 B 的 pair 上传 | 上传 | 409 所有权 |
| 10 | manifest.name 与文件名不一致 | 上传 | 400 |

### web `OfflineUploadSection.test.tsx`

| # | 场景 | 期望 |
|---|---|---|
| 1 | fake `trusted:true` | 提交后渲染 name@version + 「已入库」tag + 指纹可见；calls 含 `uploadPackage` |
| 2 | fake `trusted:false` | 「未入库」warning tag + 待信任提示渲染 |
| 3 | fake 抛错 | Alert errorText 渲染 |

## 6. 问题记录

| 类 | 记录 |
|---|---|
| 反常规 | oj http 面不透出 multipart 文件名（cdn 先例 query 传名）；双文件只能靠「query.name 解析 tgz 名 + files 顺序 [tgz, sig]」约定——前端 FormData append 顺序即协议 |
| 反常识 | `packageCanonicalOf` 首段用**旁车自带** registry_id（签发方身份），与本站点 registry_id 无关（跨站签发合法）——上传端点因此无需读站点 registry_id |
| 部署注记 | oj `server.max_upload_bytes` 默认 10MB：大包上传需部署面调该值（同 cdn/upload 的反代 body cap 责任面） |
| 工具坑（沿用） | templates vitest config 在 `packages/cli/templates/vitest.config.ts`（仓根跑）；openapi 必须 `-c config.yaml --module-root src` 双参齐 + `eslint --fix` 归一 tab；`ojm build` 产物落 `templates/dist/api/` |

## 7. 总结

- **关键过程**：服务端 TDD 12 例红 → `upload.ts`（对齐 backfill 输入接口纪律 + cdn 行写语义）一次实现转绿；web TDD 4 例红 → 组件/client/defaultClient/fake/locales 转绿；契约链四步（`oj openapi` 净增 50 行 + `eslint --fix` 归一 tab → `ojm api` 重写 2 文件 → `ojm build`）漂移守卫双绿。bump 0.2.81 触发宿主矩阵漂移，`pnpm --filter @oj-module/cli build:shell` 重建后 `ojm build` 过闸（版本纪律：runtime 升版必须重建宿主再 build）。
- **有意不动**：oj-market 方案版本维持 0.2.4（惯例：随 `chore(release)` 出厂才 bump，0.2.80 与 round 1/2 同例）。
- **耗时**：01:34 计划落盘 → 01:53 全门禁绿，约 20 分钟。
- **门禁终值**：根 1019 ✓（+1 skipped）/ templates 1231 ✓ / cli 678 ✓（+1 skipped）/ 契约漂移守卫 2 ✓ / eslint 0 错（`login.tsx` 3 个预存 warning 非本轮）/ 根 + templates tsc 0。
- 遗留注记：真机浏览器未走查（组件 4 例单测覆盖 + 服务端 12 例）；`server.max_upload_bytes` 默认 10MB 是部署面参数，大包需调值（已写入 OPERATIONS §3.4）。
