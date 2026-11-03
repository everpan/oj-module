// bootstrap.js 运行时注入的全局对象的 TS 声明（只影响编辑器 / tsc，dev server 不依赖）。
// 本文件只放**类型 + 关键陷阱**，行为细节与叙事见 docs/devkit（api-manual / db-guide）。
// ext_boot.js 自定义的全局不在此声明：另建 .d.ts 自行声明并进 tsconfig include，
// 否则 TS2339。

// ======== 一、基础值类型 ========

// JSON 反序列化后可能出现的值（SQL 行 / KV / fetch body 等）。
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// 数据库查询返回的一行（列名 -> 值）。
type Row = Record<string, Json>;

// ======== 二、查询构造器与结构内省（db.table / db.catalog 面） ========

// db.table(...).where(cond) 的单个条件。叶子用 field/op/value；组合用 and/or/not
// （也可经 db.leaf/db.and/db.or/db.not 构造）——故 field 可缺省（纯组合节点）。
interface WhereCond {
  field?: string;
  op?: string; // eq/neq/gt/gte/lt/lte/like/in/nin/null/notnull/... 依服务端支持
  value?: unknown;
  // 子查询：in/eq/ne/gt/gte/lt/lte 叶子以 subquery 代 value（builder 或纯 JSON
  // 请求）；value 与 subquery 互斥；isnull/like 不接受子查询。
  subquery?: QueryBuilder | object;
  // exists 节点：`{ exists: <子查询> }`，不得携带其他键。
  exists?: QueryBuilder | object;
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
  // 动态 WHERE：test 为 undefined/null/false 或空数组时跳过该条件；
  // 0 与 "" 是合法值、保留（空数组跳过是防 IN () 恒假静默 0 行）。
  whereIf(test: unknown, cond: WhereCond): QueryBuilder;
  orderBy(items?: OrderByItem[]): QueryBuilder;
  // 顶层 select 未给 limit 隐式补 default_limit；显式值 clamp 到 max_limit（config
  // `db_query` 段）。可能被截断看响应头 X-OJ-Row-Limit，别猜。
  limit(n: number): QueryBuilder;
  offset(n: number): QueryBuilder;
  // 行数组（每行是列名 → 值；与 db.query 的返回同形）。
  all(): Promise<Row[]>;
  // DML：动词由 insert/update/delete 声明，run() 终执行（受影响行数）。
  // insert + returning(["id"]) 时 run() 返回行数组 [{ id: n }]（mysql 建议放 db.tx）。
  insert(rows: object | object[]): QueryBuilder;
  update(sets: object): QueryBuilder;
  delete(): QueryBuilder;
  // 整表清空：唯一的无 where 写动词；租户表上只清当前租户（清整库用 db.asSystem）。
  truncate(): QueryBuilder;
  returning(cols?: string[]): QueryBuilder;
  // 幂等写入：撞唯一键的行跳过（mysql 回落 identity update，需主键、与 returning 互斥）。
  orIgnore(): QueryBuilder;
  // 查询插入：cols 与子查询输出列按位置对齐；与 insert 的 values 互斥。
  fromSelect(sub: QueryBuilder | object, cols: string[]): QueryBuilder;
  // JOIN：on 两形 {left,right}（列=列）/ {left,op,value}（列=值，op 限比较类）；
  // kind 缺省 "inner"；alias 起别名——守卫仍按真名。
  join(
    table: string,
    on: ({ left: string; right: string } | { left: string; op: string; value?: unknown })[],
    kind?: string,
    alias?: string,
  ): QueryBuilder;
  // 基表别名：列限定写 "别名.列"；仅 select/join 生效，守卫按真名。
  as(alias: string): QueryBuilder;
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

// db.sqlProfile() 的返回：本请求 SQL 画像。追踪未开启（release 默认 /
// `db_trace.enabled:false`）时为空对象 {}。
interface SqlProfile {
  count: number;
  totalMs: number;
  // 慢查询速览（超 db_trace.slow_ms 阈值的语句）。
  slow: { sql: string; ms: number; db: string }[];
  // 按库聚合：{ "default": { count, ms }, ... }。
  byDb: Record<string, { count: number; ms: number }>;
  // 逐条回放；params 恒为 "N params" 形式的脱敏串（redact_params 默认 true，
  // 绝不把参数原值送进响应）。
  events: {
    sql: string;
    params: string;
    db: string;
    inTx: boolean;
    source: string;
    ms: number;
    rows: number;
    ok: boolean;
    error?: string;
  }[];
}

// db.allowed() 的返回：当前调用主体**有权限访问**的库别名 + 能力位。
// 未授权的库不出现在列表里（数据面板的库选择器应以此为准，别硬编码 `db:` 段别名
// ——那会列出点了才报错的假入口）。
interface DbAllowedEntry {
  alias: string;
  // 方言名（开放集 起由插件 describe() 声明）。
  dialect: string;
  read_only: boolean;
  allow_ddl: boolean;
  allow_dangerous: boolean;
  // null = 不限。
  max_rows: number | null;
  enforce: "off" | "warn" | "deny";
}

// 事务内的库实例：与 DBInstance 同面，但没有 tx（嵌套事务不支持）、没有 stream
// （流式只走直连池，tx 内报错）。
// isTx 标记事务域句柄——DDL（如 search.ensureIndex）必须拒绝在此类句柄上执行
// （MySQL 的 DDL 会隐式提交调用方事务）。
type TxInstance = Omit<DBInstance, "tx" | "stream"> & { isTx?: true };

// ======== 三、请求上下文与响应信封（json / http / log） ========

// json.* ：统一响应信封 + 响应头。
interface JsonApi {
  ok(data?: unknown): void;
  fail(code: number, msg: string, data?: unknown): void;
  header(name: string, value: string): void;
  // 裸 JSON 200（不套信封）：标准协议端点（如 OIDC）用；错误仍走 fail()。
  raw(data?: unknown): void;
  // 3xx 重定向原语：Location + RFC 9110 §15.4 短超文本注记（HEAD 为空 body）。
  // code 非 3xx 一律回落 302；具名封装对应五个标准 3xx，语义见名。
  redirect: {
    (url: string, code?: number): void;
    movedPermanently(url: string): void; // 301 永久迁移
    found(url: string): void; // 302 临时（默认）
    seeOther(url: string): void; // 303 跟随后改 GET
    temporaryRedirect(url: string): void; // 307 方法/体保持
    permanentRedirect(url: string): void; // 308 永久 + 方法保持
  };
  // 流式响应：开流后逐块 write，绕过 {code,msg,data} 信封。
  // opts：{ status?, contentType?, fileName?, disposition? }——fileName + disposition:
  // "attachment"（缺省）按原名附件下载、"inline" 内联。
  stream(opts?: {
    status?: number;
    contentType?: string;
    fileName?: string;
    disposition?: "attachment" | "inline";
  }): StreamWriter;
  // SSE 便捷封装：自动 text/event-stream + 数据帧 `data: <c>\n\n`；
  // opts：{ status?, heartbeatSecs? }（心跳默认 15s，保活穿透代理）。
  sse(opts?: {
    status?: number;
    heartbeatSecs?: number;
    fileName?: string;
    disposition?: "attachment" | "inline";
  }): StreamWriter;
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
  // WS Binary 帧时 body 为 null；原始帧字节走 bodyBytes()（文本帧亦可用）。
  bodyBytes(): Promise<Uint8Array>;
  // 取路由参数或 query 参数：路径参数优先，query 兜底，均缺失返回 def 原值。
  param(name: string, def?: unknown): any;
  // 租户 id（tenant 启用时从租户头提取；未启用为 null）。`db.asTenant(id)` 声明成功后
  // 即为该 id。
  tenantId: string | null;
  // 已验签用户（auth 启用且通过 Bearer 守卫；否则 null）。
  user: AuthUser | null;
  // 本请求命中的模块身份（无模块上下文为 null；对象已冻结）。version 勿回显外部（指纹面）。
  module: { name: string; version: string } | null;
  // multipart 上传文件元信息（非 multipart 为空数组）。
  files: UploadedFileMeta[];
  // 取第 i 个上传文件的字节（越界报错 no such file）。
  // 仅小文件（≤ max_upload）有字节；流式大文件报错并指路 files[i].key/.url。
  file(i: number): Promise<Uint8Array>;
}

// 已验签用户（JWT claims）。
interface AuthUser {
  id: string | number;
  roles: string[];
  claims: Record<string, Json>;
}

// multipart 上传文件元信息（大文件流式落 blob：bytes 拿不到，用 key/url 取）。
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

// ======== 四、存储（kv / blob / fs / es） ========

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

// ======== 五、实时与消息（ws / bus） ========

// ws.* ：WebSocket 生命周期钩子内的主动发送/关闭控制（HTTP 路径 no-op）。
// send 帧型由参数类型决定：string → Text 帧(0x1)；Uint8Array → Binary 帧(0x2)。
interface WSApi {
  send(data: string | Uint8Array): void;
  close(): void;
  // 房间原语（进程内单例 hub；跨实例扇出仍走 bus.publish）：
  // join/leave 仅在 ws.ts 生命周期钩子内可用（连接身份自动取，断连自动摘除）；
  // broadcast 为 socket.io 除己语义（发送者要回声自己在 JS 里发），HTTP handler 可调
  // （无连接身份 = 不排除任何人）；roomSize 任意上下文可调。
  join(room: string): void;
  leave(room: string): void;
  broadcast(room: string, data: string): number;
  roomSize(room: string): number;
}

// sess.* ：WS 帧池会话上下文（**只在 ws.ts 生命周期钩子内存在**）。路由级无状态 Worker
// 共享执行：连接态必须外置到 sess.state（按连接隔离）；模块作用域是 Worker 本地缓存，
// **不要**放连接状态。
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
  // s3 返回 15min 预签名 PUT URL（客户端直传）；local 无预签名——抛错，走 PUT {base}/blob/{key}。
  uploadUrl(key: string, opts?: { kind: string }): Promise<{ url: string }>;
  // local 缺失 sidecar 且无法按扩展名推断时返回空串；s3 无 Content-Type 时返回 null。
  contentType(key: string): Promise<string | null>;
  // 服务端复制：src 保留。字节不进 JS——大文件搬运别用 get + put。
  copy(src: string, dst: string): Promise<boolean>;
  // 服务端搬移：src 不再存在（local 同目录 rename / s3 CopyObject+Delete）。
  move(src: string, dst: string): Promise<boolean>;
  // 区间读：短读截断——越尾只给实际剩余字节，offset 过尾给空数组；
  // offset / len 为负、小数、NaN 即报错。
  readRange(key: string, offset: number, len: number): Promise<Uint8Array>;
}

