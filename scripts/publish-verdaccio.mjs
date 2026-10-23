// 模拟发布 @oj-module/* 到本地 verdaccio：lockstep 门禁 → 产物重建 → 守卫测试 → 按依赖序发布 → registry 复核。
//
// 与 scripts/publish-packages.mjs（官方源发布）同构的五步流程，差异只有三处：
//   1. 目标 registry 显式钉本地 http://127.0.0.1:4873（可用环境变量 VERDACCIO_REGISTRY
//      覆盖）——**不靠 .npmrc 的 @oj-module:registry 作用域映射隐式决定**（映射缺席时
//      会静默回落公网，2026-10-23 演练时因此被执行分类器拦下过：显式 --registry 才无歧义）；
//   2. 无 2FA（本地 registry 无 TOTP/web 审批）；
//   3. 复核查本地（无 CDN 传播延迟，秒级，不轮询 3 分钟）。
//
// 用途：发布前演练 / playbook 的 §0.5 发布形态准备，验证「用户真正装到的包」。
// 实发官方源请走 publish-packages.mjs（--registry 钉死 npmjs，两包 publishConfig
// 仅 access:public，不受本脚本与本机 .npmrc 影响）。
//
// 用法：node scripts/publish-verdaccio.mjs --publish [--skip-tests]
//       node scripts/publish-verdaccio.mjs --dry-run

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = process.env.VERDACCIO_REGISTRY ?? "http://127.0.0.1:4873";

/** 发布顺序即依赖顺序：cli 精确依赖 runtime，颠倒则消费端装不上 */
const PUBLISH_ORDER = ["runtime", "cli"];
/** lockstep 同版校验（与 publish-packages.mjs 同口径） */
const LOCKSTEP = {
	"@oj-module/runtime": "packages/runtime/package.json",
	"@oj-module/cli": "packages/cli/package.json",
};

const args = process.argv.slice(2);
const flag = name => args.includes(name);

/** 帮助文本（用法 + 五步流程 + 全部旗标），同 publish-packages.mjs 的维护口径 */
const USAGE = `用法：node scripts/publish-verdaccio.mjs --publish [--skip-tests]
     node scripts/publish-verdaccio.mjs --dry-run

一键把 @oj-module/runtime + @oj-module/cli（双包 lockstep 同版，按依赖序
runtime → cli）发布到**本地 verdaccio**（默认 http://127.0.0.1:4873，可用环境变量
VERDACCIO_REGISTRY 覆盖）。发布前演练 / playbook §0.5 发布形态准备用；
**实发官方源请走 scripts/publish-packages.mjs**。

不带任何参数运行 = 显示本帮助（退出 1）——实发必须显式 --publish，
「手滑敲个命令」不会变成发布动作。

流程（5 步，任一失败即中止；已发布的版本自动跳过，可安全重跑）：
  1/5 前置校验      lockstep 同版门禁 + 工作区干净 + verdaccio 可达
  2/5 产物重建      runtime build + cli build:shell（宿主外壳预打包）
  3/5 守卫测试      vitest run tests/cli/ tests/shell/kit-shared.test.ts
  4/5 发布          runtime → cli（pnpm publish --registry ${REGISTRY} 显式钉本地）
  5/5 registry 复核 本地查 dist-tag / version / tarball（秒级，无 CDN 延迟）

选项：
  --publish     实发（到本地 verdaccio；显式动作）。与 --dry-run 互斥
  --dry-run     演练：只构建 + 守卫测试，不发布
  --skip-tests  跳过守卫测试（应急；发布前须手动补跑 pnpm vitest run tests/cli）
  -h, --help    打印本帮助并退出（不做任何校验、不发布）

发布目标：${REGISTRY}（命令行 --registry 显式钉死，不靠 .npmrc 作用域映射）`;

const KNOWN_FLAGS = new Set(["--dry-run", "--skip-tests", "--publish", "--help", "-h"]);
const unknownArgs = args.filter(a => a.startsWith("-") && !KNOWN_FLAGS.has(a));
if (flag("--help") || flag("-h")) {
	console.log(USAGE);
	process.exit(0);
}
if (args.length === 0) {
	console.log(USAGE);
	process.exit(1); // 裸跑 = 显示帮助，不发生任何动作
}
if (unknownArgs.length > 0) {
	console.error(`✗ 未知参数：${unknownArgs.join(" ")}\n`);
	console.error(USAGE);
	process.exit(1);
}
const DRY_RUN = flag("--dry-run");
const SKIP_TESTS = flag("--skip-tests");
const PUBLISH = flag("--publish");
if (DRY_RUN && PUBLISH) {
	console.error("✗ --publish 与 --dry-run 互斥：实发还是演练，二选一。\n");
	console.error(USAGE);
	process.exit(1);
}
if (!DRY_RUN && !PUBLISH) {
	console.error("✗ 未指定 --publish：意图不明直接 fail-fast（可加 --dry-run 演练）。\n");
	console.error(USAGE);
	process.exit(1);
}

