// .route 声明的 TS 支持（编辑器不报错；dev server 不依赖此文件运行）。
//
// 下面为 src/bridge/bootstrap.js 在运行时注入的全局对象提供类型声明，
// 使 sample/src 中的业务代码在编辑器内不报 TS 错误。
//
// ext_boot.js（config.yaml 同目录，可选）在运行时补充的全局**不在本文件声明** ——
// 它们是项目自定义的，框架无法预知。用 ext_boot.js 增补了全局（如 `json.page()`）后，
// 在业务项目里另建一个 .d.ts 自行声明（并加进 tsconfig 的 include），否则编辑器报
// TS2339 "Property 'page' does not exist"。运行时不受影响——类型只影响编辑器与 tsc。

// JSON 反序列化后可能出现的值（SQL 行 / KV / fetch body 等）。
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// 数据库查询返回的一行（列名 -> 值）。
type Row = Record<string, Json>;

// db.table(...).where(cond) 的单个条件。叶子用 field/op/value；组合用 and/or/not
// （也可经 db.leaf/db.and/db.or/db.not 构造）——故 field 可缺省（纯组合节点）。
interface WhereCond {
  field?: string;
  op?: string; // eq/neq/gt/gte/lt/lte/like/in/nin/null/notnull/... 依服务端支持
  value?: unknown;
  and?: WhereCond[];
  or?: WhereCond[];
  not?: WhereCond;
}

// db.table(...).orderBy(items) 的单个排序项。
interface OrderByItem {
  field: string;
  dir?: "asc" | "desc" | null;
}

// db.table(name) 返回的安全查询构造器（流式、结构化）。
interface QueryBuilder {
  select(cols?: (string | object)[]): QueryBuilder;
  where(cond: WhereCond): QueryBuilder;
  orderBy(items?: OrderByItem[]): QueryBuilder;
  // LIMIT/OFFSET（v0.1.20 起可配，见 config `db_query` 段——不能写进 `db:` 段）：
  // 未给 limit 的**顶层** select 隐式补 `db_query.default_limit`（默认 100）；显式 limit
  // 被 clamp 到 `db_query.max_limit`（默认 1000，硬顶 100000）。嵌套/子查询不隐式截断。
  // 结果行数 ≥ 生效上限时，响应带 `X-OJ-Row-Limit: <上限>` 头（仅 json.* 路径）——
  // 判「可能被截断」看该头，别猜。
  limit(n: number): QueryBuilder;
  offset(n: number): QueryBuilder;
  // 行数组（每行是列名 → 值；与 db.query 的返回同形）。
  all(): Promise<Row[]>;
  // DML：动词由 insert/update/delete 声明，run() 终执行（返回受影响行数）。
  // insert + returning(["id"]) 时 run() 改返回行数组 [{ id: n }]——
  // pg/sqlite 是单条 RETURNING 语句；mysql 同连接两步取 LAST_INSERT_ID()（建议放 db.tx）。
  insert(rows: object | object[]): QueryBuilder;
  update(sets: object): QueryBuilder;
  delete(): QueryBuilder;
  returning(cols?: string[]): QueryBuilder;
  // JOIN：on = 左右列对；kind 缺省 "inner"（left/right/... 依服务端支持）。
  join(
    table: string,
    on: { left: string; right: string }[],
    kind?: string,
  ): QueryBuilder;
  // DISTINCT / GROUP BY / HAVING / UNION / CTE（WITH）。
  distinct(): QueryBuilder;
  groupBy(cols?: string[]): QueryBuilder;
  having(cond: WhereCond): QueryBuilder;
  union(other: QueryBuilder, kind?: string): QueryBuilder;
  with(name: string, columns: string[], query: QueryBuilder): QueryBuilder;
  run(): Promise<number | Row[]>;
  // 只构造不执行（与 .all()/.run() 完全相同的校验管线）。
  toSQL(): { sql: string; params: unknown[] };
  // 序列化当前构造成员（可经 db.fromJSON 复原继续链式调用）。
  toJSON(): object;
}

