# Changelog

本仓库为**双包 lockstep 发版**：`@oj-module/runtime`（浏览器面，含 `contract` 子路径）与 `@oj-module/cli`（Node 工具链面，含预构建宿主 `shell-dist`）**始终同版本号**一起发布。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。
设计依据、迁移记录与陷阱清单见 [`docs/prd/202609110947-oj-module-two-package-consolidation-design.md`](docs/prd/202609110947-oj-module-two-package-consolidation-design.md)。

## [0.2.47] - 2026-10-31

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步定版 **0.2.47**（延续 0.2.x 线，不进 0.3.x）。
本轮修复企业微信代开发「生成开通链接」链路的若干上游错误码，并把服务商级凭证补全为独立配置层。

### Fixed

- **代开发开通链接改用 `get_customized_auth_url`**：代开发应用**明确不支持**第三方应用的
  `get_pre_auth_code`（errcode 48002 api forbidden）。开通入口改为走代开发专属的
  `get_customized_auth_url`（返回 `qrcode_url`，即企业管理员要扫/开的开通链接）。
- **服务商级凭证独立成 Tier C**：新增 `wecom_provider_id` / `wecom_provider_secret` 两项
  （`get_customized_auth_url` 只认 `provider_access_token`，须由服务商 corpid + provider_secret 换得）。
  取数位置已写精确：`provider_id` = 服务商后台「服务商信息」页 CorpID；`provider_secret` = 服务商后台
  「应用管理 → 通用开发参数」点「编辑」后的 `ProviderSecret` 字段（不在服务商信息页，也不是 suite_secret）。
  缺这两项时「生成开通链接」点名 400，且不影响登录（login 走 suite 流程）。
- **`get_customized_auth_url` 必填 `state`（errcode 40058 state missing）**：调用方未传时补默认常量
  （限 ≤32 字节 `a-zA-Z0-9`），避免企微拒收空 `state`。
- **`get_customized_auth_url` 返回 842002（模板未上架/上线）给出可操作中文提示**：842002 是运营前置动作
  （模板创建成功 ≠ 上线，须到服务商后台「代开发应用上线」提交审核并手动提交上线），非代码缺陷；
  报错文案现直接指引去后台提交上线，并在 `docs/devkit/wecom-daikaifa.md` 故障速查表补行。

### Docs

- `docs/devkit/wecom-daikaifa.md`：凭据清单补 Tier C（provider 凭证）两项并写精确取数位置；
  开通流程改走 `get_customized_auth_url`；故障速查表新增 48002 / 40058 / 842002 处置行。

## [0.2.46] - 2026-10-31

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步定版 **0.2.46**（延续 0.2.x 线，不进 0.3.x）。
本轮修复企业微信代开发「创建模版必须先验回调、验回调必须先有 suite 凭据」的鸡生蛋死锁，以及若干登录链路缺陷。

### Fixed

- **代开发模版创建死锁（鸡生蛋）**：原 `readWecomConfig()` 把六项目录常量全当硬依赖，而 echostr 回调验证
  又把 `suite_id` 作为解密 receiveid——但 `wecom_suite_id` / `wecom_suite_secret` 是**模版创建成功后**才由
  企微下发，导致「服务起不来 → 验不了回调 → 建不了模版 → 拿不到 suite」的死锁。
  - 配置分层：`readCallbackConfig()`（Tier A：token / EncodingAESKey / 落库密钥 / 基址，全部部署方本地生成）
    只校验这四项，**不依赖 suite 凭据**；`readWecomConfig()`（Tier A + Tier B）仍供 suite 流程使用。
  - 引导期放宽 receiveid：`unwrapWecomMessage(..., tolerant)` 在 `suite_id` 尚未下发时跳过 receiveid 比对
    （签名已是最外层鉴权闸门，receiveid 仅为防御性兜底）；`suite_id` 配齐后自动恢复严格比对。
  - 效果：部署方本地生成四项 Tier A 即可启动服务并响应 echostr 验证，模版创建拿到 suite 后再补全，
    两种企微时序（表单内联校验 / 先建模版后配回调）都覆盖。详见 `docs/plans/20261030-1845-wecom-daikaifa-login-plan.md` §18。
- **换票端点误读部署凭据**：`/auth/wecom/ticket` 此前调用 `readWecomConfig()` 仅为构造空 deps，导致
  凭据缺配时把「已签发的票据」误判成登录失败；改为常量 deps，凭据事故不再伪装成票据失效。
- **企业微信登录故障排查信息不全**：票据无效时后端信封的 `msg`（如「登录票据无效或已使用」）此前未被前端读出，
  一律显示 `HTTP 401`；换票请求改为读信封并透出真实原因（已在 0.2.45 落地，本轮随版纳入回归）。

### Docs

- `docs/plans/20261030-1845-wecom-daikaifa-login-plan.md` 新增 §18：基于官方文档（路径 97112）核对
  六项常量的来源与必填时序，给出死锁根因、分层解法与正确部署时序。

## [0.2.45] - 2026-10-30

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步定版 **0.2.45**（延续 0.2.x 线，不进 0.3.x）。
本轮为企业微信代开发登录与多租户底座（需求二）。

### Added

- **多租户底座**：模板 21 张业务表全量加 `tenant_id`（`X-TENANT-ID` 头，`sql_guard: deny` 拒无上下文写入），
  登录态带租户，`tenant.allow_as_tenant` 支持登录前按企业代码选租户；三张企微表登记进 `tenant.shared_allow`。
- **企微代开发连接器**：`/auth/wecom/{login,callback,ticket,event}` 四个端点——授权入口 302、
  回跳换 `userid`、一次性票据换会话、回调验签解密分发。
  四级凭据链（`suite_ticket` + `suite_secret` → `suite_access_token` → `permanent_code` → 企业 `access_token`），
  事件覆盖 `suite_ticket` / `create_auth` / `change_auth` / `cancel_auth` / `reset_permanent_code`。
  `permanent_code` 只以 AES-GCM 密文落库（`permanent_code_enc`，密钥 `wecom_enc_key`），任何接口不回传明文。
- **JIT 自动建档**：外部员工首次登录即建号（用户名 `wecom:<userid>`，显示名优先取企微姓名、兜底工号），
  无需注册、无本地口令；外部号命名空间禁止被本地建号占用。
- **登录页新增「企业微信」方式**：登录方式由后端发现（`local`/`ldap`/`sso`/`wecom`），
  扫码与企微内静默授权（`snsapi_base`）走同一条回调；回跳落地带一次性票据，不把 token 放进 URL。
- **代开发后台 `/system/wecom`**（仅超级管理员）：已开通企业清单、按应用启停、生成开通链接（含二维码，
  10 分钟一次性）并回显应填进企微后台的回调地址；停用按安全事件留痕。
- **`@oj-module/runtime` 导出 `resolveApiBase()`**：API 端点 base（ky `prefix` 的同一取值口，
  与站点 base 正交），供整页跳转的后端端点与上传 action 拼 URL；`ojm` 构建期 runtime stub 同步导出。

### Fixed

- **冷启动丢租户头导致角色/权限清空**：租户头下沉到运行时统一注入（每次请求现取），
  不再依赖登录那一刻写进内存的副本。
- **点「企业微信」登录后页面原地重载、一个 auth 请求都不发**：授权入口是后端端点却拼了站点 base，
  根部署下得到 `/auth/wecom/login` 被 SPA 兜底页吞掉；改用 `resolveApiBase()` 拼接。
- **登录页「企业代码」输入框读屏与 `getByLabel` 都取不到**：受控值不走 antd 表单字段，
  标签只是视觉文本；补 `htmlFor`/`id` 建立关联。
- **企微登录失败一律显示「HTTP 401」**：票据换会话未读后端信封，把 `fail(401, "登录票据无效或已使用")`
  的真实原因盖掉了；改为透出 `msg`。

### Docs

- **新增 `docs/devkit/wecom-daikaifa.md`（随 `ojm init` 分发）**：真实套件联调的**凭据清单**
  （六项 `vars` 的取值位置/格式/缺失后果、可信域名与可信 IP 备案、`wecom_enc_key` 生成与轮换）、
  **首次开通顺序**（`suite_ticket` 依赖回调先通，跳序必卡 503）、
  **用户 / 开发 / 部署三种角色**的操作手册、按错误文案索引的故障速查与上线自检清单。
- devkit 索引与 skill 入口同步：`README.md`、`SKILL.md`（新增企微触发词与四条红线）、
  `manual.md` §8.2/§9 增加对应条目；`sync-devkit.mjs` 自动收录，`ojm init` 第 4b 步分发。

## [0.2.44] - 2026-10-30

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步定版 **0.2.44**（延续 0.2.x 线，不进 0.3.x）。
本轮为模块多根树路由支持（需求一）。

### Added

- **模块路由支持多根树（需求一）**：`entry.ts` 导出数组 `length > 1` 时视为单模块多根，
  每个根节点作为一级菜单注册，沿用模块 `name` 作路由前缀；`module-loader` 在多根场景跳过
  `applyRoutePrefix` 合并，所有消费者路径安全。补 `manifest-routes-derive` 与 `loader` 回归用例。

## [0.2.43] - 2026-10-26

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步定版 **0.2.43**（延续 0.2.x 线，不进 0.3.x）。
本轮为市场验包契约一致性修复（教案全链路实测中发现）。

### Fixed

- **`ojm market verify` 把契约可选的 `archive` 当 manifest 必填，真实工程包验包必红**：
  REG-CS8 引入的 structureCheck 将 `archive` 列入必填字段，但契约 C2-29 明确其可整体省略
  （Form A 占位仅 file；sha256/size/signature 由索引侧填 Form B），且 `ojm build --bundle`
  对真实方案逐字拷贝 solution.yaml、从不注入该字段——只有自带占位的 `--fixture` 合成包能验过。
  现必填集回归 name/version/summary/peerRuntime，并补「摘 archive 重打包验包」回归用例。

## [0.2.42] - 2026-10-26

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步定版 **0.2.42**（延续 0.2.x 线，不进 0.3.x）。
本轮为代码评审驱动的安全/正确性收口。

### Fixed

- **（关键）`tgz` 体积闸门（REG-CS8）被旧 mtime 绕过**：`extractTarEntrySize` 只锚定 `HH:MM` 时刻，
  而 `tar -tvzf` 对 >6 月的成员省略时刻只印日期/年份，导致 size 解析为 0，大包（zip bomb）零解压零落盘
  闸门失效。现统一锚定「日期组」（ISO 日期或月份名），取前一 token 为 size，覆盖 GNU/BSD 近期与旧 mtime 全形态。
- **市场离线验包预发布版本完整性静默放过（REG-CS1 边界）**：`nameOf`/`versionOf` 按最后一个 `-` 切分，
  `x-y-z.tgz` 这类预发布包永远匹配不到索引声明，篡改包被「未声明」误判为通过。现以内容摘要兜底匹配索引任一声明条目。
- **`ojm market bootstrap` 派生 config 把 `/cdn` 的缓存头错挂到 `/` 挂载**：导致读面丢失
  `max-age=60, stale-while-revalidate=60`，破坏 Q8「yank 最坏 120s 生效」设计。现只改 `web` 指向，
  最小 SPA 挂载作为 `/cdn` 的同级兄弟追加在 `headers` 块之后。
- **`--fixture` 未做路径穿越校验**：`../../x@1.0.0` 可把 tgz 写到 `cdn/` 之外。现 `parseFixtureSpec`
  拒绝含 `..`/路径分隔符的 name/version（fail-closed）。
- **`ojm market verify` 索引同代校验漏判缺失分片正文**：catalog 钉了某分片但盘上缺正文时仍判通过，
  安装会 404。现对钉值分片校验正文存在性。
- **`ojm registry import` 损坏的吊销账本被 fail-open 处理**：损坏账本当成「无记录」放行回退攻击。
  现区分「缺失 / 合法 / 损坏」三态，损坏即拒载。
- **`ojm registry import` 落盘夹带未验签分片**：原先按目录整扫 `shards/*.yaml` 拷贝，包内夹带的未验签
  分片会落到服役目录。现只拷贝 catalog 钉值且已验签的分片。
- **`reg_source_seq` 写入的 TOCTOU 竞态**：SELECT 再 INSERT 在并发首装同源时撞唯一键，未捕获异常把合法
  并发安装误判成 500 而非 `index_state_corrupt`。现写入改为 insert-or-update 兜底，且写入失败在 guard 内
  统一转 `index_state_corrupt`（fail-closed）。
- **`ojm market yank` 顺序错**：先写 yank 账本再重建索引，缺 `--id` 时索引重建抛错、yank 已记却未生效。
  现先校验 `--id` 再落账；`market` 未知子命令的帮助补齐 `verify/trial/walkthrough`。
- **`ojm view` 对缺失/非数字 `createdAt` 抛 `RangeError`**：现回退为「（未知）」。

### Changed

- `market/build-index` 片号取最大值改用 `reduce`（`Math.max(...set)` 在分片数极大时撑爆调用栈）。
- `cdn-layout` 解析 config 去重（不再重复 `yamlParse`）。
- `ojm sign` 去冗余：`deriveName`/`deriveVersion` 合并为单次 `deriveIdentity` 调用。

## [0.3.3] - 2026-10-26

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.3.3**。

### Fixed

- **`ojm preview` 形态下安装恒定卡在 reloading（reloadConfig 返回 unchanged）**：`ojm preview` 为了
  SPA 回落与 `platform.root` 改写，会在 config 同目录派生一份 `.ojm-preview.yaml` 并让 `oj serve`
  读它；而安装器的「安装序号自增 + 匿名端点接线」只写源 `config.yaml`，服务端按派生文件的文档 sha
  判定，永远看不到差异，于是安装必失败且错误只报 unchanged。
  现在安装器在派生文件存在时**同步写一份**（源 config 仍是真相，preview 重启后按它重建派生文件）；
  派生文件不存在（dev / 生产部署形态）只写源 config，不无中生有。
  同一提交补了模板侧 2 条用例，并修正 `market-api.spec` 里 P-2 遗漏的 `license` 断言
  （模板用例不在 CI 里跑，之前漂了一版没被发现）。

### Added

- **`ojm list`（站点已装方案的可查面）**：`ojm list [--site-url] [--user] [--pass] [--all] [--json]`
  读 `GET /api/_platform/market/index`（superadmin）并只挑已装的行，打
  「名字 / 已装版本 / 启用态 / 最新版 / 可升级 / 签名可信」，末尾汇总「可升级」与「签名不受信」。
  `--all` 连未安装的索引行一起列（`installed` 显示 `-`）。
  此前 CLI **没有任何命令能回答「这个站点上装了什么」**——装完只有一条终态文案，之后核对
  版本/启用态得登站点翻市场页，CI 无法脚本化。
  三个派生列（installed/enabled/upgradable/trust_state）都取自站点聚合行，不在 CLI 现算，
  避免两个真相源各自漂移。清单为空仍是成功（exit 0）。

