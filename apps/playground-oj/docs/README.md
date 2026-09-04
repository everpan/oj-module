# playground-oj 阶段教学文档索引

 playground-oj 从骨架到 release 的完整实施记录，按阶段拆分，便于教学复现。

| 文档 | 阶段 | 一句话 |
|---|---|---|
| [phase0-scaffold.md](./phase0-scaffold.md) | P0 骨架 | `ram init` 骨架 + oj 登录冒烟 + `ram dev` 反代联调 |
| [phase1-injection-and-contracts.md](./phase1-injection-and-contracts.md) | P1 注入与契约 | 运行时 D9 注册表 + `ram api` 契约生成/豁免 + 11 模块自包含 |
| [phase2-auth-and-data.md](./phase2-auth-and-data.md) | P2 认证与数据层 | login 纯页面回落 + web 真实化 + system 三表 + 双账号权限差异 |
| [phase3-system-and-demo.md](./phase3-system-and-demo.md) | P3 system CRUD | 六项 system 端点 D9 接管 + demo 真实数据层 |
| [phase4-home-noti-upload.md](./phase4-home-noti-upload.md) | P4 业务真实化 | home 图表 / notification / 头像上传 真实化 |
| [phase5-release-and-integration.md](./phase5-release-and-integration.md) | P5 release 回归 | `ram build` + 两态（dev/preview）集成冒烟 |
| [phase6-conclusion.md](./phase6-conclusion.md) | P6 收尾 | 计划勾选 + 各阶段小结 + §10 问题分类（反常规/反常识/与业界不符） |

配套计划：`docs/prd/202609041045-playground-oj-plan.md`
集成冒烟：`scripts/smoke.sh`（build → preview → dev 两态，均 10/10）
