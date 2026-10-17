# OJ-8 · `exec: Windows 缺少 tar/zip 等外部命令时给出可操作报错（提示 Git Bash）`

**提交人**：ever <unix@vip.qq.com> · **日期**：2026-10-17 · **优先级建议**：P1（非阻塞——macOS/Linux 部署不受影响）

## 背景与实测依据

oj 0.1.75 起的 `exec.run` 把归档解压建立在**宿主外部命令**之上：模板形如
`tar -tzf ${path:archive}` / `tar -xzf ${path:archive} -C ${path:dest}`，无 shell、模板首 token 为裸名。
这是「解决方案市场安装器」在 oj isolate 内完成 tgz 安装（下载 → sha256 校验 → 解压 `.staging` → 校验 → 原子 rename）的官方范式。

命令解析链（源码，`src/bridge/exec.rs`）：

- `"oj"` 特判解析为 `std::env::current_exe()`（serve 进程即 bin/oj，同版本自保证）；其余裸名由**父进程 PATH** 逐目录探测（`src/bridge/exec.rs:532-539`）；
- 子进程 env 为**空表**（`cmd.env_clear()`，`src/bridge/exec.rs:353-359`，仅白名单透传）——不继承 PATH，解析完全依赖宿主侧；
- 解析失败抛通用错误 `exec: command resolve failed for 'tar': …`（`src/bridge/exec.rs:323`）。

消费方仓 spike 实测（编号 S1-2；oj 0.1.76，macOS 宿主）：

- `exec.run(["tar","-tvzf",archive])` 由宿主 PATH 解析到 `/usr/bin/tar`（bsdtar 3.5.3）执行成功；
  `-tvzf` 首列可辨 symlink（`l`）/ hardlink（`h`），解压实测忠实重建链接——
  「list → validate → extract 三步范式」成立且必需（链接零容忍校验依赖 `-tvzf` 输出）；
- 越权路径负例（archive 指向 `fs.root ∪ trusted_paths` 之外）被 `${path:}` 校验正确拒绝
  （`NotCapable: exec ${path:archive}: path outside fs.root and trusted_paths`）。

即范式本身成立，唯一短板是：**宿主解析不到外部命令时，报错不可操作**。Windows 上这恰是常态：

- Windows 10 17063+ 自带 `C:\Windows\System32\tar.exe`（bsdtar），与 GNU tar 参数/默认行为有差异
  （`--exclude`、wildcards、`-C` 与打包顺序），照抄 GNU tar 模板可能静默产生不同结果；
- 更常见的形态是**根本解析不到** `tar`/`zip`/`unzip`——Windows 默认不带 `zip`/`unzip`；
- 此时运维看到的是「找不到命令」，得不到下一步该做什么——这类报错会被当成 oj 的 bug 而非环境配置问题。

## 诉求形态（两件小事，都不改安全模型）

1. **平台特化报错文案**：`exec.run` 命令解析失败时，在 `process.platform === "win32"` 下追加一段可操作提示
   （不改变错误分类，仍为普通 `Error`）：

   ```text
   exec: command resolve failed for 'tar': <原始原因>
   hint: 此命令在 Windows 上默认不可用。请改用 Git for Windows 自带的 Git Bash 执行本操作
         （默认路径 C:\Program Files\Git\git-bash.exe），
         或把 C:\Program Files\Git\usr\bin（GNU tar / zip / unzip 所在）加入系统 PATH 后重试。
   ```

   `zip` / `unzip` 缺失同理，只换命令名。非 Windows 平台保持现有文案逐字不变。

2. **文档侧补一条 Windows 前置说明**：在 api-manual §6「exec」与 scenarios 场景 34 顶部注明
   「Windows 部署请用 Git Bash 或把 Git 的 `usr/bin` 加入 PATH」，避免照抄者踩空。

## 验收标准

- Windows 且 PATH 无 `tar` 时，`exec.run(["tar", ...])` 抛错**同时**含 `hint:` 段与 Git Bash 路径；
- `zip`/`unzip` 缺失同样给出对应 hint，命令名正确插值；
- 非 Windows 平台报错文案与现状逐字一致（无 hint 段）；
- 错误分类不变（仍为普通 Error，非 `NotCapable`），现有 `exec: command resolve failed` 前缀保留，
  依赖前缀匹配的调用方不受影响。

## 非目标

- 不内置 tar/zip、不改 `${path:}` 校验语义、不加 fallback shell——本条只解决「报错不可操作」；
- 不处理 Windows 超时击杀差异（api-manual §6 已注明 Windows 无进程组对应物、仅杀直接子进程——
  这是另一处已知限制，不在本条范围）；
- 不要求 GNU tar 与 bsdtar 行为对齐（文档前置说明即可覆盖）。

---
**对账记录**：2026-10-17 oj 0.1.77 发布（主题：`mounts[].api` URL 远程挂载 + `oj build --bundle`）——本条未包含（源码 `src/bridge/exec.rs` 无 Windows hint + 二进制 strings 双旁证）。

**上游终裁（2026-10-17）：未采纳。**Windows 支持经显式模板 `cmd /c ...`（或 resolver 映射到绝对路径的 cmd.exe/ping.exe）达成，exec.rs `cfg(windows)` BDD 用例已覆盖。不引入 Git Bash 自动探测：① 扩大命令解析面、引入 PATH/注入歧义；② 与「命令名由配置白名单显式声明」的安全边界冲突；③ 同一模板在有无 Git Bash 的机器上行为不一致。**上游口径：模板里直接写 `cmd /c`，不依赖 sh 仿真层。**

**消费方处置**：Windows 维持已知限制（lifecycle-guide §2.5 文档兜底不变）；P2 起如支持 Windows 安装，exec 白名单与安装器 buildXxxCmd 须按上游口径提供 `cmd /c tar ...` 形态。本条关闭。