// DB(name) 返回的命名数据库实例。
interface DBInstance {
  // 原始 SQL + 绑定参数（params 可选）。返回行数组。
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  // 执行写操作，返回受影响行数。
  exec(sql: string, params?: unknown[]): Promise<number>;
  // 安全查询构造器（标识符白名单 + 参数化值）。
  table(name: string): QueryBuilder;
  // 条件构造器：leaf(field, op, value) / and / or / not，供 where/having 组合。
  leaf(field: string, op: string, value?: unknown): WhereCond;
  and(...conds: WhereCond[]): WhereCond;
  or(...conds: WhereCond[]): WhereCond;
  not(cond: WhereCond): WhereCond;
  // 从 toJSON() 快照复原构造器（继续链式调用）。
  fromJSON(snap: object): QueryBuilder;
  // 系统逃生通道（tenant sql_guard）：本请求绕过租户注入/校验。显式且被审计，
  // 业务 handler 不得使用。
  asSystem(): DBInstance;
  // 匿名请求声明租户（v0.1.20）。公开页 handler 用**服务端派生**的租户 id 声明本次请求
  // 的身份（典型派生链：分享 token → 查共享表 → 租户 id）。**与 asSystem 不同——租户条件
  // 仍然强制注入**，只是身份由 handler 给。
  // 三道门禁全过才生效，缺一即抛错（不是静默忽略）：
  //   ① config `tenant.allow_as_tenant: true`（默认关）；
  //   ② 请求是匿名请求（命中 `tenant.anonymous_paths` 且未带租户头；`oj test --anonymous`）；
  //   ③ id 非空。
  // 另：请求级且**只能调用一次**（已带租户头的请求、或同一请求内二次调用 → 抛错，防运行期
  // 切换身份）；生效后 `http.tenantId` 即该值，并记一条审计日志。
  // 红线：id 必须服务端派生，**绝不可**直接取请求参数（否则等于把租户交给调用方）。
  /** 平台序列分配（v0.1.24）：单语句原子取号，`max+1` 竞态的终态。
   * 首次使用自动建平台表 `_oj_sequences`；返回值 ≤2^53-1 是 number，超出是十进制字符串。 */
  nextSeq(name: string): Promise<number | string>;
  asTenant(id: string): DBInstance;
  // 事务：回调 resolve 提交 / throw 回滚再抛；tx.query/exec/table 同签名走同一连接。
  // 每请求至多一个活跃事务（嵌套报错）；请求结束未完结自动回滚。
  // 回调参数**不含 tx 自身**（嵌套事务直接被拒，故类型上也拿不到——见 TxInstance）。
  tx(fn: (tx: TxInstance) => unknown): Promise<unknown>;
}

// 事务内的库实例：与 DBInstance 同面，但没有 tx（嵌套事务不支持）。
type TxInstance = Omit<DBInstance, "tx">;

// json.* ：统一响应信封 + 响应头。
interface JsonApi {
  ok(data?: unknown): void;
  fail(code: number, msg: string, data?: unknown): void;
  header(name: string, value: string): void;
  // 裸 JSON 200（不套信封）：标准协议端点（如 OIDC）用；错误仍走 fail()。
  raw(data?: unknown): void;
  // 3xx 重定向原语（v0.1.26）：Location + RFC 9110 §15.4 短超文本注记（HEAD 为空 body）。
  // code 非 3xx 一律回落 302；具名封装对应五个标准 3xx，语义见名。
  redirect: {
    (url: string, code?: number): void;
    movedPermanently(url: string): void; // 301 永久迁移
    found(url: string): void; // 302 临时（默认）
    seeOther(url: string): void; // 303 跟随后改 GET
    temporaryRedirect(url: string): void; // 307 方法/体保持
    permanentRedirect(url: string): void; // 308 永久 + 方法保持
  };
  // 流式响应（v0.1.35）：开流后逐块 write，绕过 {code,msg,data} 信封。
  // opts：{ status?, contentType? }；返回 writer 必须显式 end()（或 handler 返回即自动关流）。
  stream(opts?: { status?: number; contentType?: string }): StreamWriter;
  // SSE 便捷封装：自动 text/event-stream + 数据帧 `data: <c>\n\n`；
  // opts：{ status?, heartbeatSecs? }（心跳默认 15s，保活穿透代理）。
  sse(opts?: { status?: number; heartbeatSecs?: number }): StreamWriter;
}

// 流式写入器（json.stream/json.sse 返回）。
interface StreamWriter {
  write(chunk: string): void;
  end(): void;
}

