# 部署级隧道 recipe（跳板机后的库如何接入 oj）

> U-16 的**动工前置零成本项**（产品路评审裁决）：平台不做进程内 SSH 隧道（见
> `docs/plans/2026-10-28-u16-ssh-tunnel-conditional.md`，条件未触发）。跳板机后的库
> 请在**部署层**打通——以下两个配方可覆盖绝大多数场景。

## 前提

- oj 服务所在主机能直达跳板机（22 端口）；跳板机能直达目标库。
- 具备一台跳板机的 SSH 账号（密码或密钥）。

## 配方 A：`ssh -L` 本地转发（最常用）

```bash
# 在 oj 服务主机上，把目标库的端口映射到本机回环：
ssh -f -N -L 15432:db-internal.internal:5432 user@jump.example.com
#   -L <本机端口>:<目标库主机>:<目标库端口>   —— 目标库主机是**从跳板机视角**的地址
#   -f -N                                   —— 后台运行，不执行远程命令
```

然后 oj 的 `db:` / `db.client.register` 一律连**本机回环**：

```yaml
db:
  reporting: "postgres://user:ENC[...]@127.0.0.1:15432/app"
```

```js
await db.client.register("reporting", "mysql://user:pass@127.0.0.1:13306/sales");
```

**保活**：`ssh -f -N` 断线即失效。用 systemd 托管（`Restart=always`）或 `autossh`：

```bash
autossh -M 0 -f -N -L 15432:db-internal.internal:5432 user@jump.example.com
```

## 配方 B：socat + 跳板机（无 autossh 的容器环境）

```bash
socat TCP-LISTEN:15432,reuseaddr,fork \
  EXEC:'ssh user@jump.example.com "nc db-internal.internal 5432"'
```

容器/K8s 场景把这条命令做成 sidecar 容器的主进程，`127.0.0.1:15432` 即为库地址。

## 安全要点

- 隧道监听一律绑 `127.0.0.1`（`ssh -L` 默认就是；socat 显式写了）——**绝不要** `0.0.0.0`，
  否则整台跳板机的可达范围暴露给本网段。
- 密钥放部署机（`~/.ssh/`，600 权限）；DSN 里的凭据照常走 `oj secret seal` 的 `ENC[...]`。
- 跳板机账号按最小权限：只允许端口转发（`PermitOpen` 限定目标 host:port）。

## 与平台的边界

- 平台侧不管理隧道进程（启动/保活/监控全在部署层）；隧道断开时 oj 的表现 = 普通连接失败
  （错误分类 `connection`，重试策略见 `db-guide` §错误分流）。
- 「oj 服务端进程内建 SSH 隧道」是 U-16 条件项：只有当部署级方案被证明不可用（≥2 部署方
  实测）才重新立项。