function fail(msg) {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

function run(cargs) {
	execFileSync("pnpm", cargs, { cwd: ROOT, stdio: "inherit" });
}

function readVersion(rel) {
	return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")).version;
}

/** 1. lockstep 同版校验，返回目标版本号（与 publish-packages.mjs 同逻辑） */
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

/** 1. verdaccio 可达性（本地服务没起时给出可执行指引，而不是发布中途才拒连） */
function checkRegistryUp() {
	try {
		execFileSync("curl", ["-sf", "-o", "/dev/null", REGISTRY], { stdio: "pipe" });
	}
	catch {
		fail(`verdaccio 不可达（${REGISTRY}）——先启动本地服务（如 npx verdaccio），再跑本命令。`);
	}
	console.log(`✓ verdaccio 可达：${REGISTRY}`);
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

async function fetchRegistryJson(name) {
	try {
		const res = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`);
		return res.ok ? await res.json() : null;
	}
	catch {
		return null;
	}
}

/** 4. 按依赖序发布；已发布目标版本自动跳过（可安全重跑），单包失败不中断、末尾汇总 */
async function publishAll(target) {
	const failed = [];
	for (const pkg of PUBLISH_ORDER) {
		const name = `@oj-module/${pkg}`;
		const doc = await fetchRegistryJson(name);
		if (doc?.versions?.[target]) {
			console.log(`ⓘ ${name}@${target} 已发布，跳过`);
			continue;
		}
		try {
			run(["-C", `packages/${pkg}`, "publish", "--registry", REGISTRY, "--access", "public", "--no-provenance", "--no-git-checks"]);
			console.log(`✓ ${name}@${target} 发布成功`);
		}
		catch {
			failed.push(pkg);
			console.error(`✗ ${name}@${target} 发布失败`);
		}
	}
	if (failed.length > 0)
		fail(`以下包发布失败（见上方输出；已发布的包重跑本命令会自动跳过）：${failed.map(p => `@oj-module/${p}`).join("、")}`);
}

/** 5. registry 复核：本地直查（无 CDN 传播延迟，失败即真相，不轮询） */
async function verifyRegistry(target) {
	for (const pkg of PUBLISH_ORDER) {
		const name = `@oj-module/${pkg}`;
		const doc = await fetchRegistryJson(name);
		const tagOk = doc?.["dist-tags"]?.latest === target;
		const hasVersion = Boolean(doc?.versions?.[target]);
		const tarball = doc?.versions?.[target]?.dist?.tarball;
		const tarballOk = tarball ? (await fetch(tarball, { method: "HEAD" })).ok : false;
		if (!(tagOk && hasVersion && tarballOk))
			fail(`${name}@${target} 复核失败（tag=${tagOk} version=${hasVersion} tarball=${tarballOk}）——查 ${REGISTRY}/${name.replace("/", "%2F")}`);
		console.log(`✓ ${name}@${target} dist-tag=latest 且 tarball 可达`);
	}
}

async function main() {
	console.log("== 1/5 前置校验 ==");
	const target = checkLockstep();
	checkCleanTree();
	if (!DRY_RUN)
		checkRegistryUp();

	console.log("\n== 2/5 产物重建 ==");
	rebuildArtifacts();

	console.log("\n== 3/5 守卫测试 ==");
	runGuardTests();

	console.log("\n== 4/5 发布（runtime → cli，本地 verdaccio）==");
	if (DRY_RUN)
		console.log(`（--dry-run 跳过；将发布 ${PUBLISH_ORDER.map(p => `@oj-module/${p}@${target}`).join(" → ")} → ${REGISTRY}）`);
	else
		await publishAll(target);

	console.log(`\n== 5/5 registry 复核（${REGISTRY}）==`);
	if (DRY_RUN)
		console.log("（--dry-run 跳过，无发布物）");
	else
		await verifyRegistry(target);

	console.log(`\n完成：${PUBLISH_ORDER.map(p => `@oj-module/${p}@${target}`).join("、")} → ${REGISTRY}${DRY_RUN ? "（dry-run，未发布）" : ""}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
