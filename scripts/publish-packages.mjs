// 发布 @oj-module/* 包：lockstep 门禁 → 产物重建 → 守卫测试 → 按依赖序发布 → registry 复核。
//
// 用法：node scripts/publish-packages.mjs [--dry-run] [--skip-tests] [--tag <tag>]
//   --dry-run     只构建 + 守卫测试，不发布（也不要求登录）
//   --skip-tests  跳过守卫测试（应急；发布前须手动补跑 pnpm vitest run tests/cli）
//   --tag <tag>   dist-tag，默认 latest
//
// 流程来源：docs/prd/framework-development-guide.md 附录 A（发布 runbook）。
// 设计文档：docs/prd/202610101416-publish-script.md（事故背景见
// docs/prd/202610101405-cli-publish-private-deps-fix.md）。
// 发布仓库：registry.npmjs.org（用户指定；与各包 publishConfig.registry 一致，
// 与 .npmrc 安装镜像 npmmirror 互不影响）。
//
// 反常识点（runbook 实测踩坑，勿"优化"掉）：
//   - 必须 pnpm publish：npm publish 会把 workspace:*/catalog: 字面量发出去；
//   - 必须 --no-provenance：本仓 .npmrc 写了 provenance=true，本地无 CI OIDC 会失败；
//   - 发布走各包 publishConfig.registry（官方源），与 .npmrc 安装镜像（npmmirror）无关——
//     复核只查官方 registry，镜像可能一直 404 属正常；
//   - 发布后用 403 "previously published versions" 重发确认的办法已被
//     registry 轮询取代（本脚本自动处理 CDN 传播延迟）。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
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

function fail(msg) {
	console.error(`\n✗ ${msg}`);
	process.exit(1);
}

function run(cmd, cmdArgs, cwd = ROOT) {
	console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
	execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
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
		run("pnpm", [
			"-C",
			`packages/${pkg}`,
			"publish",
			"--access",
			"public",
			"--no-provenance",
			"--no-git-checks",
			...(TAG !== "latest" ? ["--tag", TAG] : []),
		]);
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
