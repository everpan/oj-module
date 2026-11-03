# 需求：开发者共享项目时本地密钥/凭据自动供给（方案 A'）

日期：2026-11-03 17:00 · 分支：feat/ojm

## 1. 背景与问题

`oj-module` 脚手架工程（`packages/cli/templates`）的 `config.yaml` 被 git 跟踪，但它引用了一类
**机器本地、不能进 git、却必须存在才能启动**的密钥/凭据。多名开发者共享（clone）同一项目时，这些
密钥不随仓库分发，导致 `pnpm dev`（`ojm dev` → `oj serve`）启动失败；且失败信息被吞，无告警。

### 1.1 项目里有哪些"不共享的私钥/凭据"

| 类别 | 文件 / 字段 | 是否进 git | 缺失后果 | 现状 |
|------|------------|-----------|----------|------|
| JWS 签发私钥 | `config/private.pem` | 否（`config/*.pem` 忽略） | 无法签 `cert.jws` | ✅ `ojm dev` 缺证自动签发（`oj-cert.ts`） |
| JWS 验签公钥 | `config/public.pem` | 否 | 启动拒启 | ✅ 随自动签发一并生成 |
| 启动闸门证书 | `config/cert.jws` | 否 | 启动拒启 | ✅ 随自动签发一并生成 |
| **凭据密封私钥** | `config/secrets-private.pem` | 否 | 解不开 `ENC[...]` | ❌ **无自动补发 → jwt_secret 起不来的真因** |
| 凭据密封公钥 | `config/secrets-public.pem` | 否 | 无法 re-seal | ❌ 同上 |
| 密封值 `auth.jwt_secret` | `ENC[...]`（config.yaml 跟踪，密文安全） | 值是密文 | 解密失败 | ❌ 依赖上面对，缺则崩 |
| `wecom_enc_key` 等落库加密键 | 建议 `oj secret keygen` 产出 | 否 | 企微永久码等落库加密失败 | ❌ 同类 `ENC[...]` 问题 |
| `ldap.bind_pw` 等 | 默认注释空 | — | dev 不接通 LDAP | ✅ 空值即可，无需本地密钥 |

机器本地密钥文件只有两套：**JWS 那套已自愈**，`secrets-*.pem` 那套**没自愈**；所有 `ENC[...]`
密封值都挂在后者的解密链上。修好后者，整类问题一起解决。

### 1.2 "吞提示"的成因

`startOj`（`packages/cli/src/oj.ts`）只抓 `oj` 的 stderr；而 oj 启动期 FATAL（含 jwt_secret 解密
失败）常落盘到 `server.logs_dir`（默认配置目录下 `./logs`，恰被 gitignore），且 `/health` 是
**匿名端点**——若 serve 半起（端口监听但 auth 坏了），健康返回 200，`ojm dev` 误判就绪，auth 在
请求期才静默炸。结果：要么超时且无输出，要么"起来了但登录全挂"，均无声告警。

## 2. 专家评审（架构师 + 工程师）

> 方法：逐条对照原方案 A，标严重度（高/中/低），只给可落地的修正。以下为评审结论与共识。

### 2.1 架构师评审

- **A-1（高）dev 密钥与 tracked `ENC[...]` 不应耦合。** 原方案让 dev 去"打开 tracked 里的
  `ENC[...]`、解不开就重封进覆盖层"，会留下一份本机谁都解不开的死 ENC，且 dev 启动逻辑要理解
  prod 密文。**改为：dev 完全不读 tracked `auth.jwt_secret`**；tracked 里的 `ENC[...]` 视作纯
  prod 资产，dev 自己生成一套本机密钥 + 随机 `jwt_secret`，封进 gitignored 的 `config.local.yaml`。
- **A-2（高）其他 `ENC[...]` 禁止 dev 随机重封——会破坏已加密落库数据。** `wecom_enc_key` 是
  落库加密键，企微 `permanent_code` 等密文依赖它；随机重封会使历史密文全解不开。**策略：dev 只
  自动供给 `jwt_secret`（无外部密文依赖、可随意轮换）；其余任何 `ENC[...]` 打不开 → 明确报错 +
  要求提供真实私钥，绝不静默重封。** 数据安全红线。
- **A-3（中）双轨必须显式声明 prod 路径 100% 不动。** 合并临时文件只用于 `ojm dev`/`preview`；
  手写部署（`oj serve -c config.yaml` + 部署机 `secrets-private.pem`）原样保留。
