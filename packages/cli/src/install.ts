import type { TaskRecord } from "./site";
// ojm install（P1-13，D6）：方案包安装瘦客户端。目标两种形态：
//   · 本地 tgz 路径（<name>-<version>.tgz 文件名推导身份，--name/--version 可覆盖）→ file 源 multipart 上传；
//   · name[@version] → cdn 源（站点侧 Form B 索引解析，安装器不拼 URL——市场侧职责，api.ts 同纪律）。
// 流程：登录 → POST /api/_platform/market/install → 轮询 task?id= 至终态 → 渲染。
// 终态渲染（契约附录 A 同表取用，R28/DRY）：失败/partial 打 error.reason + retryable 标注 +
// hintKey 对应双语指引（--locale zh-CN|en-US，缺省 zh-CN；文案真源为契约附录 A 表）。
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { UsageError } from "./exit-codes";
import { originOf, resolveRegistrySource } from "./registry-source";
import { callApi, isFutureSchema, login, pollTask, resolveSite, TASK_SCHEMA_VERSION_KNOWN, tenantHeaders, unwrapEnvelope } from "./site";

/**
 * REG-R5 / S5-2②：安装目标的**唯一**归一点（grep 可证——全仓只有这一处把 `@scope/name`
 * 换算成物理名 slug）。服务端 install 只认 slug（收到 `@`/`/` 即 400 `invalid_physical_name`），
 * 所以「目录键 → 物理名」的换算必须只在 CLI 完成一次，绝不分层；服务端是最后一道闸。
 *
 * 形态：`@scope/name[@version]` / `scope/name[@version]` → slug=`scope-name`；裸 `slug[@version]`
 * 视为已是物理名，原样透传。字符集与下游 `naming.ts` 的 `SEGMENT_RE`/`SLUG_RE` 同口径
 * （小写字母开头 + 小写字母/数字/连字符，slug 上限 64），保证 CLI 推导的 slug 与发布侧落盘名逐字一致。
 */
const SEGMENT_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function parseRegistryTarget(raw: string): { slug: string, version: string | null } {
	let rest = String(raw ?? "").trim().replace(/^@/, "");
	if (rest === "")
		throw new UsageError(`[ojm] 非法安装目标：「${raw}」（registry 源用法：ojm install @<scope>/<name>[@version] --registry <url>）`);
	// 版本：尾随 @（与 scope 前缀的 @ 不冲突——先剥掉前缀 @ 再取 lastIndexOf）
	let version: string | null = null;
	const at = rest.lastIndexOf("@");
	if (at > 0) {
		version = rest.slice(at + 1);
		rest = rest.slice(0, at);
	}
	if (rest.includes("/")) {
		const slash = rest.indexOf("/");
		const scope = rest.slice(0, slash);
		const name = rest.slice(slash + 1);
		if (!SEGMENT_RE.test(scope) || !SEGMENT_RE.test(name))
			throw new UsageError(`[ojm] 目录键「${raw}」不合法：scope 与 name 都须匹配 ${SEGMENT_RE.source}（REG-R5）`);
		const slug = `${scope}-${name}`;
		if (!SLUG_RE.test(slug))
			throw new UsageError(`[ojm] 物理名「${slug}」不合法：须匹配 ${SLUG_RE.source}（slug 上限 64 字符）`);
		return { slug, version: version === "" ? null : version };
	}
	if (!SLUG_RE.test(rest))
		throw new UsageError(`[ojm] 物理名「${rest}」不合法：须匹配 ${SLUG_RE.source}（裸 slug 须为小写字母开头的小写字母/数字/连字符）`);
	return { slug: rest, version: version === "" ? null : version };
}

/**
 * REG-R9② 旧站点拒：站点平台 API 版本是否 ≥ `min`。`undefined`（meta 端点缺失/未注入）按
 * 旧版本处理——宁可不装，不静默降级到不支持 registry 源的站点。
 */
export function isSiteApiAtLeast(apiVersion: string | undefined, min: string): boolean {
	if (apiVersion === undefined)
		return false;
	const parse = (v: string): [number, number, number] | null => {
		const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
		return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
	};
	const a = parse(apiVersion);
	const b = parse(min);
	if (a === null || b === null)
		return false;
	return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
}

export type Locale = "zh-CN" | "en-US";

