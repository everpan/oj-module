# 模块发布独立性：消除模块对框架的耦合

> 日期: 2026-05-11
> 分支: refactor/module-decoupling

---

## 问题

发布一个模块时，需要同时修改并重新发布框架代码，导致模块无法独立发布。

耦合点分析：

### 耦合点 1: 菜单翻译在框架 common.json

模块 entry.ts 的路由标题引用 `common.menu.xxx`，翻译文本定义在 `src/locales/zh-CN/common.json` 和 `en-US/common.json`。

新增/修改模块菜单必须修改框架翻译文件。

### 耦合点 2: 排序常量在框架 order.ts

模块 entry.ts 从 `#src/router/extra-info/order.ts` 导入排序常量。

新增模块必须修改 `order.ts`。

### 耦合点 3: 路由路径常量在框架 route-path.ts（exception 模块）

exception 模块从 `#src/router/extra-info/route-path.ts` 导入路由路径常量。

## 方案

| 耦合点 | 解决方案 |
|--------|----------|
| 菜单翻译 | 移到模块 `locales/*.json`，使用 i18next namespace 语法 `"模块名:menu.xxx"` |
| 排序常量 | 直接在 entry.ts 中内联数值 |
| 路由路径 | 在模块 entry.ts 中内联路径字符串 |

翻译渲染已支持：`translateMenus()` 在渲染时对字符串 label 调用 `t()`，namespace 语法天然兼容。

## 影响范围

| 文件 | 变更 |
|------|------|
| `modules/*/entry.ts` | 标题改 namespace 语法，order 内联，路径内联（8 个文件） |
| `modules/*/locales/zh-CN.json` | 添加 `menu` 翻译 key（8 个文件） |
| `modules/*/locales/en-US.json` | 添加 `menu` 翻译 key（8 个文件） |
| `src/locales/zh-CN/common.json` | 移除模块专属菜单 key |
| `src/locales/en-US/common.json` | 移除模块专属菜单 key |
| `src/router/extra-info/order.ts` | 移除模块排序常量 |
| `src/layout/layout-header/components/user-menu.tsx` | personalCenter 改 namespace 引用 |
| `scripts/create-module.ts` | 更新模板 |
| `tests/module-i18n-consistency.test.ts` | 更新测试 |
| `docs/prd/module-development-guide.md` | 更新文档 |

## 任务

- [ ] T1: 编写/更新测试用例
- [ ] T2: 移动菜单翻译到模块 locales，更新 entry.ts 标题为 namespace 语法
- [ ] T3: 内联 order 值到 entry.ts，清理 order.ts
- [ ] T4: 内联 exception 路由路径
- [ ] T5: 清理框架 common.json 中的模块专属 key
- [ ] T6: 更新 user-menu.tsx 引用
- [ ] T7: 更新 create-module.ts 模板
- [ ] T8: 更新开发手册文档
- [ ] T9: 运行测试验证