- **`ojm registry sign --revocations`（REG-R10 吊销清单外置签名）**：输入是吊销清单**正文原文**
  （`GET /api/oj-registry/cdn/revocations` 的响应体，或 `ojm registry export` 产出的
  `registry/revocations.yaml`），输出是 `POST /api/oj-registry/revocations/signature` 的六字段请求体
  （`seq/alg/key_id/public_key/value/canon`），签的是 `revocations:<seq>:<sha256(正文)>`。
  此前这条链只能手工拼：服务端按正文**重算**规范串再逐字比对，客户端一旦解析再序列化（换行、
  键序、缩进变了）sha 就变，`revocation_sig_format` 拒收且看不出原因。
  本命令不做重渲染，原样吃文件；以 `{` 开头的输入（= `/revocations` 的 JSON 导出）直接拒并指路。
  这一处 `--id` 必填（没有导出体可推断 key），签完自检不过 → `revocation_sig_mismatch`。
  索引签名与吊销清单签名共用一个子命令，信封里用 `data.kind`（`index` / `revocations`）区分。

- **`ojm registry export`（REG-R11 离线包的产出端）**：把 registry 读面
  （`/api/oj-registry/cdn/…`）上的索引与包体拉成一个 `ojm registry import` 能直接吃的离线包目录：
  `<out>/source.json` + `<out>/registry/{catalog.yaml(+.sig), shards/<n>.yaml(+.sig),
  revocations.yaml(+.sig), <slug>-<version>.tgz(+.sig)}`。
  此前离线包只能手工拼——public 站点能整拷 `<cdn>/registry/`，**private 站点（REG-R8 的 private 载体）
  根本没有那个静态目录，等于产不出离线包**。
  导出时当场判三条自洽：正文与侧车对不上（`index_sig_mismatch`）、分片代数 ≠ 总目录钉值
  （`index_generation_mismatch`，源正在重建索引）、包体 sha256 或长度 ≠ 索引声明
  （`package_sha_mismatch`）——把「拼错的离线包」挡在导出端，而不是等运维救站时才发现导不进去。
  **只验自洽不验归属**：公钥是否属于本站 active 索引 key 由 `import` 用本地信任库判；导出侧拿源
  给的钥匙验源给的签名等于没验，所以本命令不产出 `index-keys.json`、也不写本地信任库。
  落盘是「先全下到隐藏暂存目录、最后整体换位」：中途失败不会在 `<out>/registry/` 留半份包。
  `--dry-run` 只验索引层、不下载包体、零落盘。
  另外把侧车校验抽成 `registry-sidecar.ts`，`export` 与 `import` 共用同一判定——两边各写一份，
  一旦口径漂移就会出「导出的包自己导不进去」这类最难查的故障。

- **`ojm list`（站点已装方案的可查面）**：登录后读 `GET /api/_platform/market/index`，只挑
  `installed != null` 的行打表（`NAME / INSTALLED / ENABLED / LATEST / UPGRADABLE / TRUST`），
  末尾按需追加「可升级」与「签名不受信」两行汇总；`--all` 连未安装的索引行一起列（`installed` 显示 `-`）。
  此前 CLI **没有任何命令能回答「这个站点上装了什么」**：装完只有一条终态文案，核对版本、启用态、
  可升级与否都得登站点翻市场页；升级前看谁落后、卸载前确认名字这类动作没法脚本化。
  **复用站点已有的聚合视图而不是新增「只列已装」端点**——那一条已经把 sidecar 的
  `installed/enabled`、索引的 `latest/available`（算 `upgradable`）、信任库的 `trust_state`
  三件事聚合好了，新增端点等于让两个真相源各自漂移。
  清单为空仍是成功（exit 0，没装东西不是错误）；缺凭据是用法错误（exit 2）且**不联网**。
  `--json` 走统一单行信封（`data.site / data.all / data.solutions`）。

## [0.3.2] - 2026-10-26

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.3.2**。

### Added

- **市场卡片与安装确认页展示许可（P-2）**：`GET /_platform/market/index` 的每行新增 `license`
  （取自分片条目 `manifest.license`，C2-07 同一口径；缺口/非字符串 → `null`）。市场页卡片在
  版本行下方显示「许可: MIT」小标签，安装弹窗在进度上方常驻「版本 + 许可」元信息。
  未声明就不渲染许可行——不显示「未知」占位，避免和「字段缺失」混在一起。
  模板侧补了卡片/弹窗各两条用例（声明显示、未声明不占位）。

## [0.3.1] - 2026-10-26

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.3.1**。

### Fixed

- **`ojm sign` 接上 `--registry-id`（REG-CS3 v2）**：`signCommand` 自规范串 v2 起就强制要求
  签发方身份（`--registry-id <registry.id>`），但 CLI 从未声明这个选项——cac 按未知选项报错，
  于是命令**无论怎么打都是死路**。真机冒烟（把 oj-registry 装进隔离站点）时撞出来的。
  现在 `ojm sign <file.tgz> --registry-id <registry.id> [--id <publisher.id>] [--key <pem>] [--check]`
  可用，产物 `.sig` 带 `registry_id` 字段；规范串 `<registry_id>:<slug>@<version>:<sha256>`
  ——往 registry 发布时该值必须等于目标站点的 `canonical_origin`，否则服务端
  `registry_id_mismatch`。补了一条参数映射用例钉住接线。

## [0.3.0] - 2026-10-25

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.3.0**（0.x 下的破坏性变更走次版本号）。

### Changed

- **破坏性：站点寻址 `--url` 硬切改名 `--site-url`，环境变量 `OJM_URL` 硬切改名 `OJM_SITE_URL`（Q11）**。
  牵动 `install` / `enable` / `disable` / `uninstall` / `view` / `trust` / `market setup` 与
  `ojm config ls --show-origin`（`site.url` 的来源标注）。**不加别名、不加兜底**：旧写法按未知选项
  报错退出，迁移只有一条路——把 `--url` 写成 `--site-url`、把 `OJM_URL` 写成 `OJM_SITE_URL`。
  改名动机是给 `ojm registry import --site <站点数据根>`（REG-R11，落盘目标是一个**目录**）让出
  `--site` 这个名字：同一个 `--site` 在两个命令里一个指 URL、一个指目录，CLI 的语义就废了。
  `--user` / `--pass` / `OJM_USER` / `OJM_PASS` 与缺省地址 `http://127.0.0.1:9778` 均不变。

## [0.2.36] - 2026-10-25

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.36**。

### Added

- **`ojm registry import <dir>`（REG-R11 离线导入，运维侧）**：把离线包目录（`<dir>/registry/{catalog.yaml(+.sig), shards/<n>.yaml(+.sig), revocations.yaml(+.sig), <slug>-<version>.tgz[+.sig]}`，与 `cdn/` 同结构）恢复到站点本地，**全程不触网**——主场景是「源挂了还能救」。三步与线上 REG-CS1 / REG-R10 同语义、同判别码：① 验签 catalog / 各分片 / revocations，复用站点已登记的 active 索引 key（Ed25519，与线上 `verifyIndexSig` 同口径）；② 吊销 seq 护栏：本地账本 `~/.ojm/registry/<origin>/revocation-seq.json` 比代次，`seq` 低于本地已知值 / 同代正文指纹变了 / 无清单但有账本都拒（`revocations_not_monotonic`），等价线上 `guardAndRecordRevocationSeq`；③ 落盘：public 站点用 `--site` 自动落到 `<cdn>/registry/`，private 站点用 `--out` 直接指定本地索引目录，原样拷贝**不重渲染**保证字节一致。信任源 `--keys` > 本地信任库，取不到活跃 key 即 fail-closed（`index_key_mismatch`）；registry 不新增 mounts。`--dry-run` 全程零写入。
- **`ojm install --registry <url>`（REG-R9 源切换）**：安装源归一逻辑只在 CLI 一处（`parseRegistryTarget`，`@scope/name` → slug 单一归一点；服务端只认 slug，收到 `@` 或 `/` 即 400 `invalid_physical_name`）；装前 `GET /api/_platform/market/meta` 校验站点 API 版本，低于 0.2.0 明确报错而不是静默降级；下载复用 `guardedRedirectFetch`（跨源 3xx 重定向拒，同源 307 放行）。

## [0.2.35] - 2026-10-25

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.35**。

### Added

- **`ojm registry sign`（REG-R7 外置签名，CI 侧）**：把 registry 导出的未签索引（`POST /index/unsigned` 的响应体：`gen` + `pending[]` + `keys[]`）签成可直接回传的请求体（`POST /index/signature` 的 `{gen, signatures}`）——私钥只在 CI/运维手里，服务端结构上没有任何签名原语。三条 fail-closed 都在上传前挡住：公钥未登记或指纹不符 `index_key_mismatch`、正文与导出声明的 sha256 不符 `index_export_tampered`、签完自检不过 `index_sig_mismatch`；这一代没有待签文件时幂等成功且不碰私钥。`--out` 与 `--json` 至少给一个——两者都没有等于白签一场，退 2。

## [0.2.34] - 2026-10-25

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.34**。

### Added

- **`ojm view @<scope>/<name>`（REG-R5 的可查面）**：一次输出**目录键**与**物理名**两个名字——`@acme/demo` 是仓库门牌，`acme-demo` 才是磁盘目录/路由前缀/tgz 文件名。只收目录键：物理名是单向换算（`acme-x-demo` 可能来自 `@acme-x/demo`，也可能来自 `@acme/x-demo`），裸 slug 反推会给出有歧义的答案，所以直接拒绝（exit 2）而不是猜。站点寻址沿用 `--url/--user/--pass`（或 `OJM_URL/OJM_USER/OJM_PASS`），缺凭据退 2；`--json` 走统一单信封，人话改道 stderr。

## [0.2.33] - 2026-10-25

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.33**。

### Fixed

- **`ojm <未知命令> --json` 的 stdout 混进整页帮助**：退出码本来就是 2，但兜底路径在 `index.ts` 里自己 `console.log` 顶层帮助、绕过了 `--json` 的统一出口——CI 拿 `JSON.parse(stdout)` 会直接炸，而「stdout 恒为一行信封或空」正是本选项的全部承诺。现抽出 `reportUnknownCommand`：`--json` 下帮助转 stderr、stdout 只留 `{ok:false, code:"usage_error"}` 信封；不带 `--json` 时行为不变。附回归用例（两种通道都钉）。

## [0.2.32] - 2026-10-25

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.32**。

### Added

- **REG-R12 CLI 自动化契约（CI 无人值守驱动 ojm）**：
  - **退出码三档**：`0` 成功 / `1` 业务失败 / `2` 用法错误。判据是「能否指出改哪一行命令行」——`UsageError`（含 cac 的未知选项、缺参、缺位置参数、非法 `--layout`/版本号、未知命令）→ 2；其余一切 `Error` → 1。混在 1 里时 CI 只能靠解析文案分辨，而文案会改。
  - **`--json`**：`publish` 与 `config` 下 stdout 只放**一份单行信封** `{ok, command, code, message, data}`，人话一律改走 stderr；失败也给信封（`code` = `usage_error` / `failed`，与退出码一一对应）。字段名即契约：加字段可以，改名/删字段是破坏性变更。
  - **`--dry-run`**：`ojm publish` 同一份计算、同一个落盘顺序（先分片 → 再 catalog），只是不执行写；`writes` 照常返回，CI 可先 diff 意图再决定真发。全程零写入（用例带正控制：同目录去掉 `--dry-run` 会真的写）。
  - **`ojm config ls [--show-origin] [--json]`**：把「这次用哪个源、凭据从哪来」摊开成可查事实。源解析顺序 `--registry` > 工程根 `.ojmrc` > `~/.ojm/config.json`，**无内置缺省源**（未配置即报错并列出三种配法，不替你猜一个仓）；凭据 `OJM_REGISTRY_TOKEN` > 用户配置按 `origin` 分桶。只报来源，token 与密码在任何通道都不回显。未配置不是错误（退出码 0）；未知子命令退出 2，不静默当 `ls` 跑。
  - **`ojm publish` 打印最终生效的源 + 来源级别**（§10.3 附加规则），未配源时明说「本次只写本地目录（不上传）」。

### Changed

- **用法错误的退出码由 1 改为 2（breaking，影响 CI 判因）**：`ojm new` 缺名/多余参数/非法 `--layout`、`ojm vendor` 非法版本号、未知命令、未知选项原先一律退 1，现退 2。**升级影响**：脚本里「非零即失败」的写法照旧可用；但如果按退出码区分「改数据 vs 改脚本」，请改为 `1` = 业务失败、`2` = 用法错误。
- **Q7：`ojm uninstall` 注册 `--registry` 只为拒绝**：卸载是站点侧操作，包已在站点上，来源不影响删除范围——给了即联网前退出 2 并说明「卸载不涉及仓库源」；正常卸载输出改印「该包来自站点 X 的已装清单」。

## [0.2.31] - 2026-10-25

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.31**。

### Fixed

- **`ojm api --check` 对参数路由双向误报（`_id_` 目录段没参数化）**：契约 route 用 matchit 语法写 `{id}`，磁盘侧写 `_id_` 目录——同一条路由的两种写法（api-manual §`_name_` 目录即路径参数）。但 handler AST 扫描把目录名原样拼进 `full`，精确对账（方法 + 全路径）永远命中不了，模糊兜底又因静态前缀不同接不住，于是**同一条已实现的端点被同时报成「契约未实现」（warn）和「handler 未登记」（error）**，两条违规互相矛盾且都指向用户去改本来正确的代码。现按 oj 内省同谓词把目录段参数化（整段 `_name_`、内部名非空且不以 `_` 开头/结尾、不含 `{}`；`__x__`/`___`/`_a{b}_`/`_shared` 保持字面），模块段同样适用（`_aa_/bb` → `{aa}/bb`），`.route` 尾巴不重复转换。`dir` 字段仍保留磁盘事实，只有 `full`/`handlerAbs` 是 wire 路径。

### Changed

- **REG-CS1 索引签名强制 + 同代校验（breaking，需重签索引）**：`bundles.yaml` 新增顶层 `seq`（代次，每次重建 +1，内容未变沿用旧代次以保持重建幂等），索引规范串由 `index:<kind>:<sha256>` 改为 `index:<kind>:<seq>:<sha256>`，`.sig` 同步增加 `seq` 字段。索引缺 `.sig`（或为空、不可读）由「运行期容忍」改为**拒载**：`ojm market verify` 该检查项打叉并报 `index_sig_missing`（含两步补签提示），站点市场索引一律 502、安装被拒。新增跨文件同代校验：总目录（`bundles.yaml`）的 `seq` 是代次真源，聚合清单的签名代次与之不等即拒（`index_generation_mismatch`，文案指向「源正在重建索引，请稍后重试」，与安全事件的「被篡改」分开）。**升级影响**：已发布索引须用当前版本 `ojm market build-index` 重建重签，旧签名因规范串变更一律验不过。
- **REG-CS2 索引新鲜度（防回放/降级）**：`bundles.yaml` 新增时效封套 `issued_at` / `expires_at`（epoch 秒，TTL 7 天，常量 `INDEX_TTL_SECONDS` 单点），重建时时效刷新、代次只在正文变化时递增。站点侧新增表 `reg_source_seq`（`_platform` 0014 迁移）按源记录见过的最大代次：拉到的索引过期 → `index_expired`；代次小于水位 → `index_stale`（且不拉低水位）；水位表缺失/写坏 → `index_state_corrupt`（fail-closed，不静默当「第一次见」）。`latest` 单调不降：生成器拒建「latest 往回走」的索引，读方另挡「声明的 latest 低于已声明最高版本」（`index_latest_regressed`）。`ojm market verify` 同步增加「索引时效」检查项。**升级影响**：站点须执行 `oj migrate`（新增表），否则市场索引一律 502 `index_state_corrupt`。

