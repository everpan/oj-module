# 标签页关闭前守卫 `beforeClose` BDD 用例

> 需求来源：Item 3——暴露标签页生命周期钩子；`beforeClose` 支持**数组注册**；
> 回调顺序执行，任一返回 false / Promise 被拒绝（抛错）则取消关闭。
> 覆盖五个关闭动作：removeTab / closeRightTabs / closeLeftTabs / closeOtherTabs / closeAllTabs。
> 设计依据：`docs/superpowers/specs/2026-10-14-ojm-0.1.18-design.md` Item 3（含三方评审意见）。

## 背景与术语

- **守卫（guard）**：`TabItemProps.beforeClose?: BeforeTabCloseGuard | BeforeTabCloseGuard[] | null`，
  `BeforeTabCloseGuard = () => boolean | Promise<boolean>`。经 `addTab(key, tab)` 的 merge 语义注册。
- **关闭动作**：tabs store 的五个页签关闭 API（见上）。全部返回 `Promise<void>`。
- **受影响集合**：一次关闭动作拟关闭的 key 列表（如 closeRightTabs = 锚点右侧全部）。
- **home 页**：`VITE_BASE_HOME_PATH` 对应的页签，**永远不可关闭**（现有语义保持）。

## 用例

### 1. 回归基线：无守卫行为不变

- **Given** 已打开 /home、/a、/b，activeKey=/a，所有页签未声明 beforeClose
- **When** 依次执行 removeTab("/a")、closeRightTabs、closeLeftTabs、closeOtherTabs、closeAllTabs
- **Then** 各动作的开合结果、activeKey 落点与同步版实现完全一致

### 2. 单守卫返回 true → 正常关闭

- **Given** /a 声明 `beforeClose: () => true`
- **When** removeTab("/a")
- **Then** /a 被移除，activeKey 按原语义修正

### 3. 单守卫返回 false → 取消

- **Given** /a 声明 `beforeClose: () => false`
- **When** removeTab("/a")
- **Then** /a 仍在 openTabs，activeKey 不变，其余页签不受影响

### 4. 异步守卫 Promise\<false\> → 取消

- **Given** /a 声明 `beforeClose: async () => false`
- **When** removeTab("/a") 并 await
- **Then** 同用例 3

### 5. 数组守卫：顺序执行、短路

- **Given** /a 注册守卫数组 [g1, g2, g3]，g2 返回 false
- **When** removeTab("/a")
- **Then** 执行序列为 g1 → g2（g3 不执行），关闭取消

### 6. 守卫抛错 → 取消 + console.error

- **Given** /a 的守卫抛异常
- **When** removeTab("/a")
- **Then** 关闭取消（fail-safe：宁可不关门也不误关丢内容），console.error 输出一次带守卫上下文的信息

### 7. 批量事务：任一否决整批取消

| 场景 | 受影响集合 | 守卫布置 | 期望 |
|---|---|---|---|
| closeRightTabs | /a、/b | /b 否决 | /a、/b 都保留 |
| closeAllTabs | /a、/b | /a 否决 | 全部保留（home 本就不在集合） |
| closeOtherTabs | 除锚点与 home | 任一否决 | 无页签被关 |

- **Given** 如表
- **When** 执行对应批量动作
- **Then** 整批取消，openTabs 与调用前一致

### 8. addTab 注册语义

| 场景 | 操作序列 | 期望 |
|---|---|---|
| 数组 concat | 先注册 g，再注册 h | beforeClose = [g, h] |
| 同引用去重 | 两次注册同一函数 g | beforeClose 长度 1（keep-alive 重挂载不叠加） |
| null 清除 | 注册 g 后 addTab(key, { beforeClose: null }) | 守卫清空（含他人注册的），关闭成功 |
| undefined 不动 | 注册 g 后 addTab(key, {}) | 守卫仍为 g |

### 9. home 豁免

- **Given** home 页被（错误地）注册了否决守卫
- **When** closeAllTabs()
- **Then** home 仍在；且 removeTab(home) 直接返回、不触发守卫

### 10. await 期间页签仍在（组件挂载语义）

- **Given** /a 的守卫是异步的，内部检查 `openTabs.has("/a")`
- **When** removeTab("/a")
- **Then** 守卫执行期间 /a 仍在 openTabs（确认弹窗的组件树保持挂载）

### 11. TOCTOU：await 期间新开页签不被误关

- **Given** closeRightTabs(/home) 的守卫 await 期间，另一逻辑新开 /c（位于 home 右侧）
- **When** 守卫全部通过
- **Then** 精确删除获批时刻的集合，/c 保留

### 12. 并发去重：同 key 关闭进行中再触发被忽略

- **Given** /a 的守卫挂起 20ms
- **When** 并发两次 removeTab("/a")
- **Then** 守卫只执行一次，结果与单次调用一致

### 13. resetTabs 绕过守卫

- **Given** /a 注册否决守卫
- **When** resetTabs()
- **Then** 直接清空（登出/401 下线不得被业务守卫阻塞）

### 14. 边界序列

- **Given** openTabs 仅剩 /home
- **When** closeAllTabs() / closeRightTabs(/home)
- **Then** 空集合直接返回，不触发守卫、不报错

## 兼容性声明

- 五个动作返回 `Promise<void>`：现有调用方（useDropdownMenu 的 actions 映射、handleEditTabs）
  均 fire-and-forget 调用，TS 层面非破坏性；状态变更由同步变异步。
- `beforeClose` 未声明时守卫路径零开销直走（`fn == null` continue）。
- `TabsAction` 接口签名变更属 minor breaking，已在 CHANGELOG 0.1.18 记 BREAKING。
