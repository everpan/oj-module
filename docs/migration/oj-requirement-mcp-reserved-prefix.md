# 上游需求草案：MCP 工具名保留前缀 `oj_` 应只拦元工具精确名

> 状态：**已落地**（2026-11-13 起草；同日上游 oj **0.1.135** 采纳方案 **A+B**，C 押到下一 minor。落地记录见 §9）。
> 本仓关联：`docs/prd/framework-verification-playbook.md` §9「0.1.134 保留前缀致模板整站拒启」、
> §11 **U10**（本条即 U10 的正式化提案）。
> 一句话：**模板工程在 0.1.134 上开箱即拒启**，不是配置写错，是 tool 名派生规则与新的保留前缀撞车。

## 1. 结论

请把「MCP tool 名以 `oj_` 开头 → 启动 fail-fast」从**前缀**判定收窄为**保留名精确**判定：

| 当前（0.1.134） | 建议 |
| --- | --- |
| 任何暴露工具的净化名 `starts_with("oj_")` → 拒启 | 仅当净化名 ∈ `{oj_search_tools, oj_list_groups}` → 拒启 |

保留前缀的正当目标是**防止业务工具仿冒元工具**（让 agent 把 `oj_search_tools` 当成业务调用、或反过来劫持检索入口）。
精确名判定对该目标等价，而不再误伤「模块名本身以 `oj` 开头」这一**合法且已广泛存在**的命名。

若上游坚持前缀语义，则需要第二条能力：**允许为路由声明 tool 名**（见 §5 方案 C），否则保留前缀等价于
「内核独占 `oj` 这个命名空间前缀」，任何以 `oj…` 命名的模块在启用 MCP 的站点上都无法升级。

## 2. 现象（2026-11-13 实测，可逐条复现）

模板工程（`packages/cli/templates`，默认 `server.mcp.enabled: true`）在 oj 0.1.134 上起站：

```
$ ~/.local/share/oj/oj serve -c config.yaml --module-root src -b /api
oj serve: MCP tool name `oj_market_install_post` (operationId `oj_market_install_post`,
post /api/oj-market/install) uses reserved prefix `oj_` (oj_search_tools / oj_list_groups)
— rename the route
$ echo $?
1
```

四条旁证（每条都是同一份 config 只改一个变量）：

| 变量 | 结果 | 说明 |
| --- | --- | --- |
| `server.mcp.enabled: true`（模板默认） | **status=1，拒启** | 与是否真的调用 MCP 无关 |
| `server.mcp.enabled: false` | **status=124（正常起站，跑到 timeout 被杀）** | 关掉 MCP 可起站，但站点失去 MCP 能力 |
| `server.mcp.modules: [home]`（白名单只剩 home） | **status=1，同样拒启** | `oj-market` 的工具**根本不会进 `tools/list`**，仍被拒 → 校验不针对「实际暴露集」 |
| `server.mcp.expose: routed`（list 只回两个元工具） | **status=1，同样拒启** | 三态一致，`routed` 不豁免 |

二进制侧无逃生口：`strings` 无相关 env / 配置键，devkit 的 `api-manual.md`、`SKILL.md`、场景手册均只描述规则本身。

## 3. 为什么本仓不能「改个名」了事

**(a) tool 名不是可调的展示名，而是路由的派生结果。** 净化 operationId 即 tool 名，而 operationId 由
「模块名 + 相对路径」派生（`oj-market` + `/install` → `oj_market_install_post`）。`_schema` 顶层只接受
`params`/`query`/`body`/`response` 四个通道，**没有 tool 名覆盖、也没有路由级排除**——改 tool 名只能改路由，
改路由就是改对外契约。

**(b) `/api/oj-market/*` 是出厂内建编排模块的对外面。** 该前缀同时被：模板 `config.yaml` 的
`platform.modules` / `platform.exec` / nonce 与强绑定路径白名单（`/oj-market/converge`、`catalog/**`、
`cdn/upload`、`yank`）、前端 `__client`、CLI 瘦客户端、安装器收敛流程、已发版方案包里的 lock/manifest 引用。
改名不是「改目录」，是**一次平台级 URL 迁移**。

**(c) 成本实测（单条命令，2026-11-13）**：

```
$ grep -ro --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 'oj-market' . | wc -l
2078
$ grep -rl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 'oj-market' . | wc -l
228
```