## [0.2.30] - 2026-10-24

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.30**。

### Fixed

- **SPA 重新登录后 `/system/*` 直达恒 404（B16 回归：宿主路由表登录后重登记）**：Boot 期 `user-info` 失败（后端闪断/过期 token 刷新失败）→ 角色快照为空 → `requiredRoles` 模块被 B16 过滤出路由表；随后 SPA 登录不刷新页面时，`setAccessStore` 的 `router.patchRoutes` 打的是 runtime 单例 router，而宿主渲染的是 Boot 自建 router——菜单回来了但路由表保持旧快照，admin/superadmin 访问 `/system/users` 恒落 catch-all「返回首页」，须硬刷新才恢复。宿主侧抽出 `buildShellChildren()` 统一构建口，token 变化（`hydrateUser` 定角色后）调 `repatchShellRoutes()` 重登记宿主路由表，并按当前路径 replace 一次强制重匹配（覆盖登录重定向与重登记交叉的竞态）。附 e2e 确定性复现（abort user-info + reload + SPA 重登 + 直达）。
- **`system` 模块入口误导性注释**：原注释声称「seed 的 admin 账号只有 superadmin」，与 D12 账号名=角色名口径相反，会诱导把 `requiredRoles` 收窄成 `["admin"]` 从而把 superadmin 挡在门外。改为对齐后端 `assertSystemAdmin`（`access.ts:87`）的口径说明，并指向守此口径的回归测试。

## [0.2.29] - 2026-10-24

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.29**。

### Fixed

- **`listenOnFreePort` 重试滞留闭包（端口顺延日志与实listen漂移）**：`listen(port, cb)` 的回调登记在 server 上，EADDRINUSE 顺延重试成功触发 `listening` 时，前次失败滞留的旧闭包先以旧端口 resolve——表现为「端口 5174 已被占用，改用 5175」与「开发服务器已启动：http://localhost:5174」并存，而服务实际监听 5175（多次重启 dev 时浏览器连 5174 会落到上一个残留实例）。现手动挂/摘 `error`/`listening` 监听，并按 `server.address()` 实绑端口 resolve（`startPort=0` 的 OS 随机端口同族问题一并修正），附回归测试。
- **宿主链角色重登记（B16：路由/菜单与真实角色同步）**：宿主无 AuthGuard，模块路由/侧栏菜单只在 Boot 期按当时角色登记一次——无 token 按演示角色 `["admin"]`、user-info 失败为空。SPA 登录不刷新页面时沿用 Boot 期旧表：admin 登录后看不到「系统管理」（须硬刷新才出现）、viewer 反而看得到完整系统菜单（点进去 404）。现 token 变化经 `hydrateUser` 定角色后重跑 `setAccessStore(getRoutes())`（runtime 新增公开导出 `useAccessStore`）；Boot 早期 token 漂移且模块未加载时登记 base 子集，由 loadAll 尾部登记覆盖。

## [0.2.28] - 2026-10-24

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.28**。

### Added

- **`web.route_prefix` 运行期消费（R1）**：`ojm build` 把模块 Web 根路径写进 `dist/web/modules.json` 的 `routePrefix`（缺省=模块名，零漂移默认）；runtime 起站按 `routePrefix` 改写模块路由根段（仅根段，子路由原样），并新增单点 getter `getModuleRoutePrefix(name)` 与 `rewriteAdminPaths` 自动跟随——后端 `apiBase` 与前端路由根解耦，模块级根路径可部署期单独指定。
- **引用式 `solution.yaml` 一等公民（R2）**：方案契约的 `api` 段省略 `tables`/`deps` 时，视为引用打包后包内 `<module>/manifest.yaml` 的原生清单（安装期 C2-31 复核其存在、依赖装配据其回读），`ojm build --bundle` 与 `ojm api --check` 会打印「引用式方案…非漏配」标注，不再误报漏配。

### Fixed

- **`ojm new` 模板不再发冗余 `route_prefix: /<name>`**：模板仅保留注释态提示，避免与运行期默认（`=模块名`）叠加产生重复路径。
- **`ojm api --docs` 落点统一**：生成的接口文档落在 `<projectRoot>/src/docs/<name>/api`，树外产出，与源码树解耦。

## [0.2.27] - 2026-10-23

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.27**。

### Fixed

- **keep-alive exclude key 绝对化（相对声明模块的 `keepAlive:false` 修复）**：解决方案模块一律相对路径声明（安装时 prefix 加在顶层），此前 exclude key 取声明 path（相对值，如 `collections`）而 KeepAlive 的 `activeCacheKey` 是绝对 pathname（`/wiki/collections`），精确串等恒不匹配——表现为 oj-wiki（相对路径声明）收藏页 `keepAlive:false` 静默失效、切回不刷新。key 现按 `addRouteIdByPath` 同规则求解绝对路径（绝对原样、相对拼父层、index 取父层且无尾斜杠），`collectAllRoutePaths` 同口径去重（tab 关闭分支的 exclude 自此真正有意义）。绝对声明模块行为不变（既有回归用例证明）。

## [0.2.26] - 2026-10-23

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.26**。

### Changed

- **最低 oj 版本门禁（MIN_OJ_VERSION）0.1.85 → 0.1.86**：openapi 的 dev 分支裸包解析截断缺陷（module-root 下预生成 `__client` 内省 fail-fast，`oj openapi --module-root` 契约链整体不可用）修复于 oj 0.1.86；module-root 是 0.2.20 起默认布局，门禁须盖住契约链。2026-10-23 第三次基线已用发布通道 0.1.86 实证回归。

### Fixed

- **关闭激活 tab 后幽灵 tab（tabbar 路由同步 effect 依赖回归）**：tabbar「监听路由变化」effect 的依赖数组含 `activeKey`（1e453baf lint 清零时补入），关闭激活 tab 后 activeKey 先变为回退 tab，该 effect 遂以尚未更新的 location 把刚关闭的 tab re-add 回来（zustand 同步 set 抢占 react-router 7 导航的 startTransition lane）——表现为被关 tab 仍留在 tab 栏、仅激活回退 tab。依赖数组移除 `activeKey` 并注释豁免 exhaustive-deps，恢复「仅路由变化时同步」语义。含组件级回归测试 `tests/runtime/tabbar-close.test.tsx`。
- **`ojm api --check` 模块根动词误报 `route-params-mismatch`**：模块根单文件聚合形态（`src/<name>/api/api.ts` 的动词键，如 `GET/POST /api/books`）的契约 route 为 `/`，对账精确腿因 ojFull 尾斜杠（`books/`）与 handler 全路径（`books`）不等而落空，掉进模糊兜底被误报「参数段不一致」。精确腿现对模块根路由做尾斜杠规范化（0.2.25 发布态 playbook 第三次演练实踩，含回归测试）。
- **`ojm init` 不再向业务工程分发 cli 包环境假设的测试**：`init.include.yaml` 的 `tests` 整目录收录改为逐条白名单——`lifecycle/{preflight,installer,market-api,steps-fs,sig-fixtures}.spec.ts`（硬编码 oj-bin 仓夹具路径）与 `lifecycle/bootstrap.spec.ts`（硬编码 packages/cli 全树私钥扫描）不再拷入用户工程（oj-wiki 0.2.25 升级实踩：拷入即死文件、重跑 init 反复复活）。

## [0.2.25] - 2026-10-23

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.25**（runtime 无代码改动，仅为同版发布）。

### Added

- **市场 CDN 相对路径（本站点自供）**：`framework.market_cdn_url` 支持不带 http/https 的相对路径（如 `/cdn`）——表示 CDN 由本站点自己提供（oj 按 config.yaml 的 `/cdn` 挂载直出工程根 `cdn/`）。服务端索引/签名/分发包拉取按**请求源补全同源绝对 URL**（复用 SSRF 钉②的 `withSiteOrigin`；无请求上下文不猜原点、原样透传）；`ojm dev` 同步补 `/cdn` 反代到 oj 子进程（config 无 `/cdn` 挂载或纯前端形态回落静态，行为不变）。
- **脚手架 seed 内置角色开发账号**：`ojm init` 产物的 `_platform` seed 为四个内置角色各备一个开发账号，**账号名=角色名**（superadmin/admin/editor/viewer），口令均 `123456` 且 `must_change=0` **免首登改密**（纯开发便利，生产部署须改密/删除）。旧库（admin 绑 superadmin / must_change=1）无需手工迁移——seed 每次启动幂等重放自动收敛（`DELETE` 旧绑定 + `UPDATE` must_change）。三个方言文件（sqlite/mysql/pg）同构对齐，seed 回归测试钉守（含旧库收敛与幂等用例）。

### Changed

- **脚手架免 `ojm market setup`**：seed 的 `framework.market_cdn_url` 缺省值由空改为 `/cdn`（三方言同改，INSERT OR IGNORE 语义下存量库不受影响）——新工程起站即市场可用；`ojm market setup` 降级为「指向外部真 CDN」时的可选步骤。
- **seed 默认账号语义调整**：`admin` 账号由 superadmin 调整为 **admin 角色**（superadmin 能力移交给同名 `superadmin` 账号），且不再首登强制改密——原「must_change=1 兜底默认凭据」闭环让位给「账号名=角色名、零心智负担」的开发便利口径。

## [0.2.23] - 2026-10-22

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.23**（runtime 无代码改动，仅为同版发布）。

### Added

- **多用户方案打包**：`ojm build --bundle` 复数化——无参时收集 `src/*/` 下全部**用户方案**契约（solution.yaml 优先、manifest.yaml 回退）逐个打包；`--bundle <name>` / `--bundle=<name>` 只打指定一份。优先级矩阵：按名指定 ≻ 工程根契约 ≻ src 全量收集；零用户方案时报错指路 `ojm new`。兼容口径：根 solution.yaml 场景与旧行为逐字节一致；根 manifest.yaml 与 src 模块契约并存时矩阵定版「根压 src」（旧版取 src 契约），有 hint 提示。
- **`src/.ojm-builtin.json` 框架自带方案名单**：`ojm init` 从模板白名单派生写入（重跑缺失才补写，可手改/删除）；打包自动排除名单内模块（逐条日志），`ojm info` 默认折叠为一行计数（`--all` 展开）。名单只是打包排除 / UI 折叠提示，**不是安全边界**——文件永不入包，安装侧信任链（签名 + 信任库 + TOFU）与它无关。
- **`ojm new <name> [--layout container|none] [--api]`**：脚手架内快速生成用户方案骨架（solution.yaml + web entry/pages/locales，可选 api manifest/handler），module-root 布局守卫 + 原子性（失败不留半截目录），生成即被扫描收录、补产物后可直接 `ojm build --bundle <name>`（round-trip）。
- **`ojm info` 数据源修复 + 自带折叠**：module-root 下改用「扫描 + `web.config.ts` 登记」并集（未登记的用户模块也可见）；坏名单文件告警降级为平铺。
- **脚手架 scripts 补齐**：`pnpm new`（= `ojm new`）、`pnpm bundle`（= `ojm build --bundle`）、`typecheck:api`（修复生成器与模板的既有漂移）；新增双写守卫测试（生成 scripts ⊆ 模板 scripts）。

### Changed

- **两段式打包**：先对全部目标契约跑完校验（纯读零写盘），全绿才开始逐个写 tgz——任一校验失败 dist/ 零增量；组装期失败保留已完成产物并指名失败方案。
- **入包红线扩面**：私钥形态文件自检增补 `*.p12` / `*.pfx` / `.env.*`（原 `*.pem` / `*.key` / `.env` / `id_ed25519` / `id_rsa` 不变）。

### Docs

- devkit 手册 §1/§7/§10.1/§11 同步多方案语义；`docs/guides/solution-dev-build-publish.md` 同步打包一节。

## [0.2.22] - 2026-10-22

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.22**（runtime 无代码改动，仅为同版发布）。

### Added

- **`ojm dev` 快捷键提示常驻终端底栏**：启动后提示行固定在终端最末行（DECSTBM 滚动区），构建与 oj 后端日志在其上方滚动不再顶走提示。`c` 清屏从 RIS 改 ED 以保住滚动区；`SIGWINCH` 自适应重建；退出时恢复全屏滚动区。非 TTY 环境回退为一次性打印，行为不变。

### Docs

- 新增 `docs/guides/solution-dev-build-publish.md`：从开发、打包、签名到发布的完整过程指南（重点：签名与私钥保存纪律），devkit 手册 §11/§12 交叉引用。

## [0.2.21] - 2026-10-22

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.21**（runtime 无代码改动，仅为同版发布）。

### Fixed

- **`ojm build --bundle` 契约优先读 `solution.yaml`，避开 oj 按 `manifest.yaml` 枚举 api 后端的冲突**。
  旧方案仍回退 `manifest.yaml`；tgz 内仍按 oj 约定命名为 `manifest.yaml`（`solution.yaml` ↔ `manifest.yaml` 身份差异见 devkit 手册 §1.2）。
- **顶层 catch 不再对已经带 `[ojm]` 前缀的错误二次加前缀**（原先 `bundle`/`publish`/`sign` 抛出的 `[ojm] ...` 会被再包一层变成 `[ojm] [ojm] ...`）。

## [0.2.20] - 2026-10-22

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.20**（runtime 无代码改动，仅为同版发布）。

### Added

- **识别 `src/<name>/{api,web}` 布局（module-root，opt-in，历史布局零变化）**。
  `layout.ts` 新增 `module-root` 一种 kind 与取值函数（`moduleDir`/`apiSrcOf`/`webSrcOf`/
  `apiModulesSrc`），build/dev/preview/bundle/contract 全部改经它取路径，不再手拼
  `api/src`、`web/src`。判定只认模块根标记文件（`src/<name>/api/manifest.yaml` 或
  `src/<name>/web/entry.ts`），并且：
  - 两套源码树同时存在 → 报错（不静默选一个，否则 build 构 A 而 dev 预览 B）；
  - `src/<x>/api` 有目录却缺 `manifest.yaml` → 报错指名目录；
  - `web/dist` 不会被误判成框架根仓的平铺布局。
  产物形状**完全不变**：`api/dist/<name>-<ver>/` 扁平根与 `web/dist` 站点根继续各就各位
  （按模块聚合产物会打断跨模块 import 的 `<ver>` 相对路径、版本锁与 preview 的四处扁平根假设）。
