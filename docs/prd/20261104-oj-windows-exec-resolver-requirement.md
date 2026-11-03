# 需求：oj `exec.run` 在 Windows 不解析 PATHEXT，市场安装链路全线不可用

> **受众**：only-js / oj 维护者（本文可直接作为 issue 正文）。
> **状态**：已在 Windows 11 + oj 0.1.116（x86_64-pc-windows-msvc）复现确认，**未修复**。
> **严重级别**：阻断级（Blocker）—— Windows 上 `ojm market install` / `trial` / `walkthrough` 无法完成解包，§7.1–§7.4 市场全链路演练被挡。
> **关联**：`framework-verification-playbook.md` §7.3/§7.4；`oj-release-binary-defect-report.md`（同类：release 产物在非构建机不可用）。

## 1. 摘要

`oj serve` 的 `exec.run` 把 argv 首 token（裸命令名）在**宿主侧按父进程 PATH 解析为绝对路径**后再 spawn。Windows 上没有名为 `tar` 的可执行文件——只有 `tar.exe`（`C:\Windows\System32\tar.exe` bsdtar、`C:\Program Files\Git\usr\bin\tar.exe` GNU tar）与 `cmd.exe`。**oj 的 resolver 不应用 `PATHEXT`（不补 `.exe`）**，因此裸名 `tar` 永远解析失败：

```
exec: command resolve failed for 'tar': command 'tar' not found in PATH
```

该错误来自安装器 `extracting` 段（`_platform/_lifecycle/steps/extract.ts` 的 `exec.run(buildListCmd(...))`），导致 11 段安装任务在 `extracting` 直接 failed。devkit 文档为 Windows 开出的 `cmd /c <语句>` 规避方案同样失效（`cmd` 也是裸名、同样不补 `.exe`）。

**关键证据**：在 PATH 上放置一个**无扩展名**的 `tar` 文件后，resolver 立即能找到它（错误从 `command resolve failed` 变为 `tar 列表失败` / `stdout is not valid UTF-8`）。这直接证明问题出在「裸名 → 文件名」的解析环节，而非 PATH 值、env 白名单或权限。

## 2. 环境与复现路径

| 项 | 值 |
| --- | --- |
| OS | Windows 11 Pro（中文区域，控制台本地代码页 GBK） |
| oj | `0.1.116`，`x86_64-pc-windows-msvc`，rustc 1.99.1（`@oj-bin/oj` 通道，`ojm vendor`/`init` 安装） |
| `@oj-module/cli` / `runtime` | `0.2.62`（本地 pack 发布态，非 npm 通道） |
| tar | `C:\Program Files\Git\usr\bin\tar.exe` = GNU tar 1.35；`C:\Windows\System32\tar.exe` = bsdtar 3.8.9 / libarchive 3.8.9。二者均存在且 `where tar` 可见 |
| `PATHEXT` | `.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL`（父进程已设置） |
| 演练工程 | `d:/ojm-verify/my-books`（按 playbook §0.5 pack → §1 init → §2 install 重新生成） |

复现命令（隔离站点自举，11 段安装）：

```bash
node d:/ojm-verify/cli-pkg/bin/ojm.mjs market walkthrough --fixture demo-solution@0.1.0 --only install
# 完整 14 项：
node d:/ojm-verify/cli-pkg/bin/ojm.mjs market walkthrough --fixture demo-solution@0.1.0
```

§0.5–§6（init 319 项、`oj 0.1.116`、info 三版对齐 0.2.62、typecheck 0 error、`ojm build` 6 后端模块 + app/oj-market、`ojm dev` 84 routes / 80 input contracts、登录/system/users/通知/静态全 200）**均已通过**；唯一阻断点在 §7.3/§7.4 的市场安装解包。

## 3. 失败输出（原文）

**完整 walkthrough（14 项，4 PASS / 10 FAIL）**：

```
✗ install    安装（11 段）——status=failed stage=extracting：解压失败：Error: exec: command resolve failed for 'tar': command 'tar' not found in PATH——附录 A extracting（S1-2 exec.run tar 三步范式）
✗ reinstall  同版本重装走重装路径——前置安装失败：status=failed：解压失败：Error: exec: command resolve failed for 'tar' ...
✗ enable / verify / history / upgrade / rollback / uninstall / neg-stranger  前置安装失败 ...
✗ neg-evil   负向：zip-slip 越界包（R1 拒收）——rejected=false untouched=true：[ojm] 站点返回错误（code=500）：exec: command resolve failed for 'tar': command 'tar' not found in PATH
✓ index / neg-tamper / neg-nosig / neg-badindex（不依赖解包）
```

`market trial --keep` 同样停在 `status=failed stage=extracting`。隔离站点 `config.yaml` 确认含 `platform.exec._platform.allow` 三条 `tar` 模板与 `fs:` 段，故**不是授权/模板失配问题**（错误文案是 `command resolve failed` 而非 `exec template mismatch` / `NotCapable`）。

## 4. 已尝试的组合与失败输出（全部）

