/**
 * prepack：把随站第一方方案包（templates/dist/<name>-<version>.tgz + .sig）
 * 收进 cli 包的 shell-dist/bundles/——`ojm init --yes` 从此目录取包落位用户
 * 工程 cdn/（Phase B T3b，方案 §5）。
 *
 * 生产侧（T1 拍板）：签名是发布期手工动作（私钥永不出 ~/.ojm/keys），发布
 * 流水线顺序 = templates `pnpm build` → `ojm build --bundle oj-market` →
 * `ojm sign --registry-id <registry>`（产 .sig 旁车）→ `pnpm prepack`（本脚本）。
 *
 * templates/dist 不存在（源码仓未构建/未签名）→ 清空 shell-dist/bundles 并告警
 * 退出 0：源码直跑的 init --yes 走「warning 不失败」降级路径（init.ts 已有）。
 * 已发布包的 bundles 与本次不一致 → 覆盖同步（发布即唯一真源，不做增量）。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesDist = path.join(cliRoot, "templates", "dist");
const bundlesDir = path.join(cliRoot, "shell-dist", "bundles");

fs.rmSync(bundlesDir, { recursive: true, force: true });

if (!fs.existsSync(templatesDist)) {
	console.warn("[prepack] templates/dist 缺失——跳过随站方案包收编（发布包将不含 bundle，init --yes 走出厂未装降级）");
	process.exit(0);
}

/** 数字段比较（与 ojm build/backend.ts compareVersions 同口径，仅取主.次.补丁） */
function compareVersions(a, b) {
	const pa = a.split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
	const pb = b.split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0)
			return d;
	}
	return 0;
}

const signed = fs.readdirSync(templatesDist)
	.filter(f => f.endsWith(".tgz"))
	.flatMap(tgz => (fs.existsSync(path.join(templatesDist, `${tgz}.sig`)) ? [[tgz, `${tgz}.sig`]] : []))
	.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

if (signed.length === 0) {
	console.warn("[prepack] templates/dist 无已签名 bundle（*.tgz+.sig）——发布包将不含随站方案包；init --yes 走出厂未装降级");
	process.exit(0);
}

// 版本去重（2026-11-08）：同一方案只发**最高版本**。历史包一起随站会让 init 落位的
// cdn/ 里同时躺 0.2.0/0.2.1/0.2.3，启动收敛按文件名顺序逐版安装——多跑两轮迁移，
// 且中间版本若换了签名身份会卡进 needs_trust 冷却（bootstrap 只认 platform.release）。
const byName = new Map();
for (const [tgz, sig] of signed) {
	const m = /^(.+)-(\d[0-9A-Za-z.+-]*)\.tgz$/.exec(tgz);
	if (m === null) {
		console.warn(`[prepack] 跳过无法解析 name/version 的包：${tgz}（命名纪律 <name>-<version>.tgz）`);
		continue;
	}
	const [, name, version] = m;
	const prev = byName.get(name);
	if (prev === undefined || compareVersions(version, prev.version) > 0)
		byName.set(name, { version, tgz, sig });
}

// 与模板源码版本对账（fail-closed）：源码升了版但没重建/没重签时发布包会带旧 UI——
// 这正是 2026-11-07 市场卡片修复「源码绿、随站包旧」复现的成因，交给 prepack 拦死。
const srcRoot = path.join(cliRoot, "templates", "src");
const drifted = [];
for (const e of fs.readdirSync(srcRoot, { withFileTypes: true })) {
	if (!e.isDirectory() || e.name.startsWith("."))
		continue;
	const contract = path.join(srcRoot, e.name, "solution.yaml");
	if (!fs.existsSync(contract))
		continue;
	const text = fs.readFileSync(contract, "utf-8");
	const name = /^name:\s*(\S+)\s*$/m.exec(text)?.[1];
	const version = /^version:\s*(\S+)\s*$/m.exec(text)?.[1];
	if (name === undefined || version === undefined)
		continue;
	const packed = byName.get(name);
	if (packed === undefined)
		drifted.push(`${name}@${version}（templates/dist 无同名已签名包）`);
	else if (packed.version !== version)
		drifted.push(`${name}: 源码 ${version}，随站包 ${packed.version}（${packed.tgz}）`);
}
if (drifted.length > 0) {
	console.error("[prepack] 随站方案包与模板源码版本不一致——拒绝发布（否则 ojm init 装到旧版本）：");
	for (const d of drifted)
		console.error(`  · ${d}`);
	console.error("  处置：cd packages/cli/templates && pnpm build → npx ojm build --bundle <name> → npx ojm sign dist/<name>-<ver>.tgz --id platform.release --registry-id oj-registry --check");
	process.exit(1);
}

const kept = [...byName.values()].sort((a, b) => (a.tgz < b.tgz ? -1 : a.tgz > b.tgz ? 1 : 0));
fs.mkdirSync(bundlesDir, { recursive: true });
for (const { tgz, sig } of kept) {
	fs.copyFileSync(path.join(templatesDist, tgz), path.join(bundlesDir, tgz));
	fs.copyFileSync(path.join(templatesDist, sig), path.join(bundlesDir, sig));
}
console.log(`[prepack] 随站方案包收编 ${kept.length} 个：${kept.map(k => k.tgz).join(", ")}`);
const pruned = signed.length - kept.length;
if (pruned > 0)
	console.log(`[prepack] 已裁掉 ${pruned} 个历史版本包（同方案只发最高版本）`);
