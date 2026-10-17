# oj-bin 功能诉求（PR 文本，供手动提交）

> **编号登记**：`OJ-1`~`OJ-6` 已用于下方 PR-1~PR-5。
> **PR-6（OJ-7）**：表级写守卫（`ownership_guard` 读写分离 + 属主侧写授权）——篇幅较大，独立成文，见
> [`docs/prd/202610170016-oj-table-write-guard-requirement.md`](../202610170016-oj-table-write-guard-requirement.md)。
> 提出背景：`docs/prd/20261016-solution-module-rbac-isolation-design.md` §2（模块间写隔离的结构性保证）。
> **D10 豁免面注记**：`_platform` 特权模块是表级写守卫的**结构性豁免面**（生命周期实现设计
> `202610171138-solution-lifecycle-implementation-design.md` §0 D10），随 PR 一并注明。
> **编号追加（2026-10-17 C4）**：`OJ-9` 已占用（PR-8，down 迁移支持）。

---

## 重新评估（2026-10-17，oj 0.1.75 / 0.1.76 devkit 新文档 + 本机 oj 0.1.76 实测；同日 C4 复核：OJ-8/OJ-6 已决议提交、新增 OJ-9）

oj **0.1.75** 一次性落地了本文件 6 条诉求里的 4 条（形态与提议 API 不完全一致，但语义覆盖），
且 `scenarios.md` **场景 35「解决方案市场模块安装闭环（v0.1.75）」**就是本文件目标链路的官方范式
（`fetch` → `sha256Hex` → `verifyEd25519` → `exec.run tar` → `yaml.parse` manifest →
config 回写 → `oj migrate --format json` → `server.reloadConfig`），可直接照抄。
下文 PR-1~PR-6 保留作历史存档，各条已就地标注处置。

| 编号 | 原诉求 | 现状（oj 0.1.76 实测） | 处置 |
|---|---|---|---|
| OJ-4 / PR-1 | Ed25519 验签 | ✅ `crypto.verifyEd25519(pub, msg, sigB64): boolean` 已存在，同步返回、双层语义 | **关闭，不提交** |
| OJ-1 / PR-2 | tgz 解压 | ✅ 无内建 `fs.untarGz`，但 `exec.run` + `platform.exec` argv 白名单 + tar 三步范式已给安全落位（scenarios 场景 34） | **关闭**；Windows 缺 tar 的报错可操作性问题另立 **PR-7（OJ-8）** |
| OJ-2 / PR-3 | 热更进程内触发 | ✅ `server.reloadConfig()` 已存在，限 `platform.modules` 特权模块 | **关闭，不提交** |
| OJ-3 / PR-5 | YAML 只读解析 | ✅ `yaml.parse(text)` 已存在（异步、三预算防炸弹），并额外给了 `yaml.stringify` | **关闭，不提交** |
| OJ-6 / PR-4 | 迁移内部化 | ⚠️ 无 `migrate.run` 全局；官方路径 = `exec.run(["oj","migrate","-c",…,"--format","json","-d",…,mod])` + 判 exit code（场景 35 步骤 7） | **P0 已决议提交**（2026-10-17，提交稿见同目录 C4 提交稿 `202610171400-oj-bin-submissions/oj-6-migrate-run-internalization.md`）；v3 下 `exec.run` 即主路径，内化降级为可选优化 |
| OJ-5 / PR-6 | 远程 api mount | ❌ `mounts[].api` 仍只认本地目录（api-manual §mounts 无 URL 形态） | **维持远期**，暂不提交 |

**实测证据**（`~/.local/share/oj/oj exec -e`，oj 0.1.76）：

| 用例 | 结果 |
|---|---|
| `typeof crypto.verifyEd25519` / `yaml.parse` / `exec.run` / `server.reloadConfig` / `http.module` | `function` / `function` / `function` / `function` / `object` |
| 正确签名 | `true` |
| 篡改 msg / 错误公钥 / 他用密钥签名 | `false` |
| 非法 base64 | 抛 `verifyEd25519: signature not base64: Invalid symbol 33, offset 3.` |
| 2 字节公钥 | 抛 `verifyEd25519: public key must be 32 raw bytes (got 2)` |
| `crypto.sha256Hex(new Uint8Array([1,2,3]))` | `039058c6…`（二进制入参可用；非 string/二进制入参现抛 `expected typed ArrayBufferView`——**0.1.75 行为变更**，老调用需自查） |
| `await yaml.parse("a: 1\nb: [x, y]")` | `{"a":1,"b":["x","y"]}`（**须 await**，返回 Promise） |
| 未配 `platform:` 调 `exec.run` / `server.reloadConfig` | 抛 `exec not configured (config platform.exec section missing)` / `platform not configured (config platform: section missing)`（fail-closed 生效） |