// http.* ：当前请求上下文（只读，懒加载，per-request 最新）。
interface HttpApi {
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
  // WS Binary 帧时 body 为 null；原始帧字节走 bodyBytes()（v0.1.16，文本帧亦可用）。
  bodyBytes(): Promise<Uint8Array>;
  // 取路由参数或 query 参数：路径参数优先，query 兜底，均缺失返回 def 原值。
  param(name: string, def?: unknown): any;
  // 租户 id（tenant 启用时从租户头提取；未启用为 null）。`db.asTenant(id)` 声明成功后
  // 即为该 id（v0.1.20）。
  tenantId: string | null;
  // 已验签用户（auth 启用且通过 Bearer 守卫；否则 null）。
  user: AuthUser | null;
  // multipart 上传文件元信息（非 multipart 为空数组）。
  files: UploadedFileMeta[];
  // 取第 i 个上传文件的字节（越界报错 no such file）。
  // 仅小文件（≤ max_upload）有字节；流式大文件报错并指路 files[i].key/.url（v0.1.38）。
  file(i: number): Promise<Uint8Array>;
}

// 已验签用户（JWT claims）。
interface AuthUser {
  id: string | number;
  roles: string[];
  claims: Record<string, Json>;
}

// multipart 上传文件元信息。
// 大文件（> max_upload）由服务端流式落 blob（v0.1.38）：bytes 拿不到（http.file 报错），
// 用 key/url 取——blob.get(key) 读全文、url 直接下载/外链。
interface UploadedFileMeta {
  field: string;
  filename: string;
  content_type: string;
  size: number;
  // 流式大文件的 blob 对象 key（小文件为 null）。
  key: string | null;
  // 流式大文件的下载地址（小文件为 null）。
  url: string | null;
}

// log.* ：结构化日志（zap SugaredLogger 风格：msg + 交替键值对）。
interface Logger {
  debug(msg: string, ...kv: unknown[]): void;
  info(msg: string, ...kv: unknown[]): void;
  warn(msg: string, ...kv: unknown[]): void;
  error(msg: string, ...kv: unknown[]): void;
}

// redis.* / kv.* ：KV 存储（redis.default 配置即真 Redis，否则进程内存 KV）。
interface KVApi {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  del(key: string): Promise<boolean>;
  // 设过期（秒）。真 Redis 走 EXPIRE；内存 KV 惰性过期。
  expire(key: string, ttlSec: number): Promise<boolean>;
  // 自增返回新值（键不存在从 0 起）。
  incr(key: string): Promise<number>;
}

// ws.* ：WebSocket 生命周期钩子内的主动发送/关闭控制（HTTP 路径 no-op）。
// send 帧型由参数类型决定：string → Text 帧(0x1)；Uint8Array → Binary 帧(0x2)（v0.1.16）。
interface WSApi {
  send(data: string | Uint8Array): void;
  close(): void;
  // 房间原语（v0.1.30，进程内单例 hub；跨实例扇出仍走 bus.publish）：
  // join/leave 仅在 ws.ts 生命周期钩子内可用（连接身份自动取，断连自动摘除）；
  // broadcast 为 socket.io 除己语义（发送者要回声自己在 JS 里发），HTTP handler 可调
  // （无连接身份 = 不排除任何人）；roomSize 任意上下文可调。
  join(room: string): void;
  leave(room: string): void;
  broadcast(room: string, data: string): number;
  roomSize(room: string): number;
}

// sess.* ：WS 帧池的会话上下文（v0.1.10 帧池模型；**只在 ws.ts 的生命周期钩子内存在**——
// HTTP / 任务桥路径没有这个全局）。
// 执行模型：路由级 W 个无状态 Worker 共享执行，连接态必须外置到 sess.state（Rust 会话表
// 持久、按连接隔离）；模块作用域只是 Worker 本地只读缓存，**不要**用来放连接状态。
interface WsSess {
  // 连接标识（进程内自增；同一连接的各帧相同）。
  readonly id: number;
  // 跨帧持久的会话状态。**必须可 JSON 序列化**：不可序列化时该帧的状态回传被丢弃
  // （Rust 侧保留旧快照），连接不中断——所以别往里塞函数 / class 实例 / Uint8Array。
  state: Record<string, Json>;
}

