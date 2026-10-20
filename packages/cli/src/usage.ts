/**
 * `ojm` 用法文本（抽为纯函数供测试断言；index.ts 仅负责打印与退出码）。
 */

export function usageText(): string {
	return `@oj-module/cli

用法:
  ojm --version | -V
        显示 cli 包版本
  ojm init [dir] [--yes]
        前后端一体化工程脚手架（幂等补缺）
  ojm dev [port]
        启动开发服务器（/api 反代 oj + 模块重建 + SSE 刷新）
        开发模式快捷键（仅 TTY 终端，类 Vite）:
          r  强制重建并热更新    h  显示帮助    c  清屏    o  浏览器打开
          q  退出（后端 oj 一并终止）
  ojm build [--bundle] [--out <dir>]
        构建后端（oj build）与模块产物（含全站合并）
        --bundle   方案包构建：manifest.yaml 契约校验（C2，fail-fast）→ 确定性 tgz
                   → dist/<name>-<version>.tgz + sha256（市场安装器的上游产物）
        --out <dir>  --bundle 输出目录（缺省 dist/）
  ojm preview [port]
        生产形态预览（migrate → oj serve 单服务：API 与静态 SPA 同进程，深链回落）
        静态由 oj web 挂载直出；ojm 不起第二个服务、不做反代
  ojm api [dir] [--check] [--docs] [--exempt <path>]
        契约代码生成（client / routes / openapi / stub）
        --check   四重对账（生成物同步 / route 双向 / routes.js / WS 路由鉴权）
        --exempt <path>  指定豁免清单，覆盖默认 api/.ojm-api-exempt.json
        --docs    出自包含文档站（单文件离线可看）
  ojm info
        输出版本矩阵与模块清单（报障用，US-7）
  ojm vendor [tag] [--force]
        下载/重装 oj vendor（经 npm 包 @oj-bin/oj；tag 缺省取最新，形如 v0.1.13）
  ojm merge <out.json> <in1.json> [in2.json ...]
        合并多团队清单（R12）
  ojm install <file.tgz | name[@version]> [--url <u>] [--user <u>] [--pass <p>]
              [--name <n>] [--version <v>] [--locale <zh-CN|en-US>]
        安装方案包到目标站点（P1-13）：本地 tgz 走 file 上传（<name>-<version>.tgz 文件名推导
        身份，可 --name/--version 覆盖）；name[@version] 走 CDN 市场源。登录 → 提交 → 轮询任务
        至终态并打印结果（失败附原因 + 指引，--locale 切双语）
  ojm enable|disable <name> [--url <u>] [--user <u>] [--pass <p>]
        启用/禁用已装方案（D12 四处同写：锁 / sidecar / sys_solution_route / modules.json）
  ojm uninstall <name> [--url <u>] [--user <u>] [--pass <p>]
        卸载已装方案（P1-15a：四处同删 + 权限级联清理 + 版本目录移除；站点至少保留一个已锁模块）
  ojm trust ls|add|revoke|confirm [--url <u>] [--user <u>] [--pass <p>]
        发布方信任库管理（P2-2/3，站点 .solutions/trusted-keys.yaml）：
        ls <key_id 前缀?>        列出已信任 key（含 sha256 指纹分组展示）
        add <key_id> <pub>       新增信任（64 hex 公钥；首次绑定不可改）
        revoke <key_id>          吊销（阻断新装/升级，不动已装方案）
        confirm --task <id>      TOFU 确认：把 needs_trust 终态待确认 key 入库
        站点寻址：--url/--user/--pass，或环境变量 OJM_URL / OJM_USER / OJM_PASS
  ojm keygen --id <publisher.id> [--out <dir>] [--yes]
        生成 Ed25519 签名密钥对（P2-1）：私钥默认 ~/.ojm/keys/<id>/ 永不出目录（--out 指到
        工程树内须 --yes 显式确认——私钥入仓即泄露）；打印公钥 hex 供 ojm trust add / 模板回填
  ojm sign <file.tgz> [--id <publisher.id>] [--key <pem>] [--check]
        detached 侧车签名（P2-4）：产出 <tgz>.sig（ojm install 自动探测随包上传）；
        私钥缺省取 ~/.ojm/keys/<id>/private.pem（--key 指定 pem 时须同时 --id）；
        --check 离线自检签名（不必靠宿主装失败发现签错）
        站点寻址：--url/--user/--pass，或环境变量 OJM_URL / OJM_USER / OJM_PASS
        （缺省 http://127.0.0.1:9778；凭据只走内存不落盘）
  ojm publish <dir> [--id <publisher.id>] [--key <pem>] [--check]
        索引发布（P3-5/6/7）：重算 <dir>/bundles.yaml + manifests.yaml（确定性
        stringify，消弭格式漂移）→ 对两份索引各产出 detached 侧车签名 <kind>.yaml.sig
        （与 archive .sig 同构，公钥取 ~/.ojm/keys/<id>/private.pem，缺省 --id 推导）→ 写回
        <dir>。CDN 侧 resolveCdn/index 拉取索引时校验签名（篡改/不符即拒，G4 fail-closed）。
        --check 离线自检两份索引签名
  ojm market setup [--url <站点地址>] [--user <u> --pass <p>] [--new-pass <p>]
        把系统设置 framework.market_cdn_url 指向本地模拟 CDN（工程根 cdn/，由
        api/config.yaml 的 /cdn 挂载直出）。首跑若账号处于首次改密期（seed admin
        must_change=1），会自动改密换全权 token 后再写入。
  ojm market publish [--fixture <name>@<version>] [--real <方案工程>] [--id <key>] [--key <pem>] [--rebuild-index] [--check]
        把方案包落进 cdn/：合成 fixture（或 --real 走 ojm build --bundle）→ 确定性 tgz
        → 包级 detached 签名 <name>-<version>.tgz.sig。**不碰索引**（D-1：索引由
        build-index 扫描重建，多人发布才不会互相覆盖）。
  ojm market build-index [--id <key>] [--key <pem>] [--check]
        扫描 cdn/*.tgz、提取包内 manifest，全量重建 bundles.yaml + manifests.yaml 并签名。
        结果只取决于目录内容：连续执行字节一致。
  ojm market verify [--file <tgz>] [--rebuild-index]
        离线验包（不起站点、不装、不要凭据）：sha256 完整性 / 包级 Ed25519 验签 /
        索引验签 / manifest 结构（含 C2-31 desc===summary、各版本 0001 迁移一致）分列输出。
        --rebuild-index 额外比对「扫描重建的索引」与盘上索引，检出落了包却没重建的漂移。
        注意：结论恒带边界声明——校验通过只说明来源与完整性，不构成内容安全性背书。
  ojm test|exec|openapi|migrate|schema [args...]
        透传给 oj 同名子命令（自动补 -c <project>/api/config.yaml；其余参数原样转发）
        例：ojm test --anonymous / ojm migrate --db report / ojm openapi --check
`;
}