// fs.* ：本地文件系统（config `fs:` 段启用；一次性 API，无 fd）。相对路径解析到 jail 根
// fs.root 下；未配置 / 越出 root（含 symlink 外指）/ readonly 写 → 抛 NotCapable。
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
  // data 为 Uint8Array/ArrayBuffer → Binary 帧原字节（不包信封）；其余 → JSON 信封 Text 帧。
  publish(topic: string, data?: unknown): Promise<number>;
  subscribe(topic: string): Promise<void>;
  kind(): Promise<string>;
}

// ======== 六、认证与身份（cert / jwt / oidc / sso / bcrypt） ========

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

// sso.* ：HTTP 表单 / CAS SSO 提供者注册表（config `http_sso:` 段注入；
// 未配置调用报 http sso not configured）。字段语义与校验规则见 api-manual §sso。
interface SsoProviderCfg {
  kind: "form" | "cas2";
  login_url: string;
  cas_validate_url?: string;
  callback_url?: string;
  user_field?: string;
  pass_field?: string;
  body_encoding?: "form" | "json";
  extra_fields?: Record<string, unknown>;
  success_when?: Record<string, unknown>;
  profile?: Record<string, string>;
  allow_http?: boolean;
}
interface SsoApi {
  readonly providers: Record<string, SsoProviderCfg>;
}

// ======== 七、投递与工具面（mail / ldap 载荷 / vars / exec / yaml / server） ========

// mail / Mail(key) ：邮件投递（smtp: 段 + oj-mail 插件；未配置调用抛 mail not configured）。
// 方法都 resolve 信封（校验失败不抛）。code：0 成功 / 1 投递期一切失败（含 SMTP 5xx、鉴权）
// / 4 队列满 / 5 入参校验；2/3 保留未启用——判失败用 `code !== 0`（docs/mail-smtp.md §3）。
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