// blob.* ：对象存储（可调用取命名实例：blob("media").put(...)；裸调用 blob.put(...) 等价 default）。
interface BlobApi {
  (name?: string): BlobApi;
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<boolean>;
  get(key: string): Promise<Uint8Array>;
  // 幂等：不存在视为成功。
  del(key: string): Promise<boolean>;
  // local = {base}/blob/{key}；s3 = presigned URL（15min）。
  url(key: string): Promise<string>;
  // 上传直传预签名（v0.1.30）：s3 返回 15min 预签名 PUT URL（客户端直传不经 handler，
  // 绕开 max_upload_bytes/30s）；opts 缺省 {"kind":"put"}。local 后端无预签名——抛错，
  // 改用直传路由 PUT {base}/blob/{key}（上限 server.blob_upload_max_bytes，默认 1 GiB）。
  uploadUrl(key: string, opts?: { kind: string }): Promise<{ url: string }>;
  // local 缺失 sidecar 且无法按扩展名推断时返回空串；s3 无 Content-Type 时返回 null。
  contentType(key: string): Promise<string | null>;
  // 服务端复制（v0.1.47，ABI 11）：src 保留。字节不进 JS——大文件搬运别用 get + put。
  copy(src: string, dst: string): Promise<boolean>;
  // 服务端搬移（v0.1.47，ABI 11）：src 不再存在（local 同目录 rename / s3 CopyObject+Delete）。
  move(src: string, dst: string): Promise<boolean>;
  // 区间读（v0.1.47，ABI 11）：短读截断——越尾只给实际剩余字节，offset 过尾给空数组；
  // offset / len 为负、小数、NaN 即报错。
  readRange(key: string, offset: number, len: number): Promise<Uint8Array>;
}

// fs.* ：本地文件系统（v0.1.53；config `fs:` 段启用）。一次性 API（无 fd 句柄，
// op 内自开自关）；相对路径解析到 jail 根 fs.root 之下（不是进程 cwd）。
// 未配置 fs: / 越出 root（含 root 内 symlink 指向外部）/ readonly 下写 → 抛 NotCapable。
interface FsApi {
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  writeTextFile(path: string, data: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<FsFileInfo>;
  // 列目录：返回异步迭代器（不是数组），迭代项为 DirEntry；迭代完自动关闭句柄。
  readDir(path: string): Promise<AsyncIterable<FsDirEntry>>;
}

interface FsFileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
  atime: Date | null;
  birthtime: Date | null;
  ctime: Date | null;
  dev: number;
  mode: number | null;
  ino: number | null;
  nlink: number | null;
  uid: number | null;
  gid: number | null;
}

interface FsDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

// bus.* ：主题广播。publish 广播给订阅 topic 的全部 WS 会话，返回接收方数；
// subscribe 仅 WS 会话内可用（HTTP 路径报错）；kind 报告活跃 broker 类型。
interface BusApi {
  // data 为 Uint8Array/ArrayBuffer → Binary 帧原字节（不包信封，v0.1.16）；其余 → JSON 信封 Text 帧。
  publish(topic: string, data?: unknown): Promise<number>;
  subscribe(topic: string): Promise<void>;
  kind(): Promise<string>;
}

// cert.* ：JWS 证书生成/重签（RSA + RS256 在 Rust 侧；纯内存，不落盘）。
interface CertApi {
  // 生成密钥对并签发 JWS。bits >= 2048；nbf/exp 为 Unix 秒，exp 必须 > nbf。
  generate(
    bits: number,
    nbf: number,
    exp: number,
  ): Promise<{ private_pem: string; public_pem: string; cert_jws: string }>;
  // 用现有 PKCS#8 私钥重签续期（公钥不变），返回新 cert.jws 串。
  renew(privatePem: string, nbf: number, exp: number): Promise<string>;
}

// es.* ：Elasticsearch 薄客户端（直通 ES 响应体；未配置调用报 es not configured）。
interface EsApi {
  search(index: string, dsl?: unknown): Promise<Json>;
  index(index: string, id: string, doc?: unknown): Promise<Json>;
  del(index: string, id: string): Promise<Json>;
}

