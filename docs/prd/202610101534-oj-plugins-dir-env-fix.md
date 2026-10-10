# ojm dev 插件零加载根因与修复（OJ_PLUGINS_DIR 显式注入）

- 日期：2026-10-10 15:34
- 分支：fix/oj-plugins-dir-env
- 现象：`ojm init tmp --yes && cd tmp && pnpm dev` → 模块构建正常，`oj serve` 秒退：
  `config declares [auth] but no auth plugin loaded`，而 `bin/plugins/x86_64-unknown-linux-gnu/`
  下 `libauth.so` 等 10 个插件文件齐全（Linux x86_64，root@exp01 实测）。

## 1. 根因（证据链）

oj 的插件目录发现（`oj-bin/src/bridge/plugin_loader.rs::resolve_plugins_dir`）候选顺序：

1. `OJ_PLUGINS_DIR` 环境变量（相对路径基于 config 目录解析）；
2. toml `plugins_dir`；
3. `current_exe().parent()/plugins/<triple>`；
4. `workspace_root()/bin/plugins/<triple>`（`CARGO_MANIFEST_DIR`，CI 构建机路径，用户机上不存在）。

用户机上前两项未设置，落到候选 3——**而 Linux glibc 发行包的 `bin/oj` 是 shell 启动器**：

```sh
exec "$DIR/lib/ld-linux-x86-64.so.2" --library-path "$DIR/lib" "$DIR/oj.bin" "$@"
```

直接 exec 动态加载器时，内核的 exe 映像是 ld-linux，`/proc/self/exe`（即 Rust
`current_exe()`）指向 **`bin/lib/ld-linux-x86-64.so.2`** 而非 `oj/bin`。于是候选 3
解析为 `bin/lib/plugins/<triple>`（不存在），候选 4 是 CI 机构建路径（不存在）→
返回 None → 零插件加载 → config 声明了 `[auth]` → fail fast 报「no auth plugin loaded」。

macOS/Windows 子包无启动器（直出 Mach-O/PE），`current_exe()` 正常，故仅 Linux 触发。

佐证：`ojm vendor` 安装期冒烟（`probeOjRuntime` 跑 `oj build`）不经过插件发现，所以
init/vendor 全绿、到 `ojm dev` 才炸——用户看到的正是这个时间差。

### 附带发现（oj-bin 侧，不在本修复范围）

- `serve_cmd.rs::daemonize()` 的 `bundled_reexec_cmd(exe)` 以 `current_exe()` 为 re-exec
  目标；Linux 打包形态下该值为 ld-linux 路径，re-exec 命令变成
  `ld.so --library-path lib <ld.so>`——`--daemon` 在 npm 发行包上同样会坏。
  修复方向：启动器直接 `export OJ_PLUGINS_DIR="$DIR/plugins"`（一行，且对所有
  oj 消费方生效）；daemonize 侧另案处理。

## 2. 修复方案（ojm 侧）

`startOj` spawn 时显式注入 `OJ_PLUGINS_DIR=<projectRoot>/bin/plugins`（oj 自己拼
`<triple>` 子目录），把发现从「依赖 current_exe 启发式」改为「ojm 已知的确定布局」。

注入条件（尊重用户显式配置）：

- config.yaml 顶层已声明 `plugins_dir` → 不注入（oj 侧 toml 路径解析不经过
  current_exe，本就可用；env 优先级高于 toml，注入会静默覆盖用户配置）；
- `bin/plugins` 目录不存在 → 不注入（保持 oj 原行为，避免报「plugins dir not found」
  类的次生错误）。

## 3. 用例（TDD）

`tests/cli/oj-process.test.ts` 桩 `bin/oj` 增加 env 落盘（`oj-env.json`）：

| # | 场景 | 前置 | 断言 |
|---|------|------|------|
| 1 | bin/plugins 存在（含 triple 子目录） | 默认 config | `OJ_PLUGINS_DIR === <root>/bin/plugins` |
| 2 | config 声明顶层 `plugins_dir` | config 加 `plugins_dir: ./custom` | env 未设置（尊重 toml） |
| 3 | bin/plugins 缺失 | 不建 plugins 目录 | env 未设置 |

## 4. 影响面

- `startOj` 唯一出口，dev/preview 共用 → 一处修复两个入口。
- 非 Linux 平台行为不变（env 指向同一既有目录，发现结果相同，只是不再依赖启发式）。
- 与 `ojm vendor` 的版本门禁无耦合：任何 >= MIN_OJ_VERSION 的 oj 都认 `OJ_PLUGINS_DIR`。

## 5. 任务状态

- [x] 根因调查（oj-bin 源码 + npm 包实测）
- [x] 本文档
- [x] 失败用例（§3，桩落盘 env，注入场景红→绿）
- [x] 实现（§2：`oj.ts` spawn 注入 + `oj-config.ts` 新增 `readOjPluginsDir`）
- [x] 全量测试（718 passed）+ lint（0 错误）

> 备注：`pnpm typecheck` 在基线分支即失败（`tests/cli/preview.test.ts` 两个桩缺
> `kill` 属性），与本次改动无关，未顺手修改（遵守单一变更原则）。

## 6. 总结

- 关键过程：报错文案指向「插件没装」，实际插件文件齐全——按 oj 源码
  `resolve_plugins_dir` 逐候选排查，发现 Linux glibc 发行包的 ld-linux 启动器使
  `current_exe()` 指向加载器，启发式候选全部落空；npm 包（@oj-bin/oj 0.1.55）
  postinstall 与启动器脚本实测佐证。ojm 侧一行 env 注入（两个前置条件兜底）根治。
- 耗时：根因调查约 25 分钟（含 npm 包下载与 oj-bin 源码走读），文档+TDD+实现+
  全量验证约 20 分钟，合计约 45 分钟。
- 分类记录：**反常识**——「文件齐全却报未加载」的元凶不在文件系统而在
  `current_exe()` 的进程映像语义（exec 动态加载器后 /proc/self/exe 指向加载器）；
  且安装期冒烟（`oj build`）不经过插件发现，问题延迟到 `ojm dev` 才暴露。
- 后续（oj-bin 侧，另案）：启动器 `export OJ_PLUGINS_DIR="$DIR/plugins"` 可对
  所有 oj 消费方生效；`daemonize()` 的 re-exec 在打包形态下同样受 current_exe
  影响，需一并处理。