| # | 改动 | 结果 |
| --- | --- | --- |
| 1 | 基线（原样 config + 原样 `["tar","-tvzf",file]`） | `exec: command resolve failed for 'tar': command 'tar' not found in PATH` |
| 2 | `startOj` 已带的 win32 PATH 修正：过滤 MSYS 风格条目、补齐 `C:\Windows\System32` / `C:\Windows` / `C:\Program Files\Git\usr\bin`；插桩确认 oj serve 收到的 PATH 为纯 Windows 风格且含两个 `tar.exe` 所在目录 | 同上，仍 `command 'tar' not found in PATH` |
| 3 | 把 oj serve 的 PATH 缩到最小 `C:\Windows\System32;C:\Program Files\Git\usr\bin`（排除所有干扰项） | 同上 |
| 4 | `platform.exec._platform` 增加 `env: [PATH, PATHEXT, SystemRoot, OJ_SECRET_KEY]` 透传白名单（生成的隔离站点 config 已确认含该行） | 同上 |
| 5 | PATH 放**无扩展名** `tar` = Git GNU `tar.exe` 的副本 | resolver **找到**了，但 `tar 列表失败（exit -1073741515）`（0xC0000135 `STATUS_DLL_NOT_FOUND`：`ldd` 显示依赖 `msys-2.0.dll` / `msys-intl-8.dll` / `msys-iconv-2.dll`，脱离 `usr/bin` 后加载不到） |
| 6 | PATH 放**无扩展名** `tar` = System32 `tar.exe`（bsdtar，自包含）的副本 | resolver **找到并启动**了，但 `exec: stdout is not valid UTF-8 (binary output unsupported)`；直接探针显示 bsdtar `-tvzf` 输出含本地化日期 `11\xD4\xC2 04`（GBK「11月 04」）+ CRLF，oj 强制 UTF-8 解码即抛 |
| 7 | `exec.allow` 增 `cmd /c tar -tvzf ${path:archive}` / `cmd /c tar -xzf ${path:archive} -C ${path:dest}`，`buildListCmd`/`buildExtractCmd` 改为 `["cmd","/c","tar",...]`（devkit 文档为 Windows 开出的形态） | `exec: command resolve failed for 'cmd': command 'cmd' not found in PATH`——**`cmd` 也解析不了**；文档称「`cmd` 由 resolver 解析为绝对路径（如 `C:\Windows\System32\cmd.exe`）」与实测不符 |
| 8 | `exec.allow` 增 `tar.exe -tvzf ...` / `tar.exe -xzf ...`，argv 首 token 改 `tar.exe` | 该轮 `oj serve` 启动日志停在 `serve: static compression on ...` 后进程以 127 退出、未产出 install 结论（演练进程被中断，**未取得判定结果**） |
| 9 | `oj exec -e '...' -c config.yaml` / `oj exec probe.ts -c config.yaml` 想直接读 isolate 全局（找平台判据） | `oj exec: platform.root (...) must be mounted as an api mount to give platform modules routes and ownership`，无法在 isolate 内做平台探测 |

补充探针结论：

- `C:\Windows\System32\tar.exe -tvzf <abs>`：`OK`，输出为 `drwxr-xr-x ... 11\xD4\xC2 04 02:22 src/\r\n`（GBK + CRLF）。
- `C:\Program Files\Git\usr\bin\tar.exe -tvzf <abs>`：`Cannot connect to C: resolve failed`（GNU tar 把 `C:` 当远程主机，需 `--force-local`）。
- `PATHEXT` 在父进程存在且合法；oj serve 的 env 由 `startOj` 显式构造（含 PATH）。
- **另有一个已修复的、不同的问题**：ojm CLI 自身测试里的 `execFileSync("tar", ...)` 曾因硬编码 GNU `--force-local` 在 bsdtar 上报 `tar: Option --force-local is not supported`，已改为按 `tar --version` 探测 GNU 才加该 flag，并 strip bsdtar 的 CRLF（`84e70b730`）。那是 **ojm 测试侧**，与本次 oj `exec.run` 侧无关，勿混淆。

## 5. 根因分析

1. **主因**：oj `exec.run` 的「宿主侧解析」按**字面文件名**在 PATH 各目录里找 `tar`，Windows 文件系统里只有 `tar.exe`。未应用 `PATHEXT`（`.EXE`/`.CMD`），也未对 `cmd` 做特判。devkit `api-manual.md` §6「命令解析（模板首 token）」写的是「其余裸名在宿主侧按父进程 PATH 解析为绝对路径后 spawn」，未说明 Windows 下补扩展名的规则；`SKILL.md` 明确承诺 `cmd` 可解析，实测不能。
2. **次因（即使主因修好仍会挡住）**：Windows 子进程输出是本地代码页（GBK/CP1252），`exec.run` 无回调形态强制 UTF-8 解码、非法即抛 `exec: stdout is not valid UTF-8`。bsdtar 的 `-tvzf` verbose 列表（安装器 R1 三步范式的输入契约，铁律①不可改 `-tzf`）含本地化月份名，必然非 UTF-8。devkit 给的出路是 `cmd /c chcp 65001 >nul && ...`，但见 #7：`cmd` 本身解析不了。
3. **契约耦合**：`exec.allow` 模板与 argv 逐 token 逐字对齐（「一个 token 都不能动」），因此 oj 侧任何命令形态调整都必须同步下发配置模板；目前 `packages/cli/templates/config.yaml` 只有 POSIX 三条 `tar` 模板，Windows 无官方模板。

