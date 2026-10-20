# 开发态模块与本地 CDN 演练场

> 一篇写给「第一次在本工程开发模块」的人的教学文档。读完之后你应该能回答三个问题：
> **① 开发中的模块要不要「安装」？② 要的话装到哪、会不会重复？③ 怎么在本地把市场链路完整跑一遍？**
> 适用版本：`@oj-module/cli` 0.2.12+（`ojm market` 子命令），运行期 `oj` ≥ 0.1.73。

## 1. 先建立心智模型：开发态 ≠ 分发态

整个体系里存在**两套互不相干**的模块生命周期，混在一起是绝大多数困惑的来源：

| | 开发态 | 分发态 |
|---|---|---|
| 模块在哪 | 工程内源码：`web/src/A` + `api/src/A` | 一个 `.tgz` 包（`ojm build --bundle` 产出） |
| 谁登记它 | `web.config.ts` 的 `modules` 列表 → `ojm build` 生成 `modules.json` | 安装器往目标站点 upsert |
| 跑起来靠 | `ojm dev` 直跑源码，改一行刷新即见 | 安装器十阶段（下载→验签→解压→迁移→注册→热更→冒烟） |
| 典型场景 | 你在写它 | 别人（或另一个站点）装它 |

一句话：**开发态没有「安装」这个动作**。`ojm dev` 起的站点直接扫描 `api/src` 产生路由、读 `modules.json` 装配菜单——你写的模块 A 此刻「已经在跑」，只是还没打过包。

## 2. 常见问题：我开发了模块 A，怎么「安装」我自己？

### 2.1 正确答案：装到别处，不是装进你正在开发的工程

「安装自己」听起来矛盾，是因为安装这个动作的语义是**把一个包的分发产物并入一个宿主站点**。你正在开发的工程就是 A 的家，再装一遍相当于把家具搬进它已经在的屋子。

真正想验证「A 这个包能不能装、安装流程对不对」时，有三个去处，按推荐顺序：

1. **一次性隔离站点**：随机端口 + 一次性 DB + 一次性密钥，跑完即毁，不碰你的工程、DB、信任库。这是唯一「装了也不心疼」的地方。
2. **另一个工程**：`ojm install dist/A-0.1.0.tgz`（file 源，multipart 直传）。
3. **市场链路**：`ojm market publish` 落 CDN → 市场页点安装（§4 全套）。

### 2.2 偏要在本工程试怎么办

先 `ojm uninstall A` 再装，且升级走安装器的重装路径、不要手工覆盖同版本文件。理由见 §3.3 的「遮蔽」。

## 3. 常见问题：装完之后路由、菜单会重复吗？

**不会重复——注册面全是 upsert（按键覆盖），不是 insert（追加）。** 但有两个坑，分开说。

### 3.1 upsert 语义：同键只有一份

| 面 | 键 | 重复安装时发生什么 |
|---|---|---|
| 路由 `sys_solution_route` | `path` | 同 path 覆写元数据、下架标记复位 |
| 角色 / 权限 | 模块 + code | 按键 upsert；**本次未声明**的条目标记下架（行保留、不删） |
| 系统设置 `sys_setting` | `key` | 按 key upsert，但**管理员改过的值永不复活** |
| `modules.json` | 模块名 | 按模块名登记，唯一条目 |

所以「菜单出现两条 A」这种事不会发生——菜单条目按模块名唯一。

### 3.2 但同名再装会被直接拒

安装前置校验有**方案名唯一**约束：同名方案已装 → 拒装并报占用者版本（`方案名已被已装方案「A@x.y.z」占用`）。只有升级 / 重装路径放行。这是第一道防线：从入口就不给你制造重复的机会。

### 3.3 真正的坑：两个来源抢同一个 name/path（遮蔽）

注意 §3.1 的 upsert 是**按 name/path** 而不是按来源。于是存在这种状态：

> 你源码里的 A（`api/src/A`，路由由 oj 扫描源码产生）和某次安装产物 `dist/A-0.1.0/` 同时存在。

表现是：路由与模块条目各自只有一份（不重复），但**哪一份生效取决于挂载命中顺序**——症状为「我改了源码却不生效」或「行为怎么都不对」。这是本主题下最难查的一类问题：没有报错、没有重复，只是「被另一个自己顶替了」。

**规避方式**：别让两个来源同时在场。日常开发不装；试装去隔离站点；本工程试过之后 `ojm uninstall A` 清干净再回到源码直跑。

## 4. 本地 CDN 演练场：把市场链路完整跑一遍

模板自带一个**本地模拟 CDN**（工程根 `cdn/` + `api/config.yaml` 的 `/cdn` 挂载），配上 `ojm market` 四条命令，就能在本地复刻「发包 → 上架 → 索引 → 安装」全链路。不需要外部服务。