// jwt.* ：JWT 签发/验签（secret/alg/durations 由 config auth: 注入；未配置调用报
// jwt not configured）。iat/exp 由 Rust 补（JS 不可控有效期），exp 取 access 时长。
interface JwtApi {
  // payload 至少含 sub；roles 可选（缺省空数组）。返回签名 token。
  sign(payload: { sub: string; roles?: string[] }): string;
  // 验签 + exp（leeway 0）；篡改/过期/算法不符直接抛错。
  verify(token: string): { sub: string; roles: string[]; iat: number; exp: number };
  // 配置的有效期（秒；getter 惰性求值）。
  readonly accessDuration: number;
  readonly refreshDuration: number;
}

// oidc.* ：内置 OP/RP（RS256 私钥只在 Rust 侧；issuer/rp/clients 由 config oidc: 注入；
// 未配置段调用报 oidc not configured）。verify 传 jwks 时按其 RS256 kid 匹配验签，
// 不传（或 null）回落本地私钥；篡改/过期/无匹配钥直接抛错。
interface OidcApi {
  // claims 至少含 iss/sub/aud/iat/exp。返回签名 token。
  sign(claims: Record<string, unknown>): string;
  // 验签 + exp；jwks 可选（缺省用本地钥）。
  verify(token: string, jwks?: unknown): Record<string, unknown>;
  // 本地公钥 JWKS（keys[0].kid/kty/alg/n/e）。
  jwks(): unknown;
  // config oidc.issuer（getter 惰性求值）。
  readonly issuer: string;
  // RP 侧 tenant → IdP 配置。
  readonly rp: Record<string, { issuer: string; client_id: string; client_secret: string; scope: string }>;
  // OP 侧客户端白名单。
  readonly clients: Record<string, { secret: string; redirect_uris: string[]; tenant: string }>;
}

// mail / Mail(key) ：邮件投递（config smtp: 段 + oj-mail 插件启用；未配置调用报
// mail not configured）。宿主做校验/附件解析，插件做投递；所有方法**都 resolve 信封**
// （校验失败 = {code:5}，不抛），只有「未配置」抛异常。
// code：0 成功（data.messageId 为投递凭据、data.jobId 为作业号）/ 1 网络/超时（**以及
// 一切投递期失败**，含 SMTP 5xx 与鉴权失败）/ 4 队列满 / 5 入参校验（地址、白名单、正文、
// 附件、profile）。**2（SMTP 5xx）/ 3（鉴权）为保留未启用**：两类都归 1，判失败请用
// `code !== 0`（见 docs/mail-smtp.md §3）。
interface MailEnvelope {
  code: number;
  msg: string;
  data: { jobId?: string; messageId?: string } & Record<string, Json>;
}

// 附件（引用式：字节不进 JS、不走 base64）：filename 必填，blobKey / path 二选一。
interface MailAttachment {
  filename: string;
  // blob 后端里的键（经 blob 字段选后端，缺省 "default"）。
  blobKey?: string;
  blob?: string;
  // 项目根内的本地文件路径（../ 越界即拒）。
  path?: string;
  // 显式 MIME（缺省按扩展名 → 字节嗅探 → application/octet-stream）。
  mime?: string;
}

interface MailSendRequest {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
}

interface MailRawRequest extends MailSendRequest {
  // RFC5322 原文（与 attachments 互斥）。
  raw: string;
}

// ldap 泛型轴载荷形状（v0.1.54 起 `ldap`/`LDAP` 全局已下线，调用面为
// `axis("ldap").<op>`，op 为 snake_case：bind/search/search_paged/whoami/compare；
// axis 返回 any，cast 到下列形状）。错误模型同 db：**除「未配置」外，校验/协议/
// 网络错一律 reject**——只有 bind 的「凭据被 LDAP 拒绝」是正常返回 false（含 rc 49）。
interface LdapSearchOpts {
  // 默认 "sub"（整棵子树）；"one" = 仅 base 下一层；"base" = 只查 base 自身。
  scope?: "base" | "one" | "sub";
  // RFC 4515 过滤器，默认 "(objectClass=*)"——用户输入须先转义（无参数绑定）。
  filter?: string;
  // 要读的属性名；缺省/空数组 = 服务端默认属性集。
  attrs?: string[];
  // 可选：覆盖本次查询的绑定凭据（与 config ldap:<inst> 的 bind_dn/bind_pw 合并——
  // 二者取一即可，另一个回落 config）。用于把密码作为运行时参数传入，避免落配置。
  // 仅 search / search_paged 支持；whoami/compare/bind 仍用 config 服务账号或各自入参。
  bindDn?: string;
  bindPw?: string;
}

