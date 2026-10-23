// 发布 @oj-module/* 包：lockstep 门禁 → 产物重建 → 守卫测试 → 按依赖序发布 → registry 复核。
//
// 参数与流程说明：见本文件 USAGE 常量（单一事实来源；`node scripts/publish-packages.mjs --help` 同文）。
//
// 流程来源：docs/prd/framework-development-guide.md 附录 A（发布 runbook）。
// 设计文档：docs/prd/202610101416-publish-script.md（事故背景见
// docs/prd/202610101405-cli-publish-private-deps-fix.md）。
// 发布仓库：registry.npmjs.org（用户指定）。发布目标由 publish 命令行 --registry
// 显式钉死——两包 publishConfig 只保留 access:public（publishConfig.registry 会压过
// --registry 与 .npmrc 作用域映射，导致每次模拟发 verdaccio 都得改 package.json 再复原）。
//
// 反常识点（runbook 实测踩坑，勿"优化"掉）：
//   - 必须 pnpm publish：npm publish 会把 workspace:*/catalog: 字面量发出去；
//   - 必须 --no-provenance：本仓 .npmrc 写了 provenance=true，本地无 CI OIDC 会失败；
//   - 必须 --otp（TOTP 类 2FA 开启时）：传入 `npm publish` 的 `EOTP` 拦截；省略则交互索取，
//     验证码失效/被拒时脚本会自动重新索取并重试该包（最多 3 次）；未开 2FA 时该参数被忽略；
//   - web 验证类 2FA：改用 --web-2fa。此时 npm 发布时弹浏览器审批，脚本不传 --otp、不索取验证码，
//     阻塞等待浏览器批准后继续；若审批超时/失败，按发布失败处理（无验证码可重输，重跑本命令即可）；
//   - 发布必须显式 --registry（本脚本 publishArgs 已钉死官方源）：命令行压过 .npmrc 的
//     @oj-module:registry 作用域映射（指向本地 verdaccio 时只影响模拟发布，不影响本脚本）；
//     复核只查官方 registry，镜像可能一直 404 属正常；
//   - 发布后用 403 "previously published versions" 重发确认的办法已被
//     registry 轮询取代（本脚本自动处理 CDN 传播延迟）。
//   - 幂等：第 4 步发布前先查官方源，目标版本已存在则跳过该包。这样「runtime 已发、
//     cli 因 web 2FA 第二次审批未通过而失败」等情况，重跑本命令会跳过已发布的包、
//     只补发失败的包，不会卡在「版本已存在」报错。
//   - 发布按依赖序逐个进行，单个包失败不中断其余包（web 2FA 需每个包各自浏览器批准一次，
//     漏批一个不应导致后续包全废）；全部跑完后统一汇总失败并退出非 0。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org";

/** 发布顺序即依赖顺序：cli 精确依赖 runtime，颠倒则消费端装不上 */
const PUBLISH_ORDER = ["runtime", "cli"];
/** lockstep 同版校验的四包（kit/editor 版本落 versions.json，漏升即门禁失真） */
const LOCKSTEP = {
	"@oj-module/runtime": "packages/runtime/package.json",
	"@oj-module/cli": "packages/cli/package.json",
	// "@plane/kit": "packages/kit/package.json",
	// "@plane/editor": "packages/editor-standalone/package.json",
};

const args = process.argv.slice(2);
const flag = name => args.includes(name);
function opt(name) {
	// 等号形式（--otp=123456 / --tag=beta）与空格形式（--otp 123456）等价：
	// cac/npm 生态里等号是自然输入，曾被未知参数守卫误判拦下
	const eq = args.find(a => a.startsWith(`${name}=`));
	if (eq !== undefined)
		return eq.slice(name.length + 1);
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
}

/**
 * 帮助文本（用法 + 五步流程 + 全部旗标）。单一事实来源：头部注释只留指针，
 * 新增/改旗标时只改这里，`--help` 输出与注释不会漂移。
 */
