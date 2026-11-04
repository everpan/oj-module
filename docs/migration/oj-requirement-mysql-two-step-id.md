# 上游 PR 草案：MySQL `returning(["id"])` 两步取 id 未钉同一连接

> 状态：**待提交上游（草案，2026-11-05 定位）**
> 上游基线：`oj-bin@f63303d`（v0.1.119 开发线）；缺陷在 **v0.1.118 及更早**复现。
> 复现环境：MySQL 8.4.11 / PostgreSQL 16.15（Apple container），oj 0.1.118，ojm 模板 0.2.67。
> 本仓关联：`docs/prd/framework-verification-playbook.md` §9 对应行、§11 **U2**（ojm 侧不改模板绕行）。

## 1. 结论

MySQL 上 `.returning(["id"])` 的返回值**不可信**：构造器把「INSERT」与「SELECT LAST_INSERT_ID()」
拆成两条语句，它们**各自向连接池取连接**。`LAST_INSERT_ID()` 是 MySQL 的 **session 级**状态，
换连接后读到的是那条连接上一次插入的值（通常是 0 或别的请求的值）。落库数据正确，只有返回的 id 错。

pg / sqlite 走单语句 `INSERT ... RETURNING`，不受影响。

## 2. 影响面

| 访问器 | 受影响 | 依据 |
| --- | --- | --- |
| 核心 `SqlxAccessor`（`db.default` 为 `mysql://`） | 是 | `exec_with_params` 用 `q.execute(&self.pool)`，`query_with_params_metered` 用 `q.fetch(&self.pool)`——两次独立 acquire |
| 插件 `oj-db-mysql`（FFI） | 是 | `Client::exec` 用 `q.execute(p)`、`Client::query` 用 `q.fetch_all(p)`——同样两次独立取连接 |
| `db.tx` / `db.session` 内的 insert | 否 | 走 `Exec::Tx`，同一会话 |
| PostgreSQL / SQLite | 否 | `ExecRoute::Rows`，单语句 `RETURNING` |

受影响的业务面：所有「insert 后拿 id 继续用」的端点——建号、组织/成员、通知推送、广播、
以及任何 `db.table(...).insert(...).returning(["id"]).run()` 的调用方。

## 3. 复现（真库，2026-11-05）

环境：MySQL 8.4.11，`db.default = mysql://root:root@192.168.64.2:3306/ojtest`，模板工程 `ojm dev`。

1. 超管登录后建号：

   ```bash
   curl -s -X POST http://127.0.0.1:9778/api/system/users \
     -H 'content-type: application/json' -H 'X-TENANT-ID: default' \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"username":"publisher01","displayName":"普通发布者","password":"..."}'
   # 响应 data.id = 59
   ```

   库内真值：

   ```sql
   SELECT id, username FROM users WHERE username = 'publisher01';  -- id = 5
   ```

2. 广播通知：

   ```bash
   curl -s -X POST http://127.0.0.1:9778/api/notification/push-broadcast \
     -H 'content-type: application/json' -H 'X-TENANT-ID: default' \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"title":"...","message":"..."}'
   # 响应 {"code":0,"id":"b:58"}
   ```

   库内真值：

   ```sql
   SELECT id FROM notifications_broadcast ORDER BY id DESC LIMIT 1;  -- 1
   ```

3. 同一天同一份模板换 PostgreSQL 16.15：建号返回 `id=5`，与真值一致。

4. SQL trace 可直接看到两条独立语句（timing 分别记录，非同一往返）：

   ```sql
   INSERT INTO users (...) VALUES (...)
   SELECT LAST_INSERT_ID() AS id
   ```

两次复现都**没有并发**：池里存在多条空闲连接，第二步 acquire 命中另一条即可出错。

## 4. 根因（代码坐标）

`src/bridge/query.rs:2373` 的 `ExecRoute::LastId` 分支：

```rust
Ok(_) => {
    // mysql 无 RETURNING：再发一次 LAST_INSERT_ID 取回自增主键。
    let r = super::db_quota::race_statement(
        ex.query("SELECT LAST_INSERT_ID() AS id", &[], &mut meter), // ← 第二次向池取连接
        ...
    ).await?;
```

