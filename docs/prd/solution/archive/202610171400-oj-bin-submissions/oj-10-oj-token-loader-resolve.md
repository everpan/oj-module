# OJ-10 · `exec.run` 的 `"oj"` token 经官方自带 glibc 启动器启动后解析到 ld-linux 而非 oj.bin（迁移子进程 exit 127）

**提交人**：ever <unix@vip.qq.com> · **日期**：2026-11-08 · **优先级建议**：P0（阻断级——`@oj-bin/oj` linux glibc 包的默认启动方式即触发，文档主路径 `exec.run(["oj","migrate",...])` 全线不可用）

## 背景与实测依据

`"oj"` 是 `exec.run` 的特判 token，解析为 `std::env::current_exe()`（`src/bridge/exec.rs:532-539`，OJ-6 / OJ-8 已引用）。设计假设「serve 进程即 `bin/oj`，同版本自保证」。

但 `@oj-bin/oj` 的 **linux glibc 发行包**自带的 `bin/oj` 不是二进制，而是一个启动器 wrapper，其唯一作用是经**打包的 glibc 加载器**拉起真正的 `oj.bin`，以绕开宿主 glibc 版本限制：

```sh
#!/bin/sh
# oj-bin 自带 glibc 启动器（仅 Linux glibc 发行包）。直接调用打包的 ld-linux 加载
# 真实二进制 oj.bin，使其使用 lib/ 内的 glibc 运行时。
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
export OJ_BUNDLED_LD="$DIR/lib/ld-linux-x86-64.so.2"
export OJ_BUNDLED_LIB="$DIR/lib"
exec "$OJ_BUNDLED_LD" --library-path "$OJ_BUNDLED_LIB" "$DIR/oj.bin" "$@"
```

于是 `bin/oj serve …` 经该 wrapper 最终落地的进程映像 **是 `ld-linux-x86-64.so.2`，不是 `bin/oj` 也不是 `oj.bin`**。`current_exe()` 返回的是加载器路径 `bin/lib/ld-linux-x86-64.so.2`。

**这导致 `"oj"` token 解析自相矛盾**：oj 官方启动器把自己变成加载器进程，而 `exec.run` 的 `"oj"` token 又拿 `current_exe()` 当可执行体。

实测（部署实例 wecom1108，oj `v0.1.125`，`@oj-bin/oj` linux glibc 包；`ps`/监听进程确认）：

```text
# ss -ltnp | grep 5174
LISTEN ... users:(("ld-linux-x86-64",pid=244846,fd=83))
# ps 244846
/data/oj/wecom1108/bin/lib/ld-linux-x86-64.so.2 \
  --library-path /data/oj/wecom1108/bin/lib \
  /data/oj/wecom1108/bin/oj.bin serve --config ./config-release.yaml
```

安装市场模块 wiz-pm 时，`_lifecycle` 步骤经 `exec.run(["oj","migrate","-c",cfg,"-d",dir,module])` 触发迁移，实际 spawn 出来的命令是：

```text
[ bin/lib/ld-linux-x86-64.so.2, "migrate", "-c", cfg, "-d", dir, module ]
```

ld-linux 作为程序被直接调用时，把后续参数当成「`[选项] 程序 [参数]`」——于是它把 `"migrate"` 当作**要加载的共享对象**：

```text
迁移失败：oj migrate exit 127（数据已保留原状，请修复后重试）
输出摘要：migrate: error while loading shared libraries: migrate: cannot open shared object file
```

**根因**：`"oj"` token 解析为 `current_exe()`，而加载器启动器下 `current_exe()` 是 `ld-linux`，不是 `oj.bin`。exec 层构造出 `[ld-linux, "migrate", ...]`，ld-linux 把 `migrate` 当 .so 加载 → exit 127。

**部署侧临时规避（终态不应需要）**：加一个裸名 wrapper `bin/ojmig`（注意 exec 模板首 token 必须是裸名、拒绝 `bin/oj` 这类含 `/` 的路径分隔符），内容为 `exec "$(dirname "$0")/oj" migrate "$@"`，并在 `exec.allow` 登记裸名 `ojmig`。裸名 `ojmig` 经父进程 PATH 解析回真正的 `bin/oj`、再走上述加载器拉起 `oj.bin migrate`，绕开 `current_exe()` 误解析。该 workaround 在 wecom1108 已验证可达 MySQL（仅剩 wiz-pm V11 SQL 非幂等这一独立 L3 阻断），但它属于消费方补丁，不应是终态。

## 诉求形态

**R1（必须）— `"oj"` token 必须解析到真实 `oj.bin` 映像，而非 ELF 加载器**

