# 需求：`ojm build` 出包预检门禁显式化（`--local-secrets` 取舍定夺）

> **受众**：`@oj-module/cli` 维护者与发布流程 owner——**上游就是本仓**：预检与合并链路都落在 `packages/cli`，取舍由本仓定夺（本文可直接作为 issue 正文）。
> **状态**：默认合并链路已在 `feat/ojm` 实现（口径：「本地 build 仅验证编译」），待追认；显式开关 `--local-secrets` 是否需要，**待定夺**。
> **级别**：设计定夺（非缺陷）——改变「build 通过」这一信号的既有语义，影响依赖该信号的发布流程。
> **关联**：`packages/cli/src/dev-secrets.ts`（方案 A'：开发态密钥自动供给）；`packages/cli/src/build/backend.ts`（出包预检）；§R3 面向 only-js / oj 维护者（`oj build` 静默降级，文档格式先例见 `20261104-oj-windows-exec-resolver-requirement.md`）。

## 1. 背景

`ojm build` 在调 `oj build` 前有一道 fail-closed 预检（`assertSealedValuesOpenable`）：对 config 里的每条 `ENC[...]` 逐条 `oj secret open`，解不开即 exit 1。动机是实测（oj 0.1.115/0.1.116）：`oj build` 读不动 config 时**退出码仍是 0**，只 warn 两行（镜像目录回落默认 `tasks`、`sql_guard` 关闭）就照常出包——包看着完好，tenant 声明校验其实没跑。

但该预检隐含了一条**未声明的门禁**：

> 出包机 = 持生产私钥的机。

预检对 tracked `config.yaml` 原文逐条试解，等价于要求本机能解开全部生产密文。而方案 A'（开发态密钥自动供给）落地后，开发机的密钥形态是刻意设计的：

| 密钥 | 位置 | 口径 |
| --- | --- | --- |
| 本机 dev 密钥对 | `config/secrets-{private,public}.pem`（gitignored） | 机器本地，`ojm dev` 自动生成 |
| dev `jwt_secret` | `config.local.yaml`（gitignored） | 机器本地可轮换凭据 |
| tracked prod `ENC[...]` | `config.yaml`（入仓） | **仅作 prod 资产，dev 侧按设计不解**（dev-secrets.ts：「dev 密钥与 tracked prod ENC 解耦」） |

于是：全新 clone 的机器 `pnpm dev` 正常、`pnpm build` 必挂，且预检报错给出的两类原因（私钥不配对 / 密文被改）在本场景**都不成立**——密钥是本机刚生成的 dev 对，密文与提交版逐字节一致。

**编译本身不需要密文明文，产物也不嵌 config（部署侧自带）**——拦截完全来自包装层预检。

## 2. 已落地的默认行为（方案 A，待追认）

`buildBackend` 跑 `oj build` 前走与 dev 相同的合并链路：

1. 调 `mergeConfigForDev`：tracked + gitignored `config.local.yaml` 深合并 → `.ojm-tmp-config.yaml`（与 config.yaml 同目录，gitignored）；
2. `-c` 指向合并产物；
3. `assertSealedValuesOpenable` 改对**合并产物**逐条试解（兜底双保险）；
4. 非 jwt 的 `ENC[...]` 红线不变：`checkNoUnopenableSharedEnc` 解不开仍抛错（真实生产数据密钥如 `wecom_enc_key` 解不开时 build 依然 fail-closed，防护不降级）。

不削弱既有保障的理由：

1. 被替换的只有 `jwt_secret`——它本就是机器本地可轮换凭据（dev 侧已如此对待）；
2. 合并产物与 tracked 结构一致，`sql_guard` 照常执行；`tasks` 镜像目录用上 tracked 真实配置，比「回落默认 `tasks`」更正确；
3. 合并产物与 `config.yaml` 同目录，`secrets.private_key_path` 等相对路径解析不变；
4. 预检的动机（防 `oj build` 静默降级）由「走合并配置」满足，而非「要求生产私钥在位」。

## 3. 语义变化：门禁让渡了什么

| | 原行为 | 现行为（方案 A） |
| --- | --- | --- |
| build 成功 ⇒ | 本机能解开全部 tracked 密文（≈持生产私钥） | 编译通过 + 合并产物可读 + sql_guard 输入有效；**不再证明持生产私钥** |
| 预检失败 ⇒ | 私钥不配对 / 密文被改 | （合并产物内）dev jwt 损坏或 local 覆盖带了外来密文；tracked 非 jwt 红线另行拦截 |
| 无生产私钥的开发机 | dev 能跑、build 必挂 | dev / build 全通 |

**若发布流程把「build 通过」当「生产密钥在位」的信号，该信号已失效。** 这正是需要定夺的部分：本文不假设该信号从未被依赖，而是把取舍摆到台面上，由发布流程 owner 确认。

## 4. 取舍选项