- **oj 能力探针（`bin/.oj-caps`）**：版本号是声明、能跑通才是事实。`build`/`dev` 在
  module-root 布局下先探 `oj build --help` 是否含 `--module-root`，缺失即 fail-fast 并给出
  `ojm vendor` 处置命令；结果按二进制 size+mtime 指纹缓存，手替 `bin/oj` 后自动重探。
- **前端模块清单改为「扫描 + 可选覆盖」**：module-root 布局下模块由 `src/<name>/web/entry.ts`
  扫描得出（字典序，保证两次构建产物一致），`web.config.ts` 的 `modules` 退化为可选覆盖——
  显式顺序排前、未登记的按序追加（并集，忘登记也不会漏构建），`enabled:false` 仍生效，
  登记了不存在的前端入口则报错。历史布局仍以 `modules` 为唯一真源。
- **dev 的 oj 后端参数与构建同口径**：module-root 下传 `--module-root <root>/src`（**不是**
  `--api-path`——oj 0.1.85 起两者互斥，都是「源码树根」），config 取自仓库根；`startOj` 的
  工程根改为「向上找最近的含 `bin/` 的目录」，不再硬编码「config 往上两级」（config 上移到
  仓库根后那样会越过工程）。
- **`MIN_OJ_VERSION` 抬到 0.1.85**：`src/<name>/{api,web}` 布局依赖 oj 的 `--module-root`；
  该版同时落地了 `manifest.name` 与目录名脱钩、`#/m/x` 按 name 解析（详见
  `docs/prd/202610220010-layout-module-root-design.md` §5）。`ojm info` 的后端段新增
  **能力探针**一行（`--module-root 可用/不可用`），并把版本门禁从「只读 `bin/.oj-version`
  标记」改为以现场 `oj -V` 为准（标记只用于报 drift）。
- **`ojm init` 对已存在的 `bin/oj` 先过能力闸门**：早前「存在即跳过」会让从旧工程拷来的
  0.1.84 静默过关，等 `ojm build` 才失败；现在在任何模板写入之前校验版本与 `--module-root`
  能力，不满足直接抛错并给 `ojm vendor --force` 处置（`-V` 读不出版本的桩/损坏二进制只告警，
  不阻断幂等补缺）。
- **tsconfig 覆盖不变量测试**（`tests/cli/typecheck-coverage.test.ts`）：单树布局下前后端分面
  只能靠 `exclude` 表达，宽 glob 会误伤同名模块（见 Fixed 第一条）。测试钉的是行为而非字面量——
  两侧 `tsc --listFiles` 的并集必须等于 `src/**/*.{ts,tsx}`、交集必须为空，且 `src/web/api`
  与 `src/oj-market/web/api` 两侧各归其位。
- **别名的类型投影生成**：`ojm init` / `ojm build` / `ojm dev` 按 `src/*/api/manifest.yaml` 生成
  `<project>/tsconfig.paths.json`（`"#/<模块名>/*": ["./src/<模块名>/api/*"]`，内容未变不写盘），
  由 `src/tsconfig.json` 单独 `extends`（前端不引：web 侧没有 `#` 解析）。tsconfig 的 `paths`
  每条规则的替换值只允许一个 `*`（`./src/*/api/*` 被 TS 以 TS5062 拒掉），且表达不了 `#x`
  这种「本模块根」的模块相对解析，所以只能按模块逐条枚举——清单必须与模块同源，手写必然漂移。
  生成是**现场**的而非随模板拷贝：模板兼作 demo 工程（多出 `demo`/`home`），照拷会让 paths
  指向用户工程里不存在的目录。
- **`types/oj-modules.d.ts` 类型兜底**（`declare module "#*"`，非模块文件）随模板分发并纳入
  `src/tsconfig.json` 的 `include`。`paths` 只命中已存在的文件，模块内 `#_shared/view` 这类
  静态定位不到的别名降级为 `any` 而非 TS2307；模块名写错由 `oj build` 的 S008 在构建期拦下。
- **跨模块引用守卫测试**（`tests/cli/alias-deps.test.ts`）：api 侧不得有跨模块**相对**引用；
  每个 `#/<模块名>/…` 的首段必须是已存在模块、消费方 `manifest.yaml` 必须已声明 `deps`、
  且别名要能按 oj 的后缀探针（`.ts` → `/index.ts`）落到真实文件。

### Changed

- **模板的跨模块 import 改用 oj 原生别名 `#/<模块名>/…`**：`src/{auth,system}/api` 共
  36 处、14 个文件从 `../../[-../]_platform/api/…` 改写为 `#/_platform/…`（module-root 布局
  下别名锚在模块根 `src/<name>/api`，故 `api` 段要消掉）。别名不随目录深度漂移，且把跨模块
  依赖变成**可校验的声明**——`oj build` 的 S008 按 `manifest.deps` 卡门禁（相对跨模块引用
  不追溯，等于换个写法就补上了约束）。`auth` / `system` 的 `deps._platform` 本为表归属
  （S003）已声明，本次无需新增；`_platform` 是提供方，无 `deps`。
  未迁移的一处：`src/oj-market/web/api/defaultClient.ts` 仍用相对路径——它在 web 侧，
  `#` 在打包链路上没有解析语义。

### Fixed

- **方案安装器把「release 根」和「站点根」当成了同一个 `dist`**。模板 `marketEnv()` /
  `solutionsEnv()` 的 `sharedRoot` / `siteModulesDir` / `modulesJsonPath` 全写死 `dist/…`，
  那是 config 在 `api/` 下的历史口径（jail 根 = `api/`，`dist` = `api/dist`）。布局 v2 里
  config 在工程根，后端产物落 `api/dist`、站点产物落 `web/dist`，两个根已分流：安装器的
  版本目录/迁移仍在 `api/dist`，前端 `modules/` 与 `modules.json` 则要进 `web/dist`。
  按此分别取值，并把 C2-09 的宿主版本真源从「modules.json 同目录」改为「release 根」
  （`<sharedRoot>/versions.json`，与 `manifests.yaml` 同层）——站点根不再是它的邻居。
  修前 `ojm market walkthrough` 有 11 项卡在 preflight 的 C2-09（读不到 versions.json）；
  修后 14/14 PASS，`ojm market trial` 同样通过。
- **布局 v2 收尾：隔离站点起站根与模板测试的路径层级没跟上迁移**。`market bootstrap` 的
  `platform.root` 写死 `dist`——那是 config 还在 `api/` 时（相对 config 目录）的口径；config
  上移到工程根后它解析到不存在的 `<root>/dist`，`oj serve` 直接
  `platform.root canonicalize failed`。改为按布局取 `<root>/api/dist` 的相对路径。
  同时修模板测试两处迁移遗留：`tests/api/**` 上移一层成 `tests/**` 后，`../../../../src/…`
  越到了 `packages/`（整包 import 失败，等于测试从未加载），退一层为 `../../../src/…`；
  BDD 夹具建库仍读 `src/<mod>/migrations`，补上 `api` 一侧（`src/<mod>/api/migrations`）。
- **`ojm api` 的契约工具在 module-root 布局下把布局分隔符当成了路由段**。`src/<name>/api` 的
  `api` 是布局的一层，不是路由：拿 `src` 当扫描根会让 handler 的路由镜像变成
  `system/api/users`（真实路由 `system/users`），`--check` 报满屏「handler 未登记」；stub 生成
  也会落到 `src/<m>/<dir>/api.ts`（少了 `api` 一侧）而判「stub 缺失」；WS 匿名对账同理多一段。
  改为在 `layout.ts` 统一给出**模块 api 根**（`apiModuleRoots`：module-root 取
  `<src>/<name>/api`、历史布局取 `api/src/<name>`），handler 扫描 / stub 落盘 / WS 对账 /
  已实现键集合全部按它走。顺带修掉「`src/<name>/web/__client/api.ts` 被当 handler 扫进来」。
- **新布局工程的豁免清单静默失效**。`.ojm-api-exempt.json` 的位置原本写死 `api/`，而 module-root
  布局的 `config.yaml` 在同级工程根、清单也在根；`loadExemption` 找不到文件即回退空豁免，
  `ojm api --check` 会对 auth/web 报一堆「有 handler 无契约」且无任何提示。现在按布局依次找
  `.ojm-api-exempt.json`（工程根）→ `api/.ojm-api-exempt.json` → `api/.ram-api-exempt.json`（R4 旧名）。
- **前后端 tsconfig 的排除规则写宽了，静默漏检**。`exclude: ["**/web"]` 会连带排除「模块名就叫
  `web`」的 `src/web/api`（实测 3 个后端文件从未进过 `typecheck:api`，命令依旧全绿）；
  `**/api` 同样排除 `src/oj-market/web/api`（只因被 entry 引用才侥幸回到图里）。收窄为按布局
  精确一层的 `*/web` 与 `src/*/api`，并加覆盖不变量测试兜底。

- **方案包把脚手架模板的前端模块也打进包里**。`ojm build --bundle` 的 web 段原先把
  `web/dist/modules/` **整树**拷进 tgz，而该目录除本方案模块外还有 `home/login/
  personal-center/notification/system/oj-market` 等模板模块；安装器 `deployWeb` 又把包内
  `web/modules` 整树覆盖进目标站 `<dist>/modules`，于是装一个方案会顺带用作者开发机上的
  模板产物覆盖目标站同名前端。现在只入包 `web/dist/modules/<name>/`（方案自己的模块），
  模板模块属宿主面、不由方案分发；缺该目录时报错指明期望路径（不再静默整树兜底）。

## [0.2.19] - 2026-10-21

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.19**（runtime 无代码改动，仅为同版发布）。

### Fixed

- **冒烟探活把「匿名接线待重启」误判成包有问题**。方案首次安装时，安装器在 `reloading` 段把
  `api.anonymous` 追加进站点 `config.yaml` 的 `auth.anonymous_paths`，但该段属
  `restart_pending`（reload 段消息已明示「待重启段 [auth]」），本进程内尚未生效；紧随其后的
  `smoke` 段按 `manifest.health` 探活，必然拿到 401，于是任务落 `partial` 并报「探活失败」。
  现在 reload 段把本次**真正新增**的路径交接给 smoke（`InstallRequest.deferredAnonymous`），
  smoke 对这些路径的 401 判「待重启通过」并在 message 里注明「重启宿主后生效」；已在配置里
  却仍 401 的路径照旧判失败（不放宽真失败）。
- **方案市场模板（`templates/web/src/oj-market`）补齐信任确认与失败指引**：
  - 建模第五终态 `needs_trust`（此前按成功态渲染成绿色进度），新增 TOFU 确认 UI：展示发布方
    key_id 与可复制的密钥指纹 + 「指纹一致，信任并重试」按钮；确认走
    `POST /_platform/market/trust {task_id}`，入库后自动重发安装（staging 未清场，续跑不重下）。
  - `MarketClient` 契约新增 `trust(taskId)`，`defaultClient` 委托生成的
    `platformMarketTrustPost`（只传 task_id，公钥由服务端自任务记录重取复算指纹）。
  - 契约附录 A 的 `lifecycle.stage.*` 指引 key 在模板 locales 里未落地，此前直接把裸 key
    显示给运维；现显式映射为可读文案（smoke/cancelled/reloading 三条，未收录的保持原样）。
  - 修 `onDone` 死循环：父级每次渲染都会换 `onDone` 身份，终态后 effect 重新触发
    → `index.retry()` → 重渲染 → 再触发，形成同毫秒级的无限请求（浏览器侧报
    `ERR_INSUFFICIENT_RESOURCES`）。改为按 task id 一次性通告。

## [0.2.18] - 2026-10-21

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.18**（runtime 无代码改动，仅为同版发布）。

### Fixed

- **移除遗留的 C2-43 归组父标题门禁**。0.2.16「单根模块约定 + `menu.main` 统一」已把模块根
  菜单标题与 `/system` 下管理子组标题统一到 `<模块>:menu.main`；但 `manifest-contract.ts` 的
  `groupI18nKeys()` 仍要求「声明 `main`/`admin` 路由的方案额外提供一条模块级归组父标题 i18n
  key」，使按 0.2.17 文档新写的方案在 `ojm build --bundle` 阶段被误拦（`ojm build` 不带
  `--bundle` 时不做文件面契约校验，问题被掩盖）。本版删除该引用面：归组父标题不再进
  `referencedI18nKeys`，`menu.main` 成为模块级标题的唯一真源，缺失统一报 C2-25。
- 契约测试改为反向钉住：声明 `main`/`admin` 路由、locale 只提供 `menu.main` → **零违规**；
  缺 `menu.main` → C2-25 且指明 key 与语言。

## [0.2.17] - 2026-10-21

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.17**。

**子路径部署支持**：站点被 oj 挂到非根前缀（`mounts: [{ prefix: /oj, web: dist, spa: true }]`）
时，此前会**白屏 + 深链刷新 404**。根因是三个前缀都停在「包构建期」——runtime 产物里的
`basename` 内联成 `/`、shell 的 importmap 写死 `/assets/*`、宿主 router 不设 `basename`。
本版把 base 改成「部署期可配」，一个 `siteBase` 配置项全覆盖；未配置（根路径部署）时产物
与 0.2.16 逐字节一致。

### Added

- **`web.config.ts` 新增 `siteBase`**（如 `"/oj"`，默认 `""` = 站点根）。`ojm build` 据此
  重写全站 `index.html`：importmap 映射值、`<script src>`、`<link href>` 统一加前缀，并在
  `<head>` 注入 `<script nonce>window.__OJ_BASE__="/oj/"</script>`（复用 importmap 的 nonce，
  否则被 `script-src` 非随机 nonce 策略拦掉）。实现见 `packages/cli/src/site-base.ts`。
- **runtime 出口新增 `resolveSiteBase()` / `withSiteBase()`**（`@oj-module/runtime`）：部署期
  base 的唯一取值口（`window.__OJ_BASE__` → `import.meta.env.BASE_URL`，恒以 `/` 结尾）。
  模块拼静态资源直链用它；路由跳转**不要**用（`navigate`/`Link` 走路由空间）。
- `ojm preview` 按 `siteBase` 把站点挂到同一前缀（`http://localhost:<port>/oj`），子路径部署
  可在本地验证，不必等上线。

### Changed

- **runtime 内 6 处 `import.meta.env.BASE_URL` 收敛到 `resolveSiteBase()`**：router 的
  `basename`、`goLogin()`、改密跳转、`isLoginPathname()` 默认 base、版本轮询地址、
  App 链 `module-manifest.json` 取址。API 前缀（`VITE_API_BASE_URL`）不受影响，两者语义正交。
- **宿主 shell**：`createBrowserRouter` 显式传 `basename`；`modules.json` 的 entry / css /
  chunks 在载入时一次性补部署前缀（`resolveModuleUrls`），后续信任根校验、CSS 注入、
  modulepreload、loader 全部消费归一后的清单。