/** 契约附录 A 十阶段指引（zh/en 双语列；文案单一来源 = 契约附录 A 表，此处为渲染镜像） */
const STAGE_HINTS: Record<string, { zh: string, en: string }> = {
	preflight: { zh: "请修正方案清单或释放占用的名称与前缀后重新安装", en: "Fix the manifest or release the occupied name and prefix, then install again" },
	downloading: { zh: "请检查网络与市场地址（框架设置 → 市场源），稍后重试", en: "Check the network and market URL (Framework settings → Market source), then retry" },
	verifying: { zh: "分发包可能损坏，请重试下载；持续失败请联系发布方", en: "The archive may be corrupted; retry the download, or contact the publisher if it persists" },
	extracting: { zh: "安装已终止且零落盘；若反复出现，请勿使用该分发包并联系发布方", en: "Installation aborted with nothing written; if it repeats, do not use this archive and contact the publisher" },
	migrating: { zh: "数据已保留原状，请修复后重试；必要时回退到上一版本", en: "Data is left intact; fix the issue and retry, or roll back to the previous version if needed" },
	lock_commit: { zh: "存在并发构建或安装，请稍后重试", en: "A concurrent build or install is in progress; retry later" },
	registering: { zh: "请重试；多次失败请检查站点数据库状态", en: "Retry; if it keeps failing, check the site database state" },
	deploying_web: { zh: "请重试；方案已部分生效，若持续失败请禁用该方案", en: "Retry; the solution is partially live — disable it if the failure persists" },
	reloading: { zh: "站点仍在使用旧配置服务，请稍后重试或联系运维", en: "The site still serves the old config; retry later or contact ops" },
	smoke: { zh: "方案已部分生效，请按详情排查；可先禁用该方案恢复原状", en: "The solution is partially live; inspect the details, or disable it to restore the previous state" },
};

/** retryable 全局两值（契约附录 A：全 stage 共用） */
const RETRYABLE_LABELS: Record<Locale, { yes: string, no: string }> = {
	"zh-CN": { yes: "本次失败可重试", no: "本次失败不可自动重试" },
	"en-US": { yes: "This failure is retryable", no: "This failure is not retryable" },
};

/**
 * verifying 段签名失败六码双语文案（契约附录 A.2；文案真源 = 契约附录 A.2 表，此处为渲染镜像，
 * 缺失即测试红，同 C2-25 纪律）。`error.reason` 走 key（六码），渲染层按 locale 取本表；
 * 非六码失败（其它 stage）reason 仍是服务端可读串，渲染原样回退（不丢信息）。
 */
const VERIFY_CODE_COPY: Record<string, { reason: { zh: string, en: string }, hint: { zh: string, en: string } }> = {
	sig_missing: {
		reason: {
			zh: "缺少签名：未找到 detached 签名侧车（.sig）且市场清单无 signature 字段——宿主已启用强制验签，未签名包一律拒装",
			en: "Missing signature: no detached .sig sidecar and the manifest has no signature field — the host enforces signing, so unsigned packages are rejected",
		},
		hint: {
			zh: "请用 ojm sign 对包签名后重传，或确认市场源已发布带签名的版本",
			en: "Sign the package with `ojm sign` and re-upload, or confirm the market source published a signed version",
		},
	},
	sig_alg: {
		reason: {
			zh: "签名算法不被接受：仅支持 Ed25519（alg 必须逐字为 \"Ed25519\"，大小写敏感）",
			en: "Unsupported signature algorithm: only Ed25519 is accepted (alg must be exactly \"Ed25519\", case-sensitive)",
		},
		hint: { zh: "请让发布方改用 Ed25519 签名", en: "Ask the publisher to sign with Ed25519" },
	},
	sig_key: {
		reason: {
			zh: "公钥标识（key_id）不合法，或与信任库绑定不一致（首次绑定不可覆盖）",
			en: "Key identifier (key_id) is invalid, or does not match the trusted-key binding (first binding cannot be overwritten)",
		},
		hint: {
			zh: "请核对 key_id 命名空间（<publisher>.<id>），或联系运维将正确公钥加入信任库",
			en: "Check the key_id namespace (<publisher>.<id>), or ask ops to add the correct public key to the trust store",
		},
	},
	tampered: {
		reason: {
			zh: "验签失败：包体、公钥或签名任一被篡改（Ed25519 验签返回 false）",
			en: "Signature verification failed: the archive, public key, or signature was tampered with (Ed25519 verify returned false)",
		},
		hint: {
			zh: "重新下载安装包并核对发布方指纹；若持续失败请勿使用该包",
			en: "Re-download the package and verify the publisher's fingerprint; if it persists, do not use this package",
		},
	},
	unknown_key: {
		reason: {
			zh: "未知发布方（key_id 不在信任库）：需经 TOFU 确认后方可安装",
			en: "Unknown publisher (key_id not in the trust store): requires TOFU confirmation before install",
		},
		hint: {
			zh: "请与发布方核对指纹后执行 ojm trust confirm --task <id>",
			en: "Verify the fingerprint with the publisher, then run `ojm trust confirm --task <id>`",
		},
	},
	sig_format: {
		reason: {
			zh: "签名编码违规：公钥非 64 位 hex、签名非标准 base64（禁 base64url），或规范串版本标记非 v2",
			en: "Signature encoding violation: public key is not 64-hex, signature is not standard base64 (base64url forbidden), or the canonical-version marker is not v2",
		},
		hint: {
			zh: "请让发布方使用标准签名工具（ojm sign）重新签名",
			en: "Ask the publisher to re-sign with the standard tooling (ojm sign)",
		},
	},
};