const USAGE = `用法：node scripts/publish-packages.mjs --dry-run
     node scripts/publish-packages.mjs --publish [其他选项]

一键发布 @oj-module/runtime + @oj-module/cli（双包 lockstep 同版，按依赖序
runtime → cli；颠倒则消费端装不上）。

不带任何参数运行 = 显示本帮助（退出 1）——实发必须显式 --publish，
「手滑敲个命令」不会变成真发布。

流程（5 步，任一失败即中止；已发布的版本自动跳过，可安全重跑）：
  1/5 前置校验      lockstep 同版门禁 + 工作区干净 + npm 登录态（dry-run 跳过登录）
  2/5 产物重建      runtime build + cli build:shell（宿主外壳预打包）
  3/5 守卫测试      vitest run tests/cli/ tests/shell/kit-shared.test.ts
  4/5 发布          runtime → cli（pnpm publish --access public --no-provenance）
  5/5 registry 复核 官方源轮询 dist-tag / version / tarball（容忍 CDN 延迟，最长 3 分钟）

选项：
  --publish       实发（显式动作，不可逆）。不带它又不带 --dry-run = 意图不明，
                  直接 fail-fast；与 --dry-run 互斥
  --dry-run       演练：只构建 + 守卫测试，不发布（也不要求登录、不做 registry 复核）
  --skip-tests    跳过守卫测试（应急；发布前须手动补跑 pnpm vitest run tests/cli）
  --tag <tag>     dist-tag，默认 latest（发 beta 等预发布通道时用）
  --otp <code>    npm 2FA 验证码（TOTP 类账户必填）；省略则发布前交互索取，
                 被 EOTP 拦截时自动重新索取并重试（最多 3 次）
  --web-2fa       npm 2FA 为「web 验证」（浏览器审批）模式：发布时 npm 弹浏览器
                 让你批准，脚本阻塞等待；无验证码可输，超时/被拒需重跑本命令。
                 与 --otp 互斥（同时给则忽略 --otp）
  -h, --help      打印本帮助并退出（不做任何校验、不发布）

发布仓库：https://registry.npmjs.org（命令行 --registry 显式钉死官方源，不受 .npmrc
作用域映射影响；两包 publishConfig 仅保留 access:public——publishConfig.registry
优先级高于 --registry，会让模拟发布 verdaccio 被迫改 package.json）。

注意：pnpm ≥11 默认 minimumReleaseAge=1 天——发布后约一天内裸版本号安装可能
仍指向旧版；在此之前消费端可用 pnpm i @oj-module/cli@<version> 显式指定
（此现象非发布问题，勿重发版本）。`;

// --help/-h 先于一切副作用：误敲 --help 绝不该触发真实发布（此前无帮助入口，
// 敲 --help 会被当未知参数忽略、直接开跑——本分支修此隐患）。
if (flag("--help") || flag("-h")) {
	console.log(USAGE);
	process.exit(0);
}
// 未知参数 fail-fast：拼错旗标（如 --dryrun、--skip_test）旧行为是静默忽略，
// 结果是一场「以为在演练、实际在真发布」的事故。这里直接拦下并给出用法。
const KNOWN_FLAGS = new Set(["--dry-run", "--skip-tests", "--web-2fa", "--publish", "--help", "-h"]);
const KNOWN_OPTS = new Set(["--tag", "--otp"]);
const unknownArgs = args.filter(a => a.startsWith("-") && !KNOWN_FLAGS.has(a) && !KNOWN_OPTS.has(a) && ![...KNOWN_OPTS].some(k => a.startsWith(`${k}=`)));
if (unknownArgs.length > 0) {
	console.error(`✗ 未知参数：${unknownArgs.join(" ")}\n`);
	console.error(USAGE);
	process.exit(1);
}
const DRY_RUN = flag("--dry-run");
const SKIP_TESTS = flag("--skip-tests");
const TAG = opt("--tag") ?? "latest";
const OTP = opt("--otp");
const WEB_2FA = flag("--web-2fa");
const PUBLISH = flag("--publish");

// 动作显式化（安全默认）：
//   · 裸跑（无任何参数）= 显示帮助并退出 1——发布是不可逆的共享动作，
//     「手滑敲个 node scripts/publish-packages.mjs」不该等于真发布；
//   · 实发必须显式 --publish；只给修饰旗标（--tag/--otp/--web-2fa/--skip-tests）
//     不给 --publish = 意图不明，fail-fast；
//   · --dry-run 是安全演练，无需 --publish；与 --publish 同给 = 自相矛盾，拦下。
if (args.length === 0) {
	console.log(USAGE);
	process.exit(1);
}
if (DRY_RUN && PUBLISH) {
	console.error("✗ --publish 与 --dry-run 互斥：演练不发布；要实发请不要带 --dry-run。");
	process.exit(1);
}
if (!DRY_RUN && !PUBLISH) {
	console.error("✗ 未指定 --publish——实发是显式动作（不可逆）：确认发布请加 --publish；演练请用 --dry-run。\n");
	console.error(USAGE);
	process.exit(1);
}

