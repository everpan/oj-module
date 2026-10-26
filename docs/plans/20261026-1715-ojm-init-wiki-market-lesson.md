# 计划：ojm init 脚手架 + wiki 方案市场发布全链路验证（教案素材）

- 日期：2026-10-26 17:15
- 分支：`docs/20261026-wiki-market-lesson`
- 产出：一份可复现的教案（docs/guides/），记录从 `ojm init` 到「wiki 方案包发布进脚手架工程市场并安装验证」的完整过程。

## 背景与目标

以本仓 CLI（0.2.42）为工具链，完成以下链路并全程留痕：

1. `ojm init` 搭一个空白脚手架工程（宿主工程 = 市场消费方）。
2. 以 `../oj-wiki`（wiki 解决方案，solution.yaml: name=wiki, version=0.1.3）为发布方，`ojm build --bundle` 打方案包。
3. 把方案包发布进**脚手架工程自己的市场 CDN**（`ojm market publish --real` + `ojm market build-index`，含 Ed25519 签名）。
4. 起脚手架站点，`ojm install wiki@0.1.3` 经市场源安装（含 TOFU 信任确认），并验证终态。

## 关键事实（侦察结论）

| 项 | 结论 | 出处 |
|---|---|---|
| 本地 ojm 入口 | `node packages/cli/bin/ojm.mjs`（spawn tsx 加载 src TS） | packages/cli/bin/ojm.mjs |
| 种子超管 | `superadmin / 123456`（admin 已被解绑 superadmin 角色，写市场安全设置会 403） | packages/cli/src/market/bootstrap.ts:41 |
| 市场 CDN 缺省 | seed `framework.market_cdn_url=/cdn` = 站点自供，免 `ojm market setup` | templates/src/_platform/api/seed.sql:28 |
| 强制验签 | 未签名包拒装（sig_missing）；未知发布方走 TOFU（needs_trust → `ojm trust confirm --task <id>`） | packages/cli/src/install.ts:100-144 |
| oj 二进制 | init 联网下载 everpan/only-js release；本机已有 0.1.86（oj-wiki/bin），可预置跳过下载 | packages/cli/src/init.ts:§3 |
| 依赖供给 | verdaccio 未运行；脚手架 package.json 的 `@oj-module/*` 改用 pnpm `file:` 指向本仓 packages/*（runtime 已有 dist 产物） | ~/.npmrc scope 映射 + packages/runtime/exports |
| oj build | `ojm build` 已内置 `--no-minify`（swc minify bug 绕过） | packages/cli/src/build.ts:569-584 |
| 双仓纪律 | oj-wiki 侧所有命令必须单条内显式 `cd /Users/ever/git/only-js/oj-wiki &&` | memory: oj-wiki-project |
| e2e 端口纪律 | 9781/9782 被 lifecycle 演练硬占，站点端口避开 | memory: lifecycle-verification-setup |

## 用例（BDD）

### UC1 脚手架 init
- **Given** 空目录 `~/git/only-js/ojm-lesson-scaffold`
- **When** `ojm init <dir> --yes`
- **Then** 产出 src/<name>/{api,web} 布局、config.yaml+config/ 证书、seed.sql、package.json、bin/oj（≥0.1.86 过能力闸门）
- **And** `pnpm install`（file: 覆盖）+ `ojm info` 成功

### UC2 wiki 方案打包
- **Given** ../oj-wiki 工程（solution.yaml name=wiki version=0.1.3）
- **When** `cd oj-wiki && pnpm bundle`（= ojm build --bundle）
- **Then** 产出 `dist/wiki-0.1.3.tgz`（确定性 tgz，含 manifest 结构）

### UC3 发布进脚手架市场
- **Given** 脚手架工程（cwd = 脚手架根）
- **When** `ojm keygen --id lesson.pub --yes` → `ojm market publish --real ../oj-wiki --id lesson.pub` → `ojm market build-index --id lesson.pub`
- **Then** `cdn/wiki-0.1.3.tgz{,.sig}` 落盘；`cdn/catalog.yaml` + `cdn/shards/0.yaml` 重建并签名
- **And** `ojm market verify --rebuild-index` 全绿

### UC4 市场源安装 + 信任
- **Given** 脚手架站点已启动（ojm dev，端口避开 9781/9782）
- **When** `ojm install wiki@0.1.3 --site-url <u> --user superadmin --pass 123456`
- **Then** 首次因未知发布方进入 needs_trust；`ojm trust confirm --task <id>`（站点侧，superadmin）后重跑 install 成功
- **And** `ojm list` 显示 wiki 0.1.3 已装/已启用；`GET /wiki/status` 匿名可访问且 ok=true

### P4（环境约束）`ojm install` 前站点必须配 `vars.canonical_origin`（REG-CS6 fail-closed）

- 缺省报 503：相对市场基址 /cdn 补全、深检探针都要权威 origin，且**绝不读请求头 Host**（防伪造 Host 牵引出站）。本地演练填 `http://localhost:<port>`；换端口必须改值重启。
- 连带约束：签名时的 `--registry-id` 在站点未配 canonical_origin 时被跳过比对（steps/verify.ts:201「env.registryId 未配置则跳过此比对」此处 env 指站点身份）——本教案 lesson.local 占位可通过；生产指向外部 registry 时必须等于该站 canonical_origin。

### P5（环境约束）安装/冒烟验证必须 `ojm build` + `ojm preview`，`ojm dev` 不行

- C2-09 预检从**磁盘** `<sharedRoot>/versions.json`（release 根 = `dist/api/`）读宿主 runtime 版本——dev 形态没跑过 build 时文件不存在，fail-closed 拒装。
- 即使预检绕过了，`ojm dev` 的 oj serve 只供给 `src`（--module-root），安装器写入 `dist/` 的 wiki api 不在服务面，冒烟探针 `/api/wiki/status` 恒 404。**release 布局（ojm preview）才是市场安装链路的验证形态**（lifecycle e2e 同此口径）。

## 任务

| # | 任务 | 状态 |
|---|---|---|
| T1 | 分支 + 本计划文档 | ✅ |
| T2 | UC1 脚手架 init + 依赖安装 + ojm info | ✅ 17:15–17:19 |
| T3 | UC2 oj-wiki 打包 | ✅ 17:22（dist/wiki-0.1.3.tgz，835056 B，sha256 4a6beb33…） |
| T4 | UC3 keygen + market publish + build-index + verify | ✅ 17:22–17:25（含 P1 修复，verify 7 项全绿） |
| T5 | UC4 起站 + install + TOFU 确认 + 终态验证 | ✅ 17:25–17:31（preview 形态；list=trusted、/api/wiki/status ok、/wiki/space 200） |
| T6 | 教案定稿（docs/guides/）+ 计划收尾总结 | ✅ |

## 总结（2026-10-26 17:35 收尾）

全链路按 UC1–UC4 验收通过，关键过程与耗时：

1. **脚手架（~4 min）**：`ojm init` 联网装 oj 0.1.87（248 文件）；依赖走 verdaccio（`~/.npmrc` scope 映射，storage 已有 0.2.42）——file: overrides 因 catalog:/workspace: 协议出界不可行（P2）。
2. **打包（~1 min）**：oj-wiki `pnpm bundle` 出 wiki-0.1.3.tgz，确定性哈希与 `market publish --real` 重打一致（4a6beb33…）。
3. **市场发布（~3 min）**：keygen → publish（--registry-id 必填，P3）→ build-index → verify。**途中修复工具链 bug 一枚（P1，REG-CS8 自伤）**：`market verify` 把契约 C2-29 可选的 archive 当必填，真实工程包必红；TDD 修复后市场套件 98 项绿。
4. **安装验证（~8 min，大头在排错）**：dev 形态连踩 P4（canonical_origin 503）、P5（versions.json 缺 / 冒烟 404）两坑；切 `ojm build` + `ojm preview` 后一次通过。TOFU 信任确认指纹与 keygen 公布值逐字一致（6ab94df2…50）。
5. **终态**：`ojm list` → wiki 0.1.3 enabled/trusted；匿名 `/api/wiki/status` → ok=true；`/wiki/space` 与模块 entry.js 均 200。

**遗留**：① verify.ts 修复待随 cli 下个版本发布（verdaccio 0.2.42 不含），教案已注明用活代码验证；② 教案落 `docs/guides/20261026-1740-lesson-init-to-market-install.md`（同分支提交）。

## 追加：远程发布通道验证（2026-10-26 18:00–18:25）

| 通道 | 结果 | 证据 |
|---|---|---|
| A 文件直传 | ✅（上轮已验） | uninstall→sign→install→trusted→冒烟 ok |
| B 站点自供 /cdn | ✅ 无需复验 | 主链路 UC4 即此形态 |
| C 外部真 CDN | ✅ 本轮实测 | 双工程模拟：CDN 工程（ojm-lesson-cdn，config port=9783，python http.server 静态托管）publish+build-index → `ojm market setup --site-url <远程 9778>` 把 framework.market_cdn_url 改写为 `http://127.0.0.1:9783/cdn` → 远程 uninstall/install → **CDN 访问日志实证 6 次 GET /cdn/**（catalog{,.sig}、shards/1.yaml{,.sig}、tgz）→ list=trusted、冒烟 ok |
| D 外部 registry | ⬜ 未实测 | registry 为需 token（OJM_REGISTRY_TOKEN）鉴权的外部服务，非静态目录，本机无可起的 registry 服务端 |

**新发现（C 通道）**：① `market setup` 的 CDN 地址不是 CLI 参数，而是从 setup 所在工程的 config（server.host:port + /cdn 前缀）推导——「CDN 工程」必须按该地址可达；② CDN 源安装**不取 .tgz.sig 侧车**，签名走分片 Form B 的 archive.signature（与文件源的 detached 侧车两形态同源，verify.ts 注释）；③ 跨 origin 拉取只需远程站点配 canonical_origin，CDN 侧零配置。

## 追加：preview 单服务形态远程发布（2026-10-26 18:30–18:45）

全新 `ojm init`（ojm-lesson-remote，port 9779，全程不跑 dev）→ config canonical_origin → install → build → `ojm preview`：

- **单服务验证**：进程树仅一个 LISTEN（oj @127.0.0.1:9779；父 ojm 进程无 socket）；`GET /`、`/versions.json`、`/api/_system/health` 三探针同站点同端口全 200。
- **通道 A 实测**：file 上传安装触发完整 TOFU（新站点空信任库）→ confirm → 重试 → 安装完成。
- **通道 C 实测**：CDN 工程 `market setup --site-url <9779>` → uninstall → install，CDN 日志实证 5 次拉取。
- **P6（反常识，热更缺口）**：进程不重启、uninstall→reinstall 后 `/api/wiki/status` 冒烟 **401**（模块已上线、匿名准入丢失；oj 运行进程的匿名表 uninstall 时摘除、reinstall 写盘未热更）。**重启 preview 即恢复 200**，重跑 install 收尾完成。规避：运行中站点 uninstall 过后重启再重装。匿名真源补充：`/wiki/status` 匿名在 oj-wiki 靠宿主 config.yaml（L148 anonymous 列表），方案包依赖安装器注册。
- **未完全归因**：同进程 uninstall→file 源重装曾冒烟通过（9778 站），CDN 源重装必现 401——是否分源差异样本不足，不下结论。

## 追加：市场页面 UI 安装 e2e（2026-10-26 19:00–19:40）

- **页面路径**：登录 → `/oj-market`（oj-market 模块）→ wiki 卡片「安装」→ InstallDialog 打开即自动发起安装（`source:"cdn"`）→ 轮询 task；needs_trust 时展示 key_id+指纹（`data-testid="install-trust-fingerprint"`），点「指纹一致，信任并重试」（client.trust(taskId) 后自动重试）→ done。
- **实测两轮**：① 全新 key `lesson.ui` 重签 CDN 包（catalog 第 2 代）→ UI 完整走 TOFU（指纹与 keygen 值断言一致 → 信任 → done「冒烟通过：探活/integrity/注册一致性」）；② 卸载后重跑（已信任）直接 done，卡片断言「已启用」。截图存证 /tmp/market-ui-e2e/。
- **脚本坑三枚**（已写进教案第 5 节）：antd 两字中文按钮名插空格（断言需 `/安\s*装/`）；装好状态文字是「已启用」非「已装」；antd 弹窗 Esc 关不掉，要点「关 闭」。
- **教案已重写**：两种安装方式并列（第 4 节 CLI / 第 5 节 UI），章节重组、去除重复附录，口语化表述。

## 风险与对策

| 风险 | 对策 |
|---|---|
| init 联网下载 bin/oj 失败/慢 | 预置 oj-wiki/bin/oj（0.1.86）+ .oj-version，init 幂等跳过下载（教案两种路径都记） |
| scaffold pnpm install 解析不到 @oj-module/* | pnpm overrides file: 指向本仓 packages/*（verdaccio 未运行；教案注明生产走 verdaccio 模拟发布） |
| oj-wiki bundle 构建红 | 先跑 typecheck/已有 dist 状态排查；记录到教案「问题」节 |
| TOFU 任务 ID 获取 | install 失败输出附 task id；--json 信封可机读 |

## 问题记录（执行中追加）

### P1（已修复，工具链内部契约不一致 / 反常规）`ojm market verify` 把契约可选字段当必填

- **现象**：UC3 中真实工程包（`ojm build --bundle` 产物）验包必红：`✗ manifest 结构：wiki-0.1.3.tgz：缺必填字段 archive`；而 `--fixture` 合成包全绿。
- **根因**：`packages/cli/src/market/verify.ts` structureCheck 把 `archive` 列入必填；但契约 `manifest-contract.ts` C2-29 明确「archive 可整体省略（Form A 占位仅 file；sha256/size/signature 由索引侧填 Form B）」，且 `bundle.ts` 对真实方案**逐字拷贝** solution.yaml、从不注入 archive——构建侧不落、校验侧必填，REG-CS8（c12626c7）评审修复引入的自相矛盾。fixture 会写 `archive: {file}`，故只有真实工程包暴露。
- **处置**：TDD 修复——`market/__tests__/verify.test.ts` 新增「摘 archive 重打包验包」回归用例（先红后绿），`verify.ts` 必填集去掉 archive 并注明 C2-29 依据。市场套件 98 项全绿。
- **注意**：verdaccio 里的 cli-0.2.42 产物不含此修复；本链路验包/安装一律用本仓活代码 `node ../oj-module/packages/cli/bin/ojm.mjs`。

### P2（环境坑，已绕开）pnpm v12 不再读 package.json 的 `pnpm` 字段

- **现象**：给脚手架加 `file:` overrides 后 `pnpm install` 报 `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`，改 `pnpm.overrides` 又遇 `catalog:` 协议无法解析（workspace 协议只在仓内生效，file: 装出去即失效）。
- **结论**：脚手架依赖 `@oj-module/*` 的正道 = verdaccio 模拟发布（`scripts/publish-verdaccio.mjs`，storage 已有 0.2.42），靠 `~/.npmrc` 的 `@oj-module:registry=http://localhost:4873/` scope 映射供给。`pnpm.overrides` 若用，只能写在 `pnpm-workspace.yaml`（v12 唯一读面），且与已有 `overrides:` 键合并而非重复键。

### P3（用法约束）`ojm market publish --real` 必须给 `--registry-id`

- 缺省报错退出。站点未配 `canonical_origin` 时安装验签跳过 registry_id 比对（steps/verify.ts:201），故本教案用 `--registry-id lesson.local` 占位；生产指向外部 registry 时必须等于该站 canonical_origin。