function normalizeLocale(locale?: string): Locale {
	return locale === "en-US" || locale === "en" ? "en-US" : "zh-CN";
}

/**
 * 终态渲染（纯函数，人话多行文本）：done 单行；failed/partial = 标题 + 原因 + 指引 + 重试标注
 * （hintKey 随标注行附上，便于对照契约附录 A）。
 */
export function renderOutcome(record: TaskRecord, locale?: string): string {
	const lang = normalizeLocale(locale);
	// P2-10 升版纪律（读方）：不认识的高版本 → 人话降级提示 + 不误渲染成功——
	// 语义可能已漂移（status 字段含义不再可信），只出降级提示，连 done 也不报「安装完成」
	if (isFutureSchema(record)) {
		return lang === "en-US"
			? `[ojm] Task record schema version ${record.schemaVersion} is newer than this CLI supports (${TASK_SCHEMA_VERSION_KNOWN}) — fields may be missing or semantics drifted. Upgrade ojm and retry.`
			: `[ojm] 任务记录 schema 版本 ${record.schemaVersion} 高于本 CLI 支持的版本（${TASK_SCHEMA_VERSION_KNOWN}）——字段可能缺失或语义漂移，请升级 ojm 后重试。`;
	}
	if (record.status === "done") {
		return lang === "en-US"
			? `[ojm] Install complete: ${record.name} ${record.version}`
			: `[ojm] 安装完成：${record.name} ${record.version}`;
	}
	if (record.status === "needs_trust") {
		// 第五终态（P2-3，G3）：未知发布方待 TOFU 确认——**非成功态、非失败崩溃**；
		// 指纹分组展示 + 确认命令 + 重试指引（契约附录 A.2 unknown_key）
		const t = record.trust;
		const fp = t?.fingerprint ? (t.fingerprint.match(/.{1,8}/g) ?? []).join(" ") : "（未知）";
		return lang === "en-US"
			? [
				`[ojm] Trust confirmation required (publisher: ${t?.key_id ?? "unknown"})`,
				`Fingerprint (sha256 of public key): ${fp}`,
				`Verify it with the publisher, then run: ojm trust confirm --task ${record.id}`,
				"After confirming, retry the install command.",
			].join("\n")
			: [
				`[ojm] 待信任确认（发布方：${t?.key_id ?? "未知"}）——安装未完成`,
				`指纹（公钥 sha256，请与发布方公布值逐字核对）：${fp}`,
				`确认命令：ojm trust confirm --task ${record.id}`,
				"确认入库后重试安装命令即可继续。",
			].join("\n");
	}
	const retryable = RETRYABLE_LABELS[lang][record.error?.retryable ? "yes" : "no"];
	const stage = record.error?.hintKey?.replace(/^lifecycle\.stage\./, "").replace(/\.hint$/, "") ?? record.stage ?? "";
	const en = lang === "en-US";
	// 六码走 key：hintKey 形如 lifecycle.stage.verifying.<code>，按 locale 取本表（fail-fast 测试据此断言实际渲染）
	const code = /^lifecycle\.stage\.verifying\.(sig_missing|sig_alg|sig_key|tampered|unknown_key|sig_format)$/
		.exec(record.error?.hintKey ?? "")?.[1];
	const reason = code
		? (VERIFY_CODE_COPY[code]?.reason[en ? "en" : "zh"] ?? record.error?.reason ?? record.message)
		: (record.error?.reason ?? record.message);
	const hint = code
		? (VERIFY_CODE_COPY[code]?.hint[en ? "en" : "zh"] ?? STAGE_HINTS[stage]?.[en ? "en" : "zh"] ?? "")
		: (STAGE_HINTS[stage]?.[en ? "en" : "zh"] ?? (en ? "Inspect the task details on the site for more information" : "请到站点任务详情页查看更多信息"));
	const head = record.status === "partial"
		? (lang === "en-US"
			? `[ojm] Install partially applied (stage: ${stage}) — the solution is partly live, see hint below`
			: `[ojm] 安装部分生效（stage：${stage}）——方案已部分上线，详见下方指引`)
		: (lang === "en-US"
			? `[ojm] Install failed (stage: ${stage})`
			: `[ojm] 安装失败（stage：${stage}）`);
	return [
		head,
		lang === "en-US" ? `Reason: ${reason}` : `原因：${reason}`,
		lang === "en-US" ? `Hint: ${hint}` : `指引：${hint}`,
		`${retryable}（${record.error?.hintKey ?? `lifecycle.stage.${stage}.hint`}）`,
	].join("\n");
}