### Fixed

- 子路径部署下 `GET /assets/react.js` 404 导致的白屏（HTML 仍指向站点根）。
- 子路径部署下深链刷新落 404 兜底页（router 未剥 `/oj`）。
- 子路径部署下 401 循环跳登录 / 改密跳转跳出站点（`isLoginPathname` 与 `location.href` 缺失前缀）。

### 测试（先红后绿）

- `tests/runtime/site-base.test.ts`：归一化 / 注入优先 / 回退语义 + **源码扫描**（`BASE_URL`
  只许出现在 `utils/site-base.ts`）。
- `tests/cli/site-base.test.ts`：runtime / shell / cli 三份实现用同一张用例表对撞（防漂移）；
  `index.html` 重写段逐项断言（CDN 不动、无双斜杠、幂等、缺 nonce 时 fail-closed）。
- `tests/shell/site-urls.test.ts`：entry / css / chunks 补前缀，归一后可直接喂 `collectPreloads`。
- **`scripts/verify-subpath.mjs`（`pnpm verify:subpath`）——子路径部署 e2e 验收**：造最小模块
  工程 → `ojm build`（`siteBase: "/oj"`）核对产物 → `siteBase` 留空重建核对与 `shell-dist`
  逐字节一致 → 真 `oj serve` 跑挂载请求矩阵 → headless chromium 核对 `/` 重定向与深链刷新。
  共 24 项断言；去掉 `__OJ_BASE__` 注入即 6 项红（修复前形态），可作下游验收手段。

## [0.2.16] - 2026-10-21

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.16**。

方案菜单归组的「单一真源」改造（上游 wiki parity 方案 R1–R6）：归组元数据
（`category`/`order`/`module`）从「宿主 `sys_solution_route` 表行」改为「`entry.ts` 路由
handle」，彻底修复 **dev 模式菜单未按预期分组**（`sys_solution_route` 在 dev 为空 → 旧逻辑不归组）。

### Added

- **R5 manifest.routes 由 entry.ts 自动派生**：`ojm build --bundle` 在契约校验前，从
  `web/src/<name>/entry.ts` 的路由 handle 派生 `manifest.routes`（`category`/`order`/`title_key`），
  覆盖手工书写，杜绝「entry.ts 改了 handle 但 manifest.yaml 没同步」的漂移；未迁移方案
  （entry.ts 未声明 category）保留既有 manifest routes 不报错。新增 `manifest-routes-derive.ts`
  （`deriveManifestRoutes` / `reconcileManifestRoutes`）。
- **R1 路由打 module 标**：`module-loader` 在 `getRoutes()` 注册时按 `definition.name` 注入
  `handle.module`（纯函数 `tagModuleRoutes`，不 mutate 入参），旧 bundle 也带标。
- **R2 handle 元数据入菜单项**：`generateMenuItemsFromRoutes` 把 `handle.module`/`category`/`order`
  拷入 `MenuItemType`；`hidden` 识别扩展为 `handle.hideInMenu || category==="hidden"`。
- **R3 groupSolutionMenus 改读 handle 元数据**：选择键由「路径命中 DB 行」翻转为「`item.module`
  存在」；`main≥2` 按模块归父菜单、`admin` 挂入 `/system`（旧行仅作可选回退，dev 零行也归组）。
- **BDD 无漂移用例**：运行时纯函数 + 接入层双轨（handle 真源 vs 旧行声明）结构一致（`drift-A`）、
  dev 零行仍归组（`drift-B`）；CLI 派生三态 + 漂移警告（`d-1`~`d-3`）。

### Changed

- **R4 mergeSolutionCategories 收窄为管理覆写层**：不再从行注写 `category`/`order`（handle 为真源），
  仅保留 `enabled===false → hideInMenu`（路由仍可达，D12 口径）。
- `setAccessStore` 归组时把 `solutionRoutes` 作为 category/order 的可选回退传入（handle 优先），
  使已迁移模块纯靠 handle 归组、未迁移模块沿用旧行，生产不破版。

## [0.2.15] - 2026-10-21

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.15**。

### Added

- **方案路由注册菜单归组**（纯视觉层，开发形态不变）：已安装的方案 `main` 路由同模块 ≥2 条时归进一个合成父菜单（`solgroup:main:<module>`，标题取模块级归组父标题 i18n key）；`admin` 路由跨菜单挂进宿主底部 `/system` 的 children（缺失 `/system` 则回落平铺并 warnOnce 一次）。合成父键被 `use-menu.ts` 显式拦截，点击只展开不导航。**（0.2.16 单根模块约定后，main 侧扁平归组已不再合成父菜单）**
- **manifest 契约 C2-43**：声明 `main`/`admin` 路由的方案须提供模块级归组父标题 i18n key（双语齐备），构建期 fail-fast；缺失报 C2-43（非笼统 C2-25），按语言去重。**（0.2.18 已移除该门禁：与 0.2.16 的 `menu.main` 统一冲突）**
- **开发者文档**：`docs/devkit/manual.md` §13 讲清归组规则、i18n key 约定、DO/DON'T 清单与源码索引（原 `menu-rules.md` 已并入 §13，保持 devkit 顶层 6 文件发货约束）。
- **`ojm <cmd> --help` / `ojm help <cmd>` 单命令帮助**：`usage.ts` 抽出 `COMMAND_HELP` 单命令帮助表（含 `market` 全部子命令与 `trust` 各子命令），`index.ts` 在 dispatch 前拦截 `--help`/`-h` 与 `help <cmd>` 形态；每个子命令的用法与全部选项可与文档 `docs/devkit/manual.md` §10/§11/§12 互参。

### Changed

- `setAccessStore` 登记菜单时同步调用 `groupSolutionMenus`，空表 / 无命中为无操作；`setSolutionRoutes` 按快照重归并（R21），端点失败 / 登出清空回落平铺。

## [0.2.14] - 2026-10-21

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.14**。

### Added

- **`ojm market walkthrough` 全套操作自检**：隔离站点（随机端口 / 一次性 DB / 内存发布方密钥 / 种子凭据 / 隔离信任库 / 隔离 CDN 六项物理隔离）上按 `setup → act → assert → cleanup` 跑 14 项 AC 表——主链路 9 项（index / install / reinstall / enable / verify / history / upgrade / rollback / uninstall）+ 负向 5 项（neg-tamper / neg-nosig / neg-badindex / neg-stranger / neg-evil，预期失败口径：防线没拦住记 FAIL）。`--only` 单跑原子性成立，`--strict` 首败即停。
- **负向防线演练**：包体篡改（failed@verifying 零落盘）、缺签名（sig_missing）、索引篡改（POST 即 502）、未登记 key（needs_trust → confirm → done，收尾显式 `DELETE trust/key` + 信任库快照 diff 为空）、zip-slip 恶意包（file 源上传即 400，R1 拒在解包前）。负向 op 篡改文件在 `finally` 回抄原始字节并重铺索引。
- **失败路径人话文案表**（`market/failure-playbook.ts`）：双段式（成因 + 下一步）6 条，随报告落盘；traceability 单测守每个 neg 场景的失败码覆盖。
- **报告白黑名单**：walkthrough 收尾脱敏落盘 `logs/walkthrough-<ts>.md`（AC 表 + 文案表）；Bearer / JWT / PEM / jwt_secret 掩码，指纹、sha256、key_id 白名单原样。
- **fixture 迁移阶梯**：`0.2.0` 起（minor ≥ 2）多一段 `0002__more.sql`——upgrade 真的多走一段迁移，rollback 才有「包内最大 seq < 账本 head」可拦。

### Fixed

- **深检 `ledger.stale` 存量误报（pitfall 10）**：`_oj_migrations` 是 oj journal 内建表但未进模块 schema → `db.table` 被元数据校验拒 → `journalHeadOf` 恒 null → 账本复核恒判「落后」。修复：`_platform/schema.yaml` + `manifest.yaml` 声明 `_oj_migrations`（复合 PK `[module, version]`，列与 oj 真表逐列对齐，DDL 仍归 oj 自建自管）。深检 ledger 项零误报，安装器禁降版预锁 guard 的输入真源恢复。
- **`MIN_OJ_VERSION` 0.1.73 → 0.1.81**：模板 `solution-perms.ts` 权限级联清理用 `startswith` 操作键（oj v0.1.81 补齐），旧 oj（< 0.1.81）卸载方案报 `unknown variant startswith` fail-closed。门禁与模板能力对齐；`vendor.test` 硬编码字面量改引用常量。

## [0.2.13] - 2026-10-21

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.13**。

### Fixed

- **`ojm build` 补写 `api/dist/versions.json`**：方案安装器按 B-11 布局读该文件做 `peerRuntime` 强制比对，此前只有 `web/dist/versions.json` → 新工程构建完装任何方案都在 preflight 报「无法读取宿主 runtime 版本」。两处同源（`shell-dist`），新增 spec `src/__tests__/build-backend.test.ts`。
- **模板补 `platform.modules` / `platform.root`**：缺名单时安装最后一步 `reloading` 报 `NotCapable: module '_platform' is not platform-privileged`。`ojm preview` 派生 config 时把 `platform.root` 一并改写为 `api/dist`（与 `--api-path` 同源）。
- **模板补 `fs:` 段**：安装器落盘面（staging / dist/modules / db 备份）缺 jail 授权时，失败发生在任务文件写入之前——表现为「POST 安装 200、task 查询恒 404」。
- **`market/bootstrap` 幂等补 `fs:`**：模板已自带该段时不再重复追加（否则派生 config 出现重复键）。

### Added

- **手册新增「方案模块」三段**：`docs/prd/framework-verification-playbook.md` §7.1 开发方案模块 / §7.2 发布到 CDN / §7.3 市场链路验证（含 TOFU 与 11 段检查点），并新增 6 条已知坑。
- **教学文档新增「实战 + 七个坑」**：`docs/devkit/module-dev-and-cdn-playground.md` §6（handler 必须 `.ts`、`schema.yaml` 对齐、locales 必须嵌套、安装必须 release 形态等）。

## [0.2.12] - 2026-10-21

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.12**。

### Added

- **`ojm market` 本地模拟 CDN 命令面**：模板自带工程根 `cdn/` 与 `/cdn` 挂载（目录缺失会让 `oj serve` 启动 fail-fast，故随模板发布）；`ojm market setup`（must_change 改密闭环 + 写入绝对市场地址）、`ojm market publish`（fixture 合成 / `--real` 真构建 → 确定性 tgz → 包级 detached 签名，不碰索引）、`ojm market build-index`（扫描 `cdn/*.tgz` 提取内嵌 manifest 全量重建两份索引并签名）、`ojm market verify`（离线四类校验 + 索引漂移检出，结论恒带「不构成内容安全性背书」边界声明）。
- **`ojm sign` 内存私钥通道**（`privateKeyPem`）：隔离/一次性场景私钥不落盘；`--key` 语义零变更（给 `--key` 仍须带 `--id`）。
- **devkit 教学文档** `module-dev-and-cdn-playground.md`：开发态 ≠ 分发态、「怎么安装自己的模块 / 会不会重复」（注册面全 upsert + 同名唯一前置校验 + 遮蔽风险）、本地 CDN 市场链路五步跑通。

### Changed

- **移除 desc===summary 等值校验**（安装侧 `extract.ts` 与构建侧 `bundle.ts` 同步）：构建期映射不再被当成安装期契约，保留 `summary` 必填与 `desc` 非空两项。
- **oj 二进制缺失时报错带出路**：spawn ENOENT 时提示「`oj` 二进制尚未安装（在 .gitignore 里，不随仓库分发）→ 本工程目录跑一次 `ojm vendor`」。

## [0.2.11] - 2026-10-20

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.11**。

### Added

- **菜单双段排序（order 双轴）**：`ascending()` 将 `handle.order` 拆成两个区段——`order >= 0` 主区（升序）、`order < 0` 底部固定区（升序，`-2` 排在 `-1` 之上）；未声明 `order` 回落 `routeIndex + 2`（同时修掉 `order: 0` 被 `??` 吞掉的旧问题）；同 `order` 按根 path 字母序决胜。`access` store 拆出 `wholeMenus`（主区）与 `bottomMenus`（底部区）两个字段。
- **侧边导航底部固定槽**：`layout-sidebar` 改 flex 布局（Logo / 可滚动主菜单 / 底槽菜单 / SiderTrigger），底槽仅当 `bottomMenus` 非空时渲染；`order: -100` 的 system 模块随之 pin 在侧栏底部。其余菜单面按形态合并回落列表末尾：双列导航第二列不做底槽（避免子菜单重复，附 e2e S7 回归守卫）、移动端菜单合并、全局搜索收录两段、顶部导航回落末尾。
- **e2e 回归**：`tests/runtime/ascending.test.ts`（双段排序 6 用例）、`tests/runtime/access-store-bottom-menus.test.ts`（store 拆分 4 用例）、e2e S6（底槽几何与跳转）改多根锚定、新增 S7 双列无底槽守卫（红绿双向验证过：底槽加回即 fail 3≠2）。

### Fixed

- **CI 遗留 5 处失败清零**：`market-client-unconfigured.test.ts` 测的是已退役的 `createHttpMarketClient` 工厂（DIP 改造后不存在），删除并将其独有断言（silentError / retry:0 / 单次调用）并入集成测试 503 用例；playbook 中已删除的 `docs/oj-api-dev/` 旧路径改述为迁移后位置，`devkit-docs.test.ts` 结构守卫恢复绿。
- **`templates/web.config.ts` 误导注释修正**：注册顺序 ≠ 导航顺序，导航顺序来自 `handle.order`。
- **devkit 手册 §2.4**：补 `order` 双轴语义（负数入底部固定区）与同序决胜规则。

### Changed

- **market 客户端 DIP 收尾**：删除 `createHttpMarketClient` 工厂，统一走 `defaultClient.ts` 的 `httpMarketClient` 单例委托生成 `__client`；`ScopedRequestLike` 类型统一从 `@oj-module/runtime/contract/errors` 引入。

## [0.2.10] - 2026-10-20

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.10**。

### Added

- **模板 L1 测试通道（`oj test` 真执行面）**：`api/tests/l1-builder.test.ts` 5 用例（匿名登录方法 / 构造器三形态 / 通知 join+UNION+lit 真渲染），连跑三次幂等；配套 fixtures 专用账号 `api/src/_platform/fixtures/l1-test-user.sql`（`l1tester`，`must_change=0`，仅 `oj test` 灌入、不进 release）——seed admin 是 `must_change=1` 生产语义（判权端点恒 403）且口令随用户首登改密漂移，L1 不能绑它。
- **`ojm init` 分发 oj 0.1.82 两份新专题指南**：`sql-builder-guide.md` / `oj-test-guide.md` 随 devkit 进 `.claude/skills/oj-api-dev/`（有则拷；旧版 oj 的 devkit 缺这两个文件时容忍跳过，不影响 ojm 运行）。