> 注：§13 限制表写的 `NotCapable: platform not configured …` 与实际文案
> `platform not configured (config platform: section missing)` 略有出入——文档仍非逐字可信，结论以实测为准。

**同批落地、本文件未提但影响 M6 设计的能力**：

- `platform:` 配置段（0.1.75）：特权模块名单 + `platform.root` 受控挂载根 + `trusted_paths` 授权路径根
  → 这是安装器能回写 `config.yaml` 的前提（特权 fs = `fs.root ∪ trusted_paths`，且 `fs:` 段须已配；
  特权模块**只能由部署方手工放入受控根**，不得来自市场安装树，装配期抢注 fail-fast）。
- `http.module`（0.1.76）：只读模块身份 `{name, version}`，被定为框架授信依据
  （跨模块表归属守卫 / bound_db 重定向 / 平台特权换装）——与 OJ-7 表级写守卫同源。

**下游文档同步状态**（2026-10-17 已完成，本文件为唯一登记处）：

| 文档 | 同步内容 |
|---|---|
| `docs/prd/solution/202610161300-solution-lifecycle-registration-design.md` | §1 安装行加 oj 能力复核脚注；§9.1 依赖表由 4 行扩为 6 行（补 OJ-7 / OJ-8）并逐条标状态 |
| `docs/prd/solution/202610152345-solution-marketplace-framework-prd.md` | §2 E7 证据条标注过期；§5.4 诉求清单逐条标状态；§5.6.3 迁移执行主体加复核 + Windows 前置；§6.1 可行性表 3 行、§6.2 R1/R5、§7 M7 同步 |
| `docs/prd/20261016-solution-module-rbac-isolation-design.md` | 头部「前提（尚未落地，需先 POC）」→ 已落地（v0.1.76）；文档关系表外部依赖 OJ-7 状态刷新 |
| `docs/prd/202610170016-oj-table-write-guard-requirement.md` | 顶部编号接续说明补 OJ-8 与「OJ-7 为唯一遗留阻塞项」 |

---

## PR-1（OJ-4，P0）：crypto 新增 Ed25519 验签

> **状态：✅ 已落地（oj 0.1.75 `crypto.verifyEd25519`），不再提交。**
> 落地形态与提议 API 一致（`verifyEd25519(publicKey, msg, sigBase64): boolean`，同步），
> 额外给了双层语义（格式错抛错、验签不过返回 `false`）；
> 原「现状证据（oj 0.1.74 实测）」与「兼容性：需补 global.d.ts」两项已过期
> （声明见 devkit `global.d.ts:659`，手册 api-manual:2289-2315）。
> 注意 0.1.75 顺带改了 `crypto.sha256Hex`：非 string/二进制入参由 `String()` 强转改为抛 TypeError。

**标题**：`crypto: 新增非对称验签能力（Ed25519 crypto.verify）`

**正文**：

### 动机
解决方案市场（oj-module PRD §5.7）把 CDN 视为不可信通道，对分发的 bundle 做 fail-closed 包签名校验：规范串 `"<name>@<version>:<sha256>"` 用 Ed25519 签名（密钥 32 字节、无 ASN.1 解析坑、适合离线保存的发布密钥）。当前验签只能在 Node 侧（`ojm install`）完成，后端 JS 无法自完成安装闭环，M6「后端原生化」被此阻塞。

### 现状证据（oj 0.1.74 实测）
JS 面 `crypto` 仅有：
- `sha256Hex(s)` / `randomHex(nBytes?)` / `getRandomValues(view)` / `aesGcm*`（devkit `global.d.ts:562-571`）

**无任何非对称能力**（无 sign/verify/生成密钥对；`jwt.verify` 只验自家 token）。