- **A-4（中）防回归护栏：合并产物绝不允许写回 tracked。** ojm 写 tmp 合并文件前必须断言：输出
  路径 ≠ tracked `config.yaml`、且位于 gitignore 内，否则密钥可能被误写回跟踪文件致泄密。

### 2.2 工程师评审

- **E-1（中）先实测 `--console-log` 是否真把 FATAL 落 stderr，再决定要不要整套读 `logs/`。**
  `ojm` 已给 `oj serve` 传 `--console-log`（oj.ts:95），手册说终端输出完整镜像落盘。若 FATAL 已
  进 stderr（ojm 已抓），主通道就是 stderr 提取；`logs/` 读取只是兜底。勿凭空加一整套日志解析。
- **E-2（中）`oj secret open` 失败怎么判？** 已确认 `oj secret open -k <key> <ENC>` 可用；但"解
  不开"是 exit 1 还是 panic stderr 需实测，预检要用 exit code 判定，并区分"格式错"与"密钥不匹配"。
- **E-3（高）幂等边界：密钥存在即跳过，绝不能每次 dev 重生成。** `keygen` 默认拒绝覆盖，所以
  ojm 侧要先 `stat` 再决定是否调 `keygen`；`jwt_secret` 一旦生成就固定，否则每次重启换密钥 →
  已签发会话全失效。
- **E-4（中）三文件必须 co-locate，且覆盖 `api/` 历史布局。** tmp 合并文件、`config.local.yaml`
  都要与 `config.yaml` 同目录（oj 相对路径按配置文件目录解析，`fs.root: .` 才仍指向工程根）。
- **E-5（中）测试与重复代码口径。** 复用 `tests/cli/dev-fullstack.test.ts`；把 `init.ts` 的
  `sealJwtSecret` 与新增 dev 供给逻辑抽成公共 `mergeConfigForDev()` + `provisionDevSecrets()`，
  避免 ENC 检测正则与 seal 调用两处重复（回应"重复代码"关注点）。

### 2.3 评审共识 / 风险登记

| # | 风险 | 严重度 | 处置 |
|---|------|--------|------|
| 1 | dev 误读/重封 prod ENC 留下死密文 | 高 | A-1：dev 完全独立生成密钥，不碰 tracked ENC |
| 2 | 随机重封 `wecom_enc_key` 破坏落库密文 | 高 | A-2：仅自动供给 jwt_secret，其余 ENC 打不开即报错 |
| 3 | 每次 dev 重启换密钥致会话失效 | 高 | E-3：存在即跳过，幂等 |
| 4 | 合并产物误写回 tracked 泄密 | 中 | A-4：写前断言非 tracked 且 gitignored |
| 5 | 失败提示仍被吞 | 中 | E-1：先验证 stderr，logs 作兜底 |
| 6 | 相对路径/历史布局错位 | 中 | E-4：三文件 co-locate |
| 7 | open 失败判定不准 | 中 | E-2：实测 exit code 语义 |
| 8 | 双轨语义渗进 prod | 中 | A-3：显式不变量 |

## 3. 修正后的方案 A'

### 3.1 设计要点（逐条对应评审）

1. **解耦 dev 密钥（A-1）**：`ojm dev`/`preview` 不再读 tracked `auth.jwt_secret`；tracked 里的
   `ENC[...]` 仅作 prod 资产。
2. **本地覆盖层 `config.local.yaml`（gitignored、可手编辑）**：ojm 首次供给时生成
   `config/secrets-{private,public}.pem`（gitignored）+ 随机 `jwt_secret` 并用本机公钥 seal，
   写入 `config.local.yaml` 的 `auth.jwt_secret` 与 `secrets:` 段。**dev 不写 tracked 文件。**
3. **合并产物（A-1/E-4）**：ojm 深合并 `config.yaml` + `config.local.yaml` →
   `<configDir>/.ojm-tmp-config.yaml`（已被模板 `.gitignore` 的 `.ojm-tmp-*` 忽略）→
   `oj serve -c`。加 co-locate 断言。
4. **写回护栏（A-4）**：`assertOutputIsNotTracked()` —— 输出路径不得等于 tracked config 且须命中
   gitignore。
5. **非 jwt ENC 红线（A-2）**：若 config 出现其他 `ENC[...]` 且本机私钥打不开 → 抛清晰错误
   "该 ENC 由某密钥密封、本机无对应私钥；请提供真实 `secrets-private.pem` 或放置后重试；
   **勿用 dev 随机密钥重封，以免破坏已加密数据**"。**不**自动重封。