`Exec` 的两条臂（`query.rs:2185`）：

```rust
enum Exec<'a> {
    Pool(&'a Arc<dyn DataAccessor>),
    Tx(tokio::sync::MutexGuard<'a, Box<dyn super::db::TxSession>>),
}
```

`Pool` 臂的 `exec` / `query` 各自调用一次 accessor：

- `src/bridge/accessor_sqlx.rs:502` `exec_with_params` → `q.execute(&self.pool)`
- `src/bridge/accessor_sqlx.rs:357` `query_with_params_metered` → `q.fetch(&self.pool)`

sqlx 的 `&Pool` 每次执行独立 acquire/release，**两条语句不保证同一连接**。
`query.rs:2184` 的注释也承认这一点（「两条语句非原子，池路径下建议放进 db.tx 以免并发串号」），
但默认路径并没有按注释执行——把正确性推给了调用方。

## 5. 为什么这是 bug，不是「已知限制」

上游内部已有三处按正确口径实现/声明，只有构造器路径漏了：

| 位置 | 事实 |
| --- | --- |
| `src/bridge/db_seq.rs:121-133` | `nextSeq` 的 mysql 分支**显式包短事务**：`da.begin()` → `s.exec` → `s.query("select last_insert_id()")` → `commit`，注释写「MySQL 两条语句包一次短事务（同连接）」 |
| `plugins/oj-db-mysql/src/lib_tests.rs:1023-1029` | 测试注释：`select last_insert_id()`「**必须同一连接**，宿主在短事务里跑」 |
| `docs/devkit/db-guide.md:817-820` | 文档承诺 `.returning(["id"])` 在 mysql「**在同一连接上**两步取 `LAST_INSERT_ID()`」 |

也就是说：同一个不变量，`nextSeq` 守住了、文档承诺了、构造器没做到。

## 6. 修复方案

### 方案 A（推荐）：池路径包一次短事务

在 `ExecRoute::LastId` 的 `Pool` 臂复用 `db_seq.rs` 已验证的形态：

```rust
// src/bridge/query.rs，LastId 分支的 pool 臂
Exec::Pool(da) => {
    let mut s = da.begin().await.map_err(err)?;
    if let Err(e) = s.exec(&sql, &params).await {
        let _ = s.rollback().await;
        return Err(err(e));
    }
    match s.query("SELECT LAST_INSERT_ID() AS id", &[]).await {
        Ok(rows) => {
            s.commit().await.map_err(err)?;
            Ok(rows)
        }
        Err(e) => {
            let _ = s.rollback().await;
            Err(e)
        }
    }
}
```

要点：

- 只改 `Pool` 臂；`Exec::Tx` 臂保持原样（本就在同一会话）。
- 两条访问器（核心 sqlx / FFI 插件）都走 `da.begin()`，**一处修两边**；插件已有 `begin` vtable。
- 顺带把语义从「insert 成功但取 id 失败」改成原子：取 id 失败会回滚，不再留下「写成功但调用方拿到错误」的中间态。
- 语句超时/取消口径：仍用 `race_statement` 包 `s.exec` / `s.query`；超时后 drop 事务即回滚（sqlx tx drop 语义），
  与现有 `db.tx` 臂「tx 内不叠语句超时」的差异需在 PR 里明确选择（建议保留 race，保持 pool 路径的现有可观测性）。
- 观测：这两条语句的 SQL trace `in_tx` 由 `false` 变 `true`，属预期变化。

### 方案 B（可选，去掉额外往返）

方案 A 每次 mysql insert+returning 多 **2 个网络往返**（BEGIN / COMMIT），与 `db.nextSeq` 在 mysql 上的成本同口径。
若在意这 2 个 RTT，可在 `DataAccessor` 增一个默认为方案 A 的方法，让核心访问器覆写为「显式持有同一
`PoolConnection` 连发两条语句、不显式开事务」：