### 提议 API
```ts
interface Crypto {
  /** Ed25519 验签：publicKey 支持 hex/base64 原始 32 字节公钥；msg 为 UTF-8 字符串；sig 为 base64 */
  verifyEd25519(publicKey: string, msg: string, sigBase64: string): boolean;
}
```
（命名与参数形态可议；核心诉求 = 单一布尔验签原语，密钥来自 `vars.get(...)` 或配置。）

### 使用场景
安装器在解压前：① `sha256Hex(tgz)` 与 manifest 比对 → ② `verifyEd25519(pubkey, "<name>@<version>:<sha256>", sig)` → 任一失败不落盘、不改锁、不触发热更（fail-closed）。

### 兼容性
纯新增接口，不改既有行为；需同步补 devkit `global.d.ts` 声明与 api-manual 条目。

### 验收标准
正确签名通过；篡改 msg 拒绝；错误公钥拒绝；非法 base64 显式报错；32 字节以外公钥长度拒绝。

---

## PR-2（OJ-1，P0）：归档解压能力

> **状态：✅ 已落地（oj 0.1.75，形态为「`exec.run` + 系统 tar」而非内建 `fs.untarGz`），不再提交。**
> 原「安全红线」四条已由官方三步范式覆盖：`tar -tzf` 预检（仅快速失败）+ 成员名复检 →
> 解压到 `.staging` → **解压后全量 walk 为权威校验**（symlink/hardlink/设备零容忍、组件级拒 `..`、
> 总体积对账）→ 原子 rename；`exec.run` 无 shell、argv 模板白名单（literal 逐字 + `${path:}` jail
> 校验 + `${raw:}` 拒 option 注入），缺省全 deny。见 scenarios 场景 34、api-manual §6「exec」。
> **残留风险 → 已独立成 PR-7（OJ-8）**：`exec.run` 依赖宿主 PATH 能解析到 `tar`
> （子进程 env 清空、不继承 PATH，由宿主侧解析），Windows 发行包与无 tar 的最小容器镜像无此保证，
> 且失败时报错不可操作。处置见下方 PR-7：只要求 Windows 下报错给 Git Bash 提示，不提内建解压。

**标题**：`fs: 新增 tgz 解压（fs.untarGz 或 axis("archive") 插件）`

**正文**：

### 动机
解决方案安装的「解压落位」步骤（下载 → 校验 → 解压 `.staging` → 原子 rename）目前必须由 Node 侧 `ojm install` 子进程执行；后端原生化需要 oj 自身具备归档解压。

### 现状证据
`FsApi` 仅 9 个方法（devkit `global.d.ts:239-250` 一带）；JS 全局**无 tar/gzip/zip 解压、无 YAML 读写**；有 `fetch(url)`、`fs.writeFile`、`axis(name)` 泛型插件轴。

### 提议 API（二选一）
```ts
// 方案 A：内建 fs
fs.untarGz(bytes: ArrayBuffer, destDir: string): Promise<ExtractedEntry[]>
// 方案 B：插件轴（与 ldap/ axis 同型，便于独立演进与按需裁剪）
axis("archive").untarGz(bytes: ArrayBuffer, destDir: string): Promise<ExtractedEntry[]>
```

### 安全红线（必须）
解压须防路径穿越：拒绝 `../`、绝对路径条目、symlink 逃逸；一律在目标目录沙箱内展开，越界条目报错并中止（不部分落盘）。入口大小上限与条目数上限可配（防 zip-bomb 类资源耗尽）。

### 验收标准
正常 tgz 解压成功且逐文件 mtime/mode 保留可选；路径穿越样本（`../evil`、绝对路径、symlink 指向目录外）全部拒绝；损坏归档显式报错。

---

## PR-3（OJ-2，P1）：配置热更进程内触发

> **状态：✅ 已落地（oj 0.1.75 `server.reloadConfig()`），不再提交。**
> 返回结构 `{generation, unchanged, applied[], restart_pending[], kept_listener[]}`——比原提议多一个
> `unchanged`（幂等时三清单为空）；与 `POST {base}/_system/config` 同一 executor、同一把串行锁
> （并发第二次触发 → `server.reloadConfig: reload in progress (busy)`）；`oj test` / 嵌入式抛
> `reload not available`。门禁同原提议：限 `platform.modules` 特权模块，非特权调用被拒。
> 见 api-manual:967、:1769-1793。

