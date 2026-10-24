/**
 * API 端点 base（ky `prefix`）的唯一取值口。
 *
 * 优先级：`window.__OJ_API_BASE__`（部署期 `ojm build` 按 `web.config.ts` 的
 * `apiBase` 注入，见 cli 的 site-base.ts）> `import.meta.env.VITE_API_BASE_URL`
 * （构建期默认 `/api`）。
 *
 * 为什么与 `site-base.ts` 分开：API 前缀与站点部署位置**正交**——站点可挂
 * `/oj` 而 API 恒在根 `/api`（oj mounts 分条挂载，本仓 config.yaml 即此形态），
 * 也可能在网关侧整体换前缀。部署期改前缀不该重编 runtime，故走与 siteBase
 * 相同的「注入全局 > 构建期默认」两级取值；端点一律**相对**（无前导 `/`），
 * 由 ky 拼接（v2 的 `prefix` 自剥尾斜杠，并原生支持绝对域）。
 *
 * 契约：返回值归一为**不以 `/` 结尾**（`${base}/upload` 这类拼接确定）；
 * 空值回落构建期默认 `/api`。
 */

/** 宿主注入的全局形状：`<script nonce>window.__OJ_API_BASE__ = "/gw";</script>` */
interface OjApiBaseGlobal {
	__OJ_API_BASE__?: string
}

const DEFAULT_API_BASE = "/api";

/** 归一为不以 `/` 结尾；绝对域（http(s)://）原样剥尾斜杠；空值回落默认 */
export function normalizeApiBase(raw: string | null | undefined): string {
	const trimmed = raw?.trim();
	if (!trimmed)
		return DEFAULT_API_BASE;
	return trimmed.replace(/\/+$/, "") || DEFAULT_API_BASE;
}

/**
 * 当前 API 端点 base（ky `prefix`，恒不以 `/` 结尾）。
 *
 * 每次调用都重新读取——不做模块级缓存（与 `resolveSiteBase()` 同理：
 * 测试需要在不重启模块的情况下模拟不同部署）。
 */
export function resolveApiBase(): string {
	const injected = (globalThis as OjApiBaseGlobal).__OJ_API_BASE__;
	if (typeof injected === "string")
		return normalizeApiBase(injected);
	return normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
}