按顶层目录：`packages` 1014、`docs` 437、`.superpowers` 333、`scripts` 102、`tests` 80、`logs` 61、
`CHANGELOG.md` 41、`web` 5、`build` 4、`vite.config.ts` 1。受影响的工具数（模板 `openapi.json` 里
`oj_market*` 开头的 operationId）：**24 个**。

**(d) 这是生态级的，不只是本站。** 任何第三方把方案命名成 `oj-something`（很自然的自命名偏好），
在 0.1.134 上装进启用 MCP 的站点即**整站拒启**；已有站点升级 oj 小版本就下线，且错误信息只说
「rename the route」，不给迁移手段。保留前缀从「保护元工具」变成了「内核独占命名空间」。

## 4. 影响面

| 面 | 影响 |
| --- | --- |
| 模板工程（本仓 `ojm init` 产物） | 默认 `server.mcp.enabled: true` + 内建 `oj-market` → **0.1.134 上零改动即拒启** |
| 已发布站点 | 升级 oj ≥ 0.1.134 即拒启；唯一自救是关 MCP 或改模块名（后者破坏对外 URL 与已装方案锁） |
| 方案市场 | 安装器依赖 `/api/oj-market/*` 收敛端点，改名会让存量站点锁/manifest 指向失效前缀 |
| `ojm` 门禁 | `MIN_OJ_VERSION` 无法抬到 0.1.134（一抬就全量 `ojm init` 出不可起站的工程）；也无法表达「上限版本」 |

## 5. 候选方案

| 方案 | 内容 | 评价 |
| --- | --- | --- |
| **A（推荐）** | 保留名**精确匹配**：只有净化名恰好等于 `oj_search_tools` / `oj_list_groups` 才拒启；`oj_` 不再有特殊含义 | 改动最小（一处判定）、目标等价（仍挡仿冒）、零误伤；本仓可直接升级 0.1.134 |
| **B（正交，可与 A 同做）** | 校验范围收窄到**实际暴露集**：被 `modules` 白名单 / `act_mask` / `expose` 过滤掉的工具不参与校验 | 语义更正（不暴露就不该阻断启动）；但本站默认全集暴露，**单靠 B 不解阻塞** |
| **C（兜底能力）** | 允许改名：`.schema` 增可选 `tool_name`，或 config `server.mcp.tool_names: {<operationId>: <name>}`；缺省仍按净化 operationId | 给生态一条「撞名但想保留 URL」的出路；比 A 重，但覆盖 A 之后仍可能出现的冲突 |
| D（不推荐） | 降级为 warn + 该工具不暴露 | 与 fail-closed 原则冲突：静默少工具比拒启更难排查 |

建议：**A 立刻做**（一行判定 + 三条回归），B 顺手做（语义更正），C 排到下一个 minor（生态能力）。

## 6. 验收口径

1. 模板工程（含内建 `oj-market`，默认 `mcp.enabled: true`）在修复版上**正常起站**；
   `tools/list` 与 0.1.133 一致（`expose=flat` 24 个 `oj_market_*` 工具；`grouped` 带 `_meta` 分组面；
   `routed` 只回两个元工具且 `oj_search_tools({query:"oj-market"})` 能检索到它们）。
2. **真冲突仍 fail-fast**：造一条 operationId 恰好是 `oj_search_tools`（或 `oj_list_groups`）的路由 →
   启动必须拒，且错误信息保持现状（点名 operationId + 方法 + 路径）。
3. 元工具名不可被业务覆盖：即便走方案 C，`tool_name` 指定成两个保留名也必须拒。
4. `server.mcp.enabled: false` 行为不变（中性）。

## 7. 复现步骤（本仓，10 秒）

```bash
cd packages/cli/templates
# 默认配置（mcp.enabled: true）→ 预期 status=1 + 上面那段 reserved prefix 报错
timeout 10 ~/.local/share/oj/oj serve -c config.yaml --module-root src -b /api; echo status=$?

# 只把 enabled 改 false → 预期 status=124（起站成功，被 timeout 杀掉）
# 探针 config 必须留在 templates/ 下：oj 的 db/mounts 相对路径按 config 所在目录解析
python3 - <<'PY'
s = open("config.yaml").read()
open("config.probe-off.yaml", "w").write(s.replace("    enabled: true", "    enabled: false", 1))
PY
timeout 10 ~/.local/share/oj/oj serve -c config.probe-off.yaml --module-root src -b /api; echo status=$?
rm -f config.probe-off.yaml
```

