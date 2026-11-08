# 个人中心-我的资料 禁止修改用户名 + 头像与 header 一致

- 日期：2026-11-08
- 分支：fix/my-profile-username-readonly

## 需求 2（追加）

个人中心「我的资料」页的头像与布局 header 的头像不一致：header 无头像时渲染 `UserOutlined` 图标（`user-menu.tsx` Avatar `src="" → undefined`），而资料页硬编码兜底 `https://avatar.vercel.sh/blur.svg?text=2`，凭空造出一张与身份无关的图片。

## 方案

- `FormAvatarItem` 的 `<Avatar>` 加 `icon={<UserOutlined />}`（antd 无 src 时显示图标，与 header 同款默认）。
- 两处 my-profile 页删掉 vercel 兜底，`avatar` 值直接取 `currentUser?.avatar || undefined`。

## BDD 用例（追加）

```gherkin
Feature: 我的资料-头像与 header 一致
  Scenario: 无头像用户打开我的资料页
    Given 已登录（用户无头像）并进入 /personal-center/my-profile
    Then 表单内不出现 avatar.vercel.sh 兜底图
    And  资料页头像为图标态（与 header 默认头像一致）
```

## 需求

个人中心「我的资料」页的用户名字段禁止编辑（当前为可编辑文本框）。用户名是登录身份标识，不应允许用户自助修改。

## 影响面

| 位置 | 说明 |
| --- | --- |
| `web/personal-center/pages/my-profile/index.tsx` | dogfood 自带模块页面 |
| `packages/cli/templates/src/app/web/personal-center/pages/my-profile/index.tsx` | templates 宿主模板页面（真实入库，POST 携带 username 但值为本人原名，后端幂等） |
| `tests/e2e/templates/my-profile.spec.ts` | 追加 e2e 断言：用户名字段 disabled |

不改后端：模板 API 保留 username 字段（改名走管理端用户管理），本页 UI 禁用即可；表单提交值即原值，落库幂等无副作用。

## 任务

- [x] 写 BDD 用例（e2e 断言用户名输入框 disabled）
- [x] 两处页面 username 字段加 `disabled`
- [x] e2e 用例通过 / lint / typecheck

## BDD 用例

```gherkin
Feature: 我的资料-用户名只读
  Scenario: 用户打开我的资料页
    Given 已登录并进入 /personal-center/my-profile
    Then 用户名输入框存在且为禁用态
    And  用户名字段显示当前登录用户名
```

## 编码中发现的问题

- 反常识：antd `Form.Item rules.required` 对 `undefined` 值直接卡死提交。原 vercel 兜底图恰好在「喂饱」头像必填规则——删掉兜底图后，无头像用户（如 seed admin）整表无法提交，e2e 持久化用例当场红。修复：头像非保存通道（走 upload 单独通道），去掉 required 规则，并清理孤儿 i18n key `avatarRequired`。

## 总结

- 关键过程：两处 my-profile 页 username 加 `disabled`、删 vercel 兜底图；`FormAvatarItem` 无 src 时回退 `UserOutlined` 与 header 一致；e2e 追加 2 条断言（用户名 disabled、form 内无 vercel 图）；期间发现并修复头像 required 卡提交问题。
- 验证：`pnpm test:e2e my-profile` 3 passed；runtime 单测 1007 passed；eslint / tsc 通过。
- 耗时：约 15 分钟。
