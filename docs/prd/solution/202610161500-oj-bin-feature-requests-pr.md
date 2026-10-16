# oj-bin 功能诉求（PR 文本，供手动提交）

> 状态：草案 · 日期：2026-10-16 · 上游：`202610152345-solution-marketplace-framework-prd.md`（§5.4 对外依赖清单 / §6.2 R1/R5）、`202610161300-solution-lifecycle-registration-design.md`（§9.1）
> **本仓对 oj 只读**：以下每节 = 一个可独立提交到 oj-bin 的 PR/issue 文本（标题 + 正文，可直接粘贴）。证据均以 oj 0.1.74 实测与 devkit 文档（`~/.local/share/oj/devkit/`）为准。
> 优先级：P0 = 阻塞 M6 收敛（安装闭环后端原生化）；P1 = 显著简化；P2/P3 = 优化/远期。

---

## PR-1（OJ-4，P0）：crypto 新增 Ed25519 验签

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

**标题**：`mounts: 支持 URL 形态的 api mount（远期）`

### 动机
当前 `mounts[].api` 只能本地目录（api-manual §2699：一行 = 一个绝对 URL 前缀 + 一个本地目录；装配期校验目录存在）。真正的「CDN 远程装载」对后端成立的唯一路径是允许 mount 指向 URL，运行时按需拉取 + 内容寻址缓存。

### 前置依赖
OJ-1（解压）、PR-5（YAML/manifest 解析）、以及缓存目录与完整性（sha256/SRI）策略；牵涉装配期 admission gate 的扩展校验，建议单独立项设计后再排期。
