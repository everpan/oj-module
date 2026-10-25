// `ojm view <@scope/name>`（REG-R5 的可查面）：把「目录键 ↔ 物理名」**同时**显示出来。
//
// 为什么需要这个命令：
//   · 目录键是仓库里的门牌（`@acme/demo`），物理名才是磁盘目录/路由前缀/tgz 文件名
//     （`acme-demo`）。用户看得见前者、装得上后者，中间那条换算如果不给查询口，
//     就只能靠用户自己猜；
//   · 换算**不可逆**（`acme-x-demo` 可能来自 `@acme-x/demo` 或 `@acme/x-demo`），所以
//     命令只接受目录键，不接受裸 slug——反推出来的答案有歧义时，宁可不答。
//
// 命令本身不做业务判断：身份、授权、映射都是站点 registry 模块的职责（REG-R1），
// 这里只负责「登录 → 取一条 → 两个名字并排打印」。`--json` 走统一信封（REG-R12）。
import { emit } from "./cli-output";
import { UsageError } from "./exit-codes";
import { callApi, login, resolveSite } from "./site";

/** registry 模块的目录名（也是路由前缀）：与站点侧 manifest.name 同值 */
export const REGISTRY_MODULE = "oj-registry";

/** 目录键每段的字符集：与站点侧 naming.ts 同规则（CLI 先拦一次，省掉一趟网络往返） */
export const SEGMENT_RE = /^[a-z][a-z0-9-]{0,63}$/;

export interface ViewTarget {
	scope: string
	name: string
}

/** `@acme/demo` / `acme/demo` → `{ scope, name }`；裸名与非目录键一律用法错误（exit 2） */
export function parseViewTarget(raw: unknown): ViewTarget {
	const text = String(raw ?? "").trim().replace(/^@/, "");
	const slash = text.indexOf("/");
	if (slash <= 0 || slash === text.length - 1)
		throw new UsageError(`[ojm] view 需要目录键 @<scope>/<name>（如 @acme/demo；收到「${String(raw ?? "")}」）——物理名是单向换算，裸 slug 无法反推唯一的 scope`);
	const scope = text.slice(0, slash);
	const name = text.slice(slash + 1);
	if (!SEGMENT_RE.test(scope) || !SEGMENT_RE.test(name))
		throw new UsageError(`[ojm] 目录键「${String(raw ?? "")}」不合法：scope 与 name 都须匹配 ${SEGMENT_RE.source}`);
	return { scope, name };
}

export interface PackageView {
	scope: string
	name: string
	slug: string
	directoryKey: string
	createdAt: number
}

export interface ViewOptions {
	url?: string
	user?: string
	pass?: string
	json?: boolean
	/** 测试注入；缺省全局 fetch */
	fetchFn?: typeof fetch
}

/**
 * 取一条包映射并打印。
 * 站点寻址沿用 install/uninstall 的同一套（`--url/--user/--pass` 或 `OJM_URL/OJM_USER/OJM_PASS`）；
 * 缺凭据是**用法错误**（exit 2）：换个命令参数就能解决，不该和「站点说没有这个包」混成同一档。
 */
export async function viewCommand(raw: string | undefined, opts: ViewOptions = {}): Promise<PackageView> {
	const { scope, name } = parseViewTarget(raw);
	let site: { base: string, user: string, pass: string };
	try {
		site = resolveSite(opts);
	}
	catch (error) {
		throw new UsageError((error as Error).message);
	}
	const fetchFn = opts.fetchFn ?? fetch;
	const token = await login(fetchFn, site.base, site.user, site.pass);
	const data = await callApi<PackageView>(
		fetchFn,
		site.base,
		token,
		"GET",
		`/api/${REGISTRY_MODULE}/packages/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`,
	);
	const when = new Date(Number(data.createdAt)).toISOString().slice(0, 16).replace("T", " ");
	emit({
		command: "view",
		data: { ...data, site: site.base },
		human: [
			`[ojm] 目录键 ${data.directoryKey}`,
			`[ojm] 物理名 ${data.slug}`,
			`[ojm] 建立于 ${when}（UTC）· 站点 ${site.base}`,
		],
	}, { json: !!opts.json });
	return data;
}