`oj --version` = `0.1.134`；仓库 `packages/cli/bin/oj` 为 0.1.129（低于 `MIN_OJ_VERSION` 0.1.130），
故本轮用 `~/.local/share/oj/oj`。

## 8. 风险与兼容

- **放宽不削弱安全边界**：元工具是**两个固定名字**，精确匹配即可完全阻止劫持；前缀判定多出来的只是
  「不许别人用 `oj` 开头」这一命名所有权，与 agent 安全性无关。
- **反向风险（若维持前缀）**：凡是启用 MCP 的站点，其模块名不得以 `oj` 开头——这条约束目前
  **既未写进任何 devkit 手册的错误前置检查，也没有启动期以外的暴露方式**，只能在起站失败时以
  「rename the route」的形式撞见；生态侧需要一次性排查/改名，成本按 §3(c) 同量级。
- **本仓不打算加兼容 shim**：不会为 0.1.134 维护「关 MCP 才起站」的分支，也不会把模块改成
  `market` 同时保留 `oj-market` 双路径（违反「不做向后兼容兜底」的既定纪律）。

## 9. 落地记录（oj 0.1.135，2026-11-13）

上游按 §5 的裁定执行：**A（精确名判定）立即做，B（校验收窄到实际暴露集）同做，C 押到下一 minor**，
且不需要任何排除开关或改名。落地比草案多修了一处**第二条隐性拦截**：

| # | 落地内容 | 对应草案 |
| --- | --- | --- |
| 1 | 启动 fail-fast 与 `oj mcp` codegen 扫描只拦净化名**恰好等于** `oj_search_tools` / `oj_list_groups`（serve 侧 `RESERVED_TOOL_NAMES`）；`oj_` 前缀不再有特殊含义 | 方案 A |
| 2 | **call 面同步收窄**（草案未覆盖）：原实现对任何 `oj_*` 名短路进元工具处理——即使扫描放行，直呼 `oj_market_*` 也会被劫持返回 `-32601`。现改为按保留名精确短路，业务 tool 正常分发 | 方案 A 的必要配套 |
| 3 | 扫描**先经 `server.mcp.modules` 白名单裁剪**（`apply_modules_filter` 上移到 serve::mcp 共享核心）：被白名单排除的模块不参与校验，修掉 0.1.134 上「`modules: [home]` 不豁免」的实测反例 | 方案 B |
| 4 | 方案 C（`tool_name` 覆盖 / 路由级改名）排到下一 minor。届时必须复用同一份保留名单，否则「元工具名不可被业务覆盖」的守卫会失真 | 方案 C（押后） |

### 9.1 本仓复核（0.1.135 二进制，2026-11-13）

| 验点 | 结果 |
| --- | --- |
| 模板默认配置（`mcp.enabled: true`，含内建 `oj-market`）起站 | ✅ 正常起站（0.1.134 上同一份配置 status=1 拒启） |
| `tools/list` | ✅ 114 个工具，其中 **24 个 `oj_market_*`** 全部在列 |
| `tools/call oj_market_catalog_get` | ✅ 正常分发进业务 handler（探针未带租户 claim → `403 tenant requires a signed claim`，**不是 `-32601`**；即 §9 第 2 条的隐性拦截已解） |
| `tools/call no_such_tool_xyz` | ✅ 仍 `-32601 unknown tool`（未知工具语义未被放宽） |
| `expose: routed` | ✅ `tools/list` 只回两个元工具；`oj_list_groups` 报出 `oj-market` 组；`oj_search_tools({query:"oj-market",group:"oj-market",limit:50})` 命中 **24 个** |
| 精确撞名仍 fail-fast / 元工具名不可覆盖 / `enabled: false` 中性 | ✅ 上游回归覆盖（serve 单测 + 11 条 MCP e2e）；本仓侧 `enabled: false` 实测中性 |

### 9.2 本仓随动

- `MIN_OJ_VERSION` **0.1.130 → 0.1.135**（`packages/cli/src/vendor.ts`）：0.1.134 是死版本，
  允许它进分发链等于发一个起不来的工程；门禁注释写明了这条理由。
- 回归 `tests/cli/vendor.test.ts` 新增「0.1.134 是死版本 → 门禁必须拒绝」一例（边界 0.1.134 false / 0.1.135 true）。
- 过渡期（0.1.135 未打 npm tag 前）：`ojm vendor` / `ojm init` 会停在门禁（npm latest 仍是 0.1.134），
  报错文本已指向「等上游发布 ≥ 0.1.135」；本机演练须先预置 `bin/oj` + `.oj-version`。