### Fixed

- **`oplog` 可选过滤 `""` 归一化 bug**：过滤缺失值被归一成空串，而构造器 `whereIf` 的跳过集是 `undefined/null/false/[]`——`""` 是合法值会照发 `action = ''` 把结果过滤空（与旧 `if (filter.x)` 语义相悖）；修为归一化 `undefined` 走跳过集。

### Changed

- **模板分页工厂化**：`query.ts` 新增 `pagedFactory`（条件写一份，count 走聚合不受 LIMIT 钳制、list 复用同条件），oplog / rbac-settings 等查询切换；模板 L2 同步刷新。
- **devkit 文档树合并（仓库结构 + 随 init 分发的 README）**：oj 侧 devkit 快照（10 文件）由 `docs/oj-api-dev/` 整体迁入 `docs/devkit/oj-api-dev/`，旧目录删除；README 重写为唯一入口（两侧文件索引 + 两条分发链 + 快照刷新口径）；`sync-devkit.mjs` 显式跳过快照子目录（发货内容不变：仍只有 ojm 侧 5 个文件）；`devkit-docs.test.ts` 加结构守卫（顶层 5 文件 / 快照 10 文件 / 零旧路径引用）。
- **devkit 同步上游 oj 0.1.82**：构造器能力缺口 PR 文档闭环（7 项诉求全闭 + 1 条误报订正）；playbook 补 0.1.82 验证基线与 §9.1（L1/L2 边界与契约坑速查）。

## [0.2.9] - 2026-10-20

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.9**。

### Changed

- **模板手写 SQL 改写为 oj 0.1.81 构造器**：`todos`/`uninstall`/`contacts`/`session`/`notify` 由 `db.query`/`db.exec` 改为 `db.table()` 构造器（`contains`/`whereIf`/`count` 聚合/`union`/`join`/`lit`/`as`/`select("*")`/`orIgnore`），多库可移植性提升；`templates/global.d.ts` 补齐 v0.1.81 构造器方法类型。

### Fixed

- **`notifications.markAllRead` 在 sqlite 上 500**：原 `db.table(...).fromSelect(...).orIgnore()` 在 sqlite 不受支持（`orIgnore` 的 upsert 子句只跟随 VALUES，不支持 SELECT 源）。回退为裸 `INSERT OR IGNORE ... SELECT`（sqlite `OR IGNORE` / pg `ON CONFLICT DO NOTHING` / mysql `ON DUPLICATE KEY` 三方言通用）。注意 `orIgnore` + `fromSelect` 组合在 sqlite 上不可用。

## [0.2.8] - 2026-10-19

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.8**。

### Changed

- **方案市场（oj-market）默认随脚手架下发**：`ojm init` 新工程自带 `web/src/oj-market`
  （前端方案，消费 `_platform` 编排面 `/api/_platform/market/*`——该 api 模块此前已在
  默认清单内，前后端自此配套齐活）。`web.config.ts` 的 `oj-market` 条目移出
  `#region demo-only`，升为默认第一方模块。
  - `__tests__` 不进脚手架（用户工程无 web 侧 vitest 基建，拷了是死文件）；
  - 新工程导航即含「方案市场」入口，无需手动从模板搬运。

## [0.2.7] - 2026-10-19

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.7**。

### Changed

- **`ojm preview` 单服务化**：由双服务（ojm 4173 静态 + `/api` 反代 ↔ oj 9778 仅 API）改为只 spawn 一个 `oj serve`——四查 → `oj migrate`（原 config）→ 现场生成派生 config（`api/.ojm-preview.yaml`，upsert `/` web 挂载 + `spa: true` + 显式 port 时覆盖 `server.port`）→ 唯一 `oj serve` 同进程出 API 与静态。与「oj serve + web 挂载」的生产公式逐字同形；退出三路清理（stop / SIGINT / 进程退出兜底）。
  - 行为变化：预览地址由 `http://localhost:4173` 改为 `http://localhost:<server.port>`（缺省 9778，`ojm preview [port]` 传参仍生效）；SPA 深链回落由 oj web 挂载承担（深链刷新 200）；WS 端点在 preview 下可握手（此前无 upgrade 隧道）。
  - **删除 `--oj-static`**：单服务即默认，该形态（history 深链 404）是被放弃的历史路线；ojm 不再自建 http server、不反代。`ojm dev` 双服务不动（SSE 热更 / 宿主 hostRoots 依赖 ojm 静态层，是开发形态必要结构）。
  - **`web.config.ts` 的 `htmlTransform` 在 preview 不生效**（与原 `--oj-static` 同款例外，现为唯一形态）：启动检测到配置即 WARN，指向 oj 的 `server.html_meta` / `server.html_meta_handler`。
  - 派生 config 为临时产物，模板 `.gitignore` 已收录 `api/.ojm-preview.yaml`；原 config 零改动。
  - 新模块 `packages/cli/src/preview-config.ts`：纯变换 `derivePreviewConfigText`（mounts 非序列即人话报错，不静默置空）+ 落盘/清理；错误路径（migrate 失败、starter 同步抛错、ready 拒绝）均零残留。

### Fixed

- **双重 SIGINT 杀死优雅清理（preview + dev 同款）**：终端 Ctrl-C 是进程组信号，外层 `bin/ojm.mjs` 转发一份 + 组送达一份，内层 CLI 收到两个 SIGINT——`once` handler 首次触发即摘除，第二个走默认动作杀死本进程，`shutdownDev`/preview 清理全没跑（冒烟实测 exit `signal=SIGINT` 复现）。现信号 handler 改 `on` + 幂等守卫吞掉重复信号；preview 侧派生 config 的 `cleanup()` 同步先行，任何后续死亡路径零残留。

## [0.2.6] - 2026-10-19

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.6**。

### Changed

- **`ojm init` 模板拷贝反转为白名单（`templates/init.include.yaml`）**：取代 0.2.5 引入的 `init.exclude.yaml` 排除清单。模板里大部分文件是「模板自运行/demo/产物」，不该进用户工程，排除清单越列越长；白名单只收录真正进脚手架的路径，未收录的一律不拷（也不计入 init 报告的 created/skipped）。拷贝结果与旧排除逻辑逐文件一致（206 → 204，差异仅两项修复，见下）。
  - 白名单条目存在性 fail-fast：收录了不存在的路径直接报错，避免拼错目录名在用户工程里留下难以追溯的缺文件。
  - `openapi.json` 裁剪反转为「只保留白名单内 api 模块的 `/api/<mod>/` 路径」，与脚手架实际模块严格一致。
  - 修复旧逻辑两处泄漏：模板本地产物 `api/node_modules/`（旧清单只排了根级 `node_modules`）与 `init.include.yaml` 自身不再进用户工程。
  - `web/src/{demo,home}/__client` 仍不拷（其 api 模块是 demo-only）：白名单对 demo/home 只列页面源码（entry/locales/pages），不列整棵模块目录。

### Fixed

- **`ojm init` 在发布包上 fail-fast、目标目录只剩空壳**（0.2.5 发布实测）：白名单收录了 `.gitignore`，但 npm/pnpm pack 会剥离 `.gitignore` 点文件（npm-packlist always-exclude，`files` 字段绕不过），安装包里该文件不存在 → `readInitInclude` 存在性校验在拷贝任何文件前抛出，整个 init 中断。现 `.gitignore` 改由 init 现场生成（`ensureGitignore`，与 `pnpm-workspace.yaml`/`package.json` 同型；已存在则幂等跳过、永不覆盖用户规则），白名单移除该条目；模板自带的 `.gitignore` 保留供模板自身 `pnpm dev` 使用。
  - 守卫：`tests/cli/release-manifest.test.ts` 新增断言——`init.include.yaml` 每条收录路径都必须落在 `pnpm pack` 的 tarball 内，此类「打包差异」以后未发包即可在 CI 发现。
  - 流程：演练手册（`docs/prd/framework-verification-playbook.md`）新增 §0.5「发布形态准备」——演练默认改用本地 pack 的 tarball（解包 + 安装）而非源码树 CLI，堵住「演练形态 ≠ 发包形态」的盲区。

## [0.2.5] - 2026-10-18

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.5**。

### Changed

- **证书/密钥路径收敛为单一入口**：`resolveCertDir()`（由 config 位置派生，`<project>/api/config/`）取代 `init.ts` 里 `certDir` / `keysDir` 两处各算各的；`ojm dev` 的补签逻辑从 config 的 `certificate_path` 反推同一目录。落点与文件名均未变。
  - 模板 `api/config.yaml` 顶部新增「证书与密钥唯一落点」注释块，逐把说明 `private.pem` / `public.pem` / `cert.jws` 三件套的作用与失效后果，以及 `secrets-*.pem` 与它们的区别。

- **`ojm dev` 缺开发证书时自动补签**：此前证书只在 `ojm init` 时签发，模板仓库本身作为可运行工程（无 init 环节）直接 `pnpm dev` 会因 oj 读不到 `public.pem` 而 fail-fast。现 dev 起后端前检查 `certificate_path`，缺失即现场签发。
  - 注：曾尝试把 config 迁到与 `api/`、`web/` 同级的 `config/` 目录，实测不可行并已回退——oj 的模块解析把「项目根」锚定在 **config 文件所在目录**，且相对 import 被钳制在该根内；config 一进 `config/` 子目录，`api/src` 就整体落到项目根之外，凡是带 `../` 相对 import 的 handler 在 `ojm dev` 下会被判 `escapes project root`（实测 26 个 api 文件只剩 8 个、18 条路由被跳过）。

- **模板（`packages/cli/templates`）兼作可运行 demo**：模板目录本身即一个完整工程（新增 `package.json`，纳入根 workspace，包名 `@oj-module/template-demo`），可直接 `pnpm --filter @oj-module/template-demo dev` 演示全部模块——不必再先 `ojm init` 出一个工程才能看到效果。

### Added

- **`ojm init` 排除清单（`templates/init.exclude.yaml`）**：模板里现在内置一批「仅供演示」的模块与「模板自运行专属」文件，`ojm init` 拷脚手架时按清单跳过，用户工程不再收到它们。
  - demo-only 模块：`api/src/demo`、`api/src/home`、`web/src/{about,access,exception,outside,route-nest}`（来自 `apps/playground-oj` 的演示模块，模板保留以便自演示），外加 `web/src/oj-market`（解决方案市场，第一方能力，仍在演进中，故新工程默认不带）。
  - 模板自运行专属：`package.json`、`node_modules`、`bin`、`pnpm-lock.yaml`。
  - 构建/运行期产物：`api/dist`、`web/dist`、`api/logs`、`api/config/*.pem`、`api/config/cert.jws`、`api/db.sqlite*`——尤其避免所有新建工程共享同一把模板私钥。
  - 派生规则：被排除的 api 模块，其前端 `__client` 生成物一并排除；`openapi.json` 里对应端点也会被裁掉（否则新工程一跑 `ojm api --check` 就是「有契约无 handler」）。
  - `web.config.ts` 中 demo 模块的条目以 `// #region demo-only` / `// #endregion` 标注，init 拷贝时整段剥离，脚手架不留指向缺失文件的死条目。
  - 清单随模板发布，缺失即报错（不静默退化为「全量拷贝」）。

### Fixed

- **市场页在模板默认配置下不再报错**：模板种子里 `framework.market_cdn_url` 为空，`GET /api/_platform/market/index` 按设计返 503「未配置市场地址」，而前端把它当故障弹了错误态 + 重试。现客户端把 index 的 503 归为空数组（PRD §5.3：卡片区显示「未配置市场地址」），其它状态码照旧上抛。
  - 同时不再叠 toast 与重试：ky 新增请求级 `silentError` 选项（调用方自行消化错误体时跳过全局错误 toast），index 以 `silentError + retry: 0` 发起——503 是配置态而非抖动，默认重试 3 次只会刷出 4 条同样的错误。
- **`pnpm-workspace.yaml` 改由 `ojm init` 生成**（构建审批 `allowBuilds.esbuild` + `@redocly/cli` 钉版 2.51.0），不再从模板拷贝：模板目录本身是根 workspace 成员，自带一份会让 pnpm 就近把它当 workspace 根，`cd packages/cli/templates && pnpm i` 找不到父级 catalog（`ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`）。工程里已有该文件时仍是合并语义（占位行填 true、显式 `false` 不动）。

## [0.2.4] - 2026-10-17

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.4**。本周期无代码变更，作为「解决方案全生命周期」阶段的发版基线（`../oj-market` 独立仓等下游将依赖已发布版本）。

### Docs

- **解决方案全生命周期实施设计 v3**：市场即样例（独立仓 `../oj-market`，第三方作者形态）、执行器换轨 oj 原生（`_platform` 进程内状态机 + `exec.run` shell 步骤）；五方专家评审 40 条发现 → 31 项处置全部闭环。
- **实施计划（P0–P3）**：BDD 任务表、SOLID/DRY 落点、AC-P1 验收清单（20 条）。
- **P0 spike 裁决记录**：共享根挂载形态、exec tar 三步范式、锁原子性（无互斥，安装器需读回收敛）、reload_api 全链路、M003/M004 拒启契约、长任务分段执行等六项实测闭环。
- 文档门禁：mermaid 图块校验脚本（`pnpm check:mermaid`）。

## [0.2.3] - 2026-10-16

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.3**（纯修复 + 文档，无破坏性变更）。

### Fixed

- **登录页不显示 LDAP/SSO 切换 tab**：模板登录页此前只渲染本地账号密码表单，从不调用后端匿名发现端点 `GET /system/login-methods`，故在系统设置开启 LDAP/SSO 后登录页毫无变化。
  - 运行时 `LoginInfo` 新增可选 `method` 字段，`fetchLogin` 按 `method` 路由到 `auth/login` 或 `auth/ldap-login`（两者载荷同形、均匿名）。
  - 模板登录页挂载时 `fetchLoginMethods()` 获取已启用方式；多于一种时渲染切换 tab：local/ldap 共用表单（仅 `method` 不同），sso 渲染跳转按钮（SSO 重定向端点由宿主/平台提供，模板仅负责跳转 `/auth/sso`）。
  - 发现端点失败时回落单表单（local），不阻断登录。

- **移除个人中心的「设置」菜单项**：`personal-center` 模块此前挂了一个未实现的设置占位页（`/personal-center/settings` 仅渲染 `Settings` 占位内容），现移除该菜单项、路由与页面，并清理对应的 `menu.settings` 及孤儿 i18n 键（`generalSettings` / `notificationSettings` / `accountSecurity`），保留「我的资料」。

- **操作日志写端（C3）+ runtime 契约**：新增 `POST /api/system/oplog`（登录态即可写入，供解决方案模块记录自身操作）；`access.ts` 导出 `currentAccess()` 作「登录态放行」判据；runtime `api/rbac` 新增 `fetchRbacOplogPost`（入参 `RbacOplogWrite`）。解决方案模块经 runtime 契约写日志，**不 import 框架 `#src/audit`**（模块边界红线）。