export type InstallTarget = { kind: "file", path: string, name: string | null, version: string | null } | { kind: "cdn", name: string, version: string | null };

/** 目标解析：.tgz 路径 → file 源（<name>-<version>.tgz 文件名推导身份）；否则 name[@version] → cdn 源 */
export function parseTarget(target: string): InstallTarget {
	if (target.endsWith(".tgz")) {
		const stem = path.basename(target).replace(/\.tgz$/i, "");
		// 文件名推导：<name>-<version>（版本 = 尾段点分数字开头，可带 -prerelease 段；ojm build --bundle 产物命名，Finding C）
		const m = /^(.+)-(\d[\w.]+(?:-[\w.]+)?)$/.exec(stem);
		return { kind: "file", path: target, name: m?.[1] ?? null, version: m?.[2] ?? null };
	}
	const at = target.indexOf("@");
	const name = at === -1 ? target : target.slice(0, at);
	const version = at === -1 ? null : target.slice(at + 1);
	if (name.trim() === "")
		throw new Error(`[ojm] 非法安装目标：「${target}」（用法：ojm install <file.tgz | name[@version]>）`);
	return { kind: "cdn", name: name.trim(), version };
}

export interface InstallOptions {
	siteUrl?: string
	user?: string
	pass?: string
	/** file 源身份覆盖（文件名不可解析时的显式出口）；cdn 源同名冲突时报错提示二选一 */
	name?: string
	/** 显式版本（覆盖文件名/目标推导） */
	version?: string
	/** 终态文案语言（缺省 zh-CN） */
	locale?: string
	/** REG-R9②：从指定 registry 源安装（白名单在服务端；旧站点 API < 0.2.0 不支持 → exit 1） */
	registry?: string
	/** 测试注入；缺省 globalThis.fetch */
	fetchFn?: typeof fetch
	/** 测试注入；缺省真睡 */
	sleep?: (ms: number) => Promise<void>
}

/**
 * 安装命令体：解析目标 → 登录 → POST install（file=multipart / cdn=JSON）→ 轮询至终态 →
 * 渲染人话。失败/partial 打印全文后置 process.exitCode = 1（不抛——多行渲染已输出，栈是噪音），
 * 返回终态记录供调用方（真机冒烟）断言。
 */