**标题**：`server: 提供配置热更的进程内触发 API（免 loopback HTTP + Bearer）`

### 动机
安装器在更新 `config.yaml`（`anonymous_paths` 并入、`vars.ojm_solutions_gen` 自增）后需要触发热更。当前唯一手段是 `POST {base}/_system/config`（空 body，api-manual §2762）——业务模块触发需 loopback 回环 + 管理员 Bearer，且该端点无法进 `anonymous_paths`（写端点不应匿名），被迫在 Node 侧绕行。

### 提议
平台内部 API（仅 `_platform`/框架模块可达，不进业务模块面）：
```ts
server.reloadConfig(): Promise<{
  generation: number
  applied: string[]
  restart_pending: string[]
  kept_listener: string[]
}>  // 语义与 POST _system/config 完全一致（幂等 sha256 unchanged / 段 diff 三清单）
```
或等价方案：给 `_system/config` POST 增加平台内部白名单通道。

### 验收标准
返回结构与 HTTP 端点一致；`unchanged`/`applied`/`restart_pending` 语义逐字对齐；非特权模块调用被拒。

---

## PR-4（OJ-6，P1）：迁移执行内部化

> **终裁（2026-10-17）：未采纳——维持经 exec 触发。**`"oj"` 解析器映射 `current_exe` 拉起同一 bin/oj 子进程，复用已审计白名单 + 超时/输出闸门；独立子进程与请求运行时解耦、防大表迁移占用 JsRuntime/DB 池、防 KillSwitch 误杀、失败隔离更干净。更强内嵌诉求走 RFC。消费方处置：exec 绕行转**永久主路径**。以下原文保留。
>
> **状态：⚠️ 降级为 P2 可选。无 `migrate.run` 全局 API，但已有官方绕行：**
> `exec.run(["oj","migrate","-c",cfg,"--format","json","-d",dir,"<name>-<version>"])`（模板须先写进
> `platform.exec.<模块>.allow`；`oj` 特判解析为 `current_exe()`，即同版本自保证），
> 输出 `{"results":[{module,ok,error?}], error}`；**成败真源是 exit code**（任一模块失败时 json 仍可解析，
> 但 `results[].ok=false` 且进程退非 0）。大表迁移记得把 `timeoutMs` 从缺省 30s 调大（硬上限 600s）。
> 原「红线」两条均成立且与绕行不冲突：release 默认 `migrate_on_start: verify`，账本落后拒启 M004
> （约束 B 由框架保证，不可绕过）；oj 迁移只前向无 down，失败由安装器删版本目录 + 恢复锁。
> 若仍要提，诉求应改写为「内建 `migrate.run` 去掉子进程开销与 exit-code 契约摩擦」，不再是阻塞项。

**标题**：`migrate: 暴露进程内迁移触发（免外部 oj CLI 子进程）`

### 动机
oj 的 JS isolate 无子进程能力，安装器的「迁移」步骤（约束 B：必须先于热更）目前由 Node 侧调 `bin/oj migrate -c ... -d <共享根>`。后端原生化需进程内触发。

### 提议
平台内部 API（等价 CLI 语义）：
```ts
migrate.run(opts: { dir: string; db?: number; module?: string }):
  Promise<{ applied: MigrationRecord[]; skipped: number }>
```

### 红线
- 与热更路径的 `migrate verify`-only 语义保持一致：迁移账本落后时热更必须拒装配（约束 B 不可绕过）。
- 失败不自动回滚库（oj 迁移是前向的，无 down）；返回结构须含逐模块成败，供安装器决定「删版本目录 + 恢复锁」。

### 验收标准
sqlite/mysql/pg 三方言各跑通一次前向迁移；重复执行幂等（账本去重）；失败返回可定位的迁移序号与原因。

---

## PR-5（OJ-3，P2，可选）：YAML 只读解析

> **状态：✅ 已落地（oj 0.1.75 `yaml.parse` / `yaml.stringify`），不再提交。**
> 两个差异点：**`yaml.parse` 是异步**（Rust 阻塞池执行，必须 `await`，未 await 会拿到 Promise）；
> 有**三预算防炸弹**（输入 1 MiB / 10 万节点含 alias 展开 / 深度 128），超限抛错。
> `yaml.stringify` 虽已提供但**禁用于 config.yaml 回写**（serde_yaml 丢注释与空白）——
> 官方仍推荐原提议里那条「文本手术 → `yaml.parse` 语义复检 → sha256 自校验」三步法（api-manual:1748）。