- **系统页顶部边距**：`settings` / `users` / `roles` / `oplog` 四个页面根容器加 `paddingTop: 16`，与上方 tab 拉开间距。

### Docs

- 模板 README 排障示例版本号更新为 `@oj-module/cli@0.2.3`。
- devkit 手册 §2.8 增补「场景：解决方案模块记录操作日志」，示范 `fetchRbacOplogPost` 用法与 `module` 隔离锚点。
- 新增设计稿 `docs/prd/20261016-solution-module-rbac-isolation-design.md`：每解决方案模块自服务角色/权限 CRUD + 跨模块隔离（服务端按 `callerModule` 收敛）+ runtime 对外 `createModuleRbac(module)` 契约。

## [0.2.2] - 2026-10-16

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.2**（纯修复 + 文档，无破坏性变更）。

### Fixed

- **脚手架 `pnpm dev` 因 system 模块缺 `__client` 构建失败**：`web/src/system/entry.ts` 引用 `./__client/api`，但该目录此前未随模板分发、且 `ojm dev/build` 启动时不自动生成。现把 system 模块的 `__client`（`api.ts` + `api.schemas.ts`，由模板自带 `openapi.json` 经 `ojm api` 生成）提交进模板，与 auth/notification 等一致，开箱即跑。
- **runtime 构建 TS 报错阻断 shell-dist 重建**：`layout-header` 插槽渲染 `Children.toArray(...).map(node => <Fragment key={node.key}/>)` 在 React 19 类型下 `node` 可为 `string` 无 `.key`（`TS2339`），导致 `runtime build` 失败、宿主外壳拿不到新产物。改为直接渲染 `Children.toArray(...)`（其已分配稳定 key）。

### Docs

- 模板 README 增补「排障 / 常见问题」：说明 `__client/` 为生成产物勿手改、报 `Could not resolve "./__client/api"` 时跑 `ojm api` 补齐；以及 `pnpm dlx @oj-module/cli@latest init` 可能因 dlx 缓存命中旧版 CLI 而生成偏旧脚手架（显式带版本号最稳）。

## [0.2.1] - 2026-10-16

> 基于 0.2.0 框架基线（含后端管理面 `/api/system/*`、`/api/auth/*`）。
> 注意：本仓 `package.json` 已在 0.2.0，但 0.2.0 未正式发版（npm 最高 0.1.21），
> 0.2.0 的变更记录待补，本次 0.2.1 在其之上追加。
>
> 双包 lockstep：`@oj-module/runtime` 同步升 **0.2.1**（无功能改动，纯版本对齐，满足
> 本仓「始终同版本号一起发布」通则）；`sync-host-versions.mjs` 的 prepack 门禁要求宿主
> 产物里的 runtime 版本 == `packages/runtime` 版本，故发版前须 `pnpm --filter @oj-module/cli build:shell`
> 重建 shell-dist（其 `versions.json` 记录 runtime 0.2.1）。

### Added

- **system 管理前端模板模块**：`packages/cli/templates/web/src/system/`（entry + 6 页 + 2 locales），
  以 cli 模板模块形式随 `ojm init` 分发，补齐 0.2.0 后端管理面缺的用户/角色/权限/操作日志/站点设置/登录方式 UI。
  - 用户管理（建号表单校验对齐后端、禁用 Switch、重置口令、本人行动作禁用）、成员资格（`superadmin` 才见入口，整集替换）、
    角色权限（只读双表，`title_key` 跨 namespace 不命中回退 `code`）、操作日志、站点设置（按 `item.module ∈ {framework,ldap,sso}` 过滤）、登录方式（只读）。
  - 权限三档分工：路由级 `config.requiredRoles`（B16，角色不符→404）＋ 页面级 `ForbiddenPanel`（API 403）+ 后端 `assertSystemAdmin` 硬 enforcement。`requiredRoles` 取 `["admin","superadmin"]`，对齐后端 `assertSystemAdmin` 口径。
  - 错误归一 `errors.ts` 兼容 `ContractApiError` 与 ky `HTTPError`；`ForbiddenPanel` 特判 `must_change` 渲染改密引导卡。
  - 13 个 system 端点补 `.schema`/`.response` 契约 + `auth/password` 补 `.schema`（业务逻辑零改动，仅挂契约属性）。
- **login 模块改密页** `/change-password`（fullscreen + `hideInMenu`），must_change 悬挂期唯一出口；
  走 runtime 全局 `fetchChangePassword`（auth 无 web 模块、无 client 宿主）。
- **init devDeps 钉入** `@tanstack/react-query` / `antd` / `i18next` / `@types/react`（模板页只取类型，运行时走宿主 importmap 单例）。
- **模板 `openapi.json` 快照刷到 oj 0.1.74**（旧快照 0.1.69 时代 operationId 带连字符 → 生成非法标识符 `systemLogin-methodsGet`）。

### Fixed

- **宿主链补 `user-info` 水合**（框架缺陷）：预构建宿主无 AuthGuard，user store 角色恒为空/演示值 → 模块角色过滤把管理员挡在 `/system` 外、`superadmin` 判断恒 false、侧栏用户名为空。`host.tsx` 新增 `hydrateUser()`，在 `loadAll()` 之前 await 拉真实角色（must_change 期仍 200），失败则清空、无 token 才播种 `DEMO_USER`。
- **宿主链 catch-all 兜底页**：非管理员直达角色受限路由（如 `/system/*`）时，React Router 无匹配落默认错误页；补 `{ path: "*", element: <PageError /> }` 渲染框架兜底页（后端 403 仍为硬兜底）。

### Dependencies

- oj 最低版本门禁 **0.1.73**（平级 `.response` 需 v0.1.72，`del`→`delete` 操作键归一需 v0.1.73）。

## [0.1.20] - 2026-10-15

### Added

- **`ojm api` 流水线迁移到 `openapi.json` 单一事实源**：`oj openapi`（oj ≥ v0.1.73）内省 handler 的 `.route`/`.schema`/`.response` 生成 `openapi.json`（OpenAPI 3.1，落于工程根），`ojm api` 消费它发射 `__client`（`api.ts` + `api.schemas.ts`）、stub、mock。契约口径由「前端 zod 反射」改为「后端 JSON Schema 白名单」，前后端单一来源对齐 oj 运行期校验。

### Removed

- **退役 `defineApi` DSL 与 `*.contract.ts` 翻译层**：`@oj-module/runtime/contract` 不再导出 `defineApi`/`API_DEF`/`ApiDefinitionInput`/`ApiForm*`；cli 侧 `evaluate`/`emit-meta`/`emit-schema`/`buildIr` 等 zod IR 模块删除。`packages/runtime/src/api/system/role/contract.ts` 死代码删除（保留签入 client）。

### Changed

- **handler 契约写法**：**入参**挂 `.schema = { params, query, body }`；**出参**挂与 `.schema` **平级**的 `.response`（oj v0.1.72+，= 旧 `data` 信封 payload；优先级：动词 `.response` > 组 `.response` > 动词 `.schema.response` > 组 `.schema.response`，旧 `.schema.response` 仍兼容）。union 用类型数组 `["string","number"]` 表达；nullable 用 `["string","null"]`。范本见 `packages/cli/templates/api/src/notification/api.ts`。
- **`del` 动词的操作键归一（oj v0.1.73）**：`oj openapi` 生成 `delete` 操作键（旧 oj 产出非法 `"del"`）；下游 `__client` 得 `deleteXxx()` 方法名。存量工程若手工改过 `openapi.json` 的 `"del"`→`"delete"`，升级 oj 后须删手工改动重生成，否则 `--check` 漂移。
- **迁移检查点（历史 `contract.ts` 升级）**：① 把每个 `defineApi` 端点改写为 handler `.route`+`.schema`（入参）+`.response`（出参）；② `oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json`；③ `ojm api` 重生成 `__client`；④ 删除旧 `contract.ts`、web 调用点改从 `./__client/api` 导入（函数名为 `camelCase(operationId)`，非旧人类命名）。完整指南见 docs 迁移文档。
- **playground-oj 对齐**：5 个 `contract.ts` 删除、handler 迁 `.schema`+`.response`、`openapi.json` 干净再生（去手工 `del`→`delete` 与 operationId 改名）、`__client` 重生成、web 消费点改原生 operationId 派生名；`global.d.ts` 同步 devkit 的 `Function.response` / `Object`（组级 `.route`/`.schema`/`.response`）声明；`UploadedFileMeta.key/url`、`NotificationItem.link: string|null` 类型桩修正（tsc 0 错误）。
- **清理旧契约产物遗留**：删除 playground-oj 5 个 per-module `routes.json` + `openapi.yaml`、旧 `apps/playground` `__client` 三件套（`contract.ts`/`routes.json`/`openapi.yaml`，后者 typecheck 随修复）；`ojm dev` 的 `contract.ts` 热更监听分支移除，改监听工程根 `openapi.json` 触发 `__client` 重生成（新流水线等价物）；`--check` 的 routes.js 对账注释订正（对比对象是 openapi.json 契约路由表，非 routes.json）。`api/docs/openapi.yaml` 为 `ojm api --docs` 现行产物，保留。

### Dependencies

- 双包 lockstep 升至 `0.1.20`（`@oj-module/runtime` + `@oj-module/cli`）；**`@plane/kit` / `@plane/editor` 同步锁步升至 `0.1.20`**（四包 lockstep 门禁要求；二者无代码改动，纯版本对齐，`shell-dist/versions.json` 与 `vendor/host-versions.json` 随重建同步）；oj 最低版本门禁 **0.1.73**（平级 `.response` 需 v0.1.72，`del`→`delete` 操作键归一需 v0.1.73）。

## [0.1.18] - 2026-10-14

### Added

- **标签页关闭前守卫 `beforeClose`**：`addTab` 可给页签挂 `beforeClose: () => boolean | Promise<boolean>`（数组注册、按函数引用去重、多模块叠加），五个关闭动作（单个/右/左/其他/全部）关闭前顺序 await 守卫，任一否决或抛错即整批取消（事务式）；守卫 await 期间页签保留、组件挂载，模块可安全弹「未保存」确认框。`resetTabs`（登出/401 下线）显式绕过守卫。批量关闭精确删除批准时刻的集合（TOCTOU 防护），同一 key 并发关闭去重。用法与 14 条 BDD 用例见 `docs/prd/202610142230-tabs-before-close-bdd.md`、`docs/devkit/manual.md`「页签与未保存守卫」。
- **`ojm api --check` 支持字符串字面量组键与模块根嵌套组 stub 去重**：连字符组名（`"push-broadcast"`）参与路由对账；handler 住在模块根单文件（DDD reshape 形态）时不再生成镜像 stub（`handler-scan.ts` 三方共用扫描器 + `implemented` 过滤）。

### Changed

- **BREAKING：`ojm api` 生成目录 `client` → `__client`**：发现阶段兼容旧 `client/`（deprecation 告警），生成一律写 `__client/`；存量模块请跟随改名（import 路径 `./client/api` → `./__client/api`）。
- **BREAKING：五个页签关闭动作返回类型 `Promise<void>`**：TS 调用兼容（fire-and-forget），但状态变更由同步变异步——依赖「调用后同步读到新 openTabs」的代码需改为 await。
- **oj 最低版本门禁 `MIN_OJ_VERSION` 0.1.50 → 0.1.69**：旧 vendored oj 会 fail-fast，`ojm vendor 0.1.69` 升级。存量工程注意 oj v0.1.58 起 `server.api_prefix/base` 已删除（改 `mounts:` 表达，见 oj devkit §3.1）。
- **init 模板 api 层 DDD reshape（oj v0.1.64 嵌套 handler 组）**：auth（login/logout/refresh 收模块根单文件，保留 `_shared/session.ts`）、notification（按人通知 + 广播两表 + `_shared/notify` 发射原语 + push/del + 403 归属校验，全量对齐 playground-oj）、system/playground 同步。组名 = 路径段，≤4 层，`route`/`schema` 保留键，`del` 保留动词键（不能作组名）。

### Dependencies

- 双包 lockstep 升至 `0.1.18`（`@oj-module/runtime` + `@oj-module/cli`）；oj 最低版本门禁 0.1.69（playground-oj vendored 同步）。

## [0.1.17] - 2026-10-14（补记）

### Added

- **通知面升级为按人真实通知 + 跨模块 push/del 原语**：`notifications` 表按人归属（user_id + link 深链 + category 类别），新增广播两表（`notifications_broadcast` / `_read`）；后端模块可 `import { pushNotice, pushBroadcastNotice, delNotice }` 直接发射，`markRead` 校验归属（非本人 403）。e2e 11 用例覆盖（`tests/e2e/notification.spec.ts`）。
- **`ojm --version` / `-V`**：显示 cli 包版本。

### Fixed

- **`ojm api --check` 支持 oj 嵌套 handler 组对账**（跨仓 VERB_OF 同步，oj v0.1.64）。
- **生成 client 的 `toApiError` 改读 ky `error.data`**（此前取错字段导致业务错误信息丢失）。

### Dependencies

- 双包 lockstep 升至 `0.1.17`（`@oj-module/runtime` + `@oj-module/cli`）；通知模板 client 与 host-versions 同步。

## [0.1.16] - 2026-10-13

### Added

- **`vditor` 入宿主共享依赖表——Markdown 编辑器与宿主单例共享**：npm 包是 webpack UMD 单产物（无 ESM 出口、仅 default 导出），shell 预构建按既有 CJS/UMD interop 链路（starShim / A22 显式转发）打成 `/assets/vditor.js`（gzip ≈110 KiB）自包含 ESM 资产；`vditor/dist/index.css` 按 `nprogress/nprogress.css` 同款样式垫片成 `/assets/vditor-index-css.js`。均为**软共享**（无单例语义），且惰性生效——importmap 只做映射，宿主自身不 import vditor，模块进编辑器页时才拉取，不进宿主首屏。模块侧写法不变：`import Vditor from "vditor"` + `import "vditor/dist/index.css"`，vditor 移入 `devDependencies` 对齐版本。注意：vditor 运行期按需拉的 lute / i18n / 图标 / 主题 CSS（默认第三方 CDN）**不随共享资产分发**，由模块自行处理；`vditor` 其余 dist 深路径仍走「前缀命中但无 importmap 键 → 构建期报错」规则。用法见 `docs/devkit/manual.md` §2.6「vditor（Markdown 编辑器，软共享）」；模块侧 external 断言见 `tests/cli/vditor-external.test.ts`。

### Dependencies

- 四包 lockstep 升至 `0.1.16`（发布脚本 `scripts/publish-packages.mjs` 的 lockstep 门禁要求同版；本版**实际改动仅在 `@oj-module/cli`**，runtime / kit / editor 无代码变更）；`@oj-module/core` 不在锁步组，维持 `0.1.13`。
- 新增共享依赖钉版：`vditor` 4.0.0（软共享，入 catalog 与 cli devDependencies）；共享矩阵 66 项 → 68 项。其余钉版不变，完整矩阵以 `pnpm exec ojm info` 为准。