特判 resolver 在拿到 `current_exe()` 后，应识别「当前进程映像是 glibc 加载器」的情形（`current_exe()` 路径以 `ld-linux*` / `ld-*.so*` 结尾），改解析到真正的二进制：

- 优先 `OJ_BIN_PATH`（由启动器 wrapper 导出，指向 `oj.bin`）——**推荐**，启动器与 resolver 同包、最稳；
- 或回退到 `current_exe()` 同目录的 `oj.bin`；
- 或解析 `argv[0]` 真实目标。

验收等价条件：`exec.run(["oj","migrate",...])` spawn 出的进程程序名必须是 `oj.bin`（或经 `bin/oj` 加载器拉起），**绝不能是 `ld-linux … migrate`**。

**R2（必须）— 官方启动器与 `"oj"` resolver 必须自洽**

`bin/oj` 加载器 wrapper 与 `exec.run` 的 `"oj"` token resolver 同出自 `@oj-bin/oj`，二者必须一致。要么 wrapper 导出 `OJ_BIN_PATH` 供 resolver 消费，要么 resolver 特判加载器——**修复必须对「经 `bin/oj` 启动的 `oj serve`」默认生效**（这是 linux glibc 包的默认启动方式）。

**R3（建议）— 版本/契约口径澄清**

`@oj-bin/oj`（二进制，`0.1.x`）与 `@oj-module/runtime`（npm 契约包，`0.2.x`）是**两套独立编号**，已造成下游误判（"runtime 已经是 0.2.75" 实为 npm 契约包版本，二进制仍是 `0.1.125`；仓库模板内置二进制甚至更旧 `0.1.116`）。建议：

- `oj --version` / `oj info` 输出单一、无歧义的版本串；
- 文档显式给出 `@oj-bin/oj` ↔ `@oj-module/runtime` 的版本映射；
- 修复随版发布后，消费方 `ojm vendor` 的 `MIN_OJ_VERSION` 门禁（`packages/cli/src/vendor.ts` 当前钉 `0.1.121`）须同步抬高到含修复的版本，使下游经 `ojm vendor` 自动拿到正确二进制。

## 验收标准

1. linux glibc `@oj-bin/oj` 安装下，`bin/oj serve` 启动后，特权模块内 `exec.run(["oj","migrate",...])` spawn 的子进程程序为 `oj.bin`（经 `/proc/<pid>/cmdline` 或 `strace -f -e execve` 确认），**不再**是 `ld-linux … migrate`；
2. 迁移按真实成败返回 exit 0 / 非 0（含 json 账据），**不再**是 exit 127 + `error while loading shared libraries: migrate: …`；
3. macOS / POSIX 行为零回归：`exec.allow` 仍用 `oj …` 模板，`exec.run(["oj",...])` 仍解析到服务进程自身；
4. `oj --version` 输出单一明确版本；`@oj-bin/oj` 与 `@oj-module/runtime` 的映射关系在文档可查；
5. 安全模型不变：`exec.allow` 白名单仍为 fail-closed、首 token 裸名约束不变（`ojmig` 之类消费方补丁在修复后应当可以撤掉）。

## 非目标

- 不改 `exec.allow` 的裸名首 token 规则与 fail-closed 语义；
- 不加 fallback shell、不改 `${path:}` 校验；
- 不改 `oj migrate` CLI 的既有行为与输出格式；
- 不处理 wiz-pm V11 的 MySQL 非幂等 SQL（独立 L3 问题，属上游应用侧，不在本条范围）。

## 部署侧临时规避（供上游参考，非终态）

- `bin/ojmig`（裸名 wrapper）：`exec "$(dirname "$0")/oj" migrate "$@"`，`chmod +x`；
- `config.yaml` / 实际生效的 `config-release.yaml` 的 `exec.allow` 改用裸名 `ojmig`（与 `oj.exe` 并列）：
  ```yaml
  - 'ojmig --format json -c ${path:configPath} -d ${path:dir} ${raw:module}'
  - 'oj.exe migrate --format json -c ${path:configPath} -d ${path:dir} ${raw:module}'
  ```
- 服务器 `PATH` 须含 `bin/`，否则 runtime 按父进程 PATH 解析不到裸名 `ojmig`。

> 以上为消费方当前线上兜底；其存在本身即证明 R1/R2 是运行时缺陷，应在 `@oj-bin/oj` 侧根治。

## 对账记录 / 上游终裁

- 2026-11-08 提交（oj `v0.1.125`，linux glibc `@oj-bin/oj` 包；部署实例 wecom1108 复现 exit 127 + `migrate: error while loading shared libraries`）。
- 上游终裁：待填。
