// 发布 @oj-module/* 包：lockstep 门禁 → 产物重建 → 守卫测试 → 按依赖序发布 → registry 复核。
//
// 用法：node scripts/publish-packages.mjs [--dry-run] [--skip-tests] [--tag <tag>] [--otp <code>] [--web-2fa]
//   --dry-run     只构建 + 守卫测试，不发布（也不要求登录）
//   --skip-tests  跳过守卫测试（应急；发布前须手动补跑 pnpm vitest run tests/cli）
//   --tag <tag>   dist-tag，默认 latest
//   --otp <code>  npm 2FA 验证码（TOTP 类账户开启双因素认证时必填）；省略则在发布前交互索取
//   --web-2fa     npm 2FA 为「web 验证」（浏览器审批）模式：发布时 npm 弹浏览器让你批准，
//                 不传 --otp、也不索取验证码；脚本直接 pnpm publish 并等待浏览器审批完成。
//                 与 --otp 互斥，同时给则忽略 --otp。
//
// 流程来源：docs/prd/framework-development-guide.md 附录 A（发布 runbook）。
// 设计文档：docs/prd/202610101416-publish-script.md（事故背景见
// docs/prd/202610101405-cli-publish-private-deps-fix.md）。
// 发布仓库：registry.npmjs.org（用户指定；与各包 publishConfig.registry 一致，
// 与 .npmrc 安装源（同为官方源）一致）。
//
// 反常识点（runbook 实测踩坑，勿"优化"掉）：
//   - 必须 pnpm publish：npm publish 会把 workspace:*/catalog: 字面量发出去；
//   - 必须 --no-provenance：本仓 .npmrc 写了 provenance=true，本地无 CI OIDC 会失败；
//   - 必须 --otp（TOTP 类 2FA 开启时）：传入 `npm publish` 的 `EOTP` 拦截；省略则交互索取，
//     验证码失效/被拒时脚本会自动重新索取并重试该包（最多 3 次）；未开 2FA 时该参数被忽略；
//   - web 验证类 2FA：改用 --web-2fa。此时 npm 发布时弹浏览器审批，脚本不传 --otp、不索取验证码，
//     阻塞等待浏览器批准后继续；若审批超时/失败，按发布失败处理（无验证码可重输，重跑本命令即可）；
//   - 发布走各包 publishConfig.registry（官方源，与 .npmrc 安装源相同），复核只查官方 registry——
//     复核只查官方 registry，镜像可能一直 404 属正常；
//   - 发布后用 403 "previously published versions" 重发确认的办法已被
//     registry 轮询取代（本脚本自动处理 CDN 传播延迟）。
//   - 幂等：第 4 步发布前先查官方源，目标版本已存在则跳过该包。这样「runtime 已发、
//     cli 因 web 2FA 第二次审批未通过而失败」等情况，重跑本命令会跳过已发布的包、
//     只补发失败的包，不会卡在「版本已存在」报错。
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
	"@plane/kit": "packages/kit/package.json",
	"@plane/editor": "packages/editor-standalone/package.json",
};

const args = process.argv.slice(2);
const flag = name => args.includes(name);
function opt(name) {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
}
const DRY_RUN = flag("--dry-run");
const SKIP_TESTS = flag("--skip-tests");
const TAG = opt("--tag") ?? "latest";
const OTP = opt("--otp");
const WEB_2FA = flag("--web-2fa");

function fail(msg) {
	console.error(`\n✗ ${msg}`);
	process.exit(1);
}

function run(cmd, cmdArgs, cwd = ROOT) {
	console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
	execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
}