// ── 基础：shell 执行与日志 ──────────────────────────────────
// 所有命令统一在此打印 `$ cmd args` 并 exec——消除 run()/publishPkg() 各自重复打印的散点。
function fail(msg) {
	console.error(`\n✗ ${msg}`);
	process.exit(1);
}
/** 执行一条命令；成功返回 stdout（inherit 模式为 undefined），失败向上抛。 */
function sh(cmd, cargs, { cwd = ROOT, ...rest } = {}) {
	console.log(`$ ${cmd} ${cargs.join(" ")}`);
	return execFileSync(cmd, cargs, { cwd, ...rest });
}
/** pnpm 命令的薄封装（本脚本几乎只调 pnpm）。 */
function pnpm(cargs, opts = {}) {
	return sh("pnpm", cargs, opts);
}
/** 构建步骤（build / test）：inherit stdio，不关心返回值。 */
function run(cargs) {
	pnpm(cargs);
}

// ── registry 查询 ──────────────────────────────────────────
async function fetchRegistryJson(name) {
	try {
		const res = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`);
		return res.ok ? await res.json() : null;
	}
	catch {
		return null;
	}
}
/** 目标版本是否已发布到官方源（幂等跳过，避免「runtime 已发、cli 失败」后重跑卡在已存在版本） */
async function isVersionPublished(name, version) {
	try {
		const res = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}/${version}`);
		return res.ok;
	}
	catch {
		return false;
	}
}

// ── 发布原语 ──────────────────────────────────────────────
/** 组装 `pnpm -C packages/<pkg> publish ...` 参数（单一事实来源，杜绝散落拼接） */
function publishArgs(pkg, { otp } = {}) {
	return [
		"-C",
		`packages/${pkg}`,
		"publish",
		"--registry",
		REGISTRY,
		"--access",
		"public",
		"--no-provenance",
		"--no-git-checks",
		...(TAG !== "latest" ? ["--tag", TAG] : []),
		...(otp ? ["--otp", otp] : []),
	];
}
/** 发布单个包。成功返回 true；失败返回 { needOtp }（web 验证模式恒为 false）。 */
function publishPkg(pkg, { otp, interactive = false } = {}) {
	try {
		// 交互（web 2FA）模式必须用 stdio:"inherit" 把真实 TTY 交给 pnpm——
		// 否则 pnpm 看到的是管道、判定为非交互终端，抛出 ERR_PNPM_OTP_NON_INTERACTIVE
		// 导致浏览器审批根本弹不出来、发布静默失败（runtime 此前只能靠手动终端发布即源于此）。
		const out = pnpm(publishArgs(pkg, { otp }), interactive ? { stdio: "inherit" } : { encoding: "utf-8" });
		if (!interactive && out)
			process.stdout.write(out);
		return true;
	}
	catch (err) {
		if (interactive) {
			// 交互模式报错已直接落到终端（inherit），无需回显；web 验证无验证码可重输，按失败处理
			return { needOtp: false };
		}
		const out = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
		process.stderr.write(out);
		// npm 2FA 拦截：EOTP / "one-time pass" / "otp"；其余错误按失败处理
		return { needOtp: /EOTP|one-time pass|otp/i.test(out) };
	}
}

// 交互索取 npm 2FA 验证码（输入不回显由终端控制，这里只负责读取）
async function askOtp() {
	const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
	try {
		return (await rl.question("请输入 npm 2FA 验证码（otp）：")).trim();
	}
	finally {
		rl.close();
	}
}

// ── 2FA 策略（Strategy 模式：两种认证方式各自独立，互不污染）──
/** TOTP：首次用 --otp（或交互索取），被 EOTP 拦截时最多重试 3 次。 */
async function publishWithTotp(pkg) {
	let otp = OTP ?? await askOtp();
	for (let attempt = 0; ; attempt++) {
		if (await publishPkg(pkg, { otp }) === true)
			return true;
		if (attempt < 3) {
			console.error(`\n✗ ${pkg} 发布被 2FA 拦截（otp 无效或过期），请重新输入（第 ${attempt + 1} 次重试）`);
			otp = await askOtp();
			continue;
		}
		return false;
	}
}
/** web 验证：单次交互式发布，由 pnpm 弹浏览器审批；无重试（审批超时/被拒需重跑命令）。 */
function publishWithWeb2fa(pkg) {
	return publishPkg(pkg, { interactive: true }) === true;
}