interface LdapEntry {
  dn: string;
  // 文本属性（多值即多元素）。
  attrs: Record<string, string[]>;
  // 二进制属性（jpegPhoto 等）：base64 编码字符串。
  bin: Record<string, string[]>;
}

// ldap / LDAP 全局已随 oj-ldap 迁移泛型轴下线（v0.1.54）——调用面为
// `axis("ldap").<op>`（返回 any），op 为 snake_case：bind / search / search_paged /
// whoami / compare（载荷形状见上 LdapSearchOpts / LdapEntry）。

interface MailApi {
  // 异步 transport；resolve 投递结果信封。
  send(m: MailSendRequest): Promise<MailEnvelope>;
  // 同步 transport（插件 worker 内阻塞投递）。
  sendSync(m: MailSendRequest): Promise<MailEnvelope>;
  // 入队即回 {code:0,data:{jobId}}；真实完成经 bus topic "mail.result" 上送。
  // jobId 由宿主生成（不可猜；调用方传入的 jobId 被剥离）。
  enqueue(m: MailSendRequest): Promise<MailEnvelope>;
  // 查宿主侧结果（未命中/已过期/**非本归属** → null；归属 = 本实例的 profile + 模块 + 租户）。
  result(jobId: string): Promise<Json | null>;
  // 原始 MIME 投递。
  sendRaw(o: MailRawRequest): Promise<MailEnvelope>;
}

interface Mail {
  new (key?: string): MailApi;
  // 已配置 profile 名清单（非密钥面：连接信息/凭据不进 JS）。
  profiles(): Promise<string[]>;
}

// bcrypt.* ：密码哈希（Rust 侧 spawn_blocking，CPU 密集不卡 isolate）。
interface BcryptApi {
  hash(password: string, cost?: number): Promise<string>;
  // 非法 hash 返回 false（不抛错）。
  verify(password: string, hash: string): Promise<boolean>;
}

// vars.* ：部署期常量读口（config `vars:` 段，v0.1.25）。
// **同步**（装配期冻结的表，无 IO）；**fail-closed**：只有 config 里声明的键可读，
// 其余恒 null（没有「读任意 OS env / 任意 config 键」的通道）。值按 YAML 标量文本成串
// （`PORT: 3000` → `"3000"`；嵌套 map/list 是配置解析错误）。
//   const web = vars.get("WEB_URL") ?? "http://localhost:3000";
interface VarsApi {
  get(name: string): string | null;
}