6. **预检前置（复用端口守卫模式）**：spawn 前跑就绪检查（证书三件套现有自动签发 + secrets 对 +
   dev jwt_secret），不满足即停并给可操作提示（E-1/E-2：先实测 stderr/exit 语义再定 logs 兜底是否必要）。
7. **失败提示（E-1）**：优先从已抓 stderr 提取真实错误；若验证确认 FATAL 有时不落 stderr，再读
   `<configDir>/logs/server-*.log` 最新文件兜底；拒绝信息永远带原始错误行，替换 "(无输出)"。
8. **`ojm rekey`**：重生成 `config.local.yaml` 里的 dev 密钥并重封 jwt_secret（不碰 tracked）；
   `ojm dev` 在预检不通过时自动调一次（幂等）。
9. **工具去重（E-5）**：抽 `mergeConfigForDev()` + `provisionDevSecrets()`，复用 `init.ts` 的 seal
   逻辑，ENC 检测正则只留一处。
10. **prod 不变量（A-3）**：手写部署路径零改动，合并机制仅 dev/preview 生效。

### 3.2 配置层次（落地后的形态）

```
config.yaml            # 跟踪：共享非密配置 + prod 的 auth.jwt_secret: ENC[...]（dev 忽略）
config.local.yaml      # gitignored、可手编辑：dev 覆盖 + dev 的 secrets 段 + dev jwt_secret(ENC)
config/secrets-*.pem   # gitignored：dev 本机密封密钥对
.ojm-tmp-config.yaml   # gitignored、自动生成：config.yaml ⊕ config.local.yaml 深合并 → oj 实际读
```

`ojm dev` 实际执行：`oj serve -c .ojm-tmp-config.yaml -b <base> --module-root src --console-log`。

### 3.3 供给流程（首次 clone 的一次性动作）

```
ojm dev
 └─ 预检（spawn 前）
     ├─ 证书三件套缺失 → 现有 oj-cert.ts 自动签发
     ├─ config/secrets-private.pem 缺失 → oj secret keygen --out-dir config
     ├─ config.local.yaml 无有效 dev jwt_secret → 生成随机 jwt_secret
     │     → oj secret seal -k config/secrets-public.pem → ENC[...]
     │     → 写入 config.local.yaml（auth.jwt_secret + secrets: 段）
     ├─ 其他 ENC[...] 用本机私钥打不开 → 抛清晰错误（红线，不重封）
     └─ 写回护栏：断言 .ojm-tmp-config.yaml 非 tracked 且 gitignored
 └─ 深合并 → .ojm-tmp-config.yaml → oj serve -c
```

### 3.4 模板变更与本地重生成（drift）

tracked `config.yaml` 本质是**共享模板**：团队改它（新增挂载/匿名路径/变量、调端口、轮换 prod
`ENC[...]`、新增共享 `ENC[...]` 字段等）后经 git 分发。dev 拉到新版模板后，本地配置必须基于新模板
重生成，且**不丢失本机密钥**。

机制（A' 已隐含，这里显式化）：

- **合并产物每次 `ojm dev` 现合现用**：`.ojm-tmp-config.yaml` 不是缓存，而是每次启动都用
  `config.yaml`（最新模板）+ `config.local.yaml`（本机持久层）深合并产出。故模板的**非密改动**
  （新挂载、新 var、端口变化等）**自动生效**，无需 dev 任何操作。
- **本机密钥/覆盖持久化于 `config.local.yaml`**：dev 的 `secrets-*.pem` 与 dev `jwt_secret`(ENC)
  只存在 `config.local.yaml`（gitignored），重合并时始终被套用，模板怎么改都不丢。
- **dev 对模板字段的显式覆盖**：若 dev 在 `config.local.yaml` 手动覆盖了某模板字段，重合并后该
  覆盖仍优先——dev 可能因此错过团队的共享更新；可选加"模板版本戳"：在 `config.local.yaml` 记录
  其所基于的 tracked 模板 hash，启动时若 hash 变化则提示 dev 复核本地覆盖（不阻断）。
- **新增共享 `ENC[...]` 红线不变（A-2）**：模板新增一个用 prod 密钥封的 `ENC[...]`（如新
  `wecom_enc_key2`），dev 本地没有对应私钥 → 合并后该字段是打不开的 prod 密文 → 触发 A-2 清晰报错
  （要求提供真实私钥），**不**自动用 dev 随机密钥重封。这是"共享模板变更后需补真实密钥"的唯一手动步骤，
  属数据安全必需，无法自动化。

一句话：**非密改动零操作自动生效；本机密钥零丢失；仅"新增共享密文"需 dev 取得真实密钥（红线保护）。**