// ldap 泛型轴载荷形状：`ldap`/`LDAP` 全局已下线，调用面 `axis("ldap").<op>`
// （op 为 snake_case：bind/search/search_paged/whoami/compare；axis 返回 any）。错误模型：
// 除「未配置」外一律 reject，唯 bind 凭据被拒是正常返回 false（rc 49）。
interface LdapSearchOpts {
  // 默认 "sub"（整棵子树）；"one" = 仅 base 下一层；"base" = 只查 base 自身。
  scope?: "base" | "one" | "sub";
  // RFC 4515 过滤器，默认 "(objectClass=*)"——用户输入须先转义（无参数绑定）。
  filter?: string;
  // 要读的属性名；缺省/空数组 = 服务端默认属性集。
  attrs?: string[];
  // 可选：覆盖本次绑定凭据（与 config 合并，二者取一）；仅 search/search_paged 支持。
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

// vars.* ：部署期常量读口（config `vars:` 段）。同步、fail-closed：只有 config 声明的键
// 可读，其余恒 null；值按 YAML 标量文本成串（`PORT: 3000` → `"3000"`）。
interface VarsApi {
  get(name: string): string | null;
}

// exec.*：外部命令执行（config `platform.exec` 段授权）。授权 = argv 模板白名单
// （literal 逐字相等 + ${path:}/${raw:} 占位符恰吸收一个 token）+ 无 shell；argv 须恰命中
// 一条模板（歧义报错）。${path:} 按 fs.root ∪ trusted_paths 校验；${raw:} 拒 `-` 开头与
// 绝对路径。缺省全 deny（fail-closed）。
interface ExecRunOpts {
  /** 缺省 30_000，硬上限 600_000（超出钳制）。大 DDL / 大 stdin 显式调大。 */
  timeoutMs?: number;
  /** 一次性写入子进程 stdin 后关闭写端；写入也在超时窗口内。 */
  stdin?: string;
}
interface ExecResult {
  /** 进程退出码：非 0 也正常返回（不抛错）；信号终止 = 128 + signal。 */
  code: number;
  stdout: string;
  stderr: string;
}
interface ExecApi {
  /** 执行授权模板匹配后的外部命令（无 shell；cwd = fs.root，env 白名单透传、PATH 不继承；
   * "oj" 即服务进程自身）。未授权/模板失配/越界 → NotCapable；超时/输出超限(10MB)/
   * 非 UTF-8 → 普通 Error；未配 fs: 或无模块归属恒拒。 */
  run(argv: string[], opts?: ExecRunOpts): Promise<ExecResult>;
}

// yaml.*：YAML 读写原语（无特权）。parse：三预算防炸弹（1 MiB / 10 万节点 / 深 128）+
// 5s deadline；重复键后键覆盖；多文档/非字符串键/NaN·Inf 拒绝；超 2^53-1 整数为十进制串。
interface YamlApi {
  parse(text: string): Promise<unknown>;
  /**
   * 仅承诺机器产物（manifests.yaml）往返——serde_yaml 丢注释，禁用于 config.yaml
   * 回写（走文本手术）。对象键输出保留 JS 对象键插入序（整数型键先行），不排序；
   * 需确定序请在 stringify 前自行归序。
   */
  stringify(value: object): Promise<string>;
}

// server.*：平台级控制（platform 特权）。
// reloadConfig：进程内触发热更（与 `POST {base}/_system/config` 同一 executor 与串行锁）；
// tasks/WS 上下文无归属 → NotCapable；`oj test` / 嵌入式 → `reload not available`；
// 并发撞锁 → `server.reloadConfig: reload in progress (busy)`。
interface ServerReloadResult {
  /** 代际 id（每次成功 swap +1；unchanged 时不变）。 */
  generation: number;
  /** 配置未变（归一后与原代等价）：true 时 applied/restart_pending/kept_listener 均为空数组。 */
  unchanged: boolean;
  /** 本轮实际生效的变更项（段/键清单）。 */
  applied: string[];
  /** 需重启进程才生效的项（如 db/redis/plugins 后端段、server 段）——提示重启，本进程不重建。 */
  restart_pending: string[];
  /** 本进程永久持有、不随热更变更的项（如 listener：server.port/host/证书路径）。 */
  kept_listener: string[];
}
interface ServerApi {
  reloadConfig(): Promise<ServerReloadResult>;
}

// ======== 八、运行时全局绑定（declare global） ========

declare global {
  interface Function {
    route?: string;
    /** handler 入参契约（`.schema`；嵌套组动词同样可挂，键 = (文件, handler 链)） */
    schema?: Record<string, unknown>;
    /** handler 出参契约：与 `.schema` 平级声明，语义同 `.schema.response`
     * （`json.ok(data)` 的 data payload；运行期不校验，只喂 `oj openapi` / client 生成）。
     * 优先级：动词 `.response` > 组 `.response` > 动词 `.schema.response` > 组 `.schema.response` */
    response?: Record<string, unknown>;
  }

  // 嵌套组：以实体对象为根的组同样可挂组级 `.route`（整组默认前缀）、
  // 组级 `.schema`（整组默认入参契约）与组级 `.response`（整组默认出参），
  // 与 handler 级同语义。组是普通对象字面量，
  // 故在 `Object` 上声明，使 `anchor.route = "/x/{anchor}/upload"` 之类不报 TS2339。
  // 运行时：组级 `.schema` 作继承默认，动词自身 `.schema` 在其上合并（通道级
  // required 并集 / properties 逐键覆盖）；组级 `.response` 同样沿嵌套层层继承。
  interface Object {
    route?: string;
    /** 组级入参契约（嵌套组）：整组默认，动词 `.schema` 在其上合并 */
    schema?: Record<string, unknown>;
    /** 组级出参契约：整组默认，沿嵌套继承，动词 `.response` 整体覆盖。
     * ⚠️ 保留键：组对象上的 `response` 被当作声明读走，**不能**用来命名嵌套子组
     * （子组命名为 response 会静默不产生路由，与 `schema`/`route` 相同） */
    response?: Record<string, unknown>;
  }

  // REQ-04（v0.1.105）db.listSchemas()/listDatabases() 的返回：跨方言同构，
  // 可选键缺省不出现（方言差异不归一化）。
  // db.listColumns() 的返回：单列的结构信息。
  interface ColumnInfo {
    name: string;
    // 方言声明文本（sqlite `type` / mysql `column_type` / pg `format_type`），零归一化。
    nativeType: string;
    nullable: boolean;
    // 原始 DDL 文本（sqlite 字符串默认带引号）；无默认值为 null。
    default: string | null;
    primaryKey: boolean;
  }

  // db.listIndexes() 的返回：单索引的结构信息。
  interface IndexInfo {
    name: string;
    unique: boolean;
    primary: boolean;
    // 三方言统一口径：`c`(普通) / `u`(唯一) / `pk`(主键)。
    origin: "c" | "u" | "pk";
    // 组成该索引的列（已按声明序聚合）。
    columns: string[];
  }

  // db.explain() 的归一计划节点（G3，v0.1.108）：PG/MySQL 同构，字段级 null 口径——
  // cost.startup 仅 PG 有；width 仅 PG 有；MySQL rowsEstimate 取 rows_produced_per_join
  // （与 PG Plan Rows 同为「输出行数」语义）；extra 为谓词/附属信息多行文本或 null。
  interface PlanNode {
    category: "scan" | "join" | "aggregate" | "sort" | "other";
    // PG 物理算子名（"Index Scan"/"Nested Loop"/"HashAggregate"…）或
    // MySQL access_type（"const"/"ref"/"ALL"…）；容器为键名（"query_block"/"nested_loop"…）。
    operation: string;
    relation: string | null;
    // PG 索引名 / MySQL key。
    accessPath: string | null;
    cost: { startup: number | null; total: number | null } | null;
    rowsEstimate: number | null;
    width: number | null;
    extra: string | null;
    children: PlanNode[];
  }

  // db.listForeignKeys() 的返回：单外键的结构信息。
  interface ForeignKeyInfo {
    // sqlite 外键无约束名 → null。
    name: string | null;
    // 复合外键按位配对：`columns[i]` ↔ `refColumns[i]`。
    columns: string[];
    refTable: string;
    refColumns: string[];
  }

  // U-14（v0.1.109）db.ddlDiff() 的输入/输出类型。Structure 四维字段全部可选——
  // **缺省 = 不参与 diff；空数组 = 期望为空（出 DROP）**。省略 `indexes` 绝不生成
  // DROP INDEX 全家桶（数据安全语义）。
  interface DdlColumnSpec {
    name: string;
    nativeType: string;
    nullable?: boolean;
    default?: string | null;
    primaryKey?: boolean;
    // pg identity 列标记（"always"/"byDefault"）：跳过 default 文本比对（nextval 派生）；
    // pg 专属——mysql 结构里出现 → 参数错误。翻转（加/去 identity）出 changed（field="identity"）+ ADD/DROP IDENTITY。
    identity?: string;
    comment?: string | null;
  }
  interface DdlConstraintSpec {
    name: string;
    // pk / uq / ck。
    type: string;
    // 方言 DDL 文本（如 "CHECK (v > 0)" / "UNIQUE (email)"）。
    definition: string;
    columns?: string[];
  }
  interface DdlIndexSpec {
    name: string;
    unique?: boolean;
    // 主键索引走约束维度，ddlDiff 忽略 primary=true 的索引条目。
    primary?: boolean;
    origin?: string;
    columns?: string[];
  }
  interface DdlForeignKeySpec {
    name: string;
    columns: string[];
    refTable: string;
    refColumns: string[];
  }
  interface Structure {
    columns?: DdlColumnSpec[];
    constraints?: DdlConstraintSpec[];
    indexes?: DdlIndexSpec[];
    foreignKeys?: DdlForeignKeySpec[];
  }
  // statements 有序可重放：DROP（FK→约束→索引→列）→ 列变更 → ADD → 约束/索引 → FK 最后；
  // 同名 changed 约束/索引/FK 先 DROP 再 ADD（重放不撞已存在对象）。
  // 执行仍走 db.exec + allow_ddl；ddlDiff 本身零 DB I/O。建表路径（from=null）diff 同此形状（全 added）。
  interface DdlDiffResult {
    diff: {
      columns: { added: string[]; removed: string[]; changed: Record<string, unknown>[] };
      constraints: { added: string[]; removed: string[]; changed: Record<string, unknown>[] };
      indexes: { added: string[]; removed: string[]; changed: Record<string, unknown>[] };
      foreignKeys: { added: string[]; removed: string[]; changed: Record<string, unknown>[] };
    };
    statements: string[];
  }

  interface SchemaInfo {
    name: string;
    // pg 给属主角色名；mysql/sqlite 无此来源 → 缺省。
    owner?: string;
    // 是否连接默认库/schema（sqlite：name=="main"）。
    isDefault: boolean;
    // pg database 给 obj_description；其余方言无来源 → 缺省。
    comment?: string;
  }
  type DatabaseInfo = SchemaInfo;

  // REQ-04（v0.1.105）db.forSchema() 的只读内视受限视图：五件内视、无 query/exec/stream。
  interface IntrospectScope {
    listTables(prefix?: string): Promise<string[]>;
    listColumns(table: string): Promise<ColumnInfo[]>;
    listIndexes(table: string): Promise<IndexInfo[]>;
    listForeignKeys(table: string): Promise<ForeignKeyInfo[]>;
    catalog(kind: "views" | "routines" | "sequences" | "ddl" | "comment" | "constraints" | "stats", arg?: string):
      Promise<{ kind: string; dialect: string; items: Record<string, unknown>[] }>;
  }

  // DB(name) 返回的命名数据库实例。（在 declare global 内：业务代码要能**点名**
  // 这个类型（如 `function f(dbi: DBInstance)`）；放模块作用域会 TS2304。）
  interface DBInstance {
    // 原始 SQL + 绑定参数（params 可选）。返回行数组。
    // opts.timeoutMs：语句级超时（只能收紧 db_access.<alias>.statement_timeout_ms，
    // 传更大值以 OJ_DB_CAPACITY 拒并点名配置键）；超时回 OJ_DB_TIMEOUT。
    // opts.onOpen/onProgress（v0.1.114）：执行 id 回调 + 进度回调（sent/fetching/done，
    // done 恒发）——带回调即登记为可跨请求 db.cancel 的池执行。
    query(sql: string, params?: unknown[], opts?: DBCallOpts): Promise<Row[]>;
    // 执行写操作，返回受影响行数。opts 同 query。
    exec(sql: string, params?: unknown[], opts?: DBCallOpts): Promise<number>;
    /** 跨方言执行计划归一（G3，v0.1.108）：返回单根 PlanNode 树。
     * PG 走文本计划解析、MySQL 走 FORMAT=JSON 容器 walker，前端一条渲染路径覆盖。
     * 授权面与 db.query 同门（守卫/配额/trace 复用同一通路）；无 ANALYZE、不执行内层语句。
     * sqlite/未知方言 → OJ_DB_UNSUPPORTED（e.data.capability === "explain"）。
     * 能力探测：`typeof db.explain === "function"`（版本错位期防 TypeError）。 */
    explain(sql: string, params?: unknown[], opts?: DBCallOpts): Promise<{ plan: PlanNode }>;
    /** U-14（v0.1.109）反向 DDL：结构 diff + 有序可重放 ALTER 集。纯渲染器，零 DB I/O。
     * `{objectType:"table", name, from, to}` → `{diff, statements}`；from = null → CREATE TABLE。
     * 维度字段缺省 = 不参与 diff，空数组 = DROP 全量；执行走 db.exec + allow_ddl。
     * PG 改类型产 USING；MySQL 位置差产 AFTER/FIRST（PG 无列位置 DDL → 忽略）。
     * sqlite/未知方言 → OJ_DB_UNSUPPORTED（e.data.capability === "ddl_diff"）。
     * 能力探测：`typeof db.ddlDiff === "function"`（版本错位期防 TypeError）。 */
    ddlDiff(spec: { objectType: "table"; name: string; from?: Structure | null; to: Structure }): Promise<DdlDiffResult>;
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
    /** 平台序列分配：单语句原子取号，`max+1` 竞态的终态。
     * 首次使用自动建平台表 `_oj_sequences`；返回值 ≤2^53-1 是 number，超出是十进制字符串。 */
    nextSeq(name: string): Promise<number | string>;
    /** 连接引擎名：`"sqlite" | "mysql" | "postgres"`。供 `_shared` 共享模块与
     * 诊断分派方言 SQL；业务 handler 分支方言 = 放弃跨引擎可移植承诺，慎用。 */
    dialect(): "sqlite" | "mysql" | "postgres";
    /** 目录自省：当前库全部业务可见表名（**含未登记 registry 的表**——api-only
     * 方案 / 历史遗留表），按名称排序。可选前缀过滤（%/_ 按字面量匹配，绑定参数）。
     * sqlite 排除 `sqlite_*` 内部表；mysql/pg 经 information_schema 限当前库/schema。
     * 替代「按方言分支 information_schema / sqlite_master」的裸 db.query。 */
    listTables(prefix?: string): Promise<string[]>;
    /** 结构内省：单表的列信息（三方言同构）。
     * `{name, nativeType, nullable, default, primaryKey}[]`，按声明序。
     * `nativeType` 是方言**声明文本**（sqlite `type` / mysql `column_type` / pg `format_type`），
     * 零归一化；`default` 是原始 DDL 文本（sqlite 字符串默认带引号）。表名经绑定参数，
     * 无对应表/不可见 → 空数组（不区分「不存在 / 无权限 / 别的 schema」）。
     * 未知方言抛 `OJ_DB_UNSUPPORTED`（`e.data.capability` 点名 `list_columns`）。 */
    listColumns(table: string): Promise<ColumnInfo[]>;
    /** 结构内省：单表的索引信息（三方言同构）。
     * `{name, unique, primary, origin, columns}[]`，按名再按列序。
     * `origin` ∈ `c`(普通) / `u`(唯一) / `pk`(主键)——三方言统一口径，UI 不再分支。
     * `columns` 为组成该索引的列（已按序聚合）。 */
    listIndexes(table: string): Promise<IndexInfo[]>;
    /** 结构内省：单表的外键信息（三方言同构）。
     * `{name, columns, refTable, refColumns}[]`，按约束名再按列序。
     * sqlite 外键无约束名 → `name` 为 null；复合外键两端**按位配对**（`columns[i]`↔`refColumns[i]`）。 */
    listForeignKeys(table: string): Promise<ForeignKeyInfo[]>;
    /** 目录类内省：新一代信封 `{kind, dialect, items}`（L2 三件
     * 保持裸数组不动）。kind：views / routines / sequences / ddl / comment / constraints /
     * stats；ddl/comment/constraints 吃 `arg`（对象名），其余全库清单。
     * v0.1.109 起 ddl 全量激活：PG 表走拼接器（serial/identity/约束/索引/注释还原，
     * 视图原样 viewdef），MySQL 走 SHOW CREATE TABLE；能力矩阵见 db-guide §6/§10——
     * unsupported 报 `OJ_DB_UNSUPPORTED`（`e.data.capability`），不静默。 */
    catalog(kind: "views" | "routines" | "sequences" | "ddl" | "comment" | "constraints" | "stats", arg?: string):
      Promise<{ kind: string; dialect: string; items: Record<string, unknown>[] }>;
    /** REQ-04（v0.1.105）库/schema 清单：跨方言同构 `{name, owner?, isDefault?, comment?}`。
     * 系统目录由平台统一过滤（mysql 滤 information_schema/mysql/performance_schema/sys；
     * pg schema 滤 pg_catalog/pg_toast%/information_schema；pg database 滤模板库）；
     * 账号级可见性跟随 DB 账号自身权限模型。mysql 上两者同源（schema≡database）；
     * sqlite 给 `database_list` 实际项（main + attached）。 */
    listSchemas(prefix?: string): Promise<SchemaInfo[]>;
    /** REQ-04（v0.1.105）database 清单：同 {@link listSchemas} 字段口径。
     * pg 上由任意库连出集群共享目录（不换连接即可拿到名字）；只出清单不出视图——
     * pg 的 forDatabase 受限视图是 OJ_DB_UNSUPPORTED（capability=for_database，
     * database=独立连接，物理不可行，「一连接=一库」边界成文）。 */
    listDatabases(prefix?: string): Promise<DatabaseInfo[]>;
    /** REQ-04（v0.1.105）§5.2 方案 B：钉住一个 schema/database 的**只读内视受限视图**
     * （listTables/listColumns/listIndexes/listForeignKeys/catalog 五件；无 query/exec/stream）。
     * mysql schema≡database（forDatabase 用同一句柄心智）；pg 限当前 database 的 namespace；
     * sqlite 无 schema 概念 → 各件 OJ_DB_UNSUPPORTED（capability=for_schema）。
     * scope 名只走绑定参数；畸形名 → 空结果（不报错不泄漏）。 */
    forSchema(schema: string): IntrospectScope;
    /** 流式查询：逐行拉取大结果集。给 onRow 返回 Promise<void>；省略则返回
     * AsyncIterable<Row>。opts.signal 触发 abort 即取消（pg/mysql 真取消）；db.tx 内报错；
     * opts.onOpen(executionId) 回调跨请求取消句柄（迭代形式用 it.executionId()）。
     * opts.onProgress({rows, bytes, elapsedMs})：进度回调（v0.1.114，100ms 节流；
     * bytes 为在飞已计量字节）。
     * opts.timeoutMs：语句超时（只能收紧 statement_timeout_ms；pump 全程竞速）；
     * max_result_bytes 触顶——fail 档（缺省）以 OJ_DB_CAPACITY 错行抛错，truncate 档
     * 干净结束且 it.info().truncated=true（it.info() 在迭代结束后仍可读）。 */
    stream(
      sql: string,
      params?: unknown[],
      opts?: {
        onRow?: (row: Row) => void;
        signal?: AbortSignal;
        onOpen?: (executionId: string) => void;
        onProgress?: (ev: DbStreamProgressEvent) => void;
        timeoutMs?: number;
      },
    ): Promise<void> | AsyncIterable<Row> & {
      executionId(): Promise<string>;
      /** 流运行信息（REQ-05 触顶信令）：{rows, bytes, truncated}。 */
      info(): Promise<{ rows: number; bytes: number; truncated: boolean }>;
    };
    /** 任务式导出（U-18，v0.1.104）：同步开游标 + 自驱消费任务，立即返 {taskId}；
     * 产物落 blob（保留前缀 export/），经 db.exportStatus 轮询进度，db.exportCancel 幂等取消。
     * 配额：全局/每主体并发（db_export 段），满则结构化拒；maxBytes 超限 → failed（不静默截断），
     * max_rows 策略截断 → done + truncated + truncatedReason:"max_rows"（错误≠策略双轨）。
     * 重启后旧 taskId 一律 not found；他人 id 不可见（bearer 语义，日志只出前 8 字符）。 */
    export(args: {
      sql: string;
      params?: unknown[];
      format: "csv" | "jsonl";
      fileName?: string;
      maxBytes?: number;
    }): Promise<{ taskId: string }>;
    /** 导出任务状态：{taskId, state:"running"|"done"|"failed"|"cancelled", alias, rows, bytes,
     * truncated, truncatedReason, startedAtMs, finishedAtMs, error, blobKey}。 */
    exportStatus(taskId: string): Promise<{
      taskId: string;
      state: "running" | "done" | "failed" | "cancelled";
      alias: string;
      rows: number;
      bytes: number;
      truncated: boolean;
      truncatedReason: string | null;
      startedAtMs: number;
      finishedAtMs: number | null;
      error: string | null;
      blobKey: string | null;
    }>;
    /** 幂等取消：半成品经 put_stream_abort 清（防 s3 orphan parts）；终态任务 no-op。 */
    exportCancel(taskId: string): Promise<{ cancelled: true }>;
    /** 任务式批量导入（REQ-12，v0.1.115）：立即返 {taskId}；Rust consumer 经
     * blob 源（CSV/JSONL，read_range 流式）或内联 rows 多值 INSERT 分批落库。
     * 守卫：scoped 表在 sql_guard 下结构化拒（capability="import_under_guard"）；
     * Deny+未登记 → 拒（镜像裸 SQL）；replace = truncate 同档（allow_ddl + 危险写确认门）。
     * 配额：全局/每主体并发（db_import 段）+ max_rows（内联登记前拒）+ max_bytes
     * （blob 源中途 failed 点名键）；取消不回退已提交批——但 sqlite append/upsert
     * 走全单事务：cancel/fail 整回滚（rows=0、库空），网络方言才保留已提交批。 */
    import(args: {
      table: string;
      schema?: string;
      /** 与 rows 恰一：blob 源 key（先经既有上传接口落 blob）。 */
      blobKey?: string;
      /** 与 blobKey 恰一：内联小数据集（max_rows 内）。 */
      rows?: Record<string, unknown>[];
      format: "csv" | "jsonl";
      /** 缺省 = csv 表头 / 首行键（BTreeMap 排序序——生产用法请显式给）。 */
      columns?: string[];
      mode?: "append" | "upsert" | "replace";
      /** upsert 必填（PG: ON CONFLICT / MySQL: 需唯一键 / sqlite: 仅 ["rowid"]）。 */
      conflictKeys?: string[];
      /** 实现按方言变量上限/列数（PG/MySQL 65535、sqlite 32766）与 100..=50000 收敛。 */
      batchSize?: number;
      /** csv 首行为表头（默认 true；表头与 columns 不符即参数错误 fail-fast）。 */
      header?: boolean;
      /** skip = 坏行进 samples 行不落库，超 maxErrors 整任务 failed。 */
      onError?: "abort" | "skip";
      maxErrors?: number;
    }): Promise<{ taskId: string }>;
    /** 导入任务状态：{taskId, state:"running"|"done"|"failed"|"cancelled", alias, table,
     * rows（=已提交行数；取消不回退已提交批——sqlite 全单事务特例除外：整回滚 rows=0）,
     * errors（=样本计数）, bytes, samples（≤20，line = 源文件绝对行号，1-based，header 计 1）,
     * startedAtMs, finishedAtMs, error}。 */
    importStatus(taskId: string): Promise<{
      taskId: string;
      state: "running" | "done" | "failed" | "cancelled";
      alias: string;
      table: string;
      rows: number;
      errors: number;
      bytes: number;
      samples?: { line: number; reason: string; raw?: string }[];
      startedAtMs: number;
      finishedAtMs: number | null;
      error: string | null;
    }>;
    /** 幂等取消：批间协作（已提交批保留，未提交批不落库）；终态任务 no-op。 */
    importCancel(taskId: string): Promise<{ cancelled: true }>;
    /** SQL 执行追踪（dev 默认开）：本请求累计画像；同一请求内调用，
     * 跨请求重置。追踪关闭返回空对象 {}。 */
    sqlProfile(): SqlProfile;
    /** 访问控制自省：只列当前主体有权限访问的库 + 各库能力位。
     * `db_access:` 段未配置时全部库都在列表里（默认 enforce: off = 不设防）。 */
    allowed(): DbAllowedEntry[];
    /** 匿名请求声明租户：租户条件仍强制注入，只是身份由 handler 给。三道门禁
     * （config 开关 / 匿名请求 / id 非空）缺一即抛；请求级且只能调一次。
     * 红线：id 必须服务端派生，**绝不可**取请求参数。 */
    asTenant(id: string): DBInstance;
    // 事务：回调 resolve 提交 / throw 回滚再抛；tx.query/exec/table 同签名走同一连接。
    // 每请求至多一个活跃事务（嵌套报错）；请求结束未完结自动回滚。
    // 回调参数**不含 tx 自身**（嵌套事务直接被拒，故类型上也拿不到——见 TxInstance）。
    tx(fn: (tx: TxInstance) => unknown): Promise<unknown>;
    /** 跨请求事务会话：begin() 拿 id，attach(id) 后本请求全落同一连接/事务。
     * 默认关闭（db_session.enabled + allow 才可用）。红线：id 是 **bearer 凭据**（不回显、
     * 不写日志）；会话只锁一个别名，内禁事务控制/SET/USE/PRAGMA（MySQL 隐式提交 ⇒ 假回滚）；
     * 与 db.tx 互斥；无 db.stream；host 管生命周期，**没有自动提交**。 */
    session: DBSessionApi;
    /** 跨请求取消执行：按 executionId 取消在飞执行（v0.1.114 起覆盖流式 + 池执行）。
     * id 来自 db.stream 的 onOpen/executionId()，或 db.query/db.exec 的 opts.onOpen
     * （exec_… 形状）。幂等；未知/他人 id 一律 not found（不泄露存在性）。
     * 池执行取消 = pg_cancel_backend / KILL QUERY 真杀（被取消的连接报废不回池）；
     * sqlite 无服务端语句 = 客户端早停。id 是 bearer 凭据：日志只出前 8 字符。 */
    cancel(executionId: string): Promise<{ cancelled: boolean; alias: string }>;
    /** 动态数据源登记（client 轴）：运行期把 DSN 登记为命名数据源。
     * 登记后别名进 `DB(name)` 解析路径（复用 L1 访问控制 + L2 内省 + 全 query/exec/stream）；
     * 此处只暴露**管理面**，使用面一律走 `DB(name)`。`delete` 自动驱逐 `DB()` 缓存，
     * 否则删后再 `DB(name)` 拿到陈旧实例。 */
    client: DBClientApi;
    /** 运行期动态授权（U-1，db_access 注入「allow」维度；特权面，fail-closed 同 client）。 */
    access: DBAccessApi;
    /** host 权威代际计数（U-3）：别名被删除/重登即递增——handler 据此感知跨 isolate 失效。 */
    epoch(name: string): number;
  }

  /** db.query/db.exec 的每调用侧选项（REQ-05；v0.1.114 扩回调面）。 */
  interface DBCallOpts {
    /** 语句级超时毫秒：只能收紧配置上限，传更大值以 OJ_DB_CAPACITY 拒（点名 statement_timeout_ms）。 */
    timeoutMs?: number;
    /** REQ-11（v0.1.114）：开执行即回调 `exec_…` 执行 id——同 db.stream 的 onOpen，
     * 可存 kv 后由同主体任意请求 db.cancel 取消本执行（池执行取消 = pg_cancel_backend /
     * KILL QUERY 真杀；sqlite 客户端早停）。带 onOpen/onProgress 即走 begin/poll/take
     * 登记模型。onOpen 抛异常只记 warn，不杀执行。 */
    onOpen?: (executionId: string) => void;
    /** REQ-11（v0.1.114）：进度回调 `{phase, elapsedMs, rows?}`——相位 sent（语句已下推）
     * → fetching（首批行回）→ done（恒发一次，必含行数/受影响数）。同相位 100ms 节流。 */
    onProgress?: (ev: DbProgressEvent) => void;
  }

  /** db.query/db.exec 的 onProgress 事件（REQ-11，v0.1.114）。 */
  interface DbProgressEvent {
    /** 执行相位：sent（语句已下推）/ fetching（行回流中）/ done（恒发一次）。 */
    phase: string;
    /** 自执行开始的毫秒数。 */
    elapsedMs: number;
    /** 已回流行数（query）或受影响行数（exec，done 相位）；sent/fetching 相位可能缺省。 */
    rows?: number;
  }

  /** db.stream 的 onProgress 事件（REQ-11 G3，v0.1.114）：bytes 为在飞已计量字节。 */
  interface DbStreamProgressEvent {
    rows: number;
    bytes: number;
    elapsedMs: number;
  }

  /** 运行期动态授权面（`db.access`，U-1）。grant 至少一个维度非空（空 allow = 授权给所有人，拒）。 */
  interface DBAccessApi {
    grant(
      alias: string,
      allow: { roles?: string[]; users?: string[]; tenants?: string[]; modules?: string[] },
      opts?: Record<string, unknown>,
    ): Promise<unknown>;
    revoke(alias: string): Promise<unknown>;
  }

  /** 动态登记数据源的逐别名记账条目（`db.client.list()` 的元素）。 */
  interface ClientDbEntry {
    /** 登记别名。 */
    alias: string;
    /** 连接引擎名：`"sqlite" | "mysql" | "postgres"`。 */
    dialect: string;
    /** 脱敏 DSN（`user:pass@` → `***`；host/库名保留排障）。 */
    dsn: string;
    /** 登记操作者（`user.id`；无身份 null）。 */
    registeredBy: string | null;
    /** 登记时刻（Unix 毫秒）。 */
    registeredAtMs: number;
    /** server 版本串（探测失败/开放方言 null——降级不阻断登记）。 */
    serverVersion: string | null;
    /** 探测时刻（Unix 毫秒；未探测 0）。 */
    probedAtMs: number;
    /** 命中计数（query/exec/stream/内省经 `lookup` 自动累加）。 */
    queries: number;
  }

  /** 跨请求事务会话（`db.session`）。配置段 `db_session:`（`enabled` 默认 false）。 */
  interface DBSessionApi {
    /** 开会话（`DB(name)` 上调用；默认 `default`）→ 摘要（含 id / 有效期）。
     * 缺身份（无 `user.id` 且无 tenant）时被 `require_identity` 拒。
     * `opts.readOnly`：只读会话位——begin 时定死、不可变；该会话上
     * Write/DDL 在 op 层一律拒（直发 op 也拦得住），错误 `e.sessionDisposition === "keep"`。 */
    begin(opts?: { readOnly?: boolean }): Promise<DbSessionSummary>;
    /** 把会话绑到**本请求**：之后 `db.query`/`db.exec`/`db.table()`/`nextSeq`/`listTables`
     * 全走该连接。一个请求只能绑一个会话、一个别名；已存在请求内 `db.tx` 时拒绝。 */
    attach(id: string): Promise<boolean>;
    /** 解除本请求的绑定（会话本身仍在）。 */
    detach(): Promise<boolean>;
    /** 不绑定也可逐语句执行（同 `db.tx` 内的 tx 句柄语义）。 */
    query(id: string, sql: string, params?: unknown[]): Promise<Row[]>;
    exec(id: string, sql: string, params?: unknown[]): Promise<number>;
    /** 提交；超时（5s）时文案明示 outcome UNCERTAIN。失败也摘表，不允许续用。 */
    commit(id: string): Promise<boolean>;
    /** 回滚并销毁。 */
    rollback(id: string): Promise<boolean>;
    /** 幂等收尾（`finally` 用）：best-effort 回滚；失败不外抛。 */
    close(id: string): Promise<boolean>;
    /** 只推空闲计时（长表单续期），**不**延长 `max_lifetime_secs`。 */
    touch(id: string): Promise<{ expiresInMs: number }>;
    /** 关掉**本主体**全部会话（登出用）→ 关闭数量。 */
    closeAll(): Promise<number>;
    /** 本主体的活跃会话摘要（绝不列他人）。 */
    list(): Promise<DbSessionSummary[]>;
    /** 单条摘要；已结束的会话给「死法 + 原因」诊断（他人/未知 id 与 not found 同文案）。 */
    info(id: string): Promise<DbSessionSummary>;
    /** 运维观察面：只统计**本主体**的活跃数与全局回收计数。 */
    stats(): Promise<DbSessionStats>;
  }

  /** 会话摘要（`db.session.begin/info/list` 的元素）。 */
  interface DbSessionSummary {
    /** `tx_<4hex boot>_<32hex>`。**bearer 凭据**：日志/报错只应出现前缀。 */
    id: string;
    /** 物理别名（判权权威；会话只锁这个别名）。 */
    alias: string;
    dialect: string;
    /** `open` = 活跃（死掉的会话不会出现在返回值里，而是以错误 + 墓碑诊断给出）。 */
    state: "open" | "discarded";
    ageMs: number;
    idleMs: number;
    /** 距被判死还有多久（空闲/总寿命取小）；0 = 已到期。 */
    expiresInMs: number;
    /** 已执行语句数。 */
    ops: number;
    /** 建会话的 `user.id`（匿名 null）。 */
    createdBy: string | null;
    /** 只读会话位：true = 该会话 Write/Ddl 在 op 层被拒。 */
    readOnly: boolean;
  }

  /** `db.session.stats()` 的返回。 */
  interface DbSessionStats {
    enabled: boolean;
    /** 本主体当前活跃会话数。 */
    active: number;
    maxSessions: number;
    maxPerOwner: number;
    idleTimeoutSecs: number;
    maxLifetimeSecs: number;
    /** 超时回收计数。 */
    timedOut: number;
    /** 判死/丢弃计数（别名变更、寿命耗尽）。 */
    discarded: number;
    /** 因容量上限被拒的开会话请求数。 */
    rejected: number;
    /** 进程启动标记（id 前缀里那 4 个 hex 的来源）。 */
    boot: string;
  }

  /** 动态数据源登记管理面（`db.client`）。配置段 `db_client:`（`enabled` 默认 false）。 */
  interface DBClientApi {
    /** 登记一个 DSN 为命名数据源；返回记账条目。重名 / 超 `max_entries` 抛错。 */
    register(name: string, dsn: string): Promise<ClientDbEntry>;
    /** 试连（不落库）；返回 `{ok, dialect?, error?}`。 */
    test(dsn: string): Promise<{ ok: boolean; dialect?: string; error?: string; serverVersion?: string | null; probedAtMs?: number }>;
    /** 替换已登记连接（不存在则抛错）。 */
    reRegister(name: string, dsn: string): Promise<ClientDbEntry>;
    /** 删除数据源；自动驱逐 `DB()` 缓存；返回是否删除成功。 */
    delete(name: string): Promise<boolean>;
    /** 列出全部已登记数据源（dsn 已脱敏）。 */
    list(): Promise<ClientDbEntry[]>;
    /** 是否已登记（同步；探活用，不经过登记门）。 */
    has(name: string): boolean;
  }

  /** 一条安全审计事件（`audit.query()` 的元素）。零凭据：只有 alias/动作/前缀 id。 */
  interface AuditEntry {
    /** 事件时刻（Unix 毫秒）。 */
    tsMs: number;
    /** 事件族：`DB_CLIENT_AUDIT` / `DB_CLIENT_DENY` / `DB_ACCESS_AUDIT` / `DB_SESSION_*`。 */
    kind: string;
    /** 操作者（`user.id`；无身份 null）。 */
    user: string | null;
    tenant: string | null;
    module: string | null;
    /** 请求来源：`http` / `task`。 */
    source: string;
    /** 库别名。 */
    alias: string;
    /** 动作与原因（如 `action=register dialect=mysql`、`id=tx_ab12_… reason=idle_timeout`）。 */
    detail: string;
  }

  /** 一个已登记管理面 connector（`mgmt.list()` 的元素，U-15）。 */
  interface MgmtEntry {
    /** connector 名（= 收编的泛型轴名）。 */
    connector: string;
    /** 脱敏连接串（`user:pass@` → `***`）。 */
    dsn: string;
    /** 登记操作者（`user.id`；无身份 null）。 */
    registeredBy: string | null;
    /** 登记时刻（Unix 毫秒）。 */
    registeredAtMs: number;
    /** 插件 `__ops__` 自报的 op 清单（readOnly 位以插件文档为准——宿主不可验证，仅用于预判分档门）。 */
    ops: Array<{ name: string; readOnly: boolean }>;
  }

  /**
   * 安全审计检索（`audit:` 段）。统一出口：`DB_CLIENT_*` / `DB_ACCESS_AUDIT` /
   * `DB_SESSION_*` 全部落此。进程内有界环形缓冲（缺省 2000 条 / 24h，双限自动清理），
   * **不跨重启**；读门 = `audit.allow`（每调用重判）。`query` 即导出通道。
   * filter 各维可选：kind / user / tenant / alias / sinceMs / untilMs / limit（缺省 100，硬顶 1000）。
   * 返回最新在前。
   */
  const audit: {
    query(filter?: {
      kind?: string;
      user?: string;
      tenant?: string;
      alias?: string;
      sinceMs?: number;
      untilMs?: number;
      limit?: number;
    }): Promise<AuditEntry[]>;
  };

  /**
   * 管理面 connector（`mgmt:` 段；enabled 缺省 false）。特权面：connector 占用的
   * 泛型轴**不进** `axis()` 公开面；register/delete/非只读 call 走 `mgmt.allow`，只读 call
   * 与 list 走 `mgmt.allow_read`（缺省复用 allow）；每动作落 `MGMT_AUDIT`/`MGMT_DENY` 审计
   * （全字段零凭据）。未声明 op → 结构化 `OJ_DB_UNSUPPORTED`（`e.data.capability` = op 名）。
   */
  const mgmt: {
    /** 登记（探 `__ops__` + `__connect__` + ping，失败即拒）。 */
    register(name: string, dsn: string): Promise<MgmtEntry>;
    /** 删除（尽力 `__disconnect__` 后摘表；幂等）。 */
    delete(name: string): Promise<boolean>;
    /** 清单（读档）。 */
    list(): Promise<MgmtEntry[]>;
    /** 探活（未启用/未登记 = false）。 */
    has(name: string): boolean;
    /** 管理调用（args 必须是 JSON object；`__handle` 由宿主注入）。 */
    call(name: string, op: string, args?: Record<string, unknown>): Promise<unknown>;
  };

  /**
   * 运行期凭据轴。与 config `ENC[...]` 同一套 X25519 + AES-256-GCM 信封：
   * `seal` 用部署公钥（`secrets.public_key_path`，缺省由私钥推导）加密；`open` 需部署私钥，
   * 每次落 `SECRET_OPEN` 审计（零凭据）。装配无密钥 → 两者都抛
   * `secret axis not configured`（fail-closed）；只有公钥（seal-only）→ `open` 抛
   * `no private key`。私钥永不出 Rust 边界。同一明文两次 seal 密文不同（临时密钥随机化）。
   */
  const secret: {
    /** 加密为 `ENC[...]` 密文（可存自有表/回传前端；解密只能靠部署私钥）。 */
    seal(plaintext: string): string;
    /** 解开 `secret.seal`（或 `oj secret seal`）产出的 `ENC[...]`。 */
    open(token: string): string;
  };

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
  // 外部命令执行（platform.exec 段授权；见 ExecApi JSDoc 与 api-manual §6「exec」）。
  const exec: ExecApi;
  // YAML 读写原语（无特权；见 YamlApi JSDoc 与 api-manual §6「yaml」）。
  const yaml: YamlApi;
  // server.*：平台级控制（platform 特权；见 ServerApi JSDoc 与 api-manual §6「server」）。
  const server: ServerApi;
  const bus: BusApi;
  const es: EsApi;
  // 默认 profile（"default"）的 mail 实例；其它 profile 用 new Mail("name")。
  const mail: MailApi;
  const Mail: Mail;

  // 命名数据库实例；未配置的名字返回 undefined。
  function DB(name: string): DBInstance | undefined;
  // 默认（"default"）数据库实例。
  const db: DBInstance;
  const cert: CertApi;
  const jwt: JwtApi;
  const oidc: OidcApi;
  // sso.*：HTTP 表单 / CAS SSO 提供者注册表（见 SsoApi 前导；api-manual §sso）。
  const sso: SsoApi;
  const bcrypt: BcryptApi;
  // 部署期常量（config `vars:` 段；未声明的键恒 null）。
  const vars: VarsApi;

  // ---- 大整数：|v| > 2^53-1 的 i64 读出为十进制字符串；写回用 toBigInt()（详见
  // docs/numeric-limits.md）。转换全部 fail-loud，不静默取近似。----
  /** 十进制整数字符串 | 安全范围内的 number | bigint → bigint（精确 64 位，范围 [-2^63, 2^63-1]）。 */
  function toBigInt(v: string | number | bigint): bigint;
  /** 同上但为**无符号** 64 位 `[0, 2^64-1]`：只有 MySQL `BIGINT UNSIGNED` 列能承载，
   * PG / SQLite 传本值会**明确报错**（它们的 bigint 就是 i64）。 */
  function toUBigInt(v: string | number | bigint): bigint;
  /** number | 数字串（含科学计数法）| bigint → number（f64，**显式接受精度丢失**）。 */
  function toDouble(v: string | number | bigint): number;

  // crypto 增补（bootstrap 对 crypto 做 Object.assign 合并；getRandomValues 是 oj
  // 实现——原生不存在，lib.dom 的同名声明只是兜底）。
  interface Crypto {
    /** string 走 UTF-8 摘要；Uint8Array / ArrayBuffer 走原始字节摘要（非 UTF-8 字节安全）。 */
    sha256Hex(data: string | Uint8Array | ArrayBuffer): string;
    /** MD5 十六进制摘要。**MD5 已密码学破损，仅限非安全场景（缓存键/etag/旧系统兼容），
     * 不得用于凭据/签名/完整性校验。** 入参分流同 sha256Hex：string 走 UTF-8；
     * Uint8Array / ArrayBuffer 走原始字节摘要（非 UTF-8 字节安全）；其余抛 TypeError。 */
    md5Hex(data: string | Uint8Array | ArrayBuffer): string;
    /** nBytes 字节随机数的 hex（默认 32 字节）。 */
    randomHex(nBytes?: number): string;
    /** 任意 TypedArray view 填充随机字节后返回原 view；非 view 抛 TypeError；
     * 单次 ≤65536 字节（对齐 WebCrypto）。 */
    getRandomValues<T extends ArrayBufferView>(view: T): T;
    // AES-GCM 应用级加密：key 为 hex/base64 编码的原始 16/32 字节
    // （按长度选 Aes128/256；aes-gcm 0.10 不含 AES-192），来自 vars.get(...)；明文 utf8 进，
    // base64(nonce12 ‖ ct ‖ tag16) 出。密钥缺失/非法由调用方 json.fail。
    aesGcmEncrypt(plaintext: string, key: string): string;
    aesGcmDecrypt(ciphertext: string, key: string): string;
    /** Ed25519 验签：publicKey 为 hex/base64 编码的 **32 字节原始公钥**（不支持 PEM/SPKI）；
     * msg 为 UTF-8 字符串；sigBase64 仅 base64（STANDARD/NO_PAD，不支持 base64url）。
     * 验签通过返回 true，签名/密钥不匹配返回 false；格式错（公钥 ≠ 32 字节、
     * sig 解码后 ≠ 64 字节、base64 非法）抛错。 */
    verifyEd25519(publicKey: string, msg: string, sigBase64: string): boolean;
  }

  // ---- oj test L1 测试 SDK（仅测试文件）：进程内派发，真实路由/运行时/后端，零 TCP ----
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
  // WS 帧测试面：path 形如 "/echo-bin/ws"（相对 base）。
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
  // fetch 返回的 Response（浏览器风格子集）。在 declare global 内：业务代码要能
  // **点名**它（如 `let r: OjFetchResponse`，try/catch 两段赋值场景）；放模块作用域
  // 会 TS2304，误标 DOM 的 Response 则 TS2740（缺 redirected/type/url 等）。
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
  // 浏览器兼容的 fetch（url 必填，options 同 RequestInit 的常用子集）。
  function fetch(url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | null;
  }): Promise<OjFetchResponse>;
  // 已加载插件自省：[{name, semver, abi_version, fingerprint, host_abi_version}]。
  function plugins(): any[];
  // 泛型插件轴调用面：axis("cache").get("k")——任意方法名 = 该轴的一个 op，
  // 参数位置传、末位对象 = opts（轴自定义）。未知轴抛错并列出可用轴名。
  function axis(name: string): any;
  // 装配期固化诊断（与 `oj info` CLI 同源，同步无 IO）：build/abi/plugins/
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

// ======== 九、MQ 客户端类型（Kafka / RabbitMQ 返回） ========

interface OjMqMessage {
  topic: string;
  partition?: number;
  offset?: number;
  key?: string;
  value: any;
  // 非 UTF-8 载荷时 value 为 null，value_b64 为 base64 字符串；生产侧传
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

// 导入别名 `#x` / `#/m/x` 是模块相对的，tsconfig paths 只能枚举已存在目录；静态定位不到的
// 别名由 `types/oj-modules.d.ts`（ambient `declare module "#*"`）兜底为 any 而非 TS2307。
// 运行时由 oj loader 解析，两份声明只影响编辑器 / tsc。

export {}