**标题**：`增加只读 YAML 解析能力（yaml.parse）`

### 动机
安装器需要读 bundle 内 `manifest.yaml` 与合并宿主 `config.yaml`；当前只能 Node 侧解析后做文本替换回写（`anonymous_paths`/`vars` 的并 入靠正则/文本拼接，脆弱且易产生非语义 diff——E4 已实测「注释/空白变更不触发，语义 sha256 才触发」，文本替换极易误触或漏触）。

### 提议
```ts
yaml.parse(text: string): unknown  // 只读解析即可；序列化（yaml.stringify）非必需
```
config 回写仍建议「只改目标段的文本替换 + sha256 自校验」，或提供 `config.patch(patch: object)` 更佳。

---

## PR-6（OJ-5，P3，远期）：远程 api mount

> **状态：❌ 未变（oj 0.1.76 devkit 复查：`mounts[].api` 仍只认本地目录，无 URL/远端形态），维持远期。**
> 前置依赖里的 OJ-1 与 PR-5（YAML）已就位，剩缓存目录与完整性策略；仍建议单独立项设计后再排期。

**标题**：`mounts: 支持 URL 形态的 api mount（远期）`

### 动机
当前 `mounts[].api` 只能本地目录（api-manual §2699：一行 = 一个绝对 URL 前缀 + 一个本地目录；装配期校验目录存在）。真正的「CDN 远程装载」对后端成立的唯一路径是允许 mount 指向 URL，运行时按需拉取 + 内容寻址缓存。

### 前置依赖
OJ-1（解压）、PR-5（YAML/manifest 解析）、以及缓存目录与完整性（sha256/SRI）策略；牵涉装配期 admission gate 的扩展校验，建议单独立项设计后再排期。

---

## PR-7（OJ-8，P1）：Windows 下外部命令解析失败的报错契约

> **终裁（2026-10-17）：未采纳。**Windows 支持走显式模板 `cmd /c ...`（或 resolver 映射绝对路径），`cfg(windows)` BDD 已覆盖；不引入 Git Bash 自动探测——扩大解析面、与白名单显式声明安全边界冲突、跨机行为不一致。**上游口径：模板直接写 `cmd /c`，不依赖 sh 仿真层。**消费方处置：Windows 维持已知限制，P2 起如支持 Windows 安装按此口径建白名单。以下原文保留。
>
> **状态：P0 已决议提交（2026-10-17，提交稿见同目录 C4 提交稿 `202610171400-oj-bin-submissions/oj-8-windows-exec-error-contract.md`）。**
> 非阻塞：macOS/Linux 先行验收（C1 spike S1-2 已实测范式成立），Windows 另有 R30 已知限制清单。

**标题**：`exec: Windows 缺少 tar/zip 等命令时给出可操作报错（提示 Git Bash）`

### 动机
v0.1.75 的 `exec.run` 把归档解压建立在**宿主外部命令**之上（`tar -tzf` / `tar -xzf`，无 shell、
模板首 token 为裸名、按宿主 PATH 解析）。这在 Linux/macOS 上无摩擦，但在 **Windows 上不可靠**：

- Windows 10 17063+ 自带的是 `C:\Windows\System32\tar.exe`（**bsdtar**），与 GNU tar 参数/默认行为有差异
  （如 `--exclude`、wildcards、`-C` 与打包顺序），照抄场景 34 的模板可能静默产生不同结果；
- 更常见的形态是**根本解析不到** `tar`/`zip`/`unzip`——Windows 默认不带 `zip`/`unzip`，
  且 `exec.run` 的**子进程 env 是空表、不继承 PATH**，完全依赖宿主侧解析；
- 此时实现抛的是通用 `exec: command resolve failed for 'tar': …`，运维看到的是「找不到命令」，
  但**得不到下一步该做什么**——这类报错会被当成 oj 的 bug 而非环境配置问题。

### 提议（两件小事，都不改安全模型）