```rust
// db.rs（默认实现 = 方案 A 的短事务）
async fn exec_with_last_id(&self, sql: &str, params: &[Value]) -> BridgeResult<Vec<Row>> { ... }

// accessor_sqlx.rs（覆写：同一 PoolConnection，无 BEGIN/COMMIT）
async fn exec_with_last_id(&self, sql: &str, params: &[Value]) -> BridgeResult<Vec<Row>> {
    let mut conn = self.pool.acquire().await.map_err(...)?;
    // INSERT 用 &mut *conn
    // SELECT LAST_INSERT_ID() 仍用 &mut *conn
}
```

`LAST_INSERT_ID()` 是 session 级，同一连接的两条语句已足够，不需要事务包裹；事务只是「拿到同一连接」的手段。
建议 PR 先落方案 A（正确性、最小改动、覆盖插件），方案 B 作为同 PR 第二个 commit 或后续优化。

### 同步更新的注释与文档

- `src/bridge/query.rs:2183-2184`：「两条语句非原子，池路径下建议放进 db.tx」→ 改为「池路径由宿主包短事务」。
- `src/bridge/bootstrap.js:1473-1474`：`LAST_INSERT_ID() in a second step on the same connection (use db.tx for safety)`
  → 去掉「use db.tx for safety」（修复后不再需要）。
- `docs/devkit/db-guide.md:819-820`：保留「同一连接」承诺（修复后才成立），可补一句「池路径由宿主开短事务」。

### 明确不做

- **不按 `caps.id` 路由**：`id_two_step` 只是登记位，回取语句是方言私有（`sqlite` 也声明 two_step 却走 `RETURNING`），
  文档已钉死这条边界（`exec_route` 注释 + `lastid_route_is_mysql_only_not_equivalent_to_id_two_step`）。
- **不自动重试**：错误 id 已返回给调用方，重试无法纠正；必须从连接获取方式上修。
- **不改 wire / 契约**：`.returning(["id"])` 的 JS 侧签名与返回形状不变。

## 7. 测试计划

1. **单元（不需要真库）**：在 `src/bridge/query_tests.rs` 增一个「每次调用都换连接」的 fake accessor，
   记录 `exec` / `query` 命中的连接号；断言 `LastId` 路径两条语句落在**同一**连接（当前实现必红）。
   现有 `returning_verb_matrix_and_dialect_rendering` 只验 SQL 渲染，没有连接维度，是本缺陷漏网的直接原因。
2. **真库（env-gated `OJ_TEST_MYSQL`）**：
   - 建表 `t (id bigint auto_increment primary key, v varchar(64) unique)`；
   - 串行两次 `.returning(["id"])`，断言返回 id 与 `SELECT id FROM t WHERE v = ?` 一致；
   - **并发 50 次**（池 ≥ 8 连接），每次写入唯一 `v`，断言每个返回 id 都能反查到自己的 `v`；
   - 重复 200 次，要求 200/200 命中（当前实现会随机失败）。
3. **回归**：`db.nextSeq` 的 mysql 并发取号用例、`exec_route` 路由用例、pg/sqlite returning 用例保持绿。
4. **手工验收**：ojm 模板在 MySQL 上建号/广播，返回值与库内真值一致。

## 8. 兼容性与风险

| 项 | 说明 |
| --- | --- |
| 行为变化 | 返回 id 从「随机但 200」变为正确；依赖错误 id 的调用方本来就是 bug，修后暴露属预期 |
| 延迟 | 方案 A：mysql insert+returning 每次 +2 RTT；方案 B：0 额外 RTT |
| 事务语义 | insert 与取 id 变为原子：取 id 失败/超时回滚，不再留半成品写入 |
| 连接占用 | 短事务期间占住一条连接（原本两条语句各占一次，峰值占用不变，持续略长） |
| 嵌套事务 | 已有 `db.tx` / `db.session` 时仍走 `Exec::Tx`，不重复 `begin` |

## 9. ojm 侧后续

- 上游修复并发布后：删除 playbook §11 **U2**，§9 对应行改为「已由 oj x.y.z 修复」，附录 A 记一条基线。
- 修复前：模板**不做绕行**（不改成「insert 后按唯一键回查」——多一次查询且依赖唯一键，且只覆盖两处，
  其余 `returning` 调用点仍错）。文档口径保持「MySQL 上不要信任 insert 返回的 id」。