### 4.1 全流程（五步）

```bash
# 0) 起站点（dev 或 serve 均可；市场地址必须指向 oj 子进程的端口，见 §5.1）
ojm dev

# 1) 打开市场地址：把 framework.market_cdn_url 指向 http://127.0.0.1:9778/cdn
#    站点管理员首次登录处于改密悬挂期时会自动改密换全权 token
ojm market setup --user admin --pass 123456 --new-pass <你的口令>

# 2) 发包：合成 fixture（或 --real 走 ojm build --bundle）→ 确定性 tgz → 包级签名
#    --rebuild-index 顺带重建索引
ojm market publish --fixture demo-solution@0.1.0 --id <发布方id> --rebuild-index

# 3) 离线验包：不起站点、不装、不要凭据
ojm market verify --rebuild-index

# 4) 浏览器打开市场页 → 看到卡片 → 点安装
#    首次遇陌生发布方会停在「待信任」→ ojm trust confirm --task <id> → 重试即成
```

每条命令的边界：

| 命令 | 做什么 | **不**做什么 |
|---|---|---|
| `market setup` | 写系统设置 `framework.market_cdn_url` | 不改写 `api/config.yaml`（挂载由模板自带） |
| `market publish` | 落 `<name>-<version>.tgz` + 包级 `.tgz.sig` | **不碰索引**（索引是共享单文件，多人发布会互相覆盖） |
| `market build-index` | 扫 `cdn/*.tgz` 提取包内 manifest，全量重建两份索引并签名 | 不落包 |
| `market verify` | 完整性 / 包级签 / 索引签 / manifest 结构四类校验 + 漂移检出 | 不起站点、不装、不访问任何远端 |

### 4.2 索引为什么是「扫描重建」而不是「增量合并」

因为索引签名对不上多人协作：如果 publish 时读-改-写共享索引，后发者会把前者的签名覆盖掉，且存在竞态。而索引签名在运行期只是**完整性层**（防目录被改），不是信任锚——那就干脆把它降级成派生产物：**谁都能重建，重建结果只取决于目录里有什么**。这也是 `publish` 与 `build-index` 必须分成两个命令的原因。

### 4.3 信任模型（30 秒版）

- **包级签名**（`<tgz>.sig`，Ed25519）：信任锚。安装时逐字节验，不过即拒（fail-closed）。
- **索引签名**：完整性层。索引被改能发现，但**不背书内容安全**。
- **TOFU**：首次遇到未登记的发布方 key，安装停在待信任状态，管理员确认后写入信任库；首次绑定不可改。
- `market verify` 的结论恒带一句边界声明：**校验通过只说明来源与完整性，不构成内容安全性背书**——这不是免责套话，是信任模型的准确描述。

## 5. 两个已经踩过的坑（别再踩）

### 5.1 dev 形态下，`/cdn` 不在 dev server 上

`ojm dev` 的 Node 服务在 **5174**，只把 `/api` 反代给 oj 子进程；`/cdn` 是 **oj 的挂载**，只在 oj 子进程（`config.yaml` 的 `server.port`，默认 9778）上成立。所以市场地址**必须写绝对 URL** 且端口取自 config——写成相对 `/cdn` 的话，dev 下取到的是 index.html，报出来是难懂的 YAML 解析错，不是干净 404。`market setup` 已按 config 推导，别手改。

### 5.2 CDN 里摆了 `.tgz.sig` 侧车，不等于能装

安装器的验签段只认 `manifests.yaml` 里的 `archive.signature`。侧车文件在目录里摆着**不够**，索引不带过去就是 `sig_missing` 硬拒。`market build-index` 已负责把侧车读进索引——所以规范动作永远是 **publish → build-index**，两个都跑。

> 附注：曾有一条「包内 `api/<mod>/manifest.yaml` 的 desc 必须逐字等于方案 summary」的校验，已于 2026-10-21 移除——那是构建期映射被当成安装期契约，而 desc 只是模块描述文本、非安全边界。现存相关校验只有：`summary` 必填、`desc` 必填非空。

## 6. 实战：发一个真方案，并躲开七个坑

上面的 fixture 路径能秒出可装包，但真实交付要么写方案工程、要么至少知道真构建长什么样。下面是
2026-10-21 一次**完整演练**（宿主 `ojm init` → 方案工程 → 打包签名 → 发布 → 安装 → TOFU → 装成）
沉淀下来的路径与坑。演练两轮全绿（换全新宿主零手工补丁复跑同样通过）。

### 6.1 方案工程最小形态