1. **平台特化报错文案**：`exec.run` 命令解析失败时，在 `process.platform === "win32"` 下
   追加一段可操作提示（不改变错误分类，仍为普通 `Error`）：
   ```text
   exec: command resolve failed for 'tar': <原始原因>
   hint: 此命令在 Windows 上默认不可用。请改用 Git for Windows 自带的 Git Bash 执行本操作
         （默认路径 C:\Program Files\Git\git-bash.exe），
         或把 C:\Program Files\Git\usr\bin（GNU tar / zip / unzip 所在）加入系统 PATH 后重试。
   ```
   `zip` / `unzip` 缺命令同理，只换命令名。非 Windows 平台保持现有文案不变。
2. **文档侧补一条 Windows 前置说明**：在 api-manual §6「exec」与 scenarios 场景 34 顶部注明
   「Windows 部署请用 Git Bash 或把 Git 的 `usr/bin` 加入 PATH」，避免照抄者踩空。

> 不做的事：不内置 tar、不改 `${path:}` 校验语义、不加 fallback shell。本条只解决「报错不可操作」。

### 兼容性
纯报错文案增强；仅在原本就要抛错的失败路径上加 hint，无行为分支变化、无新 API。

### 验收标准
- Windows 且 PATH 无 `tar` 时，`exec.run(["tar", ...])` 抛错**同时**含 `hint:` 段与 Git Bash 路径；
- `zip`/`unzip` 缺失同样给出对应 hint，命令名正确插值；
- 非 Windows 平台报错文案与现状逐字一致（无 hint 段）；
- 错误分类不变（仍为普通 Error，非 `NotCapable`），现有 `exec: command resolve failed` 前缀保留，
  依赖前缀匹配的调用方不受影响。

### 备注：Windows 侧另一处既有差异（非本 PR 范围，记录备查）
api-manual §6「exec」硬限制写明：超时到期先 `kill(-pgid, SIGKILL)` 整组击杀，
**Windows 无进程组对应物，仅杀直接子进程**。故 Windows 上跑 tar 解压时若 tar 派生了孙进程，
超时后可能残留。安装器的 `.staging` 清理逻辑不要依赖「超时即无残留」这一假设。

---

## PR-8（OJ-9，P3）：down 迁移支持

> **终裁（2026-10-17）：未采纳——前向-only 定版。**幂等前向 + 已应用去重是设计意图；回退 = 作者手写补偿迁移（另一笔前向 migration），回滚预览用 `oj migrate --format json` 读已应用清单人工决策。消费方处置：R12 红线（降级仅迁移无差异）即终态，devkit 引导作者提供补偿迁移。以下原文保留。
>
> **状态：待提（P3 前落地即可，非阻塞）。** 提交稿见同目录 C4 提交稿
> `202610171400-oj-bin-submissions/oj-9-down-migration.md`（含 M003/M004 实测原文与源码行号）。

**标题**：`migrate: 支持 down 迁移（或提供账本回退原语）`

### 背景
oj 迁移只前向、无 down：账本超前产物即 M003 拒启（`oj/src/migrate.rs:447-448`），人工回退账本须同步回退 DDL 并自担数据风险（官方文案原话）。解决方案市场的「降级」动作受 R12 红线约束——仅当目标版本**迁移无差异**才放行 + 强告警二次确认 + 切换前复验，含 DDL 变更的升级一旦要回退即被 M003 卡死，「回得去」不可达。

### 诉求形态（渐进两档，任一即可）
1. **内建 down 迁移**：迁移文件支持 down 侧声明（如 `V{n}__x.down.sql`），`oj migrate --down --to <version>`（或等价 CLI/模块面）；
2. **账本回退原语**（更小步）：`oj migrate rollback --module <m> --seq <n>`——只移除账本条目，DDL 回退责任在调用方，返回文案明示此点。

### 验收标准
模块由高版本降到低版本后，release 启动**不再 M003/M004 拒启**；down/回退逐条留痕（账本与日志可对账）；down 中途失败时账本与库状态的一致性可判定（不产生半回退模糊态）。

### 降级路径
无 down 时维持 R12 校验不变：只允许「迁移无差异」降级 + 强告警二次确认 + 切换前目标版本复验。

### 非目标
不做自动数据回滚（数据迁移的逆变换不在本条范围）；不改 release 缺省 `migrate_on_start: verify` 门禁；不改账本格式。
