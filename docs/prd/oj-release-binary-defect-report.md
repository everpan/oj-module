# oj 发布二进制缺陷报告：release 产物在非构建机不可用

> **受众**：only-js 维护者（可直接作为 issue 正文）。
> **状态**：已在本机（macOS arm64）对官方 release 产物复现确认。
> **严重级别**：阻断级（Blocker）。

---

## 1. 摘要

GitHub Release 分发的 `oj` 二进制在**任何非构建机上都无法初始化 JS 运行时**。凡是需要初始化 JsRuntime 的命令（`oj build` / `oj dev` / `oj serve` / `oj test` 的 introspect 路径等）一律 panic：

```
Failed to initialize a JsRuntime: No such file or directory (os error 2)
```

**已确认 v0.1.2、v0.1.11 中招**（v0.1.11 为 2026-09-11 实测）；推测**所有未启用 startup snapshot 的 release 版本都受影响**。

## 2. 影响面

- 任何用 `ram init` / `ram vendor` 拉取官方二进制的工程：`ram build` / `ram dev` / `ram preview` 必然失败。
- 仅 Rust 侧命令看起来正常（`oj --version` 成功），**掩盖问题**，排查成本高。
- 唯一可用规避：改用本地 `cargo build --release` 的产物（本机路径存在，故能跑）。

## 3. 环境

| 项 | 值 |
| --- | --- |
| 平台 | macOS / `aarch64-apple-darwin` |
| 产物 | `oj-v0.1.11-aarch64-apple-darwin.tar.gz`（经 `ram vendor v0.1.11` 下载，sha256 校验通过） |
| 版本 | `oj 0.1.11` |
| deno_core | 0.411.0 |

## 4. 复现（最小、确定性）

```bash
# 1) 取官方 release 产物（或任意已下载的 bin/oj）
mkdir -p /tmp/oj-repro && cd /tmp/oj-repro
node <ram-cli>/bin/ram.mjs vendor v0.1.11      # 产出 ./bin/oj

# 2) 构造最小后端模块
mkdir -p src/web/hello
printf 'export default { get() { json.ok({ ok: true }); } };\n' > src/web/hello/api.ts
printf 'name: web\ndesc: probe\nversion: 0.1.0\n'  > src/web/manifest.yaml

# 3) 探针
./bin/oj --version                             # ✅ oj 0.1.11（Rust 侧正常）
./bin/oj build -d src -o out
```

**实际输出**

```
thread '<unnamed>' (…) panicked at …/deno_core-0.411.0/runtime/jsruntime.rs:743:9:
Failed to initialize a JsRuntime: No such file or directory (os error 2)
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
oj build: introspect hello/api.ts: introspect thread panicked
```

**期望**：`oj build: web v0.1.0 → out/web-0.1.0 (1 api file(s))`（本地 `cargo build --release` 的同款二进制即为此结果）。

> ⚠️ 探针必须**含至少一个 `api.ts`**：空目录 `oj build` 不初始化 JsRuntime，会假绿。

## 5. 证据

```bash
$ strings ./bin/oj | grep -c '/Users/runner'
1846

$ strings ./bin/oj | grep -oE '/Users/runner/work/only-js/only-js/[^"]*\.js' | sort -u
/Users/runner/work/only-js/only-js/oj/src/test_ext/test_bootstrap.js
/Users/runner/work/only-js/only-js/src/bridge/bootstrap.js
```

二进制里烧死了 GitHub Actions runner 的**构建机绝对路径**。

## 6. 根因

**（1）only-js 用 `dir` 形式声明扩展 JS 源**

```rust
// src/bridge/mod.rs:261-262
esm_entry_point = "ext:bridge_ext/bootstrap.js",
esm = [dir "src/bridge", "bootstrap.js"],

// oj/src/test_ext.rs:108-109
esm_entry_point = "ext:oj_test_ext/test_bootstrap.js",
esm = [dir "src/test_ext", "test_bootstrap.js"],
```

**（2）deno_core 0.411.0：`dir` 形式 → 编译期绝对路径 + `LoadedFromFsDuringSnapshot`**

- `extensions.rs:975-977`：`__extension_include_js_files_detect` **硬编码 `mode=loaded`**（当前无公开宏走 `mode=included`）。
- `extensions.rs:1036`：`mode=loaded` + `dir/file` → `ExtensionFileSource::loaded_during_snapshot(spec, concat!($dir, "/", $file))`。
- `extensions.rs:1052-1057`：`__extension_root_dir!(dir)` = `concat!(env!("CARGO_MANIFEST_DIR"), "/", dir)` → **把构建机绝对路径编译进二进制**。
- `extensions.rs:29-32`（变体语义）：*“Files will be loaded from the filesystem during the build time and they will only be present in the V8 snapshot.”*

**（3）only-js 没有 startup snapshot**

全仓 grep 无 `create_snapshot` / `startup_snapshot` / `SnapshotOptions` —— 每次都是**无快照**新建 runtime。

**（4）无快照时回落到运行期读盘**