## [0.1.15] - 2026-10-12

### Added

- **运行时导出 `useTabsStore`——模块可自设页签标题**：此前页签文案只能取路由 `handle.title`（静态 i18n key），无法跟随运行期数据（如当前文档名）。现在 `@oj-module/runtime` 导出 `useTabsStore`（`setTableTitle(routePath, title)` / `resetTableTitle(routePath)`），页面拿到数据后用 `useTabsStore(s => s.setTableTitle)` 覆盖已打开页签的文案；列表页 / `index` 路由复用同一路径展示不同内容时，离开须 `resetTableTitle` 复位。用法见 `docs/devkit/manual.md` §6.3；出口白名单测试已覆盖（`tests/runtime/runtime-exports.test.ts`）。

### Dependencies

- 四包 lockstep 升至 `0.1.15`（`@oj-module/runtime` / `@oj-module/cli` / `@plane/kit` / `@plane/editor`）；`@oj-module/core` 不在锁步组，维持 `0.1.13`。
- 宿主共享依赖钉版快照见 `packages/cli/shell-dist/versions.json`（66 项）；关键项：`react` 19.2.8 / `react-dom` 19.2.8 / `react-router` 7.18.2 / `@tanstack/react-query` 5.102.8 / `antd` 6.6.1 / `i18next` 26.4.0 / `react-i18next` 17.0.12 / `zustand` 5.0.15 / `dayjs` 1.11.23 / `echarts` 6.1.0 / `motion` 12.43.0。`oj` 最低版本门禁 `MIN_OJ_VERSION = 0.1.50` 不变。完整矩阵以 `pnpm exec ojm info` 为准。

## [0.1.11] - 2026-10-07

### Added

- **静态托管的 HTML 变换钩子（`htmlTransform`）—— 按路由注入 title/OpenGraph**：此前 `static-handler` 的 `serveHtml` 是「逐字节原样送出宿主 index.html」+ dev-only 的 reload 注入，所有 SPA 路由（含公开分享页）在服务端拿到同一份 HTML ⇒ IM（微信/Slack/飞书）链接预览与不执行 JS 的爬虫只能看到默认标题。现在 `web.config.ts` 可配 `htmlTransform: "./html-transform.ts"`（相对工程根路径或包名），`ojm dev` 与 `ojm preview` 在起 oj **之前**加载并校验它，模块 default 导出 `(path, html) => string | { html, cacheControl? } | Promise<…>`（`path` 为解码后请求路径）——`/`、`/index.html` 与 SPA history 回落的深链接统一经这一个注入点，顺序为 transform → reload 脚本（dev 工具链不受影响）；返回的 `cacheControl` 逐路由覆盖 `Cache-Control`。**未配置时状态码/响应头/响应体与历史逐字节一致**；变换抛错或返回非字符串只打日志并回退原文（单条路由的坏变换不得让站点 500）；非 HTML 资产完全不受影响。
- **契约 `form` 槽：multipart/form-data 上传**（`defineApi({ form: { fields, files } })`）——此前契约只会发 JSON 请求体，后端的 multipart 上传端点只能绕过生成 client 手写请求。现在：`form.fields` 用 zod 描述**文本部件**（字段名即表单部件名，进 OpenAPI 的 `multipart/form-data` JSON Schema），`form.files` 只声明 `name` / `required` / `multiple`（二进制刻意不进 schema）；生成 client 的调用形态 = `{ fields: {...}, files: { avatar: File|Blob, gallery?: File[] } }`，内部组装 `FormData` 并以 `body` 发送（`content-type` 交运行时按 boundary 自动补）。`form` 与 `body` 互斥、定义期即拒；`--check`、routes.json、stub 全链路跟随。无 `form` 的契约产物逐字节不变。

- **`ojm api` 生成 client 工厂化（create<Module>Client(ctx)，构造即 install）**：生成物 `web/src/<模块>/client/api.ts` 新增 `API_PREFIX` 常量（契约前缀唯一真源，与契约 `defineApi` 的 `apiPrefix` 天然一致）与 `create<Module>Client(ctx)` 工厂——模块 entry 的 `onInit` 里一行 `const client = createNotificationClient(ctx)` 即完成 apiPrefix 登记 + scoped request 绑定，不再手写 `ctx.register.apiPrefix(...)` + `bindRequest(...)` 两行样板，杜绝「登记了前缀没绑 request」的半接线状态。重复构造幂等安全；一模块一 client。模板、playground/playground-oj、根仓 `web/home` 已全部迁移；新人上手见 [`docs/202609130035-provider-guide.md`](docs/202609130035-provider-guide.md)。设计见 [`docs/prd/202609130128-client-factory-design.md`](docs/prd/202609130128-client-factory-design.md)。

### Deprecated

- 生成 client 的 `bindRequest(ctx.utils.request)` 标记 `@deprecated`（保留作逃生口）——请改用 `create<Module>Client(ctx)`。**属生成物形状破坏性变更**：外部工程升级 cli 后重跑 `ojm api` 需同步改 entry（当前无外部工程，影响面为本仓库，已完成迁移）。

### Added

- **`ojm dev` 增加 Vite 风格交互快捷键（仅 TTY）**：`r` 强制重建并热更新、`h` 显示帮助、`c` 清屏、`o` 浏览器打开、`q` 退出（后端 oj 一并终止）；`usage` 帮助文本补充快捷键映射。

### Fixed

- **`ojm dev` 以最新 oj 0.1.50 为唯一基线对齐**：`oj` 启动子命令 `server` → `serve`；版本门禁 `MIN_OJ_VERSION=0.1.50`；`build` 加 `--no-minify` 绕开 oj swc 把 `await X[0]` 重排、三元变 `&&` 的 bug；`ojm api` 新增后端入参 `.schema` 发射（oj 在 JS 前校验）；`init` 把 `jwt_secret` 密封为 `ENC[...]` + `secrets:` 段；`oj-cmd.ts` 透传 `test/exec/openapi/migrate/schema` 并自动补 `-c`；dev-proxy 502 信封对齐 oj 的 `{code,msg,data}`；contract `--check` 升级为四重对账（新增 WS 路由鉴权）。模板与 playground-oj 升 0.1.50。
- **`ojm dev` 终止时后端 oj 随之消亡**：抽出 `shutdownDev`，注册 `SIGINT`/`SIGTERM` 优雅停机并加进程退出兜底同步强杀 oj，杜绝 oj 孤儿占端口；`oj` 日志透传移除冗余 `[oj]` 前缀叠加（oj 自身 tracing 已含 `[oj]`）；`usage` 过长说明改为多行展示、并修正 `--check` 文案为四重对账。

### Removed

- **全面移除 `ram` 命令别名**：删除 `bin/ram.mjs` 与 `package.json#bin` 的 `ram` 入口、`usage` 别名说明；存量工程 scripts 需把 `ram` 改为 `ojm`。文件层兼容（`.ram-api-exempt.json` / `ram-api:stub` 指纹头 / `Symbol.for("ram.api.def")` / `RAM_DEBUG`）仍保留，存量工程生成物无需手改。

## [0.1.8] - 2026-09-12

### Changed

- **模块工程布局硬切换 `modules/` → `web/`**：模块工程（`ojm init` 模板、playground）源码目录改为 `web/src` + `web/dist` 配对，配置文件 `modules.config.ts` 更名 `web.config.ts`；`layout.ts` 删除 legacy 分支，存量 `modules/` 工程会得到人话迁移报错。产物协议不变（`modules.json`、`dist/modules/<name>/<version>/` 照旧）。框架根仓平铺 `web/<name>/` 形态由 layout `flat` 分支支撑。设计见 [`docs/prd/202609112324-web-layout-and-codegen-guide-design.md`](docs/prd/202609112324-web-layout-and-codegen-guide-design.md)。
- **`ojm api` 生成目录 `api/` → `client/`**：生成物由 `web/src/<模块>/api/{client.ts,client.schemas.ts}` 调整为 `web/src/<模块>/client/{api.ts,api.schemas.ts}`，与后端顶层 `api/` 消歧；纯前端契约位置同步为 `web/src/<模块>/client/contract.ts`；runtime 内部 role client 同规迁移。契约发现、`--check` 对账与报错文案全部跟随。

### Added

- `api/.ojm-api-exempt.json` 新增 `_comment` 自说明字段（作用、`modules`/`paths` 配法、一层通配语义）。注意：豁免清单为严格 JSON，写 `//` 注释会解析失败并**静默回退空豁免**——说明文字一律走 `_comment`。
- 新增新人指南 [`docs/prd/ojm-api-codegen-guide.md`](docs/prd/ojm-api-codegen-guide.md)：契约 → evaluate → IR → 四产物 → stub → `--check` 三重对账 → 豁免清单全链路机制与排错速查。

## [0.1.7] - 2026-09-11

### Added

- `ojm init` 模板新增 **personal-center 模块**（前端 my-profile/settings 页 + 后端 `POST /api/personal-center/upload` 头像上传）——runtime 用户菜单固定导航 `/personal-center/my-profile`，此前脚手架工程点击必落空。配套：`users` 表新增 `avatar_base64` 列（`_platform` 迁移 0002）、`user-info` 改为 db 回读头像、模板 `env.d.ts` 补 `window.$message` 全局类型。设计见 [`docs/prd/202609112006-init-template-personal-center-design.md`](docs/prd/202609112006-init-template-personal-center-design.md)。
- 宿主版本矩阵（`versions.json`）收录 tooling 项 `typescript` / `@types/react`——`ojm init` 生成的 devDependencies 全部钉版，不再有 `*` 回退告警。

### Fixed

- **宿主链暗黑模式 footer 露白**：shell 宿主（`host.tsx`）误用 antd 原生 `App`，从未写入 `--oo-*` 主题变量（tailwind 语义色工具类的唯一来源）——亮色下透明≈白不可见，暗黑模式暴露。宿主改用 runtime 导出的 `AntdApp`（变量同步 + `window.$message/$modal/$notification` 静态函数一并补齐）。设计见 [`docs/prd/202609112121-shell-dark-css-vars-design.md`](docs/prd/202609112121-shell-dark-css-vars-design.md)。
- `ojm init` 生成 devDeps 缺 `@ant-design/pro-components`（personal-center 的 ProForm 类型来源），已补钉版。
- `apps/playground-oj`：`personal-center/upload` 回写不存在的 `users.avatar_base64` 列（上传必 500），补迁移与 `user-info` 回读。

### Changed

- `ojm vendor` / `ojm init`：oj 二进制下载源从 GitHub releases 切换为 **npm 包 `@oj-bin/oj`**（临时目录 `npm i` 后拷贝 `bin/` 进工程，零污染用户工程）。平台选择、完整性校验（npm dist.integrity）、registry 镜像均由 npm 承担；`GITHUB_TOKEN` 与代理指引随之退役。设计见 [`docs/prd/202609111926-vendor-npm-install-design.md`](docs/prd/202609111926-vendor-npm-install-design.md)。

## [0.1.6] - 2026-09-11

### Added

- `@oj-module/cli`：`exports` 的 Node-only 子路径（`.`、`./build`、`./shared-deps`、`./esm-exports`、`./config`、`./manifest`、`./info`）新增 `browser` 条件，指向 `src/browser-guard.ts`——浏览器打包误引用时**显式报错**，不再静默拖入 Node 依赖；`./shell-dist/*` 是浏览器资产，不受此条件影响。

### Changed

- `@oj-module/runtime`：发布包的 `imports` 收窄为仅 `#src/*`（原 `#modules/*` 已无引用、`#manifest.json` 指向包外 `../../manifest.json`）。仓库 App 链对 `#manifest.json` 的解析改由本仓 `vite.config.ts` 提供——该需求属于仓库自身，不进入对外发布的包。

### Fixed

- `ojm api --check`：被删除的 stub 不再被静默放过（`create` 视为生成物过期，与 client/routes/openapi 口径一致）。
- `ojm api --check`：CRLF 检出（Windows `core.autocrlf=true`）不再把未改动的 stub 误报为「待更新」（指纹哈希本就按 LF 归一，字节比较同步归一）。
- `ojm api --check`：oj 路由表的短方法名 `del` 归一为 `DELETE`，uni-dev 工程里的 DELETE 端点不再误报 `routes-js-drift`。

### Internal

- 新增 `release-manifest.test.ts`：真跑 `pnpm pack` 守卫两包**发布态**——无 `workspace:`/`catalog:` 协议字面量、0 个 sourcemap、cli 对 runtime 精确且 lockstep 依赖、runtime 包内无 `.ts` 源（US-7）。版本断言改读源 `package.json`，发版不再需要改测试。
- 新增旧 scope 零残留测试与 runtime `imports` 边界断言。

## [0.1.5] - 2026-09-11

**`@oj-module` scope 首个版本**（由 `@react-antd-module` 全线迁移而来）。

### Added

- 命令 `ojm`（原 `ram` 保留为**弃用别名**：向 stderr 打印更名警告后转发，下个 major 移除）。
- 旧名兼容读取，存量工程升级无需手改：`api/.ram-api-exempt.json`（双名读）、stub 指纹头 `// ram-api:stub`（双前缀读）、端点品牌 `Symbol.for("ram.api.def")`（IR 双符号）、环境变量 `RAM_DEBUG`（`OJM_DEBUG` 优先）。

### Changed

- **架构：4 包并为 2 包，按运行环境切分**
  - `contract` 并入 `@oj-module/runtime`，作为 `./contract` 与 `./contract/errors` 子路径（编成 `dist`）。
  - 预构建宿主并入 `@oj-module/cli`（源码 `packages/cli/shell/`，产物 `packages/cli/shell-dist/`，随 cli 发布）。
  - 依赖方向只剩 `cli → runtime` 一条边；`cli` 对 `runtime` 写 `workspace:*`，发布时由 pnpm 改写为**精确版本**。
- **品牌与命名**：`@react-antd-module/*` → `@oj-module/*`；内部前缀 `ram-*` → `ojm-*`（日志 `[ojm]`/`[ojm-api]`、临时文件/DOM 标记、dev SSE 端点 `/__ojm_reload`、自动生成的子路径资产名等）。
- 两包对齐为同一版本号（lockstep）。

### Deprecated

- 旧 scope 的四个包（`@react-antd-module/{contract,runtime,cli,shell}`）**所有版本已在 npm deprecated**，安装时会打印迁移指引。

## 历史（迁移前的四包时代）

`@react-antd-module/{contract,runtime,cli,shell}` 的 0.1.x 系列为迁移前的四包形态（`contract` 0.1.3 / `runtime` 0.1.4 / `shell` 0.1.4 / `cli` 0.1.5），对应提交与开发方式见 [`docs/prd/framework-development-guide.md`](docs/prd/framework-development-guide.md)。自 `@oj-module` 首发起沿用 `0.1.5` 版本号，并进入双包 lockstep。

[0.1.8]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.8
[0.1.7]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.7
[0.1.6]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.6
[0.1.5]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.5