// ── 各步骤（单一职责，main 仅做编排）────────────────────────
function readVersion(rel) {
	return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")).version;
}

/** 1. lockstep 同版校验，返回目标版本号 */
function checkLockstep() {
	const versions = Object.fromEntries(
		Object.entries(LOCKSTEP).map(([name, rel]) => [name, readVersion(rel)]),
	);
	const target = versions["@oj-module/runtime"];
	const mismatch = Object.entries(versions).filter(([, v]) => v !== target);
	if (mismatch.length > 0)
		fail(`lockstep 版本不一致（应全部 = ${target}）：\n${Object.entries(versions).map(([n, v]) => `  ${n} = ${v}`).join("\n")}`);
	console.log(`lockstep 版本一致：${target}`);
	return target;
}
/** 1. 工作区干净性（pnpm publish 要求干净树） */
function checkCleanTree() {
	if (execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf-8" }).trim())
		fail("工作区不干净——pnpm publish 要求干净树，请先提交全部改动。");
}
/**
 * 1. 登录态。whoami 401 = token 失效（npm_ 粒度 token 有过期时间），必须发布前拦下：
 *  token 无效时对已存在包 PUT 会被 registry 回 404（不泄露包存在性），报错极具迷惑性，
 *  且 web 2FA 的浏览器审批链路根本不会触发（认证第一关就失败，无审批链接可弹）。
 *  修复：whoami 失败时**除提示外直接执行 `npm login`**（交互式，web 2FA 弹浏览器 /
 *  TOTP 输密码与验证码），登录成功后再复核一次 whoami，确认 token 已生效才继续下一步；
 *  登录被取消或仍失败则 fail（发布不可在没有登录态下继续）。
 */
function loginToRegistry() {
	// npm login 是交互命令，必须 inherit stdio 把真实 TTY 交给 npm；
	// 否则 pnpm/npm 判定为非交互终端会拒绝（与 web 2FA 发布同理）。
	execFileSync("npm", ["login", `--registry=${REGISTRY}`], { stdio: "inherit" });
}

function checkLoggedIn() {
	try {
		execFileSync("npm", ["whoami", `--registry=${REGISTRY}`], { stdio: "pipe" });
		return;
	}
	catch {
		console.error(`⚠ npm token 无效或已过期（whoami 失败）——自动执行登录：${REGISTRY}`);
	}
	try {
		loginToRegistry();
	}
	catch {
		fail("npm login 未成功（被取消或失败）——发布需要有效的 npm 登录态，请确认登录后再跑本命令。");
	}
	// 登录成功后复核一次：确认 token 已生效再继续，避免带着失效态进发布步骤
	try {
		execFileSync("npm", ["whoami", `--registry=${REGISTRY}`], { stdio: "pipe" });
	}
	catch {
		fail(`登录后 whoami 仍失败——请确认登录的 registry（${REGISTRY}）与发布目标一致，再跑本命令。`);
	}
	console.log("✓ 登录态已恢复");
}

/** 2. 产物重建（runtime 构建 + cli 宿主外壳预打包） */
function rebuildArtifacts() {
	run(["--filter", "@oj-module/runtime", "build"]);
	run(["--filter", "@oj-module/cli", "build:shell"]);
}

/** 3. 守卫测试（真跑 pnpm pack 的发布清单守护） */
function runGuardTests() {
	if (SKIP_TESTS) {
		console.log("（--skip-tests 已跳过，发布前须手动补跑 pnpm vitest run tests/cli）");
		return;
	}
	run(["vitest", "run", "tests/cli/", "tests/shell/kit-shared.test.ts"]);
}

/** 4. 按依赖序发布；逐个进行，单包失败不中断，末尾汇总 */
async function publishAll(target) {
	const strategy = WEB_2FA ? publishWithWeb2fa : publishWithTotp;
	const failed = [];
	for (const pkg of PUBLISH_ORDER) {
		const name = `@oj-module/${pkg}`;
		// 幂等：已发布的目标版本直接跳过，使「部分发布失败」后可安全重跑
		if (await isVersionPublished(name, target)) {
			console.log(`ⓘ ${name}@${target} 已发布，跳过`);
			continue;
		}
		if (WEB_2FA)
			console.log(`ⓘ web 2FA：请在浏览器中批准 ${name}@${target} 的发布（脚本阻塞等待审批）`);
		const ok = await strategy(pkg);
		console.log(ok ? `✓ ${name}@${target} 发布成功` : `✗ ${name}@${target} 发布失败`);
		if (!ok)
			failed.push(pkg);
	}
	if (failed.length > 0)
		fail(`以下包发布失败（见上方输出；已发布的包重跑本命令会自动跳过）：${failed.map(p => `@oj-module/${p}`).join("、")}`);
}

/** 5. registry 复核：官方源轮询，容忍 CDN 传播延迟（最长 3 分钟） */
async function verifyRegistry(target) {
	const deadline = Date.now() + 180_000;
	for (const pkg of PUBLISH_ORDER) {
		const name = `@oj-module/${pkg}`;
		for (;;) {
			const doc = await fetchRegistryJson(name);
			const tagOk = doc?.["dist-tags"]?.[TAG] === target;
			const hasVersion = Boolean(doc?.versions?.[target]);
			const tarball = doc?.versions?.[target]?.dist?.tarball;
			const tarballOk = tarball ? (await fetch(tarball, { method: "HEAD" })).ok : false;
			if (tagOk && hasVersion && tarballOk) {
				console.log(`✓ ${name}@${target} dist-tag=${TAG} 且 tarball 可达`);
				break;
			}
			if (Date.now() > deadline)
				fail(`${name} 复核超时——可能已发布但传播缓慢；手动查 ${REGISTRY}/${name.replace("/", "%2F")} 确认，勿直接重发新版本。`);
			console.log(`… ${name} 传播中（tag=${tagOk} version=${hasVersion} tarball=${tarballOk}），10s 后重试`);
			await new Promise(r => setTimeout(r, 10_000));
		}
	}
}

// ── 编排 ──────────────────────────────────────────────────
async function main() {
	console.log("== 1/5 前置校验 ==");
	const target = checkLockstep();
	checkCleanTree();
	// 登录校验仅 dry-run 跳过；web 2FA 同样要查——token 失效时 web 审批链路
	// 不会触发（无浏览器链接），只会在发布中途报迷惑性 404。
	if (!DRY_RUN)
		checkLoggedIn();

	console.log("\n== 2/5 产物重建 ==");
	rebuildArtifacts();

	console.log("\n== 3/5 守卫测试 ==");
	runGuardTests();

	console.log(`\n== 4/5 发布（runtime → cli，tag=${TAG}）==`);
	if (DRY_RUN) {
		console.log(`（--dry-run 跳过；将发布 ${PUBLISH_ORDER.map(p => `@oj-module/${p}@${target}`).join(" → ")}）`);
	}
	else {
		await publishAll(target);
	}

	console.log(`\n== 5/5 registry 复核（${REGISTRY}，最长 3 分钟）==`);
	if (DRY_RUN) {
		console.log("（--dry-run 跳过，无发布物）");
	}
	else {
		await verifyRegistry(target);
	}

	console.log(`\n完成：${PUBLISH_ORDER.map(p => `@oj-module/${p}@${target}`).join("、")}${DRY_RUN ? "（dry-run，未发布）" : ""}`);

	// pnpm ≥11 默认 minimumReleaseAge=1440（1 天）：裸版本号解析会跳过「未成熟」版本，
	// 期间消费端 pnpm i @oj-module/cli 可能装出更老的版本（依赖 404 时还会静默回退）。
	// 显式版本（pkg@x.y.z）不受限。见 docs/prd/202610101430-dlx-invocation.md 排障节。
	if (!DRY_RUN) {
		const matureAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
		console.log(`\n注意：pnpm ≥11 默认 minimumReleaseAge=1 天——裸版本号安装约在 ${matureAt.toISOString()} 后自动指向 ${target}；`);
		console.log(`在此之前消费端可用 pnpm i @oj-module/cli@${target} 显式指定（此现象非发布问题，勿重发版本）。`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
