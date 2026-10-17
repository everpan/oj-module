# OJ-6 · `migrate: 评估暴露进程内迁移触发 migrate.run（免外部 CLI 子进程）`

**提交人**：ever <unix@vip.qq.com> · **日期**：2026-10-17 · **优先级建议**：可选优化（非阻塞——官方绕行已是可用主路径）

## 背景与实测依据

消费方场景：解决方案（模块）市场的安装器以 `_platform` 特权模块形态跑在 oj isolate 内，
「安装/升级」流程必须先于热更执行迁移。当前官方路径是 CLI 子进程：

```js
exec.run(["oj", "migrate", "-c", cfg, "--format", "json", "-d", dir, "<name>-<version>"])
```

- `"oj"` 特判解析为 `std::env::current_exe()`（serve 进程即 bin/oj，同版本自保证；
  `src/bridge/exec.rs:532-539`）；
- argv 模板须先登记进 `platform.exec.<模块>.allow` 白名单。

消费方仓 spike 实测（编号 S1-6；oj 0.1.76）——**该绕行已完整可用**：

- `oj migrate --format json` stdout 恰一行 JSON：

  ```json
  {"results":[{"module":"auth","ok":true,"applied":[]},
              {"module":"demo","ok":true,"applied":[{"version":1,"name":"create_todos"}]},
              {"module":"home","ok":false,"applied":[],"error":"at seq 2: …"}]}
  ```

- **成败真源是 exit code**：exit 0 = 全部成功，任一模块失败 exit 非 0（json 仍可解析，`results[].ok=false`）；
- 逐模块 continue-and-collect（`oj/src/migrate_cmd.rs:249-253`，实测一个模块失败不阻断其余模块）；
- 模块按名排序、DSN 脱敏；`applied: [{version, name}]` 可直接作为安装器迁移阶段的账据；
- 迁移门禁语义实测：release 缺省 `migrate_on_start: verify`，账本落后 M004 拒启、账本超前 M003 拒启
  （`oj/src/migrate.rs:447-448`）——迁移与热更/装配的先后约束由框架保证。

**结论**：消费方方案 v3 架构下 `exec.run` 子进程路径即主路径，内化（进程内触发）**降级为可选优化**——
收益仅剩去掉子进程开销与 exit-code 契约摩擦，非阻塞。本条按「评估请求」提交。

## 诉求形态

特权模块内进程内触发迁移的能力面（建议与 `server.reloadConfig()` 同门禁：限 `platform.modules` 特权模块）：

```ts
// 与 CLI --format json 输出同构即可
migrate.run(opts: { dir: string; module?: string }):
  Promise<{ results: Array<{ module: string; ok: boolean; applied: Array<{version: number; name: string}>; error?: string }> }>
```

（命名与参数形态可议；核心诉求 = 安装器不经子进程即可拿到逐模块迁移成败与 applied 账据。）

## 验收标准

- **json 输出与 exit code 契约不变**：进程内返回结构与 `oj migrate --format json` 逐字段对齐
  （`results[].module/ok/applied/error`）；后续 CLI 行为不受影响；
- 与热更路径的 `migrate verify` 语义保持一致：账本落后时热更/装配仍拒（约束不可绕过）；
- 非特权模块调用被拒（与 `server.reloadConfig` 同级门禁）；
- 失败返回可定位的迁移序号与原因（与现 CLI error 文案同级可诊断）。

## 非目标

- 不改 `oj migrate` CLI 的既有行为与输出格式；
- 不做 down/回滚（另见 OJ-9 down 迁移支持，独立条目）；
- 不改迁移账本格式与 `migrate_on_start` 门禁缺省值。

---
**对账记录**：2026-10-17 oj 0.1.77 发布（主题：`mounts[].api` URL 远程挂载 + `oj build --bundle`）——本条未包含（源码 `src/bridge/` 无 migrate 面 + 二进制 strings 双旁证）。

**上游终裁（2026-10-17）：未采纳——维持经 exec 触发。**`oj migrate` 当前即「进程内化」形态：`exec.run(["oj","migrate",...])` 经 `"oj"` 解析器映射 `current_exe`（同一份 bin/oj 二进制）拉起子进程，复用已审计的 exec 白名单 + 超时/输出上限闸门。不新增 bridge 原生 migrate.run op：迁移重、长、不可逆——独立子进程与请求运行时解耦，避免大表迁移期间长期占用 JsRuntime / DB 连接池，规避 KillSwitch 看门狗误杀，失败隔离更干净；更强内嵌诉求走 RFC 评估。

**消费方处置**：`exec.run ["oj","migrate",...]` 从「官方绕行」转为**永久主路径**（P1-7 迁移步骤即此形态，不改）。本条关闭。