```rust
// deno_core-0.411.0/extensions.rs:151-156
ExtensionFileSourceCode::LoadedFromFsDuringSnapshot(path) => {
    let s = std::fs::read_to_string(path)?;   // ← ENOENT
```

**一句话**：*编译期绝对路径 + 运行期读盘 + 未产出快照* 三者叠加。

## 7. 为什么 CI 没拦住

`.github/workflows/release.yml` 在三个 runner 上 `cargo build --release` 后，**就在同一台 runner 直接跑 `cargo test --release`**。该机器上 `/Users/runner/work/only-js/only-js/src/bridge/bootstrap.js` **真实存在** → 测试全绿；随后 `scripts/deploy.sh` 打包发布，缺陷随产物出门。`.oj-version` / sha256 只校验完整性，不校验可运行性。

## 8. 修复建议

### 8.1 立即：发布门禁（阻断再犯）

打包后做一次「**源文件缺席**」冒烟——内嵌/快照实现应通过，FS 依赖必失败：

```bash
# 打包完成后执行（CI 与本地 deploy 脚本通用）
set -e
mv src/bridge/bootstrap.js          src/bridge/bootstrap.js.hidden
mv oj/src/test_ext/test_bootstrap.js oj/src/test_ext/test_bootstrap.js.hidden

mkdir -p /tmp/oj-smoke/src/web/hello
printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/oj-smoke/src/web/hello/api.ts
printf 'name: web\nversion: 0.1.0\n' > /tmp/oj-smoke/src/web/manifest.yaml

if ! dist/oj build -d /tmp/oj-smoke/src -o /tmp/oj-smoke/out; then
  echo "::error::发布二进制依赖构建机路径（JsRuntime ENOENT），不可发布" >&2
  exit 1
fi
```

更严格的做法：Linux job 在**干净容器**内运行打包产物（`/Users/runner/...` 永不存在的环境）。

### 8.2 根本修复（二选一）

**方案 A —— 产出并内嵌 startup snapshot（deno_core 设计意图）**

构建期 `deno_core::snapshot::create_snapshot`（见 `runtime/snapshot.rs`，含 `CreateSnapshotOutput::files_loaded_during_snapshot`），运行期 `JsRuntimeOptions { startup_snapshot: Some(...) }`。
- 优点：语义正确 + 启动更快。
- 代价：快照与 V8/平台绑定 → 需按现有三平台矩阵分别生成；构建流程新增 xtask 步骤。

**方案 B —— 把源码编进二进制（改动最小，最贴近现状）**

不再走 `LoadedFromFsDuringSnapshot`，改为 `IncludedInBinary`：

```rust
// 目标形态（示意）
ExtensionFileSource::new(
    "ext:bridge_ext/bootstrap.js",
    deno_core::ascii_str_include!("src/bridge/bootstrap.js"),
)
```

- 因 0.411 的 `include_js_files!` 只产出 `mode=loaded`，需**手工构造/覆写 `Extension` 的 `esm`/`js` 字段**（`extension!` 宏产出的结构体字段公开），或本地包一层小宏。
- `bootstrap.js` 必须保持 7-bit ASCII（`src/bridge/mod.rs:1004-1010` 已有红线；`ascii_str_include!` 亦要求）。
- 代价：二进制约 +几十 KB；失去的只是“快照启动加速”——而当前本就没用快照，因此这是**最小正确修法**。

**方案 C —— 换用不带 `dir` 的声明**（若上游 deno_core 版本提供 `mode=included` 入口，优先评估）。

### 8.3 同步项

- `oj/src/test_ext.rs` 同款 `dir` 声明需一并处理（`oj build` introspect 会用到）。
- 发布流程里 `cargo test` 建议补一条「在路径缺席环境运行」的用例，而不仅是在构建机上跑。

## 9. 修复后验收清单

- [ ] §4 探针在**源文件被挪走**后通过
- [ ] `strings dist/oj | grep -c "$GITHUB_WORKSPACE"` 归零（至少不再出现 `*_bootstrap.js` 路径）
- [ ] 三平台矩阵均执行 §8.1 门禁
- [ ] 外部工程 `ram init → ram api → ram build → ram dev` 全链路通过（对照 `framework-verification-playbook.md` §3 / §8）

## 10. 附录：本仓库侧的规避

在本缺陷修复前，外部工程只能使用**本地自建**二进制：

```bash
# only-js 仓库内
cargo build --release -p oj
cp target/release/oj <project>/bin/oj && chmod +x <project>/bin/oj
```

本仓库已验证：覆盖为自建产物后，`ram build` 与 `ram dev` 全链路通过（见 `docs/prd/framework-verification-playbook.md`）。

另：`@react-antd-module/cli` **0.1.4 起**已在 `ram vendor` / `ram init` 安装后自动执行等价的
`probeOjRuntime` 冒烟（对最小 api 目录跑 `oj build`），失败打印人话告警并指向本报告——
即上游修复前，下游至少不会在 `ram build` 时才撞到裸 panic。上游修复后该告警自然消失。