declare global {
  interface Function {
    route?: string;
  }

  const json: JsonApi;
  const http: HttpApi;
  const log: Logger;
  const kv: KVApi;
  const redis: KVApi;
  const ws: WSApi;
  // WS 帧池会话上下文（仅 ws.ts 生命周期钩子内可用，见 WsSess）。
  const sess: WsSess;
  const blob: BlobApi;
  const fs: FsApi;
  const bus: BusApi;
  const es: EsApi;
  // 默认 profile（"default"）的 mail 实例；其它 profile 用 new Mail("name")。
  const mail: MailApi;
  // ldap 全局已下线（v0.1.54）：调用面 axis("ldap").<op>（op 为 snake_case）。
  const Mail: Mail;

  // 命名数据库实例；未配置的名字返回 undefined。
  function DB(name: string): DBInstance | undefined;
  // 默认（"default"）数据库实例。
  const db: DBInstance;
  const cert: CertApi;
  const jwt: JwtApi;
  const oidc: OidcApi;
  const bcrypt: BcryptApi;
  // 部署期常量（config `vars:` 段；未声明的键恒 null）。
  const vars: VarsApi;

  // ---- 大整数（v0.1.22；u64 见 v0.1.24；详见 docs/numeric-limits.md）----
  // DB 的 i64 超出安全整数范围（|v| > 2^53-1，雪花 id 常态）时，读出来是**十进制字符串**；
  // 写回去必须用 toBigInt()（字符串是文本意图，PG 上写 bigint 列会直接报错）。
  // 两者都 fail-loud：非规范十进制 / 已坍缩的 number 一律抛错，不静默取近似。
  /** 十进制整数字符串 | 安全范围内的 number | bigint → bigint（精确 64 位，范围 [-2^63, 2^63-1]）。 */
  function toBigInt(v: string | number | bigint): bigint;
  /** 同上但为**无符号** 64 位 `[0, 2^64-1]`：只有 MySQL `BIGINT UNSIGNED` 列能承载，
   * PG / SQLite 传本值会**明确报错**（它们的 bigint 就是 i64）。 */
  function toUBigInt(v: string | number | bigint): bigint;
  /** number | 数字串（含科学计数法）| bigint → number（f64，**显式接受精度丢失**）。 */
  function toDouble(v: string | number | bigint): number;

  // crypto 增补（bootstrap 对 crypto 做 Object.assign 合并）：
  // sha256Hex = 十六进制摘要；randomHex = nBytes 字节随机数的 hex（默认 32 字节）；
  // getRandomValues（v0.1.30）= oj 实现（原生不存在）：任意 TypedArray view 填充后
  // 返回原 view，非 view 抛 TypeError，单次 ≤65536 字节（对齐 WebCrypto；lib.dom 的
  // 同名声明只是兜底，运行时是 oj 实现）。
  interface Crypto {
    sha256Hex(s: string): string;
    randomHex(nBytes?: number): string;
    getRandomValues<T extends ArrayBufferView>(view: T): T;
    // AES-GCM 应用级加密（v0.1.35）：key 为 hex/base64 编码的原始 16/32 字节
    // （按长度选 Aes128/256；aes-gcm 0.10 不含 AES-192），来自 vars.get(...)；明文 utf8 进，
    // base64(nonce12 ‖ ct ‖ tag16) 出。密钥缺失/非法由调用方 json.fail。
    aesGcmEncrypt(plaintext: string, key: string): string;
    aesGcmDecrypt(ciphertext: string, key: string): string;
  }

  // ---- oj test L1 测试 SDK（oj test 运行时注入；仅测试文件使用） ----
  // 进程内 HTTP 派发助手，对标 Go Fiber app.Test：client.get/post/... 触发真实
  // 路由 + 真实运行时 + 真实后端（零 TCP）。path 为相对 base 的路径（如 "/user/account"）。
  interface ClientResp {
    status: number;
    headers: Record<string, string>;
    body: string;
    upgrade: boolean;
  }
  interface ClientOptions {
    headers?: Record<string, string>;
    body?: string;
  }
  // WS 帧测试面（v0.1.16）：path 形如 "/echo-bin/ws"（相对 base）。
  // 帧型判别：binary = true 为二进制帧（data 为 Uint8Array），false 为文本帧（data 为 string）。
  interface TestWsFrame {
    binary: boolean;
    data: string | Uint8Array;
    // 判别位（可选）：收到帧时为 false/缺失，便于 `if (f.closed) …` 收窄联合类型。
    closed?: false;
  }
  // 对端已关闭（此后不会再收到帧）。
  interface TestWsClosed {
    closed: true;
  }
  interface TestWs {
    send(data: string | Uint8Array): Promise<void>;
    // 下一帧：{binary, data}（收到帧）/ {closed: true}（对端关闭）/ null（超时无帧，默认 1000ms）。
    // 取 binary/data 前先收窄：`if (!f || f.closed) …`（否则 TS 报「binary 不存在于 closed 分支」）。
    next(ms?: number): Promise<TestWsFrame | TestWsClosed | null>;
    close(): Promise<void>;
  }
  interface Client {
    ws(path: string): TestWs;
    get(path: string, opts?: ClientOptions): Promise<ClientResp>;
    post(path: string, opts?: ClientOptions): Promise<ClientResp>;
    put(path: string, opts?: ClientOptions): Promise<ClientResp>;
    del(path: string, opts?: ClientOptions): Promise<ClientResp>;
    patch(path: string, opts?: ClientOptions): Promise<ClientResp>;
    head(path: string, opts?: ClientOptions): Promise<ClientResp>;
    options(path: string, opts?: ClientOptions): Promise<ClientResp>;
    // 登录助手：POST /auth/login → 返回 access_token（失败抛错）。headers 透传（如租户头）。
    login(username: string, password: string, headers?: Record<string, string>): Promise<string>;
  }
  const client: Client;

  // 轻量测试框架（vitest 风格子集）：describe/it/expect/beforeEach。
  function describe(name: string, fn: () => void): void;
  function it(name: string, fn: () => void | Promise<void>): void;
  function beforeEach(fn: () => void | Promise<void>): void;
  function expect(actual: unknown): {
    toBe(e: unknown): void;
    toEqual(e: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(sub: unknown): void;
  };

  // 标记会话结束。
  function finish(): void;
  // CJS 同步 require（eval + 进程级缓存）。
  function __ojRequire(name: string, referrerPath?: string): any;
  // 浏览器兼容的 fetch（url 必填，options 同 RequestInit 的常用子集）。
  function fetch(url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | null;
  }): Promise<OjFetchResponse>;
  // 已加载插件自省：[{name, semver, abi_version, fingerprint, host_abi_version}]。
  function plugins(): any[];
  // 泛型插件轴调用面（v0.1.54）：axis("cache").get("k")——任意方法名 = 该轴的一个 op，
  // 参数位置传、末位对象 = opts（轴自定义）。未知轴抛错并列出可用轴名。
  function axis(name: string): any;
  // 装配期固化诊断（v0.1.54；与 `oj info` CLI 同源，同步无 IO）：build/abi/plugins/
  // backends/config 五段；config 只出键名不出值；无公共 HTTP 端点。
  function ojInfo(): any;

  // 命名 MQ 客户端（config kafkas:/rabbits: 段；未配置的名 → undefined）。
  // 消费方法（poll/commit/ack/nack）仅长任务上下文可用（HTTP/WS 内调用报错）。
  function Kafka(name: string): OjKafkaClient | undefined;
  function RabbitMQ(name: string): OjRabbitClient | undefined;
  // 长任务上下文（对象全局）：stopping = 停机信号（HTTP/WS 上下文恒 false）；
  // sleep = 等待原语（本运行时无 timer 全局，setTimeout 不可用）。
  const tasks: {
    stopping(): boolean;
    sleep(ms: number): Promise<void>;
  };
}