### 3.5 影响面

- `packages/cli/src/dev.ts`：新增预检 + 供给编排（复用端口守卫同款"不满足即停"模式）。
- `packages/cli/src/oj.ts`：失败信息提取（stderr 优先，logs 兜底），替换 "(无输出)"。
- `packages/cli/src/init.ts`：复用/抽离 `sealJwtSecret` 为公共 `provisionDevSecrets()`。
- 新增 `packages/cli/src/rekey.ts`：`ojm rekey` 命令。
- 新增 `packages/cli/src/config-merge.ts`：`mergeConfigForDev()`（深合并 + co-locate 断言 + 写回护栏）。
- 模板 `.gitignore`：显式补 `config.local.yaml`（`.ojm-tmp-*` 已覆盖）。
- 回归测试：`tests/cli/dev-fullstack.test.ts` 增 fixture。

## 4. 性能与重复代码口径

- **性能开销**：每次 `ojm dev` 固定增加 = 1 次 `yaml.parse`（小文件 <10ms）+ 几次 `stat`；**首次
  clone** 多 1 次 `oj secret keygen` + 1 次 `seal`（合计 <100ms），之后密钥存在即跳过（no-op）。
  合并产物为 KB 级临时文件一次写。净开销：首次 <200ms，之后可忽略；**不引入任何后台轮询/文件监听**。
- **重复代码**：仅 `init.ts::sealJwtSecret` 一处 seal + ENC 正则；A' 抽公共工具后，**seal 调用与
  ENC 检测各归一处**，dev 供给与 init 共用，无新增重复。

## 5. BDD / 回归用例

- **G1 首次 clone 无密钥**：fixture 无 `config/secrets-private.pem` → `ojm dev` 自动生成密钥 +
  写 `config.local.yaml` + serve 起来；断言 `config.yaml`（tracked）字节未变、`.ojm-tmp-config.yaml`
  含 dev 的 `ENC[...]`。
- **G2 二次启动幂等**：已供给后再次 `ojm dev` → 不重生成（密钥存在即跳过），`jwt_secret` 不变
  （已签发会话不失效）。
- **G3 红线不被破**：fixture 故意放一个用未知密钥封的 `wecom_enc_key: ENC[...]` → `ojm dev` 清晰
  报错、提示提供真实私钥、**不**自动重封、不写回 tracked。
- **G4 失败不吞提示**：故意令 oj 启动期 FATAL（如证书损坏）→ `ojm dev` 拒绝信息含真实错误行，
  不再 "(无输出)"；若实测 stderr 不全，验证 logs 兜底路径。
- **G5 预检前置报错（类比端口守卫）**：缺证书且无法自动签发 → spawn 前即停并给可操作提示。
- **G6 历史 `api/` 布局**：`api/config.yaml` 下三文件 co-locate，相对路径（`./config/...`、
  `db.sqlite`、`fs.root: .`）解析正确。
- **G7 模板变更自动重合并（drift）**：fixture 先以旧模板供给并 serve；修改 tracked `config.yaml`
  （如新增一个 var / 改端口）后再次 `ojm dev` → 合并产物反映新模板值，且 dev `jwt_secret`(ENC) 与
  `secrets-*.pem` 不变（本机密钥保留）；若模板新增一个打不开的共享 `ENC[...]` → 触发 A-2 红线报错
  而非静默。

## 6. 开放点与验证清单

- [ ] 实测 `oj secret open` 用错密钥的 **exit code 与 stderr**（E-2）。
- [ ] 实测 oj 加载期 FATAL 是否进 **stderr**（决定 logs 兜底是否必要，E-1）。
- [ ] 确认 `.ojm-tmp-*` 与新增 `config.local.yaml` 在模板 `.gitignore` 覆盖（含 `api/` 历史布局）。
- [ ] `oj secret keygen`/`seal` 在 Windows 下的 PEM 路径分隔符（oj 是否接受反斜杠），按需归一为正斜杠。
- [ ] 是否引入"模板版本戳"提示 dev 复核本地覆盖（drift 提醒，非阻断）——G7 默认实现自动重合并即可，戳为可选增强。

## 7. 结论

方案 A' 在方案 A 基础上，经架构师 + 工程师评审修正：dev 密钥与 tracked prod ENC 完全解耦、非 jwt
的 `ENC[...]` 设重封红线（数据安全）、幂等供给、合并产物写回护栏、失败提示兜底。改动集中在
`ojm dev`/`preview` 预检与失败信息，prod 手写部署路径零改动。