// 发布（带 2FA）：捕获输出以便识别 otp 失效并重试；成功/失败都回显，不让终端静默。
// interactive=true 时改用 stdio:"inherit"——web 验证类 2FA 需要可交互终端（TTY）来弹
// 浏览器审批，管道 stdio 会触发 ERR_PNPM_OTP_NON_INTERACTIVE。
function publishPkg(pkg, otp, interactive = false) {
	const cmdArgs = [
		"-C",
		`packages/${pkg}`,
		"publish",
		"--access",
		"public",
		"--no-provenance",
		"--no-git-checks",
		...(TAG !== "latest" ? ["--tag", TAG] : []),
		...(otp ? ["--otp", otp] : []),
	];
	console.log(`$ pnpm ${cmdArgs.join(" ")}`);
	const opts = interactive ? { cwd: ROOT } : { cwd: ROOT, encoding: "utf-8" };
	try {
		const out = execFileSync("pnpm", cmdArgs, opts);
		if (!interactive && out)
			process.stdout.write(out);
		return true;
	}
	catch (err) {
		if (interactive) {
			// 交互模式下报错已直接落到终端，无需回显；web 验证无验证码可重输，按失败处理
			return { needOtp: false };
		}
		const out = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
		process.stderr.write(out);
		// npm 2FA 拦截：EOTP / "one-time pass" / "otp"；其余错误按失败处理
		if (/EOTP|one-time pass|otp/i.test(out))
			return { needOtp: true };
		return { needOtp: false };
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

/** 目标版本是否已发布到官方源（幂等跳过，避免「runtime 已发、cli 失败」后重跑卡在已存在版本） */
async function isPublished(name, version) {
	try {
		const res = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}/${version}`);
		return res.ok;
	}
	catch {
		return false;
	}
}

function readVersion(rel) {
	return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")).version;
}

// ── 1. 前置校验 ──────────────────────────────────────────────
console.log("== 1/5 前置校验 ==");

const versions = Object.fromEntries(
	Object.entries(LOCKSTEP).map(([name, rel]) => [name, readVersion(rel)]),
);
const target = versions["@oj-module/runtime"];
const mismatch = Object.entries(versions).filter(([, v]) => v !== target);
if (mismatch.length > 0)
	fail(`lockstep 版本不一致（应全部 = ${target}）：\n${Object.entries(versions).map(([n, v]) => `  ${n} = ${v}`).join("\n")}`);
console.log(`lockstep 版本一致：${target}`);

if (execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf-8" }).trim())
	fail("工作区不干净——pnpm publish 要求干净树，请先提交全部改动。");

if (!DRY_RUN) {
	try {
		execFileSync("npm", ["whoami", `--registry=${REGISTRY}`], { stdio: "pipe" });
	}
	catch {
		fail(`未登录 ${REGISTRY}：npm login --registry=${REGISTRY}`);
	}
}

// ── 2. 产物重建 ──────────────────────────────────────────────
console.log("\n== 2/5 产物重建 ==");
run("pnpm", ["--filter", "@oj-module/runtime", "build"]);
run("pnpm", ["--filter", "@oj-module/cli", "build:shell"]);

// ── 3. 守卫测试（真跑 pnpm pack 的发布清单守护）────────────────
if (!SKIP_TESTS) {
	console.log("\n== 3/5 守卫测试 ==");
	run("pnpm", ["vitest", "run", "tests/cli/", "tests/shell/kit-shared.test.ts"]);
}
else {
	console.log("\n== 3/5 守卫测试（--skip-tests 已跳过，发布前须手动补跑）==");
}

// ── 4. 按依赖序发布 ──────────────────────────────────────────
if (DRY_RUN) {
	console.log(`\n== 4/5 发布（--dry-run 跳过；将发布 ${PUBLISH_ORDER.map(p => `@oj-module/${p}@${target}`).join(" → ")}，tag=${TAG}）==`);
}
else {
	console.log(`\n== 4/5 发布（runtime → cli，tag=${TAG}）==`);
	for (const pkg of PUBLISH_ORDER) {
		const name = `@oj-module/${pkg}`;
		// 幂等：已发布的目标版本直接跳过，使「部分发布失败」后可安全重跑
		if (await isPublished(name, target)) {
			console.log(`ⓘ ${name}@${target} 已发布，跳过`);
			continue;
		}
		if (WEB_2FA) {
			// web 验证：不传 --otp、改用交互式 stdio（inherit），由 pnpm 浏览器流接管；
			// 每个包需各自在浏览器批准一次。失败无验证码可重输，按发布失败处理（重跑会跳过已发布的包）
			console.log(`ⓘ web 2FA：请在浏览器中批准 ${name}@${target} 的发布（脚本阻塞等待审批）`);
			const res = publishPkg(pkg, undefined, true);
			if (res !== true)
				fail(`${pkg} 发布失败（web 2FA 未通过或网络错误；可重跑本命令，已发布的包会自动跳过）。`);
		}
		else {
			let otp = OTP;
			if (!otp)
				otp = await askOtp();
			let attempts = 0;
			for (;;) {
				const res = publishPkg(pkg, otp);
				if (res === true)
					break;
				// 2FA 验证码失效/被拒：重新索取后重试（最多 3 次），避免整轮前功尽弃
				if (res.needOtp && attempts < 3) {
					attempts++;
					console.error(`\n✗ ${pkg} 发布被 2FA 拦截（otp 无效或过期），请重新输入（第 ${attempts} 次重试）`);
					otp = await askOtp();
					continue;
				}
				fail(`${pkg} 发布失败（见上方输出）；已发布的包重跑本命令会自动跳过。`);
			}
		}
	}
}

// ── 5. registry 复核（官方源轮询，容忍 CDN 传播延迟）────────────
// ponytail: 复核对象只是「本轮刚发的版本」，dry-run 无发布物，整步跳过
if (DRY_RUN) {
	console.log("\n== 5/5 registry 复核（--dry-run 跳过，无发布物）==");
}
else {
	console.log(`\n== 5/5 registry 复核（${REGISTRY}，最长 3 分钟）==`);
	const deadline = Date.now() + 180_000;
	for (const pkg of PUBLISH_ORDER) {
		const name = `@oj-module/${pkg}`;
		const url = `${REGISTRY}/${name.replace("/", "%2F")}`;
		for (;;) {
			try {
				const res = await fetch(url);
				if (res.ok) {
					const doc = await res.json();
					const tagOk = doc["dist-tags"]?.[TAG] === target;
					const hasVersion = Boolean(doc.versions?.[target]);
					const tarball = doc.versions?.[target]?.dist?.tarball;
					const tarballOk = tarball ? (await fetch(tarball, { method: "HEAD" })).ok : false;
					if (tagOk && hasVersion && tarballOk) {
						console.log(`✓ ${name}@${target} dist-tag=${TAG} 且 tarball 可达`);
						break;
					}
					console.log(`… ${name} 传播中（tag=${tagOk} version=${hasVersion} tarball=${tarballOk}），10s 后重试`);
				}
				else {
					console.log(`… ${name} ${res.status}（CDN 传播中），10s 后重试`);
				}
			}
			catch {
				console.log(`… ${name} 拉取失败（网络/CDN），10s 后重试`);
			}
			if (Date.now() > deadline)
				fail(`${name} 复核超时——可能已发布但传播缓慢；手动查 ${url} 确认，勿直接重发新版本。`);
			await new Promise(r => setTimeout(r, 10_000));
		}
	}
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
