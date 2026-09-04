/* eslint-disable */
// .route 声明的 TS 支持（编辑器不报错；dev server 不依赖此文件运行）。
//
// 下面为 src/bridge/bootstrap.js 在运行时注入的全局对象提供类型声明，
// 使 sample/src 中的业务代码在编辑器内不报 TS 错误。

// JSON 反序列化后可能出现的值（SQL 行 / KV / fetch body 等）。
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// 数据库查询返回的一行（列名 -> 值）。
type Row = Record<string, Json>;

// db.table(...).where(cond) 的单个条件。
interface WhereCond {
  field: string;
  op?: string; // eq/neq/gt/gte/lt/lte/like/in/... 依服务端支持
  value?: unknown;
  and?: WhereCond[];
  or?: WhereCond[];
}

// db.table(...).orderBy(items) 的单个排序项。
interface OrderByItem {
  field: string;
  dir?: "asc" | "desc" | null;
}

// db.table(name) 返回的安全查询构造器（流式、结构化）。
interface QueryBuilder {
  select(cols?: string[]): QueryBuilder;
  where(cond: WhereCond): QueryBuilder;
  orderBy(items?: OrderByItem[]): QueryBuilder;
  limit(n: number): QueryBuilder;
  offset(n: number): QueryBuilder;
  all(): Promise<Json[]>;
}

// DB(name) 返回的命名数据库实例。
interface DBInstance {
  // 原始 SQL + 绑定参数（params 可选）。返回行数组。
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  // 执行写操作，返回受影响行数。
  exec(sql: string, params?: unknown[]): Promise<number>;
  // 安全查询构造器（标识符白名单 + 参数化值）。
  table(name: string): QueryBuilder;
  // 事务：回调 resolve 提交 / throw 回滚再抛；tx.query/exec/table 同签名走同一连接。
  // 每请求至多一个活跃事务（嵌套报错）；请求结束未完结自动回滚。
  tx(fn: (tx: DBInstance) => unknown): Promise<unknown>;
}

// json.* ：统一响应信封 + 响应头。
interface JsonApi {
  ok(data?: unknown): void;
  fail(code: number, msg: string, data?: unknown): void;
  header(name: string, value: string): void;
}

// http.* ：当前请求上下文（只读，懒加载，per-request 最新）。
interface HttpApi {
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
  // 取路由参数或 query 参数：路径参数优先，query 兜底，均缺失返回 def 原值。
  param(name: string, def?: unknown): any;
  // 租户 id（tenant 启用时从租户头提取；未启用为 null）。
  tenantId: string | null;
  // 已验签用户（auth 启用且通过 Bearer 守卫；否则 null）。
  user: AuthUser | null;
  // multipart 上传文件元信息（非 multipart 为空数组）。
  files: UploadedFileMeta[];
  // 取第 i 个上传文件的字节（越界报错 no such file）。
  file(i: number): Promise<Uint8Array>;
}

// 已验签用户（JWT claims）。
interface AuthUser {
  id: string | number;
  roles: string[];
  claims: Record<string, Json>;
}

// multipart 上传文件元信息。
interface UploadedFileMeta {
  field: string;
  filename: string;
  content_type: string;
  size: number;
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

// ws.* ：WebSocket 帧循环控制。
interface WSApi {
  send(data: string): void;
  close(): void;
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
  // local 缺失 sidecar 且无法按扩展名推断时返回空串；s3 无 Content-Type 时返回 null。
  contentType(key: string): Promise<string | null>;
}

// bus.* ：主题广播。publish 广播给订阅 topic 的全部 WS 会话，返回接收方数；
// subscribe 仅 WS 会话内可用（HTTP 路径报错）；kind 报告活跃 broker 类型。
interface BusApi {
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
  const blob: BlobApi;
  const bus: BusApi;
  const es: EsApi;

  // 命名数据库实例；未配置的名字返回 undefined。
  function DB(name: string): DBInstance | undefined;
  // 默认（"default"）数据库实例。
  const db: DBInstance;
  const cert: CertApi;

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
  interface Client {
    get(path: string, opts?: ClientOptions): Promise<ClientResp>;
    post(path: string, opts?: ClientOptions): Promise<ClientResp>;
    put(path: string, opts?: ClientOptions): Promise<ClientResp>;
    del(path: string, opts?: ClientOptions): Promise<ClientResp>;
    patch(path: string, opts?: ClientOptions): Promise<ClientResp>;
    head(path: string, opts?: ClientOptions): Promise<ClientResp>;
    options(path: string, opts?: ClientOptions): Promise<ClientResp>;
    // 登录助手：POST /auth/login → 返回 access_token（失败抛错）。
    login(username: string, password: string): Promise<string>;
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
}

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
