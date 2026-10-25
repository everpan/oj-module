/**
 * `ojm market setup`（T5）：把 `framework.market_cdn_url` 指向本地模拟 CDN。
 *
 * 2026-10-23 起**非必需**：脚手架 seed 的缺省值即相对路径 `/cdn`（本站点自供，
 * dev 形态 ojm 已把 /cdn 反代给 oj 子进程），新工程免 setup。本命令只剩一个场景：
 * 指向**外部真 CDN**（或本地但要写绝对地址）时显式改写设置。
 *
 * 两件容易踩的事都收在这一处：
 * 1. **地址必须是绝对的**，且端口来自 config 的 `server.port`——写给外部访问方的地址，
 *    相对路径对浏览器/服务端消费另有按请求源补全的口径（market/api.ts withSiteOrigin）。
 * 2. **首跑凭据悬挂**：seed admin `must_change=1`，登录拿的是限权 token，写不了 system 设置；
 *    须先 `PUT /api/auth/password` 改密换全权 token（该端点是悬挂期唯一可用写端）。
 */

import { randomBytes } from "node:crypto";
import process from "node:process";

import { resolveSite } from "../site";
import { resolveCdnLayout } from "./cdn-layout";

export const MARKET_CDN_URL_SETTING = "framework.market_cdn_url";

export interface SetupOptions {
	projectRoot?: string
	/** 站点地址（缺省取 OJM_SITE_URL 或 http://127.0.0.1:9778） */
	siteUrl?: string
	user?: string
	pass?: string
	/** 新口令；不给则随机生成并只在终端打印一次（不落盘、不进日志） */
	newPass?: string
	/** 测试注入；缺省全局 fetch */
	fetchFn?: typeof fetch
}

export interface SetupResult {
	siteUrl: string
	cdnBaseUrl: string
	/** 是否走了改密闭环（must_change 悬挂期） */
	changedPassword: boolean
	/** 随机生成的新口令（仅当未显式给 newPass 时才有值） */
	generatedPassword?: string
}

export async function setupMarketUrl(opts: SetupOptions = {}): Promise<SetupResult> {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const layout = resolveCdnLayout(projectRoot);
	const site = resolveSite({ siteUrl: opts.siteUrl, user: opts.user, pass: opts.pass });
	const fetchFn = opts.fetchFn ?? fetch;

	const token = await obtainToken(fetchFn, site.base, site.user, site.pass, opts.newPass, projectRoot);

	await putSetting(fetchFn, site.base, token.value, MARKET_CDN_URL_SETTING, layout.baseUrl);
	console.log(`[ojm] 市场地址已设置：${layout.baseUrl}`);
	console.log(`[ojm] 市场页刷新后即可看到 ${pathOf(layout.dir)} 里的方案卡片`);
	return {
		siteUrl: site.base,
		cdnBaseUrl: layout.baseUrl,
		changedPassword: token.changedPassword,
		generatedPassword: token.generatedPassword,
	};
}

/**
 * setup 后用于登录的口令：改密闭环走了才用 newPass，否则原口令。
 * 当前 seed must_change=0（账号名=角色名口径）时 setup 不改密，恒用 newPass 会 401。
 */
export function loginPasswordAfterSetup(result: SetupResult, newPass: string, originalPass: string): string {
	return result.changedPassword ? newPass : originalPass;
}

/** 登录并在必要时走改密闭环，返回可用 token */
async function obtainToken(fetchFn: typeof fetch, base: string, user: string, pass: string, newPass: string | undefined, projectRoot: string): Promise<{ value: string, changedPassword: boolean, generatedPassword?: string }> {
	let login: { access_token?: string, restricted?: boolean };
	try {
		login = await postJson(fetchFn, `${base}/api/auth/login`, { username: user, password: pass });
	}
	catch (error) {
		throw new Error(
			`[ojm] 连不上站点 ${base}：${(error as Error).message}\n`
			+ "下一步：先起站点（ojm dev），再跑本命令。",
		);
	}
	const token = String(login.access_token ?? "");
	if (token === "")
		throw new Error("[ojm] 登录响应缺 access_token——核对站点版本与账号");
	if (login.restricted !== true)
		return { value: token, changedPassword: false };

	// must_change 悬挂期：限权 token 写不了 system 设置，先改密换全权 token
	const next = newPass ?? randomBytes(9).toString("base64url");
	const bundle = await putJson(fetchFn, `${base}/api/auth/password`, token, { old_password: pass, new_password: next });
	const full = String(bundle.access_token ?? "");
	if (full === "") {
		throw new Error(
			"[ojm] 改密后未取得全权 token——账号仍处于 must_change 悬挂期。\n"
			+ "下一步：用浏览器登录一次完成改密，或换一个已完成改密的超管账号重试。",
		);
	}
	console.log(`[ojm] 账号处于首次改密期，已改密并换取全权 token（新口令：${newPass === undefined ? next : "<由 --new-pass 指定>"}）`);
	if (newPass === undefined)
		console.log("[ojm] 该口令仅此一次显示，不入日志不入盘——请自行留存");
	void projectRoot;
	return { value: full, changedPassword: true, generatedPassword: newPass === undefined ? next : undefined };
}

async function putSetting(fetchFn: typeof fetch, base: string, token: string, key: string, value: string): Promise<void> {
	try {
		await putJson(fetchFn, `${base}/api/system/settings`, token, { key, value });
	}
	catch (error) {
		const message = (error as Error).message;
		throw new Error(
			`[ojm] 写入系统设置 ${key} 失败：${message}\n`
			+ "下一步：确认账号是系统管理员（非仅超管模块权限），或用浏览器在「系统设置」里手动填写同一地址。",
		);
	}
}

async function postJson(fetchFn: typeof fetch, url: string, body: unknown): Promise<Record<string, unknown>> {
	const res = await fetchFn(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return (await unwrap(res)) as Record<string, unknown>;
}

async function putJson(fetchFn: typeof fetch, url: string, token: string, body: unknown): Promise<Record<string, unknown>> {
	const res = await fetchFn(url, {
		method: "PUT",
		headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
		body: JSON.stringify(body),
	});
	return (await unwrap(res)) as Record<string, unknown>;
}

/** oj 信封解包（{code,msg,data}，code=0 为成） */
async function unwrap(res: Response): Promise<unknown> {
	const text = await res.text();
	let env: { code?: number, msg?: string, data?: unknown } | null = null;
	try {
		env = JSON.parse(text) as { code?: number, msg?: string, data?: unknown };
	}
	catch {
		throw new Error(`[ojm] 站点响应不可解析（HTTP ${res.status}）：${text.slice(0, 200)}`);
	}
	if (env === null || typeof env.code !== "number")
		throw new Error(`[ojm] 站点响应缺 code 字段：${text.slice(0, 200)}`);
	if (env.code !== 0)
		throw new Error(`code=${env.code}：${env.msg ?? "未知错误"}`);
	return env.data;
}

function pathOf(dir: string): string {
	return dir;
}