```text
solution-demo/
├── manifest.yaml                      # 方案契约清单（Form A）
├── api/src/<name>/
│   ├── manifest.yaml                  # oj 原生清单（name/desc/version/tables）
│   ├── schema.yaml                    # 表结构真源（必须与 manifest.tables 对齐）
│   ├── routes.js
│   ├── migrations/0001__init.sql
│   └── ping/api.ts                    # handler 必须是 .ts
└── web/src/<name>/locales/{zh-CN,en-US}.json   # 引用 i18n key 时必需
```

```bash
<host>/bin/oj build -d api/src -o api/dist        # 后端构建（只用宿主已装的 oj）
node "$CLI_PKG/bin/ojm.mjs" build --bundle        # 打包（构建即校验）
node "$CLI_PKG/bin/ojm.mjs" keygen --id demo.publisher --out ./keys --yes
node "$CLI_PKG/bin/ojm.mjs" sign dist/<name>-<version>.tgz --id demo.publisher --key ./keys/private.pem --check
```

### 6.2 发布与安装（release 形态）

```bash
cd <host>
node "$CLI_PKG/bin/ojm.mjs" market publish --real ../solution-demo --id demo.publisher --key ../keys/private.pem --rebuild-index
node "$CLI_PKG/bin/ojm.mjs" market verify --rebuild-index

node "$CLI_PKG/bin/ojm.mjs" build                 # 生成 api/dist + web/dist（含 api/dist/versions.json）
# config：platform.root 改成 dist（安装目标恒为 release 部署）
(cd api && ../bin/oj serve -c config.yaml -b /api --api-path dist --console-log &)
node "$CLI_PKG/bin/ojm.mjs" market setup --url http://127.0.0.1:9778 --user admin --pass 123456 --new-pass <新口令>
# 市场页点安装 → 首次停在「待信任」→ 核对指纹 → ojm trust confirm --task <id> → 重试 → done
```

### 6.3 七个坑（按撞见顺序）

| # | 现象 | 根因 / 正确做法 |
|---|---|---|
| ① | `oj build` 报 `tables 声明 "x" 不在 schema.yaml` | oj 用 `schema.yaml` 做表结构真源，`manifest.tables` 只是引用面；补 `schema.yaml`（`tables: {<t>: {pk, columns}}`），与迁移语句对齐 |
| ② | `oj build` 成功但 `routes.js` 是空表、dist 里没有 handler | **只编译 `.ts` handler**；写成 `ping/api.js` 会被静默丢弃 → 改 `api.ts` |
| ③ | `build --bundle` 报 `缺少 web/src/<name>/locales/…` | manifest 一旦引用 `title_key`/`label_key` 就必须双语 locale（后端方案也要）；且 key 必须**嵌套** `{"menu":{"main":"…"}}`，平铺 `"menu.main"` 查不到 |
| ④ | 安装 POST 返回 200，但 `market/task` 恒 404 | 宿主 config 缺 `fs:` 段 → 安装器落盘被 jail 拒、失败发生在任务文件写入前；0.2.13 起模板自带，旧工程手补 |
| ⑤ | 安装卡 `preflight`：`无法读取宿主 runtime 版本` | 安装器读 `api/dist/versions.json`；0.2.13 起 `ojm build` 双落点（旧版手抄 `web/dist/versions.json`） |
| ⑥ | 安装卡 `reloading`：`NotCapable: module '_platform' is not platform-privileged` | 宿主 config 的 `platform.modules` 未列 `_platform`（0.2.13 起模板自带） |
| ⑦ | 安装卡 `reloading`：`reloadConfig 返回 unchanged` / 卡 `smoke`：探活 404 | 起站形态不对：`ojm preview` 服务派生 config（安装器热更写的是 `api/config.yaml`，被监视文件没变）；dev（`--api-path src`）装到 dist 的模块不被发现。**安装必须对真实 config 以 `--api-path dist` 起站** |

### 6.4 装成之后怎么确认

```bash
curl -s http://127.0.0.1:9778/api/<name>/ping        # {"code":0,...pong...}
cat api/dist/manifests.yaml | grep <name>            # <name>: <version>
ls api/dist/<name>-<version>/                        # 安装产物目录
```

## 7. 一页速查

```text
写模块      → 源码直跑（ojm dev），不要装
验证能装    → 隔离站点，或 ojm install <tgz> 到另一个工程
重复？      → 不会。注册面全 upsert；同名再装被前置校验直接拒
市场链路    → setup → publish → build-index → verify → 市场页安装（release 形态：--api-path dist）
绝对 URL    → 市场地址端口取自 config（9778），不是 dev server 的 5174
信任        → 包级签=锚，索引签=完整性，TOFU 管陌生发布方，verify 不背书内容安全
```

## 8. 延伸阅读

- 方案打包与分发全貌、签名与信任：本 skill 的 `manual.md` §11–§12
- 后端 handler 写法、站点挂载（`mounts`）等：`oj-api-dev` skill 手册
