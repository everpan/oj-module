# 消除模块版本重复定义

> 日期: 2026-05-11
> 分支: refactor/single-version-source

---

## 问题

模块元信息（name、description、version）分散在多处，升级时必须同步修改：
1. `modules/<name>/package.json` → `version`、`name`
2. `modules/<name>/entry.ts` → `version`、`name`、`description`
3. `manifest.json` → `version`、`name`

`package.json` 还会导致 IDE 将模块目录识别为独立项目，干扰开发体验。

## 方案

**以 `entry.ts` 为唯一来源**，删除 `modules/*/package.json`：

- `entry.ts` 中 `ModuleDefinition` 的 `name`、`description`、`version` 均为字符串字面量
- `manifest.json` 不含 `version`（已在前一提交完成）
- 构建脚本从 `entry.ts` 解析 `name` 和 `version`（正则匹配）
- 不再需要 `package.json` / `meta.json` 中间文件

## 影响范围

| 文件 | 变更 |
|------|------|
| `modules/*/entry.ts` | 移除 `import pkg`，恢复字符串字面量（8 个文件） |
| `modules/*/package.json` | 删除（8 个文件） |
| `scripts/build-modules.ts` | 从 `entry.ts` 解析 name/version |
| `scripts/create-module.ts` | 不再创建 `package.json`，模板使用字符串字面量 |
| `tests/module-i18n-consistency.test.ts` | 更新测试 |
| `docs/prd/module-development-guide.md` | 更新相关章节 |

## 任务

- [x] P1: 编写/更新测试用例
- [x] P2: 恢复所有 `entry.ts` 为字符串字面量（移除 JSON import）
- [x] P3: 删除所有 `modules/*/package.json`
- [x] P4: 重构 `build-modules.ts` — 从 entry.ts 解析 name/version
- [x] P5: 重构 `create-module.ts` — 移除 package.json 创建
- [x] P6: 更新开发手册文档
- [x] P7: 运行测试验证

## 总结

**关键变更**：`entry.ts` 成为模块元信息的唯一来源。`name`、`description`、`version` 作为字符串字面量直接定义在 `ModuleDefinition` 中。构建脚本通过正则从 `entry.ts` 提取 name/version。`package.json` 被完全移除，IDE 不再将模块目录误识别为独立项目。