interface OjMqMessage {
  topic: string;
  partition?: number;
  offset?: number;
  key?: string;
  value: any;
  // 非 UTF-8 载荷时 value 为 null，value_b64 为 base64 字符串（v0.1.16）；生产侧传
  // Uint8Array 亦编码进 value_b64（record 载荷 = 原始字节）。
  value_b64?: string;
  headers?: Record<string, string>;
  ts?: number;
  delivery_tag?: number; // rabbit 专属：ack/nack 载荷原样回传
}

interface OjKafkaClient {
  kind(): Promise<string>;
  send(topic: string, o: { key?: string; partition?: number; headers?: Record<string, string>; value: any }): Promise<{ sent: number }>;
  poll(topics: string[], o?: { max?: number; timeoutMs?: number }): Promise<{ messages: OjMqMessage[] }>;
  commit(m: OjMqMessage): Promise<Record<string, never>>;
  metadata(): Promise<any>;
}

interface OjRabbitClient {
  kind(): Promise<string>;
  publish(exchange: string, routingKey: string, value: any, o?: { headers?: Record<string, string> }): Promise<{ sent: number }>;
  poll(queues: string[], o?: { max?: number; timeoutMs?: number }): Promise<{ messages: OjMqMessage[] }>;
  ack(m: OjMqMessage): Promise<Record<string, never>>;
  nack(m: OjMqMessage, requeue?: boolean): Promise<Record<string, never>>;
  metadata(): Promise<any>;
}

// oj 的导入别名 `#x`（本模块根）/ `#/m/x`（src 根）是「引用方所在模块」相对的，
// tsconfig 的 `paths` 无法表达模块相对解析，只能枚举模块目录（见 tsconfig.json），
// 因此仅能命中**已存在**的文件。无法静态定位的别名（如尚未创建的 `#_shared/view`）
// 由 `types/oj-modules.d.ts`（非模块，真 ambient `declare module "#*"`）兜底为 `any`
// 而非报 TS2307；已存在、能被 `paths` 命中的别名仍走真实文件类型。运行时由 oj 的
// loader 解析，本文件与该兜底只影响编辑器 / tsc。

// fetch 返回的 Response（浏览器风格子集）。
interface OjFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  json(): Promise<Json | null>;
  text(): Promise<string>;
  arrayBuffer(): Promise<Uint8Array>;
  clone(): OjFetchResponse;
}

export {};