| 方案 | 行为 | 适合 | 代价 |
| --- | --- | --- | --- |
| **A（已实现）** | 默认走合并链路 | 「本地 build 仅验证编译」口径；开发机出包即验证 | 失去「build 通过 ⇒ 密钥在位」信号 |
| **B** | 默认维持旧预检；`ojm build --local-secrets`（或 `OJM_BUILD_LOCAL_SECRETS=1`）显式走合并 | 发布流程依赖旧信号、出包机持生产私钥的团队 | 开发机每次 build 都要带旗标，混进脚本后失去区分度 |
| **C（A+B 组合，建议终态）** | 默认走合并（A）；另加 `--strict`（或 `--seal-prod`）对 **tracked 原文**逐条试解，供出包机自证「密钥在位」 | 两个信号都要：日常出包零门槛，发布前置检查显式化 | 多一个旗标的文档与维护成本 |

**建议：追认 A 为默认；若发布流程确认需要「密钥在位」信号，再补 C 的 `--strict`。** 理由：B 把高频动作（开发机日常出包）挂在低频语义（发布门禁）上，旗标会迅速被写进各种脚本而被泛化，门禁名存实亡；C 让两个语义各得其所——默认快、显式严。

## 5. 需求（按优先级）

**R1（必须，待追认）— 默认口径定夺**
确认「本地 build 仅验证编译」：`ojm build` 默认走 dev 合并链路，预检对合并产物兜底，tracked 非 jwt 红线不变。本仓 devkit 已随动（manual §10.1、SKILL 排障表、playbook 心智模型表）。

**R2（条件必须）— 若保留「密钥在位」信号则补 `--strict`**
规格：
- `ojm build --strict`（或 `--seal-prod`）：在合并链路**之外**，对 tracked `config.yaml` 原文里的全部 `ENC[...]`（含 jwt）逐条试解，解不开 exit 1——出包机自证持生产私钥；
- 环境变量等价物 `OJM_BUILD_STRICT=1`（CI 注入友好）；与 `--bundle` 正交；
- 报错文案与旧预检一致（两类原因 + 单独验一条的命令）；
- devkit runbook（`publish-walkthrough.md`）补一节「发布前置检查」。

**R3（建议，面向 oj 上游）— `oj build` 静默降级收敛**
本需求的根因之一在 oj 侧：config 读不动时 `oj build` 退出码仍是 0，只 warn 两行。建议 oj 提供其一：
- `--fail-on-config-error` 旗标（或等价环境变量），config 解析失败 / 密文解不开时退出非 0；
- 或至少让 `sql_guard` 关闭与 `tasks` 回落默认出现在 stderr **末尾汇总**，并配一个可被消费方 grep 的结构化标记。

ojm 侧无论 A/C 都会保留自己的预检兜底（不信任下游退出码是本仓一贯口径），但 oj 收敛后可逐步降低预检的不可替代性。

**R4（建议）— 文档与流程对齐**
- `framework-verification-playbook.md` 补「出包机密钥形态」一节：dev 机（无生产私钥）可直接 build；发布出包机按 R2 走 `--strict`；
- devkit `manual.md` §10.1 的合并链路描述随 R2 同步 `--strict` 条目。

## 6. 验收标准

1. 全新 clone、仅本机 dev 密钥对的机器：`ojm dev` 与 `ojm build` 全通；`.ojm-tmp-config.yaml` 内 jwt 为本机 dev 密文，tracked prod ENC 不进入合并产物。
2. tracked 含**非 jwt** 解不开密文：build 红线报错 exit 1，文案指名字段路径（如 `/wecom_redline_probe/enc_key`），不用 dev 随机密钥重封。
3. 合并产物含解不开密文（local 覆盖带入）：build 停在出包前 exit 1，报错附 oj 原话。
4. R2 若落地：`ojm build --strict` 在无生产私钥的机器上 exit 1 且明确指认 tracked 密文；默认行为（不带旗标）与验收 1–3 完全一致，零回归。
5. devkit（manual / SKILL / playground）与实现口径一致，无「出包机 = 持生产私钥」的残留表述。

## 7. 证据

- 实现与测试：`packages/cli/src/build/backend.ts`（合并链路 + 预检对象改合并产物）、`packages/cli/src/__tests__/build-backend.test.ts`（10 用例，vi.mock 进程内假 oj，三平台通吃）。
- 真机演练（d:/ojm-verify/my-books，真实 bin/oj.exe）：异机 jwt ENC 场景修复前预检拦截、修复后 exit 0；wecom_redline_probe 红线 exit 1。演练后 tracked config 已逐字节还原。
- devkit 随动：docs/devkit/manual.md §10.1/§8、docs/devkit/SKILL.md、docs/devkit/module-dev-and-cdn-playground.md §1（packages/cli/devkit/ 为 prepack 生成物，已重新同步一致）。

> 本文档定夺后：R1 追认结果记入本文件「状态」行；R2/R3 按验收标准分别落实现与上游 issue。