export async function installCommand(target: string, opts: InstallOptions = {}): Promise<TaskRecord> {
	const fetchFn = opts.fetchFn ?? globalThis.fetch;
	const { base, user, pass } = resolveSite(opts);
	const token = await login(fetchFn, base, user, pass);

	let response: { task_id: string };
	if (opts.registry !== undefined) {
		// REG-R9②：registry 源安装。归一（目录键 → slug）只在此一处；旧站点拒；白名单在服务端。
		const src = resolveRegistrySource({ flag: opts.registry });
		const { slug, version } = parseRegistryTarget(target);
		if (opts.name !== undefined && opts.name !== slug)
			throw new UsageError(`[ojm] --name「${opts.name}」与 registry 目标推导的物理名「${slug}」不一致——registry 源由目标推导身份，请二选一`);
		// 旧站点拒：meta apiVersion < 0.2.0 不支持 registry 源（REG-R9② 升版反噬 F4 的人话面）
		const meta = await callApi<{ apiVersion?: string }>(fetchFn, base, token, "GET", "/api/_platform/market/meta");
		if (!isSiteApiAtLeast(meta.apiVersion, "0.2.0"))
			throw new Error(`[ojm] 目标站点平台 API 版本过低（需 ≥ 0.2.0 才支持 --registry 源安装，实为 ${meta.apiVersion ?? "未知"}）——请升级目标站点的 oj-module，或改用 CDN/file 源`);
		const registryOrigin = originOf(src.url) ?? src.url;
		response = await callApi<{ task_id: string }>(fetchFn, base, token, "POST", "/api/_platform/market/install", {
			name: slug,
			version: opts.version ?? version,
			source: "registry",
			registry: registryOrigin,
		});
		console.log(`[ojm] 已从 registry 源提交安装任务（源 ${registryOrigin}，物理名 ${slug}）`);
	}
	else {
		const parsed = parseTarget(target);
		if (parsed.kind === "file") {
			const name = opts.name ?? parsed.name;
			if (name === null)
				throw new Error(`[ojm] 无法从文件名推导方案名：${target}——请用 --name <name>（及 --version <version>）显式指定`);
			const version = opts.version ?? parsed.version;
			const bytes = new Uint8Array(fs.readFileSync(parsed.path));
			const form = new FormData();
			form.append("name", name);
			if (version !== null)
				form.append("version", version);
			form.append("source", "file");
			form.append("file", new Blob([bytes], { type: "application/gzip" }), path.basename(parsed.path));
			// detached 侧车签名（P2-3，G4）：同目录 <tgz>.sig 自动探测随 multipart 第二文件上传——
			// 缺签即被宿主 G4 拒（sig_missing 人话转述），与 Form B 同一信任模型
			const sigPath = `${parsed.path}.sig`;
			if (fs.existsSync(sigPath)) {
				form.append("sig", new Blob([new Uint8Array(fs.readFileSync(sigPath))], { type: "application/json" }), path.basename(sigPath));
				console.log(`[ojm] 已随包上传签名侧车：${path.basename(sigPath)}`);
			}
			else {
				console.log(`[ojm] 未发现签名侧车（${path.basename(sigPath)}）——宿主验签硬 fail-closed，未签名包将被拒（sig_missing）；签名方法见 devkit「签名与信任」`);
			}
			const res = await fetchFn(`${base}/api/_platform/market/install`, {
				method: "POST",
				headers: { authorization: `Bearer ${token}`, ...tenantHeaders() },
				body: form,
			});
			response = await unwrapInstall(res);
		}
		else {
			if (opts.name !== undefined && opts.name !== parsed.name)
				throw new Error(`[ojm] --name「${opts.name}」与目标「${parsed.name}」不一致——请二选一`);
			response = await callApi<{ task_id: string }>(fetchFn, base, token, "POST", "/api/_platform/market/install", {
				name: parsed.name,
				version: opts.version ?? parsed.version,
				source: "cdn",
			});
		}
	}

	const record = await pollTask(fetchFn, base, token, response.task_id, { sleep: opts.sleep });
	console.log(renderOutcome(record, opts.locale));
	// P2-10：未来 schema 版本即使 status=done 也按非成功态处理（语义可能漂移，不误报成功）
	if (record.status !== "done" || isFutureSchema(record))
		process.exitCode = 1;
	return record;
}

/** file 源响应解包：复用站点信封语义，额外校验 task_id 在场（防编排面版本错配静默空转） */
async function unwrapInstall(res: { ok: boolean, status: number, text: () => Promise<string> }): Promise<{ task_id: string }> {
	const data = await unwrapEnvelope(res) as { task_id?: string };
	const taskId = String(data?.task_id ?? "");
	if (taskId === "")
		throw new Error("[ojm] install 响应缺 task_id——核对站点平台编排面版本（peerPlatform 预检）");
	return { task_id: taskId };
}