## 6. 需求（按优先级）

**R1（必须）— resolver 支持 Windows PATHEXT / 系统命令**
在 win32 上把裸名按 `PATHEXT`（`.COM;.EXE;.BAT;.CMD;...`）补全后再解析，或至少对 `cmd` / `cmd.exe` / `tar` / `tar.exe` 做特判，使 `exec.run(["tar", ...])` 与 `exec.run(["cmd", "/c", ...])` 都能解析到绝对路径后 spawn。保持现有 fail-closed 白名单语义不变（仍只放行 `exec.allow` 命中的 argv）。

**R2（必须）— 官方 Windows 命令模板**
给出 Windows 下 `_platform` 安装链路可直接使用的 `exec.allow` 模板集与对应 argv 约定，至少覆盖 list / extract / migrate 三条；例如 `cmd /c chcp 65001 >nul && tar -tvzf ${path:archive}`（需 R1 先支持 `cmd`），并同步到 devkit 文档与 `config.yaml` 模板。当前「Windows 面须改写为 `cmd /c` 等价形态」的文档承诺在 0.1.116 上不可用。

**R3（必须）— 非 UTF-8 输出可消费**
三选一：① 提供 `cmd /c chcp 65001` 的可行路径（依赖 R1/R2）；② `exec.run` 无回调形态对非法 UTF-8 改为有损解码（U+FFFD）而非抛错（与带回调形态一致）；③ 让安装器改走 `exec.spawn` 拿原始 `Uint8Array` 自行解码。`extract.ts` 已 feature-detect `exec.spawn`，可作为过渡。

**R4（建议）— 文档与实现对齐**
修正 `SKILL.md`「`cmd` 由 resolver 解析为绝对路径、`sh`/`bash` 在 Windows 不存在」等表述，明确 PATHEXT 行为、本地代码页输出、`-tvzf` verbose 形态与 UTF-8 的关系；并把「部署机没有 tar」的排障条目（`scenarios.md` 场景 34）改为给出 Windows 具体处置。

**R5（建议）— Windows CI 覆盖**
把 `ojm market walkthrough --fixture demo-solution@0.1.0`（14 项）纳入 Windows runner，防止 `exec.run` 平台回归；当前基线只在 macOS/Linux 跑过 14/14。

## 7. 验收标准

1. Windows 11 中文环境、oj ≥ 修复版、`tar` 仅为系统自带 bsdtar（PATH 无 Git usr/bin）时，`ojm market walkthrough --fixture demo-solution@0.1.0` **14 PASS / 0 FAIL**，`install` 11 段全 ok。
2. 负向 5 项（neg-tamper / neg-nosig / neg-badindex / neg-stranger / neg-evil）仍按预期失败口径全部拦住，不因改动放宽安全闸门。
3. `exec template mismatch` / `ambiguous` / `NotCapable` 语义不变；白名单仍 fail-closed。
4. POSIX（macOS/Linux）行为零回归：`exec.allow` 仍用 `tar ...` 模板，14/14 仍通过。

## 8. 证据与附件

- 演练日志：`d:/ojm-verify/walkthrough.log`（14 项 4 PASS/10 FAIL）、`wt-env.log`（组合 4）、`wt-shim.log` / `wt-shim2.log`（组合 5/6）、`wt-cmd.log`（组合 7）、`wt-tarexe.log`（组合 8）、`trial-keep.log`（`--keep` 保留的隔离站点）。
- 演练现场：`d:/ojm-verify/my-books`（config.yaml / src / dist 均为发布态）、`d:/ojm-verify/cli-pkg`；保留的隔离站点 `C:\Users\unix\AppData\Local\Temp\ojm-trial-j20dZJ`。
- 相关源码：`packages/cli/src/oj.ts`（win32 PATH 修正）、`packages/cli/src/market/bootstrap.ts`（隔离站点自举）、`packages/cli/templates/config.yaml`（`platform.exec`）、`packages/cli/templates/src/app/api/_platform/_lifecycle/steps/extract.ts`（`buildListCmd` / `buildExtractCmd`）。
- 报告落盘：演练工程 `logs/walkthrough-*.md`（AC 表 + 失败文案表）。

> 本仓库侧的演练副本已恢复为与 `packages/cli` 逐字节一致，未保留任何本地规避补丁；修复需在 oj 侧落地后，按 `framework-verification-playbook.md` 重跑 §7.1–§7.4 并更新「最近一次基线」。
